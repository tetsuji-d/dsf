import {dsfFilename} from '/js/file-extensions.js';
import {loadDsfV3,resaveDsfV3,writingFontText} from '/js/dsf-writing-package.js';
import {writingArchiveKind} from '/js/dsf-writing-zip.js';
import {createReaderWritingModel,writingId,moveWritingObject,writingBounds,createWritingText,reorderWritingObject,reorderWritingObjectAt,writingMarqueeObjects,moveWritingSelection,styleWritingSelection} from '/js/reader-writing-model.js';
import {renderWritingLayer} from '/js/reader-writing-renderer.js';
import {INK_COLORS,HIGHLIGHTER_COLORS,PEN_WIDTHS,PEN_TOOLS,penPixels,penMillimeters,penWidthLabel,toolDefaults,createPenButton,writingControlPoints,snapWritingPoint,constrainedRect,editWritingPoint,brushGeometry,brushDryness,penTipScale} from '/js/reader-writing-tools.js';
import {listWritingDrafts,readWritingDraft,saveWritingDraft} from '/js/reader-writing-storage.js';
import {prepareDsfViewerFixedTextContext,createDsfFixedTextPageElement} from '/js/viewer-fixed-text.js';
import {createReaderWritingRuntime} from '/reader-runtime.mjs';
export {warmWritingRuntime} from '/reader-runtime.mjs';
import {writingSpreadPages,writingTurnTarget,spreadStrokeParts} from '/js/reader-writing-spread.js';
import {installWritingPageGestures} from '/js/reader-writing-page-gestures.js';
import {writingChromeLayout,writingInspectorPlacement,writingTextPan} from '/js/reader-writing-layout.js';
import {writingHitTest} from '/js/reader-writing-hit.js';
import {TEXT_SIZES,TEXT_COLORS,ARROW_HEADS,textSize,stepTextSize} from '/js/reader-writing-format.js';
import {createWritingPageCache,writingPageWindow} from '/js/reader-writing-page-cache.js';
import {installStyleChoices,syncStyleChoices,renderStyleSample} from '/js/reader-writing-style-controls.js';
import {installWritingLocale} from '/js/reader-writing-i18n.js';
import {createWritingContrast} from '/js/reader-writing-contrast.js';

export async function mountReaderWriting(root=document,host=null) {
const $ = id => root.querySelector('#'+id), runtime = await createReaderWritingRuntime();
const body=root.host||document.body,lifetime=new AbortController();
const locale=installWritingLocale(root,{signal:lifetime.signal,onChange:()=>{if(model)updatePanels();if(host&&$('text-dialog').open)positionInlineText();}});
const t=source=>locale.t(source);
const listenWindow=(name,fn)=>window.addEventListener(name,fn,{signal:lifetime.signal});
let noticeTimer,hostView,lastHostLayout,lastChromeLayout,disposed=false,chromeContrast;
let textPan={x:0,y:0};
const toolNames = {select:'選択・移動',pen:'ボールペン',brush:'筆ペン',marker:'サインペン',highlighter:'蛍光マーカー',correction:'修正液',text:'文字',line:'線',arrow:'矢印',rect:'四角',ellipse:'楕円'};
const labels = {text:'文字',stroke:'筆跡',line:'線',shape:'図形'};
let handle,model,baseBytes,language,pageIndex=0,context,busy=false,tool='pen',selected=null,gesture=null,textPlacement,textSerial=0;
let selectionIds=new Set();
const selectionTool=()=>tool==='select';
function selectObjects(ids=[]){selectionIds=new Set(ids);selected=ids.at(-1)||null;}
let draftId,draftVersion=0,saveQueue=Promise.resolve(),generation=0,saveSequence=0,unsaved=false,storageFailed=false,generated;
let savedHead,generatedHead,toolsVisible=true;
function showTools(visible){toolsVisible=visible;body.dataset.toolsVisible=String(visible);if(!visible){closeSheet();hideObjectActions();}else chromeContrast?.invalidate();host?.toolsVisibility?.(visible);}
let families={},originalFaces=[],imageUrls=new Map(),downloadUrl;
const pageCache=createWritingPageCache({load:preparePage,dispose:entry=>{entry.layer.remove();entry.original.remove();
    for(const path of entry.assets){const asset=imageUrls.get(path);if(asset&&!--asset.users){URL.revokeObjectURL(asset.url);imageUrls.delete(path);}}}});
let readingMode=false,snapTarget=null,pageZoom=false;
let spread=false,readerUnits=null,visiblePages=[];
let objectClipboard=null,objectHoldTimer,objectHoldStart;
const readerNonce=new URLSearchParams(location.search).get('reader');
const rtl=()=>handle?.bundle.index.languages[language]?.pageDirection==='rtl';
const spreadIndices=()=>context?writingSpreadPages(pageIndex,context.manifest.pages.length,spread,rtl(),readerUnits):[];
const nextIndex=delta=>writingTurnTarget(pageIndex,context.manifest.pages.length,delta,spread,rtl(),readerUnits);
const otherOriginal=document.createElement('div'),otherLayer=document.createElement('div');otherOriginal.className='rw-other-original';otherLayer.className='rw-other-layer';$('surface').insertBefore(otherOriginal,$('input'));$('surface').insertBefore(otherLayer,$('input'));
const textBoxPreview=document.createElement('div');textBoxPreview.id='text-box-preview';textBoxPreview.hidden=true;$('surface').append(textBoxPreview);
const activeColumn=()=>Math.max(0,visiblePages.indexOf(pageIndex));
const settings=toolDefaults();
settings.group={color:'#20272b',width:penPixels(.5)};
let groupStyleFields=new Set();
settings.geometry.arrow='end';settings.geometry.arrowHead='open';settings.geometry.lineStyle='solid';
settings.text.boxStyle={stroke:null,fill:null,width:penPixels(.3)};
const inputFamilies = {};
const toolIcons={select:'<path d="m5 3 14 10-7 1-3 7Z"/>',text:'<path d="M5 5h14M12 5v15M8 20h8M5 5v3M19 5v3"/>',line:'<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',arrow:'<path d="m4 20 16-16M10 4h10v10"/>',rect:'<rect x="4" y="5" width="16" height="14" rx="1"/>',ellipse:'<ellipse cx="12" cy="12" rx="9" ry="7"/>'};
for (const [id,name] of Object.entries(toolNames)) {
    const pen=PEN_TOOLS.includes(id),b=pen?createPenButton(document,id,name):document.createElement('button');
    if(!pen){b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${toolIcons[id]}</svg><span>${name}</span>`;b.dataset.tool=id;b.title=name;b.setAttribute('aria-label',name);}b.onclick=()=>setTool(id);(pen?$('pen-tray'):$('tools')).append(b);$('quick-tool').add(new Option(name,id));
}
const objectActions=document.createElement('div');objectActions.id='object-actions';objectActions.hidden=true;
objectActions.setAttribute('role','toolbar');objectActions.setAttribute('aria-label','選択した書き込みの操作');
const actionIcons={lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',cut:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 12 12M8 16 12 12m3-3 5-5"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',paste:'<path d="M8 5H4v16h16V5h-4"/><rect x="8" y="2" width="8" height="5" rx="1"/>',duplicate:'<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M8 21h13V8M7 10h6m-3-3v6"/>',delete:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'};
for(const [id,name] of Object.entries({lock:'ロック',settings:'設定',cut:'切り取り',copy:'コピー',paste:'貼り付け',duplicate:'複製',delete:'削除'})){
    const b=document.createElement('button');b.type='button';b.dataset.action=id;b.title=name;b.setAttribute('aria-label',name);
    b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${actionIcons[id]}</svg><span>${name}</span>`;
    b.onclick=()=>objectAction(id);objectActions.append(b);
}
(root===document?document.body:root).append(objectActions);
function clearObjectHold(){clearTimeout(objectHoldTimer);objectHoldStart=null;}
function hideObjectActions(){objectActions.hidden=true;clearObjectHold();}
function showObjectActions(x,y){
    if(busy||!model||model.locked||readingMode||(!selectedObject()&&!objectClipboard))return;
    for(const b of objectActions.children){const o=selectedObject(),action=b.dataset.action;b.disabled=action==='paste'?!objectClipboard:!o||(o.locked&&!['copy','lock'].includes(action));if(action==='lock'){const label=o?.locked?'ロック解除':'ロック';b.title=label;b.setAttribute('aria-label',label);b.querySelector('span').textContent=label;}}
    objectActions.hidden=false;const r=objectActions.getBoundingClientRect(),v=window.visualViewport;
    const left=v?.offsetLeft||0,top=v?.offsetTop||0,w=v?.width||innerWidth,h=v?.height||innerHeight;
    // Keep group actions over the paper, away from Reader's side navigation.
    const paper=$('page-wrap').getBoundingClientRect(),fits=paper.width>=r.width+16;
    const minX=Math.max(left+8,fits?paper.left+8:left+8),maxX=Math.min(left+w-r.width-8,fits?paper.right-r.width-8:left+w-r.width-8);
    objectActions.style.left=`${Math.max(minX,Math.min(x-r.width/2,maxX))}px`;
    objectActions.style.top=`${Math.max(top+8,Math.min(y-r.height-18,top+h-r.height-8))}px`;
}
function armObjectHold(e){
    clearObjectHold();objectHoldStart=[e.clientX,e.clientY];$('input').setPointerCapture(e.pointerId);
    objectHoldTimer=setTimeout(()=>{const position=objectHoldStart;gesture=null;textBoxPreview.hidden=true;snapTarget=null;render();clearObjectHold();if(position)showObjectActions(...position);},550);
}
function objectAction(action){
    if(busy||!model||model.locked||readingMode)return;
    const o=selectedObject(),group=selectedObjects(),ids=new Set(group.map(item=>item.id));hideObjectActions();
    if(action==='lock'&&o){mutate(o.locked?'ロックを解除':'オブジェクトをロック',all=>all.map(item=>ids.has(item.id)?{...item,locked:!o.locked}:item));return;}
    if(o?.locked&&!['copy','paste'].includes(action))return;
    if(action==='settings'&&o){openObjectSettings();return;}
    if(action==='copy'&&o){objectClipboard=structuredClone(group);say('書き込みをコピーしました。ページの長押しから貼り付けできます。');return;}
    if((action==='cut'||action==='delete')&&o){
        if(mutate(action==='cut'?'書き込みを切り取り':'書き込みを削除',all=>all.filter(item=>!ids.has(item.id)||item.locked))){if(action==='cut')objectClipboard=structuredClone(group);selectObjects();render();updatePanels();}return;
    }
    const source=action==='duplicate'?group:action==='paste'?objectClipboard:null;if(!source?.length)return;
    const next=moveWritingSelection(source,12,12).map(item=>({...item,id:writingId(),locked:false}));
    if(mutate(action==='duplicate'?'書き込みを複製':'書き込みを貼り付け',all=>[...all,...next])){selectObjects(next.map(item=>item.id));render();updatePanels();syncStyle(true);}
}
root.addEventListener('pointerdown',e=>{if(!objectActions.contains(e.target))hideObjectActions();},true);
listenWindow('resize',hideObjectActions);lifetime.signal.addEventListener('abort',clearObjectHold,{once:true});
// Move the same controls into a modal sheet on small screens; never duplicate form state.
const mobileMedia=matchMedia('(max-width:760px)'),sheet=$('mobile-sheet');
const layerPanel=document.createElement('aside');layerPanel.className='layer-panel';layerPanel.hidden=true;layerPanel.innerHTML='<p class="subtle">現在のページ · 上ほど手前。原稿本体は最背面に固定されています。</p><div id="layer-list" role="group" aria-label="書き込みの重ね順"></div><div id="layer-order"></div>';(root===document?document.body:root).append(layerPanel);
const layerTrigger=document.createElement('button');layerTrigger.dataset.panel='layers';layerTrigger.textContent='レイヤー';root.querySelector('.mobile-dock').append(layerTrigger);
const panels={layers:layerPanel,settings:root.querySelector('.tools'),history:root.querySelector('.tools'),save:root.querySelector('.save-panel')};
// iOS renders select[size] as a picker, so show real rows in the Reader inspector.
let historyRows;
if(host){
    const label=$('history').closest('label');label.hidden=true;
    historyRows=document.createElement('div');historyRows.id='history-rows';historyRows.setAttribute('role','group');historyRows.setAttribute('aria-label','履歴');label.after(historyRows);
}
let sheetPanel,sheetPlaceholder,styleDraft,sheetAnchor;
const sheetActions=document.createElement('div');sheetActions.id='sheet-actions';sheetActions.hidden=true;
sheetActions.innerHTML='<p id="sheet-action-hint"></p><div id="sheet-style-actions"><button id="sheet-cancel" type="button">キャンセル</button><button id="sheet-apply" class="primary" type="button">適用</button></div><div id="sheet-history-actions"><button id="sheet-undo" type="button" aria-label="元に戻す">↶ 元に戻す</button><button id="sheet-redo" type="button" aria-label="やり直す">↷ やり直す</button></div>';
sheet.append(sheetActions);
function cancelStyleDraft(){if(styleDraft){settings[styleDraft.key]=styleDraft.before;styleDraft=null;syncStyle();render();}}
function restoreSheetPanel(){if(sheetPanel){sheetPlaceholder.replaceWith(sheetPanel);if(sheetPanel===layerPanel)layerPanel.hidden=true;sheetPanel=null;}body.classList.remove('sheet-open');}
function closeSheet(){if(sheet.open){cancelStyleDraft();restoreSheetPanel();sheet.close();}}
sheet.addEventListener('close',()=>{if(sheet.open)return;cancelStyleDraft();restoreSheetPanel();});
// Reader handles wheel events at document level; keep native scrolling in the inspector.
sheet.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
sheet.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeSheet();}e.stopPropagation();});
for(const button of root.querySelectorAll('[data-panel]'))button.onclick=()=>{
    if(sheet.open)closeSheet();
    const name=button.dataset.panel;sheetPanel=panels[name];if(name==='layers'){layerPanel.hidden=false;updateLayersPanel();}sheetPlaceholder=document.createComment('panel');sheetPanel.before(sheetPlaceholder);
    const editing=name==='settings'&&selectedObject()&&(selectionIds.size>1||selectedObject().type!=='text');
    styleDraft=editing?{id:selected,key:styleKey(),before:structuredClone(settings[styleKey()])}:null;
    sheetActions.hidden=!editing&&!['layers','history'].includes(name);$('sheet-style-actions').hidden=!editing;$('sheet-history-actions').hidden=!['layers','history'].includes(name);
    $('sheet-action-hint').textContent=editing?'選択した書き込みの変更を「適用」で確定します。':'';
    $('sheet-body').append(sheetPanel);$('sheet-title').textContent={layers:'レイヤー・重ね順',settings:'色・道具の設定',history:'書き込みと履歴',save:'DSFの保存'}[name];sheet.dataset.panel=name;if(host)sheet.show();else sheet.showModal();body.classList.add('sheet-open');
    if(name==='settings')$('sheet-title').textContent=editing?(selectionIds.size>1?'複数の書き込みの設定':'選択した書き込みの設定'):`${toolNames[tool]}の設定`;
    $('sheet-close').textContent='×';$('sheet-close').setAttribute('aria-label',editing?'変更をキャンセルして閉じる':'パネルを閉じる');
    controls();
    if(host)positionSheet();
    $('sheet-body').scrollTop=0;
};
$('sheet-cancel').onclick=closeSheet;
$('sheet-apply').onclick=()=>{if(applyStyle()){styleDraft=null;closeSheet();}};
$('sheet-undo').onclick=()=>$('undo').click();$('sheet-redo').onclick=()=>$('redo').click();
$('sheet-close').onclick=closeSheet;
sheet.addEventListener('click',e=>{if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientY<r.top||e.clientX<r.left||e.clientX>r.right)closeSheet();}});
const mediaChanged=()=>{if(!host)closeSheet();scale();};mobileMedia.addEventListener('change',mediaChanged);
$('mobile-undo').onclick=()=>$('undo').click();$('mobile-redo').onclick=()=>$('redo').click();
$('page-zoom').onclick=()=>{cancelGesture();pageZoom=!pageZoom;$('viewport').classList.toggle('zoomed',pageZoom);$('page-zoom').textContent=pageZoom?'全体':'拡大';$('page-zoom').setAttribute('aria-label',pageZoom?'ページ全体を表示':'ページを幅いっぱいに拡大');$('page-zoom').setAttribute('aria-pressed',pageZoom);$('zoom-hint').hidden=!pageZoom;scale();};
for(const mm of PEN_WIDTHS){const b=document.createElement('button');b.type='button';b.textContent=`${mm.toFixed(1)} mm`;b.dataset.mm=mm;
    b.onclick=()=>{settings.pen.width=penPixels(mm);syncStyle();};$('pen-sizes').append(b);}
