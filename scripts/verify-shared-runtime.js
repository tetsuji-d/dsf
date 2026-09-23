import {mapSharedImageSlots,privateImageRef} from '../js/shared-authoring-assets.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
import {encodeFirestoreValue,decodeFirestoreValue} from '../server/private-authoring/firestore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/private-authoring-api-fixture.js';
import {createSharedRuntime,handleSharedAuthoring,readSharedRollout,createSharedRuntimeStore} from '../server/shared-authoring-runtime.js';
import {createPublishingSpacesService} from '../server/publishing-spaces.js';
import {AuthoringApiError} from '../server/private-authoring/common.js';
const spaceId='space_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',root='users/owner_1/projects/project_1';
const scope={spaceId,workId:'work_1',ownerUid:'owner_1',projectId:'project_1',actorUids:['owner_1','editor_1','viewer_1','outsider_1']};
const env={SHARED_AUTHORING_ENABLED:'true',SHARED_AUTHORING_TEST_SCOPES:JSON.stringify([scope])};
async function setup(project,extra={}){
 const f=fixture();await f.request('PUT',{project:project||f.project});
 Object.assign(f.db.docs.get('users/owner_1'),{status:{disabled:false,moderationHold:false},entitlements:{canCreateProject:true}});
 f.db.docs.set('publishing_spaces/'+spaceId,{schemaVersion:1,ownerUid:'owner_1',name:'図書館出版'});
 f.db.docs.set('users/owner_1/publishing/catalogue',{schemaVersion:1,revision:1,spaceIds:[spaceId],assignments:{project_1:spaceId}});
 for(const [uid,role]of [['editor_1','editor'],['viewer_1','viewer'],['outsider_1',null]]){
  f.db.docs.set('users/'+uid,{uid,status:{disabled:false,moderationHold:false},entitlements:{canCreateProject:true}});
  if(role)f.db.docs.set('users/'+uid+'/spaceMemberships/'+spaceId,{uid,spaceId,status:'active',role:'member',grants:[{role,scope:'work',targetId:'work_1'}]});
 }
 let authCalls=0,revoked=false;
 const handler=createSharedRuntime({db:f.db,privateBucket:f.r2,publicBucket:extra.publicBucket,publicBaseUrl:'https://media.test',verifyToken:async token=>{authCalls++;if(!token.startsWith('valid-'))throw new AuthoringApiError('AUTH_INVALID',401);return {uid:token.slice(6)};},assertLiveIdentity:async()=>{if(revoked)throw new AuthoringApiError('AUTH_REVOKED',401);}});
 const call=(path='sharing',options={})=>handler({env:options.env||env,request:new Request('https://studio.test/api/spaces/'+(options.spaceId||spaceId)+'/works/'+(options.workId||'work_1')+'/'+path,{method:options.method||'GET',headers:{Authorization:'Bearer valid-'+(options.uid||'owner_1'),'Content-Type':'application/json',...options.headers},...(options.body?{body:JSON.stringify(options.body)}:{})})});
 const prepare=async()=>{const r=await call();assert.equal(r.status,200);return r.json();};
 const register=async(prepared)=>call('sharing',{method:'POST',body:{kind:'register',confirmationToken:prepared.confirmationToken}});
 return {...f,call,prepare,register,authCalls:()=>authCalls,revokeRuntime:()=>revoked=true};
}
const code=async(r,status,error)=>{assert.equal(r.status,status);assert.equal((await r.json()).error,error);assert.match(r.headers.get('cache-control'),/no-store/);};
await test('Pages defaults and invalid rollout fail closed before credentials or storage are used',async()=>{
 for(const bad of [{},{SHARED_AUTHORING_ENABLED:'true'},{...env,SHARED_AUTHORING_TEST_SCOPES:'[]'},{...env,SHARED_AUTHORING_TEST_SCOPES:JSON.stringify([{...scope,actorUids:['editor_1']}])},{...env,SHARED_AUTHORING_TEST_SCOPES:JSON.stringify([scope,scope])}]){
  const r=await handleSharedAuthoring({env:bad,request:new Request('https://studio.test/api/spaces/x/works/y/context')});assert.equal(r.status,503);
 }
 assert.equal(readSharedRollout(env).length,1);
 const f=await setup(),calls=f.db.calls,gets=f.r2.gets;
 await code(await f.call('context',{workId:'other'}),403,'SHARED_WORK_NOT_ENABLED');assert.equal(f.authCalls(),0);
 await code(await f.call('context',{headers:{Origin:'https://evil.test'}}),403,'ORIGIN_FORBIDDEN');
 await code(await f.call('context',{headers:{'Sec-Fetch-Site':'cross-site'}}),403,'ORIGIN_FORBIDDEN');
 await code(await f.call('context',{headers:{Authorization:'Bearer invalid'}}),401,'AUTH_INVALID');
 await code(await f.call('context',{uid:'not_listed'}),403,'SHARED_ACTOR_NOT_ENABLED');assert.equal(f.db.calls,calls);assert.equal(f.r2.gets,gets);
});
await test('owner prepares without writes, confirms once, and preserves source, published metadata and old catalogue',async()=>{
 const f=await setup(),before=structuredClone([...f.db.docs]),puts=f.r2.puts;
 const p=await f.prepare();assert.equal(p.ready,true);assert.deepEqual([...f.db.docs],before);
 const replies=await Promise.all([f.register(p),f.register(p)]);for(const r of replies)assert.equal(r.status,200);
 const b=f.db.docs.get('publishing_work_scopes/work_1');assert.equal(b.ownerUid,'owner_1');assert.equal(b.labelId,null);
 assert.deepEqual(f.db.docs.get('publishing_space_catalogues/'+spaceId).workIds,['work_1']);
 for(const [path,value]of before)assert.deepEqual(f.db.docs.get(path),value,path);
 assert.equal(f.r2.puts,puts);assert.equal((await f.prepare()).registered,true);
 assert.equal((await f.request('PUT',{base:1,id:'old_owner'})).status,409);
});
await test('preparation cannot be used after source or assignment changes; I/O revocation creates nothing',async()=>{
 for(const change of ['source','catalogue','disabled','revoked','duringRead']){
  const f=await setup(),p=await f.prepare();
  if(change==='source')await f.request('PUT',{base:1,id:'new_revision',project:{...f.project,title:'changed'}});
  if(change==='catalogue')f.db.docs.get('users/owner_1/publishing/catalogue').revision++;
  if(change==='disabled')f.db.docs.get('users/owner_1').status.disabled=true;
  if(change==='revoked')f.revokeRuntime();
  if(change==='duringRead')f.r2.afterGet=()=>{f.db.docs.get('users/owner_1/publishing/catalogue').revision++;};
  const r=await f.register(p);assert([401,403,409].includes(r.status));assert(!f.db.docs.has('publishing_work_scopes/work_1'));
 }
});
await test('image manuscripts are diagnosed without rewriting or publishing them',async()=>{
 const f=await setup({...fixture().project,blocks:[{id:'image_1',kind:'page',content:{pageKind:'image',background:'https://media.test/private-looking.webp'}}]});
 const before=structuredClone([...f.db.docs]),p=await f.prepare();assert.equal(p.ready,false);assert.deepEqual(p.issues,['IMAGE_MIGRATION_REQUIRED']);
 await code(await f.register(p),409,'IMAGE_MIGRATION_REQUIRED');assert.deepEqual([...f.db.docs],before);
});
await test('membership and actual editor lock still apply inside the rollout allowlist',async()=>{
 const f=await setup();await code(await f.call('sharing',{uid:'editor_1'}),403,'OWNER_REQUIRED');
 await f.register(await f.prepare());
 await code(await f.call('context',{uid:'outsider_1'}),403,'SPACE_FORBIDDEN');
 assert.equal((await f.call('authoring',{uid:'viewer_1'})).status,200);
 const session={'X-Shared-Session':'session_editor'};
 const acquired=await f.call('lock',{uid:'editor_1',method:'POST',headers:session,body:{action:'acquire'}});assert.equal(acquired.status,200);
 const status=await acquired.json();assert(status.lock.fence);
 const save=await f.call('authoring',{uid:'editor_1',method:'PUT',headers:{...session,'X-Shared-Lock':status.lock.fence,'X-Authoring-Generation':'generation_1','X-Authoring-Request-Id':'shared_edit','X-Authoring-Base-Revision':'1'},body:{...f.project,title:'Shared title'}});assert.equal(save.status,200,await save.text());
 const denied=await f.call('lock',{uid:'viewer_1',method:'POST',headers:{'X-Shared-Session':'session_viewer'},body:{action:'acquire'}});assert.equal(denied.status,403);
 f.db.docs.get('users/editor_1/spaceMemberships/'+spaceId).status='revoked';assert.equal((await f.call('authoring',{uid:'editor_1'})).status,403);
});
await test('configured scope cannot be redirected by a different canonical binding',async()=>{
 const f=await setup();await f.register(await f.prepare());const gets=f.r2.gets;
 f.db.docs.get('publishing_work_scopes/work_1').projectId='other_project';
 await code(await f.call('authoring'),409,'SHARED_SCOPE_CONFLICT');assert.equal(f.r2.gets,gets);
});
await test('legacy assignment cannot move registered works or stranded locks, but exact retry stays harmless',async()=>{
 const f=await setup();await f.register(await f.prepare());
 const service=createPublishingSpacesService({db:f.db,assertLiveIdentity:async()=>{}});
 const command={kind:'assign',projectId:'project_1',spaceId:null,expectedSpaceId:spaceId,baseRevision:1};
 await assert.rejects(service.execute(f.identity,command),e=>e.code==='SHARED_WORK_MOVE_UNAVAILABLE');
 assert.equal((await service.execute(f.identity,{...command,spaceId})).revision,1);
 f.db.docs.delete('publishing_work_scopes/work_1');f.db.docs.set(root+'/authoringLocks/current',{holder:null});
 await assert.rejects(service.execute(f.identity,command),e=>e.code==='SHARED_WORK_MOVE_UNAVAILABLE');
});

