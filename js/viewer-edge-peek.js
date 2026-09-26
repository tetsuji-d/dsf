/** A curved fan of neighbouring sheets sharing one binding. No reading state is
 * changed until confirmation; CSS strips also support fixed-text surfaces. */
const STRIPS = 16, STRIP_WIDTH=360/STRIPS;
export function projectStrip(el, points, width) {
    el.bookPoints=points;
    const [p,q,r,s] = points;
    const dx1=q.x-r.x, dx2=s.x-r.x, dx3=p.x-q.x+r.x-s.x;
    const dy1=q.y-r.y, dy2=s.y-r.y, dy3=p.y-q.y+r.y-s.y;
    const det=dx1*dy2-dx2*dy1;
    const g=det?(dx3*dy2-dx2*dy3)/det:0, h=det?(dx1*dy3-dx3*dy1)/det:0;
    const a=q.x-p.x+g*q.x, b=s.x-p.x+h*s.x;
    const d=q.y-p.y+g*q.y, e=s.y-p.y+h*s.y;
    el.style.transform=`matrix3d(${a/width},${d/width},0,${g/width},${b/640},${e/640},0,${h/640},0,0,1,0,${p.x},${p.y},0,1)`;
}
// The exposed pages meet within the spine at the selected reading position,
// while the backs of their paper blocks attach across the full spine width.
function paperPoint({side,extent=1,bias=0,bindingWidth=0,hinge=405,stackDepth=0,layer=1,cover=false,lift=0},t,v) {
    const bow=Math.sin(Math.PI*t),attachment=cover?side*bindingWidth*.5:side*bindingWidth*.5*(1-layer)+(hinge-405)*layer;
    const outer=cover?341.5:340-layer*stackDepth*.55;
    const topInset=cover?-.6:1+layer*stackDepth*t;
    const bottomInset=cover?.6:-1;
    const x=405+attachment*(1-t)+bias*(1-extent)*.8*t+side*extent*outer*t+side*bow*(22+lift*25);
    let y=30+v*510+t*(65+(1-extent)*100+v*50)+bow*(18+lift*45)+topInset*(1-v)+bottomInset*v;
    if(!cover && extent===1 && v===1){
        // From above, the rear cover ends higher than the paper toward us.
        // Keep this slope on the side face; do not draw an underside.
        const distance=side*(x-405),half=bindingWidth/2;
        let lo=0,hi=1;
        for(let i=0;i<20;i++){const u=(lo+hi)/2;if(half*(1-u)+341.5*u+22*Math.sin(Math.PI*u)<distance)lo=u;else hi=u;}
        const u=(lo+hi)/2;y=539+115*u+18*Math.sin(Math.PI*u)+layer*stackDepth*.75*t;
    }
    return {x,y};
}
function shapeSheet(sheet, spread, depth=0, lift=0) {
    sheet.dataset.side=spread<0?'left':'right';
    const side=spread<0?-1:1,extent=Math.abs(spread),stackDepth=Number(sheet.dataset.stackDepth||0);
    const cover=sheet.classList.contains('edge-fan-cover'),stack=sheet.classList.contains('edge-fan-stack');
    const layer=stack?(stackDepth?depth/stackDepth:1):1;
    const geometry={hinge:Number(sheet.dataset.hinge||405),side,extent,stackDepth,cover,layer,lift,bias:Number(sheet.dataset.bias||0),bindingWidth:Number(sheet.dataset.bindingWidth||0)};
    const point=(u,v)=>paperPoint(geometry,side<0?1-u:u,v);
    sheet.dataset.attachment=paperPoint(geometry,0,0).x;
    [...sheet.children].forEach((strip,i)=>{
        // Sample beyond both internal seams, including the matching image pixels.
        // Symmetric overlap seals subpixel rasterization cracks on curved strips.
        const start=Math.max(0,i*STRIP_WIDTH-1),end=Math.min(360,(i+1)*STRIP_WIDTH+1);
        const u=start/360,next=end/360,width=end-start;
        strip.style.width=width+'px';strip.dataset.sourceStart=start;
        strip.firstElementChild.style.left=-start+'px';
        projectStrip(strip,[point(u,0),point(next,0),point(next,1),point(u,1)],width);
        strip.style.setProperty('--shade-start',String(.02+.18*(side<0?u:1-u)+lift*.06));
        strip.style.setProperty('--shade-end',String(.02+.18*(side<0?next:1-next)+lift*.06));
    });
}
function makeSheet(html, spread, depth=0, className='',bias=0,bindingWidth=0,stackDepth=0,hinge=405) {
    const sheet=document.createElement('div');sheet.className='edge-fan-sheet '+className;sheet.dataset.hinge=hinge;sheet.dataset.bias=bias;sheet.dataset.bindingWidth=bindingWidth;sheet.dataset.stackDepth=stackDepth;
    for(let i=0;i<STRIPS;i++){
        const strip=document.createElement('div');strip.className='edge-fan-strip';
        const content=document.createElement('div');content.className='edge-peek-content';
        content.style.left=(-i*STRIP_WIDTH)+'px';content.innerHTML=html;strip.append(content);sheet.append(strip);
    }
    shapeSheet(sheet,spread,depth);return sheet;
}
function makePaperEdges(side, depth, bindingWidth, hinge) {
    const ns='http://www.w3.org/2000/svg';
    const sections=[['top',(t)=>[t,0]],['fore-edge',(v)=>[1,v]]];
    return sections.map(([name,coordinates])=>{
        const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 760');svg.classList.add('edge-fan-'+name);
        svg.setAttribute('aria-hidden','true');svg.dataset.side=side<0?'left':'right';svg.dataset.thickness=depth;
        const points=layer=>Array.from({length:21},(_,i)=>{
            const [t,v]=coordinates(i/20);const p=paperPoint({side,stackDepth:depth,bindingWidth,hinge,layer},t,v);return [p.x,p.y];
        });
        const path=(pts,fill,close=false)=>{const el=document.createElementNS(ns,'path');el.setAttribute('d','M'+pts.map(p=>p.join(',')).join(' L')+(close?' Z':''));el.setAttribute('fill',fill);el.setAttribute('stroke','#968e7c');el.setAttribute('stroke-width','.5');svg.append(el);};
        path([...points(0),...points(1).reverse()],name==='fore-edge'?'#ddd5c2':'#e6dfce',true);
        const lines=Math.min(20,Math.ceil(depth/1.6));
        for(let i=1;i<=lines;i++)path(points(i/(lines+1)),'none');
        return svg;
    });
}
function makeBinding(width, color) {
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.classList.add('edge-fan-binding');svg.setAttribute('viewBox','0 0 800 760');svg.setAttribute('aria-hidden','true');
    const left=405-width/2,right=405+width/2;
    svg.dataset.left=left;svg.dataset.right=right;svg.dataset.width=width;
    // Exterior spine joins both covers behind the pages. The reading surfaces
    // cover its middle, exposing only the continuous head/foot of the binding.
    const back=document.createElementNS(ns,'path');back.setAttribute('d',`M${left},29.4 H${right} V540.6 H${left} Z`);
    back.setAttribute('fill',color);svg.append(back);
    const rim=document.createElementNS(ns,'path');rim.setAttribute('d',`M${left},30 H${right} M${left},540 H${right}`);
    rim.setAttribute('fill','none');rim.setAttribute('stroke','#b4ad97');rim.setAttribute('stroke-width','1');svg.append(rim);
    return svg;
}
export function createViewerEdgePeek({getItems, getEndpapers=()=>({}), getNumberSettings=()=>({number:true,numberEdge:"top",numberAlign:"outer"}), onPhaseChange=()=>{}, onConfirm, render, open}) {
    const root=document.createElement('aside');root.id='viewer-edge-peek';root.hidden=true;
    root.innerHTML='<div class="edge-peek-leaf" hidden><div class="edge-fan-scene"></div></div><div class="edge-peek-controls"><label><span class="edge-peek-sr">覗き見るページ</span><input type="range" min="0" value="0" aria-label="覗き見るページ"></label><output></output><button type="button" aria-label="このページを開く" title="このページを開く" disabled><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6h12v12"/></svg></button></div>';
    document.body.append(root);
    const leaf=root.querySelector('.edge-peek-leaf'),content=root.querySelector('.edge-fan-scene'),slider=root.querySelector('input'),status=root.querySelector('output'),button=root.querySelector('button');
    const pose=document.getElementById('viewer-book-pose');
    let items=[],key='',selected=-1,ticket=0,ready=false,snapshot=null,lastTap=null,frame=0,tapTimer=0,suppressClickUntil=0,rendering=false,pendingIndex=null;
    const cache=new Map();
    function markup(index){if(!cache.has(index)){if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(index,render(index));}return cache.get(index);}
    function clear(){drag=null;rendering=false;pendingIndex=null;cancelAnimationFrame(frame);clearTimeout(tapTimer);root.dataset.opened='false';root.hidden=true;leaf.hidden=true;document.body.classList.remove('viewer-edge-fan-active');content.replaceChildren();cache.clear();items=[];key='';selected=-1;ready=false;ticket++;lastTap=null;onPhaseChange('edge');}
    function numberSheet(sheet,label){
        sheet.dataset.pageLabel=label;
        const prefs=getNumberSettings(),align=prefs.numberAlign==='center'?'center':(prefs.numberAlign==='inner'?(sheet.dataset.side==='left'?'right':'left'):sheet.dataset.side);
        for(const page of sheet.querySelectorAll('.edge-peek-content')){
            page.querySelector('.edge-fan-folio')?.remove();
            if(!prefs.number)continue;
            const number=document.createElement('span');number.className='edge-fan-folio';number.textContent=label;number.setAttribute('aria-hidden','true');number.dataset.edge=prefs.numberEdge;number.dataset.align=align;page.append(number);
        }
    }
    function show(index){
        index=Math.max(0,Math.min(items.length-1,Math.round(index)));
        if(rendering){pendingIndex=index;return;}
        void renderSelection(index);
    }
    function settle(id){if(id!==ticket)return;rendering=false;const next=pendingIndex;pendingIndex=null;if(next!==null&&next!==selected)show(next);}
    async function renderSelection(index) {
        index=Math.max(0,Math.min(items.length-1,Math.round(index)));
        if(!items[index]||index===selected)return;
        rendering=true;
        const previous=selected;
        selected=index;slider.value=index;root.dataset.sourceIndex=items[index].index;ready=false;button.disabled=true;
        root.dataset.opened='true';onPhaseChange('peek');
        const ratio=index/Math.max(1,items.length-1), bias=(ratio-.5)*320*(snapshot.rtl?-1:1);
        const bindingWidth=Math.max(2,Math.min(64,snapshot.thickness||8))*1.25;
        const volumeDepth=Math.max(0,Math.min(64,snapshot.thickness||8)*1.1);
        const leftDepth=volumeDepth*(snapshot.rtl?1-ratio:ratio),rightDepth=volumeDepth-leftDepth;
        const hinge=405+(ratio-.5)*bindingWidth*.9*(snapshot.rtl?-1:1);
        const make=(html,spread,depth=0,cls='')=>makeSheet(html,spread,depth,cls,bias,bindingWidth,spread<0?leftDepth:rightDepth,hinge);
        root.dataset.bindingWidth=bindingWidth;
        root.dataset.openRatio=ratio;root.dataset.hinge=hinge;
        const id=++ticket;status.textContent=`${items[index].label} / ${items.length} · 読み込み中`;
        // Build off screen and retain the previous fan until the selected image is decoded.
        const next=document.createElement('div');next.className='edge-fan-pages';
        next.append(makeBinding(bindingWidth,snapshot.design?.backgroundColor||'#173d42'));
        const cover='<div style="position:absolute;inset:0;background:#173d42;border:1px solid #bbbd9d"></div>';
        for(const side of [-1,1]) {
            const board=make(cover,side,0,'edge-fan-cover');board.dataset.side=side<0?'left':'right';next.append(board);
            const remaining=side===(snapshot.rtl?-1:1)?1-ratio:ratio;
            const depth=volumeDepth*remaining;
            root.dataset[side<0?'leftThickness':'rightThickness']=depth;
            // Only the block boundaries need sheet meshes; SVG faces draw the interior paper layers.
            for(const j of [0,10]){const stack=make('',side,j/10*depth,'edge-fan-stack');stack.dataset.side=side<0?'left':'right';next.append(stack);}
        }
        for(const side of [-1,1])next.append(...makePaperEdges(side,Number(root.dataset[side<0?'leftThickness':'rightThickness']),bindingWidth,hinge));
        // Outermost sheets first, neighbouring leaves nearest the reader last.
        const offsets=snapshot.rtl?[[-3,1], [2,-1],[-2,.82],[1,-.82],[-1,.57],[0,-.57]]:
            [[-3,-1],[2,1],[-2,-.82],[1,.82],[-1,-.57],[0,.57]];
        let selectedSheet;
        const boundary=index===0?'start':index===items.length-1?'end':'';
        root.dataset.boundary=boundary;
        if(boundary){
            // At either end, open the selected body page against the real inside cover.
            const side=(snapshot.rtl?-1:1)*(index%2?-1:1), endpaper=getEndpapers()[boundary];
            const inside=make(Number.isInteger(endpaper)?markup(endpaper):'',-side,0,'edge-fan-endpaper');
            inside.dataset.cover=boundary==='start'?'C2':'C3';numberSheet(inside,inside.dataset.cover);next.append(inside);
            selectedSheet=make(markup(items[index].index),side);
            selectedSheet.dataset.sourceIndex=items[index].index;selectedSheet.dataset.selected='true';
            selectedSheet.dataset.openExtent='1';numberSheet(selectedSheet,items[index].label);next.append(selectedSheet);
        } else for(const [offset,spread] of offsets){
            const item=items[index+offset];if(!item)continue;
            const nearEnd=Math.max(0,1-Math.min(index,items.length-1-index)/3);
            const extent=Math.abs(spread)+(1-Math.abs(spread))*nearEnd;
            const sheet=make(markup(item.index),Math.sign(spread)*extent);
            sheet.dataset.sourceIndex=item.index;sheet.dataset.selected=String(offset===0);sheet.dataset.openExtent=extent;
            numberSheet(sheet,item.label);next.append(sheet);if(offset===0)selectedSheet=sheet;
        }
        let timer;
        try {
            await Promise.race([Promise.all([...next.querySelectorAll('[data-selected=true] img,.edge-fan-endpaper img')].map(img=>img.complete&&img.naturalWidth?Promise.resolve():img.decode())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),4000);})]);
            if(id!==ticket)return;
            cancelAnimationFrame(frame);content.replaceChildren(next);ready=true;leaf.hidden=false;
            document.body.classList.add('viewer-edge-fan-active');button.disabled=false;
            status.textContent=`${items[index].label} / ${items.length}`;
            if(previous>=0&&previous!==index&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
                const direction=(index>previous?1:-1)*(snapshot.rtl?1:-1);
                const turn=make(markup(items[previous].index),-.57*direction,0,'edge-fan-turn');next.append(turn);
                let start=performance.now(),held=0,from=0,wasDragging=false;
                function animate(now){
                    if(id!==ticket){turn.remove();return;}
                    let t;
                    if(drag&&Number.isFinite(drag.position)){t=Math.max(0,Math.min(1,Math.abs(drag.position-previous)/Math.max(1,Math.abs(index-previous))));wasDragging=true;}
                    else{if(wasDragging){from=held;start=now;wasDragging=false;}t=from+(1-from)*Math.min(1,(now-start)/260);}
                    if(t===held&&wasDragging){frame=requestAnimationFrame(animate);return;}
                    held=t;const ease=t*t*(3-2*t),spread=-.57*direction*Math.cos(ease*Math.PI);
                    // A thin, bowed edge at the midpoint, rather than a zero-area singularity.
                    turn.dataset.stackDepth=spread<0?leftDepth:rightDepth;
                    shapeSheet(turn,Math.abs(spread)<.018?.018*direction:spread,0,Math.sin(t*Math.PI));
                    if(t<1)frame=requestAnimationFrame(animate);else{turn.remove();settle(id);}
                }
                frame=requestAnimationFrame(animate);
            }else settle(id);
        } catch {if(id===ticket){status.textContent='このページを表示できません';settle(id);}}
        finally {clearTimeout(timer);}
    }
    function confirm(){if(!ready||!items[selected])return;const index=items[selected].index;clear();open(index);}
    function positionAt(e,element) {
        const r=element.getBoundingClientRect();
        let ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width)));
        return (snapshot.rtl?1-ratio:ratio)*(items.length-1);
    }
    function scrub(e,element) {if(!root.hidden&&items.length)void show(positionAt(e,element));}
    function activate(e,el){
        clearTimeout(tapTimer);suppressClickUntil=performance.now()+400;
        if(el===pose){scrub(e,pose);}else (onConfirm?onConfirm():confirm());
    }
    pose.addEventListener('keydown',e=>{if(!root.hidden&&['Enter',' '].includes(e.key)){e.preventDefault();void show(Math.max(0,items.findIndex(item=>item.index===snapshot.peekIndex)));}});
    slider.oninput=()=>void show(+slider.value);
    slider.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&!e.buttons)scrub(e,slider);});
    for(const el of [pose,slider,leaf]) {
        el.addEventListener('dblclick',e=>{if(root.hidden)return;e.preventDefault();e.stopPropagation();activate(e,el);});
        let down=null;
        el.addEventListener('pointerdown',e=>{if(root.hidden||e.pointerType!=='touch')return;down={id:e.pointerId,x:e.clientX,y:e.clientY};});
        el.addEventListener('pointerup',e=>{
            if(!down||e.pointerId!==down.id)return;
            const tapped=Math.hypot(e.clientX-down.x,e.clientY-down.y)<10;down=null;
            if(!tapped){lastTap=null;suppressClickUntil=performance.now()+400;return;}
            const now=performance.now();if(lastTap&&lastTap.element===el&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<24&&now-lastTap.time<360&&lastTap.index===selected){lastTap=null;e.preventDefault();activate(e,el);}
            else lastTap={time:now,index:selected,element:el,x:e.clientX,y:e.clientY};
        });
        el.addEventListener('pointercancel',()=>{down=null;lastTap=null;});
    }

    let drag=null;
    leaf.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,index:pendingIndex??selected,position:pendingIndex??selected};try{leaf.setPointerCapture(e.pointerId);}catch{}});
    leaf.addEventListener('pointermove',e=>{
        if(e.pointerType==='mouse'&&!e.buttons){scrub(e,leaf);return;}
        if(drag?.id===e.pointerId&&Math.abs(e.clientX-drag.x)>12&&Math.abs(e.clientX-drag.x)>Math.abs(e.clientY-drag.y)*1.35){drag.position=drag.index+(e.clientX-drag.x)/Math.max(1,leaf.getBoundingClientRect().width)*(items.length-1)*(snapshot.rtl?1:-1);show(drag.position>drag.index?Math.ceil(drag.position):Math.floor(drag.position));}
    });
    leaf.addEventListener('pointerup',()=>{drag=null;});leaf.addEventListener('pointercancel',()=>{drag=null;});
    for(const el of [pose,leaf])el.addEventListener('click',e=>{
        e.stopPropagation();if(root.hidden||performance.now()<suppressClickUntil)return;
        clearTimeout(tapTimer);if(e.detail>1)return;
        tapTimer=setTimeout(()=>{if(!root.hidden)window.toggleUi();},360);
    });
    button.onclick=()=>onConfirm?onConfirm():confirm();
    slider.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(onConfirm)onConfirm();else confirm();}});
    return {get element(){return root;},get ready(){return ready;},get sourceIndex(){return items[selected]?.index;},confirm,
    async prepare(index){const found=items.findIndex(item=>item.index===index),chosen=found>=0?found:(index>(items.at(-1)?.index??Infinity)?items.length-1:0);if(selected===chosen&&ready)return true;await renderSelection(chosen);return ready;},
    update(mode,data) {
        if(mode!=='edge'||!data){clear();return;}
        snapshot=data;root.hidden=false;onPhaseChange(selected>=0?'peek':'edge');
        for(const sheet of content.querySelectorAll('[data-page-label]'))numberSheet(sheet,sheet.dataset.pageLabel);
        if(key!==data.peekKey){rendering=false;pendingIndex=null;cancelAnimationFrame(frame);root.dataset.opened='false';document.body.classList.remove('viewer-edge-fan-active');onPhaseChange('edge');cache.clear();items=getItems();key=data.peekKey;selected=-1;ticket++;leaf.hidden=true;content.replaceChildren();ready=false;button.disabled=true;slider.max=Math.max(0,items.length-1);slider.value='0';status.textContent='左右になぞると中身が見えます';}
        if(!items.length){clear();return;}
        // No space is reserved for controls: fit the complete book to the viewport.
        const viewport=window.visualViewport, width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
        const heightScale=height/720,scale=Math.min(width/730,heightScale),w=730*scale,h=height;
        root.style.setProperty('--fan-height-scale',heightScale);
        root.style.setProperty('--peek-width',w+'px');root.style.setProperty('--peek-height',h+'px');
        root.style.setProperty('--fan-scale',scale);
        Object.assign(root.style,{left:((viewport?.offsetLeft||0)+width/2)+'px',top:((viewport?.offsetTop||0)+(height-h)/2)+'px'});
        slider.style.direction=data.rtl?'rtl':'ltr';root.dataset.direction=data.rtl?'rtl':'ltr';
    },endDrag(){drag=null;},get opened(){return !root.hidden&&selected>=0;},handleKey(e){
        if(root.hidden||selected<0||!['ArrowLeft','ArrowRight'].includes(e.key))return false;
        e.preventDefault();void show((pendingIndex??selected)+(e.key==='ArrowRight'?1:-1)*(snapshot.rtl?-1:1));return true;
    },clear};
}
