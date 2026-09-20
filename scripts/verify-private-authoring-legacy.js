import assert from 'node:assert/strict';
import {test} from 'node:test';
import {maintenanceFixture} from './fixtures/private-authoring-maintenance-fixture.js';
import {createAuthoringMaintenance} from '../server/private-authoring/maintenance.js';
import {createMaintenanceBackupStore} from '../server/private-authoring/maintenance-common.js';
import {createAuthoringService} from '../server/private-authoring/service.js';
import {createAuthoringApi} from '../server/private-authoring/http.js';
import {createPrivateAuthoringSnapshot,createPrivateAuthoringDescriptor,readPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
import {assertPrivateAuthoringRoot,createPrivateAuthoringClient} from '../js/private-authoring-client.js';
import {isPrivateAuthoringId} from '../js/private-authoring-ids.js';
const scope={uid:'owner_1',projectId:'R2に移行',generationId:'generation_5'},r=`users/${scope.uid}/projects/${scope.projectId}`,w=`users/${scope.uid}/works/${scope.projectId}`;
function fixture(){
 const f=maintenanceFixture();f.docs.clear();
 const source={version:5,projectId:scope.projectId,workId:scope.projectId,languages:['ja'],defaultLang:'ja',blocks:[{id:'fixed',kind:'page',content:{pageKind:'text',text:'本文\r\n余白  😀',texts:{ja:'本文\r\n余白  😀'}}}],futurePrivate:{exact:'private extension'}};
 f.set(`users/${scope.uid}`,{uid:scope.uid,status:{disabled:false}});f.set(r,{...source,ownerUid:scope.uid,releaseId:'release_1',dsfStatus:'public',visibility:'public'});
 f.set(w,{projectId:scope.projectId,ownerUid:scope.uid});f.set(`${w}/releases/release_1`,{title:'Published'});f.set(`public_projects/${scope.projectId}`,{authorUid:scope.uid,releaseId:'release_1'});
 const maintenance=createAuthoringMaintenance({db:f.db,bucket:f.bucket,backups:createMaintenanceBackupStore(f.rawBucket),authorize:async s=>assert.deepEqual(s,scope),now:f.time});
 const service=createAuthoringService({db:f.db,bucket:f.bucket,assertLiveIdentity:async()=>{},now:f.time});
 return {...f,source,maintenance,service};
}
await test('Unicode identifiers preserve exact spelling and reject path or URL injection',()=>{
 for(const id of ['R2に移行','テスト１','abc_-'])assert(isPrivateAuthoringId(id));
 for(const id of ['../x','a/b','%2F','x?y','x#z','x\\y','x\n','.', ''])assert(!isPrivateAuthoringId(id));
});
await test('v5 root migrates without version conversion; Unicode HTTP, client, save and latest-source rollback retain publication',async()=>{
 const f=fixture(),plan=await f.maintenance.inspectMigration(scope);await f.maintenance.migrate(scope,plan.planHash);
 const migrated=f.get(r);assert.equal(migrated.version,5);assert.equal(migrated.blocks,undefined);assert.equal(f.get(`${r}/authoring/current`),null);
 assertPrivateAuthoringRoot(migrated,scope.uid,scope.projectId);
 const api=createAuthoringApi({verifyToken:async()=>({uid:scope.uid}),service:f.service});
 const env={AUTHORING_API_ENABLED:'true',AUTHORING_TEST_PROJECTS:JSON.stringify([`${scope.uid}/${scope.projectId}`])};
 const fetcher=async(url,options={})=>api({env,params:{projectId:scope.projectId},request:new Request(`https://studio.test${url}`,options)});
 const user={uid:scope.uid,getIdToken:async()=> 'test'};
 const client=createPrivateAuthoringClient({...scope,user,isCurrent:()=>true,fetcher,newRequestId:()=> 'edit_5'});
 const loaded=await client.load();assert.equal(loaded.version,5);assert.equal(loaded.blocks[0].content.text,f.source.blocks[0].content.text);assert.deepEqual(loaded.futurePrivate,f.source.futurePrivate);
 await client.save({...loaded,projectName:'最新原稿'});assert.equal(client.getHead().revision,2);
 f.set(r,{...f.get(r),releaseId:'release_2'});f.set(`${w}/releases/release_2`,{title:'New published'});
 const back=await f.maintenance.inspectRollback(scope,'restore_5');await f.maintenance.rollback(scope,'restore_5',back.planHash);
 const restored=f.get(r);assert.equal(restored.version,5);assert.equal(restored.projectName,'最新原稿');assert.equal(restored.releaseId,'release_2');assert.equal(restored.dsfStatus,'public');assert.equal(restored.authoringRef,undefined);assert.equal(f.get(`${r}/authoring/current`),null);
 assert.equal(restored.blocks[0].content.text,f.source.blocks[0].content.text);assert.deepEqual(restored.futurePrivate,f.source.futurePrivate);
 await assert.rejects(client.save(loaded),e=>e.code==='PROJECT_NOT_MIGRATED');
});
await test('descriptor cannot mislabel a v5 object as v6',async()=>{
 const snapshot=await createPrivateAuthoringSnapshot(fixture().source),descriptor=createPrivateAuthoringDescriptor(snapshot,scope,'r');
 await assert.rejects(readPrivateAuthoringSnapshot(new TextEncoder().encode(snapshot.json),{...descriptor,projectSchemaVersion:6},scope),e=>e.code==='UNSUPPORTED_AUTHORING_STORAGE');
});
