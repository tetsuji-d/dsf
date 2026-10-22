// Inlined into the platform worker only for Writing preview builds.
// A completed snapshot contains application resources, never a reader's files.
const RW_ASSETS=__READER_WRITING_ASSETS__;
const RW_CONTROL='dsf-reader-writing-control-v1',RW_MARKER='/__reader_writing_snapshot__';
let rwPreparing;
const rwHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function rwSnapshot(){
 const response=await (await caches.open(RW_CONTROL)).match(RW_MARKER);
 return response?response.json():null;
}
async function rwInspect(){
 const snapshot=await rwSnapshot();
 if(!snapshot)return {ready:false};
 const cache=await caches.open(snapshot.cache);
 for(const asset of snapshot.assets){
  const response=await cache.match(asset.url);
  if(!response?.ok)return {ready:false};
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==asset.byteLength||await rwHash(bytes)!==asset.sha256)return {ready:false};
 }
 return {ready:true,build:snapshot.build,resources:snapshot.assets.length};
}
async function rwPrepare(){
 if(!RW_ASSETS.length)throw Error('READER_OFFLINE_UNAVAILABLE');
 const candidate='dsf-reader-writing-'+VERSION+'-'+crypto.randomUUID();
 try{
  const cache=await caches.open(candidate),source=await caches.open(CACHE),assets=[];
  // The installed shell was accepted atomically by the platform worker.
  // Copy it so an update cannot leave the prepared Reader without its old modules.
  for(const url of [...SHELL,...SDK]){
   const response=await source.match(url);
   if(!validResource(url,response))throw Error('READER_SHELL_MISSING');
   const bytes=await response.clone().arrayBuffer();
   assets.push({url,byteLength:bytes.byteLength,sha256:await rwHash(bytes)});
   await cache.put(url,response);
  }
  for(const asset of RW_ASSETS){
   const response=await fetch(asset.url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error('WRITING_RESOURCE_MISSING');
   const bytes=await response.clone().arrayBuffer();
   if(bytes.byteLength!==asset.byteLength||await rwHash(bytes)!==asset.sha256)throw Error('WRITING_VERSION_CHANGED');
   await cache.put(asset.url,response);assets.push(asset);
  }
  // Publish only after every put succeeds, including quota failures.
  await (await caches.open(RW_CONTROL)).put(RW_MARKER,new Response(JSON.stringify({cache:candidate,build:BUILD,assets})));
  return {ready:true,build:BUILD,resources:assets.length};
 }catch(error){await caches.delete(candidate);throw error;}
}
async function rwCached(key){
 const snapshot=await rwSnapshot();
 if(!snapshot)return;
 const asset=snapshot.assets.find(a=>absolute(a.url)===absolute(key));
 if(!asset)return;
 return (await caches.open(snapshot.cache)).match(asset.url);
}
self.addEventListener('message',event=>{
 if(!['READER_WRITING_STATUS','READER_WRITING_PREPARE'].includes(event.data?.type))return;
 event.waitUntil((async()=>{
  try{
   if(event.data.type==='READER_WRITING_PREPARE'&&event.data.buildId!==BUILD.id)throw Error('OFFLINE_REOPEN_REQUIRED');
   const result=event.data.type==='READER_WRITING_STATUS'?await rwInspect():await (rwPreparing||=(rwPrepare().finally(()=>{rwPreparing=null;})));
   event.ports[0]?.postMessage({ok:true,...result});
  }catch(error){event.ports[0]?.postMessage({ok:false,ready:false,error:error.message});}
 })());
});
readerWritingCached=rwCached;
// Only explicit app resources are eligible. Files, auth headers and APIs bypass us.
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(!RW_ASSETS.length||request.method!=='GET'||request.headers.has('Authorization')||url.origin!==self.location.origin||!url.pathname.startsWith('/writing/'))return;
 event.respondWith((async()=>{
  // Live Reader uses the live deployment. Offline uses the last complete snapshot.
  try{const response=await fetch(request,{cache:'no-store'});if(!response.ok)throw Error('WRITING_FETCH');return response;}
  catch(error){const hit=await rwCached(url.pathname==='/writing/'?'/writing/':url.pathname);if(hit)return hit;throw error;}
 })());
});

