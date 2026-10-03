import {createStore} from 'idb-keyval';
const INDEX='__protected_index__';
const metadata=r=>({id:r.id,environment:r.environment,ownerUid:r.ownerUid,sourceOwner:r.sourceOwner,projectId:r.projectId,name:r.name,createdAt:r.createdAt,schemaVersion:r.schemaVersion});
export function createResumeStore(store=createStore('dsf-safe-resume','versions')) {
 const tx=(mode,run)=>store(mode,s=>new Promise((resolve,reject)=>{let value,error;const fail=e=>{error=e;s.transaction.abort();};try{run(s,v=>{value=v;},fail);}catch(e){fail(e);}s.transaction.oncomplete=()=>resolve(value);s.transaction.onerror=s.transaction.onabort=()=>reject(error||s.transaction.error||Error('RESUME_STORAGE_FAILED'));}));
 const updateIndex=(s,id,next,fail)=>{s.get(INDEX).onsuccess=e=>{try{const rows=(e.target.result||[]).filter(r=>r.id!==id);if(next)rows.push(metadata(next));s.put(rows,INDEX);}catch(error){fail(error);}};};
 return {
  async retain(record){const saved={...structuredClone(record),schemaVersion:1,id:record.id||crypto.randomUUID(),createdAt:record.createdAt||Date.now()};return tx('readwrite',(s,done,fail)=>{s.get(saved.id).onsuccess=e=>{try{if(e.target.result){done(e.target.result);return;}s.add(saved,saved.id);updateIndex(s,saved.id,saved,fail);done(saved);}catch(err){fail(err);}};});},
  list:(scope,{metadataOnly=false}={})=>tx('readonly',(s,done)=>{const filter=rows=>rows.filter(r=>r.schemaVersion===1&&r.environment===scope.environment&&r.ownerUid===scope.ownerUid).sort((a,b)=>b.createdAt-a.createdAt);if(metadataOnly)s.get(INDEX).onsuccess=e=>done(filter(e.target.result||[]));else s.getAll().onsuccess=e=>done(filter(e.target.result));}),
  read:id=>tx('readonly',(s,done)=>{s.get(id).onsuccess=e=>done(e.target.result||null);}),
  remove:id=>tx('readwrite',(s,done,fail)=>{s.get(id).onsuccess=e=>{const record=e.target.result;if(record){s.delete(id);updateIndex(s,id,null,fail);}done(record);};}),
  restore:record=>tx('readwrite',(s,done,fail)=>{s.add(record,record.id);updateIndex(s,record.id,record,fail);done(record);})
 };
}
