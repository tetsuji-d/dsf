import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {detachLocalProject,useLocalAuthoringAssets} from '../js/authoring-location.js';
import {createLocalDraftStatus} from '../js/local-draft-status.js';
const source={version:6,uid:'old',user:{uid:'old'},projectId:'old-project',workId:'old-work',releaseId:'published',ownerUid:'old',authoringBackend:'r2-private',authoringRef:'authoringHeads/current',dsfPages:[{private:'no'}],visibility:'public',publication:{old:true},blocks:[{id:'flow',kind:'flow',content:{text:'本文 unchanged'}}],book:{spineDesign:{publisherSource:'space'}},projectAssets:[{id:'asset',url:'blob:local'}],meta:{ja:{title:'テスト',author:'作者'}}};
const before=structuredClone(source),local=detachLocalProject(source,'fresh-work');
assert.deepEqual(source,before);assert.equal(local.projectId,null);assert.equal(local.workId,'fresh-work');assert.equal(local.visibility,'private');assert.equal(local.authoringBackend,undefined);assert.equal(local.ownerUid,undefined);assert.equal(local.uid,undefined);
for(const key of ['blocks','book','projectAssets','meta'])assert.deepEqual(local[key],source[key]);
for(const uid of [null,'signed-in'])assert.equal(useLocalAuthoringAssets({projectId:null,uid}),true);
assert.equal(useLocalAuthoringAssets({projectId:'cloud',uid:'signed-in'}),false);
assert.equal(useLocalAuthoringAssets({projectId:'cloud',uid:'signed-in'},false),true);
const tracker=createLocalDraftStatus();assert.equal(tracker.read().fileSaved,false);tracker.dirty();assert.equal(tracker.read().fileSaved,false);tracker.confirm(tracker.checkpoint());assert.equal(tracker.read().fileSaved,true);tracker.reset();assert.equal(tracker.read().fileSaved,false);
// Exercise the actual app coordinator with isolated persistence and catalogue adapters.
const app=fs.readFileSync('js/app.js','utf8');const start=app.indexOf('let cloudDestinationBusy=false'),end=app.indexOf('window.newSpaceProject',start);
function runtime(){let failSave=false,failAssign=false,changeAccount=false,created=0;const calls=[],user={uid:'alice'},state={uid:'alice',projectId:null,workId:'work'},window={},auth={currentUser:user};let pending=false;
 const context={window,state,firebaseAuth:auth,getProjectSessionEpoch:()=>1,isLocalDraft:()=>pending||!state.projectId,getUILang:()=> 'ja',assertPersonalStudioOperation(){},alert:m=>calls.push('error'),setLocalCloudTransitionPending:v=>{pending=v;},ensureProjectIdentity:()=>{state.projectId='new-'+(++created);},persistProject:async()=>{calls.push('save');if(changeAccount){auth.currentUser={uid:'bob'};state.uid='bob';}if(failSave)throw Error('save failed');},requestPublishingSpaces:async command=>{if(command){calls.push('assign');if(failAssign)throw Error('assignment failed');return {};}calls.push('catalogue');return {uid:'alice',revision:1,assignments:{}};},chooseCloudDestination:async()=>({kind:'cloud',uid:'alice',spaceId:'publisher'}),getPublishingSpaceUI:()=>({load:async()=>{}}),refresh(){},refreshFlowHorizonDryRunReadiness:async()=>{calls.push('ready');},Promise};
 vm.runInNewContext(app.slice(start,end),context);return {window,state,calls,created:()=>created,set:(s,a,c)=>{failSave=s;failAssign=a;changeAccount=c;}};}
let r=runtime();r.set(true,false,false);assert.equal(await r.window.saveToCloud(),false);assert.deepEqual(r.calls,['save','error']);r.set(false,false,false);assert.equal(await r.window.saveToCloud(),true);assert.equal(r.created(),1);assert.deepEqual(r.calls.slice(2),['save','catalogue','assign','ready']);
r=runtime();r.set(false,true,false);assert.equal(await r.window.saveToCloud(),false);r.set(false,false,false);assert.equal(await r.window.prepareHorizonCloudSource(),true);assert.equal(r.created(),1);assert.equal(r.calls.filter(x=>x==='assign').length,2);
r=runtime();r.set(false,false,true);assert.equal(await r.window.saveToCloud(),false);assert.deepEqual(r.calls,['save']);
const saveBody=app.slice(app.indexOf('window.saveProject ='),app.indexOf('window.importDSP ='));let downloads=0,saves=0;const w={exportDSP:()=>{downloads++;}};vm.runInNewContext(saveBody,{window:w,isLocalDraft:()=>true,assertSharedStudioEdit(){},persistProject:()=>{saves++;},refresh(){}});await w.saveProject();assert.equal(downloads,1);assert.equal(saves,0);
console.log('PASS local identity/content, signed-in local image routing, file-save evidence, cloud save/assignment failure retry, stale account and default DSP save');

const fb=fs.readFileSync('js/firebase.js','utf8');
const imageFunction=fb.slice(fb.indexOf('export async function prepareAuthoringImage'),fb.indexOf('/** Recover asset metadata')).replace('export async','async');
for(const [projectId,online,shared,expected] of [[null,true,false,'local'],['cloud',true,false,'cloud'],['cloud',false,false,'local'],['cloud',true,true,'shared']]){
 const writes=[],state={projectId,uid:'alice'},window={localImageMap:{}},active={epoch:1,session:{addImage:async()=>{writes.push('shared');return {url:'private-image'};}}};
 const ctx={state,window,navigator:{onLine:online},assertSharedStudioEdit(){},getProjectSessionEpoch:()=>1,compressImage:async()=>new Blob(['image']),AUTHORING_IMAGE_MAX_LONG_EDGE:1920,AUTHORING_IMAGE_WEBP_QUALITY:.8,THUMBNAIL_IMAGE_MAX_LONG_EDGE:128,THUMBNAIL_IMAGE_WEBP_QUALITY:.8,ASSET_MAX_LONG_EDGE:7680,ASSET_MAX_BYTES:1000,decodeDspPublicationThumbnailImage:async()=>({width:10,height:10}),createId:()=> 'image',readSharedStudioAccess:()=>shared,sharedStudioSession:active,useLocalAuthoringAssets,idbSet:async()=>writes.push('local'),_storeFile:async()=>{writes.push('cloud');return 'cloud-image';},URL:{createObjectURL:()=> 'blob:local'},AuthoringClientError:Error};
 vm.runInNewContext(imageFunction+';globalThis.prepare=prepareAuthoringImage;',ctx);await ctx.prepare({});assert.deepEqual(writes,[expected,expected]);
}
console.log('PASS actual image preparation: signed-in device drafts and offline drafts stay in IDB; cloud and shared routes retained');
