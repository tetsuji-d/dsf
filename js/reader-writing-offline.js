import {platformWorkerPath} from './platform-update-core.js';
import {waitForStudioWorker,studioWorkerBuild} from './studio-update-core.js';
import {listWritingDrafts,readWritingDraft} from './reader-writing-storage.js';
import {getPlatformLanguage,subscribePlatformLanguage} from './ui-language.js';

function workerMessage(worker,type,extra={}){
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('OFFLINE_TIMEOUT'));},type==='READER_WRITING_STATUS'?15000:180000);
  channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();data?.ok?resolve(data):reject(Error(data?.error||'OFFLINE_FAILED'));};
  worker.postMessage({type,...extra},[channel.port2]);
 });
}
export function createReaderOffline(){
 const current=()=>document.querySelector('meta[name="dsf-studio-build"]')?.content;
 async function registration(){
  const registration=await navigator.serviceWorker?.getRegistration('/');
  if(registration?.active&&!platformWorkerPath(registration.active,location.origin))throw Error('UNEXPECTED_WORKER');
  return registration;
 }
 async function inspect(){
  const r=await registration();
  if(!r?.active)return {ready:false};
  const result=await workerMessage(r.active,'READER_WRITING_STATUS');
  return {...result,ready:result.ready&&result.build?.id===current()};
 }
 async function prepare(){
  if(!current()||!navigator.serviceWorker)throw Error('OFFLINE_UNAVAILABLE');
  let r=await registration();
  const path=r?.active?platformWorkerPath(r.active,location.origin):'/viewer-sw.js';
  r=await navigator.serviceWorker.register(path,{scope:'/',updateViaCache:'none'});
  await r.update();
  if(r.installing)await waitForStudioWorker(r.installing,['installed','activated']);
  if(r.waiting){const done=waitForStudioWorker(r.waiting,['activated']);r.waiting.postMessage({type:'STUDIO_ACTIVATE'});await done;}
  if(!r.active||(await studioWorkerBuild(r.active))?.id!==current())throw Error('OFFLINE_REOPEN_REQUIRED');
  await workerMessage(r.active,'READER_WRITING_PREPARE',{buildId:current()});
  const result=await inspect();if(!result.ready)throw Error('OFFLINE_INCOMPLETE');
  return result;
 }
 return {inspect,prepare};
}
export function installReaderOfflineMenu({offline,openDraft}){
 let panel,status,prepare,list,refresh,busy=false;
 const en=()=>getPlatformLanguage('viewer')==='en';
 const text=(ja,english)=>en()?english:ja;
 function render(){
  if(!panel)return;
  panel.querySelector('summary').textContent=text('オフライン・端末内の下書き','Offline and local drafts');
  prepare.textContent=text('Reader／Writingをオフライン用に準備','Prepare Reader / Writing for offline use');
  refresh.textContent=text('準備状態と下書きを確認','Check readiness and drafts');
  panel.querySelector('[data-help]').textContent=text('通信できる間に準備してください。再起動後はReaderを開き、端末のDSFRか下書きを選べます。下書きはこのブラウザー専用です。大切な書き込みはDSFRでも保存してください。','Prepare while connected. After restarting, open Reader and choose a local DSFR or draft. Drafts belong to this browser; also save important work as DSFR files.');
  panel.querySelector('a').textContent=text('Readerの起動ページ','Reader start page');
  prepare.disabled=refresh.disabled=busy;
 }
 async function inspect(){
  busy=true;render();status.textContent=text('準備状態を確認しています…','Checking offline resources…');
  try{
   const [state,drafts]=await Promise.all([offline.inspect().catch(()=>({ready:false})),listWritingDrafts()]);
   status.textContent=state.ready?text('準備済み。通信なしでReaderを開き、書き込み・保存できます。','Ready. Open Reader, write and save without internet.'):text('準備が必要です。接続して準備を実行してください。','Preparation is needed. Connect and prepare offline resources.');
   list.replaceChildren();
   if(!drafts.length)list.textContent=text('このブラウザーに下書きはありません。','No drafts in this browser.');
   for(const d of drafts){
    const b=document.createElement('button');b.type='button';b.textContent=d.title+' · '+new Date(d.updatedAt).toLocaleString(en()?'en':'ja');
    b.onclick=async()=>{if(busy)return;busy=true;render();b.disabled=true;
     try{const draft=await readWritingDraft(d.id);if(!draft?.bytes)throw Error('DRAFT_MISSING');document.getElementById('platform-app-menu')?.close();await openDraft(draft);}
     catch(error){status.textContent=text('下書きを開けませんでした。元の下書きは保持しています。','Could not open the draft. The original draft is kept.');document.getElementById('platform-app-menu')?.showModal();console.error(error);}
     finally{busy=false;b.disabled=false;render();}};
    list.append(b);
   }
  }catch(error){status.textContent=text('確認できませんでした。接続して準備をやり直してください。下書きは削除しません。','Could not verify readiness. Connect and retry. Drafts are kept.');console.error(error);}
  finally{busy=false;render();}
 }
 function mount(){
  const menu=document.getElementById('platform-app-menu');if(!menu||panel)return;
  panel=document.createElement('details');panel.id='reader-offline';panel.style.cssText='margin:12px;font-size:13px;line-height:1.7';
  panel.innerHTML='<summary></summary><p data-help></p><p role="status"></p><button type="button" data-prepare></button> <button type="button" data-refresh></button><p><a href="/viewer"></a></p><div data-drafts style="display:grid;gap:8px"></div>';
  status=panel.querySelector('[role=status]');prepare=panel.querySelector('[data-prepare]');refresh=panel.querySelector('[data-refresh]');list=panel.querySelector('[data-drafts]');
  prepare.onclick=async()=>{if(busy)return;busy=true;render();status.textContent=text('画面・描画処理・入力用書体を保存しています…','Saving the app, drawing tools and input fonts…');
   try{await offline.prepare();busy=false;await inspect();}
   catch(error){busy=false;render();status.textContent=error.message==='OFFLINE_REOPEN_REQUIRED'?text('アプリが更新されています。書き込みをDSFRに保存してReaderを開き直してから、準備してください。','The app has updated. Save your writing as DSFR, reopen Reader and prepare again.'):text('準備できませんでした。接続・端末の空き容量を確認して再試行してください。前回の準備と下書きは保持しています。','Preparation failed. Check the connection and free space, then retry. Previous offline resources and drafts are kept.');console.error(error);}
  };
  refresh.onclick=()=>void inspect();panel.addEventListener('toggle',()=>{if(panel.open&&!busy)void inspect();});
  menu.append(panel);render();
 }
 document.addEventListener('dsf-platform-menu-ready',mount);subscribePlatformLanguage(()=>{render();if(panel?.open&&!busy)void inspect();});mount();
}

