import {createOwnerAuthoringStore,readOwnerSharedScope} from '../server/private-authoring/shared-boundary.js';
import {encodeFirestoreValue} from '../server/private-authoring/firestore.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture} from './fixtures/private-authoring-api-fixture.js';
import {createPrivateAuthoringClient} from '../js/private-authoring-client.js';
const root='users/owner_1/projects/project_1',head=root+'/authoringHeads/current';
async function setup(options){const f=fixture(options);assert.equal((await f.request()).status,200);f.db.docs.get('users/owner_1').status.moderationHold=false;f.db.docs.get('users/owner_1').entitlements={canCreateProject:true};return f;}
function share(f){
 f.db.docs.set('publishing_spaces/space_1',{ownerUid:'owner_1',name:'Shared'});
 f.db.docs.set('users/owner_1/publishing/catalogue',{spaceIds:['space_1'],assignments:{project_1:'space_1'}});
 f.db.docs.set('publishing_work_scopes/work_1',{ownerUid:'owner_1',spaceId:'space_1',workId:'work_1',projectId:'project_1',labelId:null});
}
const command=(f,kind,payload={})=>({kind,payload,requestId:'action_'+kind,generationId:'generation_1',baseRevision:f.db.docs.get(head).revision,mutationRevision:f.db.docs.get(root+'/authoringControl/current').mutationRevision||0});
const send=(f,c)=>f.handler({env:f.env,params:{projectId:'project_1',actionRoute:true},request:new Request('https://studio.test/api/projects/project_1/actions',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json'},body:JSON.stringify(c)})});
const blocked=async response=>{assert.equal(response.status,409);const data=await response.json();assert.equal(data.error,'SHARED_AUTHORING_REQUIRED');assert.deepEqual(data.sharedScope,{spaceId:'space_1',workId:'work_1',projectId:'project_1'});};
await test('shared binding blocks owner writes even without a holder; legacy assignments keep working',async()=>{
 const f=await setup();f.db.docs.set('users/owner_1/publishing/catalogue',{spaceIds:['space_1'],assignments:{project_1:'space_1'}});
 assert.equal((await f.request('PUT',{id:'legacy',base:1,project:{...f.project,title:'legacy'}})).status,200);
 share(f);const before=structuredClone([...f.db.docs]),gets=f.r2.gets,puts=f.r2.puts;
 await blocked(await f.request('PUT',{id:'denied',base:2}));assert.deepEqual([...f.db.docs],before);assert.equal(f.r2.puts,puts);
 await blocked(await f.request('GET'));assert.equal(f.r2.gets,gets);
 const c=await f.actions.context(f.identity,'project_1');assert.equal(c.sharedScope.spaceId,'space_1');
});
await test('owner restore, publish, draft, delete, listing, profile and old action replay cannot bypass sharing',async()=>{
 const f=await setup();await f.request('PUT',{id:'second',base:1,project:{...f.project,title:'second'}});
 const old=command(f,'listing',{projectBytes:500,pageCount:1,listThumbnail:''});assert.equal((await send(f,old)).status,200);
 share(f);const before=structuredClone([...f.db.docs]),gets=f.r2.gets,puts=f.r2.puts;
 for(const kind of ['restore','publication','draft','delete','profile','listing'])await blocked(await send(f,command(f,kind)));
 await blocked(await send(f,old));assert.deepEqual([...f.db.docs],before);assert.equal(f.r2.gets,gets);assert.equal(f.r2.puts,puts);
});
await test('sharing established during source I/O prevents a stale read or commit',async()=>{
 for(const during of ['get','put']){
  const f=await setup();f.r2[during==='get'?'afterGet':'afterPut']=()=>share(f);
  const before=structuredClone(f.db.docs.get(head));
  await blocked(await f.request(during==='get'?'GET':'PUT',{id:'race',base:1,project:{...f.project,title:'must not commit'}}));
  assert.deepEqual(f.db.docs.get(head),before);assert.notEqual(f.db.docs.get(root).title,'must not commit');
 }
});
await test('sharing established during restore and release verification prevents final mutation',async()=>{
 const r=await setup();await r.request('PUT',{id:'second',base:1,project:{...r.project,title:'second'}});r.r2.afterGet=()=>share(r);
 await blocked(await send(r,command(r,'restore',{revisionId:'request_1'})));assert.equal(r.db.docs.get(head).revision,2);
 let f;f=await setup({verifyRelease:async()=>{share(f);return 100;}});
 const payload={releaseId:'release_new',thumbnail:'https://media.test/users/owner_1/dsf/publication-thumbnails/'+ 'a'.repeat(64)+'.webp',dsfLangs:['ja'],dsfPages:[{pageNum:1,pageType:'normal_image',workId:'work_1',releaseId:'release_new',urls:{ja:'https://media.test/users/owner_1/dsf/work_1/release_new/ja/page_001.webp'},bytesByLang:{ja:100},totalBytes:100}],bookConfig:{bookMode:'simple',book:{mode:'simple',covers:{}}}};
 await blocked(await send(f,command(f,'draft',payload)));assert(!f.db.docs.has('users/owner_1/works/work_1/releases/release_new'));assert.equal(f.db.docs.get(root).releaseId,'published_release');
});
await test('expired/released lock plus missing or malformed binding never falls back to owner writes',async()=>{
 for(const value of [null,{ownerUid:'other',spaceId:'space_1',projectId:'project_1',workId:'work_1',labelId:null}]){
  const f=await setup();f.db.docs.set(root+'/authoringLocks/current',{holder:null,expiresAt:0});if(value)f.db.docs.set('publishing_work_scopes/work_1',value);
  const r=await f.request('PUT',{id:'bad',base:1});assert.equal(r.status,409);assert.equal((await r.json()).error,'SHARED_SCOPE_UNAVAILABLE');
 }
});
await test('owner client receives only validated routing IDs; invalid scope cannot navigate',async()=>{
 const f=await setup();share(f);
 const client=createPrivateAuthoringClient({uid:'owner_1',projectId:'project_1',user:{uid:'owner_1',getIdToken:async()=>'valid'},isCurrent:()=>true,fetcher:(url,o)=>f.handler({env:f.env,params:{projectId:'project_1'},request:new Request('https://studio.test'+url,o)})});
 await assert.rejects(client.load(),e=>e.code==='SHARED_AUTHORING_REQUIRED'&&e.sharedScope.spaceId==='space_1');
 for(const bad of [{spaceId:'space_1',workId:'work_1',projectId:'other'},{spaceId:'../evil',workId:'work_1',projectId:'project_1'}]){
  const c=createPrivateAuthoringClient({uid:'owner_1',projectId:'project_1',user:{uid:'owner_1',getIdToken:async()=>'valid'},isCurrent:()=>true,fetcher:async()=>Response.json({error:'SHARED_AUTHORING_REQUIRED',sharedScope:bad},{status:409})});
  await assert.rejects(c.load(),e=>e.code==='SHARED_AUTHORING_REQUIRED'&&!e.sharedScope);
 }
});

await test('the production Firestore adapter can read the exact collaboration boundary collections',async()=>{
 const f=await setup();share(f);const seen=[];
 const store=createOwnerAuthoringStore({projectId:'demo-shared',post:async(url,body)=>{
  if(url.endsWith(':beginTransaction'))return {transaction:'tx'};
  if(url.endsWith(':batchGet'))return body.documents.map(name=>{const path=name.split('/documents/')[1];seen.push(path);const value=f.db.docs.get(path);return value?{found:{name,fields:encodeFirestoreValue(value).mapValue.fields}}:{missing:name}});
  return {};
 }});
 const result=await store.transaction(tx=>readOwnerSharedScope(tx,'owner_1','project_1',f.db.docs.get(root)));
 assert.equal(result.spaceId,'space_1');assert(seen.includes('publishing_work_scopes/work_1'));
 await assert.rejects(store.transaction(tx=>tx.getMany(['unrelated/secret'])),e=>e.code==='INVALID_DOCUMENT_PATH');
});
