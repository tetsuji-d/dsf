const CACHE='dsf-writing-w0-1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
    if(event.data?.type!=='prepare')return;
    event.waitUntil((async()=>{try {
        const list=await (await fetch('/cache-list')).json(),cache=await caches.open(CACHE);
        for(const asset of list) {
            const response=await fetch(asset.url,{cache:'reload'});if(!response.ok)throw new Error('Prepare fetch failed');
            const bytes=await response.clone().arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
            if(hash!==asset.sha256)throw new Error('Prepare hash mismatch');await cache.put(asset.url,response);
        }
        event.ports[0].postMessage({ok:true,count:list.length});
    }catch(e){event.ports[0].postMessage({ok:false,error:e.message});}})());
});
self.addEventListener('fetch',event=>{
    if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
    event.respondWith((async()=>{const cached=await (await caches.open(CACHE)).match(event.request);return cached||fetch(event.request);})());
});
