// Isolated browser acceptance fixture. Real new worker/assets come from dist.
import http from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const root=resolve('dist'),port=Number(process.env.PORT||4399);
const legacy=`const BUILD={id:'20260929000000000'};self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data?.type==='STUDIO_BUILD')e.ports[0].postMessage(BUILD);});self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/studio')e.respondWith(Promise.resolve(new Response('<h1>旧版のStudio</h1><p>更新前のタブを保持しています</p><a href="/studio-repair.html" target="_blank">更新・復旧</a>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));});`;
const fixture=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>更新と保持の検証</title><h1>更新と保持の検証</h1><button id="setup">旧版と検証データを準備</button><button id="check">原稿と画像の保持を確認</button><p id="status" role="status"></p><a href="/studio" target="_blank">旧版を開く</a><a href="/studio-repair.html" target="_blank">更新・復旧</a><script>
const status=document.getElementById('status');
function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('studio-update-preservation-test',1);r.onupgradeneeded=()=>r.result.createObjectStore('draft');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
setup.onclick=async()=>{const d=await db();await new Promise((resolve,reject)=>{const t=d.transaction('draft','readwrite');t.objectStore('draft').put({text:'更新しても残る本文',image:new Blob(['image-test-bytes'],{type:'image/webp'})},'test');t.oncomplete=resolve;t.onerror=reject;});d.close();await navigator.serviceWorker.register('/studio-sw.js',{scope:'/',updateViaCache:'none'});await navigator.serviceWorker.ready;status.textContent='旧版と本文・画像の準備完了';};
check.onclick=async()=>{const d=await db();const v=await new Promise((resolve,reject)=>{const r=d.transaction('draft').objectStore('draft').get('test');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});d.close();status.textContent=v?.text==='更新しても残る本文'&&await v.image.text()==='image-test-bytes'?'PASS: 原稿本文・画像の内容を保持':'FAIL: 検証データ不一致';};
</script></html>`;
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
 if(url.pathname==='/studio-sw.js'&&!url.searchParams.has('build')){res.setHeader('Content-Type','application/javascript');return res.end(legacy);}
 let name=url.pathname;if(name==='/studio'||name==='/viewer')name+='.html';
 const file=resolve(root,'.'+name);if(!file.startsWith(root+'/')&&!file.startsWith(root+'\\')||!existsSync(file)){res.statusCode=404;return res.end();}
 const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
}).listen(port,'127.0.0.1',()=>console.log('Studio update fixture http://127.0.0.1:'+port+'/fixture'));
