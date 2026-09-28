import assert from 'node:assert/strict';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {attachSharedEditorFixture} from './fixtures/shared-editor-fixture.js';
import {createSharedEditLock} from '../server/shared-edit-lock.js';
import {resolveSpaceWorkAccess} from '../server/publishing-space-directory.js';
import {createInvitationRolloutGuard} from '../server/publishing-invitations-rollout.js';
const spaceId='space_demo',target='reader_1';let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const setup=async()=>{const f=invitationsFixture();const id='inv_'+crypto.randomUUID();await f.call('owner_1',{kind:'invite',id,spaceId,recipientUid:target,role:'member',grants:[{role:'editor',scope:'space'}],expiryDays:7});await f.call(target,{kind:'accept',id});return {f,id};};
const preview=(f,uid,memberUid=target)=>f.directory.memberExit({uid},{kind:'getMemberExit',spaceId,memberUid});
const command=async(f,uid,kind='removeMember',memberUid=target)=>({kind,spaceId,memberUid,expectedToken:(await preview(f,uid,memberUid)).memberToken,requestId:crypto.randomUUID()});
const run=(f,uid,c)=>f.directory.memberExit({uid},c);
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
await test('owner removal preserves source, bindings, invite and other members',async()=>{
 const {f,id}=await setup(),before=new Map([...f.docs].map(([k,v])=>[k,JSON.stringify(v)])),c=await command(f,'owner_1');
 assert.equal((await run(f,'owner_1',c)).status,'revoked');
 assert.equal(f.docs.get('users/'+target+'/spaceMemberships/'+spaceId).endRequestId,c.requestId);
 for(const [k,v] of before)if(k!=='users/'+target+'/spaceMemberships/'+spaceId)assert.equal(JSON.stringify(f.docs.get(k)),v,k);
 assert.deepEqual(await run(f,'owner_1',c),{spaceId,memberUid:target,status:'revoked'});
 assert.equal([...f.docs.keys()].filter(k=>k.includes('/memberExitChanges/')).length,1);
 await f.call(target,{kind:'accept',id});assert.equal(f.docs.get('users/'+target+'/spaceMemberships/'+spaceId).status,'revoked');
 assert.equal((await f.directory.listJoinedSpaces({uid:target})).items.length,0);
 await rejects(f.db.transaction(tx=>resolveSpaceWorkAccess(tx,{actorUid:target,spaceId,workId:'work_library',action:'readWork'})),'SPACE_FORBIDDEN');
});
await test('member and administrator can leave; self-removal and owner leave forbidden',async()=>{
 for(const uid of [target,'admin_1']){const {f}=await setup(),c=await command(f,uid,'leaveSpace',uid);assert.equal((await run(f,uid,c)).status,'left');assert.equal((await run(f,uid,c)).status,'left');}
 const {f}=await setup();await rejects(preview(f,'owner_1','owner_1'),'MEMBER_FORBIDDEN');
 const c=await command(f,target,'leaveSpace');await rejects(run(f,target,{...c,kind:'removeMember'}),'MEMBER_FORBIDDEN');
 await rejects(run(f,'owner_1',{...c,kind:'leaveSpace'}),'MEMBER_FORBIDDEN');
});
await test('owner may remove administrator; admin cannot remove peer or owner',async()=>{
 const {f}=await setup();await run(f,'owner_1',await command(f,'owner_1','removeMember','admin_1'));
 const {f:g}=await setup();g.docs.set('users/reader_2/spaceMemberships/'+spaceId,{uid:'reader_2',spaceId,role:'admin',status:'active',grants:[]});
 await rejects(preview(g,'admin_1','reader_2'),'MEMBER_FORBIDDEN');await rejects(preview(g,'admin_1','owner_1'),'MEMBER_FORBIDDEN');
 await run(g,'admin_1',await command(g,'admin_1'));assert.equal(g.docs.get('users/'+target+'/spaceMemberships/'+spaceId).status,'revoked');
});
await test('stale scope token, role promotion and reused request ID rejected',async()=>{
 const {f}=await setup(),c=await command(f,'admin_1');f.docs.get('users/'+target+'/spaceMemberships/'+spaceId).grants[0].role='viewer';
 await rejects(run(f,'admin_1',c),'MEMBER_CONFLICT');
 const d=await command(f,'admin_1');Object.assign(f.docs.get('users/'+target+'/spaceMemberships/'+spaceId),{role:'admin',grants:[]});await rejects(run(f,'admin_1',d),'MEMBER_FORBIDDEN');
 const o=await command(f,'owner_1');await run(f,'owner_1',o);await rejects(run(f,'owner_1',{...o,expectedToken:'0'.repeat(64)}),'MEMBER_CONFLICT');
});
await test('fresh invitation required for rejoin; old removal cannot affect new membership',async()=>{
 const {f}=await setup(),c=await command(f,'owner_1');await run(f,'owner_1',c);
 const id='inv_'+crypto.randomUUID();await f.call('owner_1',{kind:'invite',id,spaceId,recipientUid:target,role:'member',grants:[{role:'viewer',scope:'space'}],expiryDays:7});await f.call(target,{kind:'accept',id});
 await rejects(run(f,'owner_1',c),'MEMBER_CONFLICT');assert.equal(f.docs.get('users/'+target+'/spaceMemberships/'+spaceId).status,'active');
});
await test('concurrent exits serialize; two different commands cannot both commit',async()=>{
 const {f}=await setup(),a=await command(f,'owner_1'),b=await command(f,target,'leaveSpace');
 const results=await Promise.allSettled([run(f,'owner_1',a),run(f,target,b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
await test('account disabled and owner unavailable reject both preview and execute',async()=>{
 const {f}=await setup(),c=await command(f,'owner_1');f.docs.get('users/owner_1').status.disabled=true;await rejects(run(f,'owner_1',c),'ACCOUNT_UNAVAILABLE');await rejects(preview(f,target),'SPACE_FORBIDDEN');
});
await test('revoked editor lock reclaimed immediately and old fence never revives after rejoin',async()=>{
 const {f}=await setup();await attachSharedEditorFixture(f);
 const locks=createSharedEditLock({db:f.db,assertLiveIdentity:f.assertLiveIdentity,spaceId,workId:'work_library'});
 const old=await locks.execute({uid:target},{sessionId:'reader_session',action:'acquire'}),oldFence=old.lock.fence;
 await run(f,'owner_1',await command(f,'owner_1'));
 assert.equal((await locks.status({uid:'owner_1'},'owner_session')).lock.canTakeover,true);
 const id='inv_'+crypto.randomUUID();await f.call('owner_1',{kind:'invite',id,spaceId,recipientUid:target,role:'member',grants:[{role:'editor',scope:'space'}],expiryDays:7});await f.call(target,{kind:'accept',id});
 await rejects(f.db.transaction(tx=>locks.assertWrite(tx,{uid:target},'reader_session',oldFence)),'EDIT_LOCK_LOST');
 assert((await locks.execute({uid:'owner_1'},{sessionId:'owner_session',action:'acquire'})).canEdit);
});
await test('HTTP endpoint and rollout remain restricted to designated accounts and space',async()=>{
 const {f}=await setup(),c=await command(f,'owner_1');
 const response=await f.handler({env:f.env,request:new Request('https://local.test/api/invitations',{method:'POST',headers:{Authorization:'Bearer fixture-owner_1','Content-Type':'application/json'},body:JSON.stringify(c)})});assert.equal(response.status,200);
 const guard=createInvitationRolloutGuard({db:f.db,scope:{spaceId,ownerUid:'owner_1',recipientUid:target,recipientHandle:'sato'}});
 await guard({uid:'owner_1'},c);await guard({uid:target},{kind:'leaveSpace',spaceId});
 await rejects(guard({uid:'owner_1'},{...c,memberUid:'admin_1'}),'INVITATION_TEST_ONLY');
 await rejects(guard({uid:target},{...c,kind:'removeMember'}),'INVITATION_TEST_ONLY');
 await rejects(guard({uid:target},{kind:'leaveSpace',spaceId:'space_other'}),'INVITATION_TEST_ONLY');
});
console.log(count+' membership lifecycle tests passed.');
