import {createViewerPoseTransition} from './viewer-pose-transition.js';
import {getBookSpinePresentation, renderBookSpine} from './book-spine-design.js';

const iconPaths = {
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
    spine:'<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M10.5 7h3M10.5 17h3"/>',
    edge:'<path d="M6 3.5h12v17H6zM9 5v14M12 5v14M15 5v14"/>',
    peek:'<path d="M5 4l7 5 7-5v14l-7 4-7-4zM12 9v13M8 3l4 6 4-6"/>',
    open:'<path d="M3 5q5-2 9 1 4-3 9-1v14q-5-2-9 1-4-3-9-1zM12 6v14"/>',
    left:'<path d="m15.5 5-7 7 7 7"/>',
    right:'<path d="m8.5 5 7 7-7 7"/>',
};
export function setViewerReaderIcon(button, icon, label) {
    if(button.dataset.readerIcon !== icon) {
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[icon]}</svg>`;
        button.dataset.readerIcon = icon;
    }
    button.setAttribute('aria-label',label);
}
const KEY = 'dsf.viewer.reader-chrome.v1';
const defaults = {number:true, title:true, total:true, numberEdge:'top', numberAlign:'outer', metaEdge:'top'};
export function initializeViewerReaderChrome({getSnapshot, onLayoutChange, beforePose, onSettingsChange, onPoseChange, getPeek, renderPosePage}) {
    let prefs = {...defaults}, mode = '', phase='edge', transition=null, serial=0, remembered=null;
    try {
        const saved = JSON.parse(localStorage.getItem(KEY));
        for (const key of ['number','title','total']) if (typeof saved?.[key] === 'boolean') prefs[key] = saved[key];
        for (const key of ['numberEdge','metaEdge']) if (['top','bottom'].includes(saved?.[key])) prefs[key] = saved[key];
        if (['outer','center','inner'].includes(saved?.numberAlign)) prefs.numberAlign = saved.numberAlign;
    } catch {}
    document.body.classList.add('viewer-reader-chrome');
    const labels = document.createElement('div'); labels.id = 'viewer-page-furniture';
    const rail = document.createElement('nav'); rail.id = 'viewer-reader-controls'; rail.setAttribute('aria-label','本の表示とページ操作');
    const pose = document.createElement('div'); pose.id = 'viewer-book-pose'; pose.hidden = true;
    const up = document.createElement('button'), down = document.createElement('button');
    for (const [button, direction] of [[up,'up'],[down,'down']]) {
        button.type='button';button.dataset.bookDirection=direction;
        button.setAttribute('aria-keyshortcuts',direction==='up'?'ArrowUp':'ArrowDown');
        button.onclick=()=>step(direction);
    }
    const info=document.getElementById('viewer-info-btn');setViewerReaderIcon(info,'info','作品情報');
    rail.append(info, up, down, document.getElementById('viewer-nav-left'), document.getElementById('viewer-nav-right'));
    rail.hidden = true;
    document.body.append(labels, rail, pose);
    const settings = document.createElement('details'); settings.id = 'viewer-page-settings';
    settings.innerHTML = `<summary title="ページの表示設定">表示</summary><div class="viewer-page-settings-panel">
        <strong>ページの表示</strong><p>設定はこの端末に保存されます。</p>
        <label><input type="checkbox" name="number"> ページ番号</label>
        <label>番号の上下 <select name="numberEdge"><option value="top">上部</option><option value="bottom">下部</option></select></label>
        <label>番号の位置 <select name="numberAlign"><option value="outer">小口側</option><option value="center">中央</option><option value="inner">ノド側</option></select></label>
        <hr><label><input type="checkbox" name="title"> タイトル</label>
        <label><input type="checkbox" name="total"> 総ページ数</label>
        <label>タイトル・総数 <select name="metaEdge"><option value="top">上部中央</option><option value="bottom">下部中央</option></select></label>
        <p>番号も中央に置く場合は、同じ行にまとめます。</p><button type="button" class="reader-settings-reset">初期設定に戻す</button>
        <button type="button" class="reader-settings-close">閉じる</button></div>`;
    document.querySelector('#viewer-header .ui-controls').prepend(settings);
    function syncInputs() {
        for (const el of settings.querySelectorAll('[name]')) {
            if (el.type === 'checkbox') el.checked = prefs[el.name]; else el.value = prefs[el.name];
        }
    }
    function save() {
        try {localStorage.setItem(KEY,JSON.stringify(prefs));} catch {}
        update(); onLayoutChange();
    }
    syncInputs();
    settings.addEventListener('change', e => {
        const el = e.target; if (!(el.name in defaults)) return;
        prefs[el.name] = el.type === 'checkbox' ? el.checked : el.value; save();
    });
    settings.querySelector('.reader-settings-reset').onclick = () => {prefs = {...defaults}; syncInputs(); save();};
    settings.querySelector('.reader-settings-close').onclick = () => {settings.open = false;};
    settings.addEventListener('toggle', () => {if(settings.open) window.toggleUi(true); onSettingsChange?.(settings.open);});
    settings.addEventListener('keydown', e => {if(e.key==='Escape') {settings.open=false; settings.querySelector('summary').focus();}});
    document.addEventListener('pointerdown', e => {if(!settings.contains(e.target)) settings.open = false;});
    document.addEventListener('viewer-chrome-change', () => {if(!document.body.classList.contains('viewer-ui-visible')) settings.open=false;});
    const states=['spine','edge','peek','reading'];
    const actionLabels={spine:'半回転して背表紙を表示',edge:'閉じて小口を表示',peek:'ページを少し開いて覗く',reading:'このページを開く'};
    function state(){return transition?.from || (mode==='edge'&&phase==='peek'?'peek':mode||'reading');}
    function syncControls(){
        const current=state(),at=states.indexOf(current),snapshot=getSnapshot();rail.dataset.bookState=current;
        for(const [button,offset] of [[up,-1],[down,1]]){
            const target=states[at+offset],icon=target||current;
            const label=target?(current==='spine'&&target==='edge'?'半回転して小口を表示':current==='reading'?'ページを少し閉じて覗く':actionLabels[target]):(current==='spine'?'背表紙を表示中':'ページを開いています');
            setViewerReaderIcon(button,icon==='reading'?'open':icon,label);
            if(!button.querySelector('.reader-direction-mark')){
                const mark=document.createElement('span');mark.className='reader-direction-mark';mark.setAttribute('aria-hidden','true');
                mark.innerHTML=`<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${offset<0?'M6 10V2M2.5 5.5 6 2l3.5 3.5':'M6 2v8M2.5 6.5 6 10l3.5-3.5'}"/></svg>`;button.append(mark);
            }
            button.dataset.targetState=target||'';button.title=label+(offset<0?'（↑）':'（↓）');
            button.disabled=!target||!snapshot?.thickness||snapshot.busy||!!transition;
        }
    }
    function setEdgePhase(value){phase=value;syncControls();}
    const header=document.getElementById('viewer-header');
    new ResizeObserver(()=>document.documentElement.style.setProperty('--reader-header-bottom',header.getBoundingClientRect().bottom+'px')).observe(header);
    const motion=createViewerPoseTransition({render:renderPosePage});
    function spineMarkup(data){const el=document.createElement('div');renderBookSpine(el,getBookSpinePresentation(data.design,{title:data.title,author:data.author,publisherName:data.publisher,width:360*data.rect.height/640,thickness:data.thickness}));return el.innerHTML;}
    function cancelPose() {
        serial++;transition=null;motion.cancel();document.body.classList.remove('viewer-fan-preparing');
        mode='';phase='edge';pose.hidden=true;pose.replaceChildren();onPoseChange?.('',null);
        document.body.classList.remove('viewer-book-pose-active');syncControls();
    }
    function restore(from){
        transition=null;document.body.classList.remove('viewer-fan-preparing');
        if(from==='reading'){cancelPose();return;}
        mode=from==='peek'?'edge':from;
        if(from!=='peek')getPeek()?.clear();
        update();syncControls();
    }
    function changeTo(target,manual=false,readingIndex){
        const from=state(),data=getSnapshot();
        if(target===from||transition||!data?.thickness||data.busy)return false;
        beforePose();const id=++serial;
        transition={from,to:target,progress:0,finish:null};syncControls();
        const peek=getPeek();
        const done=accept=>{
            if(id!==serial)return;
            if(!accept){restore(from);return;}
            transition=null;document.body.classList.remove('viewer-fan-preparing');
            if(target==='reading'){
                if(from==='peek')peek.confirm(readingIndex);else cancelPose();
            }else if(target==='peek'){mode='edge';phase='peek';update();}
            else {if(from==='peek')remembered={key:data.peekKey,index:peek.sourceIndex};peek.clear();mode=target;phase='edge';update();}
            syncControls();
        };
        if(from==='peek'||target==='peek'){
            // Decode the fan before animating. While loading, keep the reading page visible.
            const index=from==='reading'?data.peekIndex:(remembered?.key===data.peekKey?remembered.index:data.peekIndex);
            if(from!=='peek'){
                if(from==='reading')document.body.classList.add('viewer-fan-preparing');
                mode='edge';update();
            }
            Promise.resolve(from==='peek'?peek.ready:peek.prepare(index)).then(ready=>{
                if(id!==serial)return;
                if(!ready){done(false);return;}
                const readingData=from==='peek'&&target==='reading'?getSnapshot(readingIndex??peek.sourceIndex):data;
                motion.playFan(from,target,readingData,peek.element,{manual,onFinish:done});
                document.body.classList.remove('viewer-fan-preparing');
                if(manual&&transition){motion.draw(transition.progress);if(transition.finish!==null)motion.finish(transition.finish);}
            }).catch(()=>done(false));
        }else motion.play(from==='reading'?'':from,data,spineMarkup(data),{to:target,manual,onFinish:done});
        return true;
    }
    function step(direction,manual=false){const at=states.indexOf(state()),target=states[at+(direction==='up'?-1:1)];return target?changeTo(target,manual):false;}
    function openReading(manual=false,readingIndex){return changeTo('reading',manual,readingIndex);}
    function beginGesture(action){
        if(matchMedia('(prefers-reduced-motion:reduce)').matches)return false;
        return action==='open'?openReading(true):step(action,true);
    }
    function drawGesture(p){if(transition)transition.progress=p;motion.draw(p);}
    function finishGesture(accept){if(transition)transition.finish=accept;motion.finish(accept);}
    function update() {
        const snapshot = getSnapshot(); labels.replaceChildren();
        if (!snapshot) {rail.hidden = true; cancelPose(); return;}
        rail.hidden = false;
        const {rect, pages, title, total, thickness, busy} = snapshot;
        // Mobile controls overlay the actual page instead of reserving a side column.
        const style = document.documentElement.style;
        style.setProperty('--reader-controls-left',`${rect.right-60}px`);
        style.setProperty('--reader-controls-top',`${Math.max(rect.top+8,rect.bottom-316)}px`);
        style.setProperty('--reader-progress-left',`${rect.left+14}px`);
        const bottomLabels=(prefs.number&&prefs.numberEdge==='bottom')||((prefs.title||prefs.total)&&prefs.metaEdge==='bottom');
        style.setProperty('--reader-progress-top',`${rect.bottom-(bottomLabels?60:34)}px`);
        style.setProperty('--reader-progress-width',`${Math.max(40,rect.width-28)}px`);

        for (const [index, page] of pages.entries()) {
            if (!page.label) continue;
            const box = document.createElement('div'); box.className = 'viewer-page-labels';box.dataset.cover=String(!!page.cover);
            Object.assign(box.style, {left: (rect.left + index*rect.width/pages.length)+'px', top:rect.top+'px', width:rect.width/pages.length+'px', height:rect.height+'px'});
            const meta = document.createElement('span'); meta.className = 'reader-page-meta'; meta.dataset.edge = prefs.metaEdge;
            if(prefs.title) {const name=document.createElement('span'); name.className='reader-page-title'; name.textContent=title; name.title=title; meta.append(name);}
            if(prefs.total) {const count=document.createElement('span'); count.className='reader-page-total';count.textContent=(prefs.title&&title?' / ':'')+total;meta.append(count);}
            const number=document.createElement('span'); number.className='reader-page-number'; number.textContent=page.label; number.dataset.edge=prefs.numberEdge;
            number.dataset.align=prefs.numberAlign==='center'?'center':(prefs.numberAlign==='outer'?page.side:(page.side==='left'?'right':'left'));
            if(prefs.number && prefs.numberAlign==='center' && prefs.numberEdge===prefs.metaEdge && (prefs.title||prefs.total)) {
                number.classList.add('is-inline'); meta.prepend(number);
            } else if(prefs.number) box.append(number);
            if(prefs.title||prefs.total) box.append(meta);
            labels.append(box);
        }
        onPoseChange?.(mode,snapshot);
        syncControls();
        if(mode) {
            if(!thickness||busy) {cancelPose();return;}
            pose.hidden=false; pose.dataset.mode=mode; pose.setAttribute('role',mode==='edge'?'button':'img');pose.tabIndex=mode==='edge'?0:-1;
            pose.title=mode==='edge'?'小口の位置をダブルタップして覗く':'';
            pose.setAttribute('aria-label',mode==='spine'?'背表紙':'小口面');
            const scale=rect.height/640, width=thickness*scale;
            pose.removeAttribute('style');
            Object.assign(pose.style,{left:(rect.left+rect.width/2-width/2)+'px',top:rect.top+'px',width:width+'px',height:rect.height+'px'});
            if(mode==='spine') renderBookSpine(pose,getBookSpinePresentation(snapshot.design,{title,author:snapshot.author,publisherName:snapshot.publisher,width:360*scale,thickness}));
            else pose.replaceChildren();
            document.body.classList.add('viewer-book-pose-active');

        }
    }
    syncControls();
    return {update,cancelPose,step,setEdgePhase,openReading,beginGesture,drawGesture,finishGesture,get state(){return state();},get transitioning(){return !!transition;},get mode(){return mode;},get pageNumberSettings(){return {...prefs};},get active(){return !!mode||!!transition||motion.active;},get settingsOpen(){return settings.open;}};
}