$('mode-read').onclick=()=>setReadingMode(true);$('mode-write').onclick=()=>setReadingMode(false);
$('quick-tool').onchange=()=>setTool($('quick-tool').value);
for (const font of runtime.catalog) for(const id of ['font','text-font'])$(id).add(new Option(font.family,font.id));
// Default text settings and the on-page editor share the same size controls.
for(const id of ['size','text-size']){
    const old=$(id),input=document.createElement('input'),group=document.createElement('span');group.className='text-size-controls';
    input.id=id;input.type='number';input.min='1';input.max='360';input.step='any';input.required=true;input.value=old.value||'20';input.setAttribute('aria-label','文字サイズ');
    old.closest('label').htmlFor=id;old.replaceWith(group);
    const minus=document.createElement('button'),plus=document.createElement('button'),presets=document.createElement('select');
    for(const [b,delta,label] of [[minus,-1,'文字を小さく'],[plus,1,'文字を大きく']]){
        b.type='button';b.textContent=delta<0?'−':'＋';b.setAttribute('aria-label',label);b.onclick=()=>{input.value=stepTextSize(input.value,delta);input.dispatchEvent(new Event('input',{bubbles:true}));};
    }
    presets.id=id+'-presets';presets.setAttribute('aria-label','代表的な文字サイズ');presets.add(new Option('代表サイズ',''));
    for(const size of TEXT_SIZES)presets.add(new Option(String(size),String(size)));
    presets.onchange=()=>{if(presets.value){input.value=presets.value;presets.value='';input.dispatchEvent(new Event('input',{bubbles:true}));}};
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();if(id==='text-size')$('text').focus();}});
    group.append(minus,input,plus,presets);
}
const textColors=document.createElement('div');textColors.id='text-colors';textColors.setAttribute('role','group');textColors.setAttribute('aria-label','文字色');
for(const entry of TEXT_COLORS){const b=document.createElement('button');b.type='button';b.className='text-color-swatch';b.style.setProperty('--swatch',entry.color);b.title=entry.name;b.setAttribute('aria-label',entry.name);
    b.onclick=()=>{$('text-color').value=entry.color;syncTextColors();if(host)void refreshInlineFont();};textColors.append(b);}
