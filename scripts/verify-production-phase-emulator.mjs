import assert from 'node:assert/strict';
import {initializeApp as adminInit,deleteApp as adminDelete} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeFirestore,connectFirestoreEmulator,doc,setDoc,getDoc,deleteDoc,terminate,setLogLevel} from 'firebase/firestore';
const address=process.env.FIRESTORE_EMULATOR_HOST,projectId=process.env.GCLOUD_PROJECT;
assert(/^127\.0\.0\.1:\d+$/.test(address||'')&&projectId?.startsWith('demo-'));
const required=process.env.DSF_TEST_SPACE_REQUIRED==='true',apps=[];
setLogLevel('silent');
const aa=adminInit({projectId},'phase-admin'),admin=getFirestore(aa);
function client(uid){const app=initializeApp({projectId,apiKey:'demo'},uid);const db=initializeFirestore(app,{});connectFirestoreEmulator(db,'127.0.0.1',Number(address.split(':')[1]),{mockUserToken:{sub:uid}});apps.push({app,db});return db;}
const owner=client('phase_owner'),other=client('phase_other');
const root='users/phase_owner/projects/',catalogue='users/phase_owner/publishing/catalogue';
let checks=0;
async function denied(fn){await assert.rejects(fn,e=>e.code==='permission-denied');checks++;}
async function allowed(fn){await fn();checks++;}
const manuscript=id=>({version:5,projectId:id,blocks:[{text:'本文は維持'}],dsfStatus:'draft'});
try{
    await admin.doc('users/phase_owner').set({uid:'phase_owner',status:{disabled:false,moderationHold:false}});
    await allowed(()=>setDoc(doc(owner,root+'draft'),manuscript('draft')));
    await allowed(()=>setDoc(doc(owner,root+'draft'),{title:'通常編集'},{merge:true}));
    await denied(()=>getDoc(doc(other,root+'draft')));
    const releaseDraft={...manuscript('release'),releaseId:'new_release'};
    if(required)await denied(()=>setDoc(doc(owner,root+'release'),releaseDraft));
    else await allowed(()=>setDoc(doc(owner,root+'release'),releaseDraft));
    const makePublic=()=>setDoc(doc(owner,root+'draft'),{dsfStatus:'public'},{merge:true});
    if(required)await denied(makePublic);else await allowed(makePublic);
    await admin.doc(catalogue).set({schemaVersion:1,spaceIds:['space_a'],assignments:{release:'space_a',draft:'space_a'}});
    await allowed(()=>setDoc(doc(owner,root+'release'),releaseDraft));
    await allowed(makePublic);
    await admin.doc(catalogue).delete();
    await admin.doc(root+'existing').set({...manuscript('existing'),dsfStatus:'public',releaseId:'kept_release'});
    await allowed(()=>setDoc(doc(owner,root+'existing'),{title:'既存公開版の情報更新'},{merge:true}));
    await allowed(()=>setDoc(doc(owner,root+'existing'),{dsfStatus:'unlisted'},{merge:true}));
    const changeRelease=()=>setDoc(doc(owner,root+'existing'),{releaseId:'another_release'},{merge:true});
    if(required)await denied(changeRelease);else await allowed(changeRelease);
    await denied(()=>deleteDoc(doc(owner,root+'draft')));
    await admin.doc(root+'private').set({version:6,projectId:'private',authoringBackend:'r2-private',authoringStorageVersion:1,authoringRef:'authoringHeads/current',dsfStatus:'draft'});
    await denied(()=>setDoc(doc(owner,root+'private'),{title:'直接変更'},{merge:true}));
    for(const path of [root+'private/authoringHeads/current',root+'private/authoringControl/current','users/phase_owner/project_trash/private',catalogue,'users/phase_owner/studioActivity/recent']){
        await denied(()=>getDoc(doc(owner,path)));await denied(()=>setDoc(doc(owner,path),{value:'forged'}));
    }
    console.log(`PASS ${checks} phase checks; space requirement=${required}; ordinary editing, existing releases, private-source and server-only boundaries preserved.`);
}finally{await Promise.all(apps.map(async({app,db})=>{await terminate(db);await deleteApp(app);}));await admin.terminate();await adminDelete(aa);}
