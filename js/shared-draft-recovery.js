// Device-local recovery only: never restore to editor state or resend to the cloud.
export function createRecoveryStorage(indexedDB=globalThis.indexedDB){
    let opened;
    const open=()=>opened??=new Promise((resolve,reject)=>{
        if(!indexedDB){reject(Error('RECOVERY_STORAGE_UNAVAILABLE'));return;}
        const r=indexedDB.open('dsf-shared-recovery',1);
        r.onupgradeneeded=()=>{const store=r.result.createObjectStore('drafts',{keyPath:'id'});store.createIndex('uid','uid');};
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opened=null;reject(r.error);};
    });
    const transaction=async(mode,run)=>{const db=await open();return new Promise((resolve,reject)=>{
        const tx=db.transaction('drafts',mode);let result;
        try{const request=run(tx.objectStore('drafts'));request.onsuccess=()=>{result=request.result;};}
        catch(e){tx.abort();reject(e);return;}
        tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('RECOVERY_STORAGE_FAILED'));
    });};
    return {put:record=>transaction('readwrite',s=>s.put(record)),remove:id=>transaction('readwrite',s=>s.delete(id)),list:uid=>transaction('readonly',s=>s.index('uid').getAll(uid))};
}
export function createSharedDraftRecovery({storage=createRecoveryStorage(),getUid,now=Date.now,onChange=()=>{}}){
    const memory=new Map(),tasks=new Map();
    const queue=(id,fn)=>{const next=(tasks.get(id)||Promise.resolve()).catch(()=>{}).then(fn);tasks.set(id,next);next.finally(()=>{if(tasks.get(id)===next)tasks.delete(id);}).catch(()=>{});return next;};
    function capture({id,uid,spaceId,workId,project,assets,revision}){
        if(!uid||getUid()!==uid)throw Error('RECOVERY_ACCOUNT_CHANGED');
        const record=structuredClone({schemaVersion:1,id,uid,spaceId,workId,project,assets,revision,updatedAt:now()});
        memory.set(id,{record,persisted:false});onChange();
        void queue(id,async()=>{
            if(memory.get(id)?.record!==record)return;
            try{await storage.put(record);if(memory.get(id)?.record===record)memory.get(id).persisted=true;}
            catch{if(memory.get(id)?.record===record)memory.get(id).persisted=false;}
            onChange();
        });
        return id;
    }
    async function list(){
        const uid=getUid();if(!uid)return [];
        let stored=[];try{stored=await storage.list(uid);}catch{}
        if(uid!==getUid())return [];
        const result=new Map(stored.filter(r=>r.uid===uid&&r.schemaVersion===1).map(r=>[r.id,{record:r,persisted:true}]));
        for(const [id,value] of memory)if(value.record.uid===uid)result.set(id,value);
        return [...result.values()].map(v=>structuredClone(v)).sort((a,b)=>b.record.updatedAt-a.record.updatedAt);
    }
    function retain(id){
        const value=memory.get(id);if(!value||value.record.retained)return;
        value.record.retained=true;
        void queue(id,async()=>{try{await storage.put(value.record);value.persisted=true;}catch{value.persisted=false;}onChange();});
    }
    async function saved(id,revision){
        const value=memory.get(id);if(!value||value.record.retained||value.record.revision!==revision)return;
        await queue(id,async()=>{if(memory.get(id)!==value||value.record.retained)return;await storage.remove(id);if(memory.get(id)===value)memory.delete(id);onChange();}).catch(()=>{});
    }
    async function remove(id){
        const uid=getUid(),value=(await list()).find(v=>v.record.id===id);if(!uid||uid!==getUid()||value?.record.uid!==uid)throw Error('RECOVERY_ACCOUNT_CHANGED');
        await queue(id,async()=>{if(uid!==getUid())throw Error('RECOVERY_ACCOUNT_CHANGED');await storage.remove(id);memory.delete(id);onChange();});
    }
    return {capture,retain,list,saved,remove,settled:()=>Promise.all([...tasks.values()])};
}
