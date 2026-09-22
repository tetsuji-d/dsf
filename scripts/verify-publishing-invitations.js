import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {canAccessPublishingSpace} from '../js/publishing-space-access.js';
let seq=0;const command=(extra={})=>({kind:'invite',id:'inv_test-000000000000'+(++seq),spaceId:'space_demo',recipientUid:'reader_1',role:'member',grants:[{role:'editor',scope:'label',targetId:'label_sea'}],expiryDays:7,...extra});
const fails=async(p,code)=>assert.rejects(p,e=>e.code===code);
const f=invitationsFixture(), c=command();
await fails(f.call('reader_1',c),'SPACE_FORBIDDEN');
await fails(f.call('owner_1',command({recipientUid:'nobody'})),'RECIPIENT_UNAVAILABLE');
await fails(f.call('admin_1',command({role:'admin',grants:[]})),'GRANT_FORBIDDEN');
await fails(f.call('owner_1',command({grants:[{role:'editor',scope:'work',targetId:'work_other'}]})),'WORK_FORBIDDEN');
await fails(f.call('owner_1',command({grants:[{role:'owner',scope:'space'}]})),'INVALID_GRANTS');
for(const expiryDays of [31,0,-1,1.5,'none','7',undefined]) await fails(f.call('owner_1',command({expiryDays})),'INVALID_EXPIRY');
assert.deepEqual((await f.call('reader_1',{kind:'inbox'})).items,[]);
const initial=await f.call('owner_1',c);assert.equal(initial.invitation.status,'pending');
await f.call('owner_1',c);assert.equal((await f.call('reader_1',{kind:'inbox'})).unreadCount,1);
await fails(f.call('owner_1',command()),'INVITATION_PENDING');
await fails(f.call('owner_1',{...c,role:'admin',grants:[]}),'INVITATION_CONFLICT');
await fails(f.call('reader_2',{kind:'accept',id:c.id}),'INVITATION_NOT_FOUND');
await fails(f.call('reader_2',{kind:'read',id:c.id}),'INVITATION_NOT_FOUND');
await fails(f.call('reader_1',{kind:'outbox',spaceId:'space_demo'}),'SPACE_FORBIDDEN');
assert.equal((await f.call('reader_2',{kind:'inbox'})).unreadCount,0);
await f.call('reader_1',{kind:'read',id:c.id});await f.call('reader_1',{kind:'read',id:c.id});
assert.equal((await f.call('reader_1',{kind:'inbox'})).unreadCount,0);
assert.equal(f.docs.has('users/reader_1/spaceMemberships/space_demo'),false,'reading must not join');
await f.call('reader_1',{kind:'accept',id:c.id});await f.call('reader_1',{kind:'accept',id:c.id});
const membership=f.docs.get('users/reader_1/spaceMemberships/space_demo');assert.equal(membership.status,'active');
assert.equal(canAccessPublishingSpace({actorUid:'reader_1',space:{id:'space_demo',ownerUid:'owner_1'},member:membership},'editWork',{id:'work_library',spaceId:'space_demo',labelId:'label_sea'}),true);
assert.equal(canAccessPublishingSpace({actorUid:'reader_1',space:{id:'space_demo',ownerUid:'owner_1'},member:membership},'editWork',{id:'work_else',spaceId:'space_demo',labelId:null}),false);
await fails(f.call('owner_1',{kind:'cancel',id:c.id}),'INVITATION_CLOSED');
await fails(f.call('owner_1',command()),'ALREADY_MEMBER');
const restored=invitationsFixture({initialDocs:[...f.docs]});assert.equal((await restored.call('reader_1',{kind:'inbox'})).items[0].invitation.status,'accepted');
for(const outcome of ['cancel','decline']){
 const g=invitationsFixture(),x=command();await g.call('owner_1',x);
 await g.call(outcome==='cancel'?'owner_1':'reader_1',{kind:outcome,id:x.id});
 await fails(g.call('reader_1',{kind:'accept',id:x.id}),'INVITATION_CLOSED');
 assert.equal(g.docs.has('users/reader_1/spaceMemberships/space_demo'),false);
 assert.equal((await g.call('reader_1',{kind:'inbox'})).items[0].invitation.status,outcome==='cancel'?'cancelled':'declined');
}
{
 const g=invitationsFixture(),x=command();await g.call('owner_1',x);g.advance(8*86400000);
 assert.equal((await g.call('reader_1',{kind:'inbox'})).items[0].invitation.status,'expired');
 await fails(g.call('reader_1',{kind:'accept',id:x.id}),'INVITATION_CLOSED');await g.call('owner_1',command());
}
for(const expiryDays of [1,3]){
 const g=invitationsFixture(),x=command({expiryDays});const {invitation}=await g.call('owner_1',x);
 assert.equal(invitation.expiresAt-invitation.createdAt,expiryDays*86400000);
 g.advance(expiryDays*86400000-1);
 assert.equal((await g.call('reader_1',{kind:'inbox'})).items[0].invitation.status,'pending');
 g.advance(1);
 await fails(g.call('reader_1',{kind:'accept',id:x.id}),'INVITATION_CLOSED');
}
for(const outcome of ['accept','cancel','decline','revoked']){
 const g=invitationsFixture(),x=command({expiryDays:null});const {invitation}=await g.call('owner_1',x);
 assert.equal(invitation.expiresAt,null);g.advance(3650*86400000);
 assert.equal((await g.call('owner_1',x)).invitation.status,'pending','unlimited retry stays pending');
 await fails(g.call('owner_1',{...x,expiryDays:7}),'INVITATION_CONFLICT');
 const restored=invitationsFixture({initialDocs:[...g.docs]});
 assert.equal((await restored.call('reader_1',{kind:'inbox'})).items[0].invitation.expiresAt,null);
 if(outcome==='revoked'){
  g.docs.get('users/owner_1').status.disabled=true;
  await fails(g.call('reader_1',{kind:'accept',id:x.id}),'INVITER_UNAVAILABLE');
 }else{
  await g.call(outcome==='cancel'?'owner_1':'reader_1',{kind:outcome,id:x.id});
  if(outcome!=='accept')await fails(g.call('reader_1',{kind:'accept',id:x.id}),'INVITATION_CLOSED');
 }
}
for(const invalidation of ['suspended','role','target','membership']){
 const g=invitationsFixture(),x=command();await g.call('admin_1',x);
 if(invalidation==='suspended')g.docs.get('users/admin_1').status.disabled=true;
 if(invalidation==='role')g.docs.get('users/admin_1/spaceMemberships/space_demo').role='member';
 if(invalidation==='target')g.docs.get('publishing_labels/label_sea').spaceId='space_else';
 if(invalidation==='membership')g.docs.set('users/reader_1/spaceMemberships/space_demo',{status:'active'});
 await fails(g.call('reader_1',{kind:'accept',id:x.id}),invalidation==='target'?'INVALID_TARGET':invalidation==='membership'?'ALREADY_MEMBER':'INVITER_UNAVAILABLE');
}
{
 const g=invitationsFixture({allowActivation:false}),x=command();await g.call('owner_1',x);
 await fails(g.call('reader_1',{kind:'accept',id:x.id}),'SHARING_NOT_READY');
 assert.equal(g.docs.has('users/reader_1/spaceMemberships/space_demo'),false);
}
{
 const g=invitationsFixture(),x=command();await g.call('owner_1',x);
 const result=await Promise.allSettled([g.call('owner_1',{kind:'cancel',id:x.id}),g.call('reader_1',{kind:'accept',id:x.id})]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1,'accept/cancel serialize');
 assert.equal(g.docs.get('publishing_invitations/'+x.id).status,'cancelled');
}
{
 const g=invitationsFixture({persist:async()=>{throw new Error('disk unavailable');}}),before=[...g.docs];
 await assert.rejects(g.call('owner_1',command()));assert.deepEqual([...g.docs],before,'no partial invitation/notification');
}
{
 const g=invitationsFixture();for(let i=0;i<25;i++){const x=command();await g.call('owner_1',x);await g.call('owner_1',{kind:'cancel',id:x.id});}
 const a=await g.call('reader_1',{kind:'inbox'}),b=await g.call('reader_1',{kind:'inbox',cursor:a.nextCursor});
 assert.equal(a.items.length,20);assert.equal(b.items.length,5);assert.equal(b.nextCursor,null);assert.equal(a.unreadCount,25);
 assert.equal(new Set([...a.items,...b.items].map(n=>n.id)).size,25);
 g.docs.set('users/owner_1/invitationUsage/current',{day:Math.floor(Date.now()/86400000),count:30});
 await fails(g.call('owner_1',command()),'INVITE_RATE_LIMIT');
}
{
 const g=invitationsFixture(),request=(token='fixture-reader_1',origin='http://localhost',env=g.env)=>g.handler({env,request:new Request('http://localhost/api/invitations',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({kind:'inbox'})})});
 assert.equal((await request()).status,200);assert.equal((await request('bad')).status,401);
 assert.equal((await request('fixture-reader_1','https://evil.example')).status,403);
 assert.equal((await request('fixture-reader_1','http://localhost',{})).status,503);
 g.revoke();assert.equal((await request()).status,401);
}
{
 const dir=await mkdtemp(join(tmpdir(),'dsf-invitation-test-')),file=join(dir,'state.json');
 const g=invitationsFixture({persist:docs=>writeFile(file,JSON.stringify(docs))}),x=command();
 await g.call('owner_1',x);await g.call('reader_1',{kind:'read',id:x.id});
 const restored=invitationsFixture({initialDocs:JSON.parse(await readFile(file,'utf8'))});
 const inbox=await restored.call('reader_1',{kind:'inbox'});assert.equal(inbox.unreadCount,0);assert.equal(inbox.items[0].invitation.status,'pending');
 await restored.call('reader_1',{kind:'accept',id:x.id});
}
console.log('Invitation service passed: atomic persistence, restore, private inbox, unread state, scoped grants, expiry, revocation, races, retries, rate limits, pagination and disabled activation.');