const customTextColor=$('text-color').closest('label');customTextColor.firstChild.textContent='その他の色';textColors.append(customTextColor);root.querySelector('#text-dialog .dialog-options').after(textColors);
function syncTextColors(){for(const b of textColors.querySelectorAll('button'))b.setAttribute('aria-pressed',b.style.getPropertyValue('--swatch').toLowerCase()===$('text-color').value.toLowerCase());}
$('text-color').addEventListener('input',()=>{syncTextColors();if(host)void refreshInlineFont();});
const textBoxStyle=document.createElement('fieldset');textBoxStyle.id='text-box-style';
textBoxStyle.innerHTML='<legend>テキストボックス</legend><label><input id="text-border-enabled" type="checkbox">枠線</label><label>枠線の色<input id="text-border-color" type="color" value="#20272b"></label><label>枠線の太さ <span><input id="text-border-width" type="number" min="0.1" max="8" step="0.1" value="0.3"> mm</span></label><label><input id="text-fill-enabled" type="checkbox">塗りつぶし</label><label>塗りつぶしの色<input id="text-fill-color" type="color" value="#ffffff"></label>';
textColors.after(textBoxStyle);
function textFrame(){return {stroke:$('text-border-enabled').checked?$('text-border-color').value:null,fill:$('text-fill-enabled').checked?$('text-fill-color').value:null,width:penPixels(Number($('text-border-width').value))};}
function syncTextFrame(){
    $('text-border-color').disabled=$('text-border-width').disabled=!$('text-border-enabled').checked;$('text-fill-color').disabled=!$('text-fill-enabled').checked;
    if(host)positionInlineText();
}
for(const field of textBoxStyle.querySelectorAll('input'))field.addEventListener('input',()=>{
    if(field.id==='text-border-color')$('text-border-enabled').checked=true;
    if(field.id==='text-fill-color')$('text-fill-enabled').checked=true;
    syncTextFrame();
});
for(const [value,label] of ARROW_HEADS)$('arrow-head').add(new Option(label,value));
installStyleChoices(root,value=>{settings.geometry.arrowHead=value;syncStyle();},value=>{settings.geometry.lineStyle=value;syncStyle();});
for(const id of ['arrow-start','arrow-end','arrow-head'])$(id).onchange=()=>{
    settings.geometry.arrow=$('arrow-start').checked?($('arrow-end').checked?'both':'start'):($('arrow-end').checked?'end':'none');settings.geometry.arrowHead=$('arrow-head').value;
    syncStyle();
};
const page = () => context?.manifest.pages[pageIndex];
const objects = () => model?.objects(language,page()?.id)||[];
const selectedObject=()=>objects().find(o=>o.id===selected);
const selectedObjects=()=>objects().filter(o=>selectionIds.has(o.id));
const styleKey=()=>{if(selectionIds.size>1)return 'group';const o=selectedObject();return o?(o.type==='stroke'?o.tool:o.type==='text'?'text':'geometry'):PEN_TOOLS.includes(tool)?tool:tool==='text'?'text':'geometry';};
function syncStyle(fromSelection=false){
    const o=selectedObject(),key=styleKey(),config=settings[key],group=key==='group';
    if(group&&fromSelection){groupStyleFields.clear();config.color=o.type==='text'?o.runs[0].color:o.color;const ink=selectedObjects().find(item=>item.type!=='text');config.width=ink?(ink.baseWidth??ink.width):penPixels(.5);}
    if(!group&&fromSelection&&o&&o.type!=='text'){config.color=o.color;config.width=o.type==='stroke'?o.baseWidth:o.width;}
    if(fromSelection&&o?.tool==='brush')config.inkAmount=o.inkAmount??.65;
    if(fromSelection&&o?.type==='line'){config.arrow=o.arrow;config.arrowHead=o.arrowHead||'open';}
    if(fromSelection&&['line','shape'].includes(o?.type))config.lineStyle=o.lineStyle||'solid';
    $('ink-control').hidden=key!=='brush';$('ink-amount').value=Math.round((config.inkAmount??.65)*100);$('ink-label').textContent=`${$('ink-amount').value}%`;
    $('style-title').textContent=group?'複数の書き込みの設定':`${key==='geometry'?'線・図形':toolNames[key]}の設定`;
    $('color').value=config.color;$('width').value=penMillimeters(config.width);$('width-label').textContent=penWidthLabel(config.width);
    if(group&&!groupStyleFields.has('width')&&new Set(selectedObjects().filter(item=>item.type!=='text').map(item=>item.baseWidth??item.width)).size>1)$('width-label').textContent=t('混在');
    $('pen-sizes').hidden=key!=='pen';$('width-control').hidden=key==='pen';$('palette').hidden=key==='correction';
    const textStyle=key==='text',shapeStyle=!group&&(o?.type==='shape'||['rect','ellipse'].includes(tool)),lineStyle=!group&&(o?.type==='line'||['line','arrow'].includes(tool));
    for(const id of ['font','size','weight','vertical'])$(id).closest('label').hidden=!textStyle;
    $('square').closest('label').hidden=!shapeStyle;$('snap').closest('label').hidden=!lineStyle;
    $('width-control').hidden=key==='pen'||textStyle||(group&&!selectedObjects().some(item=>item.type!=='text'));$('apply-style').hidden=!o||textStyle;
    const colors=key==='highlighter'?HIGHLIGHTER_COLORS:INK_COLORS;$('palette').replaceChildren();let paletteGroup;
    for(const entry of colors){if(entry.group&&paletteGroup!==entry.group){paletteGroup=entry.group;const title=document.createElement('span');title.className='palette-group';title.textContent=paletteGroup;$('palette').append(title);}
        const b=document.createElement('button');b.type='button';b.className='color-swatch';b.style.setProperty('--swatch',entry.color);b.title=entry.name;b.setAttribute('aria-label',entry.name);b.setAttribute('aria-pressed',entry.color===config.color&&(!group||groupStyleFields.has('color')||selectedObjects().every(item=>item.type==='text'?item.runs.every(run=>run.color===config.color):item.color===config.color)));
        b.onclick=()=>{config.color=entry.color;if(group)groupStyleFields.add('color');syncStyle();};$('palette').append(b);}
    $('color-name').textContent=group&&!groupStyleFields.has('color')&&new Set(selectedObjects().flatMap(item=>item.type==='text'?item.runs.map(run=>run.color):[item.color])).size>1?'色は混在しています':key==='correction'?'不透明の白を重ねます。選択して削除・Undoできます。':`${colors.find(c=>c.color===config.color)?.name||config.color} / ${colors.length}色`;
    for(const b of $('pen-sizes').children)b.setAttribute('aria-pressed',Math.abs(penPixels(Number(b.dataset.mm))-config.width)<.01);
    for(const b of $('pen-tray').children){const c=settings[b.dataset.tool];b.style.setProperty('--ink',c.color);b.style.setProperty('--nib-scale',penTipScale(b.dataset.tool,c.width));const label=b.querySelector('.pen-width');if(label)label.textContent=penWidthLabel(c.width);b.title=`${toolNames[b.dataset.tool]} · ${penWidthLabel(c.width)} mm`;}
    if($('active-tool-label')){
        const name=o?(toolNames[o.tool]||toolNames[o.shape]||labels[o.type]):toolNames[tool];
        const detail=(o?.type==='text'||!o&&tool==='text')?'書体・サイズ':!o&&tool==='select'?'対象を選択':`${penWidthLabel(config.width)} mm`;
        $('active-tool-name').textContent=name;$('active-tool-detail').textContent=detail;
        $('active-tool-label').style.setProperty('--active-ink',config.color);
        $('active-tool-label').setAttribute('aria-label',`${name} · ${detail}${o?'：選択した書き込みの設定':tool==='select'?'':'：設定を開く'}`);
        $('active-tool-label').title=tool==='select'&&!o?'ページ上の書き込みを選択':o?'選択した書き込みの設定':'色・太さなどを調整';
        $('active-tool-label').dataset.configurable=!!o||!selectionTool();
    }
    $('arrow-control').hidden=!lineStyle;$('arrow-start').checked=['start','both'].includes(config.arrow);$('arrow-end').checked=['end','both'].includes(config.arrow);$('arrow-head').value=config.arrowHead||'open';
    $('line-style-control').hidden=!shapeStyle&&!lineStyle;syncStyleChoices(root,config);
    $('selection-hint').textContent=group?'変更した色・太さだけを一括適用します。文字は色のみ変更します。':o?.type==='line'?'両端の点をドラッグして再編集。近くの端点にスナップします。':o?.type==='shape'?'8個のハンドルで再編集。Ctrlで正方形・正円。':key==='brush'?'動きの速さと向きで起筆・送筆・収筆を疑似表現します。':'';
    $('style-preview').hidden=key==='text';
    if(key!=='text')renderStyleSample($('style-preview'),{key:group?'geometry':key,tool,object:group?null:o,config:group?{color:config.color,width:config.width,arrow:'none'}:config});
    controls();
}
function setReadingMode(value){if(!model||busy||model.locked&&!value)return;cancelGesture();readingMode=value;selectObjects();render();if(model)updatePanels();syncStyle();updateHint();}
function updateHint(){
    $('hint').textContent=readingMode?'閲覧モード：書き込みは表示したまま、描画を停止しています。':tool==='select'?'書き込みを押して選択。空いている場所からドラッグしてまとめて選択できます。':tool==='text'?'文字を置く位置をページ上でクリックしてください。':tool==='correction'?'白い修正液を重ねます。原本を消す操作ではありません。':tool==='brush'?'ゆっくり、速く、方向を変えて。入りと抜きのある筆跡を試してください。':'ペン先を選んでドラッグ。線は端点へスナップ、Ctrlで正方形・正円になります。';
    $('hint').textContent+=' ページめくりは前後ボタン・矢印キー、書き込み中は2本指、閲覧中は1本指スワイプ。';
}
const say = (message,error=false) => {$('status').textContent=message;$('status').dataset.error=error;clearTimeout(noticeTimer);$('status').dataset.notice=true;noticeTimer=setTimeout(()=>$('status').dataset.notice=false,3500);};
function explain(e) {
    const messages = {TEXT_LENGTH:'文字を1〜2,000文字で入力してください。',TEXT_OVERFLOW:host?'文字が枠に収まりません。右下のハンドルで枠を広げるか、文字サイズを小さくしてください。':'ページ内に収まりません。文字を短くするか、サイズ・配置位置を変更してください。',
        FONT_GLYPH_MISSING:'この書体に含まれない文字があります。文字または書体を変更してください。',
        INPUT_FONT_UNAVAILABLE:'入力用書体を取得できません。オンラインで「オフライン準備」を実行してから入力してください。',
        DRAFT_CONFLICT:'別のタブで下書きが更新されました。このタブの変更はDSFに書き出して保管してください。',
        DRAFT_STORAGE_FAILED:'端末内に保存できませんでした。画面を閉じる前にDSFへ書き出してください。',
        DRAFT_UPGRADE_BLOCKED:'以前のWriting画面が開いています。必要な内容をDSFに保存してから、その画面を閉じて再試行してください。',
        DRAFT_UNSAVED:'未保存の下書きがあります。先にDSFを作成して保管してください。',
        DSF3_REQUIRED:'このDSFは今回の読込対象外の形式です。形式2またはWriting形式3のDSFを選んでください。元のファイルは変更していません。',
        WRITING_IMPORT_FONT:'このDSFの原本書体は、Writing形式へのコピーにまだ対応していません。元のファイルは変更していません。',
        DSF_PROJECT:'これは編集用DSPの構造です。Writingでは配信用DSFを開いてください。',
        WRITING_OBJECT_LOCKED:'このオブジェクトはロックされています。レイヤーで解除してください。',WRITING_LIMIT:'試作版の履歴・データ上限です。現在の内容は保持しています。',DSF3_SHARED_LOCKED:'共有用DSFは書き込みがロックされています。'};
    return messages[e.message]||`処理できませんでした（${e.message}）。現在の内容は保持しています。`;
}
function clearGenerated() {
    generated=null;if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=null;
    $('download').hidden=$('reopen').hidden=true;$('file-status').textContent='';$('receipt').textContent='';$('record').disabled=true;
}
function controls() {
    const locked=!model||model.locked||busy,editLocked=locked||readingMode;
    $('tool-field').disabled=locked;$('style-field').disabled=editLocked||!!selectedObject()?.locked;
    for(const b of root.querySelectorAll('[data-tool]')){b.disabled=locked;b.setAttribute('aria-pressed',!readingMode&&b.dataset.tool===tool);}
    $('pen-tray').classList.toggle('is-reading',readingMode);
    $('mode-read').disabled=!model||busy;$('mode-write').disabled=locked;
    $('mode-read').setAttribute('aria-pressed',readingMode);$('mode-write').setAttribute('aria-pressed',!readingMode);
    $('quick-tool').disabled=locked;$('quick-tool').value=tool;
    $('undo').disabled=editLocked||!model?.parent;$('redo').disabled=editLocked||!model?.children.length;
    $('mobile-undo').disabled=$('undo').disabled;$('mobile-redo').disabled=$('redo').disabled;
    if($('native-undo')){$('native-undo').disabled=$('undo').disabled;$('native-redo').disabled=$('redo').disabled;}
    if($('active-tool-label'))$('active-tool-label').disabled=editLocked||!!selectedObject()?.locked||tool==='select'&&!selectedObject();
    $('sheet-undo').disabled=$('undo').disabled;$('sheet-redo').disabled=$('redo').disabled;
    $('delete').disabled=editLocked||!selected||!!selectedObject()?.locked;$('edit-text').disabled=selectionIds.size>1||editLocked||selectedObject()?.type!=='text'||!!selectedObject()?.locked;
    $('apply-style').disabled=editLocked||!selected||(selectionIds.size===1&&selectedObject()?.type==='text')||!!selectedObject()?.locked||(selectionIds.size>1&&!groupStyleFields.size);
    $('sheet-apply').disabled=$('apply-style').disabled;
    $('restore').disabled=editLocked;$('history').disabled=editLocked;$('objects').disabled=editLocked;
    for(const id of ['save','share'])$(id).disabled=locked;
    $('sample').disabled=$('file').disabled=$('prepare').disabled=busy;
    $('resume').disabled=busy||!$('drafts').value;$('reopen').disabled=busy||!generated;$('record').disabled=busy||!generated;
    $('prev').disabled=busy||!page()||nextIndex(-1)===pageIndex;$('next').disabled=busy||!page()||nextIndex(1)===pageIndex;
    $('spread').disabled=busy||!page();$('spread').setAttribute('aria-pressed',spread);
    $('prev').textContent=rtl()?'→':'←';$('next').textContent=rtl()?'←':'→';
    $('language').disabled=busy||!model;$('input').dataset.reading=readingMode||locked;
}
async function task(name,fn) {
    if(busy)return;busy=true;controls();say(`${name}…`);
    try {await fn();say(`${name}が完了しました。`);}catch(e){say(explain(e),true);console.error(e);}
    finally {runtime.dispose();busy=false;controls();}
}
async function refreshDrafts() {
    const current=$('drafts').value,list=await listWritingDrafts();$('drafts').replaceChildren();
    for(const d of list)$('drafts').add(new Option(`${d.title} · ${new Date(d.updatedAt).toLocaleString('ja-JP')}`,d.id));
    if(list.some(d=>d.id===current))$('drafts').value=current;controls();
}
function persist() {
    if(!model||model.locked)return;
    const captured={id:draftId,title:handle.meta.title||'DSF',bytes:baseBytes,...model.takeDraftUpdate(draftVersion===0),language,pageIndex},epoch=generation,sequence=++saveSequence;
    unsaved=true;$('draft-status').textContent='端末内の下書きに保存中…';
    saveQueue=saveQueue.then(async()=>{
        if(epoch!==generation)return;
        if(storageFailed)throw new Error('DRAFT_CONFLICT');
        draftVersion=await saveWritingDraft(captured,draftVersion);
        if(epoch===generation&&sequence===saveSequence){unsaved=false;$('draft-status').textContent='この端末に下書き保存済み · DSFへの書き出しは別操作です。';$('draft-status').dataset.error=false;await refreshDrafts();}
    }).catch(e=>{if(epoch===generation){storageFailed=true;unsaved=true;$('draft-status').textContent=explain(e);$('draft-status').dataset.error=true;}});
}
function openObjectSettings(){
    const o=selectedObject();if(!o||o.locked)return;closeSheet();syncStyle(true);
    // A settings sheet opened from Layers must not retain its bottom history
    // button as the anchor when the window switches to a narrow layout.
    if(host)sheetAnchor=$('active-tool-label');
    if(o.type==='text'&&selectionIds.size===1)textDialog({x:o.layout[0].x,y:o.layout[0].y},o);
    else root.querySelector('[data-panel="settings"]').click();
}
for(const [direction,label] of Object.entries({front:'最前面',up:'一つ手前',down:'一つ奥',back:'最背面',settings:'設定'})){
    const b=document.createElement('button');b.type='button';b.dataset.order=direction;b.textContent=label;
    b.onclick=()=>{if(direction==='settings'){openObjectSettings();return;}if(!selectedObject()||selectedObject().locked||model.locked||busy)return;mutate('重ね順を変更',all=>reorderWritingObject(all,selected,direction));};$('layer-order').append(b);
}
let layerDrag=null;
function cancelLayerDrag(){
    if(!layerDrag)return;const d=layerDrag;layerDrag=null;cancelAnimationFrame(d.frame);d.row.classList.remove('dragging');
    for(const row of $('layer-list').children)row.classList.remove('drop-before','drop-after');
    if(d.grip.hasPointerCapture(d.pointer))d.grip.releasePointerCapture(d.pointer);
}
function startLayerDrag(e,row,grip,id){
    if(e.button!==0||busy||model.locked||objects().find(o=>o.id===id)?.locked)return;e.preventDefault();cancelLayerDrag();grip.setPointerCapture(e.pointerId);
    layerDrag={row,grip,id,pointer:e.pointerId,startY:e.clientY,y:e.clientY,x:e.clientX,moved:false,index:0};
    const update=()=>{const d=layerDrag;if(!d)return;
        if(d.moved){const list=$('layer-list'),scroll=host&&sheet.open?$('sheet-body'):list,r=scroll.getBoundingClientRect();
            if(d.y<r.top+28)scroll.scrollTop-=8;else if(d.y>r.bottom-28)scroll.scrollTop+=8;
            const rows=[...list.children].filter(el=>el!==row&&el.classList.contains('layer-row'));
            let index=rows.findIndex(el=>d.y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);if(index<0)index=rows.length;d.index=index;
            for(const el of list.children)el.classList.remove('drop-before','drop-after');
            if(rows[index])rows[index].classList.add('drop-before');else rows.at(-1)?.classList.add('drop-after');
        }d.frame=requestAnimationFrame(update);
    };
    grip.onpointermove=event=>{const d=layerDrag;if(!d||d.pointer!==event.pointerId)return;d.y=event.clientY;d.x=event.clientX;if(Math.abs(d.y-d.startY)>5){d.moved=true;row.classList.add('dragging');}};
    grip.onpointerup=event=>{const d=layerDrag;if(!d||d.pointer!==event.pointerId)return;const r=$('layer-list').getBoundingClientRect(),index=d.index,id=d.id;
        const commit=d.moved&&d.y>=r.top-20&&d.y<=r.bottom+20&&d.x>=r.left&&d.x<=r.right;cancelLayerDrag();
        if(commit){const to=objects().length-1-index;if(objects().findIndex(o=>o.id===id)===to)return;selectObjects([id]);tool='select';readingMode=false;mutate('ドラッグで重ね順を変更',all=>reorderWritingObjectAt(all,id,to));}
    };
    grip.onpointercancel=cancelLayerDrag;grip.onlostpointercapture=cancelLayerDrag;update();
}
lifetime.signal.addEventListener('abort',cancelLayerDrag,{once:true});sheet.addEventListener('close',cancelLayerDrag);
function updateLayersPanel(){
    if(layerPanel.hidden)return;
    const all=objects();$('layer-list').replaceChildren();
    if(!all.length){const empty=document.createElement('p');empty.textContent='このページに書き込みはありません。';$('layer-list').append(empty);}
    for(const [i,o] of [...all].reverse().entries()){
        const row=document.createElement('div');row.className='layer-row';row.dataset.object=o.id;
        const b=document.createElement('button');b.type='button';b.className='layer-select';b.dataset.object=o.id;b.setAttribute('aria-pressed',o.id===selected);
        const title=`${i+1}. ${o.type==='text'?o.text.slice(0,24):t(toolNames[o.tool]||({rect:'四角',ellipse:'楕円'}[o.shape])||labels[o.type])}`;b.setAttribute('aria-label',title);
        const thumb=document.createElement('span');thumb.className='layer-thumb';thumb.setAttribute('aria-hidden','true');
        const stage=document.createElement('span');stage.className='layer-thumb-stage';renderWritingLayer(stage,[o],{...families,...inputFamilies});
        const [x,y,w,h]=writingBounds(o),zoom=Math.min(58/Math.max(1,w+8),46/Math.max(1,h+8));stage.style.transform=`matrix(${zoom},0,0,${zoom},${(66-w*zoom)/2-x*zoom},${(54-h*zoom)/2-y*zoom})`;thumb.append(stage);
        const label=document.createElement('span');label.textContent=title;b.append(thumb,label);
        b.onclick=()=>{if(busy)return;cancelGesture();selectObjects([o.id]);tool='select';readingMode=model.locked;render();updatePanels();syncStyle(true);};
        const grip=document.createElement('button');grip.type='button';grip.className='layer-grip';grip.textContent='⠿';grip.dataset.writingUserLabel='true';grip.title=t('ドラッグして重ね順を変更。上下キーでも移動できます。');grip.setAttribute('aria-label',locale.language==='en'?`Drag to reorder ${title}`:`${title}の重ね順をドラッグ`);grip.disabled=busy||model.locked||o.locked===true;
        grip.onkeydown=e=>{if(!['ArrowUp','ArrowDown'].includes(e.key)||busy||model.locked||o.locked)return;e.preventDefault();selectObjects([o.id]);mutate('重ね順を変更',items=>reorderWritingObject(items,o.id,e.key==='ArrowUp'?'up':'down'));$('layer-list').querySelector(`[data-object="${o.id}"] .layer-grip`)?.focus();};
        grip.onpointerdown=e=>startLayerDrag(e,row,grip,o.id);const rowActions=document.createElement('span');rowActions.className='layer-row-actions';
        for(const action of ['lock','delete']){
            const control=document.createElement('button');control.type='button';control.className=`layer-${action}`;
            const label=t(action==='lock'?(o.locked?'ロック解除':'ロック'):'削除');control.dataset.writingUserLabel='true';control.title=label;control.setAttribute('aria-label',locale.language==='en'?`${label} ${title}`:`${title}を${label}`);
            if(action==='lock')control.setAttribute('aria-pressed',!!o.locked);
            control.innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${actionIcons[action]}</svg>`;
            control.disabled=busy||model.locked||(action==='delete'&&!!o.locked);
            control.onclick=()=>{if(busy||model.locked)return;cancelGesture();selectObjects([o.id]);tool='select';readingMode=false;objectAction(action);};rowActions.append(control);
        }
        row.dataset.locked=!!o.locked;row.append(b,rowActions,grip);$('layer-list').append(row);
    }
    const index=all.findIndex(o=>o.id===selected);
    for(const b of $('layer-order').children)b.disabled=busy||!model||model.locked||index<0||all[index]?.locked||(['front','up'].includes(b.dataset.order)&&index===all.length-1)||(['back','down'].includes(b.dataset.order)&&index===0);
}
function updatePanels() {
    updateLayersPanel();
    const all=objects(),current=model.head;$('objects').replaceChildren(new Option(t('— 選択なし —'),''));
    for(const [i,o] of all.entries())$('objects').add(new Option(`${i+1}. ${o.type==='text'?o.text.slice(0,18):t(toolNames[o.tool]||labels[o.type])}`,o.id));
    $('objects').value=selected||'';$('history').replaceChildren();
    const revisions=model.revisions;
    for(const [i,r] of revisions.entries()){
        const pages=r.pages.map(p=>p.language===language?context.manifest.pages.findIndex(page=>page.id===p.pageId)+1:`${p.language}:${p.pageId}`).join('・');
        $('history').add(new Option(`${i?`${i}. ${t(r.operation)}`:t('開始時点')}${pages?(locale.language==='en'?` (p. ${pages})`:`（${pages}ページ）`):''}${r.id===current?' — '+t('現在'):''}`,r.id));
    }
    $('history').value=current||'';
    if(historyRows){
        historyRows.replaceChildren();
        for(const option of [...$('history').options].reverse()){
            const row=document.createElement('button');row.type='button';row.dataset.revision=option.value;row.dataset.writingUserLabel='true';row.textContent=option.textContent;
            row.setAttribute('aria-pressed',option.value===current);if(option.value===current)row.setAttribute('aria-current','step');row.disabled=busy||model.locked;
            row.onclick=()=>{$('history').value=option.value;for(const b of historyRows.children)b.setAttribute('aria-pressed',b===row);};historyRows.append(row);
        }
    }
    $('history-count').textContent=model.locked?'共有用：履歴なし・編集ロック':`本全体で直近 ${Math.max(0,revisions.length-1)} / 30 操作。戻った後に編集すると、やり直しの履歴は消えます。古い履歴を整理しても書き込みは残ります。`;
    $('page-summary').textContent=`${page()?.pageLabel||pageIndex+1} ページ · 書き込み ${all.length} 件`;
    $('evidence').textContent=JSON.stringify({baseHash:handle.baseHash,copyKind:handle.copyKind,writingObjects:all.length,historyOperations:Math.max(0,revisions.length-1),historyLimit:30,pageCache:pageCache.keys,head:current},null,2);controls();
}
function render(objectsOverride) {
    if(!model||!page())return;
    const current=pageCache.get(pageIndex);renderWritingLayer(current.layer,objectsOverride||model.pageObjects(language,page().id),{...families,...inputFamilies},selectionTool()&&!$('text-dialog').open?selectionIds:null);$('layer').replaceChildren(current.layer);
    if(host&&$('text-dialog').open&&textPlacement?.existing)for(const el of current.layer.children)if(el.dataset.objectId===textPlacement.existing.id)el.style.visibility='hidden';
    const other=visiblePages.find(i=>i!==pageIndex);otherLayer.replaceChildren();
    if(other!==undefined){const entry=pageCache.get(other);renderWritingLayer(entry.layer,model.pageObjects(language,context.manifest.pages[other].id),{...families,...inputFamilies});otherLayer.append(entry.layer);}
    if(snapTarget){const ring=document.createElement('span');ring.className='rw-snap';ring.style.left=`${snapTarget.x}px`;ring.style.top=`${snapTarget.y}px`;$('layer').append(ring);}}
function changed(message) {hideObjectActions();clearGenerated();render();updatePanels();syncStyle();persist();say(message);host?.changed();}
function mutate(message,transform) {try {model.change(language,page().id,message,transform);changed(message);return true;}catch(e){say(explain(e),true);render();return false;}}
function setTool(next) {if(sheet.open)closeSheet();hideObjectActions();if(gesture)cancelGesture();if(next!==tool&&['line','arrow'].includes(next))settings.geometry.arrow=next==='arrow'?'end':'none';tool=next;readingMode=!!model?.locked;selectObjects();render();if(model)updatePanels();else controls();syncStyle();updateHint();}
function scale() {if(host){layoutHost();return;}const columns=Math.max(1,visiblePages.length),size=Math.min(360,$('viewport').clientWidth/columns,...((mobileMedia.matches||readerNonce)&&!pageZoom?[Math.max(1,$('viewport').clientHeight-4)*360/640]:[]));$('page-wrap').style.width=`${size*columns}px`;$('page-wrap').style.height=`${640*size/360}px`;$('surface').style.width=`${360*columns}px`;$('surface').style.transform=`scale(${size/360})`;}
const resizeObserver=new ResizeObserver(scale);if(!host)resizeObserver.observe($('viewport'));
async function contextFor(next,lang,fontFamilies) {
    // The native Reader already owns the original fonts and page renderer.
    // loadDsfV3 has validated this bundle; Writing only needs its page index here.
    if(host)return {manifest:next.bundle.manifests[lang]};
    const bundle=next.bundle,certificates={};for(const [id,d] of Object.entries(bundle.index.fonts)){d.family=fontFamilies[id];certificates[id]={...d};}
    return prepareDsfViewerFixedTextContext({bundle,language:lang,certifiedFonts:certificates,fontFaceSet:document.fonts});
}
function assetUrl(href,assets) {const path=href.replace(/^\.\.\//,'');if(!imageUrls.has(path))imageUrls.set(path,{url:URL.createObjectURL(new Blob([handle.readBytes(path)],{type:'image/webp'})),users:0});
    const asset=imageUrls.get(path);if(!assets.has(path)){assets.add(path);asset.users++;}return asset.url;}
function preparePage(index){
    const p=context.manifest.pages[index],original=document.createElement('div'),layer=document.createElement('div'),assets=new Set();
    Object.assign(original.style,{position:'absolute',inset:'0'});
    // Native Reader already renders the original page. Do not duplicate its text/image DOM.
    if(!host){if(p.renderKind==='fixedText')original.append(createDsfFixedTextPageElement({documentRef:document,page:p,context,resolveAssetHref:href=>assetUrl(href,assets)}));
        else {const img=document.createElement('img');img.src=assetUrl(p.image.href,assets);img.alt=`${p.pageLabel} ページ`;img.draggable=false;Object.assign(img.style,{width:'100%',height:'100%'});original.append(img);}
        for(const image of original.querySelectorAll('img'))image.decode?.().catch(()=>{});
    }
    renderWritingLayer(layer,model.pageObjects(language,p.id),{...families,...inputFamilies});return {original,layer,assets};
}
function showPage() {
    hideObjectActions();gesture=null;selectObjects();visiblePages=hostView?.pages.map(p=>p.index)||spreadIndices();otherOriginal.replaceChildren();
    pageCache.window(visiblePages,writingPageWindow(visiblePages,context.manifest.pages.length));
    for(const [column,index] of visiblePages.entries()){
        const p=context.manifest.pages[index],original=index===pageIndex?$('original'):otherOriginal,layer=index===pageIndex?$('layer'):otherLayer;
        original.replaceChildren();original.style.left=layer.style.left=`${column*360}px`;
        if(!host)original.append(pageCache.get(index).original);
    }
    otherOriginal.hidden=otherLayer.hidden=visiblePages.length<2;
    $('page-label').textContent=`${visiblePages.map(i=>i+1).join('–')} / ${context.manifest.pages.length}`;render();updatePanels();syncStyle();scale();
}
async function openBytes(bytes,draft) {
    await saveQueue;
    if(unsaved&&!generated)throw new Error('DRAFT_UNSAVED');
    const kind=writingArchiveKind(bytes);let imported;
    if(kind==='project')throw new Error('DSF_PROJECT');
    if(kind==='existing-dsf'){
        say('既存DSFを検証してWriting用コピーを準備しています…');
        const {importWritingV2}=await import('/legacy-import.mjs');imported=await importWritingV2(bytes,runtime.options);bytes=imported.bytes;
    }
    const next=await loadDsfV3(bytes,runtime.options),nextModel=createReaderWritingModel(next,runtime.catalog.map(c=>c.id),draft?.envelope);
    const loaded=[],fontFamilies={},originalFamilies={};
    try {
        for(const area of host?['writing']:['original','writing'])for(const r of next.resources[area]?.fonts||[]){
            const family=`RW_${area}_${r.sha256}`,face=await new FontFace(family,next.readBytes(r.path),{weight:'100 900'}).load();document.fonts.add(face);loaded.push(face);
            (area==='original'?originalFamilies:fontFamilies)[r.sourceFontId]=family;
        }
        // Reuse embedded history subsets. Only an unexported draft with new glyphs needs its input font.
        if(draft)for(const [id,text] of Object.entries(writingFontText(nextModel.envelope))){
            const resource=next.resources.writing?.fonts.find(r=>r.sourceFontId===id);let covered=false;
            if(resource)try{await runtime.options.engine.verify(next.readBytes(resource.path),text,runtime.catalog.find(c=>c.id===id),false);covered=true;}catch(e){if(e.message!=='FONT_GLYPH_MISSING')throw e;}
            if(!covered)inputFamilies[id]=await runtime.inputFamily(id);
        }
        const lang=draft?.language&&next.bundle.manifests[draft.language]?draft.language:next.bundle.index.defaultLang;
        const nextContext=await contextFor(next,lang,originalFamilies);
        originalFaces.forEach(f=>document.fonts.delete(f));originalFaces=loaded;pageCache.clear();
        objectClipboard=null;handle=next;model=nextModel;baseBytes=bytes;families=fontFamilies;context=nextContext;language=lang;pageIndex=Math.min(draft?.pageIndex||0,context.manifest.pages.length-1);
        generation++;storageFailed=false;draftId=draft?.id||writingId();draftVersion=draft?.version||0;unsaved=false;
        savedHead=nextModel.head;
        $('title').textContent=next.meta.title||'DSF';$('kind').textContent=model.locked?'共有用 · 書き込みロック':'Writing · 原本を保護';
        $('language').replaceChildren();for(const lang of Object.keys(next.bundle.manifests))$('language').add(new Option(lang,lang));$('language').value=language;
        clearGenerated();showPage();setTool('pen');
        $('import-status').hidden=!imported;$('import-status').textContent=imported?'既存DSFからWriting用コピーを開きました。元のファイルは変更されません。保存は形式3になります。':'';
        $('draft-status').dataset.error=false;$('draft-status').textContent=model.locked?'共有用DSFを表示中。編集・下書き保存は行いません。':'下書きを開きました。';
        if(!model.locked)persist();
    }catch(e){loaded.forEach(f=>document.fonts.delete(f));throw e;}
}
$('sample').onclick=()=>task('サンプル読込',async()=>{const r=await fetch('/sample.dsfr');if(!r.ok)throw new Error('SAMPLE_LOAD');await openBytes(new Uint8Array(await r.arrayBuffer()));});
$('file').onchange=()=>task('DSF読込',async()=>{const f=$('file').files[0];try{if(f){if(f.size>257*1024*1024)throw new Error('ZIP_LIMIT');await openBytes(new Uint8Array(await f.arrayBuffer()));}}finally{$('file').value='';}});
$('resume').onclick=()=>task('下書き復元',async()=>{const d=await readWritingDraft($('drafts').value);if(!d)throw new Error('DRAFT_MISSING');await openBytes(d.bytes,d);});
$('prepare').onclick=()=>task('オフライン準備',async()=>{await runtime.prepareOffline();$('offline-status').textContent=host?'入力用2書体をこの端末に保存しました。Reader画面のオフライン起動は引き続き検証中です。':'画面と入力用2書体の準備が完了しました。この端末で通信を切って書き込み・保存を試せます。';});
$('language').onchange=()=>task('言語切替',async()=>{cancelGesture();readerUnits=null;const lang=$('language').value,orig={};for(const f of handle.resources.original.fonts)orig[f.sourceFontId]=`RW_original_${f.sha256}`;
    const next=await contextFor(handle,lang,orig);pageCache.clear();language=lang;context=next;pageIndex=0;showPage();});
function turn(delta){if(host){if($('text-dialog').open){void commitText().then(ok=>{if(ok)host.turn(delta);});return;}cancelGesture();host.turn(delta);return;}if(busy||!context||$('text-dialog').open)return;cancelGesture();pageIndex=nextIndex(delta);showPage();persist();}
installWritingPageGestures($('input'),{isReading:()=>readingMode,cancelStroke:cancelGesture,turn,isRtl:rtl});
$('prev').onclick=()=>turn(-1);$('next').onclick=()=>turn(1);
$('spread').onclick=()=>{cancelGesture();spread=!spread;showPage();};
listenWindow('keydown',e=>{if(!context||busy||e.ctrlKey||e.metaKey||e.altKey||e.composedPath().some(n=>n.matches?.('input,textarea,select,dialog')))return;
    if(!host&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();turn((e.key==='ArrowRight'?1:-1)*(rtl()?-1:1));}});
$('width').oninput=()=>{settings[styleKey()].width=penPixels(Number($('width').value));if(selectionIds.size>1)groupStyleFields.add('width');syncStyle();};
$('ink-amount').oninput=()=>{settings.brush.inkAmount=Number($('ink-amount').value)/100;syncStyle();};
$('objects').onchange=()=>{selectObjects($('objects').value?[$('objects').value]:[]);tool='select';readingMode=false;render();syncStyle(true);updateHint();};
function applyStyle(){
    if(selectionIds.size>1){const patch=Object.fromEntries([...groupStyleFields].map(key=>[key,settings.group[key]]));return mutate('道具の設定を変更',all=>styleWritingSelection(all,selectionIds,patch));}
    const o=selectedObject();if(selectionIds.size!==1||!o||o.locked||o.type==='text')return false;const config=settings[styleKey()],next=structuredClone(o);next.color=config.color;
    if(o.type==='stroke'){const factor=config.width/o.baseWidth;next.baseWidth=config.width;next.points.forEach(p=>p.width*=factor);}
    else next.width=config.width;if(o.type==='line'){next.arrow=config.arrow;next.arrowHead=config.arrowHead;}
    if(['line','shape'].includes(o.type))next.lineStyle=config.lineStyle||'solid';
    if(o.tool==='brush'){next.geometryVersion=4;next.inkAmount=config.inkAmount;let distance=0;next.points.forEach((p,i)=>{if(i)distance+=Math.hypot(p.x-next.points[i-1].x,p.y-next.points[i-1].y);p.dryness??=brushDryness(distance);});}
    return mutate('道具の設定を変更',all=>all.map(item=>item.id===o.id?next:item));}
$('apply-style').onclick=applyStyle;
async function restore(id) {if(!id||busy)return;try{
    cancelGesture();const target=model.restore(id);selectObjects();
    if(target){
        if(language!==target.language){const orig={};for(const f of handle.resources.original.fonts)orig[f.sourceFontId]=`RW_original_${f.sha256}`;
            pageCache.clear();language=target.language;context=await contextFor(handle,language,orig);$('language').value=language;}
        const index=context.manifest.pages.findIndex(p=>p.id===target.pageId);
        if(host){host.goTo?.(index,language);await syncHost(host.view());}
        else {pageIndex=index;showPage();}
    }
    changed('履歴を復元しました。');
}catch(e){say(explain(e),true);}}
$('undo').onclick=()=>restore(model.parent);$('redo').onclick=()=>restore(model.children.at(-1).id);$('restore').onclick=()=>restore($('history').value);
$('delete').onclick=()=>objectAction('delete');
$('edit-text').onclick=()=>{const o=objects().find(o=>o.id===selected);if(o?.type==='text')textDialog({x:o.layout[0].x,y:o.layout[0].y},o);};
function point(event,global=false) {const r=$('surface').getBoundingClientRect(),width=360*Math.max(1,visiblePages.length),x=(event.clientX-r.left)*width/r.width;
    return {x:Math.max(0,Math.min(global?width:360,x-(global?0:activeColumn()*360))),y:Math.max(0,Math.min(640,(event.clientY-r.top)*640/r.height))};}
function strokeParts(o){return spreadStrokeParts(o,visiblePages,context.manifest.pages.map(p=>p.id),writingId);}
function renderSpreadStroke(o){render();for(const part of strokeParts(o)){
    const layer=part.pageId===page().id?$('layer'):otherLayer;renderWritingLayer(layer,[...model.objects(language,part.pageId),part.object],{...families,...inputFamilies});}}
function hit(p) {const screenScale=$('surface').getBoundingClientRect().height/640;return objects().reverse().find(o=>writingHitTest(o,p,6/Math.max(.25,screenScale)));}
function penPoint(p,e,width) {const pressure=e.pointerType==='pen'?Math.max(.02,e.pressure):.5;return {...p,pressure,width};}
function rawBrushPoint(p,e){return {...p,pressure:e.pointerType==='pen'?Math.max(.05,e.pressure):.5,pen:e.pointerType==='pen',time:e.timeStamp};}
function snapped(p,exclude){if(!$('snap').checked){snapTarget=null;return p;}const result=snapWritingPoint(p,objects(),exclude);snapTarget=result.target;return result.point;}
function previewGesture(e) {
    if(!gesture)return;let p=point(e,!!gesture.cross);const g=gesture,square=e.ctrlKey||$('square').checked;snapTarget=null;
    if(['text-box','marquee'].includes(g.mode)){g.box=constrainedRect(g.start,p);const [x,y,w,h]=g.box;Object.assign(textBoxPreview.style,{left:`${x+activeColumn()*360}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});return;}
    if(g.mode==='group-move'){
        g.objects=moveWritingSelection(g.originals,p.x-g.start.x,p.y-g.start.y);g.moved=Math.abs(p.x-g.start.x)+Math.abs(p.y-g.start.y)>1;
        const replacements=new Map(g.objects.map(o=>[o.id,o]));render(objects().map(o=>replacements.get(o.id)||o));return;
    }
    if(g.mode==='handle'){
        if(g.original.type==='line')p=snapped(p,g.original.id);
        g.object=editWritingPoint(g.original,g.key,p,square);g.moved=true;
        render(objects().map(o=>o.id===g.object.id?g.object:o));return;
    }
    if(g.mode==='move') {const [x,y,w,h]=writingBounds(g.original),dx=Math.max(-x,Math.min(360-x-w,p.x-g.start.x)),dy=Math.max(-y,Math.min(640-y-h,p.y-g.start.y));
        g.object=moveWritingObject(g.original,dx,dy);
        if(g.object.type==='line')for(const key of ['from','to']){const endpoint={x:g.object[key][0],y:g.object[key][1]},s=snapped(endpoint,g.object.id);if(snapTarget){g.object=moveWritingObject(g.object,s.x-endpoint.x,s.y-endpoint.y);break;}}
        g.moved=Math.abs(dx)+Math.abs(dy)>1;render(objects().map(o=>o.id===g.object.id?g.object:o));return;}
    if(g.object.type==='stroke') {
        if(g.raw){const last=g.raw.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>.35&&g.raw.length<2000)g.raw.push(rawBrushPoint(p,e));g.object.points=brushGeometry(g.raw,g.object.baseWidth,false,true);}
        else {const last=g.object.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)>.5&&g.object.points.length<10000)g.object.points.push(penPoint(p,e,g.object.baseWidth));}
    }
    else if(g.object.type==='line'){p=snapped(p,g.object.id);g.object.to=[p.x,p.y];}
    else g.object.rect=constrainedRect(g.start,p,square);
    if(g.cross)renderSpreadStroke(g.object);else render([...objects(),g.object]);
}
function cancelGesture() {hideObjectActions();gesture=null;snapTarget=null;textBoxPreview.hidden=true;render();}
$('input').onpointerdown=e=>{
    if(host&&$('text-dialog').open){e.preventDefault();return;}
    if(gesture){if(e.pointerId!==gesture.pointerId)cancelGesture();return;}
    if(busy||!model||model.locked||readingMode||!e.isPrimary||e.button!==0)return;e.preventDefault();if(host&&!selectionTool())showTools(false);$('input').focus({preventScroll:true});
    const column=Math.min(visiblePages.length-1,Math.floor(point(e,true).x/360));if(visiblePages[column]!==pageIndex){pageIndex=visiblePages[column];showPage();}
    const cross=PEN_TOOLS.includes(tool)&&visiblePages.length===2;let p=point(e,cross);
    if(tool==='text'){
        const text=hit(p);if(text?.type==='text'){textDialog(p,text);return;}
        if(!host){textDialog(p);return;}
        gesture={pointerId:e.pointerId,mode:'text-box',start:p,box:[p.x,p.y,1,1]};textBoxPreview.hidden=false;previewGesture(e);$('input').setPointerCapture(e.pointerId);return;
    }
    const existing=selectedObject(),knob=selectionTool()&&selectionIds.size===1&&existing&&!existing.locked?writingControlPoints(existing).find(h=>Math.hypot(h.x-p.x,h.y-p.y)<10):null;
    if(knob){gesture={pointerId:e.pointerId,mode:'handle',key:knob.key,start:p,original:existing,object:existing,moved:false};armObjectHold(e);$('input').setPointerCapture(e.pointerId);return;}
    const target=selectionTool()?hit(p):null;
    if(selectionTool()&&!target){
        selectObjects();gesture={pointerId:e.pointerId,mode:'marquee',start:p,box:[p.x,p.y,0,0]};
        textBoxPreview.hidden=false;previewGesture(e);if(objectClipboard)armObjectHold(e);$('input').setPointerCapture(e.pointerId);return;
    }
    if(!target||!selectionIds.has(target.id))selectObjects(target?[target.id]:[]);controls();
    if(selectionTool()){
        if(target&&!target.locked){const group=selectedObjects();gesture=group.length>1?{pointerId:e.pointerId,mode:'group-move',start:p,originals:group,objects:group,moved:false}:{pointerId:e.pointerId,mode:'move',start:p,original:target,object:target,moved:false};}
        render();syncStyle(true);if(target||objectClipboard)armObjectHold(e);
    }
    else {const {width,color}=settings[styleKey()];let object;
        if(PEN_TOOLS.includes(tool)){
            object={id:writingId(),type:'stroke',tool,color,opacity:tool==='highlighter'?.48:1,baseWidth:width,geometryVersion:tool==='brush'?4:1,...(tool==='brush'?{inkAmount:settings.brush.inkAmount}:{}),points:[{...penPoint(p,e,width),...(tool==='brush'?{dryness:0}:{})}]};}
        else if(['line','arrow'].includes(tool)){p=snapped(p);object={id:writingId(),type:'line',from:[p.x,p.y],to:[p.x,p.y],color,width,arrow:settings.geometry.arrow,arrowHead:settings.geometry.arrowHead,lineStyle:settings.geometry.lineStyle};}
        else object={id:writingId(),type:'shape',shape:tool,rect:[p.x,p.y,1,1],color,fill:null,width,opacity:1,lineStyle:settings.geometry.lineStyle};
        gesture={pointerId:e.pointerId,mode:'draw',start:p,object,cross,...(tool==='brush'?{raw:[rawBrushPoint(p,e)]}:{})};if(cross)renderSpreadStroke(object);else render([...objects(),object]);}
    if(gesture)$('input').setPointerCapture(e.pointerId);
};
$('input').onpointermove=e=>{if(objectHoldStart){if(Math.hypot(e.clientX-objectHoldStart[0],e.clientY-objectHoldStart[1])<=8)return;clearObjectHold();}if(gesture?.pointerId===e.pointerId)previewGesture(e);};
$('input').onpointerup=e=>{const holding=!!objectHoldStart;clearObjectHold();if(gesture?.pointerId!==e.pointerId)return;if(!holding)previewGesture(e);const g=gesture;gesture=null;
    if(g.mode==='marquee'){textBoxPreview.hidden=true;selectObjects(writingMarqueeObjects(objects(),g.box).map(o=>o.id));render();updatePanels();syncStyle(true);if(selected)showObjectActions(e.clientX,e.clientY);return;}
    if(g.mode==='group-move'){if(g.moved){const replacements=new Map(g.objects.map(o=>[o.id,o]));mutate('書き込みを移動',all=>all.map(o=>replacements.get(o.id)||o));}else{render();updatePanels();}return;}
    if(g.mode==='text-box'){textBoxPreview.hidden=true;textDialog(g.start,null,g.box[2]>=24&&g.box[3]>=24?g.box:null);return;}
    selectObjects([g.object.id]);
    snapTarget=null;if(g.raw)g.object.points=brushGeometry(g.raw,g.object.baseWidth,true,true);
    if(g.cross){try{const parts=strokeParts(g.object);model.changePages(language,`${toolNames[tool]}を追加`,parts.map(p=>({pageId:p.pageId,transform:all=>[...all,p.object]})));selectObjects();changed('見開きへの書き込みを追加しました。');}catch(error){say(explain(error),true);render();}return;}
    if(['move','handle'].includes(g.mode)){if(g.moved)mutate(g.mode==='handle'?'ポイントを編集':'書き込みを移動',all=>all.map(o=>o.id===g.object.id?g.object:o));else {render();updatePanels();}}
    else {const operation=`${toolNames[tool]}を追加`;selectObjects();mutate(operation,all=>[...all,g.object]);}};
