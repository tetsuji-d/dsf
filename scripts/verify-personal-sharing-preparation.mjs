import assert from 'node:assert/strict';
import {maintenanceFixture,scope,root,child,head} from './fixtures/private-authoring-maintenance-fixture.js';
import {createPersonalSharingPreparation} from '../server/personal-sharing-preparation.js';
import {MemoryR2} from './fixtures/private-authoring-api-fixture.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
const actor={uid:scope.uid},generationId='personal_12345678-1234-1234-1234-123456789012';
const bytes=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
async function setup(){
 const f=maintenanceFixture(),publicBucket=new MemoryR2();
 await publicBucket.put('users/owner_1/dsf/cover.webp',bytes,{sha256:'c90cff659645a312a28804965f3dbc34061338f7234ff5d6ddb2c57e9eadec15',onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'image/webp'}});
 f.set(child,{...f.get(child),blocks:[...f.source.blocks,{id:'image',kind:'page',content:{pageKind:'image',background:'https://media.test/users/owner_1/dsf/cover.webp'}}]});
 const execute=createPersonalSharingPreparation({db:f.db,privateBucket:f.rawBucket,publicBucket,publicBaseUrl:'https://media.test',assertLiveIdentity:async()=>{},now:f.time});
 const call=cmd=>execute(actor,{projectId:scope.projectId,...cmd});
 return {f,publicBucket,call,execute};
}
{
 const {f,publicBucket,call,execute}=await setup(),original=f.get(child),published=structuredClone(f.docs.get('public_projects/work_1'));
 const plan=await call({kind:'prepare-source',generationId});assert.equal(f.rawBucket.puts,0);
 await assert.rejects(execute({uid:'other'},{kind:'migrate-source',projectId:scope.projectId,...plan,confirm:true}));
 await call({kind:'migrate-source',...plan,confirm:true});assert.equal(f.get(root).authoringBackend,'r2-private');assert.equal(f.get(child),null);
 assert((await call({kind:'migrate-source',...plan,confirm:true})).replay);
 let images=await call({kind:'prepare-images'});assert(images.ready);assert.equal(images.images.uniqueImages,1);
 await call({kind:'migrate-images',...images,requestId:'personal_image_1',confirm:true});
 const loaded=JSON.parse(new TextDecoder().decode((await f.service.load(actor,scope.projectId,await f.service.access(actor,scope.projectId))).bytes));
 assert.deepEqual(loaded.blocks[0],original.blocks[0]);assert.match(loaded.blocks[1].content.background,/^assets\/private\//);
 assert.deepEqual(f.docs.get('public_projects/work_1'),published);assert.equal(publicBucket.puts,1);
 assert(f.get('users/owner_1/projects/project_1/authoringControl/current').previousHead);
 assert.equal((await call({kind:'prepare-images'})).images.uniqueImages,0);
 // Mixed already-private and older public refs migrate without reuploading private refs.
 loaded.blocks.push({id:'image2',kind:'page',content:{pageKind:'image',background:'https://media.test/users/owner_1/dsf/cover.webp'}});delete loaded.pages;delete loaded.sections;
 const h=f.get(head);await f.service.save(actor,scope.projectId,{snapshot:await createPrivateAuthoringSnapshot(loaded),generationId:h.generationId,baseRevision:h.revision,requestId:'mixed_source'});
 images=await call({kind:'prepare-images'});assert(images.ready);await call({kind:'migrate-images',...images,requestId:'mixed_images',confirm:true});
 assert.equal((await call({kind:'prepare-images'})).images.uniqueImages,0);
}
for(const fault of ['source','assignment','backup']){
 const {f,call}=await setup();const p=await call({kind:'prepare-source',generationId});
 if(fault==='source')f.set(child,{...f.get(child),title:'updated'});
 if(fault==='assignment')f.rawBucket.afterPut=async()=>f.set('users/owner_1/publishing/catalogue',{assignments:{project_1:'space_other'}});
 if(fault==='backup')f.rawBucket.failPut=true;
 await assert.rejects(call({kind:'migrate-source',...p,confirm:true}));assert(f.get(child));assert.equal(f.get(root).authoringBackend,undefined);
}
{
 const {f,call}=await setup();const p=await call({kind:'prepare-source',generationId});await call({kind:'migrate-source',...p,confirm:true});
 const imagePlan=await call({kind:'prepare-images'}),before=f.get(head);
 f.rawBucket.afterPut=async key=>{if(key.startsWith('authoring-images/'))f.set('users/owner_1/publishing/catalogue',{assignments:{project_1:'space_other'}});};
 await assert.rejects(call({kind:'migrate-images',...imagePlan,requestId:'failed_copy',confirm:true}));assert.deepEqual(f.get(head),before);
}
console.log('Personal preparation passed: verified legacy backup, replay, public/private image migration, exact manuscript/release preservation, owner isolation and source/assignment/copy failure protection.');
