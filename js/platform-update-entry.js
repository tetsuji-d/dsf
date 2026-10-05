import {createPlatformUpdate} from './platform-update-core.js';
const id=document.querySelector('meta[name="dsf-studio-build"]')?.content;
if(id&&/^\d{17}$/.test(id)){
 const builtAt=Date.UTC(+id.slice(0,4),+id.slice(4,6)-1,+id.slice(6,8),+id.slice(8,10),+id.slice(10,12),+id.slice(12,14),+id.slice(14,17));
 const current={schema:1,id,builtAt,label:'v'+id.slice(0,4)+'.'+id.slice(4,6)+'.'+id.slice(6,8)+'-'+id.slice(8,14)};
 let details;
 const english=()=>document.documentElement.lang.startsWith('en');
 const updater=createPlatformUpdate({current,onChange:value=>{render(value);window.dispatchEvent(new CustomEvent('dsf-platform-update',{detail:value}));}});
 function render(value=updater.read()){
  if(!details)return;
  const en=english();
  details.querySelector('summary').textContent=en?'App version and updates':'アプリのバージョン・更新';
  details.querySelector('[data-build]').textContent=current.label;
  const labels=en?{idle:'Updates are automatic.',checking:'Checking for updates…',preparing:'Preparing the next version…',current:'Up to date.',ready:'Ready. The next time you open a screen, it will use the new version.',retry:'Could not prepare the update. Your current screen is kept; we will retry.',offline:'Offline. Keep using this version; updates resume when connected.'}:{idle:'アプリは自動で更新されます。',checking:'更新を確認しています…',preparing:'新しいバージョンを準備しています…',current:'最新版です。',ready:'次に画面を開くと、新しいバージョンになります。',retry:'更新を準備できませんでした。現在の画面を保ったまま、後で再試行します。',offline:'オフラインです。現在の版を使い、接続後に更新します。'};
  details.querySelector('[role="status"]').textContent=labels[value.phase];
  const button=details.querySelector('button');button.textContent=en?'Check for updates':'更新を確認';button.disabled=['checking','preparing'].includes(value.phase);
  details.querySelector('[data-help]').textContent=en?'Reading and editing continue without automatic reload. Files opened on this device stay open.':'読書・編集の途中で画面を自動再読み込みしません。端末から開いたファイルも、そのまま使えます。';
  details.querySelector('a').textContent=en?'Update / recovery help':'更新できない場合の復旧';
 }
 function mount(){
  const host=document.querySelector('#viewer-info-panel .viewer-info-panel-shell');if(!host||details)return;
  details=document.createElement('details');details.dataset.platformVersion='';details.style.cssText='margin:16px 12px;padding-top:12px;border-top:1px solid #ffffff30;font-size:12px;line-height:1.7';
  details.innerHTML='<summary></summary><p data-build></p><p role="status"></p><p data-help></p><button type="button"></button> <a href="/studio-repair.html" target="_blank" rel="noopener"></a>';
  details.querySelector('button').onclick=()=>void updater.check({force:true});host.append(details);render();
 }
 mount();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
 const check=()=>{if(!document.hidden)void updater.check();};
 window.addEventListener('online',check);window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
 window.addEventListener('offline',()=>void updater.check());
 // A timer covers a long-running foreground tab; focus/online handle suspension.
 setInterval(check,30*60*1000);check();
}
