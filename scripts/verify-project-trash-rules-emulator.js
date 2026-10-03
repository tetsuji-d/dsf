import assert from 'node:assert/strict';
import {initializeApp as adminInit, deleteApp as adminDelete} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeApp, deleteApp} from 'firebase/app';
import {initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc, writeBatch, terminate, setLogLevel} from 'firebase/firestore';
const addr=process.env.FIRESTORE_EMULATOR_HOST, projectId=process.env.GCLOUD_PROJECT;
assert(/^127\.0\.0\.1:\d+$/.test(addr||'') && projectId?.startsWith('demo-'), 'Isolated emulator only');
setLogLevel('silent'); const app=adminInit({projectId},'trash-admin'), admin=getFirestore(app), clients=[];
function client(uid){const app=initializeApp({projectId,apiKey:'demo'},uid||'anon'),db=initializeFirestore(app,{});connectFirestoreEmulator(db,'127.0.0.1',Number(addr.split(':')[1]),uid?{mockUserToken:{sub:uid}}:undefined);clients.push({app,db});return db;}
const owner=client('trash_owner'), other=client('other'), anon=client(); let checks=0;
async function denied(fn){await assert.rejects(fn,e=>e.code==='permission-denied');checks++;}
const root='users/trash_owner/projects/legacy', source=root+'/authoring/current';
const marker={revision:1,trashedAtMs:1,restoreUntilMs:2592000001};
try {
 await admin.doc('users/trash_owner').set({uid:'trash_owner',status:{disabled:false,moderationHold:false}});
 // Access isolation starts with a private draft in every rollout phase.
 // The public-read case is seeded explicitly below, independently of space policy.
 await setDoc(doc(owner,root),{version:5,projectId:'legacy',title:'Original',blocks:[{text:'Manuscript'}],dsfStatus:'draft'});
 await setDoc(doc(owner,root),{title:'Normal save'},{merge:true}); checks++;
 await denied(()=>getDoc(doc(other,root)));
 await denied(()=>setDoc(doc(owner,root),{projectTrash:marker},{merge:true}));
 await denied(()=>deleteDoc(doc(owner,root)));
 const root6={version:6,projectId:'legacy',authoringRef:'authoring/current',authoringSchemaVersion:6,dsfStatus:'draft'};
 const b=writeBatch(owner);b.set(doc(owner,root),root6);b.set(doc(owner,source),{version:6,projectId:'legacy',blocks:[]});await b.commit();checks++;
 await admin.doc(root).update({projectTrash:marker,dsfStatus:'public',visibility:'public'});
 await admin.doc('users/trash_owner/project_trash/legacy').set({schemaVersion:1,status:'trashed',revision:1});
 await admin.doc('public_projects/trash_work').set({authorUid:'trash_owner',projectId:'legacy',dsfStatus:'public',title:'Published'});
 assert((await getDoc(doc(anon,root))).exists());assert((await getDoc(doc(anon,'public_projects/trash_work'))).exists());checks+=2;
 await denied(()=>setDoc(doc(owner,root),{title:'Stale tab'},{merge:true}));
 await denied(()=>setDoc(doc(owner,root),root6));
 await denied(()=>setDoc(doc(owner,root),{projectTrash:null},{merge:true}));
 await denied(()=>setDoc(doc(owner,source),{version:6,projectId:'legacy',blocks:[]}));
 await denied(()=>getDoc(doc(owner,source)));
 await denied(()=>deleteDoc(doc(owner,source)));
 await denied(()=>deleteDoc(doc(owner,root)));
 await denied(()=>setDoc(doc(owner,'users/trash_owner/project_trash/legacy'),{status:'active'}));
 await denied(()=>deleteDoc(doc(owner,'users/trash_owner/project_trash/legacy')));
 // Stopping public delivery remains a separate owner action.
 const stop=writeBatch(owner);stop.set(doc(owner,root),{dsfStatus:'private',visibility:'private',publication:{}},{merge:true});stop.delete(doc(owner,'public_projects/trash_work'));await stop.commit();checks++;
 await denied(()=>setDoc(doc(owner,root),{dsfStatus:'public',visibility:'public'},{merge:true}));
 // Server restore makes ordinary writes work again without deleting source.
 await admin.doc(root).update({projectTrash:null}); await admin.doc('users/trash_owner/project_trash/legacy').update({status:'active',revision:2});
 const restore=writeBatch(owner);restore.set(doc(owner,root),root6);restore.set(doc(owner,source),{version:6,projectId:'legacy',blocks:[{text:'Restored edit'}]});await restore.commit();checks++;
 assert.equal((await getDoc(doc(owner,source))).data().blocks[0].text,'Restored edit');checks++;
 // Unrelated account features keep their existing writes/deletes.
 await setDoc(doc(owner,'users/trash_owner/bookmarks/book'),{workId:'book'});await deleteDoc(doc(owner,'users/trash_owner/bookmarks/book'));checks++;
 await setDoc(doc(owner,'users/trash_owner/works/work'),{projectId:'legacy'});await deleteDoc(doc(owner,'users/trash_owner/works/work'));checks++;
 const activity='users/trash_owner/studioActivity/recent';
 await admin.doc(activity).set({schemaVersion:1,entries:[]});
 for(const client of [owner,other,anon]){await denied(()=>getDoc(doc(client,activity)));await denied(()=>setDoc(doc(client,activity),{entries:[]}));}
 console.log(`PASS ${checks} Trash and activity Rules checks: normal v5/v6 saves, private access, lifecycle protection, direct manuscript deletion denied, publication preserved/stoppable, restore and unrelated bookmark/work operations.`);
} finally {await Promise.all(clients.map(async({db,app})=>{await terminate(db);await deleteApp(app);}));await adminDelete(app);}