await test('Pages store uses the real REST adapter for registration and shared context, denying unrelated roots',async()=>{
 const f=await setup(),seen=[];
 const store=createSharedRuntimeStore({projectId:'demo-shared',post:async(url,body)=>{
  if(url.endsWith(':beginTransaction'))return {transaction:'tx'};
  if(url.endsWith(':batchGet'))return body.documents.map(name=>{const path=name.split('/documents/')[1];seen.push(path);const value=f.db.docs.get(path);return value?{found:{name,fields:encodeFirestoreValue(value).mapValue.fields}}:{missing:name};});
  if(url.endsWith(':commit'))for(const w of body.writes){const path=w.update.name.split('/documents/')[1],value=decodeFirestoreValue({mapValue:{fields:w.update.fields}});f.db.docs.set(path,w.updateMask?{...f.db.docs.get(path),...value}:value);}
  return {};
 }});
 const handler=createSharedRuntime({db:store,privateBucket:f.r2,verifyToken:async()=>f.identity,assertLiveIdentity:async()=>{}});
 const call=(method='GET',body=null,path='sharing')=>handler({env,request:new Request('https://studio.test/api/spaces/'+spaceId+'/works/work_1/'+path,{method,headers:{Authorization:'Bearer valid','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
 const p=await(await call()).json();assert.equal(p.ready,true);
 assert.equal((await call('POST',{kind:'register',confirmationToken:p.confirmationToken})).status,200);
 assert.equal((await call('GET',null,'context')).status,200);
 assert(seen.includes('publishing_space_catalogues/'+spaceId));assert(seen.includes('publishing_work_scopes/work_1'));
 await assert.rejects(store.transaction(tx=>tx.getMany(['unrelated/secret'])),e=>e.code==='INVALID_DOCUMENT_PATH');
});
await test('registration rejects malformed bodies and non-owner calls without modifying records',async()=>{
 const f=await setup(),before=structuredClone([...f.db.docs]);
 await code(await f.call('sharing',{method:'POST',body:{kind:'register',confirmationToken:'bad'}}),400,'INVALID_COMMAND');
 await code(await f.call('sharing',{method:'POST',headers:{'Content-Encoding':'gzip'},body:{}}),415,'CONTENT_ENCODING_INVALID');
 await code(await f.call('sharing',{method:'POST',body:{padding:'x'.repeat(2100)}}),413,'BODY_TOO_LARGE');
 await code(await f.call('sharing',{uid:'viewer_1'}),403,'OWNER_REQUIRED');
 assert.deepEqual([...f.db.docs],before);
});

await test('managed image inspection preserves source and rechecks assignment after public bucket I/O',async()=>{
 const bytes=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
 for(const change of [false,true]){
  let f;const publicBucket={get:async()=>{if(change)f.db.docs.get('users/owner_1/publishing/catalogue').revision++;return {size:bytes.length,httpMetadata:{contentType:'image/webp'},body:new Response(bytes).body};}};
  f=await setup({...fixture().project,blocks:[{id:'image_1',kind:'page',content:{background:'https://media.test/users/owner_1/dsf/cover.webp'}}]},{publicBucket});
  const head=structuredClone(f.db.docs.get(root+'/authoringHeads/current')),puts=f.r2.puts;
  const r=await f.call();
  if(change)await code(r,409,'SHARED_PREPARATION_CHANGED');
  else {assert.equal(r.status,200);const p=await r.json();assert.equal(p.ready,true);assert.equal(p.images.copyable,true);assert.equal(p.images.verifiedBytes,bytes.length);}
  assert.deepEqual(f.db.docs.get(root+'/authoringHeads/current'),head);assert.equal(f.r2.puts,puts);assert(!f.db.docs.has('publishing_work_scopes/work_1'));
 }
});

const migrationBytes=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
async function migrationFixture(){
 const project={...fixture().project,notes:'本文中のURL https://media.test/users/owner_1/dsf/cover.webp は変更しない',blocks:[{id:'img',kind:'page',content:{pageKind:'image',background:'https://media.test/users/owner_1/dsf/cover.webp'}}]};
 const publicBucket={get:async()=>({size:migrationBytes.length,httpMetadata:{contentType:'image/webp'},body:new Response(migrationBytes).body})};
 const f=await setup(project,{publicBucket});
 const p=await f.prepare();
 const command={kind:'register',confirmationToken:p.confirmationToken,copyImages:true,imagePlanHash:p.images.imagePlanHash,requestId:'migration_1'};
 return {...f,project,publicBucket,p,command,migrate:()=>f.call('sharing',{method:'POST',body:command})};
}
await test('image migration verifies private copies and atomically commits source, records and binding; retry is harmless',async()=>{
 const f=await migrationFixture(),oldRoot=structuredClone(f.db.docs.get(root)),oldHead=structuredClone(f.db.docs.get(root+'/authoringHeads/current'));
 const r=await f.migrate();assert.equal(r.status,200,await r.clone().text());
 assert.equal((await r.json()).imagesCopied,1);
 assert.deepEqual(f.db.docs.get(root),oldRoot);
 assert.equal(f.db.docs.get(root+'/authoringHeads/current').revision,2);
 assert.deepEqual(f.db.docs.get(root+'/authoringControl/current').previousHead,oldHead);
 const source=await (await f.call('authoring')).json();
 assert(JSON.stringify(source).includes('assets/private/'));const expected=await createPrivateAuthoringSnapshot(await mapSharedImageSlots(f.project,()=>privateImageRef(f.p.images.entries[0].sha256)));assert.deepEqual(source,expected.project);
 const ready=[...f.db.docs].filter(([p])=>p.includes('/privateImageGenerations/'));assert.equal(ready.length,1);assert.equal(ready[0][1].status,'ready');
 const puts=f.r2.puts;assert.equal((await f.migrate()).status,200);assert.equal(f.r2.puts,puts);
});
await test('migration requires exact image plan and explicit consent before storage writes',async()=>{
 for(const change of [{copyImages:false},{imagePlanHash:'0'.repeat(64)},{requestId:'../bad'}]){
  const f=await migrationFixture(),before=structuredClone([...f.db.docs]),puts=f.r2.puts;
  Object.assign(f.command,change);assert.equal((await f.migrate()).status,change.requestId?400:409);
  assert.deepEqual([...f.db.docs],before);assert.equal(f.r2.puts,puts);
 }
});
await test('copy and finalization failures retain original source and leave no sharing boundary',async()=>{
 for(const mode of ['put','final','changed','revoke','corrupt']){
  const f=await migrationFixture(),head=structuredClone(f.db.docs.get(root+'/authoringHeads/current'));
  if(mode==='put')f.r2.failPut=true;
  if(mode==='final')f.db.failFinal=true;
  if(mode==='changed'||mode==='revoke')f.r2.afterPut=()=>{if(mode==='changed')f.db.docs.get('users/owner_1/publishing/catalogue').revision++;else f.revokeRuntime();};
  if(mode==='corrupt'){const get=f.r2.get.bind(f.r2);f.r2.get=async key=>{const o=await get(key);if(key.startsWith('authoring-images/'))o.customMetadata.sha256='0'.repeat(64);return o;};}
  const r=await f.migrate();assert(r.status>=400,mode);assert.deepEqual(f.db.docs.get(root+'/authoringHeads/current'),head,mode);
  assert(!f.db.docs.has('publishing_work_scopes/work_1'),mode);
  assert(![...f.db.docs].some(([p,v])=>p.includes('/privateImageGenerations/')&&v.status==='ready'),mode);
 }
});
await test('lost final response can be retried without duplicating migration',async()=>{
 const f=await migrationFixture();f.db.loseFinalReply=true;
 assert.equal((await f.migrate()).status,503);
 assert(f.db.docs.has('publishing_work_scopes/work_1'));
 assert.equal((await f.migrate()).status,200);assert.equal(f.db.docs.get(root+'/authoringHeads/current').revision,2);
});

await test('failed final transaction can be retried with the same request and no double storage reservation',async()=>{
 const f=await migrationFixture();f.db.failFinal=true;assert.equal((await f.migrate()).status,503);
 const reserved=f.db.docs.get('users/owner_1/privateImageUsage/current').reservedBytes;
 f.db.failFinal=false;assert.equal((await f.migrate()).status,200);
 assert.equal(f.db.docs.get('users/owner_1/privateImageUsage/current').reservedBytes,reserved);
});
