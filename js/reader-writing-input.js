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