$('input').onpointercancel=cancelGesture;$('input').onlostpointercapture=()=>{if(gesture)cancelGesture();};
$('input').oncontextmenu=e=>{if(!selectionTool()||busy||model?.locked||readingMode)return;e.preventDefault();cancelGesture();
    const column=Math.min(visiblePages.length-1,Math.floor(point(e,true).x/360));if(visiblePages[column]!==pageIndex){pageIndex=visiblePages[column];showPage();}
    const target=hit(point(e));if(!target||!selectionIds.has(target.id))selectObjects(target?[target.id]:[]);render();syncStyle(true);showObjectActions(e.clientX,e.clientY);};
function textDialog(p,existing,box) {
    if(existing?.locked)return;
    textPlacement={...p,existing};$('text').value=existing?.text||'';$('text-title').textContent=existing?'文字を編集':'文字を追加';$('text-error').textContent='';
    if(existing){const r=existing.runs[0];$('font').value=r.fontId;$('size').value=String(r.size);$('weight').value=String(r.weight);$('color').value=r.color;$('vertical').checked=existing.writingMode==='vertical-rl';}
    for(const id of ['font','size','weight','color'])$(`text-${id}`).value=$(id).value;$('text-vertical').checked=$('vertical').checked;
    const frame=existing?(existing.boxStyle||{stroke:null,fill:null,width:penPixels(.3)}):settings.text.boxStyle;
    $('text-border-enabled').checked=!!frame.stroke;$('text-fill-enabled').checked=!!frame.fill;$('text-border-color').value=frame.stroke||'#20272b';$('text-fill-color').value=frame.fill||'#ffffff';$('text-border-width').value=penWidthLabel(frame.width);syncTextFrame();
    if(textSize($('text-size').value)===null){say('文字サイズを1〜360の数値で入力してください。',true);textPlacement=null;return;}syncTextColors();
    if(host){
        const size=Number($('text-size').value),min=Math.max(32,size*1.4),x=Math.max(8,Math.min(existing?.rect[0]??box?.[0]??p.x,352-min)),y=Math.max(8,Math.min(existing?.rect[1]??box?.[1]??p.y,632-min));
        textPlacement={...textPlacement,language,pageId:page().id,pageIndex,box:[x,y,Math.max(min,Math.min(existing?.rect[2]??box?.[2]??200,352-x)),Math.max(min,Math.min(existing?.rect[3]??box?.[3]??100,632-y))]};
        textPlacement.initial=inlineTextSignature();
        body.dataset.textEditing='true';textPan={x:0,y:0};host.textView?.({active:true});
        $('text-format-toggle').setAttribute('aria-expanded','false');
        $('text-dialog').show();positionInlineText();void refreshInlineFont();render();
    }else $('text-dialog').showModal();
    $('text').focus({preventScroll:true});
}
function endTextView(){delete body.dataset.textEditing;textPan={x:0,y:0};host?.textView?.(null);}
function cancelText(){if(!busy){textSerial++;$('text-dialog').close();textPlacement=null;endTextView();render();}}
function inlineTextSignature(){return JSON.stringify([$('text').value,...['font','size','weight','color'].map(id=>$(`text-${id}`).value),$('text-vertical').checked,textPlacement?.box,textFrame()]);}
$('text-cancel').onclick=cancelText;
$('text-dialog').oncancel=e=>{if(busy)e.preventDefault();};
async function commitText(){
    if(busy||!textPlacement)return false;
    if(textSize($('text-size').value)===null){$('text-error').textContent='文字サイズを1〜360の数値で入力してください。';return false;}
    if(!Number.isFinite(textFrame().width)||Number($('text-border-width').value)<.1||Number($('text-border-width').value)>8){$('text-error').textContent='枠線の太さを0.1〜8 mmで入力してください。';return false;}
    if(host&&!$('text').value.trim()){cancelText();return true;}
    if(host&&textPlacement.existing&&textPlacement.initial===inlineTextSignature()){cancelText();return true;}
    busy=true;controls();$('text-apply').disabled=true;$('text-error').textContent='書体と文字を確認中…';
    for(const field of $('text-form').querySelectorAll('input,select,textarea,button'))field.disabled=true;
    try {const fontId=$('text-font').value,text=$('text').value,size=Number($('text-size').value),weight=Number($('text-weight').value);
        await runtime.verifyInput(fontId,text);inputFamilies[fontId]=await runtime.inputFamily(fontId);
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`${weight} ${size}px "${inputFamilies[fontId]}"`;
        const old=textPlacement.existing,o=createWritingText({id:old?.id,text,x:textPlacement.x,y:textPlacement.y,fontId,size,weight,color:$('text-color').value,vertical:$('text-vertical').checked,measure:s=>ctx.measureText(s).width,box:host?textPlacement.box:undefined});
        o.boxStyle=textFrame();
        model.change(textPlacement.language||language,textPlacement.pageId||page().id,old?'文字を編集':'文字を追加',all=>old?all.map(item=>item.id===old.id?o:item):[...all,o]);
        for(const id of ['font','size','weight','color'])$(id).value=$(`text-${id}`).value;settings.text.color=$('text-color').value;$('vertical').checked=$('text-vertical').checked;
        settings.text.boxStyle=structuredClone(o.boxStyle);
        selectObjects([o.id]);$('text-dialog').close();textPlacement=null;textSerial++;endTextView();if(host)tool='select';changed('文字を配置しました。');return true;
    }catch(e){$('text-error').textContent=explain(e);return false;}
    finally{runtime.dispose();busy=false;for(const field of $('text-form').querySelectorAll('input,select,textarea,button'))field.disabled=false;controls();syncTextFrame();}
}
$('text-form').onsubmit=e=>{e.preventDefault();void commitText();};
function inlinePageRect(){return hostView?.pages.find(p=>p.index===textPlacement?.pageIndex);}
function positionInlineText(){
    let pageRect=host?.view?.().pages.find(p=>p.index===textPlacement?.pageIndex)||inlinePageRect();if(!textPlacement?.box||!pageRect)return;
    const [x,y,w,h]=textPlacement.box,s=pageRect.width/360;
    const bar=$('inline-text-toolbar'),v=window.visualViewport,mobile=innerWidth<900;
    bar.dataset.mobile=String(mobile);
    if(mobile){
        const vp={left:v?.offsetLeft||0,top:v?.offsetTop||0,width:v?.width||innerWidth,height:v?.height||innerHeight};
        const headerBottom=document.querySelector('#viewer-header')?.getBoundingClientRect().bottom||vp.top+52;
        Object.assign(bar.style,{left:`${vp.left+8}px`,top:`${Math.max(vp.top+8,headerBottom+4)}px`,width:`${vp.width-16}px`,maxHeight:`${Math.max(100,Math.min(300,vp.height*.48))}px`});
        const raw={left:pageRect.left-textPan.x+x*s,top:pageRect.top-textPan.y+y*s,width:w*s,height:h*s};
        const next=writingTextPan({box:raw,viewport:vp,toolbarBottom:bar.getBoundingClientRect().bottom});
        host.textView?.({offset:next});textPan=next;
        pageRect=host.view().pages.find(p=>p.index===textPlacement.pageIndex)||pageRect;
    }else{bar.style.maxHeight='';if(textPan.x||textPan.y){host.textView?.({offset:{x:0,y:0}});textPan={x:0,y:0};}}
    const left=pageRect.left+x*s,top=pageRect.top+y*s;
    Object.assign($('text-dialog').style,{left:`${left}px`,top:`${top}px`,width:`${w*s}px`,height:`${h*s}px`});
    const size=textSize($('text-size').value)||20,base=Math.max(16,size),factor=base/size;
    Object.assign($('text').style,{width:`${w*factor}px`,height:`${h*factor}px`,fontSize:`${base}px`,transform:`scale(${s/factor})`,fontWeight:$('text-weight').value,color:$('text-color').value,writingMode:$('text-vertical').checked?'vertical-rl':'horizontal-tb'});
    const frame=textFrame(),half=Number.isFinite(frame.width)?Math.max(0,frame.width*s/2):0;
    Object.assign($('text-dialog').style,{backgroundColor:frame.fill||'transparent',borderWidth:'0',outline:frame.stroke?'none':'1px dashed #247d83',boxShadow:frame.stroke?`inset 0 0 0 ${half}px ${frame.stroke},0 0 0 ${half}px ${frame.stroke}`:'0 0 0 1px #fff9'});
    if(mobile)return;
    const leftEdge=(v?.offsetLeft||0)+8,topEdge=(v?.offsetTop||0)+8,right=leftEdge+(v?.width||innerWidth)-16,bottom=topEdge+(v?.height||innerHeight)-16;
    const barWidth=Math.min(490,right-leftEdge,pageRect.width>=340?pageRect.width-16:Infinity);bar.style.width=`${barWidth}px`;const bh=bar.getBoundingClientRect().height;
    const barTop=top-bh-10>=topEdge?top-bh-10:top+h*s+10+bh<=bottom?top+h*s+10:topEdge;
    const pageLeft=Math.max(leftEdge,pageRect.left+8),pageRight=Math.min(right,pageRect.left+pageRect.width-8),fitsPage=pageRight-pageLeft>=barWidth;
    Object.assign(bar.style,{left:`${Math.max(fitsPage?pageLeft:leftEdge,Math.min(left,(fitsPage?pageRight:right)-barWidth))}px`,top:`${Math.max(topEdge,Math.min(barTop,bottom-bh))}px`});
}
async function refreshInlineFont(){
    const token=++textSerial;positionInlineText();
    try{const family=await runtime.inputFamily($('text-font').value);if(token!==textSerial||!textPlacement)return;$('text').style.fontFamily=`"${family}"`;positionInlineText();}
    catch(error){if(token===textSerial)$('text-error').textContent=explain(error);}
}
if(host){
    const dialog=$('text-dialog');dialog.dataset.inline='true';$('text').required=false;$('text').placeholder='ここに文字を入力';$('text').setAttribute('aria-label','ページ上のテキストボックス');
    $('input').setAttribute('aria-label','Writingページ。文字はクリックまたはドラッグで枠を作り、直接入力。再編集はダブルクリックまたは設定から。');
    const bar=document.createElement('div');bar.id='inline-text-toolbar';bar.setAttribute('role','group');bar.setAttribute('aria-label','文字の書式と確定');
    bar.append(root.querySelector('.dialog-options'),textColors,textBoxStyle,$('text-error'),root.querySelector('.dialog-actions'));$('text-form').append(bar);
    const format=document.createElement('button');format.id='text-format-toggle';format.type='button';format.textContent='Aa';format.title='文字の書式';format.setAttribute('aria-label','文字の書式');format.setAttribute('aria-expanded','false');bar.prepend(format);
    format.onclick=()=>{format.setAttribute('aria-expanded',format.getAttribute('aria-expanded')!=='true');positionInlineText();};
    const quick=document.createElement('div');quick.id='text-quick-size';quick.append($('text-size').closest('.text-size-controls'));bar.insertBefore(quick,format.nextSibling);
    $('text-apply').textContent='確定';$('text-cancel').textContent='キャンセル';
    const label=$('text').closest('label');label.className='inline-text-label';for(const n of [...label.childNodes])if(n.nodeType===3)n.textContent='';
    for(const [id,label,icon] of [['text-move','テキストボックスを移動','✥'],['text-resize','テキストボックスの大きさを変更','◢']]){
        const b=document.createElement('button');b.id=id;b.type='button';b.setAttribute('aria-label',label);b.title=label;b.textContent=icon;dialog.append(b);
        let drag;
        b.onpointerdown=e=>{if(busy||!textPlacement)return;e.preventDefault();b.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,box:[...textPlacement.box],scale:inlinePageRect().width/360};};
        b.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;const [x,y,w,h]=drag.box,dx=(e.clientX-drag.x)/drag.scale,dy=(e.clientY-drag.y)/drag.scale;
            textPlacement.box=id==='text-move'?[Math.max(0,Math.min(360-w,x+dx)),Math.max(0,Math.min(640-h,y+dy)),w,h]:[x,y,Math.max(32,Math.min(360-x,w+dx)),Math.max(32,Math.min(640-y,h+dy))];positionInlineText();};
        b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>{drag=null;};
    }
    for(const field of root.querySelectorAll('.dialog-options input,.dialog-options select'))field.addEventListener('change',()=>void refreshInlineFont());
    $('text-size').addEventListener('input',()=>{if(textSize($('text-size').value)!==null)positionInlineText();});
    $('text').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();cancelText();}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void commitText();}});
    $('input').ondblclick=e=>{const o=hit(point(e));if(o?.type==='text'&&!o.locked){e.preventDefault();cancelGesture();textDialog(point(e),o);}};
    let textWasOpenAtPointerDown=false;
    document.addEventListener('pointerdown',()=>{textWasOpenAtPointerDown=dialog.open;},{capture:true,signal:lifetime.signal});
    document.addEventListener('click',async e=>{
        if(!dialog.open||e.composedPath().includes(dialog)||(e.detail>0&&!textWasOpenAtPointerDown))return;
        e.preventDefault();e.stopImmediatePropagation();if(busy)return;
        const target=e.composedPath().find(el=>el.matches?.('button,summary'));
        if(await commitText())target?.click();
    },{capture:true,signal:lifetime.signal});
    visualViewport?.addEventListener('resize',positionInlineText,{signal:lifetime.signal});visualViewport?.addEventListener('scroll',positionInlineText,{signal:lifetime.signal});
}
async function buildFile(shared=false) {
    await saveQueue;
    const editable=await resaveDsfV3(handle,{copyKind:'writing-editable',envelope:model.envelope});
    const output=shared?await resaveDsfV3(editable.handle,{copyKind:'writing-shared'}):editable;
    if(output.handle.baseHash!==handle.baseHash)throw new Error('DSF3_ORIGINAL_CHANGED');
    clearGenerated();generated=output;generatedHead=model.head;downloadUrl=URL.createObjectURL(output.blob);
    $('download').href=downloadUrl;$('download').download=dsfFilename(`${(handle.meta.title||'DSF').replace(/\.(dsfr|dsf)$/i,'')}-${shared?'shared':'writing'}`);
    $('download').textContent=`${shared?'共有用':'編集用'}DSFをダウンロード`;$('download').hidden=$('reopen').hidden=false;
    $('file-status').textContent=`作成済み · ${(output.bytes.length/1024).toFixed(1)} KB。ダウンロードしてファイルとして保管してください。${shared?' 編集中の下書きと履歴はそのまま残っています。':''}`;
}
$('save').onclick=()=>task('編集用DSF作成',()=>buildFile());$('share').onclick=()=>task('共有用DSF作成',()=>buildFile(true));
$('reopen').onclick=()=>task('作成したDSFの再読込',async()=>{const bytes=generated.bytes;await openBytes(bytes);});
$('record').onclick=()=>task('検証フォルダーへの保存',async()=>{const r=await fetch('/record-file',{method:'POST',headers:{'Content-Type':'application/vnd.dsf.content+zip','X-DSF-SHA256':generated.sha256},body:generated.blob});
    if(!r.ok)throw new Error('TEST_FILE_WRITE');const receipt=await r.json();$('receipt').textContent=receipt.file;$('evidence').textContent+=`\nfileSha256: ${receipt.sha256}`;});
