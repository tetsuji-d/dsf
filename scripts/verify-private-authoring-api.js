import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { AuthoringApiError } from '../server/private-authoring/common.js';
import { createAuthoringApi, handlePrivateAuthoring } from '../server/private-authoring/http.js';
import { createAuthoringService, AUTHORING_LEASE_MS, AUTHORING_LIMITS } from '../server/private-authoring/service.js';
import { createAuthoringBucket } from '../server/private-authoring/r2.js';
import { createIdTokenVerifier, createGoogleClient } from '../server/private-authoring/google-auth.js';
import { createFirestoreStore, encodeFirestoreValue, decodeFirestoreValue } from '../server/private-authoring/firestore.js';
import { PRIVATE_AUTHORING_MAX_BYTES } from '../js/private-authoring-storage.js';
import { onRequest as authoringRoute } from '../functions/api/projects/[projectId]/authoring.js';
import { onRequest as operationRoute } from '../functions/api/projects/[projectId]/authoring/operations/[requestId].js';

const clone = structuredClone;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = expected => error => error.code === expected;
const rootPath = 'users/owner_1/projects/project_1';
const headPath = `${rootPath}/authoringHeads/current`;
const controlPath = `${rootPath}/authoringControl/current`;
const usagePath = 'users/owner_1/authoringUsage/current';
const opPath = id => `${rootPath}/authoringRevisions/${id}`;

import { fixture } from './fixtures/private-authoring-api-fixture.js';
async function responseError(response, status, error) {
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await response.json()).error, error);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
}

