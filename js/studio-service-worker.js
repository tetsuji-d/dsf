/* Build-time placeholders. This file is emitted as /studio-sw.js by Vite. */
const FULL_OFFLINE=__STUDIO_FULL_OFFLINE__;
const VERSION=__STUDIO_VERSION__, CACHE='dsf-studio-shell-'+VERSION+(FULL_OFFLINE?'':'-web');
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
 const entry=SHELL.includes(url)&&url.endsWith('.html');
 const response=await fetch(entry?url+'?studioBuild='+encodeURIComponent(BUILD.id):url,{credentials:'omit',cache:'reload',signal:AbortSignal.timeout(45000)});
 if(!validResource(url,response))throw Error('OFFLINE_RESOURCE_UNAVAILABLE');
 if(entry&&!(await response.clone().text()).includes('name="dsf-studio-build" content="'+BUILD.id+'"'))throw Error('SHELL_VERSION_MISMATCH');
 await cache.put(url,response.clone());return response;
}
async function eachLimit(items,fn){let i=0;const results=await Promise.allSettled(Array.from({length:6},async()=>{while(i<items.length)await fn(items[i++]);}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const existed=(await caches.keys()).includes(CACHE);
 const cache=await caches.open(CACHE);
 try{
  await eachLimit([...SHELL,...SDK,...(FULL_OFFLINE?[...FONTS,SAMPLE]:[])],url=>store(cache,url));
  for(const url of (FULL_OFFLINE?FONT_CSS:[])){const response=await store(cache,url);const css=await response.text();
   const urls=[...css.matchAll(/url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^)'"\s]+)['"]?\s*\)/g)].map(m=>m[1]);
   if(!urls.length)throw Error('OFFLINE_FONT_CSS_EMPTY');for(const item of urls)known.add(item);await eachLimit([...new Set(urls)],url=>store(cache,url));
  }
  await cache.put('/__studio_offline_inventory__',new Response(JSON.stringify([...known]),{headers:{'Content-Type':'application/json'}}));
  // Activation changes resource delivery only; never navigate an open tab.
  await self.skipWaiting();
 }catch(error){if(!existed)await caches.delete(CACHE);throw error;}
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
// Accept only app resources of the expected type. Never serve cached HTML as JS.
function validResource(key,response){
 if(!response?.ok||response.type==='opaque')return false;
 const path=new URL(key,self.location.origin).pathname,type=response.headers.get('Content-Type')||'';
 if(path.endsWith('.js'))return /(?:javascript|ecmascript)/i.test(type);
 if(path.endsWith('.css'))return /text\/css/i.test(type);
 if(path.endsWith('.html'))return /text\/html/i.test(type);
 return !/text\/html/i.test(type);
}
const entryRoutes=new Map([['/','/index.html'],['/index.html','/index.html'],['/studio','/studio.html'],['/studio.html','/studio.html'],['/viewer','/viewer.html'],['/viewer.html','/viewer.html'],['/mypage','/mypage.html'],['/mypage.html','/mypage.html'],['/admin','/admin/index.html'],['/admin/','/admin/index.html'],['/admin/index.html','/admin/index.html']]);
const appCache=name=>['dsf-studio-shell-','dsf-viewer-shell-','dsf-reader-shell-'].some(prefix=>name.startsWith(prefix));
async function cachedResource(key){
 const names=[CACHE,...(await caches.keys()).filter(name=>name!==CACHE&&appCache(name)).reverse()];
 for(const name of names){const hit=await (await caches.open(name)).match(key);if(validResource(key,hit))return hit;}
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||request.headers.has('Authorization'))return;
 const local=url.origin===self.location.origin,entry=local&&entryRoutes.get(url.pathname);
 const asset=local&&url.pathname.startsWith('/assets/');
 const manifest=local&&['/studio.webmanifest','/viewer.webmanifest'].includes(url.pathname);
 // Update metadata and worker scripts always reach the network directly.
 if(!entry&&!asset&&!manifest&&!known.has(request.url)&&url.origin!=='https://fonts.gstatic.com')return;
 event.respondWith((async()=>{
  if(entry||manifest){
   try{
    const response=await fetch(new Request(request,{cache:'no-cache',redirect:'follow',signal:AbortSignal.timeout(10000)}));
    if(!validResource(entry||request.url,response))throw Error('APP_RESPONSE_INVALID');
    // Keep the installed offline snapshot intact; do not cache newer HTML with older assets.
    return entry?navigationResponse(response):response;
   }catch(error){const hit=await cachedResource(entry?absolute(entry):request.url);if(hit)return entry?navigationResponse(hit):hit;throw error;}
  }
  const hit=await cachedResource(request.url);if(hit)return hit;
  const response=await fetch(request);
  if(!validResource(request.url,response))return new Response('Application resource unavailable',{status:503,headers:{'Content-Type':'text/plain'}});
  // Only immutable build assets are cached at runtime. No manuscript/API responses.
  if(asset)await (await caches.open(CACHE)).put(request.url,response.clone());
  return response;
 })());
});
