import '../css/viewer-embed.css';
import {normalizeEmbedDisplay,embedStartIndex} from './embed-layout.js';
import { initializeViewerPageSegments } from './viewer-page-segment-control.js';
import { viewerReaderIconMarkup } from './viewer-reader-chrome.js';
import { createBookEdges, paintBookEdges } from './viewer-book-edges.js';
import { getBookThickness, fitBookPageWidth } from './book-volume.js';
import { bindEmbeddedReaderLink, canUseEmbeddedFullscreen, toggleEmbeddedFullscreen } from './embed-reader-navigation.js';
import {editionReaderPositionUrl} from './reader-position-link.js';
export const embedEditionId = /^\/embed\/(e_[a-f0-9]{64})\/?$/.exec(location.pathname)?.[1] || '';
const en = (navigator.language || '').startsWith('en');
const t = (ja,english) => en ? english : ja;
let reading = false, revision = null, checkBusy = false, unavailable = false, hideTimer, controlsHeld=false;
let fullscreenUnavailable=false;
const display=normalizeEmbedDisplay({...Object.fromEntries(new URLSearchParams(location.search)),startPage:new URLSearchParams(location.search).get('page')});
let embedView=display.view;
let readerPosition={index:display.startPage-1,language:''};
function syncReaderLinks(){
    if(!embedEditionId)return;
    normalUrl=editionReaderPositionUrl(embedEditionId,{...readerPosition,view:embedView});
    document.querySelectorAll('.embed-brand, #embed-open-notice a, #embed-unavailable a').forEach(link=>{link.href=normalUrl;});
}
export function updateEmbedView({view,busy=false,available=true,fromReader=false}){
    if(fromReader&&!reading)return;
    embedView=view;syncReaderLinks();const button=document.querySelector('#embed-controls [data-view]');if(!button)return;
    const label=view==='book'?t('通常表示に切り替え','Switch to flat view'):t('ブック表示に切り替え','Switch to book view');
    button.innerHTML=viewerReaderIconMarkup(view==='book'?'open':'book');button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(view==='book'));button.disabled=busy||!available;
}
let normalUrl = embedEditionId?editionReaderPositionUrl(embedEditionId,{...readerPosition,view:embedView}):'';
const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const expand = icon('<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>');
const collapse = icon('<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>');
const brand = `<a class="embed-brand" target="_blank" rel="noopener" href="${normalUrl}" aria-label="${t('Readerで開く','Open Reader')}"><span class="horizon-mark" aria-hidden="true"></span><span>Horizon</span></a>`;
const fullButton = () => `<button type="button" data-full ${fullscreenUnavailable || !canUseEmbeddedFullscreen(document)?'hidden':''} aria-label="${t('全画面表示','Full screen')}" title="${t('全画面表示','Full screen')}">${expand}</button>`;
function updateFullscreenButtons(){
    document.querySelectorAll('[data-full]').forEach(el=>{
        el.hidden=!document.fullscreenElement&&(fullscreenUnavailable||!canUseEmbeddedFullscreen(document));
        el.innerHTML=document.fullscreenElement?collapse:expand;
        const label=document.fullscreenElement?t('全画面を終了','Exit full screen'):t('全画面表示','Full screen');el.setAttribute('aria-label',label);el.title=label;
    });
}
async function access() {
    const response = await fetch(`/api/embed?edition=${embedEditionId}`,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Object.assign(new Error('EMBED_UNAVAILABLE'), {status:response.status});
    return response.json();
}
function unavailableMessage(error) {
    if (error?.status === 404) return t('この版は現在公開されていません。','This edition is no longer available.');
    if (error?.status === 403) return t('この版の埋め込みは許可されていません。通常のリンクからReaderで開けます。','Embedding is disabled for this edition. You can still open its regular Reader link.');
    return t('公開状態を確認できません。接続を確認して再試行してください。','Unable to confirm availability. Check your connection and retry.');
}
async function coverDirection(data) {
    // Use the immutable v2 index, never the UI locale or current manuscript.
    if (data.dsfContentUrl) {
        const response = await fetch(data.dsfContentUrl,{credentials:'omit',signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('CONTENT_UNAVAILABLE');
        const bytes = await response.arrayBuffer();
        if(bytes.byteLength > 4*1024*1024) throw new Error('CONTENT_TOO_LARGE');
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        if(hash !== data.dsfContentHash) throw new Error('CONTENT_MISMATCH');
        const index = JSON.parse(new TextDecoder().decode(bytes));
        const language=index.languages?.[data.defaultLang];
        return {direction:language?.pageDirection==='rtl'?'rtl':'ltr',total:language?.pageCount||data.pageCount||1};
    }
    return {direction:data.languageConfigs?.[data.defaultLang]?.pageDirection==='rtl'?'rtl':'ltr',total:data.pageCount||1};
}
function readerNotice(message, trigger) {
    document.querySelector('#embed-open-notice')?.remove();
    const panel=document.createElement('section');panel.id='embed-open-notice';panel.setAttribute('aria-label',t('Readerを開く','Open Reader'));
    const text=document.createElement('p');text.setAttribute('role','status');text.textContent=message;
    const link=document.createElement('a');link.href=normalUrl;link.target='_blank';link.rel='noopener';link.textContent=t('Readerを別タブで開く','Open Reader in a new tab');
    const close=document.createElement('button');close.type='button';close.textContent=t('閉じる','Close');
    const dismiss=()=>{panel.remove();trigger?.focus();};close.onclick=dismiss;
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();dismiss();}});
    bindEmbeddedReaderLink(link,{onBlocked:()=>{text.textContent=blockedMessage();}});
    panel.append(text,link,close);document.body.append(panel);link.focus();
}
function blockedMessage(){return t('別タブを開けませんでした。リンクを長押しして「新規タブで開く」を選んでください。','A new tab could not be opened. Touch and hold the link and choose Open in New Tab.');}
function bindReaderLink(link){bindEmbeddedReaderLink(link,{onBlocked:trigger=>readerNotice(blockedMessage(),trigger)});}
function fullscreen(event) {
    const trigger=event.currentTarget;
    return toggleEmbeddedFullscreen(document,()=>{
        fullscreenUnavailable=true;updateFullscreenButtons();
        readerNotice(t('この環境では埋め込みを全画面表示できません。Readerを別タブで開けます。','Full screen is unavailable here. You can open Reader in a new tab.'),document.querySelector('.embed-brand')||trigger);
    });
}
export function toggleEmbedControls(force) {
    if(!embedEditionId || !reading)return;
    const hidden = typeof force==='boolean' ? !force : !document.body.classList.contains('embed-controls-hidden');
    document.body.classList.toggle('embed-controls-hidden',hidden);
    clearTimeout(hideTimer);
    if(!hidden) hideTimer=setTimeout(()=>{
        // Mouse/touch focus remains after a click; it must not pin chrome open.
        // Preserve an open language menu and visible keyboard focus.
        if(!controlsHeld && !document.querySelector('#embed-controls details[open], #embed-controls :focus-visible, #embed-progress :focus-visible'))document.body.classList.add('embed-controls-hidden');
    },3000);
}
export function holdEmbedControls(held){controlsHeld=held;toggleEmbedControls(true);}
export function noteEmbedPageTurn() {
    // Allow repeated clicks while controls are visible. Reading gestures should
    // never bring hidden controls back over the page.
    if(!document.body.classList.contains('embed-controls-hidden')) toggleEmbedControls(true);
}
let finishStart=null;
export function finishEmbeddedReader(options) { finishStart?.(options); }
export async function prepareEmbeddedReader() {
    if (!embedEditionId) return;
    document.documentElement.classList.add('dsf-embedded-root');
    document.body.classList.add('dsf-embedded','embed-waiting');
    const gate=document.createElement('section');gate.id='embed-cover';
    gate.innerHTML=`<div class="embed-cover-frame"><div class="embed-cover-image"><span aria-hidden="true">▤</span></div><button class="embed-read" type="button" aria-label="${t('リードを開く','Open Read')}">Open Read.</button><small role="status" aria-live="polite"></small></div>`;
    document.body.append(gate);
    const frame=gate.querySelector('.embed-cover-frame'),button=gate.querySelector('.embed-read'),status=gate.querySelector('small');
    let direction='ltr',total=1,loaded=false,starting=false,resolveStart,intent=null;
    const started=new Promise(resolve=>{resolveStart=resolve;});
    const heading=document.createElement('header');heading.id='embed-heading';heading.className='embed-top';
    const name=document.createElement('span');name.textContent='DSF Reader';heading.append(name);document.body.append(heading);
    const bar=document.createElement('nav');bar.id='embed-controls';bar.className='embed-bottom';bar.setAttribute('aria-label',t('読書操作','Reading controls'));
    bar.innerHTML=`${brand}<div class="embed-paging"><button data-prev aria-label="${t('前のページ','Previous page')}">${viewerReaderIconMarkup('left')}</button><output></output><button data-next aria-label="${t('次のページ','Next page')}">${viewerReaderIconMarkup('right')}</button></div><button type="button" data-view></button><details><summary aria-label="${t('言語','Language')}">${icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18"/>')}</summary><div class="embed-menu"><label>${t('言語','Language')}<select aria-label="${t('言語','Language')}"></select></label></div></details>${fullButton()}`;
    document.body.append(bar);
    updateEmbedView({view:embedView});
    bar.querySelector('[data-view]').onclick=()=>{const view=embedView==='book'?'flat':'book';if(reading){toggleEmbedControls(true);window.setEmbeddedReaderView?.(view);}else if(!starting)updateEmbedView({view});};
    const progress=document.createElement('div');progress.id='embed-progress';
    document.body.append(progress);
    bar.querySelector('[data-prev]').onclick=()=>reading?window.embedReaderStep?.(-1):start({type:'step',delta:-1});
    bar.querySelector('[data-next]').onclick=()=>reading?window.embedReaderStep?.(1):start({type:'step',delta:1});
    bar.querySelector('select').onchange=event=>window.switchViewerLang?.(event.target.value);
    bar.querySelector('[data-full]').onclick=fullscreen;
    bindReaderLink(bar.querySelector('.embed-brand'));
    bar.addEventListener('keydown',event=>{if(event.key==='Escape'){bar.querySelector('details').open=false;bar.querySelector('summary').focus();}});
    bar.addEventListener('focusin',()=>toggleEmbedControls(true));
    // Page hover and arrow keys are reading gestures, not requests for chrome.
    // Tab restores the controls before moving keyboard focus; center tap still toggles them.
    document.addEventListener('keydown',event=>{if(event.key==='Tab')toggleEmbedControls(true);},true);

    const edges=createBookEdges(frame),showEdges=new URLSearchParams(location.search).get('bookEdges')!=='0';
    const fit=()=>{
        const {clientWidth:w,clientHeight:h}=document.documentElement,thickness=getBookThickness(Math.max(0,total-2));
        const width=showEdges?fitBookPageWidth(w-4,h-4,1,thickness):Math.min(w-2,(h-2)*9/16);
        frame.style.width=`${width}px`;frame.style.height=`${width*16/9}px`;
        progress.style.setProperty('--embed-progress-width',`${width*.9}px`);
        paintBookEdges(edges,showEdges?{thickness,left:direction==='rtl'?thickness:0,right:direction==='rtl'?0:thickness}:null,{scale:width/360,height:width*16/9,rightX:width});
    };
    const observer=new ResizeObserver(fit);observer.observe(document.documentElement);fit();
    const initialBar=initializeViewerPageSegments({host:progress,
        snapshot:()=>({total:loaded?total:0,current:embedStartIndex(display.startPage,total),active:[embedStartIndex(display.startPage,total)],groups:Array.from({length:total},(_,i)=>[i]),rtl:direction==='rtl',label:i=>`${i+1} / ${total}`}),
        preview:()=>{},hidePreview:()=>{},onHold:()=>{},navigate:index=>start({type:'seek',index})});
    const initialControls=()=>updateEmbedControls({index:embedStartIndex(display.startPage,total),total,languages:[],language:'',direction,spread:false,canPrevious:loaded&&display.startPage>1&&!starting,canNext:loaded&&embedStartIndex(display.startPage,total)<total-1&&!starting});
    document.addEventListener('fullscreenchange',updateFullscreenButtons);
    document.addEventListener('visibilitychange',updateFullscreenButtons);
    async function load(){
        status.textContent=t('表紙を読み込んでいます…','Loading cover…');button.disabled=true;
        try{
            const data=await access(),meta=await coverDirection(data);revision=data.revision;direction=meta.direction;total=Math.max(1,Math.min(100000,meta.total));
            readerPosition.language=data.defaultLang||'';
            name.textContent=data.title||'DSF Reader';gate.dataset.direction=direction;fit();
            const thumb=gate.querySelector('.embed-cover-image');thumb.querySelector('img')?.remove();
            if(data.thumbnail){const img=new Image();img.alt='';img.draggable=false;img.src=data.thumbnail;img.onerror=()=>img.remove();thumb.append(img);}
            loaded=true;status.textContent='';button.textContent='Open Read.';button.setAttribute('aria-label',t('リードを開く','Open Read'));
        }catch(error){loaded=false;status.textContent=unavailableMessage(error);button.textContent=t('再試行','Retry');}
        button.disabled=false;initialControls();initialBar.update();
    }
    async function start(action){
        if(starting)return;
        if(!loaded){await load();return;}
        starting=true;intent=action;button.disabled=true;gate.setAttribute('aria-busy','true');initialControls();
        status.textContent=t('本文とフォントを読み込んでいます…','Loading pages and fonts…');
        try{
            const data=await access();if(data.revision!==revision){location.reload();return;}
            // Keep the cover visible until the actual Reader has finished loading.
            initialBar.destroy();resolveStart();
        }catch(error){starting=false;intent=null;gate.removeAttribute('aria-busy');status.textContent=unavailableMessage(error);button.disabled=false;initialControls();}
    }
    button.onclick=()=>start({type:'open'});
    let pointer=null;
    gate.style.touchAction='pan-y';
    gate.addEventListener('dragstart',event=>event.preventDefault());
    gate.addEventListener('pointerdown',event=>{if(event.target.closest('button,a')||event.isPrimary===false)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};gate.setPointerCapture(event.pointerId);event.stopPropagation();});
    gate.addEventListener('pointerup',event=>{
        if(pointer?.id!==event.pointerId)return;const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer=null;event.stopPropagation();
        if(Math.abs(dx)>=35&&Math.abs(dx)>Math.abs(dy)*1.3){const forward=direction==='rtl'?dx>0:dx<0;if(forward||display.startPage>1)void start({type:'step',delta:forward?1:-1});}
    });
    gate.addEventListener('pointercancel',()=>{pointer=null;});
    const firstKey=event=>{
        if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.closest('input,select,button,a,summary'))return;
        event.preventDefault();event.stopImmediatePropagation();
        if(starting)return;
        const forward=direction==='rtl'?event.key==='ArrowLeft':event.key==='ArrowRight';if(forward||display.startPage>1)void start({type:'step',delta:forward?1:-1});
    };
    window.addEventListener('keydown',firstKey,true);
    finishStart=({ready,begin})=>{
        if(!starting)return;
        finishStart=null;window.removeEventListener('keydown',firstKey,true);observer.disconnect();gate.remove();document.body.classList.remove('embed-waiting');
        if(!ready){heading.hidden=true;bar.hidden=true;progress.hidden=true;return;}
        reading=true;
        begin({page:display.startPage,intent,view:embedView});
        toggleEmbedControls(true);
        setInterval(checkAccess,60000);
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkAccess();});
    };
    initialControls();await load();await started;
}
async function checkAccess() {
    if(!reading || checkBusy)return;checkBusy=true;
    // Keep an already-authorized page visible during the background request.
    // A previously failed check stays hidden until a successful response.
    try {const data=await access();if(data.revision!==revision){unavailable=true;location.reload();return;} unavailable=false;document.querySelector('#embed-unavailable')?.remove();}
    catch (error) {
        unavailable=true;
        if(!document.querySelector('#embed-unavailable')){
            const panel=document.createElement('section');panel.id='embed-unavailable';
            const text=document.createElement('p');text.setAttribute('role','status');
            const retry=document.createElement('button');retry.textContent=t('再試行','Retry');retry.onclick=checkAccess;
            const link=document.createElement('a');link.href=normalUrl;link.target='_blank';link.rel='noopener';link.textContent=t('Readerで開く','Open Reader');panel.append(text,retry,link);document.body.append(panel);
            bindReaderLink(link);
        }
        document.querySelector('#embed-unavailable p').textContent=unavailableMessage(error);
    } finally {checkBusy=false;document.body.classList.toggle('embed-checking',unavailable);}
}
export function updateEmbedControls({index,total,languages,language,direction,spread,canPrevious,canNext}) {
    if(!embedEditionId)return;
    readerPosition={index,language:language||readerPosition.language};syncReaderLinks();
    const bar=document.querySelector('#embed-controls');if(!bar)return;
    bar.dataset.direction=direction;bar.dataset.spread=String(!!spread);
    bar.querySelector('output').textContent=`${index+1} / ${total}`;
    bar.querySelector('[data-prev]').disabled=canPrevious===false;bar.querySelector('[data-next]').disabled=canNext===false;
    const select=bar.querySelector('select');
    if([...select.options].map(o=>o.value).join()!==languages.join())select.replaceChildren(...languages.map(code=>new Option(code,code)));
    select.value=language;select.parentElement.hidden=languages.length<2;
    bar.querySelector('details').hidden=languages.length<2;
}
