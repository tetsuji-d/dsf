// Isolated sample data; shares the actual Studio shell and space management UI.
import {installHomeStart} from '/js/home-start.js';
import {createHomeWorkspace} from '/js/home-workspace.js';
import {createPublishingSpaceUI} from '/js/publishing-spaces-ui.js';
import {createPublishingSpacesClient} from '/js/publishing-spaces-transport.js';
import {setUILang,getUILang} from '/js/i18n-studio.js';
let uid='owner_1';const user={uid,getIdToken:async()=> 'fixture-owner'};
const request=createPublishingSpacesClient({getUser:()=>uid?user:null});
const shell=createHomeWorkspace({root:document.getElementById('home-room'),getLocale:getUILang});
const spaces=createPublishingSpaceUI({root:document.getElementById('home-publishing-spaces'),switcherRoots:[document.getElementById('studio-space-switcher'),document.getElementById('mobile-space-switcher'),document.getElementById('home-space-launcher')],identityRoots:[document.getElementById('home-space-identity')],getUid:()=>uid,getLocale:getUILang,request,onChange:render,onSelect:()=>shell.select('overview')});
const samples=[['book_1','潮騒の図書館','#18344d'],['book_2','旅の写真集','#547571'],['book_3','夜明けのノート','#725e76'],['book_4','季節のたより','#9c774d']];
const notice=document.createElement('p');notice.id='fixture-workspace-action';notice.setAttribute('role','status');notice.style.cssText='margin:0;padding:6px 12px;background:#fff2c6;color:#58471d;font-size:12px';notice.textContent='検証用サンプル：操作は実際の原稿・クラウドに反映されません。';document.querySelector('.home-workspace-main').prepend(notice);
window.newSpaceProject=()=>{notice.firstChild.textContent='検証：作品の作成へ';};window.switchRoom=room=>{notice.firstChild.textContent='検証：'+room+'へ';};
window.toggleStudioLogoMenu=()=>{};window.toggleMobileStudioNavMenu=()=>{};
const language=document.createElement('button');language.id='fixture-language';language.textContent='JA / EN';language.onclick=()=>{setUILang(getUILang()==='en'?'ja':'en');render();};
const empty=document.createElement('button');empty.id='fixture-empty';empty.textContent='作品あり / なし';let isEmpty=false;empty.onclick=()=>{isEmpty=!isEmpty;render();};
const logout=document.createElement('button');logout.id='fixture-account';logout.textContent='ログイン / ログアウト';logout.onclick=async()=>{uid=uid?'':'owner_1';await spaces.load();render();};
for(const b of [language,empty,logout]){b.type='button';notice.append(' ',b);}
const permissions=document.createElement('a');permissions.href='/members';permissions.textContent='メンバーと権限の試作';permissions.style.marginLeft='12px';notice.append(permissions);
function render(){
 spaces.render();shell.render({spaceKind:spaces.viewKind()});const en=getUILang()==='en';
 const rows=uid&&!isEmpty?spaces.filter(samples.map(([id,title,color])=>({id,title,color}))):[];
 document.getElementById('home-cloud-grid').innerHTML=rows.length?rows.map(p=>'<div class="home-project-entry"><button class="home-project-card" data-fixture-work="'+p.id+'"><div class="home-project-thumb" style="display:grid;place-items:center;background:'+p.color+';color:white;font-family:serif;padding:8px">'+p.title+'</div><div class="home-project-info"><div class="home-project-title">'+p.title+'</div><span class="home-project-resume">'+(en?'Continue editing':'続きから編集')+'</span><div class="home-project-meta">'+(en?'Saved in cloud · 12 pages':'クラウド保存済み · 12ページ')+'</div></div></button>'+spaces.card(p)+'</div>').join(''):'<div class="home-empty-state"><p>'+(en?'No works in this view.':'この表示範囲に作品はありません。')+'</p><button class="home-action-btn primary" onclick="newSpaceProject()">'+(en?'Create your first work':'最初の作品を作成')+'</button></div>';
 document.querySelectorAll('[data-fixture-work]').forEach(b=>b.onclick=()=>{notice.firstChild.textContent='検証：'+b.dataset.fixtureWork+'の編集へ ';});spaces.bind(document.getElementById('home-cloud-grid'));
 document.getElementById('home-cloud-count').textContent=rows.length;
 document.getElementById('home-cloud-scope').textContent=spaces.destination()+' / '+spaces.label();
 document.getElementById('home-dashboard-stats').innerHTML=[['library_books',rows.length,en?'Works':'作品'],['public',0,en?'Published':'公開中'],['chat_bubble_outline',0,en?'Reviews':'レビュー']].map(([icon,value,label])=>'<article class="home-stat-card"><span class="material-icons">'+icon+'</span><div><strong>'+value+'</strong><span>'+label+'</span></div></article>').join('');
 document.getElementById('home-work-grid').innerHTML='<p>'+(en?'No published works yet.':'公開した作品はまだありません。')+'</p><button class="home-action-btn" data-home-nav="projects">'+(en?'Choose a work':'作品を選ぶ')+'</button>';
 document.getElementById('home-local-grid').innerHTML='<p>'+(en?'A working copy on this device':'この端末の作業コピー')+' — 潮騒の図書館</p>';document.getElementById('home-local-count').textContent='1';
}
const device=()=>{document.body.dataset.device=innerWidth<1024?'mobile':'desktop';};device();window.addEventListener('resize',device);
installHomeStart({root:document.getElementById('home-room'),getLocale:getUILang,readState:()=>({uid,workId:'fixture-work',blocks:[{}]}),readShared:()=>null,onResume:()=>window.switchRoom('editor')});
setUILang('ja');await spaces.load();render();

if(new URLSearchParams(location.search).get('profile')==='1'){
 spaces.select('unassigned');shell.select('settings');document.querySelector('[data-space-settings="profile"]').click();
}
