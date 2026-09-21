import assert from 'node:assert/strict';
import { createPublishingSpacesApi, createPublishingSpacesService } from '../../server/publishing-spaces.js';
export function publishingSpacesFixture() {
    const docs = new Map();
    let queue = Promise.resolve();
    const db = { docs, async transaction(callback) {
        const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous;
        const reads = new Set(), writes = new Map();
        try {
            const result = await callback({
                async getMany(paths) { assert.equal(writes.size, 0); paths.forEach(p => reads.add(p)); return paths.map(p => structuredClone(docs.get(p) ?? null)); },
                set(path, value) { assert.ok(reads.has(path)); writes.set(path, structuredClone(value)); },
            });
            for (const [path, value] of writes) docs.set(path, value);
            return structuredClone(result);
        } finally { release(); }
    }};
    for (const uid of ['owner_1', 'owner_2']) {
        docs.set('users/' + uid, { uid, status: {disabled:false,moderationHold:false}, entitlements: {canCreateProject:true} });
    }
    docs.set('users/owner_1/projects/book_1', {ownerUid:'owner_1',title:'潮騒の図書館',blocks:[{text:'本文を変更しない'}],workId:'work_1'});
    docs.set('users/owner_1/projects/book_2', {ownerUid:'owner_1',title:'旅の写真集',blocks:[{image:'original.webp'}],workId:'work_2'});
    docs.set('users/owner_2/projects/book_other', {ownerUid:'owner_2',title:'Other account'});
    docs.set('public_projects/work_1', {projectId:'book_1',releaseId:'release_1'});
    let revoked = false;
    const media = new Map();
    const bucket = {async put(key,bytes) { media.set(key,new Uint8Array(bytes)); }, async get(key) { const bytes=media.get(key);return bytes ? {size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer} : null; }};
    const service = createPublishingSpacesService({db, bucket, assertLiveIdentity: async () => { if (revoked) throw new Error('revoked'); }});
    const handler = createPublishingSpacesApi({service,verifyToken: async token => token === 'fixture-owner' ? {uid:'owner_1'} : token === 'fixture-other' ? {uid:'owner_2'} : null});
    const env = {PUBLISHING_SPACES_ENABLED:'true'};
    async function request(command = null, options = {}) {
        return handler({env:{...env,...options.env},request:new Request('http://localhost/api/publishing-spaces',{
            method:options.method || (command ? 'POST':'GET'),
            headers:{Authorization:'Bearer '+(options.token || 'fixture-owner'),'Content-Type':'application/json',...options.headers},
            ...(command ? {body:JSON.stringify(command)} : {}),
        })});
    }
    return {docs,media,service,handler,env,request,revoke:()=>{revoked=true;}};
}
