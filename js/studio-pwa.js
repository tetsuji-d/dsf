import {installStudioVersionUI} from './studio-update-ui.js';
import {openStudioInstallGuide} from './studio-install-guide.js';
export function installStudioPwa({getLocale,updateBlocked=()=>false,work}) {
 const en=()=>getLocale()==='en', host=document.querySelector('#home-room .home-workspace-main');if(!host)return;
 const panel=document.createElement('section');panel.className='studio-offline-panel';
 const title=document.createElement('h3'),intro=document.createElement('p'),options=document.createElement('div');options.className='studio-install-options';
 const appOption=document.createElement('div'),offlineOption=document.createElement('details');appOption.className='studio-install-option';offlineOption.className='studio-install-optional';
 const appTitle=document.createElement('h4'),offlineTitle=document.createElement('summary'),appHelp=document.createElement('p'),offlineHelp=document.createElement('p');
 const status=document.createElement('p');status.setAttribute('role','status');
 const prepare=document.createElement('button'),install=document.createElement('button');
 const guide=document.createElement('button');guide.type='button';guide.onclick=()=>openStudioInstallGuide({en:en()});
 const fileGuide=document.createElement('button');fileGuide.type='button';fileGuide.onclick=()=>openStudioInstallGuide({en:en(),section:'files'});
 const help=document.createElement('p');let registration=null,ready=false,installEvent=null,busy=false;
 const standalone=window.matchMedia('(display-mode: standalone)');let installed=standalone.matches||navigator.standalone===true;
 const render=()=>{
 title.textContent=en()?'Open Studio from an app icon':'Studioをアイコンからすぐに開く';panel.setAttribute('aria-label',title.textContent);
 intro.textContent=en()?'Install Studio as an app and add a shortcut to your desktop or home screen. Keep editing and saving to the cloud as usual.':'Studioをアプリとしてインストールすると、デスクトップやホーム画面などに起動用のショートカットを追加できます。クラウドでの編集・保存は、これまでどおり使えます。';
 appTitle.textContent=en()?'Install Studio':'Studioをインストール';offlineTitle.textContent=en()?'Prepare for travel or places without internet (optional)':'移動中や、通信できない場所での作業に備える（任意）';
 appHelp.textContent=installed?(en()?'Studio is running as an app.':'アプリとして起動しています。'):(en()?'You can keep using your browser. See the instructions for where the icon appears and how to add a desktop shortcut.':'ブラウザーのままでも使えます。アイコンの追加先やデスクトップへの配置方法は、端末別の手順をご覧ください。');
 offlineHelp.textContent=en()?'For writing on a train or somewhere without Wi-Fi, prepare Studio and a DSP copy of your manuscript while connected. This is optional for everyday online work.':'電車での移動中やWi-Fiのない場所でも書きたいときに、編集に必要なデータと原稿を先に端末へ用意します。普段オンラインで使う場合、この準備は不要です。';
 guide.textContent=en()?'Installation instructions':'インストール方法を見る';fileGuide.textContent=en()?'File icons and previews':'ファイルアイコン・プレビューの案内';prepare.textContent=busy?(en()?'Preparing…':'準備しています…'):ready?(en()?'Editing data is ready':'編集用データの準備済み'):(en()?'Prepare editing data on this device':'この端末に編集用データを準備');install.textContent=en()?'Install Studio':'Studioをインストール';prepare.disabled=busy||ready||!navigator.onLine||!import.meta.env.PROD||!('serviceWorker' in navigator);install.hidden=!installEvent||installed;
 help.textContent=en()?'Offline editing works with manuscripts created here or opened from a DSP file. Cloud saving, publishing and shared editing need internet. Adding the app does not download your cloud manuscripts; save them as DSP files to use offline.':'ネットなしで編集できるのは、この端末で作成した原稿や、DSPファイルから開いた原稿です。クラウド保存・公開・共同編集には通信が必要です。アプリの追加だけではクラウド原稿は端末に保存されません。持ち出す原稿はDSPファイルで保存してください。';
 status.textContent=busy?(en()?'Downloading the app and fonts…':'アプリとフォントを保存しています…'):ready?(en()?'Ready. You can edit local manuscripts without internet.':'準備できました。ネットなしでも端末の原稿を編集できます。'):!('serviceWorker' in navigator)?(en()?'Offline editing is unavailable in this browser.':'このブラウザーではネットなし編集の準備を利用できません。'):navigator.onLine?(en()?'Set this up before going offline.':'ネットなしで使う前に、一度準備してください。'):(en()?'Connect to the internet to prepare offline editing.':'準備するにはインターネットに接続してください。');};
 const heading=host.querySelector('.home-room-header h2'),versionHost=document.createElement('div');versionHost.className='home-room-heading';heading.before(versionHost);versionHost.append(heading);
 installStudioVersionUI({current:__STUDIO_BUILD__,getLocale,homeHost:versionHost,helpHost:document.getElementById('studio-help-panel'),blocked:updateBlocked,work,enabled:import.meta.env.PROD});
 const inspect=async()=>{const worker=registration?.active;if(!worker)return;const channel=new MessageChannel();const result=await new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),15000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.postMessage({type:'STUDIO_STATUS'},[channel.port2]);});channel.port1.close();ready=!!result?.ready;render();};
 prepare.onclick=async()=>{if(busy)return;busy=true;render();try{
 registration=await navigator.serviceWorker.register('/studio-sw.js',{scope:'/',updateViaCache:'none'});
 await registration.update();
 const worker=registration.installing||registration.waiting||registration.active;
 if(worker&&['installing','activating','parsed'].includes(worker.state))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PREPARATION_TIMEOUT')),180000);const changed=()=>{if(['activated','installed'].includes(worker.state)){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('INSTALL_FAILED'));}};worker.addEventListener('statechange',changed);changed();});
 if(!registration.active&&!registration.waiting)await navigator.serviceWorker.ready;
 busy=false;await inspect();render();
 }catch{busy=false;ready=false;render();status.textContent=en()?'Preparation failed. Connect and retry. Existing drafts are kept.':'準備できませんでした。接続を確認して再試行してください。既存の原稿は保持しています。';}};
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;render();});install.onclick=async()=>{if(!installEvent)return;await installEvent.prompt();installEvent=null;render();};
 window.addEventListener('appinstalled',()=>{installed=true;installEvent=null;render();});standalone.addEventListener('change',()=>{installed=standalone.matches;render();});
 window.addEventListener('online',()=>{render();void inspect();});window.addEventListener('offline',()=>{render();void inspect();});document.addEventListener('studio-ui-language-change',render);
 appOption.append(appTitle,appHelp,install,guide,fileGuide);offlineOption.append(offlineTitle,offlineHelp,prepare,status,help);options.append(appOption,offlineOption);
 panel.append(title,intro,options);(host.querySelector('.home-room-body')||host).append(panel);render();
 if('serviceWorker' in navigator)void navigator.serviceWorker.getRegistration('/').then(r=>{if(r?.active?.scriptURL.endsWith('/studio-sw.js')){registration=r;return inspect();}}).catch(()=>{});
 else {prepare.disabled=true;status.textContent=en()?'Offline installation is unavailable in this browser':'このブラウザーではオフライン準備を利用できません';}
}
