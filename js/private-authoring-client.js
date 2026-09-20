import { isPrivateAuthoringId } from './private-authoring-ids.js';
import {
    assertPrivateAuthoringHead, createPrivateAuthoringSnapshot,
    readPrivateAuthoringSnapshot, PRIVATE_AUTHORING_MAX_BYTES,
} from './private-authoring-storage.js';

export class AuthoringClientError extends Error {
    constructor(code, status = 0) { super(code); this.name = 'AuthoringClientError'; this.code = code; this.status = status; }
}
const check = (value, code) => { if (!value) throw new AuthoringClientError(code); };
const copy = value => JSON.parse(JSON.stringify(value));
const sameHead = (a, b) => a.revision === b.revision && a.revisionId === b.revisionId
    && a.sha256 === b.sha256 && a.byteLength === b.byteLength;
export function usesPrivateAuthoring(root) {
    // Partial/unknown migration markers also fail closed; never try legacy persistence.
    return Object.hasOwn(root, 'authoringBackend') || Object.hasOwn(root, 'authoringStorageVersion')
        || root.authoringRef === 'authoringHeads/current';
}
export function assertPrivateAuthoringRoot(root, uid, projectId) {
    check([5, 6].includes(root.version) && root.ownerUid === uid && root.projectId === projectId
        && root.authoringBackend === 'r2-private' && root.authoringStorageVersion === 1
        && root.authoringRef === 'authoringHeads/current'
        && !['blocks', 'pages', 'sections'].some(key => Object.hasOwn(root, key)), 'AUTHORING_ROOT_INVALID');
}
export function authoringSaveMessage(error) {
    if (/CONFLICT|REUSED/.test(error?.code || '')) return '別の更新があります。ローカル原稿を退避し、クラウド版を開き直してください';
    if (/SESSION|RELOAD|LEASE|EXPIRED|REJECTED/.test(error?.code || '')) return 'クラウド未保存。ローカル原稿を退避し、クラウド版を開き直してください';
    if (/TOO_LARGE|INVALID|SIZE|COMPLEXITY/.test(error?.code || '')) return '原稿の容量・形式を確認してください。クラウド未保存です';
    if (/ASSET/.test(error?.code || '')) return '画像を保存できません。クラウド未保存です';
    if (/DISABLED|NOT_ENABLED/.test(error?.code || '')) return 'このプロジェクトのクラウド保存はまだ有効になっていません';
    return 'クラウド未保存。通信・ログイン状態を確認して再保存してください';
}
async function bytesLimited(response, limit) {
    const reader = response.body?.getReader();
    check(reader, 'AUTHORING_RESPONSE_INVALID');
    const parts = []; let length = 0;
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break;
            length += value.byteLength;
            check(length <= limit, 'AUTHORING_RESPONSE_TOO_LARGE'); parts.push(value);
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
}
function parse(bytes) {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new AuthoringClientError('AUTHORING_RESPONSE_INVALID'); }
}

