// Local-only sample. No Firebase imports, real identities or remote writes.
import '../../css/home-workspace.css';
import '../../css/publishing-spaces.css';
import '../../css/project-trash.css';
import {studioRollout,resolveStudioRollout} from '../../js/studio-rollout.js';
import {createHomeWorkspace} from '../../js/home-workspace.js';
import {projectActionsMarkup,bindProjectActions} from '../../js/project-actions-ui.js';
import {createPublishingSpaceUI} from '../../js/publishing-spaces-ui.js';
import {createAccountNotifications} from '../../js/account-notifications.js';
import {renderProjectTrash} from '../../js/project-trash-ui.js';
const params=new URLSearchParams(location.search),preview=params.get('mode')==='preview';
const features=preview?resolveStudioRollout({VITE_PROJECT_TRASH_ENABLED:'true',VITE_PERSONAL_SHARING_ENABLED:'true',VITE_PUBLISHING_INVITATIONS_ENABLED:'true'}):studioRollout;
const root=document.querySelector('#home-room'),toolbar=document.createElement('aside');
toolbar.style.cssText='position:relative;z-index:200;background:#fff4d5;color:#352a00;padding:10px;display:flex;gap:12px;align-items:center';
toolbar.textContent=preview?'検証用：staging相当':'検証用：本番設定';document.body.prepend(toolbar);
let calls=0,locale='ja',hasTrash=false;const getLocale=()=>locale;
const count=document.createElement('output');count.textContent='共有API呼出: 0';toolbar.append(count);
const execute=async()=>{count.textContent='共有API呼出: '+(++calls);return {items:[],unreadCount:0};};
const action=document.createElement('output');toolbar.append(action);
const workspace=createHomeWorkspace({root,getLocale,features,onSelect:view=>{action.textContent='表示: '+view;}});
const button=(name,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.onclick=fn;toolbar.append(b);};
const notifications=createAccountNotifications({getUser:()=>({uid:'fixture_owner'}),getLocale,features,personal:execute,spaces:execute,pollMs:1000});
const spaceUI=createPublishingSpaceUI({root:document.querySelector('#home-publishing-spaces'),getUid:()=> 'fixture_owner',getLocale,
    switcherRoots:[document.querySelector('#studio-space-switcher')],identityRoots:[document.querySelector('#home-space-identity')],
    storage:{getItem:()=> 'joined:old_space',setItem(){}},
    requestJoined:features.invitations?execute:null,
    request:async()=>({uid:'fixture_owner',revision:1,schemaVersion:1,spaces:[{id:'space_fixture',name:'検証出版'}],spaceIds:['space_fixture'],assignments:{}}),
    onSelect:()=>workspace.select('overview'),onChange:()=>workspace.render({spaceKind:spaceUI.viewKind(),hasTrash})});
function render(){
    const grid=document.querySelector('#home-cloud-grid');
    grid.innerHTML='<article class="home-project-entry" data-project-entry="fixture_book"><h3>検証用原稿</h3>'+projectActionsMarkup({id:'fixture_book',title:'検証用原稿'},locale==='en',true,features)+'</article>';
    bindProjectActions(grid,next=>{action.textContent='原稿操作: '+next;});
    workspace.render({hasTrash,spaceKind:spaceUI.viewKind()});
    renderProjectTrash({root:document.querySelector('#home-project-trash'),projects:hasTrash?[{id:'kept',title:'保持されている原稿',projectTrash:{trashedAtMs:Date.now(),restoreUntilMs:Date.now()+86400000}}]:[],en:locale==='en',
        onRestore:async()=>{hasTrash=false;action.textContent='復元済み（検証用）';render();},onPublication:()=>{}});
    notifications.update();
}
button('保持済みのゴミ箱を表示',()=>{hasTrash=true;render();workspace.select('trash');});
button('JA / EN',()=>{locale=locale==='ja'?'en':'ja';render();});
window.switchRoom=()=>{};window.toggleStudioLogoMenu=()=>{};
await spaceUI.load();render();
