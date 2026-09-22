import assert from 'node:assert/strict';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {attachSharedEditorFixture} from './fixtures/shared-editor-fixture.js';
import {createSharedEditLock,EDIT_LOCK_TTL,EDIT_LOCK_IDLE} from '../server/shared-edit-lock.js';
import {createSharedAuthoringApi} from '../server/shared-authoring-http.js';
let clock=Date.now();const f=invitationsFixture(),shared=await attachSharedEditorFixture(f);
for(const uid of ['reader_1','reader_2'])f.docs.set(`users/${uid}/spaceMemberships/space_demo`,{uid,spaceId:'space_demo',status:'active',role:'member',grants:[{role:'editor',scope:'work',targetId:'work_library'}]});
const locks=createSharedEditLock({db:f.db,assertLiveIdentity:f.assertLiveIdentity,spaceId:'space_demo',workId:'work_library',now:()=>clock});
const a={uid:'reader_1'},b={uid:'reader_2'},A='session_a',B='session_b',T='session_other_tab';
const act=(actor,sessionId,action,extra={})=>locks.execute(actor,{sessionId,action,...extra});
const reject=(p,code)=>assert.rejects(p,e=>e.code===code);
const initial=await locks.status(a,A);assert.equal(initial.canEdit,false);assert.equal(initial.lock.canTakeover,true);
const results=await Promise.allSettled([act(a,A,'acquire'),act(b,B,'acquire')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
let status=await locks.status(a,A);assert.equal(status.canEdit,true);let fence=status.lock.fence;
assert.equal((await locks.status(b,B)).lock.fence,undefined,'never disclose other session fence');
await reject(act(a,T,'heartbeat',{fence}),'EDIT_LOCK_LOST');
await reject(act(a,T,'acquire'),'EDIT_LOCK_HELD');
await reject(act(b,B,'release',{fence}),'EDIT_LOCK_LOST');
const requested=await act(b,B,'request');assert(requested.lock.requestPending);
const request=(await locks.status(a,A)).lock.requestId;
await reject(act(a,A,'grant',{fence,requestId:'outdated_request'}),'EDIT_REQUEST_UNAVAILABLE');
await act(a,A,'grant',{fence,requestId:request});
await reject(act(a,A,'heartbeat',{fence}),'EDIT_LOCK_LOST');
await reject(f.db.transaction(tx=>locks.assertWrite(tx,a,A,fence)),'EDIT_LOCK_LOST');
status=await locks.status(b,B);assert(status.canEdit);fence=status.lock.fence;
// Heartbeats renew connectivity only, never the last-edit clock.
for(let i=0;i<31;i++){clock+=60000;await act(b,B,'heartbeat',{fence});}
assert((await locks.status(a,A)).lock.canTakeover);
await act(a,A,'acquire');await reject(act(b,B,'edited',{fence}),'EDIT_LOCK_LOST');
fence=(await locks.status(a,A)).lock.fence;
clock+=EDIT_LOCK_TTL+1;await reject(act(a,A,'heartbeat',{fence}),'EDIT_LOCK_LOST');
await act(b,B,'acquire');let current=(await locks.status(b,B)).lock.fence;
await act(a,A,'request');f.docs.get('users/reader_1/spaceMemberships/space_demo').grants[0].role='viewer';
await reject(act(a,A,'acquire'),'EDIT_FORBIDDEN');
await reject(act(b,B,'grant',{fence:current,requestId:(await locks.status(b,B)).lock.requestId}),'WORK_FORBIDDEN');
// HTTP enforcement applies before asset work and inside the actual source transactions.
const handler=createSharedAuthoringApi({db:f.db,privateBucket:shared.r2,verifyToken:async token=>({uid:token}),assertLiveIdentity:f.assertLiveIdentity,now:()=>clock});
const call=async(path,method='GET',body,lock=current)=>handler({env:{SHARED_AUTHORING_ENABLED:'true'},request:new Request('https://local.test/api/spaces/space_demo/works/work_library/'+path,{method,headers:{Authorization:'Bearer reader_2','X-Shared-Session':B,'X-Shared-Lock':lock,'Content-Type':path==='assets'?'image/webp':'application/json',...(path==='authoring'?{'X-Authoring-Generation':'fixture_generation','X-Authoring-Request-Id':'lock_saved','X-Authoring-Base-Revision':String(f.docs.get('users/owner_1/projects/book_library/authoringHeads/current').revision)}:{})},...(body?{body}:{})})});
assert.equal((await call('assets','POST',new Uint8Array([1]),'stale')).status,409);
const source=await(await call('authoring')).text();assert.equal((await call('authoring','PUT',source,'stale')).status,409);
assert.equal((await call('authoring','PUT',source)).status,200);
// Transfer during source upload prevents the old writer from advancing the head.
const changed=JSON.parse(source);changed.title='changed';const previous=f.docs.get('users/owner_1/projects/book_library/authoringHeads/current').revision;
const originalPut=shared.r2.put.bind(shared.r2);shared.r2.put=async(...args)=>{const result=await originalPut(...args);clock+=EDIT_LOCK_TTL+1;f.docs.get('users/reader_1/spaceMemberships/space_demo').grants[0].role='editor';await act(a,A,'acquire');return result;};
// Different request ID prevents reuse of the earlier successful receipt.
const response=await handler({env:{SHARED_AUTHORING_ENABLED:'true'},request:new Request('https://local.test/api/spaces/space_demo/works/work_library/authoring',{method:'PUT',headers:{Authorization:'Bearer reader_2','X-Shared-Session':B,'X-Shared-Lock':current,'Content-Type':'application/json','X-Authoring-Generation':'fixture_generation','X-Authoring-Request-Id':'during_transfer','X-Authoring-Base-Revision':String(previous)},body:JSON.stringify(changed)})});
assert.equal(response.status,409);assert.equal(f.docs.get('users/owner_1/projects/book_library/authoringHeads/current').revision,previous);
console.log('Shared edit lock passed: simultaneous acquisition, same-account tabs, private fencing, handover, stale request, expired lease, 30-minute idle takeover, permissions, HTTP writes and transfer during source upload.');
