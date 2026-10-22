/** Preserve actual samples only. Older Safari falls back to the dispatched event. */
export function writingPointerSamples(event) {
    let samples=[];
    try{samples=Array.from(event.getCoalescedEvents?.()||[]);}catch{/* Optional API. */}
    samples=samples.filter(p=>Number.isFinite(p.clientX)&&Number.isFinite(p.clientY)&&
        (p.pointerId===undefined||p.pointerId===event.pointerId));
    const last=samples.at(-1);
    if(!last||last.clientX!==event.clientX||last.clientY!==event.clientY||last.timeStamp!==event.timeStamp)samples.push(event);
    return samples.map(p=>({clientX:p.clientX,clientY:p.clientY,timeStamp:p.timeStamp??event.timeStamp,
        pointerType:p.pointerType||event.pointerType,pressure:p.pressure??event.pressure}));
}

/** Coalesce painting, never input collection. Cancellation prevents stale ink. */
export function writingFrameQueue(paint,request=requestAnimationFrame,cancel=cancelAnimationFrame) {
    let frame=null;
    const clear=()=>{if(frame!==null)cancel(frame);frame=null;};
    return {schedule(){if(frame===null)frame=request(()=>{frame=null;paint();});},
        clear,flush(){clear();paint();}};
}

/** Reveal only after an idle mouse dwell; never while a pointer is drawing. */
export function installWritingToolsReveal({target,signal,bottom,canReveal,reveal,
    schedule=setTimeout,cancel=clearTimeout}) {
    let timer=null;
    const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
    target.addEventListener('pointermove',event=>{
        const edge=bottom();
        if(event.pointerType!=='mouse'||event.buttons||event.clientY<edge-24||event.clientY>edge||!canReveal()){
            clear();return;
        }
        if(timer===null)timer=schedule(()=>{timer=null;if(canReveal())reveal();},200);
    },{capture:true,signal});
    for(const type of ['pointerdown','pointercancel','pointerleave'])target.addEventListener(type,clear,{capture:true,signal});
    signal.addEventListener('abort',clear,{once:true});
    return clear;
}
