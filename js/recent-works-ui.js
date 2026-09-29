import {resolveProjectName,resolveProjectDisplayTitle} from './project-display-title.js';
import {buildRecentWorks,filterRecentWorks} from './recent-works.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export function createRecentWorksUI({root,getLocale=()=> 'ja',onCloud,onLocal,onDelete,onMore,onRefresh}){
 let data={},query='',scope='all',limit=24;
 function render(next=data){data=next;if(!root)return;const focused=root.contains(document.activeElement)&&document.activeElement.type==='search';const selection=focused?document.activeElement.selectionStart:null;const en=getLocale()==='en',t=(ja,english)=>en?english:ja;root.replaceChildren();
  const title=el('h3',t('最近の作業','Recent work'));root.append(title);
  const toolbar=el('div',null,'recent-works-toolbar'),search=el('input');search.type='search';search.value=query;search.placeholder=t('作品名・プロジェクト名・スペース名で検索','Search works, projects or spaces');search.setAttribute('aria-label',t('スペース横断で検索','Search across spaces'));
  const select=el('select');select.setAttribute('aria-label',t('最近の作業の表示範囲','Recent work scope'));
  const options=[['all',t('すべてのスペースとこの端末','All spaces and this device')],['personal',t('マイスペース（クラウド）','My Space (cloud)')],['device',t('この端末のみの原稿','Device-only manuscripts')],['copies',t('このブラウザーのコピー','Browser copies')],...(data.catalogue?.spaces||[]).map(s=>[s.id,s.name]),...(data.directory?.spaces||[]).map(s=>[s.id,s.name])];
  for(const [value,label]of options.filter((x,i,a)=>a.findIndex(y=>y[0]===x[0])===i)){const o=el('option',label);o.value=value;select.append(o);}if(!options.some(o=>o[0]===scope))scope='all';select.value=scope;
  const refresh=el('button',t('一覧を更新','Refresh'),'home-action-btn');refresh.type='button';refresh.onclick=onRefresh;toolbar.append(search,select,refresh);root.append(toolbar);
  const status=el('p',null,'recent-works-status');status.setAttribute('role','status');root.append(status);
  const note=el('p',t('クラウドと端末のコピーは、開く版を選べます。内容は自動で統合しません。','Choose a cloud manuscript or a browser copy. Contents are not merged automatically.'),'recent-works-note');root.append(note);
  const list=el('div',null,'recent-works-shelf');list.tabIndex=0;list.setAttribute('aria-label',t('最近の作業一覧','Recent work list'));root.append(list);
  const controls=el('div',null,'recent-works-controls');
  for(const [step,label]of [[-1,t('前の作品','Previous works')],[1,t('次の作品','Next works')]]){const b=el('button',label,'home-action-btn');b.type='button';b.dataset.step=step;b.onclick=()=>list.scrollBy({left:step*Math.max(260,list.clientWidth-40),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});controls.append(b);}
  const moreCards=el('button',t('さらに表示','Show more'),'home-action-btn');moreCards.type='button';moreCards.onclick=()=>{limit+=24;draw();};controls.append(moreCards);
  if(data.directory?.more||data.directory?.failed){const more=el('button',data.directory.failed?t('参加スペースを再取得','Retry joined spaces'):t('参加スペースの作品をさらに取得','Load more joined works'),'home-action-btn');more.type='button';more.disabled=!!data.directory.busy;more.onclick=onMore;controls.append(more);}
  root.append(controls);
  function arrows(){for(const b of controls.querySelectorAll('[data-step]'))b.disabled=Number(b.dataset.step)<0?list.scrollLeft<=1:list.scrollLeft+list.clientWidth>=list.scrollWidth-1;}
  list.addEventListener('scroll',arrows,{passive:true});
  function draw(){const rows=buildRecentWorks(data),filtered=filterRecentWorks(rows,{query,scope});list.replaceChildren();
   const notices=[];if(!data.online)notices.push(t('オフライン：このブラウザーのコピーを表示中','Offline: browser copies only'));else if(!data.uid)notices.push(t('ログインするとクラウド作品も表示します','Sign in to include cloud works'));else if(data.owned===null)notices.push(t('クラウド一覧は未取得です','Cloud list is unavailable'));
   if(data.localFailed)notices.push(t('端末コピーを取得できませんでした','Browser copies could not be loaded'));
   if(data.loading)notices.push(t('一覧を読み込み中…','Loading…'));
   if(data.directory?.unavailable)notices.push(t('参加スペースの横断表示は現在このアカウントでは利用できません','Joined-space browsing is not available for this account yet'));
   if(data.historyFailed)notices.push(t('操作履歴は未取得です。更新日時順で表示します','Open history is unavailable; showing update order'));
   if(data.directory?.failed)notices.push(t('一部の参加スペースを取得できませんでした','Some joined spaces could not be loaded'));else if(data.directory?.more)notices.push(t('参加スペースに未取得分があります','More joined works have not been loaded'));
   notices.push(t(`取得済み${rows.length}件から検索・表示（該当${filtered.length}件）`,`Searching ${rows.length} loaded items (${filtered.length} matches)`));
   if(data.history)notices.push(t('最近開いた順（履歴のない作品は更新順）','Recently opened first, then other works by update time'));
   if(!data.history)notices.push(t('更新日時の新しい順','Newest update first'));
   status.textContent=notices.join(' · ');
   for(const row of filtered.slice(0,limit)){
    const p=row.cloud||row.shared||row.locals[0],card=el('article',null,'recent-work-card');card.dataset.recentKey=row.key;
    const thumb=p.listThumbnail||p.thumbnail;if(thumb&&/^(https:|data:image\/|blob:)/.test(thumb)){const img=el('img');img.src=thumb;img.alt='';img.loading='lazy';card.append(img);}
    card.append(el('h4',resolveProjectName(p)||resolveProjectDisplayTitle(p,{locale:getLocale()})||t('無題の原稿','Untitled manuscript')));
    const label=row.spaceName||(row.spaceId===null?t('マイスペース（クラウド）','My Space (cloud)'):row.spaceId==='device'?t('この端末のみ・スペース未所属','This device only; no space'):row.otherAccount?t('別アカウントのコピー','Copy from another account'):t('所属未確認','Space unconfirmed'));
    card.append(el('p',label,'recent-work-space'));
    if(row.cloudTrashed)card.append(el('p',t('クラウド原稿はゴミ箱にあります','Cloud manuscript is in Trash')));
    const actions=el('div',null,'recent-work-actions');const action=(text,callback)=>{const b=el('button',text,'home-action-btn');b.type='button';b.onclick=async()=>{b.disabled=true;try{await callback();}finally{if(b.isConnected)b.disabled=false;}};actions.append(b);};
    if(row.shared){if(row.shared.canOpen){const a=el('a',row.shared.canEdit?t('共有原稿を編集','Edit shared manuscript'):t('共有原稿を読む','Read shared manuscript'),'home-action-btn');a.href='/studio?room=editor&sharedSpace='+encodeURIComponent(row.shared.spaceId)+'&sharedWork='+encodeURIComponent(row.shared.workId);actions.append(a);}else actions.append(el('span',t('共有原稿の読込は準備中','Shared opening is not available')));}
    else if(row.cloud)action(t('クラウドを開く','Open cloud'),()=>onCloud(row));
    for(const copy of row.locals){action(t('端末のコピーを開く','Open browser copy'),()=>onLocal(copy));const remove=el('button',t('コピーを削除','Delete copy'),'recent-copy-delete');remove.type='button';remove.onclick=()=>onDelete(copy);actions.append(remove);}
    card.append(actions);if(row.locals.length&&(row.cloud||row.shared))card.append(el('p',t('端末版とクラウド版の差分は未確認','Differences between copies have not been checked'),'recent-works-note'));
    if(row.openedAt)card.append(el('p',t('最近開いた日時：','Last opened: ')+new Date(row.openedAt).toLocaleString(en?'en-US':'ja-JP'),'recent-works-note'));
    if(row.updatedAt)card.append(el('p',t('更新：','Updated: ')+new Date(row.updatedAt).toLocaleString(en?'en-US':'ja-JP'),'recent-works-note'));
    list.append(card);
   }
   if(!filtered.length)list.append(el('p',t('一致する作品はありません。','No matching works.')));moreCards.hidden=filtered.length<=limit;requestAnimationFrame(arrows);
  }
  search.oninput=()=>{query=search.value;limit=24;list.scrollLeft=0;draw();};select.onchange=()=>{scope=select.value;limit=24;list.scrollLeft=0;draw();};draw();if(focused){search.focus({preventScroll:true});search.setSelectionRange(selection,selection);}
 }
 return {render};
}
