import {createStore,get,set,del} from 'idb-keyval';
import {createLocalDraftStatus,installLocalLeaveWarning} from '/js/local-draft-status.js';
import {createRestoredReloadGuard} from '/js/studio-restored-reload.js';
import {describeStudioWork} from '/js/studio-work-status.js';
import {installStudioVersionUI} from '/js/studio-update-ui.js';
const store=createStore('dsf-restored-update-fixture','fixture');
const original={state:{projectName:'更新確認用原稿',blocks:[{text:'編集していない本文',image:'blob:test'}]},imageMap:{'blob:test':'image'}};
if(!await get('backup',store)){await set('backup',original,store);await set('image',new Blob(['test image']),store);}
let input={open:true,title:'更新確認用原稿',identity:'fixture',local:true,save:{},canEdit:true},late=false;
const tracker=createLocalDraftStatus(()=>window.dispatchEvent(new Event('local-draft-status')));
const warning=installLocalLeaveWarning({target:window,tracker,isLocal:()=>true});window.addEventListener('local-draft-status',warning.sync);
const read=()=>describeStudioWork({...input,file:tracker.read()});
const guard=createRestoredReloadGuard({read:()=>({...read(),checkpoint:tracker.checkpoint()}),readBackup:()=>get('backup',store),readAsset:id=>get(id,store)});
const count=Number(sessionStorage.getItem('restore-update-count')||0);
document.querySelector('#restored').textContent='実際の再読み込み回数：'+count+' ／ 本文：'+(await get('backup',store)).state.blocks[0].text;
function restore(){tracker.restore();guard.remember(original);document.querySelector('#status').textContent='復元後の編集なし';}
restore();
const current={schema:1,id:'20260929000000000',builtAt:1790640000000,label:'v2026.09.29-000000'};
installStudioVersionUI({current,getLocale:()=> 'ja',homeHost:document.querySelector('#version'),blocked:()=>read().blocked&&!guard.eligible(),
 work:{read,onPrepareReload:async()=>{if(guard.eligible())await guard.verify();},onResume:()=>{},onSave:async()=>{tracker.confirm(tracker.checkpoint());}},
 fetchVersion:async()=>({...current,id:'20261003000000000',builtAt:current.builtAt+345600000,label:'v2026.10.03-000000'}),
 applyUpdate:async()=>{if(late)tracker.dirty();},
 reload:()=>{if(!guard.permit())throw Error('RECOVERY_UNCONFIRMED');tracker.permitReload(tracker.checkpoint());sessionStorage.setItem('restore-update-count',String(count+1));location.reload();}});
document.querySelector('#edit').onclick=()=>{tracker.dirty();document.querySelector('#status').textContent='実編集あり：更新前の保存確認が必要';};
document.querySelector('#missing').onclick=async()=>{await del('image',store);document.querySelector('#status').textContent='画像の欠落を再現';};
document.querySelector('#reset').onclick=async()=>{await set('backup',original,store);await set('image',new Blob(['test image']),store);late=false;restore();};
document.querySelector('#late').onclick=()=>{late=true;document.querySelector('#status').textContent='更新準備中に編集する設定';};
