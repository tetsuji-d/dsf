import assert from 'node:assert/strict';
import { createEditionListCache } from '../js/edition-list-cache.js';
import { loadEditionList, filterEditionList } from '../js/edition-list.js';

let time = 0, requests = 0;
const cache = createEditionListCache({ now: () => time });
const ownerSession = {}, key = 'ja';
const row = { projectId: 'one', state: { status: 'private', publication: { publicUntil: null } } };
const load = async () => { requests++; return [row]; };
const options = { ownerSession, key, load };
const [home, reads] = await Promise.all([cache.read(options), cache.read(options)]);
assert.equal(requests, 1, 'concurrent Home and Reads share the same network request');
home[0].state.publication.publicUntil = '2020-01-01';
assert.equal(reads[0].state.publication.publicUntil, null, 'views cannot mutate each other');
await cache.read(options); assert.equal(requests, 1, 'navigation reuses the fresh inventory');
time = 30_000; await cache.read(options); assert.equal(requests, 2, 'TTL expires without serving stale data');
await cache.read({ ...options, force: true }); assert.equal(requests, 3, 'manual refresh bypasses cache');
cache.invalidate(); await cache.read(options); assert.equal(requests, 4, 'issue/lifecycle changes require a fresh list');
await cache.read({ ...options, ownerSession: {} }); assert.equal(requests, 5, 'same UID in a new auth session is isolated');
await cache.read({ ...options, key: 'en' }); assert.equal(requests, 6, 'locale is isolated');

let finish;
const pending = cache.read({ ...options, force: true, load: () => new Promise(resolve => { finish = resolve; }) });
await Promise.resolve();
const invalidated = assert.rejects(pending, /EDITION_LIST_CHANGED/, 'invalidation releases a waiter even if the SDK never replies');
cache.invalidate();
const fresh = await cache.read(options);
finish([{ ...row, title: 'stale' }]);
await invalidated;
assert.deepEqual(await cache.read(options), fresh);
await assert.rejects(cache.read({ ...options, force: true, load: async () => { throw Error('offline'); } }), /offline/);
assert.deepEqual(await cache.read(options), [row], 'failure is retryable, never cached as zero editions');
const bounded = createEditionListCache({ timeoutMs: 15 });
let finishLate, oldSignal;
const hung = bounded.read({ ...options, load: signal => { oldSignal = signal; return new Promise(resolve => { finishLate = resolve; }); } });
const sharedHung = bounded.read(options);
await Promise.all([assert.rejects(hung, /EDITION_LOAD_TIMEOUT/), assert.rejects(sharedHung, /EDITION_LOAD_TIMEOUT/)]);
assert.equal(oldSignal.aborted, true, 'timeout stops scheduling further reads');
assert.deepEqual(await bounded.read(options), [row], 'a timed-out shared request cannot trap retries');
finishLate([{ ...row, title: 'late response' }]);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(await bounded.read(options), [row], 'late completion cannot replace the recovered inventory');
const scope = allowed => ({ viewKind: () => 'owned', catalogueReady: () => true, filter: rows => rows.filter(r => allowed.includes(r.id)) });
assert.equal(filterEditionList(fresh, scope(['one'])).length, 1);
assert.equal(filterEditionList(fresh, scope([])).length, 0, 'cached inventory is filtered for each current space');

// A slow legacy/project query and one slow work cannot block the next ready work.
let finishProjects, finishFirst;
const blockedProjects = new Promise(resolve => { finishProjects = resolve; });
const blockedFirst = new Promise(resolve => { finishFirst = resolve; });
const started = new Set();
const cold = loadEditionList({ uid: 'owner', origin: 'https://example.test', publicRecords: async () => [],
    records: async path => {
        if (path.at(-1) === 'works') return Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
        if (path.at(-1) === 'projects') return blockedProjects;
        started.add(path.at(-2));
        return path.at(-2) === '0' ? blockedFirst : [];
    },
});
await new Promise(resolve => setImmediate(resolve));
assert.ok(started.has('7'), 'release reads progress while unrelated requests are still pending');
finishProjects([]); finishFirst([]); assert.deepEqual(await cold, []);
console.log('Edition loading: concurrent sharing, TTL, forced refresh, invalidation, response/account isolation, scope, failure recovery and cold-load scheduling passed.');
