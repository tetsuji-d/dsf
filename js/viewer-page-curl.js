/** Temporary visual surfaces only; navigation commits after the sheet settles. */
export function createViewerPageCurl({canvas, from, to, rtl, forward, spread, sameUnit, width, height, render, commit, targetWidth}) {
    const rect=canvas.getBoundingClientRect(), vp=document.createElement('div');
    vp.className='viewer-page-curl';vp.setAttribute('aria-hidden','true');
    Object.assign(vp.style,{left:'0px',top:'0px',width:document.documentElement.clientWidth+'px',height:document.documentElement.clientHeight+'px'});
    const world=document.createElement('div');world.className='vpc-world';vp.append(world);
    const dir=rtl?1:-1;
    const fromW=rect.width/(spread&&from.type==='spread'?2:1);
    let p=0,frame=0,dead=false,settling=false;
    const oldVisibility=document.getElementById('viewer-stage').style.visibility;
    const stage=document.getElementById('viewer-stage');
    const source=forward?from:to,dest=forward?to:from;
    function sides(unit,first){if(unit.type==='single')return rtl?(first?{left:unit.center}:{right:unit.center}):(first?{right:unit.center}:{left:unit.center});return unit;}
    const a=sides(source,true),b=sides(dest,false);
    const leafFront=rtl?a.left:a.right,leafBack=rtl?b.right:b.left;
    function surface(value){const node=document.createElement('div');node.className='vpc-page';
        if(value){const content=document.createElement('div');content.className='vpc-content';content.style.width=width+'px';content.style.height=height+'px';content.innerHTML=render(value);node.append(content);}else node.classList.add('vpc-blank');return node;}
    const left=surface(sameUnit?from.left:(rtl?b.left:a.left)),right=surface(sameUnit?from.right:(rtl?a.right:b.right));world.append(left,right);
    const strips=[];
    if(!sameUnit){for(let i=0;i<24;i++){const strip=document.createElement('div');strip.className='vpc-strip';for(const back of [false,true]){const face=document.createElement('div');face.className='vpc-face'+(back?' vpc-back':'');const page=surface(back?leafFront:leafBack);face.append(page);strip.append(face);}world.append(strip);strips.push(strip);}}
    document.body.append(vp);
    let ready=false,loadFailed=false;
    const reveal=()=>{if(dead)return;ready=true;vp.style.visibility='';stage.style.visibility='hidden';document.body.classList.add('viewer-curl-active');};
    const images=[...vp.querySelectorAll('img')];
    vp.style.visibility='hidden';
    if(!images.length||images.every(img=>img.complete&&img.naturalWidth))reveal();
    const loaded=ready?Promise.resolve():Promise.race([
        Promise.all(images.map(img=>img.decode())),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('Image preparation timeout')),2500))
    ]).then(()=>{if(!loadFailed)reveal();}).catch(()=>{loadFailed=true;});
    function focus(unit,first){if(spread||unit.type==='single')return unit.type==='single'?(first?-dir/2:dir/2):0;return unit.focus==='left'?-.5:.5;}
    function draw(value){if(dead)return;p=Math.max(0,Math.min(1,value));const q=forward?p:1-p;
        const fw=focus(from,forward),tw=focus(to,!forward);
        // Covers and spreads use the same available viewport; only the visual scale changes.
        const targetW=spread?targetWidth:fromW;
        const w=fromW+(targetW-fromW)*p,h=w*height/width;
        const zoom=spread?1:1-.1*Math.sin(Math.PI*p);
        world.style.transform='translate('+((rect.left+rect.width/2)-(fw+(tw-fw)*p)*w*zoom)+'px,'+(rect.top+rect.height/2-h*zoom/2)+'px) scale('+zoom+')';
        world.style.setProperty('--vpc-w',w+'px');world.style.setProperty('--vpc-h',h+'px');world.style.setProperty('--vpc-scale',w/width);
        left.style.left=-w+'px';right.style.left='0px';
        let x=0,z=0;const sw=w/24;
        strips.forEach((strip,i)=>{const angle=-dir*Math.PI*(1-q)+dir*Math.sin(Math.PI*q)*.8*((i+.5)/24-.5);
            strip.style.width=sw+'px';strip.style.height=h+'px';strip.style.transform='translate3d('+(dir*x)+'px,0,'+z+'px) rotateY('+angle+'rad)';
            // The LTR leaf extends left from its hinge; mirror geometry, never text.
            if(!rtl)strip.style.transform+=' translateX('+(-sw)+'px)';
            const original=rtl?i*sw:w-(i+1)*sw;
            strip.children[0].firstChild.style.left=(1.25-original)+'px';
            strip.children[1].firstChild.style.left=(1.25-(w-original-sw))+'px';
            strip.style.setProperty('--vpc-shade',Math.abs(Math.sin(angle))*.18);
            x+=Math.cos(angle)*sw;z+=Math.abs(Math.sin(angle))*sw;
        });
    }
    function cleanup(){if(dead)return;dead=true;cancelAnimationFrame(frame);vp.remove();stage.style.visibility=oldVisibility;document.body.classList.remove('viewer-curl-active');window.removeEventListener('resize',cancel);}
    function cancel(){cleanup();}
    window.addEventListener('resize',cancel);
    async function finish(accept){if(dead||settling)return;settling=true;await loaded;if(dead)return;if(loadFailed){cleanup();if(accept)commit();return;}const initial=p,end=accept?1:0,time=matchMedia('(prefers-reduced-motion:reduce)').matches?0:Math.max(120,440*Math.abs(end-initial));const started=performance.now();
        await new Promise(resolve=>{function tick(now){if(dead){resolve();return;}const t=time?Math.min(1,(now-started)/time):1;draw(initial+(end-initial)*t*t*(3-2*t));if(t<1)frame=requestAnimationFrame(tick);else resolve();}tick(started);});
        if(dead)return;cleanup();if(accept)commit();
    }
    draw(0);
    return {draw,finish,cancel,get progress(){return p;},get active(){return !dead;}};
}
