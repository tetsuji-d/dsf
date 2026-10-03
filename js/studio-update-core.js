// Shared by Studio and the independent recovery page. Authoring storage is untouched.
export function validStudioBuild(value) {
 return !!value&&value.schema===1&&typeof value.id==='string'&&/^\d{17}$/.test(value.id)&&Number.isSafeInteger(value.builtAt)&&value.builtAt>0&&typeof value.label==='string'&&value.label.length<=32&&/^v[0-9.\-]+$/.test(value.label);
}
export async function fetchStudioUpdateTarget(fetcher=fetch) {
 const response=await fetcher('/studio-version.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('VERSION_UNAVAILABLE');
 const build=await response.json();if(!validStudioBuild(build))throw Error('VERSION_UNCONFIRMED');return build;
}
export function waitForStudioWorker(worker,states,timeout=180000) {
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);error?reject(error):resolve();};
  const changed=()=>{if(states.includes(worker.state))finish();else if(worker.state==='redundant')finish(Error('INSTALL_FAILED'));};
  const timer=setTimeout(()=>finish(Error('UPDATE_TIMEOUT')),timeout);worker.addEventListener('statechange',changed);changed();
 });
}
export function studioWorkerBuild(worker) {
 return new Promise((resolve,reject)=>{const channel=new MessageChannel();
  const finish=(error,value)=>{clearTimeout(timer);channel.port1.close();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(Error('VERSION_UNCONFIRMED')),10000);
  channel.port1.onmessage=e=>finish(null,e.data);
  try{worker.postMessage({type:'STUDIO_BUILD'},[channel.port2]);}catch(error){finish(error);}
 });
}
export async function prepareStudioUpdate(target,{
 serviceWorker=globalThis.navigator?.serviceWorker,origin=globalThis.location?.origin,
 fetcher=fetch,readBuild=studioWorkerBuild,onProgress=()=>{}
}={}) {
 if(!validStudioBuild(target))throw Error('VERSION_UNCONFIRMED');
 if(!serviceWorker)return;
 let registration=await serviceWorker.getRegistration('/');if(!registration)return;
 const existing=registration.active||registration.waiting||registration.installing;
 if(!existing||new URL(existing.scriptURL).origin!==origin||new URL(existing.scriptURL).pathname!=='/studio-sw.js')throw Error('UNEXPECTED_WORKER');
 onProgress('downloading',target);
 // A build-specific URL also escapes an older cached response for the worker script.
 // Keep scope and registration identity; do not unregister or clear any databases.
 registration=await serviceWorker.register('/studio-sw.js?build='+encodeURIComponent(target.id),{scope:'/',updateViaCache:'none'});
 if(registration.installing)await waitForStudioWorker(registration.installing,['installed','activated']);
 const worker=registration.waiting||registration.active;if(!worker)throw Error('UPDATE_UNAVAILABLE');
 if((await readBuild(worker))?.id!==target.id)throw Error('VERSION_CHANGED');
 onProgress('activating',target);
 if(registration.waiting===worker){const ready=waitForStudioWorker(worker,['activated']);worker.postMessage({type:'STUDIO_ACTIVATE'});await ready;}
 if(!registration.active||(await readBuild(registration.active))?.id!==target.id)throw Error('VERSION_CHANGED');
 // Activation alone is not evidence that this page is controlled by the new worker.
 if(!serviceWorker.controller||(await readBuild(serviceWorker.controller))?.id!==target.id)throw Error('CONTROLLER_UNCONFIRMED');
 onProgress('checking',target);
 const page=await fetcher('/studio?studioBuild='+encodeURIComponent(target.id),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15000)});
 const html=page.ok?await page.text():'';
 if(!html.includes('name="dsf-studio-build" content="'+target.id+'"'))throw Error('SHELL_UNCONFIRMED');
 onProgress('ready',target);
}
