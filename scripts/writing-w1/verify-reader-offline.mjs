import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
const hash=b=>createHash('sha256').update(b).digest('hex');
const origin='https://reader.example',build={id:'20261019000000000',schema:1},stores=new Map(),handlers={};
const key=k=>new URL(typeof k==='string'?k:k.url||k.href,origin).href;
let offline=false,failure='',quota=false,staleHttpCache=false;
const caches={keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n),open:async n=>{
 if(!stores.has(n))stores.set(n,new Map());const store=stores.get(n);
 return {match:async k=>store.get(key(k))?.clone(),keys:async()=>[...store.keys()].map(url=>({url})),put:async(k,v)=>{
  if(quota&&n.startsWith('dsf-reader-writing-')&&!n.includes('control'))throw Error('QuotaExceededError');
  store.set(key(k),v.clone());}};
}};
const resources=new Map([['/viewer.html','<head><meta name="dsf-studio-build" content="'+build.id+'"></head>'],['/assets/reader.js','reader code'],['/writing/','writing html'],['/writing/app.mjs','writing code'],['/writing/assets/font.woff2','font bytes']]);
const writing=[...resources].filter(([p])=>p.startsWith('/writing/')).map(([url,body])=>({url,byteLength:Buffer.byteLength(body),sha256:hash(body)}));
const source=(await readFile(new URL('../../js/studio-service-worker.js',import.meta.url),'utf8'))
 .replace('__STUDIO_FULL_OFFLINE__','false').replace('__STUDIO_VERSION__','"test"').replace('__STUDIO_BUILD_INFO__',JSON.stringify(build))
 .replace('__STUDIO_PRECACHE__','["/viewer.html","/assets/reader.js"]')
 .replace('/* READER_WRITING_WORKER */',(await readFile(new URL('../../js/reader-writing-offline-worker.js',import.meta.url),'utf8')).replace('__READER_WRITING_ASSETS__',JSON.stringify(writing)));
const fetch=async (input,options={})=>{
 if(offline)throw Error('OFFLINE');
 const url=new URL(typeof input==='string'?input:input.url||input.href,origin),body=resources.get(url.pathname)??'sdk module';
 if(staleHttpCache&&url.pathname==='/writing/app.mjs'&&options.cache!=='no-store')return new Response('stale browser code');
 if(failure==='network'&&url.pathname==='/writing/app.mjs')throw Error('NETWORK');
 return new Response(failure==='integrity'&&url.pathname==='/writing/app.mjs'?'wrong version':body,{headers:{'Content-Type':url.pathname.endsWith('.html')?'text/html':'application/javascript'}});
};
vm.runInNewContext(source,{URL,Request,Response,AbortSignal,crypto:webcrypto,Uint8Array,caches,fetch,self:{location:{origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(type,fn)=>(handlers[type]||=[]).push(fn)}});
async function event(type,props={}){const pending=[];for(const fn of handlers[type]||[])fn({...props,waitUntil:p=>pending.push(p)});await Promise.all(pending);}
async function message(type,extra={}){let reply;await event('message',{data:{type,...extra},ports:[{postMessage:r=>{reply=r;}}]});return reply;}
async function request(path,options){let response;await event('fetch',{request:new Request(origin+path,options),respondWith:p=>{assert.equal(response,undefined,'only one worker handler claims request');response=p;}});return response&&await response;}
await event('install');
assert.equal((await message('READER_WRITING_STATUS')).ready,false);
assert.equal((await message('READER_WRITING_PREPARE',{buildId:'wrong'})).ok,false);
assert.equal((await message('READER_WRITING_PREPARE',{buildId:build.id})).ready,true);
assert.equal((await message('READER_WRITING_STATUS')).ready,true);
// A long-lived browser HTTP cache must not mix old tools with the new Reader shell.
staleHttpCache=true;resources.set('/writing/app.mjs','new writing code');
assert.equal(await (await request('/writing/app.mjs')).text(),'new writing code','online requests bypass stale HTTP assets');
offline=true;
assert.equal(await (await request('/writing/app.mjs')).text(),'writing code','offline retains the last verified snapshot');
offline=false;staleHttpCache=false;resources.set('/writing/app.mjs','writing code');
const control=await caches.open('dsf-reader-writing-control-v1'),marker='/__reader_writing_snapshot__',first=await (await control.match(marker)).text();
for(const mode of ['network','integrity','quota']){
 failure=mode;quota=mode==='quota';
 assert.equal((await message('READER_WRITING_PREPARE',{buildId:build.id})).ok,false,mode);
 assert.equal(await (await control.match(marker)).text(),first,'old snapshot retained');
 assert.equal((await message('READER_WRITING_STATUS')).ready,true);
}
failure='';quota=false;offline=true;
await caches.delete('dsf-studio-shell-test-web');
assert.equal(await (await request('/viewer?src=remote-book')).text(),resources.get('/viewer.html'));
assert.equal(await (await request('/writing/app.mjs')).text(),'writing code');
assert.equal(await (await request('/assets/reader.js')).text(),'reader code');
assert.equal(await request('/upload-release',{method:'POST'}),undefined);
assert.equal(await request('/writing/app.mjs',{headers:{Authorization:'Bearer example'}}),undefined);
const snapshot=JSON.parse(first),cache=await caches.open(snapshot.cache);
await cache.put('/writing/assets/font.woff2',new Response('corrupt'));
assert.equal((await message('READER_WRITING_STATUS')).ready,false,'corrupt cache is not ready');
offline=false;await event('install');assert.equal((await message('READER_WRITING_PREPARE',{buildId:build.id})).ready,true);
assert.equal((await message('READER_WRITING_STATUS')).ready,true);
console.log('PASS Reader offline: complete snapshot, network/integrity/quota rollback, offline restart resources, cache corruption detection, retry, API isolation.');

