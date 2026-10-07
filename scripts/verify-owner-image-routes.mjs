import assert from 'node:assert/strict';
import {createAuthoringApi} from '../server/private-authoring/http.js';
import {onRequest as getRoute} from '../functions/api/projects/[projectId]/assets/[hash].js';
import {onRequest as putRoute} from '../functions/api/projects/[projectId]/assets.js';
import {restoreRecentThumbnail} from '../js/recent-thumbnail.js';
import {selectProjectAuthoringCoverThumbnail} from '../js/project-listing-thumbnail.js';
const hash='a'.repeat(64),ref='assets/private/'+hash+'.webp';
for(const route of [getRoute,putRoute]){const r=await route({env:{}});assert.equal(r.status,503);assert.equal((await r.json()).error,'AUTHORING_API_DISABLED');}
let reads=0;const bytes=new Uint8Array([1,2,3]);
const api=createAuthoringApi({verifyToken:async()=>({uid:'owner_1'}),assets:()=>({get:async()=>{reads++;return bytes;}})});
const env={AUTHORING_API_ENABLED:'true',AUTHORING_TEST_PROJECTS:'["owner_1/project_1"]'};
const params={projectId:'project_1',hash,assetRoute:true};
let r=await api({env,params,request:new Request('https://example.test/api/projects/project_1/assets/'+hash)});assert.equal(r.status,401);assert.equal(reads,0);
r=await api({env,params,request:new Request('https://example.test/api/projects/project_1/assets/'+hash,{headers:{Authorization:'Bearer test'}})});
assert.equal(r.status,200);assert.equal(r.headers.get('Content-Type'),'image/webp');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
const project={blocks:[{kind:'page',content:{background:ref}}]};
assert.equal(selectProjectAuthoringCoverThumbnail(project),'');assert.equal(selectProjectAuthoringCoverThumbnail(project,{allowPrivate:true}),ref);
const item={thumbnail:'blob:expired'},record={state:{sections:[{background:'blob:cover'}]},imageMap:{'blob:cover':'kept-image'}};
const before=JSON.stringify(record);assert.equal(await restoreRecentThumbnail(item,record,async()=>new Blob(['image']),async()=>'data:image/webp;base64,test'),'data:image/webp;base64,test');assert.equal(JSON.stringify(record),before);
assert.equal(await restoreRecentThumbnail(item,record,async()=>null,async()=>assert.fail()),'');
assert.equal(await restoreRecentThumbnail({thumbnail:'https://example.test/image.webp'},null,async()=>assert.fail(),async()=>assert.fail()),'https://example.test/image.webp');
console.log('PASS owner asset routes, auth boundary, private cover opt-in, local thumbnail recovery without writes.');

const {createOwnerImageSession}=await import('../js/owner-authoring-assets.js');
const {sha256DsfBytes}=await import('../js/dsf-release-byte-sealing.js');
const expected=await sha256DsfBytes(bytes);const imageRef='assets/private/'+expected+'.webp';
for(const [body,type,ok] of [[bytes,'image/webp',true],[new Uint8Array([9]),'image/webp',false],['<!doctype html>','text/html',false]]){
const session=createOwnerImageSession({projectId:'project_1',user:{getIdToken:async()=>'test'},isCurrent:()=>true,fetcher:async()=>new Response(body,{headers:{'Content-Type':type}})});
try{if(ok){const result=await session.hydrate({thumbnail:imageRef});assert.match(result.thumbnail,/^blob:/);}else await assert.rejects(session.hydrate({thumbnail:imageRef}),e=>e.code==='PRIVATE_IMAGE_CORRUPT');}finally{session.dispose();}
}
console.log('PASS client still rejects HTML responses and incorrect image hashes.');
