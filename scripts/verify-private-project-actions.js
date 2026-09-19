import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { fixture } from './fixtures/private-authoring-api-fixture.js';
import { createReleaseVerifier } from '../server/private-authoring/release-verifier.js';
import { createFirestoreStore } from '../server/private-authoring/firestore.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import { createDsfHorizonReleasePlan, sealDsfHorizonReleasePlan } from '../js/dsf-horizon-release-contract.js';
const root = 'users/owner_1/projects/project_1', control = `${root}/authoringControl/current`, head = `${root}/authoringHeads/current`;
const baseUrl = 'https://media.test', thumb = `${baseUrl}/users/owner_1/dsf/publication-thumbnails/${'a'.repeat(64)}.webp`;
let counter = 0;
async function setup(options) {
    const f = fixture(options); assert.equal((await f.request()).status, 200);
    f.db.docs.get('users/owner_1').status.moderationHold = false;
    return f;
}
function command(f, kind, payload = {}) { return { kind, payload, requestId: `action_${++counter}`, generationId: 'generation_1',
    baseRevision: f.db.docs.get(head).revision, mutationRevision: f.db.docs.get(control).mutationRevision || 0 }; }
async function send(f, command, options = {}) {
    const response = await f.handler({ env: options.env || f.env, params: { projectId: 'project_1', actionRoute: true },
        request: new Request('https://studio.test/api/projects/project_1/actions', { method: 'POST',
            headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(command) }) });
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    return { status: response.status, data: await response.json() };
}
async function ok(f, c) { const r = await send(f, c); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; }
async function denied(f, c, code, status = 409) { const r = await send(f, c); assert.equal(r.status, status, JSON.stringify(r.data)); assert.equal(r.data.error, code); }
const v1 = () => ({ releaseId: 'release_new', thumbnail: thumb, dsfLangs: ['ja'], dsfPages: [{ pageNum: 1, pageType: 'normal_image', workId: 'work_1', releaseId: 'release_new', urls: { ja: `${baseUrl}/users/owner_1/dsf/work_1/release_new/ja/page_001.webp` }, bytesByLang: { ja: 100 }, totalBytes: 100 }], bookConfig: { bookMode: 'simple', book: { mode: 'simple', covers: {} } } });
const publish = (f, status = 'public') => command(f, 'publication', { status, expectedStatus: f.db.docs.get(root).dsfStatus, expectedReleaseId: f.db.docs.get(root).releaseId });
await test('v1 draft, publication, profile, listing and deletion are atomic and manuscript-free', async () => {
    const f = await setup();
    await ok(f, command(f, 'draft', v1()));
    assert.equal(f.db.docs.get(root).dsfStatus, 'draft');
    assert.equal(f.db.docs.get('users/owner_1/works/work_1/releases/release_new').dsfTotalBytes, 100);
    await ok(f, publish(f)); assert.equal(f.db.docs.get('public_projects/work_1').dsfStatus, 'public');
    f.db.docs.get('users/owner_1').publicProfile = { displayName: 'Updated', bio: 'Author bio' };
    await ok(f, command(f, 'profile', { displayName: 'Forged' })); assert.equal(f.db.docs.get('public_projects/work_1').authorName, 'Updated');
    await ok(f, command(f, 'listing', { projectBytes: 1000, pageCount: 1, listThumbnail: thumb }));
    assert.equal(f.db.docs.get('users/owner_1/project_summaries/project_1').projectBytes, 1000);
    await ok(f, publish(f, 'private')); assert(!f.db.docs.has('public_projects/work_1'));
    await ok(f, publish(f));
    for (const [path, value] of f.db.docs) if (!path.includes('/authoring')) assert(!JSON.stringify(value).includes('PRIVATE_MANUSCRIPT_SENTINEL'), path);
    const deletion = command(f, 'delete'); await ok(f, deletion); await ok(f, deletion);
    assert(!f.db.docs.has(root)); assert(!f.db.docs.has('public_projects/work_1')); assert(!f.db.docs.has('users/owner_1/project_summaries/project_1'));
    assert.equal(f.db.docs.get(control).status, 'deleted'); assert.equal(f.r2.objects.size, 1);
    assert.equal((await f.request('PUT', { id: 'resurrect', base: 1 })).status, 404);
});
await test('idempotency never returns a stale state after another metadata/body write or generation change', async () => {
    const f = await setup(), a = command(f, 'listing', { projectBytes: 1000, pageCount: 1, listThumbnail: '' });
    await ok(f, a); await ok(f, a);
    await denied(f, { ...a, payload: { ...a.payload, pageCount: 2 } }, 'AUTHORING_REQUEST_REUSED');
    await ok(f, command(f, 'profile')); await denied(f, a, 'AUTHORING_REVISION_CONFLICT');
    const b = command(f, 'profile'); await ok(f, b);
    await f.request('PUT', { id: 'next', base: 1, project: { ...f.project, title: 'new' } });
    await denied(f, b, 'AUTHORING_REVISION_CONFLICT');
    f.db.docs.get(control).generationId = 'generation_2'; await denied(f, b, 'AUTHORING_GENERATION_CONFLICT');
});
await test('restore appends a revision and recovers from a lost save response without duplicating objects', async () => {
    const f = await setup(); await f.request('PUT', { id: 'second', base: 1, project: { ...f.project, title: 'Changed' } });
    const c = command(f, 'restore', { revisionId: 'request_1' });
    f.db.loseFinalReply = true; await denied(f, c, 'UPSTREAM_UNAVAILABLE', 503);
    const r = await ok(f, c); assert.equal(r.committedHead.revision, 3); await ok(f, c);
    assert.equal(f.r2.puts, 3); assert.equal(f.db.docs.get(root).title, '小説');
    assert.equal(f.db.docs.get(control).previousHead.revision, 2);
    const loaded = await (await f.request('GET')).json(); assert.equal(loaded.futurePrivate.text, 'PRIVATE_MANUSCRIPT_SENTINEL');
    await denied(f, command(f, 'restore', { revisionId: 'request_1' }), 'RESTORE_REVISION_UNAVAILABLE');
});
await test('deleted project, stale draft, moderation change and revoked login cannot finish a draft', async () => {
    for (const change of ['save', 'delete', 'moderation', 'revoke']) {
        let f; f = await setup({ verifyRelease: async () => {
            if (change === 'save') await f.request('PUT', { id: 'race', base: 1, project: { ...f.project, title: 'Race' } });
            if (change === 'delete') await ok(f, command(f, 'delete'));
            if (change === 'moderation') f.db.docs.get('users/owner_1').status.moderationHold = true;
            if (change === 'revoke') f.revoke();
            return 100;
        } });
        const r = await send(f, command(f, 'draft', v1())); assert.notEqual(r.status, 200, change);
        assert(!f.db.docs.has('users/owner_1/works/work_1/releases/release_new'));
    }
});
await test('publication rejects foreign index, stale release and forbidden metadata inputs', async () => {
    const f = await setup(); await ok(f, command(f, 'draft', v1()));
    const c = publish(f); await denied(f, { ...c, payload: { ...c.payload, expectedReleaseId: 'other' } }, 'PUBLICATION_STATE_CONFLICT');
    f.db.docs.set('public_projects/work_1', { authorUid: 'other' });
    await denied(f, c, 'PUBLIC_INDEX_OWNER_CONFLICT'); f.db.docs.delete('public_projects/work_1');
    await denied(f, { ...c, payload: { ...c.payload, publicFrom: 'not a date' } }, 'PUBLICATION_WINDOW_INVALID', 422);
    const bad = v1(); bad.dsfPages[0].blocks = ['private']; await denied(f, command(f, 'draft', bad), 'RELEASE_PAGES_INVALID', 422);
    await denied(f, command(f, 'listing', { projectBytes: 1, pageCount: 1, listThumbnail: '' }), 'LISTING_INVALID', 422);
    const unauth = await send(f, c, { headers: { Authorization: '' } }); assert.equal(unauth.status, 401);
    const origin = await send(f, c, { headers: { Origin: 'https://other.test' } }); assert.equal(origin.status, 403);
});
function publicBucket() {
    const objects = new Map();
    return { objects, head: async key => objects.get(key) || null,
        get: async key => { const o = objects.get(key); return o ? { ...o, body: new Response(o.bytes).body } : null; } };
}
function addThumbnail(bucket) { bucket.objects.set(new URL(thumb).pathname.slice(1), { size: 10, httpMetadata: { contentType: 'image/webp' } }); }
await test('public R2 verification requires managed thumbnail and real owner-scoped image objects', async () => {
    const b = publicBucket(); addThumbnail(b); const p = v1(), input = { uid: 'owner_1', workId: 'work_1', releaseId: 'release_new', payload: p, metadata: {} };
    const verify = createReleaseVerifier(b, baseUrl);
    await assert.rejects(verify(input), e => e.code === 'RELEASE_ASSET_MISSING');
    b.objects.set(new URL(p.dsfPages[0].urls.ja).pathname.slice(1), { size: 123, httpMetadata: { contentType: 'image/webp' } });
    assert.equal(await verify(input), 123);
    p.dsfPages[0].urls.ja = p.dsfPages[0].urls.ja.replace('owner_1', 'other');
    await assert.rejects(verify(input), e => e.code === 'RELEASE_ASSET_SCOPE');
});
await test('v2 draft verifies actual content/manifest hashes, exact receipt set and publication', async () => {
    const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
    const block = { id: 'cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
    const image = new Uint8Array([1, 2, 3]);
    const assembly = await assembleDsfV2Release({ defaultLang: 'ja', hashBytes, languages: [{ language: 'ja', pageDirection: 'rtl',
        preflight: createDsfPressPreflight({ blocks: [block], language: 'ja' }), imageAssets: { cover: { pageId: 'cover-ja', pageLabel: '1', sha256: hashBytes(image), byteLength: 3, width: 360, height: 640, mimeType: 'image/webp' } } }] });
    const plan = await createDsfHorizonReleasePlan({ assembly, uid: 'owner_1', workId: 'work_1', releaseId: 'release_v2', publicBaseUrl: baseUrl, hashBytes });
    const receipts = plan.files.map(({ storagePath, publicUrl, mimeType, byteLength, sha256, cacheControl }) => ({ storagePath, publicUrl, mimeType, byteLength, sha256, cacheControl }));
    const upload = { executionVersion: 1, executionKind: 'flow-press-horizon-upload-execution', readyForMetadataWrite: true, identity: plan.identity, receipts, seal: sealDsfHorizonReleasePlan({ plan, receipts }), summary: plan.summary };
    const bucket = publicBucket(); addThumbnail(bucket);
    for (const file of plan.files) bucket.objects.set(file.storagePath, { bytes: file.json ? new TextEncoder().encode(file.json) : image,
        size: file.byteLength, httpMetadata: { contentType: file.mimeType }, customMetadata: { dsfSha256: file.sha256, dsfSchemaVersion: '2' } });
    const verifyRelease = createReleaseVerifier(bucket, baseUrl), f = await setup({ verifyRelease });
    const payload = { upload, thumbnail: thumb, bookConfig: { bookMode: 'simple', book: { mode: 'simple', covers: {} } } };
    await ok(f, command(f, 'draft', payload)); await ok(f, publish(f));
    assert.equal(f.db.docs.get('public_projects/work_1').dsfSchemaVersion, 2);
    assert.deepEqual(f.db.docs.get('public_projects/work_1').dsfPages, []);
    const object = bucket.objects.get(plan.files[0].storagePath); object.bytes = new TextEncoder().encode('{}');
    await assert.rejects(verifyRelease({ ...plan.identity, payload, metadata: upload.seal.releaseMetadata }));
    object.bytes = new TextEncoder().encode(plan.files[0].json);
    const altered = structuredClone(payload); altered.upload.receipts[0].sha256 = 'f'.repeat(64);
    await assert.rejects(verifyRelease({ ...plan.identity, payload: altered, metadata: upload.seal.releaseMetadata }), e => e.code === 'RELEASE_RECEIPT_MISMATCH');
});
await test('REST transaction supports public index deletion with exists precondition and rejects unrelated paths', async () => {
    const calls = []; const store = createFirestoreStore({ projectId: 'demo-test', post: async (url, body) => {
        calls.push({ url, body });
        if (url.endsWith(':beginTransaction')) return { transaction: 'tx' };
        if (url.endsWith(':batchGet')) return body.documents.map(name => ({ found: { name, fields: {} } }));
        return {};
    } });
    await store.transaction(async tx => { await tx.getMany(['public_projects/work_1']); tx.delete('public_projects/work_1'); });
    assert.deepEqual(calls.find(c => c.url.endsWith(':commit')).body.writes, [{ delete: 'projects/demo-test/databases/(default)/documents/public_projects/work_1', currentDocument: { exists: true } }]);
    await assert.rejects(store.transaction(tx => tx.getMany(['billing_events/private'])), e => e.code === 'INVALID_DOCUMENT_PATH');
});
