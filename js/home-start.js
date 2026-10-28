// View-only launch and search controls. No new project/history storage.
import { HOME_PROJECT_SORTS, editableReadLabels, compareEditableReads } from './home-project-list.js';
export function canResumeHomeProject(state,shared,online=true){
 return !!(state.workId||state.projectId||state.localProjectId)&&!!(state.blocks?.length||state.sections?.length)&&(!shared||(online&&shared.status==='ready'));
}
export function installHomeStart({root,getLocale,readState,readShared,onResume,onConnectivity}) {
 if(!root)return;
 const search=root.querySelector('[data-home-search]'),resume=root.querySelector('[data-home-resume]'),empty=root.querySelector('[data-home-search-empty]');
 const sortControl=root.querySelector('[data-home-sort]');
 let sort='updated-desc';
 const copy={
  ja:{allSpaces:'全スペース共通',recent:'最近の作業（全スペース共通）',previous:'前の作業を表示',next:'次の作業を表示',resume:'編集中のリードに戻る',search:'一覧の編集用リードを検索',spaces:'スペースを開く',shared:'共有された編集用リード',scope:'スペースの切り替えは表示範囲の変更です。編集用リードの保存先は変わりません。',localNote:'このブラウザーの復元用コピーを、新しい順に最大12件表示します。編集用ファイルの保存とは別です。',placeholder:'リード名・管理名で検索',none:'この一覧に一致する編集用リードはありません。',noResume:'新規作成するか、編集用ファイルまたは一覧の編集用リードを開いてください。'},
  en:{allSpaces:'All spaces',recent:'Recent work across all spaces',previous:'Show previous working copies',next:'Show next working copies',resume:'Return to editor',search:'Search listed editable Reads',spaces:'Open a space',shared:'Shared with me',scope:'Switching spaces changes the view, not the editable Read’s save location.',localNote:'Up to 12 browser working copies, newest save first. Resume with images stored on this device. These copies are separate from saved editable files.',placeholder:'Search by Read or management name',none:'No matching editable Reads in this list.',noResume:'Create a project or open an editable file or a listed editable Read.'}
 };
 const recent=root.querySelector('#home-local-grid');
 const recentButtons=[...root.querySelectorAll('[data-home-recent-step]')];
 function updateRecentControls(){
  if(!recent)return;
  const t=copy[getLocale()==='en'?'en':'ja'];
  recent.setAttribute('aria-label',t.recent);
  for(const button of recentButtons){
   const previous=Number(button.dataset.homeRecentStep)<0;
   button.setAttribute('aria-label',previous?t.previous:t.next);
   button.disabled=previous?recent.scrollLeft<=1:recent.scrollLeft+recent.clientWidth>=recent.scrollWidth-1;
  }
 }
 for(const button of recentButtons)button.addEventListener('click',()=>{
  const card=recent.querySelector('.home-project-entry:not([hidden])');
  const stride=card?card.getBoundingClientRect().width+12:recent.clientWidth;
  const step=Math.max(1,Math.floor(recent.clientWidth/stride))*stride;
  recent.scrollBy({left:Number(button.dataset.homeRecentStep)*step,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 });
 recent?.addEventListener('scroll',updateRecentControls,{passive:true});
 if(recent)new ResizeObserver(updateRecentControls).observe(recent);
 function filter(){const t=copy[getLocale()==='en'?'en':'ja'],q=search.value.trim().normalize('NFKC').toLocaleLowerCase();let count=0;root.classList.toggle('home-searching',!!q);
  const tbody=root.querySelector('.home-editable-table tbody');
  if(tbody){
   const entries=[...tbody.children];
   const values=node=>({id:node.dataset.projectEntry,name:node.dataset.sortName||'',title:node.dataset.sortTitle||'',updated:Number(node.dataset.sortUpdated)||0});
   const sorted=[...entries].sort((a,b)=>compareEditableReads(values(a),values(b),sort,getLocale()));
   // Keep handlers and avoid a MutationObserver loop when the order is unchanged.
   if(sorted.some((node,index)=>node!==entries[index]))tbody.append(...sorted);
  }
  for(const card of root.querySelectorAll('.home-project-entry')){const text=[...card.querySelectorAll('.home-project-title,.home-project-work-title')].map(n=>n.textContent).join(' ').normalize('NFKC').toLocaleLowerCase();card.hidden=!!q&&!text.includes(q);if(!card.hidden&&card.closest('[data-home-views]')?.hidden!==true)count++;}
  empty.hidden=!q||count>0;empty.textContent=t.none;
  requestAnimationFrame(updateRecentControls);
 }
 function refresh(){const s=readState(),shared=readShared(),t=copy[getLocale()==='en'?'en':'ja'];
  if(sortControl){const labels=editableReadLabels(getLocale());root.querySelector('[data-home-sort-label]').textContent=labels.sort;sortControl.setAttribute('aria-label',labels.sort);sortControl.replaceChildren(...HOME_PROJECT_SORTS.map((value,index)=>{const option=document.createElement('option');option.value=value;option.textContent=labels.sorts[index];return option;}));sortControl.value=sort;}
  root.dataset.localFirst=String(!s.uid||!navigator.onLine);
  root.querySelectorAll('[data-start-label]').forEach(n=>n.textContent=t[n.dataset.startLabel]||'');search.placeholder=t.placeholder;search.setAttribute('aria-label',t.search);
  resume.disabled=!canResumeHomeProject(s,shared,navigator.onLine);resume.title=resume.disabled?t.noResume:(s.projectName||s.title||t.resume);
  filter();
 }
 resume.addEventListener('click',()=>{refresh();if(!resume.disabled)onResume();});search.addEventListener('input',()=>{if(recent)recent.scrollLeft=0;filter();});
 sortControl?.addEventListener('change',()=>{sort=sortControl.value;filter();});
 for(const id of ['home-cloud-grid','home-local-grid']){const grid=root.querySelector('#'+id);if(grid)new MutationObserver(filter).observe(grid,{childList:true,subtree:true});}
 window.addEventListener('home-start-refresh',refresh);window.addEventListener('local-draft-status',refresh);document.addEventListener('studio-ui-language-change',refresh);
 for(const name of ['online','offline'])window.addEventListener(name,()=>{refresh();onConnectivity?.();});refresh();
}
