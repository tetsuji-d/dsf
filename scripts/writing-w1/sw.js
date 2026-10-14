const CACHE='dsf-writing-w1-1';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type!=='prepare')return;event.waitUntil((async()=>{try{
    const list=await (await fetch('/cache-list',{cache:'no-store'})).json(),cache=await caches.open(CACHE);
    for(const a of list){const response=await fetch(a.url,{cache:'no-store'});if(!response.ok)throw new Error('Prepare fetch failed');
        const bytes=await response.clone().arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==a.sha256)throw new Error('Prepare integrity failed');await cache.put(a.url,response);}
    event.ports[0].postMessage({ok:true,count:list.length});
}catch(e){event.ports[0].postMessage({ok:false,error:e.message});}})());});
self.addEventListener('fetch',event=>{if(event.request.method==='GET'&&new URL(event.request.url).origin===location.origin)event.respondWith((async()=>{
    const cache=await caches.open(CACHE);return await cache.match(event.request)||fetch(event.request);
})());});
