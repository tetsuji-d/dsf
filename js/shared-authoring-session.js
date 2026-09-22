import {createPrivateAuthoringClient,AuthoringClientError} from './private-authoring-client.js';
import {isPrivateAuthoringId} from './private-authoring-ids.js';
import {privateImageHash,mapSharedImageSlots} from './shared-authoring-assets.js';
import {sha256DsfBytes} from './dsf-release-byte-sealing.js';
const check=(ok,code)=>{if(!ok)throw new AuthoringClientError(code);};
// Separate editor-session adapter. It never writes to the participant's personal cloud project.
export async function openSharedAuthoringSession({spaceId,workId,user,isCurrent,fetcher=globalThis.fetch,onInvalidated=()=>{},sessionId=crypto.randomUUID()}) {
    check(isPrivateAuthoringId(spaceId)&&isPrivateAuthoringId(workId)&&isPrivateAuthoringId(user?.uid),'AUTHORING_SCOPE_INVALID');
    const base=`/api/spaces/${encodeURIComponent(spaceId)}/works/${encodeURIComponent(workId)}`;
    const actorUid=user.uid,urls=new Map(),refs=new Map();let disposed=false,context,edited=false;
    const current=()=>!disposed&&isCurrent()&&user.uid===actorUid;
    function dispose(){disposed=true;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();refs.clear();}
    function failed(error){if([401,403].includes(error.status)||/SESSION_CHANGED/.test(error.code||'')){dispose();onInvalidated(error);}throw error;}
    const lockHeaders=()=>({'X-Shared-Session':sessionId,...(context?.lock?.fence?{'X-Shared-Lock':context.lock.fence}:{})});
    const scopedFetch=(url,options={})=>fetcher(url,{...options,headers:{...options.headers,...lockHeaders()}});
    async function request(path,options={},limit=32*1024){
        check(current(),'AUTHORING_SESSION_CHANGED');const token=await user.getIdToken(false);check(current(),'AUTHORING_SESSION_CHANGED');
        const response=await scopedFetch(base+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...options.headers,Authorization:'Bearer '+token}});
        const reader=response.body.getReader(),parts=[];let length=0;
        try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;check(length<=(response.ok?limit:32768),'AUTHORING_RESPONSE_TOO_LARGE');parts.push(value);}}
        catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        check(current(),'AUTHORING_SESSION_CHANGED');const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
        if(!response.ok){let code;try{code=JSON.parse(new TextDecoder().decode(bytes)).error;}catch{}throw new AuthoringClientError(code||'SHARED_AUTHORING_UNAVAILABLE',response.status);}
        return {bytes,response};
    }
    async function getContext(){
        const result=JSON.parse(new TextDecoder().decode((await request('/context')).bytes));
        check(result.spaceId===spaceId&&result.workId===workId&&isPrivateAuthoringId(result.ownerUid)&&isPrivateAuthoringId(result.projectId)&&typeof result.canEdit==='boolean','AUTHORING_SCOPE_INVALID');
        if(context)check(result.ownerUid===context.ownerUid&&result.projectId===context.projectId,'AUTHORING_SESSION_CHANGED');
        context=result;return {...result};
    }
    async function image(ref){
        const hash=privateImageHash(ref);check(hash,'PRIVATE_IMAGES_REQUIRED');if(urls.has(ref))return urls.get(ref);
        const {bytes,response}=await request('/assets/'+hash,{},25*1024*1024);
        check(response.headers.get('Content-Type')==='image/webp'&&await sha256DsfBytes(bytes)===hash,'PRIVATE_IMAGE_CORRUPT');
        check(current(),'AUTHORING_SESSION_CHANGED');const url=URL.createObjectURL(new Blob([bytes],{type:'image/webp'}));urls.set(ref,url);refs.set(url,ref);return url;
    }
    try {
        await getContext();
        const client=createPrivateAuthoringClient({uid:user.uid,storageUid:context.ownerUid,projectId:context.projectId,user,isCurrent:current,fetcher:scopedFetch,sharedScope:{spaceId,workId}});
        const loaded=await client.load(),project=await mapSharedImageSlots(loaded,image);
        return Object.freeze({project,context:{...context},dispose,getHead:()=>client.getHead(),
            noteEdit(){edited=true;},
            async lockAction(action,requestId){
                try {await request('/lock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,requestId})});return await getContext();}
                catch(error){return failed(error);}
            },
            async checkAccess(){try{
                if(context?.lock?.isMine){
                    try {await request('/lock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:edited?'edited':'heartbeat'})});edited=false;}
                    catch(error){if(error.code!=='EDIT_LOCK_LOST'&&error.status!==403)throw error;}
                }
                return await getContext();
            }catch(error){return failed(error);}},
            async addImage(webp){try{
                await getContext();check(context.canEdit,'EDIT_FORBIDDEN');check(webp.type==='image/webp'&&webp.size<=25*1024*1024,'INVALID_WEBP');
                const {bytes}=await request('/assets',{method:'POST',headers:{'Content-Type':'image/webp'},body:webp});
                const asset=JSON.parse(new TextDecoder().decode(bytes));check(privateImageHash(asset.ref)===await sha256DsfBytes(webp),'PRIVATE_IMAGE_CORRUPT');
                return {...asset,url:await image(asset.ref)};
            }catch(error){return failed(error);}},
            async save(project){try{
                await getContext();check(context.canEdit,'EDIT_FORBIDDEN');
                const stored=await mapSharedImageSlots(project,url=>{const ref=refs.get(url)||url;check(privateImageHash(ref),'PRIVATE_IMAGES_REQUIRED');return ref;});
                await client.save(stored);return client.getHead();
            }catch(error){return failed(error);}}
        });
    }catch(error){dispose();throw error;}
}
