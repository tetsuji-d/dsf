import assert from 'node:assert/strict';
import {prepareProjectCopy,createProjectCopyJob} from '../js/project-copy.js';
import {prepareProjectForSave} from '../js/project-persistence.js';
const raw={version:6,projectId:'original',workId:'original_work',projectName:'原本',title:'潮騒の図書館',languages:['ja'],defaultLang:'ja',blocks:[{id:'page_a',kind:'page',content:{pageKind:'text',text:'改行を保持\n灯台の光。',texts:{ja:'改行を保持\n灯台の光。'}}},{id:'page_b',kind:'page',content:{pageKind:'image',background:'https://media.example/test.webp'}}],visibility:'public',releaseId:'release_old',dsfPages:['published'],authoringBackend:'r2-private',futurePrivate:{note:'retain'}};
const source=prepareProjectForSave(raw),before=JSON.stringify(source);
for(const version of [5,6]){const input={...source,version};const result=await prepareProjectCopy(input,{projectId:'copy_1',workId:'copy_work_1',name:'検証コピー'});assert.equal(result.projectName,'検証コピー');assert.equal(result.title,source.title);assert.equal(result.version,version);assert.equal(result.visibility,'private');assert.equal(result.releaseId,null);assert(!result.authoringBackend);assert(!result.dsfPages);assert.deepEqual(result.blocks,source.blocks);assert.deepEqual(result.futurePrivate,source.futurePrivate);}
assert.equal(JSON.stringify(source),before);
await assert.rejects(prepareProjectCopy(source,{projectId:'copy_1',workId:'copy_work_1',name:' '}));
const image=structuredClone(source);image.blocks[1].content.background='assets/private/'+'a'.repeat(64)+'.webp';
await assert.rejects(prepareProjectCopy(image,{projectId:'copy_1',workId:'copy_work_1',name:'copy'}),/COPY_PRIVATE_IMAGES_UNSUPPORTED/);
let ids=0,reads=0,calls=0,current=true;const saved=[];
const job=createProjectCopyJob({readSource:async()=>{reads++;return source;},newId:p=>p+'_'+(++ids),isCurrent:()=>current,createClient:()=>({create:async p=>{saved.push(JSON.stringify(p));if(++calls===1)throw Error('lost reply');}})});
await assert.rejects(job.run('copy'));const result=await job.run('changed retry name');assert.equal(saved[0],saved[1]);assert.equal(result.projectName,'copy');assert.equal(ids,2);assert.equal(reads,1);await job.run('copy');assert.equal(calls,2);
current=false;await assert.rejects(job.run('copy'),/AUTH_CHANGED/);
let creates=0;const switched=createProjectCopyJob({readSource:async()=>{current=false;return source;},newId:()=>'',isCurrent:()=>current,createClient:()=>{creates++;}});current=true;await assert.rejects(switched.run('copy'),/AUTH_CHANGED/);assert.equal(creates,0);
console.log('Project copy passed: v5/v6, content and source preservation, publication reset, image scope, retry identity, auth switch.');

// Exercise the real creation service/storage contract with the prepared copy.
const {fixture}=await import('./fixtures/private-authoring-api-fixture.js');
const {createProjectCreation}=await import('../server/private-authoring/creation.js');
const {createAuthoringBucket}=await import('../server/private-authoring/r2.js');
const {createPrivateAuthoringSnapshot}=await import('../js/private-authoring-storage.js');
const f=fixture();const account=f.db.docs.get('users/owner_1');f.db.docs.set('users/owner_1',{...account,entitlements:{...account.entitlements,canCreateProject:true}});
const originalRoot=structuredClone(f.db.docs.get('users/owner_1/projects/project_1'));
const copy=await prepareProjectCopy(source,{projectId:'copied_project',workId:'copied_work',name:'共有テスト'});
const bucket=createAuthoringBucket(f.r2),service=createProjectCreation({db:f.db,bucket,assertLiveIdentity:async()=>{}});
const receipt=await service.create({uid:'owner_1'},copy.projectId,{snapshot:await createPrivateAuthoringSnapshot(copy),requestId:'copy_request_1'});
assert.equal(receipt.state,'committed');const root=f.db.docs.get('users/owner_1/projects/copied_project');assert.equal(root.visibility,'private');assert.equal(root.dsfStatus,'draft');assert.equal(root.releaseId,null);assert.equal(root.authoringBackend,'r2-private');
assert.deepEqual(f.db.docs.get('users/owner_1/projects/project_1'),originalRoot);
const {revision,...descriptor}=receipt.currentHead;const loaded=await bucket.read(descriptor,{uid:'owner_1',projectId:'copied_project',generationId:descriptor.generationId});assert.deepEqual(loaded.project.blocks,copy.blocks);console.log('Copy integration passed: real creation service, private source re-read, original root unchanged.');

