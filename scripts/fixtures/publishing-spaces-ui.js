import { createPublishingSpaceUI } from '/js/publishing-spaces-ui.js';
import { createPublishingSpacesClient } from '/js/publishing-spaces-transport.js';
import { choosePublishingSpace } from '/js/publishing-space-publish-dialog.js';
let uid='owner_1', locale='ja';
const users=Object.fromEntries(['owner_1','owner_2'].map(uid=>[uid,{uid,getIdToken:async()=>uid==='owner_1'?'fixture-owner':'fixture-other'}]));
const projects=[{id:'book_1',title:'潮騒の図書館'},{id:'book_2',title:'旅の写真集'}];
const ui=createPublishingSpaceUI({root:document.getElementById('spaces'),switcherRoots:new URLSearchParams(location.search).has('legacy')?[]:[document.getElementById('fixture-space-switcher')],getUid:()=>uid,getLocale:()=>locale,
    request:createPublishingSpacesClient({getUser:()=>users[uid]}),onChange:render});
function render(){
    ui.render();
    document.getElementById('scope').textContent=ui.destination()+' / '+ui.label();
    const rows=ui.filter(uid==='owner_1'?projects:[]);
    const grid=document.getElementById('projects');
    grid.innerHTML=rows.length?rows.map(p=>'<article class="fixture-card" data-project-id="'+p.id+'"><div class="fixture-cover">'+p.title+'</div><h3>'+p.title+'</h3><small>'+(locale==='en'?'Saved in cloud':'クラウドに保存済み')+'</small>'+ui.card(p)+'</article>').join(''):'<p>'+(locale==='en'?'No manuscripts in this view.':'この表示範囲に原稿はありません。')+'</p>';
    ui.bind(grid);
}
document.getElementById('language').onclick=()=>{locale=locale==='ja'?'en':'ja';render();};
document.getElementById('account').onclick=async()=>{uid=uid==='owner_1'?'owner_2':'owner_1';render();await ui.load();render();};
document.getElementById('open-file').onclick=()=>document.getElementById('file').click();
const publishButton = document.createElement('button'); publishButton.id = 'fixture-publish'; publishButton.textContent = 'Horizonへ下書き保存';
const publishResult = document.createElement('p'); publishResult.id = 'fixture-publish-result';
document.body.append(publishButton, publishResult);
publishButton.onclick = async () => {
    const user = users[uid];
    const result = await choosePublishingSpace({request:createPublishingSpacesClient({getUser:()=>users[uid]}), projectId:'book_1', purpose:'draft', getLocale:()=>locale, isCurrent:()=>user === users[uid]});
    publishResult.textContent = result ? 'READY' : 'CANCELLED'; await ui.load(); render();
};
await ui.load();render();

if (new URLSearchParams(location.search).has('create')) document.querySelector('[data-space-create]')?.click();
