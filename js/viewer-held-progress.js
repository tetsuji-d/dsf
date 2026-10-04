/** A held input owns progress until release. Silence alone never settles it. */
export function animateViewerHeldProgress({gesture=null,duration=320,draw,reduced=false}) {
    let frame=0,done=false,last=0,from=0,start=performance.now(),releasing=!gesture,resolve;
    const finished=new Promise(r=>{resolve=r;});
    const finish=accept=>{if(done)return;done=true;cancelAnimationFrame(frame);resolve(accept);};
    function tick(now){
        if(done)return;
        if(gesture?.ended===null){
            last=Math.max(0,Math.min(1,gesture.progress));
            draw(reduced?0:last);releasing=false;
        }else{
            if(!releasing){from=last;start=now;releasing=true;}
            const end=gesture?.ended===false?0:1;
            const time=reduced?0:Math.max(180,duration*Math.abs(end-from));
            const p=time?Math.min(1,(now-start)/time):1;
            last=from+(end-from)*p*p*(3-2*p);draw(last);
            if(p===1){finish(end===1);return;}
        }
        frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);
    return {finished,cancel:()=>finish(false)};
}
