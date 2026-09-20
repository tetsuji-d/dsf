import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './fixtures/private-authoring-api-fixture.js';
import { createProjectCreation } from '../server/private-authoring/creation.js';
import { createAuthoringApi } from '../server/private-authoring/http.js';
import { createAuthoringBucket } from '../server/private-authoring/r2.js';
import { createPrivateAuthoringClient } from '../js/private-authoring-client.js';
const r='users/owner_1/projects/project_1', w='users/owner_1/works/work_1';
function setup(){
 const f=fixture();let time=1800000000000,revoked=false;
 for(const key of [...f.db.docs.keys()])if(key!=='users/owner_1')f.db.docs.delete(key);
 f.db.docs.set('users/owner_1',{uid:'owner_1',status:{disabled:false},entitlements:{canCreateProject:true}});
 const creation=createProjectCreation({db:f.db,bucket:createAuthoringBucket(f.r2),now:()=>time,assertLiveIdentity:async()=>{if(revoked)throw Error('revoked');}});
 const env={...f.env,AUTHORING_CREATOR_UIDS:'["owner_1"]'};
 const handler=createAuthoringApi({service:f.service,actions:f.actions,creation,verifyToken:async token=>token==='valid'?f.identity:null});
 let loseReply=false;
 const fetcher=async(url,options={})=>{
  const response=await handler({request:new Request('https://studio.test'+url,options),params:{projectId:'project_1'},env});
  if(loseReply&&options.method==='POST'&&response.ok){loseReply=false;throw Error('network lost after commit');}
  return response;
 };
 const send=(project=f.project,id='create_1',headers={})=>fetcher('/api/projects/project_1/authoring',{method:'POST',headers:{Authorization:'Bearer valid','Content-Type':'application/json','X-Authoring-Request-Id':id,...headers},body:JSON.stringify(project)});
 const client=()=>createPrivateAuthoringClient({uid:'owner_1',projectId:'project_1',user:{uid:'owner_1',getIdToken:async()=> 'valid'},isCurrent:()=>true,fetcher,newRequestId:(()=>{let n=0;return()=> 'client_'+(++n);})()});
 return {...f,env,send,client,advance:ms=>{time+=ms;f.advance(ms);},revoke:()=>{revoked=true;},lose:()=>{loseReply=true;}};
}
await test('v5 and v6 creation commit only metadata to Firestore and verified private source to R2',async()=>{
 for(const version of [5,6]){
  const f=setup(),source={...f.project,version};
  const response=await f.send(source);assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.currentHead.revision,1);
  const root=f.db.docs.get(r);assert.equal(root.version,version);assert.equal(root.visibility,'private');assert.equal(root.releaseId,null);
  for(const k of ['blocks','pages','sections','futurePrivate','objectKey'])assert(!Object.hasOwn(root,k));
  assert(!f.db.docs.has(r+'/authoring/current'));assert(f.db.docs.has(w));assert(f.db.docs.has('users/owner_1/project_summaries/project_1'));
  const c=f.client(),loaded=await c.load();assert.equal(loaded.futurePrivate.text,source.futurePrivate.text);assert.equal(loaded.version,version);
  await c.save({...loaded,title:'変更後'});assert.equal(c.getHead().revision,2);
 }
});
await test('first cloud save can exceed the old Firestore ceiling',async()=>{
 const f=setup(),c=f.client(),source={...f.project,futurePrivate:{text:'小説'.repeat(180000)}};
 await c.create(source);assert(c.getHead().byteLength>850*1024);
 const loaded=await f.client().load();assert.equal(loaded.futurePrivate.text,source.futurePrivate.text);
});
await test('creation permission is default-off and authentication/Origin/account/entitlements are enforced',async()=>{
 for(const mode of ['off','unauth','origin','disabled','entitlement']){
  const f=setup(),headers={};
  if(mode==='off')delete f.env.AUTHORING_CREATOR_UIDS;
  if(mode==='unauth')headers.Authorization='';
  if(mode==='origin')headers.Origin='https://foreign.test';
  if(mode==='disabled')f.db.docs.get('users/owner_1').status.disabled=true;
  if(mode==='entitlement')f.db.docs.get('users/owner_1').entitlements.canCreateProject=false;
  assert([401,403].includes((await f.send(f.project,'create_1',headers)).status));
  assert.equal(f.r2.puts,0);assert(!f.db.docs.has(r));
 }
});
await test('all existing IDs including legacy authoring, Work and deleted controls are protected',async()=>{
 for(const path of [r,w,r+'/authoring/current',r+'/authoringControl/current',r+'/authoringHeads/current','users/owner_1/project_summaries/project_1']){
  const f=setup(),original={sentinel:'existing'};f.db.docs.set(path,original);
  assert.equal((await f.send()).status,409);assert.equal(f.r2.puts,0);assert.deepEqual(f.db.docs.get(path),original);
 }
});
await test('R2 failure leaves no visible empty project and exact retry resumes; changed retry cannot replace source',async()=>{
 const f=setup();f.r2.failPut=true;assert.equal((await f.send()).status,503);assert(!f.db.docs.has(r));assert(!f.db.docs.has(w));
 f.r2.failPut=false;assert.equal((await f.send({...f.project,title:'different'})).status,409);
 assert.equal((await f.send()).status,200);assert.equal(f.db.docs.get(r+'/authoringHeads/current').revision,1);
 assert.equal((await f.send()).status,200);assert.equal(f.r2.objects.size,1);
});
await test('lost successful creation reply uses the same request and does not duplicate the project',async()=>{
 const f=setup(),c=f.client();f.lose();await assert.rejects(c.create(f.project));
 assert.equal(c.getHead(),null);await c.create({...f.project,title:'later edit'});
 assert.equal(c.getHead().revision,1);assert.equal(f.r2.puts,1);
 await c.save({...f.project,title:'later edit'});assert.equal(c.getHead().revision,2);
});
await test('two creators racing the same project cannot commit different sources',async()=>{
 const f=setup(),result=await Promise.all([f.send(),f.send({...f.project,title:'other'},'create_2')]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal(f.r2.objects.size,1);
});
await test('a creation receipt after a newer save cannot adopt that source or resurrect a deleted project',async()=>{
 const f=setup();assert.equal((await f.send()).status,200);const c=f.client(),p=await c.load();await c.save({...p,title:'newer'});
 assert.equal((await f.send()).status,409);
 f.db.docs.delete(r);f.db.docs.get(r+'/authoringControl/current').status='deleted';
 assert.equal((await f.send()).status,409);assert.equal((await f.send(f.project,'new_request')).status,409);assert(!f.db.docs.has(r));
});
await test('revocation, disable and lease expiry during upload prevent source publication',async()=>{
 for(const mode of ['revoke','disabled','lease']){
  const f=setup();f.r2.afterPut=()=>{if(mode==='revoke')f.revoke();else if(mode==='disabled')f.db.docs.get('users/owner_1').status.disabled=true;else f.advance(120001);};
  assert([403,409,503].includes((await f.send()).status));assert(!f.db.docs.has(r));assert(!f.db.docs.has(w));
 }
});
await test('scope, unresolved images and quota checks reject before uploading',async()=>{
 for(const mode of ['scope','asset','quota']){
  const f=setup(),p=structuredClone(f.project);
  if(mode==='scope')p.projectId='other';
  if(mode==='asset')p.publicationThumbnailUrl='blob:unresolved';
  if(mode==='quota')f.db.docs.set('users/owner_1/authoringUsage/current',{requestMinute:0,requestCount:0,writeMinute:0,writeCount:0,day:0,uploadedBytes:0,reservedBytes:1024*1024*1024,operationCount:0});
  assert([413,422,429].includes((await f.send(p)).status));assert.equal(f.r2.puts,0);assert(!f.db.docs.has(r));
 }
});
