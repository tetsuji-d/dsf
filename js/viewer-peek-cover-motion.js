/** Close the fan about its binding, then rotate the rigid cover into view.
 * Animate two existing page groups on the compositor: rebuilding every curved
 * strip each frame stalls WebKit and multiplies mobile backing surfaces. */
export function createViewerPeekCoverMotion() {
    let cancelCurrent=null;
    const mix=(a,b,t)=>a+(b-a)*t;
    function play(scene,previous,next,{from,to,thickness=8,hinge=405}={}) {
        cancelCurrent?.();
        if(matchMedia('(prefers-reduced-motion:reduce)').matches){scene.replaceChildren(next);return Promise.resolve(true);}
        const capture=(pages,container)=>{
            const r=container.getBoundingClientRect(),sx=r.width/800,sy=r.height/720;
            const exterior=!!pages.querySelector('.edge-fan-closed');
            const points=[...pages.querySelectorAll('[data-active=true] .edge-fan-strip')].flatMap(el=>el.bookPoints||[]);
            const top=r.top+Math.min(...points.map(p=>p.y))*sy,bottom=r.top+Math.max(...points.map(p=>p.y))*sy;
            return {pages,container,r,sx,sy,center:r.left+(exterior?400:hinge)*sx,top,bottom,exterior};
        };
        // Keep the currently painted scene attached, so Safari can reuse it.
        const style=scene.style.cssText,parent=scene.parentElement,parentRect=parent.getBoundingClientRect();
        const target=scene.cloneNode(false);target.append(next);parent.append(target);
        const a=capture(previous,scene),b=capture(next,target);
        const root=document.createElement('div');root.className='edge-peek-cover-motion';root.dataset.from=from;root.dataset.to=to;root.dataset.progress='0';root.setAttribute('aria-hidden','true');
        const side=document.createElement('div');side.className='edge-peek-motion-side';
        const depth=Math.max(2,Math.min(64,thickness));
        Object.assign(side.style,{width:depth+'px',height:'640px',transformOrigin:'0 0'});
        const spine=(from==='C1'?previous:next).querySelector('.edge-cover-spine .edge-peek-content');
        if(spine){side.innerHTML=spine.innerHTML;for(const key of ['background','color','display','flexDirection','alignItems','boxSizing','padding','gap'])side.style[key]=spine.style[key];}
        root.append(side);document.body.append(root);
        for(const item of [a,b])Object.assign(item.container.style,{left:'0px',top:'0px',transformOrigin:'0 0',willChange:'transform'});
        const frames=[[],[],[]],duration=a.exterior&&b.exterior?520:600;
        // Dense time samples run on the compositor even while the JS thread paints.
        for(let i=0;i<=64;i++){
            const t=i/64,q=t*t*(3-2*t),angle=q*Math.PI;
            const center=mix(a.center,b.center,q),top=mix(a.top,b.top,q),bottom=mix(a.bottom,b.bottom,q);
            for(const [j,item] of [a,b].entries()){
                const amount=Math.max(.0001,j?-Math.cos(angle):Math.cos(angle));
                const ys=mix((bottom-top)/(item.bottom-item.top),1,amount);
                frames[j].push({offset:t,visibility:(j?t>=.5:t<.5)?'visible':'hidden',
                    transform:`matrix(${item.sx*amount},0,0,${item.sy*ys},${mix(center,item.r.left,amount)-parentRect.left},${top+(item.r.top-item.top)*ys-parentRect.top})`});
            }
            const width=Math.max(.1,depth*mix(a.sx,b.sx,q)*Math.sin(angle));
            frames[2].push({offset:t,opacity:Math.max(0,1-Math.abs(Math.cos(angle))*4),
                transform:`matrix(${width/depth},0,0,${(bottom-top)/640},${center-width/2},${top})`});
        }
        const animations=[scene,target,side].map((el,i)=>{const animation=el.animate(frames[i],{duration,easing:'linear',fill:'both'});animation.pause();animation.currentTime=0;return animation;});
        let frame=0,done=false;
        return new Promise(resolve=>{
            const finish=accept=>{
                if(done)return;done=true;cancelAnimationFrame(frame);
                for(const animation of animations)animation.cancel();
                scene.style.cssText=style;scene.replaceChildren(accept?next:previous);target.remove();root.remove();cancelCurrent=null;resolve(accept);
            };
            cancelCurrent=()=>finish(false);
            function tick(){root.dataset.progress=(Math.min(1,(Number(animations[0].currentTime)||0)/duration)).toFixed(4);if(!done)frame=requestAnimationFrame(tick);}
            // Begin after the initial surfaces have painted, not while Safari is
            // still allocating them (which can otherwise skip the whole turn).
            frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{if(done)return;for(const animation of animations)animation.play();tick();});});
            Promise.all(animations.map(a=>a.finished)).then(()=>finish(true),()=>{});
        });
    }
    return {play,cancel:()=>cancelCurrent?.()};
}
