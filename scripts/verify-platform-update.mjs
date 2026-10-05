import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createPlatformUpdate,preparePlatformUpdate} from '../js/platform-update-core.js';
const current={schema:1,id:'20261004000000000',builtAt:1791072000000,label:'v2026.10.04-000000'};
const target={schema:1,id:'20261005000000000',builtAt:1791158400000,label:'v2026.10.05-000000'};
let clock=0,online=true,fail=true,calls=0,prepared=0;
const update=createPlatformUpdate({current,now:()=>clock,online:()=>online,fetchVersion:async()=>{calls++;return target},prepare:async()=>{prepared++;if(fail)throw Error('download failed')}});
const first=update.check();assert.equal(update.check(),first);await first;assert.equal(update.read().phase,'retry');
await update.check();assert.equal(calls,1);clock=60000;fail=false;await update.check();assert.equal(update.read().phase,'ready');
assert.equal(prepared,2);await update.check({force:true});assert.equal(prepared,2,'already prepared build is not downloaded again');
online=false;await update.check();assert.equal(update.read().phase,'offline');online=true;clock+=60000;await update.check();assert.equal(update.read().phase,'ready');
await createPlatformUpdate({current:target,fetchVersion:async()=>current,prepare:()=>assert.fail('must not downgrade'),onChange:()=>{}}).check();
const origin='https://example.test';
for(const path of ['/studio-sw.js','/viewer-sw.js','/platform-sw.js',null]){
 const old=path?{scriptURL:origin+path,build:current}:null;
 const next=new EventTarget();Object.assign(next,{state:'installed',build:target});
 const registration={active:old,waiting:next,scope:origin+'/'};let url;
 const sw={getRegistration:async()=>old?registration:undefined,register:async value=>{url=value;return registration}};
 next.postMessage=()=>{next.state='activated';registration.active=next;registration.waiting=null;next.dispatchEvent(new Event('statechange'));};
 await preparePlatformUpdate(target,{serviceWorker:sw,origin,readBuild:async worker=>worker.build});
 assert.equal(url,(path||'/platform-sw.js')+'?build='+target.id);
}
await assert.rejects(preparePlatformUpdate(target,{origin,serviceWorker:{getRegistration:async()=>({active:{scriptURL:origin+'/foreign-sw.js'}})}}),/UNEXPECTED_WORKER/);
// Real worker source with in-memory Cache API and controlled network failures.
const handlers={},stores=new Map();let offline=false,mode='good',networkCalls=0,deleted=[];
const caches={keys:async()=>[...stores.keys()],delete:async name=>{deleted.push(name);return stores.delete(name)},open:async name=>{
 if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {match:async key=>map.get(String(key))?.clone(),put:async(key,value)=>map.set(String(key),value.clone()),keys:async()=>[...map.keys()].map(url=>({url}))};}};
const source=readFileSync('js/studio-service-worker.js','utf8').replace('__STUDIO_FULL_OFFLINE__','false').replace('__STUDIO_VERSION__','"test"').replace('__STUDIO_BUILD_INFO__',JSON.stringify(target)).replace('__STUDIO_PRECACHE__','["/studio.html","/viewer.html"]');
const fetcher=async request=>{networkCalls++;if(offline)throw Error('offline');const path=new URL(typeof request==='string'?request:request.url,origin).pathname;
 if(mode==='bad')return new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}});
 if(path.endsWith('.js'))return new Response('export const loaded=true',{headers:{'Content-Type':'text/javascript'}});
 return new Response('<meta name="dsf-studio-build" content="'+target.id+'">new HTML',{headers:{'Content-Type':'text/html'}});
};
vm.runInNewContext(source,{self:{location:{origin},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}},caches,fetch:fetcher,URL,Request,Response,AbortSignal,console});
async function request(path,options={}){let result;handlers.fetch({request:new Request(origin+path,options),respondWith:p=>{result=p}});return result;}
const cache=await caches.open('dsf-viewer-shell-old');await cache.put(origin+'/viewer.html',new Response('old HTML',{headers:{'Content-Type':'text/html'}}));
let result=await request('/viewer?book=abc');assert.match(await result.text(),/new HTML/);
offline=true;result=await request('/viewer?book=abc');assert.equal(await result.text(),'old HTML');offline=false;
await cache.put(origin+'/assets/hashed.js',new Response('<html>poison</html>',{headers:{'Content-Type':'text/html'}}));
result=await request('/assets/hashed.js');assert.match(await result.text(),/export const/,'HTML masquerading as JS must be ignored');
mode='bad';result=await request('/assets/missing.js');assert.equal(result.status,503,'never return the SPA fallback for a script');mode='good';
await cache.put(origin+'/assets/old.js',new Response('old dynamic chunk',{headers:{'Content-Type':'text/javascript'}}));
offline=true;result=await request('/assets/old.js');assert.equal(await result.text(),'old dynamic chunk');offline=false;
assert.equal(await request('/api/authoring/test'),undefined);assert.equal(await request('/assets/private.js',{headers:{Authorization:'Bearer test'}}),undefined);
assert.equal(await request('/studio-version.json'),undefined);assert.equal(await request('/platform-sw.js'),undefined);
assert.deepEqual(deleted,[],'old app caches and user databases are not deleted');
mode='bad';let installation;handlers.install({waitUntil:p=>{installation=p}});await assert.rejects(installation,/SHELL_VERSION_MISMATCH/);
assert.ok(stores.has('dsf-studio-shell-test-web'),'failed reinstall preserves the already existing app cache');
assert.deepEqual(deleted,[]);

console.log('PASS platform update: retries, deduplication, offline recovery, legacy/Studio/new registration, downgrade guard, network-first navigation, corrupt MIME recovery, old assets and API isolation.');
