import {validStudioBuild,fetchStudioUpdateTarget,waitForStudioWorker,studioWorkerBuild} from './studio-update-core.js';
export function platformWorkerPath(worker,origin){
 if(!worker?.scriptURL)return null;
 const url=new URL(worker.scriptURL,origin);
 return url.origin===origin&&['/studio-sw.js','/viewer-sw.js','/platform-sw.js'].includes(url.pathname)?url.pathname:null;
}
export async function preparePlatformUpdate(target,{serviceWorker=globalThis.navigator?.serviceWorker,origin=globalThis.location?.origin,readBuild=studioWorkerBuild}={}){
 if(!validStudioBuild(target))throw Error('VERSION_UNCONFIRMED');
 if(!serviceWorker)return;
 let registration=await serviceWorker.getRegistration('/');
 const existing=registration?.active||registration?.waiting||registration?.installing;
 const path=existing?platformWorkerPath(existing,origin):'/platform-sw.js';
 if(!path)throw Error('UNEXPECTED_WORKER');
 const installed=existing?await readBuild(existing).catch(()=>null):null;
 if(installed?.id===target.id)return;
 if(installed?.builtAt>target.builtAt)throw Error('VERSION_CHANGED');
 registration=await serviceWorker.register(path+'?build='+target.id,{scope:registration?.scope||'/',updateViaCache:'none'});
 if(registration.installing)await waitForStudioWorker(registration.installing,['installed','activated']);
 const worker=registration.waiting||registration.active;
 if(!worker||(await readBuild(worker))?.id!==target.id)throw Error('VERSION_CHANGED');
 if(registration.waiting===worker){const done=waitForStudioWorker(worker,['activated']);worker.postMessage({type:'STUDIO_ACTIVATE'});await done;}
 if(!registration.active||(await readBuild(registration.active))?.id!==target.id)throw Error('VERSION_CHANGED');
}
// Never reload, navigate, save a manuscript, or erase local data. Existing tabs
// stay on their loaded code; only a later document navigation picks up the update.
export function createPlatformUpdate({current,fetchVersion=fetchStudioUpdateTarget,prepare=preparePlatformUpdate,online=()=>navigator.onLine,now=()=>Date.now(),onChange=()=>{},interval=30*60*1000}={}){
 let pending=null,last=-Infinity,phase='idle',latest=null,prepared=null;
 const read=()=>({current,latest,phase});
 const publish=()=>onChange(read());
 async function run(){
  phase='checking';publish();
  try{
   const target=await fetchVersion();if(!validStudioBuild(target))throw Error('VERSION_UNCONFIRMED');latest=target;
   // Do not activate an older build after a deployment race or stale response.
   if(target.builtAt<current.builtAt){phase='current';return read();}
   if(prepared!==target.id){phase='preparing';publish();await prepare(target);prepared=target.id;}
   phase=target.id===current.id?'current':'ready';
  }catch{phase=online()?'retry':'offline';}finally{publish();}
  return read();
 }
 function check({force=false}={}){
  if(pending)return pending;
  if(!online()){phase='offline';publish();return Promise.resolve(read());}
  const delay=phase==='retry'||phase==='offline'?60000:interval;
  if(!force&&now()-last<delay)return Promise.resolve(read());
  last=now();pending=run().finally(()=>{pending=null;});return pending;
 }
 return {check,read};
}
