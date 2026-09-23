// Bounded account-scoped API reads. Mutations are never replayed automatically.
export async function accountJsonRequest({getUser,fetcher,url,command=null,readOnly=false,limit,timeoutMs,errors}) {
    const user=getUser();if(!user?.uid)throw Error(errors.auth);const uid=user.uid;
    const current=()=>{if(getUser()!==user||getUser()?.uid!==uid)throw Error('AUTH_CHANGED');};
    let refreshToken=false;
    for(let attempt=0;attempt<(readOnly?2:1);attempt++){
        current();const controller=new AbortController();let timer;
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error(errors.timeout),{transient:true}));},timeoutMs);});
        try{
            return await Promise.race([deadline,(async()=>{
                const token=await user.getIdToken(refreshToken);current();controller.signal.throwIfAborted();
                let response;
                try{response=await fetcher(url,{method:command?'POST':'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,
                    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(command?{body:JSON.stringify(command)}:{})});}
                catch{throw Object.assign(Error(controller.signal.aborted?errors.timeout:errors.offline),{transient:true});}
                current();const reader=response.body?.getReader();if(!reader)throw Error(errors.invalid);
                const chunks=[];let size=0;
                try{for(;;){const {value,done}=await reader.read();current();if(done)break;size+=value.byteLength;if(size>limit)throw Error(errors.invalid);chunks.push(value);}}
                catch(e){void reader.cancel().catch(()=>{});if(controller.signal.aborted)throw Object.assign(Error(errors.timeout),{transient:true});if(e instanceof TypeError)throw Object.assign(Error(errors.offline),{transient:true});throw e;}
                finally{reader.releaseLock();}
                current();controller.signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
                let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Object.assign(Error(errors.invalid),{transient:[429,500,502,503,504].includes(response.status)});}
                if(!response.ok){const code=typeof data?.error==='string'?data.error:errors.unavailable;
                    const transient=[429,500,502,503,504].includes(response.status)&&['UPSTREAM_UNAVAILABLE','UPSTREAM_INVALID_RESPONSE','AUTH_KEYS_UNAVAILABLE',errors.unavailable].includes(code);
                    throw Object.assign(Error(code),{transient,refresh:response.status===401&&['AUTH_EXPIRED','AUTH_INVALID'].includes(code)});}
                return data;
            })()]);
        }catch(e){current();if(!readOnly||attempt===1||(!e.transient&&!e.refresh))throw e;refreshToken=!!e.refresh;}
        finally{clearTimeout(timer);controller.abort();}
    }
}
