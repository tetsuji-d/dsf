import assert from 'node:assert/strict';
import {createPublishingSpacesClient} from '../js/publishing-spaces-transport.js';
import {createInvitationsClient} from '../js/publishing-invitations-transport.js';
let user={uid:'owner_1',getIdToken:async()=> 'token'};
const data={uid:'owner_1',schemaVersion:1,revision:0,spaces:[],assignments:{}};
let calls=0;
const flaky=createPublishingSpacesClient({getUser:()=>user,fetcher:async()=>{if(++calls===1)throw new TypeError('network');return Response.json(data);}});
assert.deepEqual(await flaky(),data);assert.equal(calls,2);
calls=0;let aborted=false;
const stalled=createPublishingSpacesClient({getUser:()=>user,timeoutMs:15,fetcher:async(_url,{signal})=>{if(++calls===1){signal.addEventListener('abort',()=>aborted=true);return new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(new DOMException('aborted','AbortError')));}}));}return Response.json(data);}});
assert.deepEqual(await stalled(),data);assert(aborted);assert.equal(calls,2,'retry a stalled response body');
let tokens=0;calls=0;user={uid:'owner_1',getIdToken:async()=>{if(++tokens===1)return new Promise(()=>{});return 'token';}};
const tokenStall=createPublishingSpacesClient({getUser:()=>user,timeoutMs:15,fetcher:async()=>{calls++;return Response.json(data);}});
assert.deepEqual(await tokenStall(),data);assert.equal(calls,1);assert.equal(tokens,2);
let forced=[];user={uid:'owner_1',getIdToken:async force=>{forced.push(force);return 'token';}};calls=0;
const renew=createInvitationsClient({getUser:()=>user,fetchImpl:async()=>++calls===1?Response.json({error:'AUTH_EXPIRED'},{status:401}):Response.json({items:[]})});
await renew({kind:'inbox'});assert.deepEqual(forced,[false,true]);
for(const [status,error]of [[403,'INVITATION_TEST_ONLY'],[401,'AUTH_REVOKED'],[503,'INVITATIONS_DISABLED']]){
 calls=0;const denied=createInvitationsClient({getUser:()=>user,fetchImpl:async()=>{calls++;return Response.json({error},{status});}});
 await assert.rejects(denied({kind:'inbox'}),new RegExp(error));assert.equal(calls,1);
}
for(const kind of ['invite','accept','read','setMemberAccess']){
 calls=0;const write=createInvitationsClient({getUser:()=>user,fetchImpl:async()=>{calls++;throw new TypeError('ambiguous');}});
 await assert.rejects(write({kind}),/INVITATIONS_OFFLINE/);assert.equal(calls,1,'never replay '+kind);
}
calls=0;const changed=createPublishingSpacesClient({getUser:()=>user,fetcher:async()=>{calls++;user={...user};throw new TypeError('network');}});
await assert.rejects(changed(),/AUTH_CHANGED/);assert.equal(calls,1);
console.log('Account read recovery passed: network/body/token stalls, one token renewal, no permission/configuration retries, no mutation replay, account isolation.');
