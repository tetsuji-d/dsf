import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLocalDraftStatus,installLocalLeaveWarning} from '../js/local-draft-status.js';
const handlers=new Map(),target={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
let local=true;const tracker=createLocalDraftStatus(()=>warning.sync());const warning=installLocalLeaveWarning({target,tracker,isLocal:()=>local});
warning.sync();assert.equal(handlers.size,0);tracker.dirty();assert.ok(handlers.has('beforeunload'));
const saved=tracker.checkpoint();let prevented=false;const e={preventDefault(){prevented=true;}};handlers.get('beforeunload')(e);assert.ok(prevented);assert.equal(e.returnValue,'');
// Autosave and a cancelled/unconfirmed download never acknowledge the DSP revision.
assert.ok(tracker.read().dirty);tracker.dirty();assert.equal(tracker.confirm(saved),false);assert.ok(tracker.read().dirty);
assert.ok(tracker.confirm(tracker.checkpoint()));assert.equal(handlers.size,0);tracker.dirty();local=false;warning.sync();assert.equal(handlers.size,0);
local=true;warning.sync();const old=tracker.checkpoint();tracker.reset();assert.equal(tracker.confirm(old),false);assert.equal(handlers.size,0);
console.log('PASS local warning: edits, cancellation, confirmation, concurrent edit, session switch and shared/cloud exclusion');
const source=fs.readFileSync('js/studio-service-worker.js','utf8').replace('__STUDIO_BUILD_INFO__','{id:"test"}').replace('__STUDIO_VERSION__','"test"').replace('__STUDIO_PRECACHE__',JSON.stringify(['/studio.html','/viewer.html','/assets/editor.js']));
function runtime(fail=false){const listeners={},entries=new Map(),oldEntries=new Map(),calls=[],origin='https://test.dsf.invalid';let deleted=false;const key=x=>new URL(typeof x==='string'?x:x.url,origin).href;
 const cache={put:async(k,v)=>entries.set(key(k),v.clone()),match:async k=>{const hit=entries.get(key(k))?.clone();if(hit&&/\/(studio|viewer)\.html$/.test(key(k)))Object.defineProperty(hit,'redirected',{value:true});return hit;},keys:async()=>[...entries.keys()].map(url=>({url}))};
 const context={URL,Response,Request,AbortSignal,setTimeout,clearTimeout,console,caches:{keys:async()=>['dsf-studio-shell-test','dsf-studio-shell-old'],open:async name=>name==='dsf-studio-shell-old'?{match:async k=>oldEntries.get(key(k))?.clone()}:cache,delete:async()=>{deleted=true;entries.clear();}},self:{location:{origin},clients:{claim:async()=>{}},skipWaiting(){},addEventListener:(name,fn)=>listeners[name]=fn},fetch:async(url,options)=>{calls.push([key(url),options]);if(fail&&key(url).includes('firestore'))throw Error('offline');return new Response(key(url).includes('fonts.googleapis.com')?'@font-face{src:url(https://fonts.gstatic.com/test.woff2)}':'app bytes');}};
 vm.runInNewContext(source,context);return {listeners,entries,oldEntries,calls,deleted:()=>deleted,origin};}
const run=async(fn,data={})=>{let task;fn({...data,waitUntil:p=>task=p});await task;};
const r=runtime();await run(r.listeners.install);assert.ok(r.entries.size>10);assert.ok(r.calls.every(([,o])=>o.credentials==='omit'));
let status;await run(r.listeners.message,{data:{type:'STUDIO_STATUS'},ports:[{postMessage:s=>status=s}]});assert.ok(status.ready);
r.entries.delete('https://fonts.gstatic.com/test.woff2');await run(r.listeners.message,{data:{type:'STUDIO_STATUS'},ports:[{postMessage:s=>status=s}]});assert.equal(status.ready,false,'missing font makes readiness fail closed');
for(const url of ['/studio-version.json','/studio-repair.html','/api/authoring/private','/api/invitations','https://firestore.googleapis.com/private','/asset-proxy?url=private','/unknown.js']){let used=false;r.listeners.fetch({request:new Request(new URL(url,r.origin)),respondWith(){used=true;}});assert.equal(used,false,url);}
let response;r.listeners.fetch({request:new Request(r.origin+'/studio?room=editor'),respondWith:p=>response=p});assert.equal(await (await response).text(),'app bytes');
let authenticated=false;r.listeners.fetch({request:new Request(r.origin+'/assets/editor.js',{headers:{Authorization:'Bearer secret'}}),respondWith(){authenticated=true;}});assert.equal(authenticated,false);
r.oldEntries.set(r.origin+'/assets/previous-build.js',new Response('old build'));
r.listeners.fetch({request:new Request(r.origin+'/assets/previous-build.js'),respondWith:p=>response=p});assert.equal(await (await response).text(),'old build');
const broken=runtime(true);await assert.rejects(run(broken.listeners.install));assert.ok(broken.deleted());
console.log('PASS PWA: offline shell route, exact cache boundary, no auth/API cache, font inventory, atomic install failure');

for(const entry of ['/studio.html?room=home','/studio?room=press','/viewer.html?file=test','/viewer']){
 r.listeners.fetch({request:new Request(r.origin+entry,{redirect:'manual'}),respondWith:p=>response=p});
 const page=await response;assert.equal(page.redirected,false);assert.equal(await page.text(),'app bytes');
}
r.entries.delete(r.origin+'/studio.html');
r.listeners.fetch({request:new Request(r.origin+'/studio.html',{redirect:'manual'}),respondWith:p=>response=p});
assert.equal((await response).redirected,false);
const repair=fs.readFileSync('public/studio-repair.js','utf8');assert.doesNotMatch(repair,/indexedDB|caches\.delete|unregister\(|localStorage\.clear/);
console.log('PASS redirected navigation: cached .html and extensionless routes, network fallback, no draft storage deletion');
// An old installed shell must not hide the browser's new file associations.
r.entries.set(r.origin+'/studio.webmanifest',new Response('old manifest'));
r.listeners.fetch({request:new Request(r.origin+'/studio.webmanifest'),respondWith:p=>response=p});
assert.equal(await (await response).text(),'app bytes','online manifest bypasses old shell cache');
const failedManifest=runtime(true);
// This mocked host fails fetches whose URL contains firestore.
const offlineManifest=failedManifest.origin+'/studio.webmanifest?firestore=offline';
failedManifest.entries.set(offlineManifest,new Response('offline manifest'));
failedManifest.listeners.fetch({request:new Request(offlineManifest),respondWith:p=>response=p});
assert.equal(await (await response).text(),'offline manifest','offline launch retains installed manifest');
console.log('PASS manifest refresh: online latest and offline fallback');