listenWindow('keydown',e=>{if(busy||!model||model.locked||readingMode||e.composedPath().some(n=>n.matches?.('input,textarea,select,dialog')))return;
    if((e.ctrlKey||e.metaKey)&&['x','c','v','d'].includes(e.key.toLowerCase())){e.preventDefault();objectAction({x:'cut',c:'copy',v:'paste',d:'duplicate'}[e.key.toLowerCase()]);return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();const id=e.shiftKey?model.children.at(-1)?.id:model.parent;if(id)restore(id);}
    if(e.key==='Delete'&&selected){e.preventDefault();$('delete').click();}if(e.key==='Escape'){cancelGesture();selectObjects();render();controls();}});
listenWindow('beforeunload',e=>{if(unsaved){e.preventDefault();e.returnValue='';}});
if(!host)try {await refreshDrafts();say('DSFを開くか、サンプルで書き込みを試してください。');}catch(e){say(explain(e),true);}
$('download').addEventListener('click',()=>{if(generated)savedHead=generatedHead;});
setTool('pen');controls();

if(!host&&readerNonce&&window.parent!==window){
    body.classList.add('reader-connected');
    let received=false;
    const reply=data=>window.parent.postMessage({...data,nonce:readerNonce},location.origin);
    listenWindow('message',async event=>{
        if(event.source!==window.parent||event.origin!==location.origin||event.data?.nonce!==readerNonce)return;
        const data=event.data;
        if(data.type==='dsf-writing-open'&&!received){received=true;
            await task('Readerから読込',async()=>{
                try{if(!(data.file instanceof Blob)||data.file.size>257*1024*1024)throw Error('ZIP_LIMIT');
                    spread=data.spread===true;readerUnits=Array.isArray(data.units)?data.units:null;
                    await openBytes(new Uint8Array(await data.file.arrayBuffer()),{language:data.language,pageIndex:Math.max(0,Number.isInteger(data.pageIndex)?data.pageIndex:0)});
                    reply({type:'dsf-writing-opened'});
                }catch(error){reply({type:'dsf-writing-error',message:explain(error)});throw error;}
            });
        }
        if(data.type==='dsf-writing-exit'){
            if(busy)return;
            if(!handle){reply({type:'dsf-writing-error',message:'DSFをまだ開けていません。接続を閉じるとReaderへ戻れます。'});return;}
            if($('text-dialog').open){say('入力中の文字を配置するか、キャンセルしてからReaderへ戻ってください。',true);return;}
            cancelGesture();
            await task('Readerへ戻る準備',async()=>{
                await saveQueue;
                const output=await resaveDsfV3(handle,model.locked?{}:{copyKind:'writing-editable',envelope:model.envelope});
                reply({type:'dsf-writing-return',bytes:output.bytes,language,pageIndex});
            });
        }
        if(data.type==='dsf-writing-returned')unsaved=false;
    });
    reply({type:'dsf-writing-ready'});
}

