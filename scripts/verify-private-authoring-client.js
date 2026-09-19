import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixtures/private-authoring-api-fixture.js';
import { createPrivateAuthoringClient, resolvePrivateAuthoringAssets, usesPrivateAuthoring } from '../js/private-authoring-client.js';
const code = expected => error => error.code === expected;
const root = 'users/owner_1/projects/project_1';
async function setup() {
    const f = fixture(); assert.equal((await f.request()).status, 200);
    let active = true, serial = 0, intercept = null;
    const requests = [];
    const fetcher = async (url, options) => {
        requests.push({ url, ...options });
        const run = () => f.handler({ request: new Request(`https://studio.test${url}`, options), env: f.env,
            params: { projectId: 'project_1', ...(url.includes('/operations/') ? { requestId: url.split('/').at(-1) } : {}) } });
        return intercept ? intercept(url, options, run) : run();
    };
    const makeClient = () => createPrivateAuthoringClient({ uid: 'owner_1', projectId: 'project_1',
        user: { uid: 'owner_1', getIdToken: async () => 'valid' }, isCurrent: () => active,
        fetcher, newRequestId: () => `client_${++serial}` });
    const client = makeClient(), project = structuredClone(await client.load());
    return { f, client, project, requests, makeClient, close: () => { active = false; }, intercept: value => { intercept = value; } };
}
await test('client loads verified bytes and saves through the actual API; unchanged still checks CAS', async () => {
    const t = await setup(); t.project.title = '日本語😀'; await t.client.save(t.project);
    assert.equal(t.f.db.docs.get(`${root}/authoringHeads/current`).revision, 2);
    assert.equal(t.f.db.docs.get(root).title, '日本語😀');
    await t.client.save(t.project);
    assert.equal(t.requests.filter(r => r.method === 'PUT').length, 2);
    assert(t.requests.every(r => r.cache === 'no-store' && r.redirect === 'error' && r.credentials === 'omit'));
});
await test('lost successful PUT response resolves via ledger without duplicate upload', async () => {
    const t = await setup(); let lost = false;
    t.intercept(async (url, options, run) => { const response = await run(); if (options.method === 'PUT' && !lost) { lost = true; throw new TypeError('offline'); } return response; });
    t.project.title = '保存した本文'; await assert.rejects(t.client.save(t.project));
    const puts = t.f.r2.puts;
    await t.client.save(t.project);
    assert.equal(t.f.r2.puts, puts); assert(t.requests.some(r => r.url.includes('/operations/')));
});
await test('pending failure reuses exact body/id/base; later edits save only after recovery', async () => {
    const t = await setup(); t.f.r2.failPut = true;
    t.project.title = '旧'; await assert.rejects(t.client.save(t.project));
    const first = t.requests.find(r => r.method === 'PUT');
    t.f.r2.failPut = false; t.project.title = '新'; await t.client.save(t.project);
    const puts = t.requests.filter(r => r.method === 'PUT');
    assert.equal(puts[1].body, first.body); assert.deepEqual(puts[1].headers, first.headers);
    assert.equal(puts[2].headers['X-Authoring-Base-Revision'], '2');
    assert.equal(t.f.db.docs.get(root).title, '新');
});
await test('two editor sessions conflict; repeated save cannot advance the stale base', async () => {
    const t = await setup(), other = t.makeClient(); const data = structuredClone(await other.load());
    data.title = 'other'; await other.save(data); t.project.title = 'mine';
    await assert.rejects(t.client.save(t.project), code('AUTHORING_REVISION_CONFLICT'));
    const count = t.requests.length;
    await assert.rejects(t.client.save(t.project), code('AUTHORING_REVISION_CONFLICT'));
    assert.equal(t.requests.length, count); assert.equal(t.f.db.docs.get(root).title, 'other');
});
await test('old committed receipt after another writer never adopts latest revision', async () => {
    const t = await setup(); let lost = false;
    t.intercept(async (url, options, run) => { const response = await run(); if (options.method === 'PUT' && !lost) { lost = true; throw Error('lost'); } return response; });
    t.project.title = 'mine'; await assert.rejects(t.client.save(t.project));
    await t.f.request('PUT', { base: 2, id: 'other', project: { ...t.f.project, title: 'other' } });
    await assert.rejects(t.client.save(t.project), code('AUTHORING_REVISION_CONFLICT'));
    assert.equal(t.f.db.docs.get(root).title, 'other');
});
await test('missing operation retries same request; expired operation stops without a new ID', async () => {
    const t = await setup(); t.project.title = 'new';
    t.intercept(async (url, options, run) => { if (options.method === 'PUT') throw Error('offline'); return run(); });
    await assert.rejects(t.client.save(t.project));
    t.intercept(null); await t.client.save(t.project);
    assert.equal(t.requests.filter(r => r.method === 'PUT')[0].headers['X-Authoring-Request-Id'],
        t.requests.filter(r => r.method === 'PUT')[1].headers['X-Authoring-Request-Id']);
    t.f.r2.failPut = true; t.project.title = 'expired'; await assert.rejects(t.client.save(t.project));
    t.f.advance(120_001); t.f.r2.failPut = false;
    await assert.rejects(t.client.save(t.project), code('AUTHORING_REJECTED'));
});
await test('logout/navigation discards response and further saves without network', async () => {
    const t = await setup(); t.project.title = 'x';
    t.intercept(async (url, options, run) => { const response = await run(); t.close(); return response; });
    await assert.rejects(t.client.save(t.project), code('AUTHORING_SESSION_CHANGED'));
    const count = t.requests.length; await assert.rejects(t.client.save(t.project), code('AUTHORING_SESSION_CHANGED'));
    assert.equal(t.requests.length, count);
});
await test('corrupt response cannot load; save without verified cloud load cannot run', async () => {
    const t = await setup(); t.intercept(async (url, options, run) => {
        const response = await run(); return new Response('{}', { headers: response.headers });
    });
    const client = t.makeClient(); await assert.rejects(client.load(), code('AUTHORING_SIZE_MISMATCH'));
    await assert.rejects(client.save(t.project), code('AUTHORING_RELOAD_REQUIRED'));
});
await test('revocation and disabled API remain errors, never fall back to Firestore', async () => {
    const t = await setup(); t.f.revoke(); t.project.title = 'blocked';
    await assert.rejects(t.client.save(t.project), code('AUTH_REVOKED'));
    t.f.env.AUTHORING_API_ENABLED = 'false'; await assert.rejects(t.client.save(t.project), code('AUTHORING_API_DISABLED'));
    assert.equal(t.f.db.docs.get(`${root}/authoringHeads/current`).revision, 1);
});
await test('asset resolution preserves prose/local source, deduplicates blobs and rejects missing images', async () => {
    const p = { title: 'blob: prose', projectAssets: [{ background: 'blob:a', thumbnail: 'blob:a' }], blocks: [{ content: { background: 'blob:a', layers: [{ type: 'image', src: 'blob:a' }] } }], sections: [{ thumbnail: 'blob:b' }] };
    const calls = []; const result = await resolvePrivateAuthoringAssets(p, async url => { calls.push(url); return 'https://assets.test/a.webp'; });
    assert.equal(result.title, p.title); assert.equal(p.blocks[0].content.background, 'blob:a');
    assert.equal(result.projectAssets[0].background, 'https://assets.test/a.webp');
    assert.deepEqual(calls, ['blob:a', 'blob:b']); assert.equal(result.blocks[0].content.layers[0].src, 'https://assets.test/a.webp');
    await assert.rejects(resolvePrivateAuthoringAssets(p, async () => ''), code('AUTHORING_ASSET_UNRESOLVED'));
    assert(usesPrivateAuthoring({ authoringBackend: 'unknown' })); assert(!usesPrivateAuthoring({ authoringRef: 'authoring/current' }));
});

await test('a forged receipt never advances the base or silently starts a new request', async () => {
    const t = await setup(); t.project.title = 'changed';
    t.intercept(async (url, options, run) => {
        const response = await run(); if (options.method !== 'PUT') return response;
        const receipt = await response.json(); receipt.committedHead.sha256 = '0'.repeat(64);
        return Response.json(receipt);
    });
    await assert.rejects(t.client.save(t.project), code('AUTHORING_RECEIPT_INVALID'));
    const count = t.requests.length;
    await assert.rejects(t.client.save({ ...t.project, title: 'next' }), code('AUTHORING_RECEIPT_INVALID'));
    assert.equal(t.requests.length, count);
});
await test('logout while fetching a token cannot send an authenticated request', async () => {
    let active = true, calls = 0;
    const client = createPrivateAuthoringClient({ uid: 'owner_1', projectId: 'project_1', isCurrent: () => active,
        user: { uid: 'owner_1', getIdToken: async () => { active = false; return 'valid'; } },
        fetcher: async () => { calls++; throw Error('must not call'); } });
    await assert.rejects(client.load(), code('AUTHORING_SESSION_CHANGED')); assert.equal(calls, 0);
});
