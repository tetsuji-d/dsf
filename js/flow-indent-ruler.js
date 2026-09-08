import { t } from './i18n-studio.js';
import {resolveFlowIndent,clampFlowIndent} from './flow-indent.js';
import '../css/flow-indent.css';
let current=null, draft=null, dragging=false, frame=0, commitHandler=null;
let ruler, panel, paragraph, line, oneCharIndent, guides=[], controls={}, handles={};
let showRuler=true, showGuides=true, showLine=true;
const labels={start:'indent_start',first:'indent_first',end:'indent_end'};
function localize(e,key){e.dataset.i18n=key;e.textContent=t(key);return e}
function announce(){document.dispatchEvent(new Event('dsf-flow-indent-ui-change'))}
function attachControls(){
 const host=window.matchMedia('(min-width:1024px)').matches && document.getElementById('flow-ribbon-indent');
 const destination=host || document.getElementById('flow-direct-format-props');
 if(destination && panel.parentNode!==destination){
  const anchor=!host && destination.querySelector('#flow-direct-block-format');
  if(anchor)anchor.after(panel);else destination.append(panel);
 }
 if(host)panel.open=true;
}
function element(tag,cls,parent){const e=document.createElement(tag);e.className=cls;parent?.append(e);return e}
function initialize(){
 if(ruler)return;
 ruler=element('div','flow-indent-ruler',document.body);ruler.dataset.flowIndentOverlay='';ruler.setAttribute('aria-label',t('indent_title'));
 element('div','flow-indent-ticks',ruler);
 paragraph=element('div','flow-indent-paragraph',document.body);line=element('div','flow-indent-line',document.body);
 for(const key of Object.keys(labels)){
  const guide=element('div','flow-indent-guide '+key,document.body);guides.push(guide);
  const h=element('button','flow-indent-marker '+key,ruler);handles[key]=h;h.type='button';h.setAttribute('role','slider');h.dataset.i18nAria='indent_'+key+'_aria';h.setAttribute('aria-label',t(h.dataset.i18nAria));
  h.onpointerdown=e=>{if(!current||current.disabled)return;e.preventDefault();e.stopPropagation();dragging=true;draft={...resolveFlowIndent(current.block,current.language)};h.setPointerCapture(e.pointerId)};
  h.onpointermove=e=>{if(!dragging||!current)return;const g=geometry();if(!g)return;const pos=(g.vertical?e.clientY-g.content.top:e.clientX-g.content.left)/g.unit;
    draft=clampFlowIndent({...draft,[key]:key==='end'?g.capacity-pos:key==='first'?pos-draft.start:pos},g.capacity);preview();paint()};
  h.onpointerup=()=>{if(!dragging)return;dragging=false;restore();commit(draft)};
  h.onpointercancel=()=>{dragging=false;restore();draft=null;paint()};
  h.onkeydown=e=>{if(!current||current.disabled)return;if(e.key==='Escape'){dragging=false;restore();draft=null;paint();return}
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const delta=['ArrowDown','ArrowRight'].includes(e.key)?0.5:-0.5;
   commit(clampFlowIndent({...resolveFlowIndent(current.block,current.language),[key]:resolveFlowIndent(current.block,current.language)[key]+delta*(key==='end'?-1:1)},geometry().capacity))};
 }
 panel=element('details','flow-indent-controls');panel.open=true;panel.id='flow-indent-controls';
 localize(element('summary','',panel),'indent_title');
 const preset=element('label','flow-indent-toggle flow-indent-one-char',panel);
 oneCharIndent=element('input','',preset);oneCharIndent.type='checkbox';
 oneCharIndent.dataset.indentPreset='first-one';oneCharIndent.dataset.i18nAria='indent_one_char';oneCharIndent.setAttribute('aria-label',t('indent_one_char'));localize(element('span','',preset),'indent_one_char');
 oneCharIndent.onchange=()=>{
  if(!current||current.disabled)return;
  // This shortcut changes only the first line; keep both paragraph margins intact.
  commit({...resolveFlowIndent(current.block,current.language),first:oneCharIndent.checked?1:0});
 };
 for(const key of Object.keys(labels)){
  const label=element('label','flow-indent-field',panel);localize(element('span','',label),labels[key]);
  const input=element('input','',label);input.type='number';input.step='0.5';input.min=key==='first'?'-8':'0';input.max='8';input.dataset.i18nAria='indent_'+key+'_aria';input.setAttribute('aria-label',t(input.dataset.i18nAria));input.dataset.indentField=key;controls[key]=input;localize(element('span','',label),'indent_unit');
  input.onchange=()=>{if(!current||current.disabled)return;const n=input.valueAsNumber;if(!Number.isFinite(n)){input.value=resolveFlowIndent(current.block,current.language)[key];return}commit(clampFlowIndent({...resolveFlowIndent(current.block,current.language),[key]:n},geometry().capacity))};
 }
 const help=element('p','flow-indent-help',panel);localize(help,'indent_help');
 const reset=element('button','flow-indent-reset',panel);reset.type='button';localize(reset,'indent_reset');reset.dataset.i18nTitle='indent_reset';reset.dataset.i18nAria='indent_reset';reset.title=t('indent_reset');reset.setAttribute('aria-label',t('indent_reset'));reset.onclick=()=>commit({start:0,first:0,end:0});
 for(const [label,get,set] of [['ruler',()=>showRuler,v=>showRuler=v],['guides',()=>showGuides,v=>showGuides=v],['line',()=>showLine,v=>showLine=v]]){
  const row=element('label','flow-indent-toggle',panel),box=element('input','',row);box.type='checkbox';box.checked=get();box.dataset.flowIndentDisplay=label;localize(element('span','',row),'ribbon_display_'+label);box.onchange=()=>{set(box.checked);paint();announce()};
 }
 const body=element('div','flow-indent-body',panel);
 for(const child of [...panel.children])if(child.tagName!=='SUMMARY' && child!==body)body.append(child);
 panel.onpointerdown=e=>e.stopPropagation();
 const refresh=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;paint()})};
 window.addEventListener('scroll',refresh,true);window.addEventListener('resize',()=>{attachControls();refresh()});
}
function geometry(){
 if(!current?.pageElement.isConnected||!current.fragment.isConnected)return null;
 const p=current.pageElement, c=p.querySelector('.flow-dom-content');if(!c)return null;
 const page=p.getBoundingClientRect(),content=c.getBoundingClientRect(),vertical=current.writingMode==='vertical-rl';
 const css=getComputedStyle(current.fragment),scale=page.width/p.offsetWidth;
 const unit=parseFloat(css.fontSize)*scale;
 return {page,content,vertical,scale,unit,capacity:(vertical?content.height:content.width)/unit,css};
}
function box(e,r){Object.assign(e.style,{left:r.left+'px',top:r.top+'px',width:Math.max(0,r.width)+'px',height:Math.max(0,r.height)+'px'})}
function preview(){if(!current)return;const p=current.fragment;p.style.paddingInlineStart=draft.start+'em';p.style.paddingInlineEnd=draft.end+'em';p.style.textIndent=p.dataset.blockStart==='true'?draft.first+'em':'0px'}
function restore(){if(!current)return;const v=resolveFlowIndent(current.block,current.language);const p=current.fragment;p.style.paddingInlineStart=v.start+'em';p.style.paddingInlineEnd=v.end+'em';p.style.textIndent=p.dataset.blockStart==='true'?v.first+'em':'0px'}
function commit(value){if(!current||current.disabled)return;const old=resolveFlowIndent(current.block,current.language);draft=null;if(JSON.stringify(value)===JSON.stringify(old)){paint();return}const language=current.language;commitHandler?.(value);if(current)current={...current,disabled:true,block:{...current.block,indentByLanguage:{...current.block.indentByLanguage,[language]:{...value}}}};paint()}
function hideOverlays(){for(const e of [ruler,paragraph,line,...guides])if(e)e.hidden=true}
function paint(){
 const g=geometry();if(!g){hideOverlays();return}const {content:c,page,vertical,unit}=g,v=draft||resolveFlowIndent(current.block,current.language);
 const viewport=current.pageElement.closest('#flow-canvas-viewport')?.getBoundingClientRect();
 if(page.right<0||page.left>innerWidth||page.bottom<0||page.top>innerHeight || (viewport&&(page.right<viewport.left||page.left>viewport.right))){hideOverlays();return}
 const length=vertical?c.height:c.width;
 ruler.hidden=!showRuler;ruler.classList.toggle('vertical',vertical);
 box(ruler,vertical?{left:Math.min(page.right+4,(viewport?.right||innerWidth)-36),top:c.top,width:32,height:c.height}:{left:c.left,top:Math.max(0,page.top-36),width:c.width,height:32});
 const ticks=ruler.firstElementChild;ticks.replaceChildren();for(let n=0;n<=Math.floor(g.capacity);n++){const t=element('span','flow-indent-tick',ticks);t.style[vertical?'top':'left']=n*unit+'px';if(n%2===0)t.textContent=n;}
 Object.keys(labels).forEach((key,i)=>{const h=handles[key],pos=key==='end'?length-v.end*unit:(v.start+(key==='first'?v.first:0))*unit;
  h.style[vertical?'top':'left']=pos+'px';h.style[vertical?'left':'top']='';h.disabled=current.disabled;
  h.textContent=key==='start'?'■':vertical?(key==='first'?'◀':'▶'):(key==='first'?'▼':'▲');h.title=t(labels[key])+' '+v[key]+t('indent_unit');
  h.setAttribute('aria-valuenow',v[key]);h.setAttribute('aria-valuemin',key==='first'?-v.start:0);h.setAttribute('aria-valuemax','8');h.setAttribute('aria-valuetext',v[key]+t('indent_unit'));h.setAttribute('aria-orientation',vertical?'vertical':'horizontal');
  if(document.activeElement!==controls[key] || dragging)controls[key].value=v[key];controls[key].disabled=current.disabled;controls.first.min=-v.start;
  const guide=guides[i];guide.hidden=!showGuides;box(guide,vertical?{left:c.left,top:c.top+pos,width:c.width,height:1}:{left:c.left+pos,top:c.top,width:1,height:c.height});
 });
 oneCharIndent.checked=v.first===1;
 const noRoom=v.start+v.end+1>g.capacity-3;
 oneCharIndent.disabled=current.disabled||(!oneCharIndent.checked&&noRoom);
 oneCharIndent.title=!oneCharIndent.checked&&noRoom?t('indent_no_room'):t('indent_one_char');
 panel.querySelector('.flow-indent-reset').disabled=current.disabled;
 const r=current.fragment.getBoundingClientRect();paragraph.hidden=!showLine;
 box(paragraph,{left:Math.max(c.left,r.left),top:Math.max(c.top,r.top),width:Math.min(c.right,r.right)-Math.max(c.left,r.left),height:Math.min(c.bottom,r.bottom)-Math.max(c.top,r.top)});
 line.hidden=!showLine||dragging||!current.caretLocal;
 if(!line.hidden){
  const local=current.caretLocal;
  const caret={left:page.left+local.left*g.scale,top:page.top+local.top*g.scale,width:local.width*g.scale,height:local.height*g.scale};
  const lineSize=parseFloat(g.css.lineHeight)*g.scale;
  const rect=vertical?{left:caret.left+(caret.width-lineSize)/2,top:c.top+v.start*unit,width:lineSize,height:c.height-(v.start+v.end)*unit}:{left:c.left+v.start*unit,top:caret.top+(caret.height-lineSize)/2,width:c.width-(v.start+v.end)*unit,height:lineSize};
  const left=Math.max(c.left,rect.left),top=Math.max(c.top,rect.top);
  box(line,{left,top,width:Math.min(c.right,rect.left+rect.width)-left,height:Math.min(c.bottom,rect.top+rect.height)-top});
 }
}
export function showFlowIndentRuler(options){initialize();if(dragging)return;
 const page=options.pageElement.getBoundingClientRect(),scale=page.width/options.pageElement.offsetWidth;
 // Keep the caret relative to the page so scrolling moves the highlight with its text.
 const caret=options.caret;
 current={...options,caretLocal:caret?{left:(caret.left-page.left)/scale,top:(caret.top-page.top)/scale,width:caret.width/scale,height:caret.height/scale}:null};commitHandler=options.onCommit;draft=null;attachControls();panel.hidden=false;paint();announce()}
export function hideFlowIndentRuler(){dragging=false;restore();current=null;draft=null;hideOverlays();if(panel)panel.hidden=true;announce();}
