import {VIEWER_PEEK_OPEN_EXTENT} from './viewer-peek-layout.js';
import {fitReaderSheet,adjacentReaderPage} from './viewer-responsive-layout.js';
import {peekPaperPoint as paperPoint, peekViewportFrame, peekPaperProfile, peekPaperSample} from './viewer-peek-geometry.js';
import {createViewerPeekCover} from './viewer-peek-cover.js';
import {createViewerPeekCoverMotion} from './viewer-peek-cover-motion.js';
/** A curved fan of neighbouring sheets sharing one binding. No reading state is
 * changed until confirmation; CSS strips also support fixed-text surfaces. */
let needsAffineTriangles;
function usesAffineTriangles() {
    if(needsAffineTriangles!==undefined)return needsAffineTriangles;
    const probe=document.createElement('div');
    probe.style.cssText='position:fixed;left:0;top:0;width:100px;height:10px;visibility:hidden;transform-origin:0 0;transform:matrix3d(1,0,0,.01,0,1,0,0,0,0,1,0,0,0,0,1)';
    document.body.append(probe);needsAffineTriangles=probe.getBoundingClientRect().width>75;probe.remove();
    return needsAffineTriangles;
}
export function projectStrip(el, points, width) {
    el.bookPoints=points;
    // Paint text/images at a higher local resolution before projecting them.
    // Dividing the transform by the same factor preserves every page corner.
    const raster=Number(el.dataset.rasterScale)||1,w=width*raster,rasterHeight=640*raster;
    el.style.width=w+'px';el.style.height=rasterHeight+'px';el.firstElementChild.style.zoom=String(raster);
    const [p,q,r,s] = points;
    // A rigid plane needs one affine surface, avoiding a diagonal triangle seam.
    if(Math.abs(p.x-q.x+r.x-s.x)<1e-7&&Math.abs(p.y-q.y+r.y-s.y)<1e-7){
        el.classList.remove('edge-fan-affine');
        for(const tri of el.affineTriangles||[])tri.remove();
        el.affineTriangles=null;el.affineHtml=null;
        // Keep affine strips on the same compositing path as curved ones;
        // 2D clipping otherwise leaves pale vertical seams in Chromium.
        el.style.transform=`matrix3d(${(q.x-p.x)/w},${(q.y-p.y)/w},0,0,${(s.x-p.x)/rasterHeight},${(s.y-p.y)/rasterHeight},0,0,0,0,1,0,${p.x},${p.y},0,1)`;
        return;
    }
    // Some WebKit compositors flatten a projective matrix without its W division.
    // Two clipped affine triangles share the exact quad boundary on those engines.
    if(usesAffineTriangles()){
        el.classList.add('edge-fan-affine');el.style.transform='none';
        const source=el.firstElementChild,html=source.innerHTML;
        if(!el.affineTriangles){
            el.affineTriangles=[0,1].map(i=>{const tri=document.createElement('div');tri.className='edge-fan-triangle';tri.style.clipPath=i?'polygon(calc(100% - 2px) 0,100% 0,100% 100%,0 100%,0 calc(100% - 2px))':'polygon(0 0,100% 0,100% 2px,2px 100%,0 100%)';const face=source.cloneNode(true);tri.append(face);el.append(tri);return tri;});
        }
        for(const tri of el.affineTriangles){
            tri.style.width=w+'px';tri.style.height=rasterHeight+'px';tri.firstElementChild.style.left=source.style.left;tri.firstElementChild.style.zoom=String(raster);
            if(el.affineHtml!==html)tri.firstElementChild.innerHTML=html;
        }
        el.affineHtml=html;
        const matrix=(tri,origin,x,y)=>tri.style.transform=`matrix(${x.x/w},${x.y/w},${y.x/rasterHeight},${y.y/rasterHeight},${origin.x},${origin.y})`;
        matrix(el.affineTriangles[0],p,{x:q.x-p.x,y:q.y-p.y},{x:s.x-p.x,y:s.y-p.y});
        matrix(el.affineTriangles[1],{x:q.x+s.x-r.x,y:q.y+s.y-r.y},{x:r.x-s.x,y:r.y-s.y},{x:r.x-q.x,y:r.y-q.y});
        return;
    }
    const dx1=q.x-r.x, dx2=s.x-r.x, dx3=p.x-q.x+r.x-s.x;
    const dy1=q.y-r.y, dy2=s.y-r.y, dy3=p.y-q.y+r.y-s.y;
    const det=dx1*dy2-dx2*dy1;
    const g=det?(dx3*dy2-dx2*dy3)/det:0, h=det?(dx1*dy3-dx3*dy1)/det:0;
    const a=q.x-p.x+g*q.x, b=s.x-p.x+h*s.x;
    const d=q.y-p.y+g*q.y, e=s.y-p.y+h*s.y;
    el.style.transform=`matrix3d(${a/w},${d/w},0,${g/w},${b/(640*raster)},${e/(640*raster)},0,${h/(640*raster)},0,0,1,0,${p.x},${p.y},0,1)`;
}
let peekCompact=0,bookReading=0;
function shapeSheet(sheet, spread, depth=0, lift=0) {
    sheet.dataset.side=spread<0?'left':'right';
    const side=spread<0?-1:1,extent=Math.abs(spread),stackDepth=Number(sheet.dataset.stackDepth||0);
    const cover=sheet.classList.contains('edge-fan-cover'),stack=sheet.classList.contains('edge-fan-stack');
    const layer=stack?(stackDepth?depth/stackDepth:1):1;
    const geometry={reading:bookReading,compact:peekCompact,hinge:Number(sheet.dataset.hinge||405),side,extent,stackDepth,cover,layer,lift,bias:Number(sheet.dataset.bias||0),bindingWidth:Number(sheet.dataset.bindingWidth||0)};
    const point=(u,v)=>paperPoint(geometry,side<0?1-u:u,v);
    sheet.dataset.attachment=paperPoint(geometry,0,0).x;
    const count=sheet.children.length;
    const tilt=cover?0:Math.atan2(layer*stackDepth,360)*180/Math.PI;
    const profile=peekPaperProfile(extent,tilt,lift,peekCompact,bookReading);
    const sample=i=>side<0?1-peekPaperSample(count-i,count,profile):peekPaperSample(i,count,profile);
    [...sheet.children].forEach((strip,i)=>{
        // Concentrate the bounded strip budget near the bend.
        // One-pixel overlaps still sample their matching image pixels.
        const start=Math.max(0,360*sample(i)-1),end=Math.min(360,360*sample(i+1)+1);
        const u=start/360,next=end/360,width=end-start;
        strip.style.width=width+'px';strip.dataset.sourceStart=start;
        strip.firstElementChild.style.left=-start+'px';
        projectStrip(strip,[point(u,0),point(next,0),point(next,1),point(u,1)],width);
        strip.style.setProperty('--shade-start',String(.02+.18*(side<0?u:1-u)+lift*.06));
        strip.style.setProperty('--shade-end',String(.02+.18*(side<0?next:1-next)+lift*.06));
    });
}
function makeSheet(html, spread, depth=0, className='',bias=0,bindingWidth=0,stackDepth=0,hinge=405) {
    const sheet=document.createElement('div');sheet.className='edge-fan-sheet '+className;sheet.dataset.hinge=hinge;sheet.dataset.bias=bias;sheet.dataset.bindingWidth=bindingWidth;sheet.dataset.stackDepth=stackDepth;sheet.dataset.shapeSpread=spread;sheet.dataset.shapeDepth=depth;
    const coarse=matchMedia('(pointer:coarse)').matches;
    const count=className==='edge-fan-stack'?12:(coarse?16:24),stripWidth=360/count;
    // Bound phone backing surfaces to 3 device pixels per source CSS pixel.
    // Dense screens already supply part of the extra sampling resolution.
    const raster=className==='edge-fan-stack'?1:coarse?Math.max(1,Math.min(2,3/(devicePixelRatio||1))):2;
    for(let i=0;i<count;i++){
        const strip=document.createElement('div');strip.className='edge-fan-strip';strip.dataset.rasterScale=raster;
        const content=document.createElement('div');content.className='edge-peek-content';
        content.style.left=(-i*stripWidth)+'px';content.innerHTML=html;strip.append(content);sheet.append(strip);
    }
    shapeSheet(sheet,spread,depth);return sheet;
}
function makePaperEdges(side, depth, bindingWidth, hinge) {
    const ns='http://www.w3.org/2000/svg';
    const sections=[['top',(t)=>[t,0]],['fore-edge',(v)=>[1,v]]];
    return sections.map(([name,coordinates])=>{
        const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 760');svg.classList.add('edge-fan-'+name);
        svg.setAttribute('aria-hidden','true');svg.dataset.side=side<0?'left':'right';svg.dataset.thickness=depth;
        const profile=peekPaperProfile(1,0,0,peekCompact);
        const points=layer=>Array.from({length:49},(_,i)=>{
            const [t,v]=coordinates(name==='top'?peekPaperSample(i,48,profile):i/48);const p=paperPoint({side,stackDepth:depth,bindingWidth,hinge,layer,compact:peekCompact},t,v);return [p.x,p.y];
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
    const back=document.createElementNS(ns,'path');back.setAttribute('d',`M${left},18 H${right} V662 H${left} Z`);
    back.setAttribute('fill',color);svg.append(back);
    const rim=document.createElementNS(ns,'path');rim.setAttribute('d',`M${left},19 H${right} M${left},661 H${right}`);
    rim.setAttribute('fill','none');rim.setAttribute('stroke','#b4ad97');rim.setAttribute('stroke-width','1');svg.append(rim);
    return svg;
}
export function createViewerEdgePeek({getItems, getLayout, renderSurface, formatSurface, getNumberSettings=()=>({number:true,numberEdge:"top",numberAlign:"outer"}), onPhaseChange=()=>{}, onSelection=()=>{}, onConfirm, open, navigationBusy=()=>false}) {
    const root=document.createElement('aside');root.id='viewer-edge-peek';root.hidden=true;
    root.innerHTML='<div class="edge-peek-leaf" hidden><div class="edge-fan-scene"></div></div><output class="edge-peek-sr" aria-live="polite"></output>';
    document.body.append(root);
    const leaf=root.querySelector('.edge-peek-leaf'),content=root.querySelector('.edge-fan-scene'),status=root.querySelector('output');
    const pose=document.getElementById('viewer-book-pose');
    let items=[],key='',selected=-1,ticket=0,ready=false,snapshot=null,lastTap=null,frame=0,tapTimer=0,suppressClickUntil=0,rendering=false,pendingIndex=null;
    let hoverHeld=false,hoverAnchor=null,pendingRapid=false,lastStepAt=0,lastStepDelta=0;
    function holdHover(){hoverHeld=true;hoverAnchor=null;}
    const coverMotion=createViewerPeekCoverMotion();
    let inertia=null,readingMotion=null,readingFrame=0,peekFit=null,readingFit=null;
    const singleReading=()=>!!snapshot?.singleBook&&bookReading===1;
    function setReading(value){
        bookReading=Math.max(0,Math.min(1,value));root.dataset.reading=bookReading.toFixed(4);
        root.dataset.single=String(!!snapshot?.singleBook&&bookReading>0);
        root.setAttribute('aria-label',bookReading===1?'本の読書モード':'覗き見');
        // Only paper meshes carry bending geometry; closed-cover side faces stay rigid.
        for(const sheet of content.querySelectorAll('.edge-fan-sheet[data-shape-spread][data-shape-depth]')){
            shapeSheet(sheet,Number(sheet.dataset.shapeSpread),Number(sheet.dataset.shapeDepth));
            // B/C settle beneath the readable A spread. Keep the covers/paper
            // block as a thin physical rim instead of showing neighbouring text.
            const neighbour=sheet.dataset.active==='false'||(snapshot?.singleBook&&sheet.dataset.selected!=='true');
            sheet.style.opacity=neighbour?String(1-bookReading):'';
        }
        for(const edge of content.querySelectorAll('.edge-fan-top,.edge-fan-fore-edge,.edge-fan-binding'))edge.style.opacity=String(1-bookReading);
        if(snapshot?.singleBook&&bookReading>0){
            const sheet=content.querySelector('.edge-fan-sheet[data-selected=true]');
            const points=[...(sheet?.children||[])].flatMap(strip=>strip.bookPoints||[]);
            const v=snapshot.viewport;
            readingFit=fitReaderSheet(points,v.width,v.height,v)||readingFit;
        }
        if(peekFit&&readingFit){
            const mix=(a,b)=>a+(b-a)*bookReading;
            const scale=mix(peekFit.scale,readingFit.scale);
            root.style.setProperty('--fan-scale',scale);
            root.style.setProperty('--fan-offset-x',mix(peekFit.offsetX*peekFit.scale,readingFit.offsetX*readingFit.scale)/scale+'px');
            root.style.setProperty('--fan-offset-y',mix(peekFit.offsetY,readingFit.offsetY)+'px');
        }
    }
    function drawReading(progress){if(!readingMotion)return;readingMotion.progress=Math.max(0,Math.min(1,progress));const {from,to}=readingMotion;setReading(from+(to-from)*readingMotion.progress);}
    function finishReading(accept){
        if(!readingMotion)return;
        cancelAnimationFrame(readingFrame);
        const motion=readingMotion,start=performance.now(),from=motion.progress,end=accept?1:0;
        const duration=matchMedia('(prefers-reduced-motion:reduce)').matches?0:Math.max(100,360*Math.abs(end-from));
        function tick(now){
            if(motion!==readingMotion)return;
            const p=duration?Math.min(1,(now-start)/duration):1;
            drawReading(from+(end-from)*p*p*(3-2*p));
            if(p<1)readingFrame=requestAnimationFrame(tick);
            else{readingMotion=null;motion.done(accept);}
        }
        readingFrame=requestAnimationFrame(tick);
    }
    function transitionReading(to,{manual=false,onFinish=()=>{}}={}){
        if(!ready||rendering||readingMotion)return false;
        stopRiffle();holdHover();readingMotion={from:bookReading,to,progress:0,done:onFinish};
        if(!manual)finishReading(true);return true;
    }
    function cancelReading(){cancelAnimationFrame(readingFrame);readingMotion=null;}
    window.addEventListener('blur',()=>{if(readingMotion)finishReading(false);});
    function stopRiffle(){inertia=null;delete root.dataset.riffling;}
    function continueRiffle(){
        if(!inertia||rendering||drag)return;
        const next=adjacentIndex(selected,inertia.delta);
        if(inertia.remaining<=0||next===null||getLayout(items[next].index)?.exterior){stopRiffle();return;}
        inertia.remaining--;show(next,Math.round(125+105*(1-inertia.remaining/inertia.total)));
    }
    function startRiffle(delta,count){
        if(root.hidden||selected<0||getLayout(items[selected].index)?.exterior)return false;
        holdHover();inertia={delta,remaining:count,total:count};root.dataset.riffling='true';continueRiffle();return true;
    }
    window.addEventListener('blur',stopRiffle);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRiffle();});
    function clear(){cancelReading();bookReading=0;root.dataset.reading="0";stopRiffle();coverMotion.cancel();pendingRapid=false;lastStepAt=0;lastStepDelta=0;drag=null;rendering=false;pendingIndex=null;root.dataset.ready='false';cancelAnimationFrame(frame);clearTimeout(tapTimer);root.dataset.opened='false';root.hidden=true;leaf.hidden=true;document.body.classList.remove('viewer-edge-fan-active');content.replaceChildren();items=[];key='';selected=-1;ready=false;ticket++;lastTap=null;onPhaseChange('edge');}
    function numberSheet(sheet,label){
        sheet.dataset.pageLabel=label;
        const prefs=getNumberSettings(),align=prefs.numberAlign==='center'?'center':(prefs.numberAlign==='inner'?(sheet.dataset.side==='left'?'right':'left'):sheet.dataset.side);
        for(const page of sheet.querySelectorAll('.edge-peek-content')){
            page.querySelector('.edge-fan-folio')?.remove();
            if(!prefs.number)continue;
            const number=document.createElement('span');number.className='edge-fan-folio';number.textContent=label;number.setAttribute('aria-hidden','true');number.dataset.edge=prefs.numberEdge;number.dataset.align=align;page.append(number);
        }
    }
    function show(index,rapid=false){
        index=Math.max(0,Math.min(items.length-1,Math.round(index)));
        if(rendering){pendingIndex=index;pendingRapid=rapid;return;}
        void renderSelection(index,rapid);
    }
    function settle(id){if(id!==ticket)return;rendering=false;const next=pendingIndex,rapid=pendingRapid;pendingIndex=null;pendingRapid=false;if(next!==null&&next!==selected)show(next,rapid);else continueRiffle();}
    async function renderSelection(index,rapid=false,reshape=false) {
        index=Math.max(0,Math.min(items.length-1,Math.round(index)));
        if(!items[index]||(index===selected&&!reshape))return;
        rendering=true;
        const previous=selected, previousLayout=previous>=0?getLayout(items[previous].index):null;
        const previousData={...root.dataset},gesture=drag;
        selected=index;root.dataset.sourceIndex=items[index].index;ready=false;root.dataset.ready='false';
        root.dataset.opened='true';onPhaseChange('peek');
        const layout=getLayout(items[index].index);
        if(!layout){rendering=false;return;}
        const ratio=layout.ratio, bias=(ratio-.5)*320*(snapshot.rtl?-1:1);
        const bindingWidth=Math.max(2,Math.min(64,snapshot.thickness||8))*1.25;
        const volumeDepth=Math.max(0,Math.min(64,snapshot.thickness||8)*1.1);
        const leftDepth=volumeDepth*(snapshot.rtl?1-ratio:ratio),rightDepth=volumeDepth-leftDepth;
        const hinge=405+(ratio-.5)*bindingWidth*.9*(snapshot.rtl?-1:1);
        const make=(html,spread,depth=0,cls='')=>makeSheet(html,spread,depth,cls,bias,bindingWidth,spread<0?leftDepth:rightDepth,hinge);
        root.dataset.bindingWidth=bindingWidth;
        root.dataset.openRatio=ratio;root.dataset.hinge=hinge;
        const id=++ticket;status.textContent=`${items[index].label} / ${snapshot.total??items.length} · 読み込み中`;
        // Build off screen and retain the previous fan until the selected image is decoded.
        const next=document.createElement('div');next.className='edge-fan-pages';
        root.dataset.exterior=layout.exterior?layout.role:'';
        root.dataset.boundary=layout.boundary;root.dataset.spreadPosition=layout.position;onSelection();
        if(layout.exterior){
            next.append(createViewerPeekCover({layout,snapshot,renderSurface,project:projectStrip}));
            numberSheet(next.querySelector('.edge-fan-rigid'),formatSurface(layout.surface));
        }else{
            next.append(makeBinding(bindingWidth,snapshot.design?.backgroundColor||'#173d42'));
            for(const {side,outside,inside,role,insideRole} of layout.boards) {
                // A cover has two faces: C1/C4 outside, C2/C3 toward the paper block.
                // Missing inside-cover content stays blank, never borrowing an exterior image.
                const board=make(renderSurface(inside),side,0,'edge-fan-cover');
                board.dataset.cover=role;board.dataset.insideCover=insideRole;
                if(Number.isInteger(outside?.sourcePageIndex))board.dataset.outsideSourceIndex=outside.sourcePageIndex;
                if(Number.isInteger(inside?.sourcePageIndex))board.dataset.insideSourceIndex=inside.sourcePageIndex;
                // Exterior identity stays on the board; its hidden image needs no painted copy.
                next.append(board);
                const remaining=side===(snapshot.rtl?-1:1)?1-ratio:ratio;
                const depth=volumeDepth*remaining;
                root.dataset[side<0?'leftThickness':'rightThickness']=depth;
                // Only the block boundaries need sheet meshes; SVG faces draw the interior paper layers.
                for(const j of [0,10]){const stack=make('',side,j/10*depth,'edge-fan-stack');stack.dataset.side=side<0?'left':'right';next.append(stack);}
            }
            for(const side of [-1,1])next.append(...makePaperEdges(side,Number(root.dataset[side<0?'leftThickness':'rightThickness']),bindingWidth,hinge));
            for(const {surface,side,extent,selected:chosen,active} of layout.layers){
                const isInside=/^C[23]$/.test(surface?.bookRole||surface?.role||'');
                const sheet=make(renderSurface(surface),side*extent,0,isInside?'edge-fan-endpaper':'');
                if(Number.isInteger(surface?.sourcePageIndex)&&!surface.virtualBlank)sheet.dataset.sourceIndex=surface.sourcePageIndex;
                if(isInside)sheet.dataset.cover=surface.bookRole||surface.role;
                sheet.dataset.selected=String(chosen);sheet.dataset.active=String(active);sheet.dataset.openExtent=extent;
                sheet.dataset.virtualBlank=String(!!surface?.virtualBlank);
                numberSheet(sheet,formatSurface(surface));next.append(sheet);
            }
        }
        let timer;
        try {
            await Promise.race([Promise.all([...next.querySelectorAll('[data-active=true] img,.edge-fan-cover img')].map(img=>img.complete&&img.naturalWidth?Promise.resolve():img.decode())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),4000);})]);
            if(id!==ticket)return;
            const previousPages=content.firstElementChild;
            cancelAnimationFrame(frame);ready=true;leaf.hidden=false;
            document.body.classList.add('viewer-edge-fan-active');root.dataset.ready='true';
            status.textContent=`${items[index].label} / ${snapshot.total??items.length}`;
            if(!singleReading()&&previous>=0&&!layout.exterior&&!previousLayout?.exterior&&previousLayout?.position!==layout.position&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
                const direction=(index>previous?1:-1)*(snapshot.rtl?1:-1);
                const front=previousLayout.layers.find(layer=>layer.active&&layer.side===-direction);
                const back=layout.layers.find(layer=>layer.active&&layer.side===direction);
                const turn=previousPages.querySelector(`[data-active=true][data-side=${direction>0?'left':'right'}]`);
                const stationary=previousPages.querySelector(`[data-active=true][data-side=${direction>0?'right':'left'}]`);
                const turnSlot=document.createComment('turn'),stationarySlot=document.createComment('stationary');
                turn.replaceWith(turnSlot);stationary.replaceWith(stationarySlot);
                turn.classList.add('edge-fan-turn');turn.dataset.active='false';stationary.dataset.active='false';
                const hidden=[];
                const occupied=new Set([front?.surface?.sourcePageIndex,back?.surface?.sourcePageIndex,Number(stationary.dataset.sourceIndex)]);
                for(const sheet of next.querySelectorAll('.edge-fan-sheet[data-source-index],.edge-fan-sheet[data-active=true]')){
                    if((sheet.dataset.active==='true'&&sheet.dataset.side===(direction<0?'left':'right'))||occupied.has(Number(sheet.dataset.sourceIndex))){sheet.style.visibility='hidden';hidden.push(sheet);}
                }
                // The old stationary face remains underneath the turning sheet.
                // The incoming face becomes stationary only after the turn lands.
                next.append(stationary,turn);content.replaceChildren(next);setReading(bookReading);stationary.style.opacity="1";turn.style.opacity="1";
                const frontHtml=renderSurface(front?.surface),backHtml=renderSurface(back?.surface);
                const turnTime=typeof rapid==='number'?rapid:rapid&&!gesture?160:280;
                let backShown=false,start=performance.now(),held=0,from=0,releasing=!gesture;
                const initialHinge=Number(turn.dataset.hinge),initialBias=Number(turn.dataset.bias);
                function animate(now){
                    if(id!==ticket)return;
                    const heldGesture=gesture&&gesture.ended===null;
                    let t;
                    const duration=gesture?Math.max(40,(gesture.flung?125:turnTime)*Math.abs((gesture.ended===false?0:1)-from)):turnTime;
                    if(heldGesture){t=gesture.progress;releasing=false;}
                    else{
                        if(!releasing){from=held;start=now;releasing=true;}
                        const end=gesture?.ended===false?0:1;
                        t=from+(end-from)*Math.min(1,(now-start)/duration);
                    }
                    t=Math.max(0,Math.min(1,t));
                    if(heldGesture&&t===held){frame=requestAnimationFrame(animate);return;}
                    held=t;turn.dataset.progress=t;
                    const ease=t*t*(3-2*t),extent=(front?.extent??VIEWER_PEEK_OPEN_EXTENT)*(1-ease)+(back?.extent??VIEWER_PEEK_OPEN_EXTENT)*ease;
                    const spread=-extent*direction*Math.cos(ease*Math.PI);
                    if(backShown!==(ease>=.5)){
                        backShown=ease>=.5;
                        for(const strip of turn.children)strip.firstElementChild.innerHTML=backShown?backHtml:frontHtml;
                        turn.dataset.side=(backShown?direction:-direction)<0?'left':'right';
                        numberSheet(turn,formatSurface(backShown?back?.surface:front?.surface));
                    }
                    turn.dataset.hinge=initialHinge+(hinge-initialHinge)*ease;
                    turn.dataset.bias=initialBias+(bias-initialBias)*ease;
                    turn.dataset.stackDepth=spread<0?leftDepth:rightDepth;
                    shapeSheet(turn,Math.abs(spread)<.018?.018*(spread<0?-1:1):spread,0,Math.sin(t*Math.PI));
                    if(heldGesture||now-start<duration){frame=requestAnimationFrame(animate);return;}
                    if(gesture?.ended===false){
                        turnSlot.replaceWith(turn);stationarySlot.replaceWith(stationary);
                        turn.classList.remove('edge-fan-turn');turn.dataset.active='true';stationary.dataset.active='true';
                        for(const strip of turn.children)strip.firstElementChild.innerHTML=frontHtml;
                        turn.dataset.hinge=initialHinge;turn.dataset.bias=initialBias;turn.dataset.stackDepth=previousData[direction>0?'leftThickness':'rightThickness'];
                        shapeSheet(turn,-direction*(front?.extent??VIEWER_PEEK_OPEN_EXTENT));numberSheet(turn,formatSurface(front?.surface));
                        if(pendingIndex===index)pendingIndex=null;
                        content.replaceChildren(previousPages);selected=previous;Object.assign(root.dataset,previousData);onSelection();
                        status.textContent=`${items[previous].label} / ${snapshot.total??items.length}`;
                    }else{turn.remove();stationary.remove();for(const sheet of hidden)sheet.style.visibility='';}
                    settle(id);
                }
                frame=requestAnimationFrame(animate);
            }else{
                if(previous>=0&&(layout.exterior||previousLayout?.exterior)){
                    ready=false;root.dataset.ready='false';
                    await coverMotion.play(content,previousPages,next,{from:previousLayout?.role||'peek',to:layout.role||'peek',thickness:snapshot.thickness,hinge:Number(previousData.hinge)||405});
                    if(id!==ticket)return;
                    ready=true;root.dataset.ready='true';
                }else content.replaceChildren(next);
                setReading(bookReading);
                settle(id);
            }
        } catch {if(id===ticket){status.textContent='このページを表示できません';settle(id);}}
        finally {clearTimeout(timer);}
    }
    function confirm(index=items[selected]?.index){if(!ready||!Number.isInteger(index))return;clear();open(index);}
    function positionAt(e,element) {
        const r=element.getBoundingClientRect();
        let ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/Math.max(1,r.width)));
        return (snapshot.rtl?1-ratio:ratio)*(items.length-1);
    }
    function scrub(e,element) {if(!root.hidden&&items.length)void show(positionAt(e,element));}
    function hover(e,element){
        if(bookReading||readingMotion||getLayout(items[selected]?.index)?.exterior)return;
        if(navigationBusy()||inertia||rendering){holdHover();return;}
        if(hoverHeld){
            if(!hoverAnchor){hoverAnchor={x:e.clientX,y:e.clientY};return;}
            if(Math.hypot(e.clientX-hoverAnchor.x,e.clientY-hoverAnchor.y)<18)return;
            hoverHeld=false;hoverAnchor=null;
        }
        scrub(e,element);
    }
    function adjacentIndex(at,delta){
        return adjacentReaderPage(items,at,delta,index=>getLayout(index)?.position,singleReading());
    }
    function stepPage(delta,repeat=false){
        stopRiffle();holdHover();
        if(rendering&&getLayout(items[selected]?.index)?.exterior)return;
        const at=pendingIndex??selected,next=adjacentIndex(at,delta);
        if(next!==null){
            if(getLayout(items[next].index)?.exterior&&(repeat||rendering||!ready))return;
            const now=performance.now(),rapid=repeat||(delta===lastStepDelta&&now-lastStepAt<450);
            lastStepAt=now;lastStepDelta=delta;show(next,rapid);return;
        }
        // A fresh outward input rolls the closed book over without leaving peek.
        if(!repeat&&!rendering&&ready&&getLayout(items[at]?.index)?.exterior){
            const opposite=delta<0?items.length-1:0;
            if(getLayout(items[opposite]?.index)?.exterior)show(opposite);
        }
    }
    function activate(e,el){
        clearTimeout(tapTimer);suppressClickUntil=performance.now()+400;
        if(el===pose){scrub(e,pose);}else (onConfirm?onConfirm():confirm());
    }
    pose.addEventListener('keydown',e=>{if(!root.hidden&&['Enter',' '].includes(e.key)){e.preventDefault();void show(Math.max(0,items.findIndex(item=>item.index===snapshot.peekIndex)));}});
    for(const el of [pose,leaf]) {
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
    leaf.addEventListener('pointerdown',e=>{stopRiffle();holdHover();if(rendering||navigationBusy()||readingMotion)return;drag={samples:[{x:e.clientX,t:e.timeStamp}],width:leaf.getBoundingClientRect().width,id:e.pointerId,x:e.clientX,y:e.clientY,index:pendingIndex??selected,progress:0,target:null,sign:0,ended:null};try{leaf.setPointerCapture(e.pointerId);}catch{}});
    leaf.addEventListener('pointermove',e=>{
        if(e.pointerType==='mouse'&&!e.buttons){hover(e,leaf);return;}
        if(drag?.id!==e.pointerId)return;
        const now=e.timeStamp;drag.samples.push({x:e.clientX,t:now});while(drag.samples.length>2&&now-drag.samples[1].t>100)drag.samples.shift();
        const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
        if(!drag.sign){
            if(Math.abs(dx)<24||Math.abs(dx)<Math.abs(dy)*1.35)return;
            drag.sign=Math.sign(dx);drag.target=adjacentIndex(drag.index,drag.sign*(snapshot.rtl?1:-1));
        }
        drag.progress=Math.max(0,Math.min(1,dx*drag.sign/Math.max(80,Math.min(180,leaf.getBoundingClientRect().width*.35))));
        if(!singleReading()&&drag.target!==null&&!getLayout(items[drag.target].index)?.exterior&&!getLayout(items[drag.index].index)?.exterior)show(drag.target);
    });
    function endPeekDrag(e,cancelled=false){
        const g=drag;drag=null;if(!g||g.id!==e.pointerId)return;
        const dx=e.clientX-g.x,dy=e.clientY-g.y;
        g.ended=!cancelled&&dx*g.sign>=24&&Math.abs(dx)>Math.abs(dy)*1.35;
        if(g.ended)suppressClickUntil=performance.now()+400;
        // One completed swipe owns one page in the single-face reading view.
        if(singleReading()){if(g.ended&&g.target!==null)show(g.target);return;}
        if(g.ended&&g.target!==null&&(getLayout(items[g.target].index)?.exterior||getLayout(items[g.index].index)?.exterior))show(g.target);
        if(g.ended&&g.target===null)stepPage(g.sign*(snapshot.rtl?1:-1));
        if(g.ended&&g.target!==null&&!getLayout(items[g.index].index)?.exterior&&!getLayout(items[g.target].index)?.exterior){
            const now=e.timeStamp,sample=g.samples.find(s=>now-s.t<=130);
            const velocity=sample?(e.clientX-sample.x)/Math.max(16,now-sample.t):0;
            const speed=Math.abs(velocity)*1000/g.width;
            if(Math.abs(dx)>=Math.max(60,g.width*.2)&&speed>=3.4&&Math.abs(velocity)>=1.25&&Math.sign(velocity)===g.sign){
                g.flung=true;startRiffle(g.sign*(snapshot.rtl?1:-1),Math.min(6,2+Math.floor((speed-3.4)*.8)));
            }
        }
    }
    leaf.addEventListener('pointerup',e=>endPeekDrag(e));leaf.addEventListener('pointercancel',e=>endPeekDrag(e,true));
    for(const el of [pose,leaf])el.addEventListener('click',e=>{
        e.stopPropagation();if(root.hidden||performance.now()<suppressClickUntil)return;
        if(bookReading===1&&e.pointerType!=='touch'&&readingFit){
            const r=leaf.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,f=readingFit;
            const left=(f.minX+f.offsetX)*f.scale,right=(f.maxX+f.offsetX)*f.scale;
            const top=f.minY*f.scale+f.offsetY,bottom=f.maxY*f.scale+f.offsetY,edge=Math.min(64,(right-left)*.1);
            if(x>=left&&x<=right&&y>=top&&y<=bottom&&(x<left+edge||x>right-edge)){
                stepPage((x<left+edge?1:-1)*(snapshot.rtl?1:-1));return;
            }
        }
        clearTimeout(tapTimer);if(e.detail>1)return;
        tapTimer=setTimeout(()=>{if(!root.hidden)window.toggleUi();},360);
    });
    function edgeTapSide(x,y){
        if(!ready||rendering||navigationBusy()||readingMotion)return null;
        if(singleReading()&&readingFit){
            const r=leaf.getBoundingClientRect(),f=readingFit;
            const left=r.left+(f.minX+f.offsetX)*f.scale,right=r.left+(f.maxX+f.offsetX)*f.scale;
            const top=r.top+f.minY*f.scale+f.offsetY,bottom=r.top+f.maxY*f.scale+f.offsetY;
            const edge=Math.min(56,(right-left)*.15);
            if(y<top||y>bottom||x<left||x>right)return null;
            return x<left+edge?'left':x>right-edge?'right':null;
        }
        // Hit the actual fore-edge of A, not the viewport or the hidden B/C
        // sheets. Closed covers have one surface and accept either edge.
        for(const sheet of content.querySelectorAll('.edge-fan-sheet[data-active=true]')){
            const sides=sheet.classList.contains('edge-fan-rigid')?['left','right']:[sheet.dataset.side];
            for(const side of sides){
                const strip=side==='left'?sheet.firstElementChild:sheet.lastElementChild;
                const r=strip.getBoundingClientRect(),edge=side==='left'?r.left:r.right;
                const inward=side==='left'?x-edge:edge-x;
                if(y>=r.top&&y<=r.bottom&&inward>=0&&inward<=Math.min(48,leaf.clientWidth*.12))return side;
            }
        }
        return null;
    }
    return {edgeTapSide,setReading,transitionReading,drawReading,finishReading,cancelReading,
    get bounds(){
        const f=bookReading===1?readingFit:peekFit;
        if(!ready||!f)return null;
        const r=leaf.getBoundingClientRect(),left=r.left+(f.minX+f.offsetX)*f.scale,top=r.top+f.minY*f.scale+f.offsetY;
        return {left,top,width:(f.maxX-f.minX)*f.scale,height:(f.maxY-f.minY)*f.scale,right:r.left+(f.maxX+f.offsetX)*f.scale};
    },get reading(){return bookReading;},get busy(){return rendering;},get element(){return root;},get ready(){return ready;},get sourceIndex(){return items[selected]?.index;},confirm,seek(index){
        stopRiffle();holdHover();

        const position=getLayout(index)?.position,exact=items.findIndex(item=>item.index===index);
        const at=exact>=0?exact:items.findIndex(item=>getLayout(item.index)?.position===position);
        if(at>=0)show(at);
    },
    async prepare(index){const found=items.findIndex(item=>item.index===index),chosen=found>=0?found:(index===snapshot.covers?.back?items.length-1:0);if(selected===chosen&&ready)return true;await renderSelection(chosen);return ready;},
    update(mode,data) {
        if(mode!=='edge'||!data){clear();return;}
        snapshot=data;root.hidden=false;onPhaseChange(selected>=0?'peek':'edge');
        for(const sheet of content.querySelectorAll('[data-page-label]'))numberSheet(sheet,sheet.dataset.pageLabel);
        if(key!==data.peekKey){stopRiffle();coverMotion.cancel();rendering=false;pendingIndex=null;cancelAnimationFrame(frame);root.dataset.opened='false';document.body.classList.remove('viewer-edge-fan-active');onPhaseChange('edge');items=getItems();key=data.peekKey;selected=-1;ticket++;leaf.hidden=true;content.replaceChildren();ready=false;root.dataset.ready='false';status.textContent='左右になぞると中身が見えます';}
        if(!items.length){clear();return;}
        // No space is reserved for controls: fit the complete book to the viewport.
        const viewport=window.visualViewport, width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
        const fit=peekViewportFrame(width,height,data.thickness||8);
        peekFit=fit;readingFit=peekViewportFrame(width,height,data.thickness||8,1);
        const reshape=Math.abs(peekCompact-fit.compact)>.00001;
        peekCompact=fit.compact;
        const scale=fit.scale,w=width,h=height;
        root.style.setProperty('--fan-offset-x',fit.offsetX+'px');
        root.style.setProperty('--fan-offset-y',fit.offsetY+'px');
        root.style.setProperty('--cover-scale',Math.min((width-12)/(360+Math.min(64,data.thickness||8)*.8),(height-12)/660));
        root.style.setProperty('--peek-width',w+'px');root.style.setProperty('--peek-height',h+'px');
        root.style.setProperty('--fan-scale',scale);
        Object.assign(root.style,{left:((viewport?.offsetLeft||0)+width/2)+'px',top:((viewport?.offsetTop||0)+(height-h)/2)+'px'});
        root.dataset.direction=data.rtl?'rtl':'ltr';
        if(bookReading)setReading(bookReading);
        if(reshape&&selected>=0&&!rendering)void renderSelection(selected,false,true);
    },holdHover,stopRiffle,fling(side,count){return singleReading()?false:startRiffle((side==='right'?1:-1)*(snapshot?.rtl?-1:1),count);},endDrag(){stopRiffle();lastTap=null;clearTimeout(tapTimer);suppressClickUntil=performance.now()+800;if(drag)drag.ended=false;drag=null;},get opened(){return !root.hidden&&selected>=0;},handleKey(e){
        if(root.hidden||selected<0||!['ArrowLeft','ArrowRight'].includes(e.key))return false;
        e.preventDefault();stepPage((e.key==='ArrowRight'?1:-1)*(snapshot.rtl?-1:1),!!e.repeat);return true;
    },clear};
}
