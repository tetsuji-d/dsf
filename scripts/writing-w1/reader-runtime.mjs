import {recordWritingTime} from '/js/reader-writing-progress.js';
import {sha256} from '/js/dsf-writing-contract.js';
let catalogPromise;
// One worker per document, shared by Reader and Writing. Release its WASM heap
// after a minute of inactivity, rather than recreating it after every operation.
let worker,requestId=0,idleTimer;const pending=new Map();
function stopWorker(){clearTimeout(idleTimer);worker?.terminate();worker=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('FONT_PROCESS_FAILED'));}pending.clear();}
function releaseWorker(){clearTimeout(idleTimer);if(!pending.size)idleTimer=setTimeout(stopWorker,60000);}
function rpc(method,...args){
    clearTimeout(idleTimer);
    if(!worker){worker=new Worker('/font-worker.js');worker.onmessage=({data})=>{
        const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);
        recordWritingTime('font-'+p.method,p.start);
        data.error?p.reject(new Error(data.error)):p.resolve(data.result);releaseWorker();
    };worker.onerror=stopWorker;}
    return new Promise((resolve,reject)=>{const id=++requestId,timer=setTimeout(stopWorker,60000);pending.set(id,{resolve,reject,timer,start:performance.now(),method});worker.postMessage({id,method,args});});
}
if(typeof window!=='undefined')window.addEventListener('pagehide',stopWorker);
export function warmWritingRuntime(){
    if(!catalogPromise)catalogPromise=fetch('/catalog.json').then(r=>{if(!r.ok)throw Error('CATALOG_LOAD');return r.json();}).catch(e=>{catalogPromise=null;throw e;});
    return catalogPromise;
}
export async function createReaderWritingRuntime() {
    // Compile the worker while the catalog and package metadata are loading.
    // A failed warm-up is retried by the next real operation.
    void rpc('warm').catch(()=>{});
    const catalog = await warmWritingRuntime(), inputFaces = new Map();
    const dispose=releaseWorker;
    const assets=new Map(),faceLoads=new Map();
    async function loadAsset(id,notice=false) {
        const source = catalog.find(c=>c.id===id); if (!source) throw new Error('WRITING_FONT');
        const url = notice ? `/notices/${id}.txt` : `/assets/fonts/${id}.woff2`;
        const cache = await caches.open('dsf-writing-input-fonts-v1');
        let response = await cache.match(url); if (!response) try {response = await fetch(url);}catch {throw new Error('INPUT_FONT_UNAVAILABLE');}
        if (!response.ok) throw new Error('INPUT_FONT_UNAVAILABLE'); const bytes = new Uint8Array(await response.arrayBuffer());
        if (await sha256(bytes) !== (notice ? source.license.assetNoticeSha256 : source.asset.sha256)) throw new Error('INPUT_FONT_INTEGRITY');
        return bytes;
    }
    async function asset(id,notice=false){
        const key=id+':'+notice;
        if(!assets.has(key))assets.set(key,loadAsset(id,notice).catch(error=>{assets.delete(key);throw error;}));
        return (await assets.get(key)).slice();
    }
    const options = {catalog,engine:{derive:(...a)=>rpc('derive',...a),verify:(...a)=>rpc('verify',...a)},getFont:id=>asset(id),getNotice:id=>asset(id,true)};
    async function loadInputFamily(id) {
        if (!inputFaces.has(id)) {const bytes = await asset(id), family = `WritingInput_${id.replaceAll('-','_')}`;
            const face = await new FontFace(family,bytes,{weight:'100 900'}).load(); document.fonts.add(face); inputFaces.set(id,{face,family,bytes});}
        return inputFaces.get(id).family;
    }
    function inputFamily(id){if(!faceLoads.has(id))faceLoads.set(id,loadInputFamily(id).catch(error=>{faceLoads.delete(id);throw error;}));return faceLoads.get(id);}
    async function verifyInput(id,text) {await inputFamily(id); await options.engine.verify(inputFaces.get(id).bytes,text,catalog.find(c=>c.id===id),false);}
    async function prepareOffline() {
        const cache = await caches.open('dsf-writing-input-fonts-v1');
        for (const c of catalog) for (const notice of [false,true]) {
            const bytes = await asset(c.id,notice), url = notice ? `/notices/${c.id}.txt` : `/assets/fonts/${c.id}.woff2`;
            await cache.put(url,new Response(bytes,{headers:{'Content-Type':notice?'text/plain':'font/woff2'}}));
        }
        await navigator.serviceWorker.register('/sw.js'); const registration = await navigator.serviceWorker.ready, channel = new MessageChannel();
        await new Promise((resolve,reject) => {const timeout = setTimeout(()=>reject(new Error('OFFLINE_PREPARE_TIMEOUT')),60000);
            channel.port1.onmessage = e => {clearTimeout(timeout); e.data.ok ? resolve() : reject(new Error(e.data.error));}; registration.active.postMessage({type:'prepare'},[channel.port2]);});
    }
    return {options,catalog,dispose,inputFamily,verifyInput,prepareOffline,destroy(){dispose();for(const {face} of inputFaces.values())document.fonts.delete(face);inputFaces.clear();assets.clear();faceLoads.clear();}};
}