/** One open editor session. No token, revision or pending body is placed in project state. */
export function createPrivateAuthoringClient({ uid, projectId, user, isCurrent,
    fetcher = globalThis.fetch, newRequestId = () => crypto.randomUUID(), timeoutMs = 30_000 }) {
    check(isPrivateAuthoringId(uid) && isPrivateAuthoringId(projectId), 'AUTHORING_SCOPE_INVALID');
    const path = `/api/projects/${encodeURIComponent(projectId)}/authoring`;
    let head = null, pending = null, creating = null, blocked = null, busy = false;
    const current = () => check(isCurrent() && user?.uid === uid, 'AUTHORING_SESSION_CHANGED');
    const scope = value => ({ uid, projectId, generationId: value.generationId });
    const validateHead = value => {
        check(value && typeof value === 'object', 'AUTHORING_RECEIPT_INVALID');
        assertPrivateAuthoringHead(value, scope(head || value)); return value;
    };
    async function request(suffix, options = {}, limit = 32 * 1024) {
        current();
        const token = await user.getIdToken(false); current();
        check(typeof token === 'string' && token.length > 0, 'AUTH_REQUIRED');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetcher(path + suffix, { ...options, cache: 'no-store', credentials: 'omit',
                redirect: 'error', signal: controller.signal,
                headers: { ...options.headers, Authorization: `Bearer ${token}` } });
            const bytes = await bytesLimited(response, response.ok ? limit : 32 * 1024);
            current();
            if (!response.ok) {
                const code = parse(bytes)?.error;
                throw new AuthoringClientError(typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'AUTHORING_UNAVAILABLE', response.status);
            }
            return { bytes, response };
        } finally { clearTimeout(timer); }
    }
    function accept(receipt) {
        check(receipt?.state === 'committed' && receipt.requestId === pending.requestId
            && ['commit', 'unchanged'].includes(receipt.result), 'AUTHORING_RECEIPT_INVALID');
        const committed = validateHead(receipt.committedHead), latest = validateHead(receipt.currentHead);
        check(committed.sha256 === pending.snapshot.sha256 && committed.byteLength === pending.snapshot.byteLength
            && committed.revision === pending.baseRevision + (receipt.result === 'commit' ? 1 : 0)
            && (receipt.result !== 'commit' || committed.revisionId === pending.requestId), 'AUTHORING_RECEIPT_INVALID');
        check(sameHead(committed, latest), 'AUTHORING_REVISION_CONFLICT');
        head = copy(committed); pending = null;
    }
    async function transmit(retry) {
        const headers = { 'X-Authoring-Generation': head.generationId };
        if (retry) {
            try {
                const receipt = parse((await request(`/operations/${pending.requestId}`, { headers })).bytes);
                check(receipt.requestId === pending.requestId, 'AUTHORING_RECEIPT_INVALID');
                if (receipt.state === 'committed') { accept(receipt); return; }
                check(receipt.state === 'pending', 'AUTHORING_REJECTED');
                check(sameHead(validateHead(receipt.currentHead), head), 'AUTHORING_REVISION_CONFLICT');
            } catch (error) { if (!(error.status === 404 && error.code === 'OPERATION_NOT_FOUND')) throw error; }
        }
        const result = await request('', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json',
            'X-Authoring-Base-Revision': String(pending.baseRevision), 'X-Authoring-Request-Id': pending.requestId }, body: pending.snapshot.json });
        accept(parse(result.bytes));
    }
    return Object.freeze({
        getHead() { current(); return head ? copy(head) : null; },
        async load() {
            check(!busy && !head, 'AUTHORING_RELOAD_REQUIRED'); busy = true;
            try {
                const { bytes, response } = await request('', {}, PRIVATE_AUTHORING_MAX_BYTES);
                const raw = response.headers.get('X-Authoring-Head');
                check(raw && raw.length <= 16 * 1024, 'AUTHORING_RESPONSE_INVALID');
                const loadedHead = validateHead(parse(new TextEncoder().encode(raw)));
                const { revision, ...descriptor } = loadedHead;
                const project = await readPrivateAuthoringSnapshot(bytes, descriptor, scope(loadedHead));
                current(); head = copy(loadedHead); return project;
            } finally { busy = false; }
        },
        async create(project) {
            current(); check(!busy && !head, 'AUTHORING_RELOAD_REQUIRED');
            if (blocked) throw blocked;
            busy = true;
            try {
                // Freeze the first body even if the editor changes while retrying.
                if (!creating) {
                    const snapshot = await createPrivateAuthoringSnapshot(project); current();
                    check(snapshot.project.projectId === projectId, 'AUTHORING_SCOPE_INVALID');
                    creating = Object.freeze({ snapshot, requestId: newRequestId() });
                }
                const result = parse((await request('', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Authoring-Request-Id': creating.requestId },
                    body: creating.snapshot.json })).bytes);
                check(result.state === 'committed' && result.result === 'commit' && result.requestId === creating.requestId, 'AUTHORING_RECEIPT_INVALID');
                const committed = validateHead(result.committedHead), latest = validateHead(result.currentHead);
                check(committed.generationId === creating.requestId && committed.revisionId === creating.requestId
                    && committed.revision === 1 && committed.sha256 === creating.snapshot.sha256
                    && committed.byteLength === creating.snapshot.byteLength && sameHead(committed, latest), 'AUTHORING_RECEIPT_INVALID');
                current(); head = copy(committed); creating = null;
            } catch (error) {
                if ([409, 413, 422].includes(error.status) || /CONFLICT|REJECTED|RECEIPT|SCOPE|GENERATION/.test(error.code || '')) blocked = error;
                throw error;
            } finally { busy = false; }
        },
        async save(project) {
            current(); check(head, 'AUTHORING_RELOAD_REQUIRED');
            if (blocked) throw blocked;
            check(!busy, 'AUTHORING_SAVE_BUSY'); busy = true;
            try {
                const snapshot = await createPrivateAuthoringSnapshot(project); current();
                check(snapshot.project.projectId === projectId, 'AUTHORING_SCOPE_INVALID');
                const recoveringSameSnapshot = pending?.snapshot.sha256 === snapshot.sha256;
                if (pending) await transmit(true);
                if (recoveringSameSnapshot) return;
                pending = Object.freeze({ snapshot, requestId: newRequestId(), baseRevision: head.revision });
                await transmit(false);
            } catch (error) {
                // Never invent a new base or request id after an ambiguous outcome.
                if ([409, 413, 422].includes(error.status) || /CONFLICT|REJECTED|RECEIPT|SCOPE|GENERATION/.test(error.code || '')) blocked = error;
                throw error;
            } finally { busy = false; }
        },
    });
}

/** Resolve only asset slots; prose and unknown extensions remain byte-for-byte text. */
export async function resolvePrivateAuthoringAssets(project, upload) {
    const result = copy(project), uploaded = new Map();
    async function slot(owner, key) {
        const value = owner[key];
        if (typeof value !== 'string' || !/^blob:/i.test(value)) return;
        if (!uploaded.has(value)) uploaded.set(value, await upload(value));
        const url = uploaded.get(value);
        check(typeof url === 'string' && /^https?:\/\//.test(url), 'AUTHORING_ASSET_UNRESOLVED');
        owner[key] = url;
    }
    async function owner(value) {
        if (!value || typeof value !== 'object') return;
        for (const key of ['background', 'thumbnail', 'publicationThumbnailUrl']) await slot(value, key);
        for (const key of Object.keys(value.backgrounds || {})) await slot(value.backgrounds, key);
        for (const layer of value.layers || []) {
            await owner(layer); if (layer.type === 'image') await slot(layer, 'src');
        }
    }
    await owner(result);
    for (const asset of result.projectAssets || []) await owner(asset);
    for (const block of result.blocks || []) await owner(block.content);
    for (const section of result.sections || []) await owner(section);
    for (const page of result.pages || []) await owner(page);
    return result;
}
