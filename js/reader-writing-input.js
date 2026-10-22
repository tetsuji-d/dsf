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

/** One idle deadline, cancelled on interaction and disposal. */
export function createWritingDock({isOpen,blocked,setOpen,schedule=setTimeout,cancel=clearTimeout}) {
    let timer=null,disposed=false;
    const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
    const arm=()=>{clear();if(disposed||!isOpen())return;
        timer=schedule(()=>{timer=null;if(disposed||!isOpen())return;if(blocked()){arm();return;}setOpen(false);},3000);};
    return {arm,clear,dispose(){disposed=true;clear();}};
}
/** Only a horizontal pull on the handle changes the dock state. */
export function writingDockRelease(open,dx,dy){
    if(Math.abs(dx)<24||Math.abs(dx)<Math.abs(dy)*1.25)return open;
    return dx<0;
}
