import {createStore} from 'idb-keyval';
// Protected versions are independent of the twelve-item recent index and never expire.
export function createResumeStore(store=createStore('dsf-safe-resume','versions')) {
 const tx=(mode,run)=>store(mode,s=>new Promise((resolve,reject)=>{let value,error;try{run(s,v=>{value=v;},e=>{error=e;s.transaction.abort();});}catch(e){error=e;s.transaction.abort();}s.transaction.oncomplete=()=>resolve(value);s.transaction.onerror=s.transaction.onabort=()=>reject(error||s.transaction.error||Error('RESUME_STORAGE_FAILED'));}));
 return {
  async retain(record){const saved={...structuredClone(record),schemaVersion:1,id:crypto.randomUUID(),createdAt:Date.now()};await tx('readwrite',(s,done)=>{s.add(saved,saved.id);done(saved);});return saved;},
  list:scope=>tx('readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result.filter(r=>r.schemaVersion===1&&r.environment===scope.environment&&r.ownerUid===scope.ownerUid).sort((a,b)=>b.createdAt-a.createdAt));}),
  read:id=>tx('readonly',(s,done)=>{s.get(id).onsuccess=e=>done(e.target.result||null);}),
  remove:id=>tx('readwrite',(s,done)=>{s.get(id).onsuccess=e=>{const record=e.target.result;if(record)s.delete(id);done(record);};}),
  restore:record=>tx('readwrite',(s,done)=>{s.add(record,record.id);done(record);})
 };
}
