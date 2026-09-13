import {paintViewerReadingGuides} from './viewer-reading-guide-geometry.js';
import {collectReadingLineGroups} from './viewer-reading-assist-lines.js';
/** Reader-local paint/zoom preferences; no authoring or delivery mutations. */
export function initializeViewerReadingGuides({onLayoutChange = () => {}, onAssistanceChange = () => {}} = {}) {
    const $ = id => document.getElementById(id);
    const menu=$('viewer-reading-guide'), toggle=$('reading-guide-enabled'), strength=$('reading-guide-strength'), mode=$('reading-guide-mode');
    const zoom=$('reading-guide-zoom'), blur=$('reading-guide-blur'), stage=$('viewer-stage');
    let saved={}; try {saved=JSON.parse(localStorage.getItem('dsf-reader-line-guides')||'{}')||{};} catch {}
    toggle.checked=saved.enabled===true;
    strength.value=Number.isFinite(saved.strength)?Math.max(10,Math.min(70,saved.strength)):25;
    mode.value=['all','focus','lens'].includes(saved.mode)?saved.mode:'active';
    zoom.value=[1.5,2,3].includes(saved.zoom)?String(saved.zoom):'2';
    blur.value=Number.isFinite(saved.blur)?Math.max(.4,Math.min(2.4,saved.blur)):1.2;
    const panel=document.createElement('aside'); panel.id='reader-assist-panel'; panel.hidden=true;
    panel.innerHTML='<div class="reader-assist-heading"><b id="reader-assist-title"></b><button id="reader-assist-close" type="button">×</button></div><div id="reader-assist-lens" tabindex="0" role="region"></div><p id="reader-assist-lens-hint"></p><p id="reader-assist-status" role="status" aria-live="polite"></p><div class="reader-assist-nav"><button id="reader-assist-prev" type="button"></button><button id="reader-assist-next" type="button"></button></div>';
    document.body.append(panel);
    const lens=$('reader-assist-lens'); let selected=null, groups=[], point=null, clone=null, drag=null, queued=false, dock=0, bottomDock=0, lensDrag=null, lensScale=1, lastAssisting=false;
    const assisting=()=>toggle.checked&&['focus','lens'].includes(mode.value);
    const labels=()=>{
        const en=document.documentElement.lang==='en';
        menu.querySelector('summary').title=en?'Reading guides':'読書ガイド'; menu.querySelector('summary').setAttribute('aria-label',menu.querySelector('summary').title);
        $('reading-guide-label').textContent=en?'Enable reading assistance':'読書補助を使う';
        $('reading-guide-strength-label').textContent=en?'Line strength':'線の濃さ'; $('reading-guide-mode-label').textContent=en?'Mode':'表示';
        ['Current line only','All lines','Focus','Magnifier'].forEach((label,i)=>mode.options[i].textContent=en?label:['読んでいる行だけ','すべての行','集中表示','拡大鏡'][i]);
        $('reading-guide-zoom-label').textContent=en?'Magnification':'倍率'; $('reading-guide-blur-label').textContent=en?'Blur':'ぼかし';
        $('reading-guide-note').textContent=assisting()?(en?'Move over text or trace with one finger. Ruby stays with its line. Use page arrows to turn pages; pinch zoom remains available.':'本文上でマウスを動かすか、指でなぞると追従します。ルビも一緒に表示。ページ移動は矢印、拡大はピンチで操作できます。'):(en?'Tap text for a left/bottom marker. Ruby and emphasis are avoided. Fixed text pages only.':'本文タップで縦書きは左、横書きは下に目印を表示。ルビ・圏点を避けます。固定テキストページ用。');
        $('reader-assist-title').textContent=mode.value==='lens'?(en?'Magnifier':'拡大鏡'):(en?'Focus':'集中表示');
        $('reader-assist-close').title=en?'Turn off reading assistance':'読書補助を終了'; $('reader-assist-close').setAttribute('aria-label',$('reader-assist-close').title);
        $('reader-assist-prev').textContent=en?'Previous line':'前の行'; $('reader-assist-next').textContent=en?'Next line':'次の行';
        lens.setAttribute('aria-label',en?'Magnified line. Drag or scroll to read.':'拡大した行。ドラッグやスクロールで文字送り。');
        $('reader-assist-lens-hint').textContent=en?'Drag inside the magnifier to read along.':'拡大枠の中をなぞって文字送り';
        updateStatus();
    };
    function updateStatus(){
        const index=groups.findIndex(g=>g.node===selected), en=document.documentElement.lang==='en';
        $('reader-assist-status').textContent=index<0?(en?'Point to a text line. Image pages are not supported.':'本文を指して行を選択。画像ページは対象外です。'):`${index+1} / ${groups.length} ${en?'lines':'行'}`;
        $('reader-assist-prev').disabled=index<=0; $('reader-assist-next').disabled=index<0||index>=groups.length-1;
        panel.dataset.writing=selected?.dataset.readingLine||stage.querySelector('[data-reading-line]')?.dataset.readingLine||'vertical';
        const rect=selected?.getBoundingClientRect();
        panel.dataset.focusSide=panel.dataset.writing==='vertical'?(rect && rect.left+rect.width/2>innerWidth/2?'left':'right'):(rect && rect.top+rect.height/2>innerHeight/2?'top':'bottom');
    }
    function clearPaint(){stage.querySelectorAll('.reader-line-muted,.reader-line-focused').forEach(n=>n.classList.remove('reader-line-muted','reader-line-focused'));}
    function renderLens(){
        const group=groups.find(g=>g.node===selected), page=selected?.closest('.viewer-fixed-text-page');
        if (!group||!page||mode.value!=='lens'||!toggle.checked) {lens.replaceChildren();clone=null;return;}
        if(!clone){
            clone=page.cloneNode(false); clone.removeAttribute('role');clone.removeAttribute('aria-label');clone.removeAttribute('id');clone.setAttribute('aria-hidden','true');
            for(const node of group.members){const copy=node.cloneNode(true);copy.classList.remove('reader-line-muted','reader-line-focused','reading-line-active');copy.removeAttribute('id');clone.append(copy);}
            lens.replaceChildren(clone);
        }
        const rect=page.getBoundingClientRect(), scale=rect.width/parseFloat(page.style.width), z=scale*Number(zoom.value);
        const b=group.box, vertical=selected.dataset.readingLine==='vertical';
        const members=group.members.map(n=>({x:parseFloat(n.style.left),y:parseFloat(n.style.top),w:parseFloat(n.style.width),h:parseFloat(n.style.height)}));
        const left=Math.min(...members.map(r=>r.x)),right=Math.max(...members.map(r=>r.x+r.w)),top=Math.min(...members.map(r=>r.y)),bottom=Math.max(...members.map(r=>r.y+r.h));
        const px=vertical?(left+right)/2:(point?.x??b.x+b.w/2), py=vertical?(point?.y??b.y+b.h/2):(top+bottom)/2;
        const clampAxis=(target,start,end,size)=>end-start<=size/z?(size-(start+end)*z)/2:Math.max(size-end*z,Math.min(-start*z,target));
        const tx=vertical?lens.clientWidth/2-px*z:clampAxis(lens.clientWidth/2-px*z,left,right,lens.clientWidth);
        const ty=vertical?clampAxis(lens.clientHeight/2-py*z,top,bottom,lens.clientHeight):lens.clientHeight/2-py*z;
        lens.style.backgroundColor=getComputedStyle(page).backgroundColor;
        lensScale=z;
        // Keep the position at the actual visible centre, including endpoint clamps.
        // Starting another drag must move immediately, without a hidden dead zone.
        point={x:(lens.clientWidth/2-tx)/z,y:(lens.clientHeight/2-ty)/z};
        clone.style.transformOrigin='0 0';clone.style.transform=`translate(${tx}px,${ty}px) scale(${z})`;
    }
    function draw(){
        clearPaint();
        if(selected&&!stage.contains(selected)){selected=null;groups=[];clone=null;point=null;}
        const page=selected?.closest('.viewer-fixed-text-page');
        if(page)groups=collectReadingLineGroups(page);
        if(assisting()&&mode.value==='focus'&&selected){
            const group=groups.find(g=>g.node===selected);
            // Dim grouped text only. Unmatched annotations remain clear.
            for(const p of stage.querySelectorAll('.viewer-fixed-text-page'))for(const g of collectReadingLineGroups(p))for(const node of g.members)node.classList.add(group?.members.includes(node)?'reader-line-focused':'reader-line-muted');
        }
        paintViewerReadingGuides(stage,{enabled:toggle.checked,mode:mode.value==='all'?'all':'active'});
        panel.hidden=!assisting();panel.dataset.mode=mode.value;lens.hidden=mode.value!=='lens';$('reader-assist-lens-hint').hidden=lens.hidden;
        updateStatus();
        const horizontal=panel.dataset.writing==='horizontal';
        const nextDock=assisting()&&mode.value==='lens'&&!horizontal?(innerWidth<=650?140:240):0;
        const nextBottom=assisting()&&mode.value==='lens'&&horizontal?240:0;
        if(nextDock!==dock||nextBottom!==bottomDock){dock=nextDock;bottomDock=nextBottom;document.body.dataset.readingAssistBottom=String(bottomDock);document.body.style.setProperty('--reader-assist-bottom',bottomDock+'px');document.body.dataset.readingAssistDock=String(dock);document.body.style.setProperty('--reader-assist-space',dock+'px');onLayoutChange();}
        updateStatus();renderLens();
    }
    function paint(){
        document.body.dataset.readingGuides=toggle.checked?'on':'off';document.body.dataset.readingGuideMode=mode.value;
        document.body.style.setProperty('--reading-guide-alpha',Number(strength.value)/100);document.body.style.setProperty('--reader-blur',blur.value+'px');
        strength.disabled=!toggle.checked;mode.disabled=!toggle.checked;zoom.disabled=!toggle.checked;blur.disabled=!toggle.checked;
        $('reading-guide-zoom-control').hidden=mode.value!=='lens';$('reading-guide-blur-control').hidden=mode.value!=='focus';
        clone=null;drag=null;lensDrag=null;draw();labels();
        if(lastAssisting!==assisting()){lastAssisting=assisting();onAssistanceChange(lastAssisting);}
    }
    function save(){paint();try{localStorage.setItem('dsf-reader-line-guides',JSON.stringify({enabled:toggle.checked,strength:Number(strength.value),mode:mode.value,zoom:Number(zoom.value),blur:Number(blur.value)}));}catch{}}
    function findAt(x,y){
        let best=null,distance=Infinity;
        for(const line of stage.querySelectorAll('.viewer-fixed-text-line[data-reading-line]')){
            const r=line.getBoundingClientRect(),p=line.closest('.viewer-fixed-text-page').getBoundingClientRect();
            if(!line.textContent.trim()||!r.width||!r.height||x<p.left||x>p.right||y<p.top||y>p.bottom)continue;
            const d=Math.hypot(Math.max(r.left-x,0,x-r.right),Math.max(r.top-y,0,y-r.bottom));
            if(d<distance){best=line;distance=d;}
        }
        return distance<=20?best:null;
    }
    function highlightAt(x,y){
        if(!toggle.checked)return false;
        const best=findAt(x,y);if(!best)return false;
        const page=best.closest('.viewer-fixed-text-page'),r=page.getBoundingClientRect();
        point={x:(x-r.left)*parseFloat(page.style.width)/r.width,y:(y-r.top)*parseFloat(page.style.height)/r.height};
        if(best===selected){renderLens();return true;}
        stage.querySelectorAll('.reading-line-active').forEach(n=>n.classList.remove('reading-line-active'));selected=best;best.classList.add('reading-line-active');clone=null;draw();return true;
    }
    function step(delta) {
        const index=groups.findIndex(g=>g.node===selected), next=groups[index+delta];
        if (!next) return;
        const r=next.node.getBoundingClientRect(), vertical=next.node.dataset.readingLine==='vertical';
        // Start reading the new line at its beginning, rather than its midpoint.
        highlightAt(r.left+(vertical?r.width/2:Math.min(20,r.width/2)), r.top+(vertical?Math.min(20,r.height/2):r.height/2));
    }
    function handleKey(e){
        if(!assisting()||!selected||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea'))return false;
        const vertical=selected.dataset.readingLine==='vertical';const delta=vertical?{ArrowLeft:1,ArrowRight:-1}[e.key]:{ArrowDown:1,ArrowUp:-1}[e.key];
        if(!delta)return false;e.preventDefault();step(delta);return true;
    }
    function moveLensBy(pixels) {
        if(!selected||!point||!clone||mode.value!=='lens') return;
        const axis=selected.dataset.readingLine==='vertical'?'y':'x';
        point[axis]+=pixels/lensScale;
        renderLens();
    }
    lens.addEventListener('pointerdown',e=>{
        if(e.button!==0||!selected||!clone)return;
        menu.open=false;lensDrag={id:e.pointerId,x:e.clientX,y:e.clientY};
        lens.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();lens.focus({preventScroll:true});
    });
    lens.addEventListener('pointermove',e=>{
        if(lensDrag?.id!==e.pointerId)return;
        const vertical=selected?.dataset.readingLine==='vertical';
        moveLensBy(vertical?lensDrag.y-e.clientY:lensDrag.x-e.clientX);
        lensDrag.x=e.clientX;lensDrag.y=e.clientY;e.preventDefault();e.stopPropagation();
    });
    const endLensDrag=e=>{if(lensDrag?.id!==e.pointerId)return;lensDrag=null;if(lens.hasPointerCapture(e.pointerId))lens.releasePointerCapture(e.pointerId);e.stopPropagation();};
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>lens.addEventListener(type,endLensDrag));
    lens.addEventListener('wheel',e=>{if(!selected||e.ctrlKey||e.metaKey)return;const unit=e.deltaMode===1?16:e.deltaMode===2?lens.clientHeight:1;moveLensBy((selected.dataset.readingLine==='vertical'?e.deltaY:(e.deltaX||e.deltaY))*unit);e.preventDefault();e.stopPropagation();},{passive:false});
    lens.addEventListener('keydown',e=>{
        const vertical=selected?.dataset.readingLine==='vertical';
        const amount=vertical?{ArrowDown:60,ArrowUp:-60}[e.key]:{ArrowRight:60,ArrowLeft:-60}[e.key];
        if(!amount)return;moveLensBy(amount);e.preventDefault();e.stopPropagation();
    });
    toggle.onchange=save;strength.oninput=save;mode.onchange=save;zoom.onchange=save;blur.oninput=save;
    $('reader-assist-prev').onclick=()=>step(-1);$('reader-assist-next').onclick=()=>step(1);
    $('reader-assist-close').onclick=()=>{toggle.checked=false;save();menu.querySelector('summary').focus();};
    panel.addEventListener('keydown',e=>{handleKey(e);e.stopPropagation();if(e.key==='Escape')$('reader-assist-close').click();});
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.open=false;});
    menu.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
    const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;draw();});};
    new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&!n.classList.contains('reader-line-overlay'))))schedule();}).observe(stage,{childList:true,subtree:true});
    document.fonts?.addEventListener('loadingdone',()=>{clone=null;schedule();});window.addEventListener('resize',schedule);
    paint();
    return {isAssisting:assisting,refreshLabels:labels,highlightAt,handleKey,onViewportChange:schedule,
        beginPointer(e){if(!assisting()||!highlightAt(e.clientX,e.clientY))return false;drag=e.pointerId;return true;},
        movePointer(e,allowHover){if(drag===e.pointerId){highlightAt(e.clientX,e.clientY);return true;}if(allowHover&&e.pointerType==='mouse'&&!e.buttons&&assisting())highlightAt(e.clientX,e.clientY);return false;},
        endPointer(e){if(drag!==e.pointerId)return false;drag=null;return true;},cancelPointer(){drag=null;}};
}
