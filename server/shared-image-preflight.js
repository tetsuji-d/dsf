import {check,readBounded} from './private-authoring/common.js';
import {mapSharedImageSlots,privateImageHash} from '../js/shared-authoring-assets.js';
import {inspectDsfWebPBytes,sha256DsfBytes} from '../js/dsf-release-byte-sealing.js';
const MAX_IMAGES=1000,MAX_READS=32,MAX_BYTES=64*1024*1024,MAX_IMAGE_BYTES=25*1024*1024;
export function managedImageKey(value,ownerUid,publicBaseUrl){
    try{
        const base=new URL(publicBaseUrl),url=new URL(value);
        if(base.protocol!=='https:'||base.pathname!=='/'||base.search||base.hash||base.username||base.password
            ||url.origin!==base.origin||url.username||url.password||url.search||url.hash||/%|\\/.test(value)
            ||!url.pathname.endsWith('.webp'))return null;
        const key=url.pathname.slice(1);
        return [`users/${ownerUid}/dsf/`,`users/${ownerUid}/dsp/`].some(prefix=>key.startsWith(prefix))?key:null;
    }catch{return null;}
}
// Read-only inventory. Never fetch caller URLs, upload, convert, remove, or rewrite images.
export async function inspectSharedImages({project,ownerUid,publicBaseUrl,publicBucket,assertCurrent=async()=>{}}){
    const refs=new Map();let references=0;
    await mapSharedImageSlots(project,value=>{
        references++;refs.set(value,(refs.get(value)||0)+1);check(refs.size<=MAX_IMAGES,'TOO_MANY_IMAGES',422);return value;
    });
    const entries=[];let reads=0,readBytes=0,totalBytes=0;
    for(const [ref,occurrences]of refs){
        await assertCurrent();
        const key=managedImageKey(ref,ownerUid,publicBaseUrl),entry={number:entries.length+1,occurrences,
            name:key?key.split('/').pop().slice(0,120):'画像 '+(entries.length+1)};
        if(!key){entry.status=privateImageHash(ref)?'PRIVATE_IMAGE_RECHECK_REQUIRED':'UNSUPPORTED_IMAGE_REFERENCE';entries.push(entry);continue;}
        if(!publicBucket?.get){entry.status='IMAGE_STORAGE_UNAVAILABLE';entries.push(entry);continue;}
        if(reads>=MAX_READS||readBytes>=MAX_BYTES){entry.status='INSPECTION_LIMIT';entries.push(entry);continue;}
        let object;
        try{
            reads++;object=await publicBucket.get(key);
            if(!object){entry.status='IMAGE_MISSING';}
            else if(!Number.isSafeInteger(object.size)||object.size<=0||object.size>MAX_IMAGE_BYTES){entry.status='IMAGE_SIZE_INVALID';}
            else if(readBytes+object.size>MAX_BYTES){entry.status='INSPECTION_LIMIT';}
            else if(object.httpMetadata?.contentType!=='image/webp'){entry.status='IMAGE_FORMAT_INVALID';}
            else{
                readBytes+=object.size;
                const bytes=await readBounded(object.body,object.size);
                check(bytes.length===object.size,'IMAGE_LENGTH_INVALID',422);
                const info=await inspectDsfWebPBytes(bytes);
                check(info.width<=7680&&info.height<=7680,'IMAGE_DIMENSIONS_INVALID',422);
                Object.assign(entry,{status:'VERIFIED',byteLength:bytes.length,width:info.width,height:info.height,sha256:await sha256DsfBytes(bytes)});
                totalBytes+=bytes.length;
            }
        }catch{entry.status='IMAGE_READ_FAILED';}
        finally{await object?.body?.cancel().catch(()=>{});}
        await assertCurrent();entries.push(entry);
    }
    // Duplicate slots of one URL are counted once. Identical bytes under distinct URLs remain separate source objects.
    const imagePlanHash=await sha256DsfBytes(new TextEncoder().encode(JSON.stringify(entries)));
    return {references,uniqueImages:refs.size,verifiedImages:entries.filter(e=>e.status==='VERIFIED').length,
        verifiedBytes:totalBytes,copyable:entries.length>0&&entries.every(e=>e.status==='VERIFIED'),
        imagePlanHash,entries,originalPublicImagesRetained:true};
}
