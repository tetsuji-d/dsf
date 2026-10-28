import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEditionsService, createEditionsApi } from '../server/editions.js';
import { editionIdFor, editionFolder, nextEditionStatus } from '../js/edition-policy.js';
import { resolvePublicEdition } from '../js/edition-reader.js';
import { parseEditionStoragePath } from '../server/edition-storage.js';

const origin = 'https://media.test', uid = 'owner', workId = 'work', projectId = 'project';
const now = Date.parse('2026-10-24T00:00:00Z');
const docs = new Map(), objects = new Map(); let request = 0, failDelete = false;
const root = `users/${uid}/works/${workId}`;
const statePath = id => `${root}/edition_states/${id}`;
const releasePath = id => `${root}/releases/${id}`;
const bytesPath = id => `users/${uid}/dsf/${workId}/${id}/ja/page_001.webp`;
const editionId = await editionIdFor(uid, workId, 'first');
const publication = { listedFrom: new Date(now - 1000), listedUntil: new Date(now + 86400000), publicFrom: new Date(now - 1000) };
docs.set(`users/${uid}`, { uid, status: { disabled: false, moderationHold: false }, plan: { tier: 'free' } });
docs.set(root, { workId, ownerUid: uid, projectId, latestProjectId: projectId, latestReleaseId: 'second', title: 'Mutable title' });
docs.set(`users/${uid}/projects/${projectId}`, { workId, title: 'Mutable manuscript', untouched: true });
function release(id, extra = {}) {
    objects.set(bytesPath(id), new Uint8Array([1, 2, 3]));
    docs.set(releasePath(id), { workId, releaseId: id, projectId, title: id, defaultLang: 'ja', dsfLangs: ['ja'],
        dsfPages: [{ pageNum: 1, urls: { ja: `${origin}/${bytesPath(id)}` } }], publication, ...extra });
}
release('first'); release('second'); release('third');
docs.set(`public_projects/${workId}`, { ...docs.get(releasePath('first')), authorUid: uid, dsfStatus: 'public' });
const db = { async transaction(run) {
    const staged = new Map(); let writing = false;
    const value = await run({
        async getMany(paths) { assert.equal(writing, false, 'Firestore requires all reads before writes'); return paths.map(path => structuredClone(docs.get(path) || null)); },
        set(path, value) { writing = true; staged.set(path, structuredClone(value)); },
        delete(path) { writing = true; staged.set(path, null); },
    });
    for (const [path, value] of staged) value === null ? docs.delete(path) : docs.set(path, value);
    return value;
} };
const bucket = {
    async put(key, data) { objects.set(key, data); },
    async list({ prefix, limit }) { const keys = [...objects.keys()].filter(key => key.startsWith(prefix)); return { objects: keys.slice(0, limit).map(key => ({ key })), truncated: keys.length > limit }; },
    async delete(keys) { if (failDelete) throw new Error('NETWORK_FAILURE'); keys.forEach(key => objects.delete(key)); },
};
const service = createEditionsService({ db, bucket, assertLiveIdentity: async identity => assert.equal(identity.uid, uid), publicBaseUrl: origin, now: () => now });
async function act(id, action, extra = {}) {
    const revision = docs.get(statePath(id))?.revision || 0;
    return service.execute({ uid }, { workId, releaseId: id, action, baseRevision: revision, requestId: `req_${++request}`, ...extra });
}
const firstBefore = structuredClone(docs.get(releasePath('first')));
assert.equal((await act('first', 'context')).status, 'public');
await act('second', 'public');
await act('second', 'label', {editionLabel:'第二版'});
assert.equal(docs.get(`public_editions/${await editionIdFor(uid,workId,'second')}`).editionLabel,'第二版');
assert.equal(docs.get(releasePath('second')).title,'second');
await assert.rejects(act('second','label',{editionLabel:'x'.repeat(81)}),/EDITION_LABEL_INVALID/);
assert.equal(docs.get(`public_projects/${workId}`).releaseId, 'first', 'new publication must never replace the old URL');
assert.equal(docs.get(`public_editions/${await editionIdFor(uid, workId, 'second')}`).title, 'second');
assert.deepEqual(docs.get(releasePath('first')), firstBefore, 'publication must not rewrite a Release');
await act('first', 'private');
assert.equal(docs.get(`public_projects/${workId}`).dsfPages, undefined, 'ended old URLs expose no delivery locator');
await act('first', 'successor', { successorReleaseId: 'second' });
let resolved = await resolvePublicEdition(editionId, async id => docs.get(`public_editions/${id}`), new Date(now));
assert.equal(resolved.available, false); assert.match(resolved.successorUrl, /edition=e_/);
await act('first', 'public');
await assert.rejects(act('second', 'successor', { successorReleaseId: 'first' }), /EDITION_SUCCESSOR_CYCLE/);
assert.equal(docs.get(`public_projects/${workId}`).releaseId, 'first');
assert.equal(docs.get(`public_editions/${editionId}`).title, 'first');
docs.get(root).title = 'Entirely different manuscript';
await act('first', 'private'); await act('first', 'public');
assert.equal(docs.get(`public_editions/${editionId}`).title, 'first', 'republish must use the sealed edition snapshot');
await assert.rejects(act('first', 'discard'), /EDITION_ARCHIVE_REQUIRED/);
await assert.rejects(act('first', 'private', { baseRevision: -1 }), /EDITION_REVISION_INVALID/);
await assert.rejects(act('first', 'private', { baseRevision: 0 }), /EDITION_CHANGED/);
await act('first', 'archive');
assert.equal((await act('first', 'restore')).status, 'private');
await act('first', 'archive'); failDelete = true;
await assert.rejects(act('first', 'discard'), /NETWORK_FAILURE/);
assert.equal(docs.get(statePath('first')).status, 'disposed');
assert.equal(docs.get(statePath('first')).cleanupPending, true);
assert.equal(docs.get(`public_editions/${editionId}`).dsfPages, undefined);
failDelete = false; await act('first', 'discard');
assert.equal(docs.get(statePath('first')).cleanupPending, false);
assert.equal(docs.has(releasePath('first')), false); assert.equal(objects.has(bytesPath('first')), false);
assert.equal(docs.has(releasePath('second')), true); assert.equal(objects.has(bytesPath('second')), true);
assert.equal(docs.get(`users/${uid}/projects/${projectId}`).untouched, true);
await assert.rejects(act('first', 'public'), /EDITION_DISPOSED/);
await act('second', 'private');
resolved = await resolvePublicEdition(editionId, async id => docs.get(`public_editions/${id}`));
assert.equal(resolved.successorUrl, null, 'never link an unavailable successor');
await assert.rejects(act('third', 'successor', { successorReleaseId:'nonexistent' }), /EDITION_SUCCESSOR_INVALID/);
const strictService = createEditionsService({ db, bucket, assertLiveIdentity:async()=>{}, publicBaseUrl:origin, requirePublishingSpace:true, now:()=>now });
await assert.rejects(strictService.execute({uid},{workId,releaseId:'third',action:'public',baseRevision:0,requestId:'require_space'}), /PUBLISHING_SPACE_REQUIRED/);
docs.set('users/another', {uid:'another',status:{disabled:false}});
await assert.rejects(strictService.execute({uid:'another'},{workId,releaseId:'third',action:'context'}), /EDITION_OWNER_REQUIRED/);
docs.get(`users/${uid}`).status.moderationHold = true;
await assert.rejects(act('third', 'public'), /EDITION_PUBLICATION_BLOCKED/);
docs.get(`users/${uid}`).status.moderationHold = false;
docs.set('publishing_work_scopes/work', { ownerUid: uid, projectId, workId, spaceId: 'space', labelId: null });
docs.set('publishing_spaces/space', { ownerUid: uid });
docs.set(`users/${uid}/publishing/catalogue`, { spaceIds: ['space'], assignments: { [projectId]: 'space' } });
await assert.rejects(act('third', 'private'), /SHARED_SCOPE_UNAVAILABLE|SHARED_AUTHORING_REQUIRED|WORK_FORBIDDEN/);
docs.delete('publishing_work_scopes/work');
// Only the current delivery projection is cleared; unknown manuscript fields survive shredding.
const project = docs.get(`users/${uid}/projects/${projectId}`);
Object.assign(project, { releaseId:'third', dsfContentUrl:'https://media.test/stale.json', dsfSchemaVersion:2, dsfPageCounts:{ja:1} });
await act('third','archive'); await act('third','discard');
assert.equal(docs.get(`users/${uid}/projects/${projectId}`).untouched,true);
assert.equal(docs.get(`users/${uid}/projects/${projectId}`).releaseId,null);
assert.equal(Object.hasOwn(docs.get(`users/${uid}/projects/${projectId}`),'dsfContentUrl'),false);
release('v2', {dsfSchemaVersion:2,dsfPages:[],dsfContentUrl:`${origin}/users/${uid}/dsf/${workId}/v2/content.json`,
    dsfContentHash:'a'.repeat(64),dsfPageCounts:{ja:3},dsfTotalBytes:512,pageCount:3,
    thumbnail:`${origin}/users/${uid}/dsf/publication-thumbnails/${'b'.repeat(64)}.webp`});
