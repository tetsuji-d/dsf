import { withEditionDeadline } from './edition-load-deadline.js';

// Firebase ID tokens use the same Firestore Rules as the SDK. No admin endpoint,
// manuscript body, persistent cache or long-lived Listen channel is involved.
const titleFields = ['title', 'meta', 'defaultLang', 'languages'];
export const EDITION_READ_FIELDS = Object.freeze({
    works: [...titleFields, 'projectId'],
    projects: [...titleFields, 'projectName', 'workId', 'dsfPages', 'dsfSchemaVersion', 'dsfStatus', 'dsfPublishedAt', 'publication'],
    releases: [...titleFields, 'projectId', 'createdAt', 'dsfPublishedAt', 'publication', 'thumbnail', 'dsfSchemaVersion', 'dsfPages', 'dsfLangs', 'book.covers.c1.pageIndex'],
    edition_states: ['embedPolicy', 'editionId', 'revision', 'status', 'publication', 'firstPublishedAtMs', 'successorEditionId', 'editionLabel', 'cleanupPending', 'moderationRejected',
        ...titleFields.map(field => 'publicSnapshot.' + field), 'publicSnapshot.thumbnail'],
    public_projects: [...titleFields, 'authorUid', 'workId', 'releaseId', 'projectId', 'dsfStatus', 'publication', 'thumbnail'],
});

const fail = (code, retryable = false) => Object.assign(new Error(code), { retryable });
function decode(value) {
    if (!value || typeof value !== 'object') throw fail('EDITION_RESPONSE_INVALID');
    if ('timestampValue' in value) {
        const date = new Date(value.timestampValue);
        if (!Number.isFinite(date.getTime())) throw fail('EDITION_RESPONSE_INVALID');
        return date;
    }
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('nullValue' in value) return null;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, entry]) => [key, decode(entry)]));
    throw fail('EDITION_RESPONSE_INVALID');
}

/** Abort the actual HTTP request, including a stalled response body, on timeout. */
export function createEditionListReader({ projectId, uid, getToken, isCurrent, signal, fetchImpl = fetch, timeoutMs = 8000, pageSize = 250 }) {
    const database = `projects/${projectId}/databases/(default)/documents`;
    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
    const current = () => {
        if (signal?.aborted) throw signal.reason || fail('EDITION_LIST_CHANGED');
        if (!isCurrent()) throw fail('EDITION_SESSION_CHANGED');
    };
    async function request(parent, structuredQuery) {
        for (let attempt = 0; attempt < 2; attempt++) {
            current();
            const controller = new AbortController();
            const abort = () => controller.abort(signal.reason);
            signal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => controller.abort(fail('EDITION_LOAD_TIMEOUT', true)), timeoutMs);
            const task = async () => {
                const token = await getToken(); current();
                if (controller.signal.aborted) throw controller.signal.reason;
                const response = await fetchImpl(endpoint + (parent.length ? '/' + parent.map(encodeURIComponent).join('/') : '') + ':runQuery', {
                    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ structuredQuery }),
                });
                current();
                if (!response.ok) {
                    await response.body?.cancel().catch(() => {});
                    throw fail(response.status === 401 ? 'EDITION_AUTH_REQUIRED' : response.status === 403 ? 'EDITION_READ_FORBIDDEN' : 'EDITION_NETWORK_ERROR', [429, 500, 502, 503, 504].includes(response.status));
                }
                const reader = response.body.getReader(), chunks = [];
                let length = 0;
                try {
                    for (;;) {
                        const { value, done } = await reader.read(); current();
                        if (controller.signal.aborted) throw controller.signal.reason;
                        if (done) break;
                        length += value.byteLength;
                        if (length > 16 * 1024 * 1024) throw fail('EDITION_RESPONSE_TOO_LARGE');
                        chunks.push(value);
                    }
                } catch (error) { void reader.cancel().catch(() => {}); throw error; }
                finally { reader.releaseLock(); }
                const bytes = new Uint8Array(length); let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                const result = JSON.parse(new TextDecoder().decode(bytes));
                if (!Array.isArray(result) || result.some(row => row.error || (!row.document && !row.readTime))) throw fail('EDITION_RESPONSE_INVALID');
                return result;
            };
            try {
                return await withEditionDeadline(task(), { signal: controller.signal, timeoutMs: timeoutMs + 100 });
            } catch (error) {
                current();
                const reason = controller.signal.aborted ? controller.signal.reason : error;
                if (attempt || !(reason.retryable || reason instanceof TypeError)) {
                    throw reason instanceof TypeError ? fail('EDITION_NETWORK_ERROR') : reason;
                }
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                controller.abort();
            }
        }
    }
    async function records(path) {
        current();
        const kind = path.at(-1), owner = path[0] === 'users' && path[1] === uid;
        const allowed = owner && ((path.length === 3 && ['works', 'projects'].includes(kind))
            || (path.length === 5 && path[2] === 'works' && ['releases', 'edition_states'].includes(kind)))
            || path.length === 1 && kind === 'public_projects';
        if (!allowed || path.some(part => typeof part !== 'string' || !part || part.includes('/'))) throw fail('EDITION_SCOPE_INVALID');
        const parent = path.slice(0, -1), prefix = database + '/' + path.join('/') + '/';
        const rows = [], seen = new Set(); let cursor;
        for (let page = 0; page < 100; page++) {
            const query = { from: [{ collectionId: kind }], select: { fields: EDITION_READ_FIELDS[kind].map(fieldPath => ({ fieldPath })) },
                orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: pageSize };
            if (kind === 'public_projects') query.where = { fieldFilter: { field: { fieldPath: 'authorUid' }, op: 'EQUAL', value: { stringValue: uid } } };
            if (cursor) query.startAt = { values: [{ referenceValue: cursor }], before: false };
            const result = await request(parent, query); current();
            const documents = result.filter(row => row.document).map(row => row.document);
            for (const doc of documents) {
                if (typeof doc.name !== 'string' || !doc.name.startsWith(prefix) || !doc.name.slice(prefix.length) || doc.name.slice(prefix.length).includes('/') || seen.has(doc.name)) throw fail('EDITION_SCOPE_INVALID');
                const data = decode({ mapValue: { fields: doc.fields || {} } });
                if (kind === 'public_projects' && data.authorUid !== uid) throw fail('EDITION_SCOPE_INVALID');
                seen.add(doc.name); rows.push({ ...data, id: doc.name.slice(prefix.length) });
            }
            if (documents.length < pageSize) return rows;
            cursor = documents.at(-1).name;
        }
        throw fail('EDITION_RESPONSE_TOO_LARGE'); // Never label an incomplete inventory as complete.
    }
    return { records, publicRecords: () => records(['public_projects']) };
}
