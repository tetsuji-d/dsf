import assert from 'node:assert/strict';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {createInvitationStore,handlePublishingInvitations} from '../server/publishing-invitations-runtime.js';
const f=invitationsFixture(),owner={uid:'owner_1'};
let calls=0;const query=f.db.listMemberPaths;f.db.listMemberPaths=async(...args)=>{calls++;return query(...args);};
await assert.rejects(f.directory.listMembers({uid:'reader_1'},{spaceId:'space_demo'}),e=>e.code==='SPACE_FORBIDDEN');assert.equal(calls,0);
const first=await f.directory.listMembers(owner,{spaceId:'space_demo'});assert.equal(first.owner.uid,'owner_1');assert.equal(first.items[0].uid,'admin_1');assert(!JSON.stringify(first).includes('email'));
const id='inv_'+crypto.randomUUID();await f.call('owner_1',{kind:'invite',id,spaceId:'space_demo',recipientUid:'reader_1',role:'member',grants:[{scope:'work',targetId:'work_library',role:'viewer'}],expiryDays:1});
await f.call('reader_1',{kind:'accept',id});assert((await f.directory.listMembers(owner,{spaceId:'space_demo'})).items.some(m=>m.uid==='reader_1'));
await assert.rejects(f.directory.listMembers({uid:'reader_1'},{spaceId:'space_demo'}),e=>e.code==='SPACE_FORBIDDEN');
for(let i=0;i<25;i++){const uid='test_'+String(i).padStart(2,'0');f.docs.set('users/'+uid,{uid,status:{disabled:false},publicProfile:{displayName:uid}});f.docs.set('users/'+uid+'/spaceMemberships/space_demo',{uid,spaceId:'space_demo',status:'active',role:'member',grants:[{scope:'space',role:'viewer'}]});}
const page1=await f.directory.listMembers(owner,{spaceId:'space_demo'}),page2=await f.directory.listMembers(owner,{spaceId:'space_demo',afterUid:page1.nextCursor});assert.equal(new Set([...page1.items,...page2.items].map(m=>m.uid)).size,27);
f.db.listMemberPaths=async(...args)=>{const result=await query(...args);f.docs.get('users/owner_1').status.disabled=true;return result;};
await assert.rejects(f.directory.listMembers(owner,{spaceId:'space_demo'}),e=>e.code==='ACCOUNT_UNAVAILABLE');
let request;const store=createInvitationStore({projectId:'test',post:async(url,body)=>{request={url,body};return [{document:{name:'projects/test/databases/(default)/documents/users/person/spaceMemberships/space_demo'}}];}});
assert.deepEqual(await store.listMemberPaths('space_demo','before'),['users/person/spaceMemberships/space_demo']);assert(request.url.endsWith('/documents:runQuery'));assert.equal(request.body.structuredQuery.where.fieldFilter.value.stringValue,'space_demo');assert.equal(request.body.structuredQuery.limit,21);
assert.equal(request.body.structuredQuery.startAt.before,false);
const disabled=await handlePublishingInvitations({env:{},request:new Request('https://studio.test/api/invitations')});assert.equal(disabled.status,503);
console.log('Members passed: manager-only listing, accepted member, pagination, private fields, revocation during query, REST query scope, disabled rollout.');

const {createInvitationsClient}=await import('../js/publishing-invitations-transport.js');
let user={uid:'one',getIdToken:async()=> 'token'},finish;
const clientRequest=createInvitationsClient({getUser:()=>user,fetchImpl:()=>new Promise(r=>finish=r)});
const pending=clientRequest({kind:'inbox'});await new Promise(r=>setTimeout(r,0));
user={uid:'two',getIdToken:async()=> 'other'};finish(Response.json({items:[]}));await assert.rejects(pending,/AUTH_CHANGED/);
console.log('Invitation client rejects a late response after account switching.');
