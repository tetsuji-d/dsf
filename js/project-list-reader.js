// Read only dashboard fields directly; do not download legacy manuscript bodies.
// Firebase ID tokens retain the same owner-only Firestore rules as SDK reads.
export const PROJECT_LIST_FIELDS=Object.freeze(['workId','projectName','title','languages','dsfPages','dsfStatus','dsfPublishedAt','releaseId','dsfLangs','dsfTotalBytes','dsfResolution','dsfQuality','listThumbnail','projectBytes','pageCount','lastUpdated']);
function decode(value){
    if('stringValue' in value)return value.stringValue;
    if('integerValue' in value)return Number(value.integerValue);
    if('doubleValue' in value)return value.doubleValue;
    if('booleanValue' in value)return value.booleanValue;
    if('timestampValue' in value)return new Date(value.timestampValue);
    if('arrayValue' in value)return (value.arrayValue.values||[]).map(decode);
    if('mapValue' in value)return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([key,v])=>[key,decode(v)]));
    if('nullValue' in value)return null;
    throw Error('PROJECT_LIST_INVALID');
}
export async function readProjectList({projectId,uid,getUser,fetchImpl=fetch,timeoutMs=5000}){
    const user=getUser();if(!user||user.uid!==uid)throw Error('AUTH_CHANGED');
    const current=()=>{if(getUser()!==user||getUser()?.uid!==uid)throw Error('AUTH_CHANGED');};
    const parent=`projects/${projectId}/databases/(default)/documents/users/${uid}`;
    const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}:runQuery`;
    for(let attempt=0;attempt<2;attempt++){
        current();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
        try{
            const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('PROJECT_LIST_TIMEOUT')),{once:true}));
            const token=await Promise.race([user.getIdToken(),aborted]);current();
            const response=await fetchImpl(url,{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,
                headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
                body:JSON.stringify({structuredQuery:{from:[{collectionId:'projects'}],select:{fields:PROJECT_LIST_FIELDS.map(fieldPath=>({fieldPath}))}}})});
            if(!response.ok)throw Object.assign(Error('PROJECT_LIST_UNAVAILABLE'),{retryable:[429,500,502,503,504].includes(response.status)});
            const reader=response.body.getReader(),chunks=[];let size=0;
            try{for(;;){const {value,done}=await reader.read();current();if(done)break;size+=value.length;if(size>16*1024*1024)throw Object.assign(Error('PROJECT_LIST_TOO_LARGE'),{retryable:false});chunks.push(value);}}
            catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
            const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
            current();const rows=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(rows))throw Object.assign(Error('PROJECT_LIST_INVALID'),{retryable:false});
            return rows.filter(row=>row.document).map(({document:doc})=>{
                const prefix=parent+'/projects/';if(!doc.name.startsWith(prefix)||doc.name.slice(prefix.length).includes('/'))throw Object.assign(Error('PROJECT_LIST_SCOPE_INVALID'),{retryable:false});
                const fields=Object.fromEntries(Object.entries(doc.fields||{}).filter(([key])=>PROJECT_LIST_FIELDS.includes(key)).map(([key,value])=>[key,decode(value)]));
                return {id:doc.name.slice(prefix.length),...fields};
            });
        }catch(e){current();if(attempt===1||e.retryable===false)throw e;}
        finally{clearTimeout(timer);}
    }
}