let attempts=0,creationCount=0;const destinations=[];
const assignmentJob=createProjectCopyJob({readSource:async()=>source,newId:p=>p+'_destination',isCurrent:()=>true,createClient:()=>({create:async()=>{creationCount++;}}),assignDestination:async(pid,sid)=>{destinations.push(sid);if(++attempts===1)throw Error('offline');}});
await assert.rejects(assignmentJob.run('copy','space_a'),/COPY_DESTINATION_FAILED/);
const assigned=await assignmentJob.run('changed','space_b');assert.equal(creationCount,1);assert.equal(assigned.spaceId,'space_a');assert.deepEqual(destinations,['space_a','space_a']);
let read=false;const invalidJob=createProjectCopyJob({readSource:async()=>{read=true;},isCurrent:()=>true,validateDestination:async()=>{throw Error('SPACE_FORBIDDEN');}});await assert.rejects(invalidJob.run('copy','other'),/SPACE_FORBIDDEN/);assert.equal(read,false);
console.log('Destination passed: prevalidation and frozen assignment retry without a second creation.');

let listingCalls=0,listingCreates=0;const listingSources=[];
const listingJob=createProjectCopyJob({readSource:async()=>({...source,listThumbnail:'https://media.example/cover.webp',pageCount:7}),newId:p=>p+'_listing',isCurrent:()=>true,
createClient:()=>({create:async()=>{listingCreates++;},getHead:()=>({revision:1})}),
updateListing:async(pid,snapshot,head)=>{assert.equal(head.revision,1);listingSources.push(snapshot);if(++listingCalls===1)throw Error('offline');}});
await assert.rejects(listingJob.run('copy'),/COPY_LISTING_FAILED/);
await listingJob.run('retry');assert.equal(listingCreates,1);assert.equal(listingCalls,2);
assert.equal(listingSources[1].listThumbnail,'https://media.example/cover.webp');assert.equal(listingSources[1].pageCount,7);
console.log('Listing retry passed: preserves source preview metadata and never creates a second project.');

// Listing metadata is stored while the copied source and publication remain unchanged.
const copyContext=await f.actions.context(f.identity,'copied_project');
const copyHead=structuredClone(copyContext.head),objectsBefore=f.r2.objects.size;
await f.actions.execute(f.identity,'copied_project',{kind:'listing',requestId:'listing_copy_1',generationId:copyHead.generationId,baseRevision:copyHead.revision,mutationRevision:copyContext.mutationRevision,payload:{pageCount:7,listThumbnail:'https://media.test/users/owner_1/dsf/cover.webp',projectBytes:copyHead.byteLength+100}});
const listedRoot=f.db.docs.get('users/owner_1/projects/copied_project');assert.equal(listedRoot.pageCount,7);assert.equal(listedRoot.listThumbnail,'https://media.test/users/owner_1/dsf/cover.webp');assert.equal(listedRoot.visibility,'private');assert.equal(listedRoot.releaseId,null);
assert.deepEqual((await f.actions.context(f.identity,'copied_project')).head,copyHead);assert.equal(f.r2.objects.size,objectsBefore);
assert.deepEqual(f.db.docs.get('users/owner_1/projects/project_1'),originalRoot);
console.log('Listing integration passed: thumbnail and count updated without publication or source writes.');
