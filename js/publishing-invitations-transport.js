// Account-bound transport: a response from a previous login is never displayed.
export function createInvitationsClient({getUser,fetchImpl=fetch}){
    return async command=>{
        const user=getUser();if(!user?.uid)throw Error('AUTH_REQUIRED');const uid=user.uid;
        const current=()=>{if(getUser()!==user||getUser()?.uid!==uid)throw Error('AUTH_CHANGED');};
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{
            const token=await Promise.race([user.getIdToken(),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('INVITATIONS_TIMEOUT')),{once:true}))]);current();
            const r=await fetchImpl('/api/invitations',{method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,
                headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(command)});current();
            const reader=r.body.getReader(),chunks=[];let size=0;
            try{for(;;){const {value,done}=await reader.read();current();if(done)break;size+=value.length;if(size>1500000)throw Error('RESPONSE_TOO_LARGE');chunks.push(value);}}
            catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
            const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
            const data=JSON.parse(new TextDecoder().decode(bytes));current();if(!r.ok)throw Error(data.error||'INVITATIONS_UNAVAILABLE');return data;
        }finally{clearTimeout(timer);}
    };
}
