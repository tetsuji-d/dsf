import {prepareProjectForSave,prepareFirestoreProjectIngress} from './project-persistence.js';
import {mapSharedImageSlots,privateImageHash} from './shared-authoring-assets.js';
const fail=code=>{throw Object.assign(new Error(code),{code});};
// A copy is a new unpublished work. Content IDs stay internal to that work.
export async function prepareProjectCopy(source,{projectId,workId,name}){
    if(typeof name!=='string'||!name.trim()||name.trim().length>200)fail('COPY_NAME_INVALID');
    if(!projectId||!workId||projectId===source.projectId||workId===source.workId)fail('COPY_ID_INVALID');
    const copy=structuredClone(prepareFirestoreProjectIngress(source));
    for(const key of Object.keys(copy))if(/^(authoring|dsf)/.test(key)||['uid','ownerUid','localProjectId','publication','releaseId','releases','visibility','listThumbnail','listingThumbnail','publicationThumbnailUrl','publicationThumbnailSource','publicUrl','publishedAt','sharedScope','spaceId','labelId','lastUpdated','createdAt','updatedAt'].includes(key))delete copy[key];
    Object.assign(copy,{projectId,workId,projectName:name.trim(),visibility:'private',dsfStatus:'draft',releaseId:null});
    const checked=await mapSharedImageSlots(copy,async url=>{
        if(privateImageHash(url))fail('COPY_PRIVATE_IMAGES_UNSUPPORTED');
        if(/^(blob:|data:)/.test(url))fail('COPY_ASSET_UNRESOLVED');
        return url;
    });
    return prepareProjectForSave(checked);
}
// Retain the frozen snapshot/client across retries, including a lost create response.
export function createProjectCopyJob({readSource,createClient,newId,isCurrent,validateDestination=async()=>{},assignDestination=async()=>{}}){
    let prepared=null,client=null,result=null,created=null,busy=false,destination=null;
    const current=()=>{if(!isCurrent())fail('AUTH_CHANGED');};
    return {async run(name,spaceId=null){
        current();if(result)return result;if(busy)fail('COPY_BUSY');busy=true;
        try{
            if(!prepared){await validateDestination(spaceId);current();const source=await readSource();current();
                const projectId=newId('proj'),workId=newId('work');
                prepared=await prepareProjectCopy(source,{projectId,workId,name});current();destination=spaceId;client=createClient(projectId);}
            if(!created){await client.create(prepared);current();created={projectId:prepared.projectId,workId:prepared.workId,projectName:prepared.projectName};}
            if(destination){try{await assignDestination(created.projectId,destination);current();}catch(e){if(e.code==='AUTH_CHANGED'||e.message==='AUTH_CHANGED')throw e;fail('COPY_DESTINATION_FAILED');}}
            result={...created,spaceId:destination};return result;
        }finally{busy=false;}
    }};
}
