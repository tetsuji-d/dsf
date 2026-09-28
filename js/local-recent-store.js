import {createStore} from 'idb-keyval';
export const LOCAL_RECENT_INDEX_KEY = 'dsf_local_recent_index';
export const LOCAL_RECENT_PREFIX = 'dsf_local_recent_project_';
export function localRecentId(state) {
    return state?.projectId ? 'cloud:'+state.projectId : state?.localProjectId ? 'local:'+state.localProjectId : null;
}
// Reuse the existing IDB store and record shapes. Images can be shared by copies.
export function createLocalRecentStore(store=createStore('keyval-store','keyval')) {
    function transaction(keys,change) {
        return store('readwrite',objectStore=>new Promise((resolve,reject)=>{
            let result, failure, remaining=keys.length;
            const values={};
            objectStore.transaction.oncomplete=()=>resolve(result);
            objectStore.transaction.onabort=objectStore.transaction.onerror=()=>reject(failure||objectStore.transaction.error||Error('LOCAL_COPY_STORAGE_FAILED'));
            for(const key of keys){const request=objectStore.get(key);request.onsuccess=()=>{
                values[key]=request.result;
                if(--remaining===0)try{result=change(values,objectStore);}catch(error){failure=error;objectStore.transaction.abort();}
            };}
        }));
    }
    async function put(record,meta){
        return transaction([LOCAL_RECENT_INDEX_KEY],(values,s)=>{
            const index=Array.isArray(values[LOCAL_RECENT_INDEX_KEY])?values[LOCAL_RECENT_INDEX_KEY].filter(x=>x && typeof x.id==='string'):[];
            s.put(record,LOCAL_RECENT_PREFIX+meta.id);
            s.put([meta,...index.filter(x=>x.id!==meta.id)].slice(0,12),LOCAL_RECENT_INDEX_KEY);
        });
    }
    async function remove(id,expectedUpdatedAt,isCurrent=()=>true){
        if(typeof id!=='string'||!id||!Number.isFinite(expectedUpdatedAt))throw Error('LOCAL_COPY_CHANGED');
        const key=LOCAL_RECENT_PREFIX+id;
        return transaction([LOCAL_RECENT_INDEX_KEY,key,'dsf_autosave'],(values,s)=>{
            const index=Array.isArray(values[LOCAL_RECENT_INDEX_KEY])?values[LOCAL_RECENT_INDEX_KEY].filter(x=>x && typeof x.id==='string'):[];
            const meta=index.find(x=>x.id===id);
            if(!isCurrent()||!meta||meta.updatedAt!==expectedUpdatedAt)throw Error('LOCAL_COPY_CHANGED');
            const backup=localRecentId(values.dsf_autosave?.state)===id?values.dsf_autosave:null;
            const token={id,meta,record:values[key],backup};
            s.put(index.filter(x=>x.id!==id),LOCAL_RECENT_INDEX_KEY);s.delete(key);
            if(backup)s.delete('dsf_autosave');
            return token;
        });
    }
    async function restore(token){
        const key=LOCAL_RECENT_PREFIX+token.id;
        return transaction([LOCAL_RECENT_INDEX_KEY,key,'dsf_autosave'],(values,s)=>{
            const index=Array.isArray(values[LOCAL_RECENT_INDEX_KEY])?values[LOCAL_RECENT_INDEX_KEY].filter(x=>x && typeof x.id==='string'):[];
            // A newer autosave must never be replaced by undoing a deletion.
            if(values[key]||index.some(x=>x.id===token.id))throw Error('LOCAL_COPY_EXISTS');
            if(index.length>=12)throw Error('LOCAL_COPY_LIMIT');
            if(token.record)s.put(token.record,key);
            s.put([...index,token.meta].sort((a,b)=>b.updatedAt-a.updatedAt),LOCAL_RECENT_INDEX_KEY);
            if(token.backup&&!values.dsf_autosave)s.put(token.backup,'dsf_autosave');
        });
    }
    return {put,remove,restore};
}
