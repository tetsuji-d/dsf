import assert from 'node:assert/strict';
import {createLocalRecentStore,localRecentId,LOCAL_RECENT_INDEX_KEY as INDEX,LOCAL_RECENT_PREFIX as PREFIX} from '../js/local-recent-store.js';
// Transaction adapter with rollback and serialization; browser fixture also exercises real IndexedDB.
const data=new Map();let failWrite=false,tail=Promise.resolve();
const store=(mode,callback)=>{
 const task=tail.then(async()=>{
  const draft=structuredClone(data),tx={};let aborted=false;
  const objectStore={transaction:tx,get(key){const r={};queueMicrotask(()=>{r.result=draft.get(key);r.onsuccess?.();});return r;},put(value,key){if(failWrite)throw Error('quota');draft.set(key,structuredClone(value));},delete(key){draft.delete(key);}};
  tx.abort=()=>{aborted=true;queueMicrotask(()=>tx.onabort?.());};
  const result=callback(objectStore);
  setImmediate(()=>{if(!aborted){data.clear();for(const entry of draft)data.set(...entry);tx.oncomplete?.();}});
  return result;
 });tail=task.catch(()=>{});return task;
};
const storage=createLocalRecentStore(store);
const a={id:'local:a',updatedAt:10,title:'A'},b={id:'cloud:b',updatedAt:20,title:'B'};
const ra={state:{localProjectId:'a',blocks:[{text:'original'}]},imageMap:{'blob:a':'shared-image'}},rb={state:{projectId:'b'},imageMap:{'blob:b':'shared-image'}};
await storage.put(ra,a);await storage.put(rb,b);data.set('shared-image',new Uint8Array([1,2,3]));data.set('dsf_autosave',structuredClone(ra));data.set('unrelated','keep');
const token=await storage.remove(a.id,a.updatedAt);assert.equal(data.has(PREFIX+a.id),false);assert.equal(data.has('dsf_autosave'),false);assert.deepEqual(data.get(INDEX).map(x=>x.id),[b.id]);assert.deepEqual(data.get(PREFIX+b.id),rb);assert.equal(data.has('shared-image'),true);assert.equal(data.get('unrelated'),'keep');
await storage.restore(token);assert.deepEqual(data.get(PREFIX+a.id),ra);assert.deepEqual(data.get('dsf_autosave'),ra);
await assert.rejects(storage.remove(a.id,9),/LOCAL_COPY_CHANGED/);await assert.rejects(storage.remove(a.id,10,()=>false),/LOCAL_COPY_CHANGED/);assert.equal(data.has(PREFIX+a.id),true);
const cloudToken=await storage.remove(b.id,20);assert.deepEqual(data.get('dsf_autosave'),ra,'unrelated startup backup stays');await storage.restore(cloudToken);
const again=await storage.remove(a.id,10);await storage.put({...ra,state:{...ra.state,title:'newer'}},{...a,updatedAt:30});await assert.rejects(storage.restore(again),/LOCAL_COPY_EXISTS/);assert.equal(data.get(PREFIX+a.id).state.title,'newer');
const before=structuredClone(data);failWrite=true;await assert.rejects(storage.remove(a.id,30),/quota/);assert.deepEqual(data,before);failWrite=false;
await Promise.all([storage.put({state:{localProjectId:'c'}},{id:'local:c',updatedAt:40}),storage.remove(b.id,20)]);assert.ok(data.get(INDEX).some(x=>x.id==='local:c'));assert.ok(!data.get(INDEX).some(x=>x.id===b.id));
assert.equal(localRecentId({}),null);assert.equal(localRecentId({projectId:'b',localProjectId:'a'}),'cloud:b');
console.log('PASS deletion/undo: exact snapshot and matching startup backup only; shared images, unrelated copies, stale updates, changed sessions, failure rollback, concurrent index writes and newer-copy protection');

// Undo cannot evict another copy when the list filled up after deletion.
const undoAtLimit=await storage.remove('local:c',40);
for(let i=0;i<12;i++)await storage.put({state:{localProjectId:'full'+i}},{id:'local:full'+i,updatedAt:100+i});
await assert.rejects(storage.restore(undoAtLimit),/LOCAL_COPY_LIMIT/);
assert.equal(data.get(INDEX).length,12);
data.set(INDEX,[null,...data.get(INDEX)]);
await storage.remove('local:full0',100);
await storage.restore(undoAtLimit);assert.equal(data.get(INDEX).length,12);
console.log('PASS undo capacity and malformed index entries');

// Execute the production save coordinator with controlled timers and storage.
const {readFile}=await import('node:fs/promises');
const {runInNewContext}=await import('node:vm');
const firebaseSource=await readFile(new URL('../js/firebase.js',import.meta.url),'utf8');
const coordinator=firebaseSource.slice(firebaseSource.indexOf('export async function removeLocalRecentProject('),firebaseSource.indexOf('export async function restoreLocalRecentProject(')).replace('export ','');
let cleared=0,requeued=0,events=0,removed=0;
const context={state:{localProjectId:'editing',body:'latest unsaved edit'},localRecentId,activeSavePromise:null,editorRevision:5,autoSaveTimer:99,saveRequested:true,prepareProjectForSave:x=>x,clearTimeout:()=>cleared++,triggerAutoSave:()=>requeued++,Event:class{},window:{localImageMap:{image:'blob-key'},dispatchEvent:()=>events++},localRecentStore:{remove:async(id,time,current)=>{assert.equal(current(),true);removed++;return{record:{state:{body:'old'}},backup:{state:{body:'old'}}};}}};
runInNewContext(coordinator+';globalThis.remove=removeLocalRecentProject;',context);
const latest=await context.remove('local:editing',10,()=>true);
assert.equal(latest.record.state.body,'latest unsaved edit');assert.equal(latest.backup.state.body,'latest unsaved edit');
assert.equal(context.autoSaveTimer,null);assert.equal(context.saveRequested,false);assert.equal(cleared,1);assert.equal(requeued,0);assert.equal(events,1);
context.activeSavePromise=Promise.resolve();await assert.rejects(context.remove('local:editing',10,()=>true),/LOCAL_COPY_BUSY/);assert.equal(removed,1);context.activeSavePromise=null;
context.autoSaveTimer=100;context.saveRequested=true;context.localRecentStore.remove=async()=>{throw Error('quota');};
await assert.rejects(context.remove('local:editing',10,()=>true),/quota/);assert.equal(requeued,1);
context.localRecentStore.remove=async(id,time,current)=>{context.editorRevision++;assert.equal(current(),false);throw Error('LOCAL_COPY_CHANGED');};
await assert.rejects(context.remove('local:editing',10,()=>true),/LOCAL_COPY_CHANGED/);assert.equal(requeued,1);
console.log('PASS active-copy coordinator: pending save cancelled, latest unsaved state retained for undo, in-flight save blocked, failure resumes same-session pending save, changed revision rejected');
