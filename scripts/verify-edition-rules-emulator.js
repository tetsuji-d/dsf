import assert from 'node:assert/strict';
import { initializeApp as adminApp, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc, terminate } from 'firebase/firestore';
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Use the local Firestore emulator.');
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const projectId = process.env.GCLOUD_PROJECT || 'demo-dsf-editions';
const admin = adminApp({projectId}, 'edition-admin'), db = getFirestore(admin), clients = [];
function client(name, uid) {
    const app = initializeApp({projectId,apiKey:'demo-key',appId:'demo-'+name}, 'edition-'+name);
    const firestore = initializeFirestore(app, {});
    connectFirestoreEmulator(firestore,host,Number(port),uid?{mockUserToken:{sub:uid}}:{}); clients.push({app,firestore}); return firestore;
}
const uid='edition-owner', root=`users/${uid}/works/work`, release=root+'/releases/first', state=root+'/edition_states/first';
const denied = action => assert.rejects(action, error => error.code === 'permission-denied');
try {
    await db.doc(`users/${uid}`).set({uid,status:{disabled:false,moderationHold:false}});
    await db.doc(`users/${uid}/projects/project`).set({ownerUid:uid,projectId:'project',workId:'work'});
    await db.doc(root).set({ownerUid:uid,workId:'work',projectId:'project'});
    const owner=client('owner',uid), other=client('other','another-owner'), anon=client('anonymous');
    const original={workId:'work',releaseId:'first',projectId:'project',dsfPages:[{urls:{ja:'https://media.test/original.webp'}}]};
    await setDoc(doc(owner,release),original);
    await denied(setDoc(doc(owner,release),{...original,dsfPages:[]}));
    await denied(deleteDoc(doc(owner,release)));
    await denied(setDoc(doc(other,release),original));
    await denied(setDoc(doc(owner,state),{status:'public'}));
    await denied(setDoc(doc(owner,'public_editions/edition'),{authorUid:uid,dsfStatus:'public'}));
    await denied(setDoc(doc(owner,'public_projects/work'),{authorUid:uid,releaseId:'different'}));
    await db.doc(state).set({status:'archived',revision:1});
    await getDoc(doc(owner,state)); await denied(getDoc(doc(other,state))); await denied(getDoc(doc(anon,state)));
    await db.doc('public_editions/edition').set({dsfStatus:'disposed',releaseId:'first'});
    assert.equal((await getDoc(doc(anon,'public_editions/edition'))).data().dsfStatus,'disposed');
    await db.doc(release).delete();
    await denied(setDoc(doc(owner,release),original));
    console.log('Edition Rules emulator: immutable releases, permanent IDs, owner lifecycle and server-only public writes passed.');
} finally {
    await Promise.all(clients.map(async ({app,firestore})=>{await terminate(firestore);await deleteApp(app);}));
    await deleteAdmin(admin);
}
