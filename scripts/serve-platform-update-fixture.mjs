// Local-only browser acceptance: two releases, a failed download, and unsaved UI.
import http from 'node:http';
import {readFileSync} from 'node:fs';
const builds={A:{schema:1,id:'20261004000000000',builtAt:1791072000000,label:'v2026.10.04-000000'},B:{schema:1,id:'20261005000000000',builtAt:1791158400000,label:'v2026.10.05-000000'}};
let release='A',broken=false;
function html(){const b=builds[release];return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="dsf-studio-build" content="'+b.id+'"><title>DSF 自動更新の検証</title></head><body style="font:16px system-ui;max-width:800px;margin:40px auto;background:#eee;color:#222"><h1>自動更新と作業の保持</h1><p>この画面の版：<strong>'+release+'</strong></p><label>未保存の編集 <textarea id="draft" rows="3"></textarea></label><p id="session"></p><button id="release-b">新版Bを配信</button> <button id="broken">取得失敗を解除</button> <button id="legacy">旧Viewerを登録</button><p id="action"></p><a href="/studio" target="_blank">別画面を開く</a><div id="viewer-info-panel"><div class="viewer-info-panel-shell"></div></div><script src="/assets/fixture-'+release+'.js"></script><script type="module" src="/platform-update-entry.js?build='+b.id+'"></script><script>session.textContent="読書位置：6ページ";document.getElementById("release-b").onclick=async()=>{await fetch("/__fixture/release",{method:"POST"});action.textContent="B配信開始（初回は取得失敗）"};document.getElementById("broken").onclick=async()=>{await fetch("/__fixture/fix",{method:"POST"});action.textContent="取得を復旧しました"};document.getElementById("legacy").onclick=async()=>{await navigator.serviceWorker.register("/viewer-sw.js?legacy=1",{scope:"/"});action.textContent="旧Viewer登録済み"};</script></body></html>';}
http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
 const send=(value,type='text/javascript',status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(value);};
 if(req.method==='POST'&&url.pathname==='/__fixture/release'){release='B';broken=true;return send('ok','text/plain');}
 if(req.method==='POST'&&url.pathname==='/__fixture/fix'){broken=false;return send('ok','text/plain');}
 if(url.pathname==='/studio-version.json')return send(JSON.stringify(builds[release]),'application/json');
 if(['/','/viewer','/studio','/viewer.html','/studio.html'].includes(url.pathname))return send(html(),'text/html');
 if(url.pathname.startsWith('/assets/'))return send('window.fixtureAsset=true;','text/javascript',broken&&url.pathname.includes('-B')?503:200);
 if(['/viewer-sw.js','/platform-sw.js','/studio-sw.js'].includes(url.pathname)){
  if(url.searchParams.has('legacy'))return send('self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));');
  const b=builds[release];let source=readFileSync('js/studio-service-worker.js','utf8').replace('__STUDIO_FULL_OFFLINE__','false').replace('__STUDIO_VERSION__',JSON.stringify(release)).replace('__STUDIO_BUILD_INFO__',JSON.stringify(b)).replace('__STUDIO_PRECACHE__',JSON.stringify(['/viewer.html','/studio.html','/assets/fixture-'+release+'.js'])).replace(/const SDK=.+;/,'const SDK=[];');return send(source);
 }
 const files={'/platform-update-entry.js':'js/platform-update-entry.js','/platform-update-core.js':'js/platform-update-core.js','/studio-update-core.js':'js/studio-update-core.js'};
 if(files[url.pathname])return send(readFileSync(files[url.pathname],'utf8'));
 send('not found','text/plain',404);
}).listen(5186,'127.0.0.1',()=>console.log('Update fixture: http://127.0.0.1:5186/viewer'));
