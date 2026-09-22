import assert from 'node:assert/strict';
import {fixture} from './fixtures/private-authoring-api-fixture.js';
import {createSharedAuthoringService} from '../server/shared-authoring.js';
import {createAuthoringBucket} from '../server/private-authoring/r2.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
import {createSpaceDirectoryService,resolveSpaceWorkAccess} from '../server/publishing-space-directory.js';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
const fails=(p,code)=>assert.rejects(p,e=>e.code===code);
async function setup(){
 const f=fixture();await f.request();
 const owner=f.db.docs.get('users/owner_1');owner.status.moderationHold=false;owner.entitlements={canCreateProject:true};
 for(const uid of ['editor','viewer','stranger'])f.db.docs.set('users/'+uid,{uid,status:{disabled:false},entitlements:{canCreateProject:true}});
 f.db.docs.set('publishing_spaces/space_1',{ownerUid:'owner_1',name:'Test space'});
 f.db.docs.set('users/owner_1/publishing/catalogue',{spaceIds:['space_1'],assignments:{project_1:'space_1'}});
 f.db.docs.set('publishing_work_scopes/work_1',{spaceId:'space_1',ownerUid:'owner_1',projectId:'project_1',workId:'work_1',labelId:'label_1'});
 f.db.docs.set('publishing_labels/label_1',{spaceId:'space_1',name:'Label'});
 f.db.docs.set('publishing_space_catalogues/space_1',{schemaVersion:1,workIds:['work_1']});
 for(const [uid,role]of [['editor','editor'],['viewer','viewer']])f.db.docs.set('users/'+uid+'/spaceMemberships/space_1',{uid,spaceId:'space_1',status:'active',role:'member',grants:[{role,scope:'label',targetId:'label_1'}]});
 const checked=[];let authLive=true;
 const shared=createSharedAuthoringService({db:f.db,bucket:createAuthoringBucket(f.r2),spaceId:'space_1',workId:'work_1',assertLiveIdentity:async i=>{checked.push(i.uid);if(!authLive)throw Object.assign(new Error(),{code:'AUTH_REVOKED'});}});
 return {...f,shared,checked,revokeShared:()=>authLive=false};
}
{
 const f=await setup(),viewer={uid:'viewer'},editor={uid:'editor'};
 await fails(f.shared.access({uid:'stranger'},'project_1'),'SPACE_FORBIDDEN');
 await fails(f.shared.access(editor,'forged_project'),'WORK_FORBIDDEN');
 await fails(f.shared.access(viewer,'project_1',{write:true}),'WORK_FORBIDDEN');
 const ctx=await f.shared.access(viewer,'project_1'),loaded=await f.shared.load(viewer,'project_1',ctx);
 assert(new TextDecoder().decode(loaded.bytes).includes('PRIVATE_MANUSCRIPT_SENTINEL'));
 const project={...f.project,title:'Shared edit'},snapshot=await createPrivateAuthoringSnapshot(project);
 const save={snapshot,requestId:'shared_request',generationId:'generation_1',baseRevision:1};
 await fails(f.shared.save(viewer,'project_1',save),'WORK_FORBIDDEN');
 const r=await f.shared.save(editor,'project_1',save);assert.equal(r.currentHead.revision,2);
 assert.equal(f.db.docs.get('users/owner_1/projects/project_1').title,'Shared edit');
 assert.equal(f.db.docs.get('users/owner_1/projects/project_1/authoringRevisions/shared_request').actorUid,'editor');
 assert.equal(f.db.docs.get('users/owner_1/works/work_1').latestReleaseId,'published_release');
 assert.equal(f.db.docs.has('users/editor/projects/project_1'),false,'storage ownership retained');
 assert.equal((await f.shared.save(editor,'project_1',save)).currentHead.revision,2);
 await fails(f.shared.access(viewer,'project_1',{requestId:'shared_request',generationId:'generation_1'}),'OPERATION_FORBIDDEN');
 assert(f.checked.every(uid=>uid==='viewer'||uid==='editor'||uid==='stranger'),'Auth always checks actual actor');
}
for(const phase of ['beforeLoad','duringLoad','duringSave']){
 const f=await setup(),actor={uid:'editor'},ctx=await f.shared.access(actor,'project_1');
 const revoke=()=>f.db.docs.get('users/editor/spaceMemberships/space_1').status='revoked';
 if(phase==='beforeLoad'){revoke();const gets=f.r2.gets;await fails(f.shared.load(actor,'project_1',ctx),'SPACE_FORBIDDEN');assert.equal(f.r2.gets,gets);}
 if(phase==='duringLoad'){f.r2.afterGet=revoke;await fails(f.shared.load(actor,'project_1',ctx),'SPACE_FORBIDDEN');}
 if(phase==='duringSave'){
  f.r2.afterPut=revoke;const snapshot=await createPrivateAuthoringSnapshot({...f.project,title:'Must not commit'});
  await fails(f.shared.save(actor,'project_1',{snapshot,requestId:'revoked_save',generationId:'generation_1',baseRevision:1}),'SPACE_FORBIDDEN');
  assert.equal(f.db.docs.get('users/owner_1/projects/project_1/authoringHeads/current').revision,1);assert.notEqual(f.db.docs.get('users/owner_1/projects/project_1').title,'Must not commit');
 }
}
for(const mutation of ['assignment','bindingOwner','workOwner','label','disabled','entitlement']){
 const f=await setup();
 if(mutation==='assignment')f.db.docs.get('users/owner_1/publishing/catalogue').assignments.project_1='other_space';
 if(mutation==='bindingOwner')f.db.docs.get('publishing_work_scopes/work_1').ownerUid='stranger';
 if(mutation==='workOwner')f.db.docs.get('users/owner_1/works/work_1').ownerUid='stranger';
 if(mutation==='label')f.db.docs.get('publishing_labels/label_1').spaceId='other_space';
 if(mutation==='disabled')f.db.docs.get('users/editor').status.disabled=true;
 if(mutation==='entitlement')f.db.docs.get('users/editor').entitlements.canCreateProject=false;
 await fails(f.shared.access({uid:'editor'},'project_1',{write:true}),mutation==='disabled'?'ACCOUNT_UNAVAILABLE':mutation==='entitlement'?'EDIT_FORBIDDEN':'WORK_FORBIDDEN');
}
{
 const f=invitationsFixture(),owner={uid:'owner_1'};
 let r=await f.directory.resolveRecipient(owner,{spaceId:'space_demo',handle:'@sato'});assert.deepEqual(Object.keys(r.recipient).sort(),['displayName','handle','uid']);assert.equal(r.recipient.uid,'reader_1');
 assert.equal((await f.directory.resolveRecipient(owner,{spaceId:'space_demo',handle:'missing_handle'})).recipient,null);
 await fails(f.directory.resolveRecipient({uid:'reader_1'},{spaceId:'space_demo',handle:'sato'}),'SPACE_FORBIDDEN');
 f.docs.get('handles/sato').uid='reader_2';assert.equal((await f.directory.resolveRecipient(owner,{spaceId:'space_demo',handle:'sato'})).recipient,null);
 for(let i=0;i<17;i++)await f.directory.resolveRecipient(owner,{spaceId:'space_demo',handle:'missing_handle'});
 await fails(f.directory.resolveRecipient(owner,{spaceId:'space_demo',handle:'sato'}),'LOOKUP_RATE_LIMIT');
}
{
 const f=invitationsFixture();await f.call('owner_1',{kind:'invite',id:'inv_access-00000000001',recipientUid:'reader_1',spaceId:'space_demo',role:'member',grants:[{role:'viewer',scope:'work',targetId:'work_library'}],expiryDays:7});
 await fails(f.directory.listWorks({uid:'reader_1'},{spaceId:'space_demo'}),'SPACE_FORBIDDEN');
 await f.call('reader_1',{kind:'accept',id:'inv_access-00000000001'});
 const view=await f.directory.listWorks({uid:'reader_1'},{spaceId:'space_demo'});assert.equal(view.total,1);assert.equal(view.items[0].workId,'work_library');assert.equal(view.items[0].canEdit,false);assert(!JSON.stringify(view).includes('夜明け'));
 await fails(f.db.transaction(tx=>resolveSpaceWorkAccess(tx,{actorUid:'reader_1',spaceId:'space_demo',workId:'work_notes',action:'readWork'})),'WORK_FORBIDDEN');
 f.docs.get('users/owner_1/publishing/catalogue').assignments.book_library='other_space';assert.equal((await f.directory.listWorks({uid:'reader_1'},{spaceId:'space_demo'})).total,0);
}
{
 const f=await setup(),directory=createSpaceDirectoryService({db:f.db,assertLiveIdentity:async()=>{}});
 // The first 25 registry entries are hidden. Page 1 must still contain 20 accessible works.
 const ids=[];for(let i=0;i<50;i++){
  const id='work_'+i,pid='project_'+i;ids.push(id);
  f.db.docs.set('publishing_work_scopes/'+id,{spaceId:'space_1',ownerUid:'owner_1',projectId:pid,workId:id,labelId:i<25?null:'label_1'});
  f.db.docs.set('users/owner_1/projects/'+pid,{ownerUid:'owner_1',projectId:pid,workId:id,title:(i<25?'SECRET':'Allowed')+i});
  f.db.docs.set('users/owner_1/works/'+id,{ownerUid:'owner_1',projectId:pid});f.db.docs.get('users/owner_1/publishing/catalogue').assignments[pid]='space_1';
 }
 f.db.docs.get('publishing_space_catalogues/space_1').workIds=ids;
 const first=await directory.listWorks({uid:'viewer'},{spaceId:'space_1'}),second=await directory.listWorks({uid:'viewer'},{spaceId:'space_1',afterId:first.nextCursor});
 assert.equal(first.total,25);assert.equal(first.items.length,20);assert.equal(second.items.length,5);assert(!JSON.stringify(first).includes('SECRET'));assert.equal(second.nextCursor,null);
}
console.log('Shared access passed: handle lookup, private filtered listings, invitation-to-membership, real authoring save/load pipeline, actor audit, source ownership, revocation before/during I/O, and owner API isolation.');
