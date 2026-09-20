import { createProjectActions } from '../../server/private-authoring/actions.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthoringApiError } from '../../server/private-authoring/common.js';
import { createAuthoringApi } from '../../server/private-authoring/http.js';
import { createAuthoringService } from '../../server/private-authoring/service.js';
import { createAuthoringBucket } from '../../server/private-authoring/r2.js';
const clone = structuredClone;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rootPath = 'users/owner_1/projects/project_1';
const headPath = `${rootPath}/authoringHeads/current`;
const controlPath = `${rootPath}/authoringControl/current`;
// Transactional test store: serialize callbacks, stage all writes, atomically apply.
// R2 is always outside this lock, so racing requests can both reserve the same base.
class MemoryStore {
    docs = new Map(); queue = Promise.resolve(); calls = 0; failFinal = false; loseFinalReply = false;
    async transaction(callback) {
        const previous = this.queue;
        let release;
        this.queue = new Promise(resolve => { release = resolve; });
        await previous;
        this.calls += 1;
        const writes = new Map(), read = new Set();
        try {
            const result = await callback({
                getMany: async paths => {
                    assert.equal(writes.size, 0, 'all transaction reads must precede writes');
                    paths.forEach(path => read.add(path));
                    return paths.map(path => clone(this.docs.get(path) ?? null));
                },
                set: (path, data) => { assert(read.has(path)); writes.set(path, clone(data)); },
                delete: path => { assert(read.has(path)); writes.set(path, null); },
                patch: (path, data) => { assert(read.has(path) && this.docs.has(path)); writes.set(path, { ...clone(this.docs.get(path)), ...clone(data) }); },
            });
            if (this.failFinal && writes.has(headPath)) throw new AuthoringApiError('UPSTREAM_UNAVAILABLE');
            for (const [path, value] of writes) { if (value === null) this.docs.delete(path); else this.docs.set(path, value); }
            if (this.loseFinalReply && writes.has(headPath)) { this.loseFinalReply = false; throw new AuthoringApiError('UPSTREAM_UNAVAILABLE'); }
            return result;
        } finally { release(); }
    }
}
export class MemoryR2 {
    objects = new Map(); puts = 0; gets = 0; failPut = false; afterPut; afterGet;
    async put(key, bytes, options) {
        this.puts += 1;
        if (this.failPut) throw new Error('private upstream failure must not leak');
        assert.equal(options.onlyIf.get('If-None-Match'), '*');
        assert.equal(hash(bytes), options.sha256);
        const exists = this.objects.has(key);
        if (!exists) this.objects.set(key, { bytes: new Uint8Array(bytes), size: bytes.byteLength,
            customMetadata: clone(options.customMetadata), httpMetadata: clone(options.httpMetadata) });
        if (this.afterPut) await this.afterPut(key);
        return exists ? null : { key };
    }
    async get(key) {
        this.gets += 1;
        const object = this.objects.get(key);
        if (this.afterGet) await this.afterGet(key);
        return object ? { ...object, body: new Response(new Uint8Array(object.bytes)).body } : null;
    }
}
export function fixture(options = {}) {
    const db = new MemoryStore(), r2 = new MemoryR2();
    let time = 1_800_000_000_000, revoked = false;
    const identity = { uid: 'owner_1', authTime: 1_799_999_000, expiresAt: 1_900_000_000 };
    db.docs.set('users/owner_1', { uid: 'owner_1', status: { disabled: false, moderationHold: true } });
    db.docs.set(rootPath, { ownerUid: 'owner_1', projectId: 'project_1', workId: 'work_1', version: 6,
        authoringBackend: 'r2-private', authoringStorageVersion: 1, authoringRef: 'authoringHeads/current',
        title: 'Before', projectName: 'Before', languages: ['ja'], pageCount: 9, projectBytes: 5000000,
        releaseId: 'published_release', dsfStatus: 'public', visibility: 'public',
        publication: { publicFrom: new Date('2026-01-01') } });
    db.docs.set('users/owner_1/works/work_1', { ownerUid: 'owner_1', projectId: 'project_1', latestReleaseId: 'published_release' });
    db.docs.set(controlPath, { storageVersion: 1, generationId: 'generation_1', status: 'active', initialized: false });
    const assertLiveIdentity = async () => { if (revoked) throw new AuthoringApiError('AUTH_REVOKED', 401); };
    const bucket = createAuthoringBucket(r2);
    const service = createAuthoringService({ db, bucket, now: () => time, assertLiveIdentity });
    const actions = createProjectActions({ db, bucket, service, now: () => time, assertLiveIdentity, publicBaseUrl: 'https://media.test',
        verifyRelease: options.verifyRelease || (async () => 100) });
    const handler = createAuthoringApi({ service, actions, verifyToken: async token => {
        if (token !== 'valid') throw new AuthoringApiError('AUTH_INVALID', 401);
        return identity;
    } });
    const project = { version: 6, projectId: 'project_1', workId: 'work_1', blocks: [], languages: ['ja'], defaultLang: 'ja', title: '小説', projectName: '作品', futurePrivate: { text: 'PRIVATE_MANUSCRIPT_SENTINEL' } };
    const env = { AUTHORING_API_ENABLED: 'true', AUTHORING_TEST_PROJECTS: '["owner_1/project_1"]' };
    async function request(method = 'PUT', options = {}) {
        const headers = { Authorization: 'Bearer valid', 'Content-Type': 'application/json',
            'X-Authoring-Generation': 'generation_1', 'X-Authoring-Request-Id': options.id || 'request_1',
            'X-Authoring-Base-Revision': String(options.base ?? 0), ...options.headers };
        const body = method === 'PUT' ? options.raw ?? JSON.stringify(options.project || project) : undefined;
        return handler({ request: new Request('https://studio.test/api/projects/project_1/authoring', { method, headers, body }),
            env: options.env || env, params: { projectId: 'project_1', ...(options.operation ? { requestId: options.operation } : {}) } });
    }
    return { db, r2, service, actions, identity, project, request, env, handler, advance: ms => { time += ms; }, revoke: () => { revoked = true; } };
}
