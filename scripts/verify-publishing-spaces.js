import assert from 'node:assert/strict';
import { publishingSpacesFixture } from './fixtures/publishing-spaces-fixture.js';
import { createFirestoreStore } from '../server/private-authoring/firestore.js';
const f=publishingSpacesFixture(), snapshot=structuredClone([...f.docs]);
const a='space_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b='space_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let res=await f.request(); assert.equal(res.status,200); assert.deepEqual((await res.json()).spaces,[]);
const create={kind:'create',spaceId:a,name:'図書館出版',baseRevision:0};
res=await f.request(create); assert.equal(res.status,200); let data=await res.json(); assert.equal(data.revision,1);
assert.equal((await f.request(create)).status,200,'exact retry must not duplicate a space');
assert.equal((await f.request({...create,name:'changed'})).status,409);
assert.equal((await f.request({...create,spaceId:b,name:'別スペース'})).status,409,'stale create rejected');
assert.equal((await f.request({...create,spaceId:b,name:'別スペース',baseRevision:1})).status,200);
res=await f.request({kind:'assign',spaceId:a,projectId:'book_1',expectedSpaceId:null,baseRevision:2}); assert.equal(res.status,200);
data=await res.json(); assert.equal(data.assignments.book_1,a);
assert.equal((await f.request({kind:'assign',spaceId:a,projectId:'book_1',expectedSpaceId:null,baseRevision:2})).status,200);
assert.equal((await f.request({kind:'assign',spaceId:b,projectId:'book_1',expectedSpaceId:null,baseRevision:3})).status,409);
assert.equal((await f.request({kind:'assign',spaceId:b,projectId:'book_other',expectedSpaceId:null,baseRevision:3})).status,404);
assert.equal((await f.request({kind:'assign',spaceId:a,projectId:'book_other',expectedSpaceId:null,baseRevision:0},{token:'fixture-other'})).status,403);
assert.deepEqual((await (await f.request(null,{token:'fixture-other'})).json()).spaces,[]);
res=await f.request({kind:'rename',spaceId:a,name:'灯台出版',baseRevision:3}); assert.equal(res.status,200);
res=await f.request({kind:'assign',spaceId:null,projectId:'book_1',expectedSpaceId:a,baseRevision:4});assert.equal(res.status,200);
assert.deepEqual((await res.json()).assignments,{});
const races=await Promise.all([
 f.request({kind:'assign',spaceId:a,projectId:'book_1',expectedSpaceId:null,baseRevision:5}),
 f.request({kind:'assign',spaceId:b,projectId:'book_1',expectedSpaceId:null,baseRevision:5}),
]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
for(const [path,value] of snapshot) assert.deepEqual(f.docs.get(path),value,'original document unchanged: '+path);
assert.equal((await f.request(create,{headers:{Origin:'https://elsewhere.example'}})).status,403);
assert.equal((await f.request(null,{token:'invalid'})).status,401);
assert.equal((await f.request(null,{env:{PUBLISHING_SPACES_ENABLED:'false'}})).status,503);
assert.equal((await f.request({...create,spaceId:'../escape'})).status,400);
assert.equal((await f.request({...create,name:'x'.repeat(81)})).status,400);

res = await f.request({kind:'profile',spaceId:a,baseRevision:6,name:'灯台出版',profile:{description:'海辺の物語を届けます。\n第二行',website:'https://example.com'}});
assert.equal(res.status,200);
data = await res.json(); assert.equal(data.revision,7);
assert.equal(data.spaces.find(s=>s.id===a).profile.description,'海辺の物語を届けます。\n第二行');
assert.equal((await f.request({kind:'profile',spaceId:a,baseRevision:6,name:'古い変更',profile:{description:'',website:''}})).status,409);
assert.equal((await f.request({kind:'profile',spaceId:a,baseRevision:7,name:'拒否',profile:{description:'',website:'javascript:alert(1)'}})).status,400);
assert.equal((await f.request({kind:'profile',spaceId:a,baseRevision:7,name:'拒否',profile:{description:'x'.repeat(2001),website:''}})).status,400);
assert.equal((await f.request({kind:'profile',spaceId:a,baseRevision:7,name:'拒否',profile:{description:'',website:'',icon:'data:image/webp;base64,YmFk'}})).status,400);
assert.equal((await f.request({kind:'profile',spaceId:a,baseRevision:0,name:'拒否',profile:{description:'',website:''}},{token:'fixture-other'})).status,403);
assert.equal((await f.request({kind:'readImage',spaceId:a,slot:'icon'},{token:'fixture-other'})).status,403);
assert.equal(f.media.size,0,'invalid and unauthorized requests must not write media');
for(const [path,value] of snapshot) assert.deepEqual(f.docs.get(path),value);

const account=f.docs.get('users/owner_1');account.status.disabled=true;
assert.equal((await f.request()).status,403);account.status.disabled=false;
account.entitlements.canCreateProject=false;assert.equal((await f.request({...create,baseRevision:6})).status,403);
account.entitlements.canCreateProject=true;f.revoke();assert.equal((await f.request()).status,503);
// The authoring store remains narrow unless the space adapter opts in.
const google={projectId:'fixture',post:async(url)=>url.endsWith(':beginTransaction')?{transaction:'t'}:{}};
await assert.rejects(createFirestoreStore(google).transaction(tx=>tx.getMany(['publishing_spaces/'+a])),/INVALID_DOCUMENT_PATH/);
console.log('Publishing spaces: create/retry/rename/assignment/concurrency, account isolation, auth/origin gates and original source/publication preservation passed.');
