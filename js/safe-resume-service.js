import {createResumeStore} from './safe-resume-store.js';
import {fingerprintProject,classifyResume,digestBytes} from './safe-resume-model.js';
import {mapSharedImageSlots} from './shared-authoring-assets.js';
import {detachLocalProject} from './authoring-location.js';
// All external effects are supplied by the existing Studio adapters.
export function createSafeResumeService({store=createResumeStore(),scope,readBlob,writeBlob,readCloud,saveLocal,now=Date.now}){
 const forks=new Map();
 const same=(a,b)=>a.environment===b.environment&&a.ownerUid===b.ownerUid;
 const current=s=>{if(!same(s,scope()))throw Error('RESUME_SCOPE_CHANGED');};
 async function read(id){const s=scope(),r=await store.read(id);current(s);if(!r||!same(s,r))throw Error('RESUME_SCOPE_CHANGED');return r;}
 async function protect(record){
  if(!record?.state)throw Error('LOCAL_COPY_MISSING');const s=scope(),snapshot=structuredClone(record);delete snapshot.state.user;
  const sourceOwner=snapshot.state.ownerUid||snapshot.state.uid||'';
  const holder={...s,ownerUid:sourceOwner||s.ownerUid};const assets={};
  const used=new Set();await mapSharedImageSlots(snapshot.state,async ref=>{used.add(ref);return ref;});
  snapshot.imageMap=Object.fromEntries(Object.entries(snapshot.imageMap||{}).filter(([ref])=>used.has(ref)));
  delete snapshot.resumeSession;
  for(const id of new Set(Object.values(snapshot.imageMap||{}))){const b=await readBlob(id);if(b)assets[id]=b;}
  current(s);
  const assetHashes={};for(const [id,b] of Object.entries(assets))assetHashes[id]=await digestBytes(await b.arrayBuffer());
  const key=await digestBytes(new TextEncoder().encode(JSON.stringify([holder,snapshot,assetHashes])));current(s);
  return store.retain({...holder,id:'protected_'+key,sourceOwner,projectId:snapshot.state.projectId||null,record:snapshot,assets,name:snapshot.state.projectName||snapshot.state.title||'Untitled',createdAt:now()});
 }
 async function compare(id){const s=scope(),r=await read(id);if(!r.projectId||!s.ownerUid||s.ownerUid!==r.sourceOwner)return 'unknown';
  const remote=await readCloud(r.projectId);if(!remote){current(s);return 'unknown';}
  const localImage=async ref=>{const key=r.record.imageMap?.[ref];return key?r.assets?.[key]||await readBlob(key):remote.resolveImage?await remote.resolveImage(ref):null;};
  let local,cloud;try{current(s);[local,cloud]=await Promise.all([fingerprintProject(r.record.state,localImage),fingerprintProject(remote.project,remote.resolveImage)]);current(s);}finally{remote.dispose?.();}
  const proof=r.record.resume;const base=proof&&same(proof,s)&&proof.projectId===r.projectId?proof.fingerprint:null;
  return classifyResume({base,local,cloud});
 }
 async function fork(id){
  const s=scope(),r=await read(id),key=JSON.stringify([s,id]);let job=forks.get(key);
  if(job?.saved)return structuredClone(job.copy);if(job?.pending)return job.pending;
  if(!job){const copy=detachLocalProject(r.record.state,'work_'+crypto.randomUUID());copy.localProjectId='local_'+crypto.randomUUID();copy.projectName=(copy.projectName||copy.title||'Untitled')+'（端末版から複製）';job={copy,saved:false,imageMap:{}};forks.set(key,job);}
  job.pending=(async()=>{let remote;
   try{
    if(!job.prepared){const mapped=new Map();job.copy=await mapSharedImageSlots(job.copy,async ref=>{
      if(mapped.has(ref))return mapped.get(ref);
      const sourceKey=r.record.imageMap?.[ref];let blob=sourceKey?r.assets?.[sourceKey]||await readBlob(sourceKey):null;
      // Fetch scoped assets only through a fresh owner-authorized cloud read.
      if(!blob&&!ref.startsWith('blob:')&&r.projectId&&r.sourceOwner===s.ownerUid&&s.ownerUid){remote ||= await readCloud(r.projectId);current(s);blob=await remote?.resolveImage?.(ref);}
      if(!blob)throw Error('RESUME_IMAGE_MISSING');current(s);
      const blobKey='resume_image_'+crypto.randomUUID(),url=URL.createObjectURL(blob);await writeBlob(blobKey,blob);current(s);job.imageMap[url]=blobKey;mapped.set(ref,url);return url;
    });job.prepared=true;}
    current(s);await saveLocal(job.copy,job.imageMap);current(s);job.saved=true;return structuredClone(job.copy);
   }finally{remote?.dispose?.();job.pending=null;}
  })();return job.pending;
 }

 return {protect,read,compare,fork,list:()=>store.list(scope(),{metadataOnly:true}),
  async remove(id){const s=scope();await read(id);current(s);return store.remove(id);},
  async restore(record){if(!same(record,scope()))throw Error('RESUME_SCOPE_CHANGED');return store.restore(record);}};
}
export function createCloudResumeGuard(){let proof=null;
 return {reset(){proof=null;},loaded(identity,fingerprint=null){proof={...identity,fingerprint};},
  accepts(identity){return !!proof&&['environment','ownerUid','projectId','epoch'].every(k=>proof[k]===identity[k]);},
  read(identity){return this.accepts(identity)?{...proof}:null;}};
}
