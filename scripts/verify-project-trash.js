import assert from 'node:assert/strict';
import {test} from 'node:test';
import {maintenanceFixture,scope,root,child,head} from './fixtures/private-authoring-maintenance-fixture.js';
import {createProjectTrashService,createProjectTrashApi,PROJECT_TRASH_RETENTION_MS} from '../server/project-trash.js';
import {createProjectTrashClient} from '../js/project-trash-client.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
const error=code=>e=>e.code===code;
function fixture(){const f=maintenanceFixture();const service=createProjectTrashService({db:f.db,now:f.time,assertLiveIdentity:async()=>{}});
return {...f,trash:service,command:async kind=>{const c=await service.execute({uid:scope.uid},{kind:'context',projectId:scope.projectId});return {kind,projectId:scope.projectId,requestId:crypto.randomUUID(),baseRevision:c.revision,sourceVersion:c.sourceVersion};},run:cmd=>service.execute({uid:scope.uid},cmd)};}
await test('legacy v6 trash/restore preserves exact source, assets, space and publication; retry does not extend 30 days',async()=>{
 const f=fixture(),publication=structuredClone(f.get(root).publication),before=structuredClone(f.docs),cmd=await f.command('trash');const result=await f.run(cmd);assert.equal(result.status,'trashed');assert.equal(result.restoreUntilMs,f.time()+PROJECT_TRASH_RETENTION_MS);
 for(const [p,v]of before)if(p!==root)assert.deepEqual(f.docs.get(p),v,p);
 f.advance(10000);assert.equal((await f.run(cmd)).restoreUntilMs,result.restoreUntilMs);
 await f.run(await f.command('restore'));assert.equal(f.get(root).projectTrash,null);assert.deepEqual(f.docs.get(child),before.get(child));assert.deepEqual(f.get(root).publication,publication);
 await assert.rejects(f.run(cmd),error('PROJECT_CHANGED'));
});
await test('server deadline rejects at exactly 30 days; stale source and wrong owner cannot mutate',async()=>{
 const f=fixture(),cmd=await f.command('trash');f.set(root,{...f.get(root),title:'Another tab saved'});await assert.rejects(f.run(cmd),error('PROJECT_CHANGED'));
 await assert.rejects(f.trash.execute({uid:'someone_else'},{kind:'context',projectId:scope.projectId}),error('ACCOUNT_UNAVAILABLE'));
 await f.run(await f.command('trash'));const restore=await f.command('restore');f.advance(PROJECT_TRASH_RETENTION_MS);await assert.rejects(f.run(restore),error('TRASH_RESTORE_EXPIRED'));
 assert(f.get(root).projectTrash);assert(f.get(child));
});
await test('disabled account, lost space ownership and canonical shared binding fail closed',async()=>{
 for(const variant of ['disabled','space','shared']){const f=fixture(),cmd=await f.command('trash');
 if(variant==='disabled')f.set('users/'+scope.uid,{uid:scope.uid,status:{disabled:true}});
 if(variant==='space'){f.set('users/'+scope.uid+'/publishing/catalogue',{spaceIds:['space_a'],assignments:{[scope.projectId]:'space_a'}});f.set('publishing_spaces/space_a',{ownerUid:'other'});}
 if(variant==='shared')f.set(root+'/authoringLocks/current',{sentinel:true});
 await assert.rejects(f.run(cmd));assert(!f.get(root).projectTrash);
 }
});
await test('private source stays immutable; trash and restore fence stale saves',async()=>{
 const f=fixture();const plan=await f.maintenance.inspectMigration(scope);await f.maintenance.migrate(scope,plan.planHash);
 const originalHead=f.get(head),objects=structuredClone(f.rawBucket.objects);await f.run(await f.command('trash'));
 await assert.rejects(f.service.access({uid:scope.uid},scope.projectId),error('PROJECT_TRASHED'));
 await f.run(await f.command('restore'));assert.equal(f.get(head).revision,originalHead.revision+2);assert.deepEqual(f.rawBucket.objects,objects);
 const snapshot=await createPrivateAuthoringSnapshot(f.source);
 await assert.rejects(f.service.save({uid:scope.uid},scope.projectId,{snapshot,requestId:'stale_save',generationId:scope.generationId,baseRevision:originalHead.revision}));
 const c=await f.service.access({uid:scope.uid},scope.projectId);const loaded=await f.service.load({uid:scope.uid},scope.projectId,c);assert.deepEqual(JSON.parse(new TextDecoder().decode(loaded.bytes)).blocks,f.source.blocks);
});
await test('lost response preserves exact request and restores once; HTTP auth/origin/size boundaries',async()=>{
 const f=fixture(),api=createProjectTrashApi({verifyToken:async t=>{assert.equal(t,'token');return {uid:scope.uid};},service:f.trash}),env={PUBLISHING_SPACES_ENABLED:'true'};
 let lost=true;const bodies=[];const user={uid:scope.uid,getIdToken:async()=> 'token'};
 const client=createProjectTrashClient({getUser:()=>user,fetchImpl:async(url,opts)=>{const body=JSON.parse(opts.body);bodies.push(body);const response=await api({env,request:new Request('https://studio.test'+url,opts)});if(body.kind==='trash'&&lost){lost=false;throw Error('response lost');}return response;}});
 await assert.rejects(client('trash',scope.projectId));const deadline=f.get(root).projectTrash.restoreUntilMs;f.advance(20000);await client('trash',scope.projectId);assert.equal(f.get(root).projectTrash.restoreUntilMs,deadline);assert.deepEqual(bodies[1],bodies[2]);
 const base={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer token'},body:JSON.stringify({kind:'context',projectId:scope.projectId})};
 for(const [patch,status]of [[{method:'GET',body:undefined},405],[{headers:{'Content-Type':'application/json'}},401],[{headers:{...base.headers,Origin:'https://other.test'}},403],[{body:'x'.repeat(4097)},413]])assert.equal((await api({env,request:new Request('https://studio.test/api/project-trash',{...base,...patch})})).status,status);
});

await test('legacy v5 root source and assigned space survive; lost ownership blocks restoration',async()=>{
 const f=fixture();f.set(root,{...f.get(root),version:5,blocks:[{id:'fixed',bodyKind:'image',src:'asset.webp'}],pages:[{id:'fixed_page'}]});
 f.set('users/'+scope.uid+'/publishing/catalogue',{spaceIds:['space_a'],assignments:{[scope.projectId]:'space_a'}});f.set('publishing_spaces/space_a',{ownerUid:scope.uid});
 const source=structuredClone(f.get(root));await f.run(await f.command('trash'));
 f.set('publishing_spaces/space_a',{ownerUid:'other'});await assert.rejects(f.run({kind:'context',projectId:scope.projectId}),error('SPACE_FORBIDDEN'));
 f.set('publishing_spaces/space_a',{ownerUid:scope.uid});await f.run(await f.command('restore'));assert.deepEqual(f.get(root),{...source,projectTrash:null});
});
