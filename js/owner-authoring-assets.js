import {AuthoringClientError} from './private-authoring-client.js';
import {privateImageHash,mapSharedImageSlots} from './shared-authoring-assets.js';
import {sha256DsfBytes} from './dsf-release-byte-sealing.js';
const check=(ok,code)=>{if(!ok)throw new AuthoringClientError(code);};
export function createOwnerImageSession({projectId,user,isCurrent,fetcher=globalThis.fetch,onBlob=async()=>{}}) {
    const base='/api/projects/'+encodeURIComponent(projectId)+'/assets',urls=new Map(),refs=new Map(),sizes=new Map();
    let disposed=false;
    const current=()=>!disposed&&isCurrent();
    async function request(path,options={},limit=25*1024*1024) {
        check(current(),'AUTHORING_SESSION_CHANGED');const token=await user.getIdToken(false);
        check(current(),'AUTHORING_SESSION_CHANGED');
        const response=await fetcher(base+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),headers:{...options.headers,Authorization:'Bearer '+token}});
        const reader=response.body.getReader(),parts=[];let size=0;
        try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;check(size<=(response.ok?limit:32768),'AUTHORING_RESPONSE_TOO_LARGE');parts.push(value);}}
        catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
        check(current(),'AUTHORING_SESSION_CHANGED');
        const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
        if(!response.ok){let code;try{code=JSON.parse(new TextDecoder().decode(bytes)).error;}catch{}throw new AuthoringClientError(code||'AUTHORING_UNAVAILABLE',response.status);}
        return {bytes,response};
    }
    async function image(ref) {
        const hash=privateImageHash(ref);if(!hash)return ref;
        if(urls.has(ref))return urls.get(ref);
        const {bytes,response}=await request('/'+hash);
        check(response.headers.get('Content-Type')==='image/webp'&&await sha256DsfBytes(bytes)===hash,'PRIVATE_IMAGE_CORRUPT');
        check(current(),'AUTHORING_SESSION_CHANGED');
        const blob=new Blob([bytes],{type:'image/webp'}),url=URL.createObjectURL(blob);
        urls.set(ref,url);refs.set(url,ref);sizes.set(ref,bytes.length);
        await onBlob(url,blob);check(current(),'AUTHORING_SESSION_CHANGED');return url;
    }
    return {refs,sizes,get privateWrites(){return true;},
        hydrate:project=>mapSharedImageSlots(project,image),
        async addImage(blob){
            check(blob.type==='image/webp'&&blob.size<=25*1024*1024,'INVALID_WEBP');
            const {bytes}=await request('',{method:'POST',headers:{'Content-Type':'image/webp'},body:blob},32768);
            const asset=JSON.parse(new TextDecoder().decode(bytes));
            check(privateImageHash(asset.ref)===await sha256DsfBytes(blob),'PRIVATE_IMAGE_CORRUPT');
            return {...asset,url:await image(asset.ref)};
        },
        dispose(){disposed=true;for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();refs.clear();sizes.clear();}
    };
}
