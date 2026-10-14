import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {writingStagingAssets,writingStagingPlugin} from './staging-assets.mjs';
const files=await writingStagingAssets(),get=name=>files.get('writing/'+name).toString();
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(writingStagingPlugin('production'),null);
const previous=process.env.DSF_WRITING_PREVIEW;delete process.env.DSF_WRITING_PREVIEW;assert.equal(writingStagingPlugin('staging'),null);if(previous!==undefined)process.env.DSF_WRITING_PREVIEW=previous;
assert.ok([...files.keys()].every(p=>p.startsWith('writing/')&&!/browser-saved|fixture|secrets|outputs/.test(p)));
assert.ok(!get('reader-writing.mjs').includes('record-file'));
assert.ok(get('index.html').includes('id="record" hidden'));
assert.ok(get('reader-runtime.mjs').includes("{scope:'/writing/'}"));
const list=JSON.parse(get('cache-list.json'));
for(const a of list){const file=a.url==='/writing/'?'writing/index.html':a.url.slice(1);assert.equal(hash(files.get(file)),a.sha256);}
// Exact prefixed module/worker URL references must resolve to emitted assets.
for(const name of ['reader-writing.mjs','reader-runtime.mjs','font-worker.js'])for(const m of get(name).matchAll(/['"](\/writing\/[^'"`]+)['"]/g)){
    if(m[1]==='/writing/')continue;assert.ok(files.has(m[1].slice(1)),`${name}: missing ${m[1]}`);
}
// Test the worker's scope boundary and failed preparation without touching real caches.
const handlers={},stores=new Map(),key=r=>typeof r==='string'?r:r.url||r.href;
const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const store=stores.get(name);return {match:async r=>store.get(key(r))?.clone(),put:async(r,v)=>store.set(key(r),v.clone())};},delete:async name=>stores.delete(name)};
const origin='https://staging.dsf-studio.pages.dev';let fail=false,reply,pending;
const fetch=async input=>{const url=new URL(typeof input==='string'?input:input.url||input.href,origin);if(fail&&url.pathname.endsWith('sample.dsf'))return new Response('',{status:503});
    const name=url.pathname==='/writing/'?'writing/index.html':url.pathname.slice(1),bytes=files.get(name);return new Response(bytes||'',{status:bytes?200:404});};
vm.runInNewContext(get('sw.js'),{self:{location:{origin},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},URL,Response,crypto:webcrypto,caches,fetch,Date,Uint8Array});
const prepare=async()=>{handlers.message({data:{type:'prepare'},ports:[{postMessage:data=>{reply=data;}}],waitUntil:p=>{pending=p;}});await pending;return reply;};
assert.equal((await prepare()).ok,true);const marker=origin+'/writing/offline-snapshot';
const control=await caches.open('dsf-writing-preview-control-v1'),snapshot=await (await control.match(marker)).text();
fail=true;assert.equal((await prepare()).ok,false);assert.equal(await (await control.match(marker)).text(),snapshot);
let intercepted=false;handlers.fetch({request:new Request(origin+'/studio'),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
let response;handlers.fetch({request:new Request(origin+'/writing/sample.dsf'),respondWith:p=>{response=p;}});assert.equal(hash(new Uint8Array(await (await response).arrayBuffer())),hash(files.get('writing/sample.dsf')));
handlers.fetch({request:new Request(origin+'/writing/?reader=offline-test'),respondWith:p=>{response=p;}});assert.equal(hash(new Uint8Array(await (await response).arrayBuffer())),hash(files.get('writing/index.html')));
const result={ok:true,files:files.size,offlineFiles:list.length,scope:'/writing/',productionExcluded:true,noUploadHandler:true,atomicOfflineFailure:true,version:JSON.parse(get('build.json')).version};
await writeFile(new URL('../../outputs/writing-w1/staging-verification.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
