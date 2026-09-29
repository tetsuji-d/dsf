import {createStudioVersionCheck,fetchStudioVersion} from './studio-version-check.js';
export function waitForStudioWorker(worker,states,timeout=180000) {
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);error?reject(error):resolve();};
  const changed=()=>{if(states.includes(worker.state))finish();else if(worker.state==='redundant')finish(Error('INSTALL_FAILED'));};
  const timer=setTimeout(()=>finish(Error('UPDATE_TIMEOUT')),timeout);worker.addEventListener('statechange',changed);changed();
 });
}
function workerBuild(worker) {
 return new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('VERSION_UNCONFIRMED'));},5000);
 channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage({type:'STUDIO_BUILD'},[channel.port2]);});
}
// Called only after the reader presses Update. Other tabs never reload automatically.
export async function prepareStudioUpdate(target) {
 if(!('serviceWorker' in navigator))return;
 const registration=await navigator.serviceWorker.getRegistration('/');if(!registration)return;
 const existing=registration.active||registration.waiting||registration.installing;
 if(!existing||new URL(existing.scriptURL).origin!==location.origin||new URL(existing.scriptURL).pathname!=='/studio-sw.js')throw Error('UNEXPECTED_WORKER');
 await registration.update();
 if(registration.installing)await waitForStudioWorker(registration.installing,['installed','activated']);
 const worker=registration.waiting||registration.active;if(!worker)throw Error('UPDATE_UNAVAILABLE');
 const build=await workerBuild(worker);if(build.id!==target.id)throw Error('VERSION_CHANGED');
 if(registration.waiting===worker){const ready=waitForStudioWorker(worker,['activated']);worker.postMessage({type:'STUDIO_ACTIVATE'});await ready;}
}
export function installStudioVersionUI({current,getLocale,homeHost,helpHost,blocked=()=>false,fetchVersion=fetchStudioVersion,applyUpdate=prepareStudioUpdate,reload=()=>location.reload(),enabled=true}) {
 const en=()=>getLocale()==='en',views=[];let dialog=null,applying=false;
 const text=(ja,english)=>en()?english:ja;
 function mount(host,tools=false){if(!host)return;const row=document.createElement('div');row.className='studio-version';
  const label=document.createElement('span');label.className='studio-version-number';label.textContent=current.label;
  const update=document.createElement('button');update.type='button';update.className='studio-version-update';update.hidden=true;update.onclick=()=>openUpdate();row.append(label,update);
  let check,status,repair;
  if(tools){check=document.createElement('button');check.type='button';check.onclick=()=>void checker.check({force:true});repair=document.createElement('a');repair.href='/studio-repair.html';repair.target='_blank';repair.rel='noopener';status=document.createElement('span');status.className='studio-version-status';status.setAttribute('role','status');row.append(check,repair,status);}
  host.append(row);views.push({label,update,check,status,repair});
 }
 function render(){const value=checker.read();const status=!enabled?text('開発環境','Development environment'):({unknown:text('更新未確認','Not checked'),checking:text('更新を確認中…','Checking for updates…'),offline:text('オフラインのため確認できません','Offline; could not check'),failed:text('更新を確認できませんでした','Could not check for updates'),checked:value.available?text('新しいバージョンがあります','A new version is available'):text('更新はありません','No update available')})[value.phase];
  for(const v of views){v.label.title=text('使用中のバージョン：','Current version: ')+current.label+' · '+status;v.update.textContent=text('更新','Update');v.update.hidden=!value.available;v.update.disabled=applying||!navigator.onLine;
   if(v.check){v.check.textContent=text('更新を確認','Check for updates');v.check.disabled=!enabled||value.phase==='checking';v.repair.textContent=text('アプリの更新・復旧','App update / recovery');v.status.textContent=status;}}
 }
 const checker=createStudioVersionCheck({current,fetchVersion,onChange:render});
 function openUpdate(){if(dialog||!checker.read().available)return;
  dialog=document.createElement('dialog');dialog.className='authoring-destination-dialog';dialog.setAttribute('aria-label',text('アプリを更新','Update app'));
  const heading=document.createElement('h2');heading.textContent=text('アプリを更新しますか？','Update the app?');
  const message=document.createElement('p');const feedback=document.createElement('p');feedback.setAttribute('role','status');
  const actions=document.createElement('div');actions.className='authoring-destination-actions';const later=document.createElement('button');later.textContent=text('後で','Later');const yes=document.createElement('button');yes.textContent=text('更新して再読み込み','Update and reload');
  const sync=()=>{const unsafe=blocked();message.textContent=unsafe?text('未保存の変更、保存中、または保存状態を確認できない原稿があります。エディターで保存を確認してから更新してください。ローカル原稿はDSPファイルを保存してください。','A manuscript has unsaved changes, is saving, or has an unconfirmed save. Confirm saving in the editor before updating. Save local manuscripts as DSP files.'):text('アプリを更新して、この画面を再読み込みします。端末内の原稿・履歴は削除しません。ほかのタブは再読み込みしません。','Update the app and reload this tab. Local manuscripts and history are kept. Other tabs will not reload.');yes.disabled=applying||!!unsafe||!navigator.onLine;};
  const close=()=>{if(applying)return;dialog.close();dialog.remove();dialog=null;window.removeEventListener('local-draft-status',sync);};later.onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  yes.onclick=async()=>{if(blocked()||applying){sync();return;}applying=true;later.disabled=true;sync();render();feedback.textContent=text('更新を準備しています…','Preparing the update…');
   try{const result=await checker.check({force:true});if(result.phase!=='checked'||!result.available)throw Error('VERSION_UNCONFIRMED');await applyUpdate(result.latest);
    // Edits made while assets were downloading must not be discarded.
    if(blocked())throw Error('UNSAVED_CHANGES');reload();applying=false;later.disabled=false;close();render();
   }catch{applying=false;later.disabled=false;feedback.textContent=text('更新または再読み込みを完了できませんでした。原稿の保存と通信状態を確認して再試行してください。','Could not complete the update or reload. Check saving and your connection, then retry.');sync();render();}};
  actions.append(later,yes);dialog.append(heading,message,feedback,actions);document.body.append(dialog);window.addEventListener('local-draft-status',sync);sync();dialog.showModal();later.focus();
 }
 mount(homeHost);mount(helpHost,true);render();
 const check=()=>{if(enabled&&!document.hidden)void checker.check();};
 window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('offline',()=>{if(enabled)void checker.check();render();});document.addEventListener('visibilitychange',check);document.addEventListener('studio-ui-language-change',render);
 check();return {check:checker.check,read:checker.read};
}
