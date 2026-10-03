import {projectStrip} from './viewer-edge-peek.js';
/** A scrub-able timeline of temporary book surfaces. Reading state stays outside it. */
export function createViewerPoseTransition({render}) {
    let root=null,animations=[],frame=0,revision=0,progress=0,duration=0,finishCallback=null,drawScene=()=>{},restoreFan=()=>{};
    function cancel(){revision++;cancelAnimationFrame(frame);for(const a of animations)a.cancel();animations=[];restoreFan();restoreFan=()=>{};root?.remove();root=null;finishCallback=null;document.body.classList.remove('viewer-pose-transition-active');}
    function abort(){const done=finishCallback;cancel();done?.(false);}
    window.addEventListener('resize',abort);window.addEventListener('blur',abort);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)abort();});
    function page(index,w,h){const face=document.createElement('div');face.className='pose-motion-page';Object.assign(face.style,{width:w+'px',height:h+'px'});const content=document.createElement('div');content.className='pose-motion-content';content.innerHTML=Number.isInteger(index)?render(index):'';content.style.transform=`scale(${w/360},${h/640})`;face.append(content);return face;}
    function draw(value){if(!root)return;progress=Math.max(0,Math.min(1,value));root.dataset.progress=progress.toFixed(4);for(const a of animations)a.currentTime=progress*duration;drawScene(progress);}
    function finish(accept=true){if(!root)return;cancelAnimationFrame(frame);const id=revision,initial=progress,end=accept?1:0,start=performance.now(),ms=Math.max(140,duration*Math.abs(end-initial));
        function tick(now){if(id!==revision)return;const t=Math.min(1,(now-start)/ms),ease=t*t*(3-2*t);draw(initial+(end-initial)*ease);if(t<1)frame=requestAnimationFrame(tick);else{const done=finishCallback;cancel();done?.(accept);}}frame=requestAnimationFrame(tick);
    }
    function play(previous,data,spineHTML,{to='edge',manual=false,onFinish=null}={}){
        cancel();if(matchMedia('(prefers-reduced-motion:reduce)').matches){onFinish?.(true);return false;}
        const opening=to==='reading',flip=previous==='spine'||to==='spine';if(!opening&&!['','spine','edge'].includes(previous))return false;
        const {rect,thickness,pages}=data,h=rect.height,w=rect.width/pages.length,thick=thickness*h/640;
        const flipDuration=flip?680:0,openDuration=opening?620:0;duration=flipDuration+openDuration||540;finishCallback=onFinish;
        root=document.createElement('div');root.className='viewer-pose-transition';root.dataset.from=previous||'reading';root.dataset.to=to;root.dataset.manual=String(manual);root.setAttribute('aria-hidden','true');Object.assign(root.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:h+'px'});
        const animate=(el,frames,length,delay=0)=>{const a=el.animate(frames,{duration:length,delay,easing:'linear',fill:'both'});a.pause();animations.push(a);};
        let flipGroup=null,leafGroup=null;
        if(flip){
            flipGroup=document.createElement('div');flipGroup.className='pose-motion-group';root.append(flipGroup);
            const book=document.createElement('div');book.className='pose-motion-book';Object.assign(book.style,{left:(rect.width-thick)/2+'px',width:thick+'px',height:h+'px'});flipGroup.append(book);
            const spine=document.createElement('div');spine.className='pose-motion-spine';spine.innerHTML=spineHTML;Object.assign(spine.style,{width:thick+'px',height:h+'px',transform:`translateZ(${w/2}px)`});book.append(spine);
            const edge=document.createElement('div');edge.className='pose-motion-edge';Object.assign(edge.style,{width:thick+'px',height:h+'px',transform:`rotateY(180deg) translateZ(${w/2}px)`});book.append(edge);
            for(const [side,index] of [[-1,data.covers?.back],[1,data.covers?.front]]){const board=page(index,w,h);board.classList.add('pose-motion-board');Object.assign(board.style,{left:(thick-w)/2+'px',transform:`translateX(${side*thick/2}px) rotateY(${side*90}deg)`});book.append(board);}
            animate(book,Array.from({length:65},(_,n)=>{const t=n/64;return {offset:t,transform:`translateZ(${-w/2}px) rotateY(${180*(to==='spine'?1-t*t*(3-2*t):t*t*(3-2*t))}deg)`};}),flipDuration);
        }
        if(opening||!flip){
            leafGroup=document.createElement('div');leafGroup.className='pose-motion-group';root.append(leafGroup);
            const slit=rect.width/2+((data.openRatio??.5)-.5)*thick*.9*(data.rtl?-1:1);root.dataset.slit=slit;
            for(const [i,sheet] of pages.entries()){
                const leaf=page(sheet.index,w,h),side=sheet.side==='left'?-1:1;leafGroup.append(leaf);Object.assign(leaf.style,{left:i*w+'px',transformOrigin:side<0?'right center':'left center'});
                const hinge=i*w+(side<0?w:0),shift=(opening?slit:rect.width/2+side*thick/2)-hinge;
                const frames=Array.from({length:65},(_,n)=>{const q=n/64,ease=q*q*(3-2*q),t=opening?1-ease:ease,angle=90*t;return {offset:q,opacity:opening?Math.min(1,q*16):1,transform:`translateX(${shift*t}px) translateZ(${-w*Math.sin(angle*Math.PI/180)}px) rotateY(${-side*angle}deg)`};});
                animate(leaf,frames,openDuration||duration,opening?flipDuration:0);
            }
            const edge=document.createElement('div');edge.className='pose-motion-edge';Object.assign(edge.style,{left:(rect.width-thick)/2+'px',width:thick+'px',height:h+'px'});leafGroup.append(edge);
            animate(edge,opening?[{opacity:1,offset:0},{opacity:0,offset:.2},{opacity:0,offset:1}]:[{opacity:0,offset:0},{opacity:0,offset:.92},{opacity:1,offset:1}],openDuration||duration,opening?flipDuration:0);
        }
        drawScene=p=>{const openingNow=p*duration>=flipDuration;if(flipGroup)flipGroup.style.visibility=opening&&openingNow?'hidden':'visible';if(leafGroup)leafGroup.style.visibility=flip&&!openingNow?'hidden':'visible';};
        document.body.append(root);document.body.classList.add('viewer-pose-transition-active');draw(0);if(!manual)finish(true);return true;
    }
    function playFan(from,to,data,fan,{manual=false,onFinish=null}={}){
        cancel();if(matchMedia('(prefers-reduced-motion:reduce)').matches){onFinish?.(true);return false;}
        duration=620;finishCallback=onFinish;
        root=document.createElement('div');root.className='viewer-pose-transition';root.dataset.from=from;root.dataset.to=to;root.dataset.manual=String(manual);
        root.setAttribute('aria-hidden','true');Object.assign(root.style,{left:'0px',top:'0px',width:'100%',height:'100%'});
        const ghost=fan.cloneNode(false);ghost.removeAttribute('id');ghost.inert=true;ghost.classList.add('pose-fan-ghost');ghost.querySelector('.edge-peek-controls')?.remove();ghost.querySelector('.edge-fan-turn')?.remove();root.append(ghost);
        const fanRect=fan.querySelector('.edge-peek-leaf').getBoundingClientRect();ghost.style.height=fanRect.height+'px';
        const reading=from==='reading'||to==='reading',mesh=[];
        if(reading){
            const scene=fan.querySelector('.edge-fan-scene'),sceneRect=scene.getBoundingClientRect(),sx=sceneRect.width/800,sy=sceneRect.height/720;
            const w=data.rect.width/data.pages.length,h=data.rect.height;
            for(const [i,sheet] of data.pages.entries()){
                const sheets=[...fan.querySelectorAll('.edge-fan-sheet[data-source-index],.edge-fan-endpaper')];
                const target=sheets.find(el=>+el.dataset.sourceIndex===sheet.index)||sheets.filter(el=>el.dataset.side===sheet.side).at(-1);
                if(!target)continue;
                const html=Number.isInteger(sheet.index)?render(sheet.index):'';
                [...target.children].forEach(source=>{
                    if(!source.bookPoints)return;
                    const raster=Number(source.dataset.rasterScale)||1;
                    const start=+source.dataset.sourceStart,width=parseFloat(source.style.width)/raster,strip=document.createElement('div');strip.className='edge-fan-strip pose-morph-strip';strip.dataset.rasterScale=raster;
                    const content=document.createElement('div');content.className='edge-peek-content';content.innerHTML=html;content.style.left=-start+'px';strip.append(content);root.append(strip);strip.style.width=width+'px';
                    const left=data.rect.left+i*w+start*w/360,right=left+width*w/360,top=data.rect.top,bottom=top+h;
                    const flat=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
                    const curved=source.bookPoints.map(p=>({x:sceneRect.left+p.x*sx,y:sceneRect.top+p.y*sy}));
                    mesh.push({strip,width,flat,curved});
                });
            }
        }
        drawScene=p=>{
            const q=p*p*(3-2*p),t=to==='peek'?q:1-q;
            if(reading){
                ghost.style.opacity=Math.min(1,t*2);
                for(const {strip,width,flat,curved} of mesh){projectStrip(strip,flat.map((a,i)=>({x:a.x+(curved[i].x-a.x)*t,y:a.y+(curved[i].y-a.y)*t})),width);strip.style.opacity=1-Math.max(0,(t-.78)/.22);strip.style.setProperty('--pose-shade',t);}
            }else{
                const closed=Math.max(.005,data.thickness*data.rect.height/640/Math.max(1,fanRect.width));
                ghost.style.transform=`translateX(-50%) scale(${closed+(1-closed)*t},${data.rect.height/fanRect.height+(1-data.rect.height/fanRect.height)*t})`;
                ghost.style.transformOrigin='50% 50%';ghost.style.opacity=Math.min(1,t*8);
            }
        };
        if(!reading){
            const edge=document.createElement('div');edge.className='pose-motion-edge';const thick=data.thickness*data.rect.height/640;
            Object.assign(edge.style,{left:data.rect.left+data.rect.width/2-thick/2+'px',top:data.rect.top+'px',width:thick+'px',height:data.rect.height+'px'});root.append(edge);
            const drawFan=drawScene;drawScene=p=>{drawFan(p);const q=p*p*(3-2*p),t=to==='peek'?q:1-q;edge.style.opacity=1-Math.min(1,t*8);};
        }
        const leaf=fan.querySelector('.edge-peek-leaf');ghost.append(leaf);restoreFan=()=>fan.prepend(leaf);
        document.body.append(root);document.body.classList.add('viewer-pose-transition-active');draw(0);if(!manual)finish(true);return true;
    }
    return {play,playFan,cancel,draw,finish,get active(){return !!root;}};
}
