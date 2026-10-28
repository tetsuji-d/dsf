import assert from 'node:assert/strict';
import { createEditionListReader, EDITION_READ_FIELDS } from '../js/edition-list-reader.js';
import { loadEditionList, editionListCounts } from '../js/edition-list.js';
import { encodeFirestoreValue } from '../server/private-authoring/firestore.js';

const uid = 'owner', projectId = 'test-project';
const root = `projects/${projectId}/databases/(default)/documents/`;
const encoded = (path, fields) => ({ document: { name: root + path, fields: encodeFirestoreValue(fields).mapValue.fields } });
const empty = () => Response.json([{ readTime: '2026-10-25T00:00:00Z' }]);
const options = { projectId, uid, getToken: async () => 'test-token', isCurrent: () => true };
const calls = [];
const reader = createEditionListReader({ ...options, pageSize: 1, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    const query = JSON.parse(init.body).structuredQuery;
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.equal(query.from[0].collectionId, 'works');
    assert.ok(!query.select.fields.some(f => ['blocks', 'pages', 'sections', 'flowDocument'].includes(f.fieldPath)));
    return query.startAt ? empty() : Response.json([encoded('users/owner/works/日本語', { projectId: 'p', title: '管理名' })]);
} });
assert.deepEqual(await reader.records(['users', uid, 'works']), [{ id: '日本語', projectId: 'p', title: '管理名' }]);
assert.equal(calls.length, 2, 'full pages are followed; no silently truncated counts');
assert.deepEqual(JSON.parse(calls[1].init.body).structuredQuery.startAt, { values: [{ referenceValue: root + 'users/owner/works/日本語' }], before: false });
await assert.rejects(reader.records(['users', 'other', 'works']), /SCOPE_INVALID/);
await assert.rejects(reader.records(['users', uid, 'projects', 'p', 'secrets']), /SCOPE_INVALID/);

for (const status of [401, 403]) {
    let count = 0;
    const forbidden = createEditionListReader({ ...options, fetchImpl: async () => { count++; return new Response('', { status }); } });
    await assert.rejects(forbidden.records(['users', uid, 'works']), status === 401 ? /AUTH_REQUIRED/ : /READ_FORBIDDEN/);
    assert.equal(count, 1, 'permission failures never retry or become empty success');
}
let attempts = 0;
await createEditionListReader({ ...options, fetchImpl: async () => ++attempts === 1 ? new Response('', { status: 503 }) : empty() }).records(['users', uid, 'works']);
assert.equal(attempts, 2, 'transient server error retries once');
let offlineAttempts = 0;
await assert.rejects(createEditionListReader({ ...options, fetchImpl: async () => { offlineAttempts++; throw new TypeError('Failed to fetch'); } }).records(['users', uid, 'works']), /NETWORK_ERROR/);
assert.equal(offlineAttempts, 2, 'a disconnected network yields an actionable error after one retry');
let stalledSignal, requestCount = 0;
const recovered = createEditionListReader({ ...options, timeoutMs: 15, fetchImpl: async (url, init) => {
    requestCount++;
    if (requestCount > 1) return empty();
    stalledSignal = init.signal;
    return new Promise(() => {});
} });
assert.deepEqual(await recovered.records(['users', uid, 'works']), []);
assert.ok(stalledSignal.aborted, 'timeout aborts the actual request before retry');
let bodyAborted;
const stalledBody = createEditionListReader({ ...options, timeoutMs: 15, fetchImpl: async (url, init) => {
    bodyAborted = init.signal;
    return new Response(new ReadableStream({ start() {} }));
} });
await assert.rejects(stalledBody.records(['users', uid, 'works']), /LOAD_TIMEOUT/);
assert.ok(bodyAborted.aborted, 'response-body timeout also aborts the HTTP request');
const cancellation = new AbortController(); let activeSignal, finishToken;
const token = new Promise(resolve => { finishToken = resolve; }); let tokenFetches = 0;
const cancelled = createEditionListReader({ ...options, signal: cancellation.signal, getToken: () => token,
    fetchImpl: async (url, init) => { tokenFetches++; activeSignal = init.signal; return empty(); } });
