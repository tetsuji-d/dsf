import {sha256} from '/js/dsf-writing-contract.js';
export async function createReaderWritingRuntime() {
    const response = await fetch('/catalog.json'); if (!response.ok) throw new Error('CATALOG_LOAD');
    const catalog = await response.json(), inputFaces = new Map();
    let worker, requestId = 0; const pending = new Map();
    function dispose() {worker?.terminate(); worker = null; for (const p of pending.values()) {clearTimeout(p.timer);p.reject(new Error('FONT_PROCESS_FAILED'));} pending.clear();}
    function rpc(method,...args) {
        if (!worker) {worker = new Worker('/font-worker.js'); worker.onmessage = ({data}) => {
            const p = pending.get(data.id); if (!p) return; clearTimeout(p.timer); pending.delete(data.id);
            data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
        }; worker.onerror = dispose;}
        return new Promise((resolve,reject) => {const id = ++requestId, timer = setTimeout(dispose,60000); pending.set(id,{resolve,reject,timer}); worker.postMessage({id,method,args});});
    }
    async function asset(id,notice=false) {
        const source = catalog.find(c=>c.id===id); if (!source) throw new Error('WRITING_FONT');
        const url = notice ? `/notices/${id}.txt` : `/assets/fonts/${id}.woff2`;
        const cache = await caches.open('dsf-writing-input-fonts-v1');
        let response = await cache.match(url); if (!response) try {response = await fetch(url);}catch {throw new Error('INPUT_FONT_UNAVAILABLE');}
        if (!response.ok) throw new Error('INPUT_FONT_UNAVAILABLE'); const bytes = new Uint8Array(await response.arrayBuffer());
        if (await sha256(bytes) !== (notice ? source.license.assetNoticeSha256 : source.asset.sha256)) throw new Error('INPUT_FONT_INTEGRITY');
        return bytes;
    }
    const options = {catalog,engine:{derive:(...a)=>rpc('derive',...a),verify:(...a)=>rpc('verify',...a)},getFont:id=>asset(id),getNotice:id=>asset(id,true)};
    async function inputFamily(id) {
        if (!inputFaces.has(id)) {const bytes = await asset(id), family = `WritingInput_${id.replaceAll('-','_')}`;
            const face = await new FontFace(family,bytes,{weight:'100 900'}).load(); document.fonts.add(face); inputFaces.set(id,{face,family,bytes});}
        return inputFaces.get(id).family;
    }
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
    return {options,catalog,dispose,inputFamily,verifyInput,prepareOffline,destroy(){dispose();for(const {face} of inputFaces.values())document.fonts.delete(face);inputFaces.clear();}};
}
