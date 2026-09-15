import {getUILang} from './i18n-studio.js';
import {studioHelpItems,helpText,findHelpEntry,helpAvailability} from './studio-help-registry.js';
import '../css/studio-help.css';
export function initStudioHelp() {
 if(document.getElementById('studio-help-panel'))return;
 const en=()=>getUILang()==='en', label=(ja,english)=>en()?english:ja;
 const make=(tag,cls,parent)=>{const el=document.createElement(tag);el.className=cls;if(parent)parent.append(el);return el;};
 const backdrop=make('div','studio-help-backdrop',document.body);backdrop.hidden=true;
 const panel=make('section','studio-help-panel',backdrop);panel.id='studio-help-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','studio-help-title');
 const head=make('header','',panel),title=make('h2','',head);title.id='studio-help-title';
 const close=make('button','',head);close.type='button';close.textContent='×';
 const search=make('input','',panel);search.type='search';search.setAttribute('role','searchbox');
 const pick=make('button','',panel);pick.type='button';
 const list=make('nav','studio-help-list',panel),detail=make('article','studio-help-detail',panel);
 const shield=make('div','studio-help-shield',document.body);shield.hidden=true;
 const pickBar=make('div','studio-help-pick-bar',shield),instruction=make('span','',pickBar),cancel=make('button','',pickBar);cancel.type='button';
 const spot=make('div','studio-help-spot',document.body);spot.hidden=true;spot.setAttribute('aria-hidden','true');
 let active=null,opener=null,picking=false,spotTarget=null,spotTimer=null,composing=false;
 const stopSpot=()=>{spot.hidden=true;spotTarget=null;clearTimeout(spotTimer);};
 const positionSpot=()=>{if(!spotTarget?.isConnected||!spotTarget.getClientRects().length){stopSpot();return;}const r=spotTarget.getBoundingClientRect();Object.assign(spot.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});};
 const highlight=target=>{stopSpot();if(!target)return;spotTarget=target;spot.hidden=false;positionSpot();spotTimer=setTimeout(stopSpot,5000);};
 const tagTargets=()=>studioHelpItems.forEach(entry=>document.querySelectorAll(entry.selector).forEach(el=>{el.dataset.helpId=entry.id;}));
 function renderDetail(){
  detail.replaceChildren();if(!active)return;
  const text=helpText(active);make('h3','',detail).textContent=text[0];make('p','',detail).textContent=text[1];
  make('h4','',detail).textContent=label('手順','Steps');make('p','',detail).textContent=text[2];
  make('h4','',detail).textContent=label('対象・条件','Applies to / requirements');make('p','',detail).textContent=text[3];
  if(text[4])make('p','',detail).textContent=label('ショートカット：','Shortcuts: ')+text[4];
  const status=make('p','studio-help-status',detail);status.setAttribute('role','status');status.textContent=helpAvailability(active).text;
  const locate=make('button','',detail);locate.type='button';locate.textContent=label('操作場所を示す','Show control');
  locate.onclick=()=>{const current=helpAvailability(active);status.textContent=current.text;highlight(current.target);};
  for(const id of active.related){const other=studioHelpItems.find(x=>x.id===id);const b=make('button','studio-help-related',detail);b.type='button';b.textContent=helpText(other)[0];b.onclick=()=>{active=other;renderDetail();};}
 }
 function renderList(){
  list.replaceChildren();const q=search.value.trim().toLocaleLowerCase();
  const entries=studioHelpItems.filter(entry=>[...entry.ja,...entry.en].join(' ').toLocaleLowerCase().includes(q));
  if(!entries.length)make('p','',list).textContent=label('該当する説明はありません。別の言葉で検索してください。','No matches. Try another search term.');
  entries.forEach(entry=>{const b=make('button','',list);b.type='button';b.textContent=helpText(entry)[0];b.onclick=()=>{active=entry;renderDetail();};});
 }
 function refresh(){title.textContent=label('操作ヘルプ','Operation help');close.setAttribute('aria-label',label('ヘルプを閉じる','Close help'));search.placeholder=label('目的で検索（例：英語だけ、行揃え）','Search by task (e.g. English only, alignment)');search.setAttribute('aria-label',label('ヘルプを検索','Search help'));pick.textContent=label('場所を指して調べる','Choose a control to inspect');instruction.textContent=label('知りたい操作を選択してください。Escで終了。','Select a control to learn about it. Esc to cancel.');cancel.textContent=label('キャンセル','Cancel');document.querySelectorAll('[data-open-studio-help]').forEach(el=>{el.setAttribute('aria-label',label('操作ヘルプ','Operation help'));el.setAttribute('aria-controls',panel.id);el.setAttribute('aria-expanded',String(!backdrop.hidden||picking));});tagTargets();renderList();renderDetail();}
 function endPicking(){picking=false;shield.hidden=true;backdrop.hidden=false;stopSpot();}
 function closeHelp(){picking=false;shield.hidden=true;backdrop.hidden=true;stopSpot();refresh();if(opener?.isConnected&&opener.getClientRects().length)opener.focus();else document.querySelector('#studio-help-open')?.focus();}
 function openHelp(button){
  if(composing)return;
  opener=button||document.activeElement;
  document.querySelectorAll('[data-auth-dropdown].open').forEach(el=>el.classList.remove('open'));
  document.querySelectorAll('[data-auth-trigger]').forEach(el=>el.setAttribute('aria-expanded','false'));
  backdrop.hidden=false;refresh();search.focus();
 }
 close.onclick=closeHelp;backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeHelp();});search.addEventListener('input',renderList);
 pick.onclick=()=>{if(composing)return;picking=true;backdrop.hidden=true;shield.hidden=false;cancel.focus();};
 cancel.onclick=()=>{endPicking();pick.focus();};
 // The shield consumes pointer gestures, including over disabled controls.
 function targetAt(e){shield.style.pointerEvents='none';const target=document.elementFromPoint(e.clientX,e.clientY);shield.style.pointerEvents='';return target;}
 shield.addEventListener('pointermove',e=>{if(pickBar.contains(e.target))return;const entry=findHelpEntry(targetAt(e));if(entry){const target=targetAt(e)?.closest(entry.selector);highlight(target);}else stopSpot();});
 shield.addEventListener('pointerdown',e=>{if(!pickBar.contains(e.target)){e.preventDefault();e.stopPropagation();}});
 shield.addEventListener('click',e=>{if(pickBar.contains(e.target))return;e.preventDefault();e.stopPropagation();const entry=findHelpEntry(targetAt(e));endPicking();active=entry;renderDetail();if(!entry)make('p','',detail).textContent=label('この場所の説明はまだありません。操作一覧や検索から調べてください。','No help is registered for this location. Use the list or search.');search.focus();});
 shield.addEventListener('pointercancel',()=>{endPicking();pick.focus();});
 document.addEventListener('compositionstart',()=>{composing=true;},true);document.addEventListener('compositionend',()=>{composing=false;},true);
 document.addEventListener('click',e=>{const button=e.target.closest('[data-open-studio-help]');if(button){e.preventDefault();e.stopPropagation();openHelp(button);}},true);
 window.addEventListener('keydown',e=>{
  if(backdrop.hidden&&!picking)return;
  if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();if(picking){endPicking();pick.focus();}else closeHelp();return;}
  // Keep editor shortcuts from changing the document while help has focus.
  e.stopPropagation();
  if(e.key==='Tab'){const root=picking?shield:panel;const controls=[...root.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 },true);
 window.addEventListener('resize',positionSpot);window.addEventListener('scroll',positionSpot,true);document.addEventListener('studio-ui-language-change',refresh);
 let frame;new MutationObserver(records=>{if(records.every(r=>backdrop.contains(r.target)||shield.contains(r.target)))return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{tagTargets();const status=detail.querySelector('[role=status]');if(active&&status&&!backdrop.hidden)status.textContent=helpAvailability(active).text;});}).observe(document.getElementById('app-shell'),{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','aria-disabled','data-disabled-reason']});
 refresh();
}