// Reader owns the paper, navigation, spread preference and page-turn animation.
function layoutHost(){
    if(!host||!hostView?.pages.length)return;
    const first=hostView.pages[0],last=hostView.pages.at(-1),width=last.right-first.left,height=first.height;
    if(!hostView.suspended)layoutChrome({left:first.left,top:first.top,right:last.right,bottom:first.top+height,width,height});
    const layout=[first.left,first.top,width,height,visiblePages.length,hostView.suspended].join(':');
    if(layout===lastHostLayout)return;lastHostLayout=layout;
    Object.assign($('page-wrap').style,{left:first.left+'px',top:first.top+'px',width:width+'px',height:height+'px'});
    $('surface').style.width=360*visiblePages.length+'px';$('surface').style.transform=`scale(${width/(360*visiblePages.length)},${height/640})`;
    $('page-wrap').hidden=hostView.suspended;
}
function layoutChrome(paper){
    const controls=[...document.querySelectorAll('#viewer-reader-controls,.viewer-page-segments')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height).map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}));
    const inset=getComputedStyle($('chrome-safe')),safe={left:parseFloat(inset.paddingLeft)||0,right:parseFloat(inset.paddingRight)||0,top:parseFloat(inset.paddingTop)||0,bottom:parseFloat(inset.paddingBottom)||0};
    const hr=document.querySelector('#viewer-header .ui-controls')?.getBoundingClientRect(),header=hr?{left:hr.left,top:hr.top,right:hr.right,bottom:hr.bottom,width:hr.width,height:hr.height}:null;
    const key=JSON.stringify([innerWidth,innerHeight,paper,controls,header,safe]);if(key===lastChromeLayout)return;lastChromeLayout=key;
    const layout=writingChromeLayout({width:innerWidth,height:innerHeight,paper,controls,header,safe});body.dataset.toolsLayout=layout.mode;body.dataset.short=layout.short;
    const rect=(el,r)=>Object.assign(el.style,{left:`${r.left}px`,top:`${r.top}px`,width:r.width?`${r.width}px`:'',height:r.height?`${r.height}px`:''});
    rect($('pen-tray'),layout.pens);rect($('tool-field'),layout.tools);rect($('native-history'),layout.history);
    rect($('tool-scroll'),layout.rail);
    $('tool-scroll-track').style.width=`${layout.trackWidth}px`;
    body.style.setProperty('--pen-size',`${layout.size}px`);body.style.setProperty('--pen-gap',`${layout.gap}px`);
    rect($('active-tool-label'),layout.context);
    chromeContrast?.invalidate();
    if(sheet.open)positionSheet();
    if(host&&$('text-dialog').open)positionInlineText();
}
function positionSheet(){
    const source=sheetAnchor?.isConnected?sheetAnchor:$('active-tool-label');let anchor=source.getBoundingClientRect();
    if(anchor.bottom<=0||!anchor.width){const fallback=$('active-tool-label').style;anchor={left:parseFloat(fallback.left)||8,top:parseFloat(fallback.top)||56,width:parseFloat(fallback.width)||264,height:44};anchor.bottom=anchor.top+44;anchor.right=anchor.left+anchor.width;}
    if(source.classList.contains('pen-item'))anchor={...anchor.toJSON(),top:Math.min(anchor.top,source.querySelector('svg').getBoundingClientRect().top)};
    const pages=hostView?.pages||[],canvas=pages.length?{left:Math.min(...pages.map(p=>p.left)),right:Math.max(...pages.map(p=>p.right)),top:Math.min(...pages.map(p=>p.top)),bottom:Math.max(...pages.map(p=>p.top+p.height))}:undefined;
    const headerBottom=[...document.querySelectorAll('#viewer-header .ui-controls,#viewer-header .viewer-brand-navigation')].filter(e=>e.getClientRects().length).reduce((y,e)=>Math.max(y,e.getBoundingClientRect().bottom),0);
    const v=window.visualViewport,args={width:v?.width||innerWidth,height:v?.height||innerHeight,offsetLeft:v?.offsetLeft||0,offsetTop:v?.offsetTop||0,anchor,panel:sheet.dataset.panel,canvas,headerBottom};
    let r=writingInspectorPlacement(args);
    sheet.dataset.placement='anchored';Object.assign(sheet.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:sheet.dataset.panel==='layers'?`${r.height}px`:'auto',maxHeight:`${r.height}px`});
    // Use the actual content height so a short panel still meets its tool's upper edge.
    r=writingInspectorPlacement({...args,contentHeight:sheet.getBoundingClientRect().height});sheet.style.top=`${r.top}px`;
}

