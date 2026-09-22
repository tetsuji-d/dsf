import assert from 'node:assert/strict';
import {invitationsFixture} from './fixtures/publishing-invitations-fixture.js';
import {attachSharedEditorFixture} from './fixtures/shared-editor-fixture.js';
import {openSharedAuthoringSession} from '../js/shared-authoring-session.js';
import {createSharedAssets} from '../server/shared-assets.js';
import {createSharedAuthoringApi} from '../server/shared-authoring-http.js';
const webp=Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
const base='/api/spaces/space_demo/works/work_library';
async function setup(){
 const f=invitationsFixture(),shared=await attachSharedEditorFixture(f);
 for(const [uid,role]of [['reader_1','editor'],['reader_2','viewer']])f.docs.set(`users/${uid}/spaceMemberships/space_demo`,{uid,spaceId:'space_demo',status:'active',role:'member',grants:[{role,scope:'work',targetId:'work_library'}]});
 const fences=new Map();
 const request=(uid,path,options={},env={SHARED_AUTHORING_ENABLED:'true'})=>shared.handler({env,request:new Request('https://studio.test'+path,{...options,headers:{'X-Shared-Session':'image_test_'+uid,...(fences.has(uid)?{'X-Shared-Lock':fences.get(uid)}:{}),...options.headers,...(uid?{Authorization:'Bearer fixture-'+uid}:{})}})});
 const session=async uid=>{const s=await openSharedAuthoringSession({sessionId:'image_test_'+uid,spaceId:'space_demo',workId:'work_library',user:{uid,getIdToken:async()=>'fixture-'+uid},isCurrent:()=>true,
  fetcher:(url,options)=>shared.handler({env:{SHARED_AUTHORING_ENABLED:'true'},request:new Request('https://studio.test'+url,options)})});
  if(uid==='reader_1'){const c=await s.lockAction('acquire');fences.set(uid,c.lock.fence);}return s;};
 return {...f,...shared,request,session};
}
const fail=code=>error=>error.code===code;
{
 const f=await setup();
 for(const [uid,path,opts,env,status]of [[null,base+'/context',{},undefined,401],['reader_1',base+'/context',{}, {},503],['reader_1',base+'/context',{headers:{Origin:'https://evil.test'}},undefined,403],['reader_1',base.replace('work_library','work_notes')+'/context',{},undefined,403]])assert.equal((await f.request(uid,path,opts,env)).status,status);
 assert.throws(()=>createSharedAuthoringApi({privateBucket:f.r2,publicBucket:f.r2}),fail('CONFIG_AUTHORING_BUCKET'));
 const viewer=await f.session('reader_2');assert.equal(viewer.context.canEdit,false);await assert.rejects(viewer.save(viewer.project),fail('EDIT_FORBIDDEN'));
 assert.equal((await f.request('reader_2',base+'/assets',{method:'POST',headers:{'Content-Type':'image/webp'},body:webp})).status,403);
 const editor=await f.session('reader_1'),asset=await editor.addImage(new Blob([webp],{type:'image/webp'}));
 assert(asset.url.startsWith('blob:'));assert(asset.ref.startsWith('assets/private/'));
 const noAuth=await f.request(null,base+'/assets/'+asset.sha256);assert.equal(noAuth.status,401);
 const image=await f.request('reader_2',base+'/assets/'+asset.sha256);assert.equal(image.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),webp);
 const project=structuredClone(editor.project);delete project.sections;delete project.pages;
 project.blocks[0].content.text='共有編集後の本文';project.blocks[0].content.texts.ja='共有編集後の本文';
 project.blocks.push({id:'private_image',kind:'page',content:{pageKind:'image',background:asset.url,layers:[]}});
 await editor.save(project);
 const reopened=await f.session('reader_2');assert.equal(reopened.project.blocks[0].content.text,'共有編集後の本文');assert(reopened.project.blocks[1].content.background.startsWith('blob:'));
 assert.equal(f.docs.has('users/reader_1/projects/book_library'),false);
 const raw=await f.request('reader_2',base+'/authoring'),text=await raw.text();assert(text.includes(asset.ref));assert(!text.includes('blob:'));assert(!text.includes('https://'));
 // Restore the private source and images together, without recreating recipient-owned copies.
 const restored=invitationsFixture({initialDocs:[...f.docs]}),restoredShared=await attachSharedEditorFixture(restored,{initialObjects:[...f.r2.objects].map(([k,v])=>[k,{...v,bytes:[...v.bytes]}])});
 const restoredImage=await restoredShared.handler({env:{SHARED_AUTHORING_ENABLED:'true'},request:new Request('https://studio.test'+base+'/assets/'+asset.sha256,{headers:{Authorization:'Bearer fixture-reader_2'}})});assert.equal(restoredImage.status,200);assert.deepEqual(new Uint8Array(await restoredImage.arrayBuffer()),webp);
 // Bypass the client: the server rejects unresolved/public image URLs too.
 const rawProject=JSON.parse(text),head=JSON.parse(raw.headers.get('X-Authoring-Head'));
 for(const [i,background,expected]of [[1,'https://public.example/old.webp','PRIVATE_IMAGES_REQUIRED'],[2,'assets/private/'+'0'.repeat(64)+'.webp','PRIVATE_IMAGE_NOT_READY']]){
  const body=structuredClone(rawProject);delete body.sections;delete body.pages;body.blocks[1].content.background=background;
  const response=await f.request('reader_1',base+'/authoring',{method:'PUT',headers:{'Content-Type':'application/json','X-Authoring-Generation':head.generationId,'X-Authoring-Base-Revision':String(head.revision),'X-Authoring-Request-Id':'bad_image_'+i},body:JSON.stringify(body)});
  assert.equal(response.status,409);assert.equal((await response.json()).error,expected);
 }
 const another=await f.session('reader_1');await editor.save({...project,title:'First save'});await assert.rejects(another.save({...another.project,title:'Must conflict'}),e=>/CONFLICT/.test(e.code));
 // No image body is available via a second work even to its owner.
 assert.equal((await f.request('owner_1',base.replace('work_library','work_notes')+'/assets/'+asset.sha256)).status,409);
 const unsafe=structuredClone(project);unsafe.blocks[1].content.background='https://public.example/private.webp';await assert.rejects(editor.save(unsafe),fail('PRIVATE_IMAGES_REQUIRED'));
 const malformed=await f.request('reader_1',base+'/assets',{method:'POST',headers:{'Content-Type':'image/webp'},body:new Uint8Array([1,2,3])});assert.equal(malformed.status,422);
 const before=f.r2.gets;f.docs.get('users/reader_2/spaceMemberships/space_demo').status='revoked';assert.equal((await f.request('reader_2',base+'/assets/'+asset.sha256)).status,403);assert.equal(f.r2.gets,before);
 await assert.rejects(reopened.checkAccess(),fail('SPACE_FORBIDDEN'));await assert.rejects(fetch(reopened.project.blocks[1].content.background));
 for(const s of [viewer,editor,reopened,another])s.dispose();
}
for(const when of ['read','upload']){
 const f=await setup(),assets=createSharedAssets({db:f.db,bucket:f.r2,assertLiveIdentity:f.assertLiveIdentity,spaceId:'space_demo',workId:'work_library'}),actor={uid:'reader_1'};
 const revoke=()=>f.docs.get('users/reader_1/spaceMemberships/space_demo').status='revoked';
 if(when==='read'){
  const a=await assets.put(actor,webp);f.r2.afterGet=revoke;await assert.rejects(assets.get(actor,a.sha256),fail('SPACE_FORBIDDEN'));
 }else{
  f.r2.afterPut=revoke;await assert.rejects(assets.put(actor,webp),fail('SPACE_FORBIDDEN'));
  assert([...f.docs].filter(([p])=>p.includes('/privateImageGenerations/')).every(([,v])=>v.status==='pending'));
 }
}
{
 const f=await setup(),assets=createSharedAssets({db:f.db,bucket:f.r2,assertLiveIdentity:f.assertLiveIdentity,spaceId:'space_demo',workId:'work_library'}),a=await assets.put({uid:'reader_1'},webp);
 const object=[...f.r2.objects].find(([key])=>key.startsWith('authoring-images/'))[1];object.bytes[25]^=1;
 await assert.rejects(assets.get({uid:'reader_2'},a.sha256),fail('PRIVATE_IMAGE_CORRUPT'));
}
console.log('Shared images/session passed: private WebP read/write, real source round-trip, ownership, no public/blob persistence, viewer denial, source conflict, cross-work denial, cache headers, revocation around I/O and object URL cleanup.');
