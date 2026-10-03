// App metadata only; no account or manuscript storage is accessed.
export function createStudioVersionCheck({current,fetchVersion,online=()=>navigator.onLine,now=()=>Date.now(),onChange=()=>{},intervalMs=30*60*1000}) {
 let latest=null,phase='unknown',lastAttempt=-Infinity,pending=null;
 const read=()=>({current,latest,phase,available:!!latest&&latest.builtAt>current.builtAt&&latest.id!==current.id});
 const publish=()=>onChange(read());
 function check({force=false}={}) {
  if(pending)return pending;
  if(!online()){phase='offline';publish();return Promise.resolve(read());}
  const retrying=phase==='offline'||phase==='failed';
  if(!force&&now()-lastAttempt<(retrying?Math.min(intervalMs,60000):intervalMs)){
   if(phase==='offline'){phase='unknown';publish();}return Promise.resolve(read());
  }
  lastAttempt=now();phase='checking';publish();
  pending=Promise.resolve().then(fetchVersion).then(value=>{
   if(!value||value.schema!==1||typeof value.id!=='string'||!/^\d{17}$/.test(value.id)||!Number.isSafeInteger(value.builtAt)||value.builtAt<=0||typeof value.label!=='string'||!/^v[0-9.\-]+$/.test(value.label)||value.label.length>32)throw Error('INVALID_VERSION');
   latest=value;phase='checked';
  }).catch(()=>{phase=online()?'failed':'offline';}).finally(()=>{pending=null;publish();}).then(read);
  return pending;
 }
 return {read,check};
}
export async function fetchStudioVersion() {
 const response=await fetch('/studio-version.json',{cache:'no-cache',credentials:'omit',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('VERSION_UNAVAILABLE');return response.json();
}
