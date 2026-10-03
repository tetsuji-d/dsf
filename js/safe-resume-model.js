import {prepareProjectForSave} from './project-persistence.js';
import {mapSharedImageSlots,privateImageHash} from './shared-authoring-assets.js';
const ignored=new Set(['user','uid','ownerUid','ownerEmail','projectId','workId','releaseId','localProjectId','activeLang','activeIdx','activePageIdx','activeBlockIdx','activeBubbleIdx','thumbColumns','uiPrefs','sections','pages','dsfPages','dsfStatus','dsfPublishedAt','dsfRenderStamp','dsfLangs','listThumbnail','projectBytes','pageCount','lastUpdated','createdAt','updatedAt','authoringRef','authoringSchemaVersion','authoringBackend','authoringStorageVersion','generationId','revision','visibility','publication']);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
export const digestBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function fingerprintProject(project,resolveImage=async()=>null){
 try{const normalized=prepareProjectForSave(structuredClone(project));for(const k of ignored)delete normalized[k];let complete=true;const cache=new Map();
  const content=await mapSharedImageSlots(normalized,async ref=>{if(!cache.has(ref))cache.set(ref,(async()=>{const expected=privateImageHash(ref),blob=await resolveImage(ref);if(!blob){complete=false;return null;}const hash=await digestBytes(await blob.arrayBuffer());if(expected&&expected!==hash){complete=false;return null;}return hash;})().catch(()=>{complete=false;return null;}));return 'sha256:'+await cache.get(ref);});
  // Unknown asset slots must not pass equality using a URL alone. Conservative even for URL-shaped extension text.
  const unresolved=v=>typeof v==='string'?/^(blob:|https?:\/\/|data:image\/|assets\/private\/)/.test(v):v&&typeof v==='object'?Object.values(v).some(unresolved):false;
  if(!complete||unresolved(content))return null;return {version:1,sha256:await digestBytes(new TextEncoder().encode(JSON.stringify(ordered(content))))};
 }catch{return null;}
}
export function classifyResume({base,local,cloud}){
 const valid=x=>x?.version===1&&/^[a-f0-9]{64}$/.test(x.sha256);
 if(!valid(local)||!valid(cloud))return 'unknown';
 if(local.sha256===cloud.sha256)return 'same';
 if(!valid(base))return 'unknown';
 if(base.sha256===cloud.sha256)return 'local';
 if(base.sha256===local.sha256)return 'cloud';
 return 'both';
}