await act('v2','public');
const v2Public=docs.get(`public_editions/${await editionIdFor(uid,workId,'v2')}`);
assert.equal(v2Public.dsfSchemaVersion,2);assert.deepEqual(v2Public.dsfPages,[]);
assert.equal(v2Public.dsfContentHash,'a'.repeat(64));
v2Public.moderationRejected=true;
await act('v2','archive');await act('v2','restore');
await assert.rejects(act('v2','public'),/EDITION_PUBLICATION_BLOCKED/);
assert.equal(editionFolder({ status: 'public', publication: { listedUntil: new Date(0) } }), 'private');
assert.equal(nextEditionStatus('archived', 'restore'), 'private');
assert.equal(parseEditionStoragePath(bytesPath('second')).v2, false);
assert.equal(parseEditionStoragePath('users/owner/dsf/publication-thumbnails/abc.webp'), null);
assert.equal(parseEditionStoragePath('users/owner/dsf/recovered/image.webp'), null);
assert.equal(parseEditionStoragePath('users/owner/authoring/work/picture.webp'), null);
const api = createEditionsApi({ service, verifyToken: async () => ({ uid }) });
const send = (headers, body = {}) => api({ request: new Request('https://studio.test/api/editions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) });
assert.equal((await send({})).status, 401);
assert.equal((await send({ Authorization: 'Bearer test', Origin: 'https://evil.test' })).status, 403);
assert.equal((await send({ Authorization: 'Bearer test' }, { workId, releaseId: 'second', action: 'invalid' })).status, 400);
const readerSource = readFileSync(new URL('../js/viewer.js',import.meta.url),'utf8');
assert.doesNotMatch(readerSource,/loadFromFirestore/,'no public route may substitute the mutable manuscript');
assert.match(readerSource,/loadLegacyProjectBinding/,'old project links must resolve a publication binding');
console.log('Edition lifecycle, fixed URLs, legacy binding, successors, concurrency, purge recovery and API boundaries passed.');
