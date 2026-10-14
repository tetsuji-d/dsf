// This worker owns /writing/ only. No manuscript or authoring API is cached.
const PREFIX='/writing/',VERSION='__WRITING_VERSION__',CONTROL='dsf-writing-preview-control-v1';
const marker=new URL(PREFIX+'offline-snapshot',self.location.origin).href;
self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('message',e=>{
    if(e.data?.type!=='prepare')return;
    e.waitUntil((async()=>{
        let candidate;
        try{
            const response=await fetch(PREFIX+'cache-list.json',{cache:'no-store'});if(!response.ok)throw Error('OFFLINE_LIST');
            const list=await response.json();candidate=`dsf-writing-preview-${VERSION}-${crypto.randomUUID()}`;
            const cache=await caches.open(candidate);
            for(const asset of list){
                const url=new URL(asset.url,self.location.origin);
                if(url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX))throw Error('OFFLINE_SCOPE');
                const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('OFFLINE_FETCH');
                const bytes=await r.clone().arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
                if(hash!==asset.sha256)throw Error('OFFLINE_INTEGRITY');
                await cache.put(url,r);
            }
            // Switch snapshots only after every asset is verified and written.
            await (await caches.open(CONTROL)).put(marker,new Response(candidate));
            e.ports[0]?.postMessage({ok:true,count:list.length});
        }catch(error){if(candidate)await caches.delete(candidate);e.ports[0]?.postMessage({ok:false,error:error.message});}
    })());
});
self.addEventListener('fetch',e=>{
    const url=new URL(e.request.url);
    if(e.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX))return;
    e.respondWith((async()=>{
        const control=await caches.open(CONTROL),entry=await control.match(marker);
        // Reader handoff nonce is runtime-only; it must not prevent the offline app shell matching.
        const cacheKey=url.pathname===PREFIX?new URL(PREFIX,self.location.origin).href:e.request;
        if(entry){const hit=await (await caches.open(await entry.text())).match(cacheKey);if(hit)return hit;}
        return fetch(e.request);
    })());
});
