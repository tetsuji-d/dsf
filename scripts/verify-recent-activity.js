import assert from 'node:assert/strict';
import {test} from 'node:test';
import {maintenanceFixture,scope,root} from './fixtures/private-authoring-maintenance-fixture.js';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {createRecentActivityService,createRecentActivityApi} from '../server/recent-activity.js';
import {createRecentActivityClient} from '../js/recent-activity-client.js';
await test('100 identifier-only entries, server time, repeat throttling, immutable manuscripts and account isolation',async()=>{
 const f=maintenanceFixture(),service=createRecentActivityService({db:f.db,assertLiveIdentity:async()=>{},now:f.time}),who={uid:scope.uid},original=structuredClone(f.docs);
 await service.execute(who,{kind:'opened',projectId:scope.projectId,title:'must not persist',at:9999999999999});
 const path='users/'+scope.uid+'/studioActivity/recent',first=f.get(path);assert.equal(first.entries[0].at,f.time());assert(!JSON.stringify(first).includes('must not persist'));
 for(const [p,value]of original)assert.deepEqual(f.docs.get(p),value);
 f.advance(1000);await service.execute(who,{kind:'opened',projectId:scope.projectId});assert.deepEqual(f.get(path),first);
 for(let i=0;i<105;i++){f.advance(61000);const id='p_'+i;f.set('users/'+scope.uid+'/projects/'+id,{ownerUid:scope.uid,title:'not history'});await service.execute(who,{kind:'opened',projectId:id});}
 const list=await service.execute(who,{kind:'list'});assert.equal(list.entries.length,100);assert.equal(list.entries[0].projectId,'p_104');assert.equal(list.entries.at(-1).projectId,'p_5');assert(list.entries.every(e=>Object.keys(e).sort().join()==='at,ownerUid,projectId,spaceId,workId'));
 await assert.rejects(service.execute({uid:'other'},{kind:'list'}));f.set(root,{...f.get(root),projectTrash:{}});await assert.rejects(service.execute(who,{kind:'opened',projectId:scope.projectId}));
 f.set('users/'+scope.uid,{uid:scope.uid,status:{disabled:true}});await assert.rejects(service.execute(who,{kind:'list'}));
});
await test('shared history requires current access; revocation rejects records and cannot grant manuscript access',async()=>{
 const f=invitationsFixture();const id='inv_'+crypto.randomUUID();await f.call('owner_1',{kind:'invite',id,spaceId:'space_demo',recipientUid:'reader_1',role:'member',grants:[{scope:'work',targetId:'work_library',role:'viewer'}],expiryDays:7});await f.call('reader_1',{kind:'accept',id});
 let allowed=true;const service=createRecentActivityService({db:f.db,assertLiveIdentity:f.assertLiveIdentity,authorizeShared:async()=>{assert(allowed);}}),c={kind:'opened',spaceId:'space_demo',workId:'work_library'};
 await service.execute({uid:'reader_1'},c);assert.equal((await service.execute({uid:'reader_1'},{kind:'list'})).entries[0].ownerUid,'owner_1');
 f.docs.get('users/reader_1/spaceMemberships/space_demo').status='revoked';await assert.rejects(service.execute({uid:'reader_1'},c));
 allowed=false;await assert.rejects(service.execute({uid:'reader_1'},c));
});
await test('HTTP boundaries and client list cache stay account scoped',async()=>{
 const f=maintenanceFixture(),service=createRecentActivityService({db:f.db,assertLiveIdentity:async()=>{},now:f.time}),api=createRecentActivityApi({verifyToken:async()=>({uid:scope.uid}),service});
 let requests=0,user={uid:scope.uid,getIdToken:async()=> 'fixture'};const getUser=()=>user;
 const client=createRecentActivityClient({getUser,now:f.time,fetcher:async(url,opts)=>{requests++;return api({request:new Request('https://studio.test'+url,opts)});}});
 await client.opened({projectId:scope.projectId});await client.opened({projectId:scope.projectId});assert.equal(requests,1);assert.equal((await client.list()).length,1);await client.list();assert.equal(requests,2);user=null;assert.equal(await client.list(),null);
 const request=patch=>new Request('https://studio.test/api/recent-activity',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture'},body:'{"kind":"list"}',...patch});
 for(const [patch,status]of [[{headers:{}},401],[{headers:{Origin:'https://evil.test'}},403],[{body:'x'.repeat(4097)},413],[{method:'GET',body:undefined},405]])assert.equal((await api({request:request(patch)})).status,status);
});
