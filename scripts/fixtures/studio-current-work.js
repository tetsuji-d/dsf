import {describeStudioWork,installStudioWorkStatus} from '/js/studio-work-status.js';
import {installStudioVersionUI} from '/js/studio-update-ui.js';
let input={open:true,title:'潮騒の図書館',identity:'original',local:true,file:{dirty:true,fileSaved:false},save:{},canEdit:true},mode='',locale='ja',reloads=0;
const result=document.querySelector('#result'),read=()=>describeStudioWork(input);
const notify=()=>window.dispatchEvent(new Event('studio-work-status'));
const save=async()=>{const local=input.local;input={...input,save:{state:'saving'}};notify();await new Promise(r=>setTimeout(r,80));
 if(mode==='fail'){input={...input,save:{state:'error',errorCode:'SAVE_FAILED'}};notify();throw Error('save failed');}
 if(mode==='cancel'){input={...input,save:{}};notify();return;}
 input={...input,file:{dirty:false,fileSaved:true},save:{cloudCurrent:!local,state:local?'saved-local':'saved-cloud'}};notify();};
const actions={read,onSave:save,onResume:()=>{result.textContent='編集へ移動';},onExport:async()=>{result.textContent='DSP退避要求（クラウド状態は維持）';}};
installStudioWorkStatus({host:document.querySelector('#work'),getLocale:()=>locale,...actions,onClose:async()=>{input={open:false};notify();result.textContent='原稿を閉じました（保存データ保持）';}});
const current={schema:1,id:'20260929000000000',builtAt:1790640000000,label:'v2026.09.29-000000'};
installStudioVersionUI({current,getLocale:()=>locale,homeHost:document.querySelector('#home'),blocked:()=>read().blocked,work:actions,
 fetchVersion:async()=>({...current,id:'20261003000000000',builtAt:current.builtAt+345600000,label:'v2026.10.03-000000'}),
 applyUpdate:async()=>{if(mode==='late')input={...input,file:{dirty:true,fileSaved:true},save:{state:'pending',cloudCurrent:false}};if(mode==='switch')input={...input,identity:'other',title:'別の原稿'};notify();},
 reload:()=>{reloads++;result.textContent='再読み込み要求 '+reloads;}});
function set(local,cloudCurrent=false,nextMode=''){mode=nextMode;input={open:true,title:'潮騒の図書館',identity:'original',local,canEdit:true,file:{dirty:!cloudCurrent,fileSaved:cloudCurrent},save:cloudCurrent?{state:'saved-cloud',cloudCurrent:true}:{state:'pending'}};result.textContent='';notify();}
document.querySelector('#local').onclick=()=>set(true);
document.querySelector('#cloud').onclick=()=>set(false);
document.querySelector('#saved').onclick=()=>set(false,true);
document.querySelector('#fail').onclick=()=>set(false,false,'fail');
document.querySelector('#cancel').onclick=()=>set(true,false,'cancel');
document.querySelector('#late').onclick=()=>set(false,false,'late');
document.querySelector('#switch').onclick=()=>set(false,false,'switch');
document.querySelector('#lang').onclick=()=>{locale=locale==='ja'?'en':'ja';document.dispatchEvent(new Event('studio-ui-language-change'));};
