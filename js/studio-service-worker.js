/* Build-time placeholders. This file is emitted as /studio-sw.js by Vite. */
const VERSION=__STUDIO_VERSION__, CACHE='dsf-studio-shell-'+VERSION;
const SHELL=__STUDIO_PRECACHE__;
const BUILD=__STUDIO_BUILD_INFO__;
const SDK=['app','auth','firestore','storage'].map(name=>'https://www.gstatic.com/firebasejs/10.7.1/firebase-'+name+'.js');
const FONT_CSS=[
 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&family=Noto+Sans+JP:wght@400;700&family=Noto+Serif:wght@400;700&family=Noto+Serif+JP:wght@400;700&display=swap',
 'https://fonts.googleapis.com/icon?family=Material+Icons'];
const FONTS=[
 'https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2',
 'https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2'];
const SAMPLE='https://picsum.photos/id/10/600/1066';
const absolute=url=>new URL(url,self.location.origin).href;
const known=new Set([...SHELL,...SDK,...FONT_CSS,...FONTS,SAMPLE].map(absolute));
// Pages redirects .html URLs to extensionless routes. A redirected cached response
// cannot satisfy a navigation with redirect mode manual. Preserve bytes and headers,
// but return a fresh response without the network redirect's URL metadata.
function navigationResponse(response){return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});}
async function store(cache,url){
 const response=await fetch(url,{credentials:'omit',cache:'reload',signal:AbortSignal.timeout(45000)});
 if(!response.ok||response.type==='opaque')throw Error('OFFLINE_RESOURCE_UNAVAILABLE');
 await cache.put(url,response.clone());return response;
}
async function eachLimit(items,fn){let i=0;const results=await Promise.allSettled(Array.from({length:6},async()=>{while(i<items.length)await fn(items[i++]);}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{
  await eachLimit([...SHELL,...SDK,...FONTS,SAMPLE],url=>store(cache,url));
  for(const url of FONT_CSS){const response=await store(cache,url);const css=await response.text();
   const urls=[...css.matchAll(/url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\s*\)/g)].map(m=>m[1]);
   if(!urls.length)throw Error('OFFLINE_FONT_CSS_EMPTY');for(const item of urls)known.add(item);await eachLimit([...new Set(urls)],url=>store(cache,url));
  }
  await cache.put('/__studio_offline_inventory__',new Response(JSON.stringify([...known]),{headers:{'Content-Type':'application/json'}}));
 }catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Retain previous versions for already-open tabs. They contain app resources and fonts;
 // never delete draft databases or another application's caches here.
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{
 if(event.data?.type==='STUDIO_ACTIVATE')self.skipWaiting();
 if(event.data?.type==='STUDIO_BUILD')event.ports[0]?.postMessage(BUILD);
 if(event.data?.type==='STUDIO_STATUS')event.waitUntil((async()=>{
  const cache=await caches.open(CACHE),keys=await cache.keys();
  const present=new Set(keys.map(k=>k.url));
  const inventory=await cache.match('/__studio_offline_inventory__');const expected=inventory?await inventory.json():[];
  event.ports[0]?.postMessage({version:VERSION,ready:expected.length>=known.size&&expected.every(url=>present.has(url)),resources:keys.length});
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||request.headers.has('Authorization'))return;
 const isEntry=url.origin===self.location.origin&&['/studio','/studio.html','/viewer','/viewer.html'].includes(url.pathname);
 const key=isEntry?absolute(url.pathname.startsWith('/studio')?'/studio.html':'/viewer.html'):request.url;
 // Fonts are only served if installed with the known Google stylesheet. No runtime caching.
 const isOldAsset=url.origin===self.location.origin&&url.pathname.startsWith('/assets/');
 if(!isEntry&&!isOldAsset&&!known.has(key)&&url.origin!=='https://fonts.gstatic.com')return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE),hit=await cache.match(key);if(hit)return isEntry?navigationResponse(hit):hit;
  if(isOldAsset){for(const name of await caches.keys()){if(name.startsWith('dsf-studio-shell-')&&name!==CACHE){const old=await (await caches.open(name)).match(key);if(old)return old;}}}
  if(isEntry){const response=await fetch(new Request(request,{redirect:'follow'}));return navigationResponse(response);}
  return fetch(request);})());
});