async function syncHost(view){
    const resumed=hostView?.suspended&&!view.suspended;
    if(disposed||!model||busy)return;
    if(!view.pages.length){cancelGesture();$('page-wrap').hidden=true;lastHostLayout=null;return;}
    const key=`${view.language}:${view.pages.map(p=>p.index).join(',')}`;
    if(hostView?.key!==key){
        cancelGesture();
        if(language!==view.language){const orig={};for(const f of handle.resources.original.fonts)orig[f.sourceFontId]=`RW_original_${f.sha256}`;
            pageCache.clear();language=view.language;context=await contextFor(handle,language,orig);}
        if(disposed)return;
        hostView={...view,key};pageIndex=view.pages.some(p=>p.index===view.pageIndex)?view.pageIndex:view.pages[0].index;
        spread=view.pages.length>1;showPage();persist();chromeContrast?.invalidate();
    }else hostView={...view,key};
    if(view.suspended&&gesture)cancelGesture();layoutHost();if(resumed)chromeContrast?.invalidate();
}
if(host){
    body.dataset.keyboard='false';
    root.addEventListener('pointerdown',()=>{body.dataset.keyboard='false';},{capture:true,signal:lifetime.signal});
    document.addEventListener('keydown',e=>{if(e.key==='Tab')body.dataset.keyboard='true';},{capture:true,signal:lifetime.signal});
    for(const type of ['resize','scroll'])window.visualViewport?.addEventListener(type,()=>{if(sheet.open)positionSheet();},{signal:lifetime.signal});
    body.dataset.tools='pens';
    $('writing-test-intro')?.remove();
    const prepare=$('prepare');prepare.textContent='入力用書体の準備';root.querySelector('.save-panel').append(prepare);
    $('offline-status').textContent='準備した入力用書体は通信なしでも使えます。Reader画面のオフライン起動は引き続き検証中です。';
    const toolbar=document.createElement('div');toolbar.className='native-tools';
    const rail=document.createElement('div');rail.id='tool-scroll';rail.setAttribute('role','region');rail.setAttribute('aria-label','左右にスワイプして道具を選択');rail.tabIndex=0;
    const track=document.createElement('div');track.id='tool-scroll-track';track.append($('tool-field'),$('pen-tray'));rail.append(track);toolbar.append(rail);root.append(toolbar);
    // Keep trackpad scrolling in this rail; the Reader also listens for wheel turns.
    rail.addEventListener('wheel',e=>e.stopPropagation(),{passive:true});
    rail.addEventListener('keydown',e=>{if(e.target===rail&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();rail.scrollBy({left:e.key==='ArrowRight'?160:-160,behavior:'smooth'});}});
    let railStart,railMoved=false;
    rail.addEventListener('pointerdown',e=>{railStart=[e.clientX,e.clientY];railMoved=false;},{capture:true});
    rail.addEventListener('pointermove',e=>{if(railStart&&Math.hypot(e.clientX-railStart[0],e.clientY-railStart[1])>9)railMoved=true;},{capture:true});
    rail.addEventListener('click',e=>{if(railMoved){e.preventDefault();e.stopImmediatePropagation();}railStart=null;},{capture:true});
    const safe=document.createElement('span');safe.id='chrome-safe';root.append(safe);
    const activeTool=document.createElement('button');activeTool.id='active-tool-label';activeTool.type='button';
    activeTool.innerHTML='<span class="active-tool-swatch" aria-hidden="true"></span><span id="active-tool-name"></span><span id="active-tool-detail"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
    toolbar.append(activeTool);
    const historyBar=document.createElement('nav');historyBar.id='native-history';historyBar.setAttribute('aria-label','書き込みの取り消しと表示');
    for(const [id,label,icon] of [['undo','元に戻す','↶'],['redo','やり直す','↷'],['fit','ページ全体を表示','⛶'],['layers','レイヤー・重ね順','▱'],['timeline','履歴','◷']]){
        const b=document.createElement('button');b.id=`native-${id}`;b.type='button';b.title=label;b.setAttribute('aria-label',label);b.textContent=icon;
        if(id==='layers')b.innerHTML='<svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3 7 9-5 9 5-9 5ZM3 12l9 5 9-5M3 17l9 5 9-5"/></svg>';
        if(id!=='layers')b.innerHTML=`<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{undo:'<path d="m8 5-5 5 5 5M3 10h11a6 6 0 0 1 6 6v2"/>',redo:'<path d="m16 5 5 5-5 5m5-5H10a6 6 0 0 0-6 6v2"/>',fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',timeline:'<path d="M4 8a9 9 0 1 1 0 8M4 3v5h5M12 7v6l4 2"/>'}[id]}</svg>`;
        b.onclick=()=>{cancelGesture();if(id==='fit')host.resetView?.();else if(['layers','timeline'].includes(id)){if(sheet.open&&sheetAnchor===b){closeSheet();return;}sheetAnchor=b;root.querySelector(`[data-panel="${id==='timeline'?'history':'layers'}"]`).click();}else $(id).click();};historyBar.append(b);
    }track.prepend(historyBar);
    chromeContrast=createWritingContrast({documentRef:document,groups:[historyBar,$('tools'),$('pen-tray')],rail,isVisible:()=>toolsVisible&&!hostView?.suspended&&!disposed});
    chromeContrast.invalidate();
    const showPanel=(name,anchor=activeTool)=>{closeSheet();sheetAnchor=anchor;root.querySelector(`[data-panel="${name}"]`).click();};
    const tooltip=document.createElement('div');tooltip.id='writing-tool-tip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;root.append(tooltip);
    let tooltipTarget,tooltipTitle;
    const hideTip=()=>{tooltip.hidden=true;if(tooltipTarget){tooltipTarget.removeAttribute('aria-describedby');if(tooltipTitle)tooltipTarget.title=tooltipTitle;}tooltipTarget=null;};
    for(const b of [...root.querySelectorAll('[data-tool]'),...historyBar.children]){
        const showTip=()=>{hideTip();tooltipTarget=b;tooltipTitle=b.title;b.removeAttribute('title');tooltip.textContent=t(tooltipTitle||b.getAttribute('aria-label'));tooltip.hidden=false;b.setAttribute('aria-describedby',tooltip.id);const r=b.getBoundingClientRect(),w=tooltip.getBoundingClientRect().width;tooltip.style.left=`${Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))}px`;tooltip.style.top=`${Math.max(8,r.top-tooltip.getBoundingClientRect().height-8)}px`;};
        b.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')showTip();});b.addEventListener('pointerleave',hideTip);b.addEventListener('focus',()=>{if(b.matches(':focus-visible'))showTip();});b.addEventListener('blur',hideTip);b.addEventListener('pointerdown',hideTip);
    }
    rail.addEventListener('scroll',()=>{hideTip();if(sheet.open)positionSheet();},{passive:true});
    listenWindow('resize',hideTip);
    const toolHolds=new Set();
    rail.addEventListener('scroll',()=>{for(const clear of toolHolds)clear();},{passive:true});
    activeTool.onclick=()=>{sheetAnchor=activeTool;if(selectedObject())openObjectSettings();else if(!selectionTool())showPanel('settings');};
    for(const b of root.querySelectorAll('[data-tool]')){
        // The selected tool opens its inspector on a second tap, just as a long press does.
        b.onclick=()=>{if(sheet.open&&sheetAnchor===b){closeSheet();return;}if(b.dataset.tool===tool&&!readingMode&&!selected&&!selectionTool())showPanel('settings',b);else setTool(b.dataset.tool);};
        let timer,held=false,start;
        const clear=()=>clearTimeout(timer);toolHolds.add(clear);lifetime.signal.addEventListener('abort',clear,{once:true});
        b.addEventListener('pointerdown',e=>{if(e.button!==0||b.disabled||(b.dataset.tool==='select'))return;held=false;start=[e.clientX,e.clientY];timer=setTimeout(()=>{held=true;setTool(b.dataset.tool);showPanel('settings',b);},500);});
        b.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>9)clear();});
        for(const type of ['pointerup','pointercancel','pointerleave'])b.addEventListener(type,clear);
        b.addEventListener('click',e=>{if(held){e.stopImmediatePropagation();e.preventDefault();held=false;}},true);
        b.addEventListener('contextmenu',e=>{e.preventDefault();clear();if((b.dataset.tool==='select')){if(selectedObject())openObjectSettings();return;}setTool(b.dataset.tool);showPanel('settings',b);});
        b.addEventListener('keydown',e=>{if(e.key==='F2'&&!(b.dataset.tool==='select')){e.preventDefault();setTool(b.dataset.tool);showPanel('settings',b);}});
        if(PEN_TOOLS.includes(b.dataset.tool)){
            // Rotate the original artwork, including its long barrel and textured nib.
            // Width labels remain outside the group, so they stay upright and readable.
            const svg=b.querySelector('svg'),art=document.createElementNS('http://www.w3.org/2000/svg','g');
            art.classList.add('pen-art');art.setAttribute('transform','translate(60 130) rotate(180)');
            for(const child of [...svg.children])if(child.tagName.toLowerCase()!=='defs')art.append(child);
            svg.append(art);
            const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.classList.add('pen-width');t.setAttribute('x','30');t.setAttribute('y','80');t.setAttribute('text-anchor','middle');
            svg.append(t);
            const window=document.createElement('div');window.className='pen-visual';window.setAttribute('aria-hidden','true');b.prepend(window);window.append(svg);
        }
    }
    root.addEventListener('keydown',e=>{if(e.target.closest('dialog'))e.stopPropagation();});
    root.addEventListener('pointerdown',e=>e.stopPropagation());root.addEventListener('click',e=>e.stopPropagation());
    return {
        async open(data){spread=data.spread===true;readerUnits=data.units;await openBytes(new Uint8Array(await data.file.arrayBuffer()),{language:data.language,pageIndex:data.pageIndex});if($('status').dataset.error!=='true'){$('status').textContent='書き込みモード';$('status').dataset.notice=false;}},
        sync:syncHost,panel:(name)=>{showTools(true);showPanel(name);},
        get hasChanges(){return !!model&&model.head!==savedHead;},
        showTools, toggleTools(){showTools(!toolsVisible);},
        prepare(){const snapshot=host.view();if(snapshot.pages.length){const first=snapshot.pages[0],last=snapshot.pages.at(-1);layoutChrome({left:first.left,top:first.top,right:last.right,bottom:first.top+first.height,width:last.right-first.left,height:first.height});}},
        async finish(){if(busy)throw Error('処理が完了するまでお待ちください。');if($('text-dialog').open)throw Error('入力中の文字を配置するか、キャンセルしてください。');cancelGesture();await saveQueue;
            busy=true;controls();try{const output=await resaveDsfV3(handle,{copyKind:'writing-editable',envelope:model.envelope});return {bytes:output.bytes,language,pageIndex};}finally{busy=false;runtime.dispose();controls();}},
        layer(pageId,lang){const layer=document.createElement('div');layer.className='reader-writing-saved-layer';renderWritingLayer(layer,model?.objects(lang,pageId)||[],{...families,...inputFamilies});return layer.outerHTML;},
        notice:message=>say(message,true),
        dispose(){disposed=true;chromeContrast?.dispose();host.textView?.(null);lifetime.abort();clearTimeout(noticeTimer);resizeObserver.disconnect();mobileMedia.removeEventListener('change',mediaChanged);closeSheet();runtime.destroy();originalFaces.forEach(f=>document.fonts.delete(f));pageCache.clear();if(downloadUrl)URL.revokeObjectURL(downloadUrl);}
    };
}
}
if(document.getElementById('surface'))await mountReaderWriting();