const pending = cancelled.records(['users', uid, 'works']);
cancellation.abort(Error('EDITION_LIST_CHANGED'));
await assert.rejects(pending, /LIST_CHANGED/); finishToken('late-token');
await new Promise(resolve => setImmediate(resolve)); assert.equal(tokenFetches, 0, 'late tokens cannot start obsolete requests');
let current = true;
await assert.rejects(createEditionListReader({ ...options, isCurrent: () => current, fetchImpl: async () => { current = false; return empty(); } }).records(['users', uid, 'works']), /SESSION_CHANGED/);
await assert.rejects(createEditionListReader({ ...options, fetchImpl: async () => Response.json([encoded('users/other/works/w', {})]) }).records(['users', uid, 'works']), /SCOPE_INVALID/);
await assert.rejects(createEditionListReader({ ...options, fetchImpl: async () => Response.json([encoded('public_projects/w', { authorUid: 'other' })]) }).publicRecords(), /SCOPE_INVALID/);
await assert.rejects(createEditionListReader({ ...options, fetchImpl: async () => Response.json([{ error: { code: 403 } }]) }).records(['users', uid, 'works']), /RESPONSE_INVALID/);

// Run the actual inventory assembler through the new transport, including old
// URL bindings, immutable snapshot titles, tombstones and REST timestamps.
const date = new Date('2026-10-24T10:00:00Z');
const data = {
    'users/owner/works': [{ id: 'w', projectId: 'p', title: 'Changed management name' }],
    'users/owner/projects': [{ id: 'p', title: 'Changed editable title', dsfSchemaVersion: 2 }],
    'users/owner/works/w/releases': [{ id: 'r1', projectId: 'p', createdAt: date, title: 'First' }, { id: 'r2', projectId: 'p', createdAt: date, title: 'Second' }],
    'users/owner/works/w/edition_states': [{ id: 'r2', editionId: 'e_second', status: 'private', revision: 1, publicSnapshot: { title: 'Sealed second' } },
        { id: 'gone', editionId: 'e_gone', status: 'disposed', cleanupPending: false }, { id: 'cleanup', editionId: 'e_cleanup', status: 'disposed', cleanupPending: true }],
    public_projects: [{ id: 'w', authorUid: uid, workId: 'w', releaseId: 'r1', dsfStatus: 'unlisted' }],
};
const transport = createEditionListReader({ ...options, fetchImpl: async (url, init) => {
    const query = JSON.parse(init.body).structuredQuery, kind = query.from[0].collectionId;
    assert.deepEqual(query.select.fields.map(f => f.fieldPath), EDITION_READ_FIELDS[kind]);
    if (kind === 'public_projects') assert.equal(query.where.fieldFilter.value.stringValue, uid);
    const parent = decodeURIComponent(new URL(url).pathname.split('/documents')[1].replace(':runQuery', '').replace(/^\//, ''));
    const path = (parent ? parent + '/' : '') + kind;
    return Response.json(data[path].map(({ id, ...fields }) => encoded(path + '/' + id, fields)));
} });
const rows = await loadEditionList({ uid, origin: 'https://example.test', ...transport });
assert.deepEqual(editionListCounts(rows), { public: 0, unlisted: 1, private: 1, archived: 1 });
assert.equal(rows.find(r => r.releaseId === 'r2').title, 'Sealed second');
assert.equal(rows.find(r => r.releaseId === 'r2').sort, date.getTime());
assert.match(rows.find(r => r.releaseId === 'r1').shareUrl, /work=w&r=r1/);
console.log('Edition REST reads: projections, pagination, rules/auth boundaries, abort/retry, stalled body/token, timestamps and full inventory passed.');
