// View-only launch and search controls. No new project/history storage.
export function canResumeHomeProject(state,shared,online=true){
 return !!(state.workId||state.projectId||state.localProjectId)&&!!(state.blocks?.length||state.sections?.length)&&(!shared||(online&&shared.status==='ready'));
}
export function installHomeStart({root,getLocale,readState,readShared,onResume,onConnectivity}) {
 if(!root)return;
 const search=root.querySelector('[data-home-search]'),resume=root.querySelector('[data-home-resume]'),empty=root.querySelector('[data-home-search-empty]');
 const copy={
  ja:{resume:'編集中の作品に戻る',search:'一覧の原稿を検索',spaces:'スペースを開く',shared:'共有された作品',scope:'スペースの切り替えは表示範囲の変更です。原稿の保存先は変わりません。',localNote:'このブラウザーの自動保存を、新しい順に最大12件表示します。DSPファイルの保存とは別です。',placeholder:'作品名・プロジェクト名で検索',none:'この一覧に一致する原稿はありません。',noResume:'新規作成するか、DSPまたは一覧の原稿を開いてください。'},
  en:{resume:'Return to editor',search:'Search listed manuscripts',spaces:'Open a space',shared:'Shared with me',scope:'Switching spaces changes the view, not the manuscript’s save location.',localNote:'Up to 12 browser working copies, newest save first. Resume with images stored on this device. These copies are separate from saved DSP files.',placeholder:'Search by work or project name',none:'No matching manuscripts in this list.',noResume:'Create a project or open a DSP or a listed manuscript.'}
 };
 function filter(){const t=copy[getLocale()==='en'?'en':'ja'],q=search.value.trim().normalize('NFKC').toLocaleLowerCase();let count=0;root.classList.toggle('home-searching',!!q);
  for(const card of root.querySelectorAll('.home-project-entry')){const text=[...card.querySelectorAll('.home-project-title,.home-project-work-title')].map(n=>n.textContent).join(' ').normalize('NFKC').toLocaleLowerCase();card.hidden=!!q&&!text.includes(q);if(!card.hidden&&card.closest('[data-home-views]')?.hidden!==true)count++;}
  empty.hidden=!q||count>0;empty.textContent=t.none;
 }
 function refresh(){const s=readState(),shared=readShared(),t=copy[getLocale()==='en'?'en':'ja'];
  root.dataset.localFirst=String(!s.uid||!navigator.onLine);
  root.querySelectorAll('[data-start-label]').forEach(n=>n.textContent=t[n.dataset.startLabel]||'');search.placeholder=t.placeholder;search.setAttribute('aria-label',t.search);
  resume.disabled=!canResumeHomeProject(s,shared,navigator.onLine);resume.title=resume.disabled?t.noResume:(s.projectName||s.title||t.resume);
  filter();
 }
 resume.addEventListener('click',()=>{refresh();if(!resume.disabled)onResume();});search.addEventListener('input',filter);
 for(const id of ['home-cloud-grid','home-local-grid']){const grid=root.querySelector('#'+id);if(grid)new MutationObserver(filter).observe(grid,{childList:true,subtree:true});}
 window.addEventListener('home-start-refresh',refresh);window.addEventListener('local-draft-status',refresh);document.addEventListener('studio-ui-language-change',refresh);
 for(const name of ['online','offline'])window.addEventListener(name,()=>{refresh();onConnectivity?.();});refresh();
}
