import {openStudioInstallGuide} from './studio-install-guide.js';
export function installStudioPwa({getLocale}) {
 const en=()=>getLocale()==='en', host=document.querySelector('#home-room .home-workspace-main');if(!host)return;
 const panel=document.createElement('section');panel.className='studio-offline-panel';panel.setAttribute('aria-label','Offline Studio');
 const status=document.createElement('p');status.setAttribute('role','status');
 const prepare=document.createElement('button'),update=document.createElement('button'),install=document.createElement('button');
 const guide=document.createElement('button');guide.type='button';guide.onclick=()=>openStudioInstallGuide({en:en()});
 const help=document.createElement('p');let registration=null,ready=false,installEvent=null,busy=false;
 const render=()=>{guide.textContent=en()?'Installation guide':'端末への追加方法';prepare.textContent=en()?'Prepare offline use':'オフライン利用を準備';update.textContent=en()?'Apply app update':'アプリの更新を反映';install.textContent=en()?'Install Studio':'Studioをインストール';prepare.disabled=busy||!navigator.onLine||!import.meta.env.PROD;update.hidden=!registration?.waiting;install.hidden=!installEvent;
 help.textContent=en()?'Personal local projects only. Import or create your manuscript here. Publishing and shared editing need a connection. Keep DSP backups. To install on iPhone, use Share → Add to Home Screen.':'個人のローカル制作に対応します。原稿をこの端末で作成するかDSPを取り込んでください。公開・共同編集には通信が必要です。DSPのバックアップも残してください。iPhoneへの追加は「共有 → ホーム画面に追加」から行えます。';
 status.textContent=busy?(en()?'Preparing app and fonts…':'アプリとフォントを準備しています…'):ready?(navigator.onLine?(en()?'Offline use ready':'オフライン利用可'):(en()?'Offline · Local editing available':'オフライン・ローカル編集できます')):navigator.onLine?(en()?'Offline use is not prepared yet':'オフライン利用は未準備です'):(en()?'Offline preparation could not be confirmed':'オフラインの準備完了を確認できません');};
 const inspect=async()=>{const worker=registration?.active;if(!worker)return;const channel=new MessageChannel();const result=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),15000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.postMessage({type:'STUDIO_STATUS'},[channel.port2]);});channel.port1.close();ready=!!result?.ready;render();};
 prepare.onclick=async()=>{if(busy)return;busy=true;render();try{
 registration=await navigator.serviceWorker.register('/studio-sw.js',{scope:'/',updateViaCache:'none'});
 await registration.update();
 const worker=registration.installing||registration.waiting||registration.active;
 if(worker&&['installing','activating','parsed'].includes(worker.state))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PREPARATION_TIMEOUT')),180000);const changed=()=>{if(['activated','installed'].includes(worker.state)){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('INSTALL_FAILED'));}};worker.addEventListener('statechange',changed);changed();});
 if(!registration.active&&!registration.waiting)await navigator.serviceWorker.ready;
 busy=false;await inspect();render();
 }catch{busy=false;ready=false;render();status.textContent=en()?'Preparation failed. Connect and retry. Existing drafts are kept.':'準備できませんでした。接続を確認して再試行してください。既存の原稿は保持しています。';}};
 update.onclick=()=>{if(!registration?.waiting)return;const d=document.createElement('dialog');d.className='local-file-dialog';const p=document.createElement('p');p.textContent=en()?'Save a DSP backup before updating. Reload when ready; the unsaved-file warning remains active.':'更新前にDSPファイルを保存してください。準備ができたら再読み込みします。未保存の変更がある場合はブラウザーの警告が出ます。';const no=document.createElement('button');no.textContent=en()?'Later':'後で';no.onclick=()=>d.remove();const yes=document.createElement('button');yes.textContent=en()?'Update and reload':'更新して再読み込み';yes.onclick=()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});registration.waiting.postMessage({type:'STUDIO_ACTIVATE'});d.remove();};d.append(p,no,yes);document.body.append(d);d.showModal();};
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;render();});install.onclick=async()=>{if(!installEvent)return;await installEvent.prompt();installEvent=null;render();};
 window.addEventListener('online',()=>{render();void inspect();});window.addEventListener('offline',()=>{render();void inspect();});document.addEventListener('studio-ui-language-change',render);
 panel.append(status,prepare,update,install,guide,help);host.prepend(panel);render();
 if('serviceWorker' in navigator)void navigator.serviceWorker.getRegistration('/').then(r=>{if(r?.active?.scriptURL.endsWith('/studio-sw.js')){registration=r;return inspect();}}).catch(()=>{});
 else {prepare.disabled=true;status.textContent=en()?'Offline installation is unavailable in this browser':'このブラウザーではオフライン準備を利用できません';}
}