await test('routes are disabled by default and do not require secrets or touch storage', async () => {
    assert.equal(authoringRoute, handlePrivateAuthoring);
    assert.equal(operationRoute, handlePrivateAuthoring);
    await responseError(await authoringRoute({ env: {}, request: new Request('https://studio.test/api/projects/p/authoring') }), 503, 'AUTHORING_API_DISABLED');
});
await test('authenticated save/load commits head, root, summary, Work and receipt atomically', async () => {
    const f = fixture();
    const saved = await f.request();
    assert.equal(saved.status, 200, await saved.clone().text());
    const receipt = await saved.json();
    assert.equal(receipt.committedHead.revision, 1);
    assert.equal(f.db.docs.get(controlPath).initialized, true);
    assert.equal(f.db.docs.get(rootPath).title, '小説');
    assert.equal(f.db.docs.get(rootPath).projectBytes, 5000000, 'retain Studio total including images');
    assert.equal(f.db.docs.get(rootPath).releaseId, 'published_release');
    assert.equal(f.db.docs.get(rootPath).dsfStatus, 'public');
    assert.equal(f.db.docs.get('users/owner_1/works/work_1').latestReleaseId, 'published_release');
    assert.equal(f.db.docs.get('users/owner_1/works/work_1').title, '小説');
    assert.equal(f.db.docs.get('users/owner_1/project_summaries/project_1').title, '小説');
    assert(!JSON.stringify(f.db.docs.get(rootPath)).includes('PRIVATE_MANUSCRIPT_SENTINEL'));
    assert(!JSON.stringify(f.db.docs.get('users/owner_1/project_summaries/project_1')).includes('PRIVATE_MANUSCRIPT_SENTINEL'));
    const loaded = await f.request('GET');
    assert.equal(loaded.status, 200);
    const head = JSON.parse(loaded.headers.get('X-Authoring-Head'));
    const bytes = new Uint8Array(await loaded.arrayBuffer());
    assert.equal(hash(bytes), head.sha256);
    assert.equal(bytes.length, head.byteLength);
    assert.equal(JSON.parse(new TextDecoder().decode(bytes)).futurePrivate.text, 'PRIVATE_MANUSCRIPT_SENTINEL');
    assert.match(loaded.headers.get('Cache-Control'), /no-store/);
});
await test('unauthenticated, cross-origin and non-enabled project requests make no storage calls', async () => {
    const f = fixture();
    await responseError(await f.request('PUT', { headers: { Authorization: '' } }), 401, 'AUTH_REQUIRED');
    await responseError(await f.request('PUT', { headers: { Authorization: 'Bearer invalid' } }), 401, 'AUTH_INVALID');
    await responseError(await f.request('PUT', { headers: { Origin: 'https://attacker.test' } }), 403, 'ORIGIN_FORBIDDEN');
    await responseError(await f.request('PUT', { env: { ...f.env, AUTHORING_TEST_PROJECTS: '["other/project_1"]' } }), 403, 'PROJECT_NOT_ENABLED');
    assert.equal(f.db.calls, 0); assert.equal(f.r2.puts, 0);
});
await test('owner, migration marker, account and generation are required; moderationHold still permits editing', async () => {
    for (const [mutate, status, error] of [
        [f => { f.db.docs.get(rootPath).ownerUid = 'other'; }, 404, 'PROJECT_NOT_FOUND'],
        [f => { f.db.docs.get(rootPath).authoringBackend = 'firestore'; }, 409, 'PROJECT_NOT_MIGRATED'],
        [f => { f.db.docs.get('users/owner_1').status.disabled = true; }, 403, 'ACCOUNT_NOT_EDITABLE'],
        [f => { f.db.docs.get(controlPath).generationId = 'new'; }, 409, 'AUTHORING_GENERATION_CONFLICT'],
        [f => { f.db.docs.get(controlPath).initialized = true; }, 503, 'AUTHORING_HEAD_MISSING'],
    ]) {
        const f = fixture(); mutate(f);
        await responseError(await f.request(), status, error);
        assert.equal(f.r2.puts, 0);
    }
});
await test('same request is idempotent; stale receipts report latest head without rolling it back', async () => {
    const f = fixture();
    assert.equal((await f.request()).status, 200);
    assert.equal((await f.request()).status, 200);
    assert.equal(f.r2.puts, 1);
    assert.equal((await f.request('PUT', { id: 'request_2', base: 1, project: { ...f.project, title: 'Second' } })).status, 200);
    const replay = await (await f.request()).json();
    assert.equal(replay.committedHead.revision, 1); assert.equal(replay.currentHead.revision, 2);
    const operation = await (await f.request('GET', { operation: 'request_1' })).json();
    assert.equal(operation.committedHead.revision, 1); assert.equal(operation.currentHead.revision, 2);
    assert.equal(f.db.docs.get(headPath).revision, 2);
    await responseError(await f.request('PUT', { project: { ...f.project, title: 'Collision' } }), 409, 'AUTHORING_REQUEST_REUSED');
    assert.equal(f.r2.puts, 2);
});
await test('unchanged content creates a durable request receipt, without R2 write or new revision', async () => {
    const f = fixture(); await f.request();
    const same = await (await f.request('PUT', { id: 'same', base: 1 })).json();
    assert.equal(same.result, 'unchanged'); assert.equal(same.currentHead.revision, 1); assert.equal(f.r2.puts, 1);
    const retry = await (await f.request('PUT', { id: 'same', base: 1 })).json();
    assert.equal(retry.committedHead.revision, 1);
    await responseError(await f.request('PUT', { id: 'stale', base: 0 }), 409, 'AUTHORING_REVISION_CONFLICT');
});
await test('two simultaneous different saves from one base can commit only one head', async () => {
    const f = fixture();
    let count = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    f.r2.afterPut = async () => { if (++count === 2) release(); await gate; };
    const results = await Promise.all([f.request(), f.request('PUT', { id: 'rival', project: { ...f.project, title: 'Rival' } })]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    assert.equal(f.db.docs.get(headPath).revision, 1);
    assert.deepEqual([f.db.docs.get(opPath('request_1')).state, f.db.docs.get(opPath('rival')).state].sort(), ['committed', 'rejected']);
});
await test('two simultaneous retries of one request share one immutable object and one revision', async () => {
    const f = fixture();
    let count = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    f.r2.afterPut = async () => { if (++count === 2) release(); await gate; };
    const responses = await Promise.all([f.request(), f.request()]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(f.r2.objects.size, 1); assert.equal(f.db.docs.get(headPath).revision, 1);
});
await test('R2 failure and final transaction failure preserve previous cloud source; pending retry recovers', async () => {
    const f = fixture();
    f.r2.failPut = true;
    await responseError(await f.request(), 503, 'R2_UNAVAILABLE');
    assert.equal(f.db.docs.has(headPath), false);
    assert.equal(f.db.docs.get(rootPath).title, 'Before');
    f.r2.failPut = false; f.db.failFinal = true;
    await responseError(await f.request(), 503, 'UPSTREAM_UNAVAILABLE');
    assert.equal(f.r2.objects.size, 1); assert.equal(f.db.docs.has(headPath), false);
    assert.equal(f.db.docs.get(opPath('request_1')).state, 'pending');
    f.db.failFinal = false;
    assert.equal((await f.request()).status, 200);
    assert.equal(f.db.docs.get(headPath).revision, 1); assert.equal(f.r2.objects.size, 1);
});
await test('lost commit response is resolved through operation lookup and replay', async () => {
    const f = fixture(); f.db.loseFinalReply = true;
    await responseError(await f.request(), 503, 'UPSTREAM_UNAVAILABLE');
    assert.equal(f.db.docs.get(headPath).revision, 1);
    const receipt = await (await f.request('GET', { operation: 'request_1' })).json();
    assert.equal(receipt.state, 'committed');
    assert.equal((await f.request()).status, 200); assert.equal(f.r2.puts, 1);
});
await test('expired pending requests never extend their lease or resurrect', async () => {
    const f = fixture(); f.r2.failPut = true; await f.request();
    const lease = f.db.docs.get(opPath('request_1')).leaseExpiresAtMs;
    f.advance(AUTHORING_LEASE_MS + 1); f.r2.failPut = false;
    const pending = await (await f.request('GET', { operation: 'request_1' })).json();
    assert.equal(pending.state, 'expired');
    await responseError(await f.request(), 409, 'AUTHORING_LEASE_EXPIRED');
    assert.equal(f.db.docs.get(opPath('request_1')).leaseExpiresAtMs, lease);
    assert.equal(f.r2.puts, 1); assert.equal(f.db.docs.has(headPath), false);
});
await test('deletion, generation change, suspension or token revocation during R2 I/O prevents commit', async () => {
    for (const [change, status, error] of [
        [f => { f.db.docs.get(controlPath).status = 'deleting'; }, 409, 'AUTHORING_NOT_ACTIVE'],
        [f => { f.db.docs.delete(rootPath); }, 404, 'PROJECT_NOT_FOUND'],
        [f => { f.db.docs.get(controlPath).generationId = 'new_generation'; }, 409, 'AUTHORING_GENERATION_CONFLICT'],
        [f => { f.db.docs.get('users/owner_1').status.disabled = true; }, 403, 'ACCOUNT_NOT_EDITABLE'],
        [f => f.revoke(), 401, 'AUTH_REVOKED'],
    ]) {
        const f = fixture(); f.r2.afterPut = async () => change(f);
        await responseError(await f.request(), status, error);
        assert.equal(f.db.docs.has(headPath), false);
    }
});
await test('missing/corrupt R2 data and immutable collisions fail closed without an empty fallback', async () => {
    const f = fixture(); await f.request();
    const key = f.db.docs.get(headPath).objectKey;
    const saved = clone(f.r2.objects.get(key));
    f.r2.objects.delete(key);
    await responseError(await f.request('GET'), 502, 'AUTHORING_OBJECT_MISSING');
    f.r2.objects.set(key, saved); f.r2.objects.get(key).bytes[0] ^= 1;
    await responseError(await f.request('GET'), 502, 'AUTHORING_OBJECT_CORRUPT');
    const pending = fixture(); pending.db.failFinal = true; await pending.request(); pending.db.failFinal = false;
    pending.r2.objects.values().next().value.bytes[0] ^= 1;
    await responseError(await pending.request(), 409, 'IMMUTABLE_COLLISION');
    assert.equal(pending.db.docs.has(headPath), false);
});
await test('revocation and source changes during a read never release a stale response', async () => {
    const f = fixture(); await f.request();
    f.r2.afterGet = async () => { f.db.docs.get('users/owner_1').status.disabled = true; };
    await responseError(await f.request('GET'), 403, 'ACCOUNT_NOT_EDITABLE');
    const changed = fixture(); await changed.request();
    changed.r2.afterGet = async () => { changed.db.docs.get(headPath).revision += 1; };
    await responseError(await changed.request('GET'), 409, 'AUTHORING_REVISION_CONFLICT');
});
await test('bounded raw body, schema, metadata, asset and identity validation precede R2 I/O', async () => {
    for (const [options, status, error] of [
        [{ raw: '{' }, 400, 'INVALID_JSON'],
        [{ raw: 'x'.repeat(PRIVATE_AUTHORING_MAX_BYTES + 1) }, 413, 'BODY_TOO_LARGE'],
        [{ headers: { 'Content-Type': 'text/plain' } }, 415, 'CONTENT_TYPE_INVALID'],
        [{ headers: { 'Content-Encoding': 'gzip' } }, 415, 'CONTENT_ENCODING_INVALID'],
        [{ headers: { 'Content-Length': '1' } }, 400, 'BODY_LENGTH_MISMATCH'],
        [{ headers: { 'X-Authoring-Base-Revision': '-1' } }, 400, 'INVALID_BASE_REVISION'],
        [{ headers: { 'X-Authoring-Request-Id': '../other' } }, 400, 'INVALID_ID'],
    ]) {
        const f = fixture(); await responseError(await f.request('PUT', options), status, error); assert.equal(f.r2.puts, 0);
    }
    for (const [change, error] of [
        [{ version: 7 }, 'UNSUPPORTED_AUTHORING_PROJECT'], [{ projectId: 'other' }, 'AUTHORING_SCOPE_MISMATCH'],
        [{ title: 'x'.repeat(513) }, 'METADATA_INVALID'], [{ workId: 'other' }, 'WORK_ID_CONFLICT'],
        [{ publicationThumbnailUrl: 'blob:local-only' }, 'ASSETS_NOT_RESOLVED'],
    ]) {
        const f = fixture(); const response = await f.request('PUT', { project: { ...f.project, ...change } });
        assert([409, 422].includes(response.status)); assert.equal((await response.json()).error, error); assert.equal(f.r2.puts, 0);
    }
    const f = fixture();
    assert.equal((await f.request('PUT', { project: { ...f.project, title: 'blob: is a word', uid: 'other', releaseId: 'attacker_release' } })).status, 200);
    assert(f.r2.objects.keys().next().value.startsWith('users/owner_1/'));
    assert.equal(f.db.docs.get(rootPath).releaseId, 'published_release');
});
await test('per-UID request/upload/reservation quotas reject before R2 writes', async () => {
    const f = fixture(); await f.request();
    const usage = f.db.docs.get(usagePath);
    usage.writeCount = AUTHORING_LIMITS.writesPerMinute;
    await responseError(await f.request(), 429, 'RATE_LIMITED');
    f.advance(60_000);
    usage.uploadedBytes = AUTHORING_LIMITS.uploadBytesPerDay;
    await responseError(await f.request('PUT', { id: 'more', base: 1, project: { ...f.project, title: 'more' } }), 429, 'UPLOAD_QUOTA_EXCEEDED');
    const current = f.db.docs.get(usagePath); current.uploadedBytes = 0; current.reservedBytes = AUTHORING_LIMITS.reservedBytes;
    await responseError(await f.request('PUT', { id: 'more', base: 1, project: { ...f.project, title: 'more' } }), 429, 'STORAGE_QUOTA_EXCEEDED');
    assert.equal(f.r2.puts, 1);
});

const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', rsa.publicKey)), kid: 'test_key', alg: 'RS256', use: 'sig' };
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const authTime = 1_800_000_000;
const baseClaims = { aud: 'dsf-test', iss: 'https://securetoken.google.com/dsf-test', sub: 'owner_1', exp: authTime + 3600, iat: authTime - 1, auth_time: authTime - 10 };
async function jwt(claims = baseClaims, header = { alg: 'RS256', kid: 'test_key' }) {
    const unsigned = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
    return `${unsigned}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, new TextEncoder().encode(unsigned)))}`;
}
await test('real RS256 signatures and every required Firebase claim are verified, keys cache with provider max-age', async () => {
    let calls = 0, time = authTime * 1000;
    const verify = createIdTokenVerifier({ projectId: 'dsf-test', now: () => time, fetcher: async url => {
        assert.equal(url, 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
        calls += 1; return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    } });
    const token = await jwt();
    assert.equal((await verify(token)).uid, 'owner_1');
    await verify(token); assert.equal(calls, 1);
    time += 61_000; await verify(token); assert.equal(calls, 2);
    for (const key of ['exp', 'iat', 'auth_time', 'aud', 'iss', 'sub']) {
        const claims = { ...baseClaims }; delete claims[key];
        await assert.rejects(verify(await jwt(claims)), matches('AUTH_INVALID'));
    }
    for (const changes of [{ aud: 'other' }, { iss: 'https://attacker.test' }, { sub: '../other' }, { sub: '' },
        { exp: authTime }, { exp: String(authTime + 3600) }, { iat: authTime + 1000 },
        { auth_time: authTime + 1000 }, { auth_time: baseClaims.iat + 1 }, { firebase: { tenant: 'other' } }]) {
        await assert.rejects(verify(await jwt({ ...baseClaims, ...changes })), matches('AUTH_INVALID'));
    }
    for (const header of [{ alg: 'none', kid: 'test_key' }, { alg: 'HS256', kid: 'test_key' },
        { alg: 'RS256', kid: 'unknown' }, { alg: 'RS256', kid: 'test_key', jku: 'https://attacker.test/key' },
        { alg: 'RS256', kid: 'test_key', crit: ['custom'] }]) {
        await assert.rejects(verify(await jwt(baseClaims, header)), matches('AUTH_INVALID'));
    }
    const parts = token.split('.');
    parts[1] = b64(JSON.stringify({ ...baseClaims, sub: 'other' }));
    await assert.rejects(verify(parts.join('.')), matches('AUTH_INVALID'));
    await assert.rejects(verify('malformed'), matches('AUTH_INVALID'));
});
await test('OAuth assertion uses real service-account signature; disabled/revoked identities fail fresh lookup', async () => {
    const privateBytes = await crypto.subtle.exportKey('pkcs8', rsa.privateKey);
    const secret = JSON.stringify({ type: 'service_account', project_id: 'dsf-test', client_email: 'authoring@dsf-test.iam.gserviceaccount.com',
        private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateBytes).toString('base64')}\n-----END PRIVATE KEY-----` });
    let oauthCalls = 0, lookupCalls = 0, account = { localId: 'owner_1', validSince: String(authTime - 100), disabled: false };
    const client = createGoogleClient({ projectId: 'dsf-test', serviceAccountJson: secret, now: () => authTime * 1000,
        fetcher: async (url, options) => {
            assert.equal(options.redirect, 'error');
            if (url === 'https://oauth2.googleapis.com/token') {
                oauthCalls += 1;
                const form = new URLSearchParams(options.body);
                assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
                const parts = form.get('assertion').split('.');
                const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
                assert.equal(claims.aud, url); assert.equal(claims.exp - claims.iat, 3600);
                assert.equal(claims.iss, 'authoring@dsf-test.iam.gserviceaccount.com');
                assert.match(claims.scope, /auth\/datastore/); assert.match(claims.scope, /auth\/identitytoolkit/);
                assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsa.publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
                return Response.json({ access_token: 'server-access-token', expires_in: 3600 });
            }
            assert.equal(url, 'https://identitytoolkit.googleapis.com/v1/projects/dsf-test/accounts:lookup');
            assert.equal(options.headers.Authorization, 'Bearer server-access-token');
            assert.deepEqual(JSON.parse(options.body), { localId: ['owner_1'] });
            lookupCalls += 1; return Response.json({ users: account ? [account] : [] });
        } });
    const identity = { uid: 'owner_1', authTime: authTime - 10, expiresAt: authTime + 3600 };
    await client.assertLiveIdentity(identity); await client.assertLiveIdentity(identity);
    assert.equal(oauthCalls, 1); assert.equal(lookupCalls, 2);
    account.disabled = true; await assert.rejects(client.assertLiveIdentity(identity), matches('AUTH_DISABLED'));
    account.disabled = false; account.validSince = String(authTime); await assert.rejects(client.assertLiveIdentity(identity), matches('AUTH_REVOKED'));
    account = null; await assert.rejects(client.assertLiveIdentity(identity), matches('AUTH_DISABLED'));
    await assert.rejects(client.assertLiveIdentity({ ...identity, expiresAt: authTime }), matches('AUTH_EXPIRED'));
    assert.throws(() => createGoogleClient({ projectId: 'another-test', serviceAccountJson: secret }), matches('CONFIG_SERVICE_ACCOUNT'));
});
await test('Firestore REST codec preserves types and rejects unsafe values', () => {
    const data = { text: '日本語', bool: false, nil: null, count: 123, fractional: 1.25, when: new Date('2026-01-01'), list: ['a', { b: true }] };
    assert.deepEqual(decodeFirestoreValue(encodeFirestoreValue(data)), data);
    for (const value of [NaN, Infinity, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => encodeFirestoreValue(value));
    assert.throws(() => decodeFirestoreValue({ integerValue: '9007199254740993' }), matches('INVALID_NUMBER'));
});
function restFixture() {
    const prefix = 'projects/dsf-test/databases/(default)/documents/';
    const documents = new Map([[rootPath, { title: 'Before', releaseId: 'published' }]]);
    const calls = [];
    let aborted = false, ambiguous = false, omit = false;
    const google = { projectId: 'dsf-test', async post(url, body) {
        calls.push({ url, body: clone(body) });
        assert(url.startsWith('https://firestore.googleapis.com/v1/projects/dsf-test/databases/(default)/documents:'));
        if (url.endsWith(':beginTransaction')) return { transaction: 'transaction-token' };
        assert.equal(body.transaction, 'transaction-token');
        if (url.endsWith(':batchGet')) return omit ? [] : [...body.documents].reverse().map(name => {
            const path = name.slice(prefix.length), data = documents.get(path);
            return data ? { found: { name, fields: encodeFirestoreValue(data).mapValue.fields } } : { missing: name };
        });
        if (url.endsWith(':rollback')) return {};
        assert(url.endsWith(':commit'));
        if (aborted) { aborted = false; const error = new AuthoringApiError('UPSTREAM_UNAVAILABLE'); error.aborted = true; throw error; }
        for (const write of body.writes) {
            const path = write.update.name.slice(prefix.length);
            assert.equal(write.currentDocument.exists, documents.has(path));
            const value = decodeFirestoreValue({ mapValue: { fields: write.update.fields } });
            if (write.updateMask) assert.deepEqual(write.updateMask.fieldPaths.sort(), Object.keys(value).sort());
            documents.set(path, write.updateMask ? { ...documents.get(path), ...value } : value);
        }
        if (ambiguous) throw new AuthoringApiError('UPSTREAM_UNAVAILABLE');
        return { commitTime: '2026-09-19T00:00:00Z' };
    } };
    return { store: createFirestoreStore(google), documents, calls,
        abortOnce: () => { aborted = true; }, loseReply: () => { ambiguous = true; }, omitRead: () => { omit = true; } };
}
await test('Firestore adapter reads missing documents, uses transaction tokens, masks and existence preconditions', async () => {
    const f = restFixture();
    await f.store.transaction(async tx => {
        const [root, head] = await tx.getMany([rootPath, headPath]);
        assert.equal(root.releaseId, 'published'); assert.equal(head, null);
        tx.patch(rootPath, { title: 'After' }); tx.set(headPath, { revision: 1 });
    });
    assert.equal(f.documents.get(rootPath).releaseId, 'published');
    assert.equal(f.documents.get(rootPath).title, 'After'); assert.equal(f.documents.get(headPath).revision, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith(':commit')).length, 1);
    await assert.rejects(f.store.transaction(async tx => { tx.set(headPath, { revision: 99 }); }), matches('WRITE_WITHOUT_READ'));
});
await test('Firestore retries only explicit ABORTED, never an ambiguous committed response', async () => {
    const f = restFixture(); f.abortOnce(); let attempts = 0;
    await f.store.transaction(async tx => { attempts += 1; await tx.getMany([rootPath]); tx.patch(rootPath, { title: 'Retry' }); });
    assert.equal(attempts, 2); assert.equal(f.documents.get(rootPath).title, 'Retry');
    const uncertain = restFixture(); uncertain.loseReply(); let uncertainAttempts = 0;
    await assert.rejects(uncertain.store.transaction(async tx => { uncertainAttempts += 1; await tx.getMany([rootPath]); tx.patch(rootPath, { title: 'Committed' }); }), matches('UPSTREAM_UNAVAILABLE'));
    assert.equal(uncertainAttempts, 1); assert.equal(uncertain.documents.get(rootPath).title, 'Committed');
    const missing = restFixture(); missing.omitRead();
    await assert.rejects(missing.store.transaction(tx => tx.getMany([rootPath])), matches('INCOMPLETE_TRANSACTION_READ'));
    assert.equal(missing.calls.some(call => call.url.endsWith(':commit')), false);
});
await test('lease expiration during upload and changed Work ownership cannot commit partial metadata', async () => {
    const expired = fixture(); expired.r2.afterPut = async () => expired.advance(AUTHORING_LEASE_MS + 1);
    await responseError(await expired.request(), 409, 'AUTHORING_LEASE_EXPIRED');
    assert.equal(expired.db.docs.has(headPath), false); assert.equal(expired.db.docs.get(rootPath).title, 'Before');
    const work = fixture(); work.r2.afterPut = async () => { work.db.docs.get('users/owner_1/works/work_1').ownerUid = 'other'; };
    await responseError(await work.request(), 409, 'WORK_ID_CONFLICT');
    assert.equal(work.db.docs.has(headPath), false); assert.equal(work.db.docs.get(rootPath).title, 'Before');
});
await test('latest publication metadata is reread at commit instead of overwritten by the saved snapshot', async () => {
    const f = fixture(); f.r2.afterPut = async () => { f.db.docs.get(rootPath).releaseId = 'new_publication'; };
    assert.equal((await f.request()).status, 200);
    assert.equal(f.db.docs.get(rootPath).releaseId, 'new_publication');
    assert.equal(f.db.docs.get('users/owner_1/project_summaries/project_1').releaseId, 'new_publication');
});

await test('corrupt operation receipts cannot masquerade as committed content', async () => {
    const f = fixture(); await f.request();
    f.db.docs.get(opPath('request_1')).committedHead.sha256 = 'f'.repeat(64);
    await responseError(await f.request('GET', { operation: 'request_1' }), 503, 'INVALID_OPERATION_RECORD');
    assert.equal(f.db.docs.get(headPath).revision, 1); assert.equal(f.r2.puts, 1);
});
