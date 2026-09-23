import {createHomeWorkspace} from '/js/home-workspace.js';
import {createPublishingSpaceUI} from '/js/publishing-spaces-ui.js';
import {createInvitationsClient} from '/js/publishing-invitations-transport.js';
import {createSpaceMembersSettings} from '/js/space-members-settings.js';
import {renderJoinedSpaceWorks} from '/js/joined-space-works.js';
let user={uid:'reader_1',getIdToken:async()=> 'fixture-reader_1'},lang='ja',revision=0;
const execute=createInvitationsClient({getUser:()=>user}),root=document.getElementById('home-room');
const shell=createHomeWorkspace({root,getLocale:()=>lang,onSelect:()=>spaces.retryIfFailed()});
const members=createSpaceMembersSettings({root:document.getElementById('home-space-members'),execute,getLocale:()=>lang});
const spaces=createPublishingSpaceUI({root:document.getElementById('home-publishing-spaces'),switcherRoots:[document.getElementById('studio-space-switcher'),document.getElementById('mobile-space-switcher')],identityRoots:[document.getElementById('home-space-identity')],getUid:()=>user.uid,getLocale:()=>lang,
 request:async()=>({uid:user.uid,schemaVersion:1,revision:0,spaces:[],assignments:{}}),requestJoined:execute,onChange:render,onSelect:()=>{shell.select('overview');render();}});
const note=document.createElement('div');note.style.cssText='padding:8px;background:#fff2c6';note.textContent='ローカル検証用：招待先の画面 ';document.querySelector('.home-workspace-main').prepend(note);
const actor=document.createElement('select');actor.id='fixture-actor';for(const uid of ['reader_1','reader_2']){const o=document.createElement('option');o.value=uid;o.textContent=uid==='reader_1'?'参加したアカウント':'未参加のアカウント';actor.append(o);}actor.onchange=()=>{const uid=actor.value;user={uid,getIdToken:async()=> 'fixture-'+uid};void spaces.load({notify:true});render();};note.append(actor);
const language=document.createElement('button');language.id='fixture-language';language.textContent='JA / EN';language.onclick=()=>{lang=lang==='ja'?'en':'ja';render();};note.append(language);
window.toggleStudioLogoMenu=()=>{};window.toggleMobileStudioNavMenu=()=>{};
async function render(){
 const epoch=++revision;const uid=user.uid;spaces.render();shell.render({spaceKind:spaces.viewKind()});const joined=spaces.joinedSelection();root.classList.toggle('home-joined-space',!!joined);
 members.update({uid,spaceId:spaces.selection(),manageMembers:!joined||joined.canManageMembers===true});
 const grid=document.getElementById('home-cloud-grid');document.getElementById('home-dashboard-stats').replaceChildren();document.getElementById('home-work-grid').textContent='';
 document.getElementById('home-cloud-scope').textContent=(joined?'共有作品 / ':'個人原稿 / ')+spaces.label();
 if(joined)await renderJoinedSpaceWorks({root:grid,count:document.getElementById('home-cloud-count'),spaceId:joined.id,execute,getLocale:()=>lang,isCurrent:()=>epoch===revision&&uid===user.uid});
 else{grid.textContent=uid==='reader_1'?'自分だけの原稿（検証用）':'別アカウントの原稿（検証用）';document.getElementById('home-cloud-count').textContent='1';}
}
const device=()=>{document.body.dataset.device=innerWidth<1024?'mobile':'desktop';};device();window.addEventListener('resize',device);
await spaces.load();render();
