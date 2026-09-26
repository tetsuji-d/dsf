/** One animation at a time; releasing a hold cancels any unfinished repeat. */
export function createViewerRiffle({canRun,canStep,busy,step,cancelTurn,epoch}) {
    let hold=null,timer=0,loop=0,rapid=false,suppressClickUntil=0,lastStep=0,turnDuration=120;
    function stop(){clearTimeout(timer);clearInterval(loop);const wasRapid=rapid;hold=null;rapid=false;if(wasRapid)cancelTurn();}
    function tick(){
        if(!hold||!canRun()||hold.epoch!==epoch()){stop();return;}
        if(busy()||performance.now()-lastStep<110)return;
        if(!canStep(hold.side)||hold.remaining===0){stop();return;}
        if(hold.source.type==='inertia'){turnDuration=Math.min(280,120+hold.count*40);hold.count++;hold.remaining--;}
        lastStep=performance.now();step(hold.side);
    }
    function begin(side,source) {
        stop();if(!canRun())return;
        turnDuration=120;hold={side,source,epoch:epoch()};
        timer=setTimeout(()=>{if(!hold)return;rapid=true;if(source.type==='pointer')suppressClickUntil=Infinity;tick();if(hold)loop=setInterval(tick,32);},500);
    }
    document.addEventListener('keyup',e=>{if(hold?.source.type==='key'&&hold.source.key===e.key)stop();});
    document.addEventListener('pointerdown',e=>{
        const button=e.target.closest?.('#viewer-reader-controls #viewer-nav-left,#viewer-reader-controls #viewer-nav-right');
        if(!button){if(hold)stop();return;}
        if(e.button!==0||!e.isPrimary)return;
        try{button.setPointerCapture(e.pointerId);}catch{}
        begin(button.id.endsWith('left')?'left':'right',{type:'pointer',id:e.pointerId});
    },true);
    function release(e){if(suppressClickUntil===Infinity)suppressClickUntil=Date.now()+500;if(hold?.source.type==='pointer'&&hold.source.id===e.pointerId)stop();}
    document.addEventListener('pointerup',release,true);document.addEventListener('pointercancel',release,true);
    document.addEventListener('click',e=>{if(Date.now()<suppressClickUntil&&e.target.closest?.('#viewer-reader-controls #viewer-nav-left,#viewer-reader-controls #viewer-nav-right')){e.preventDefault();e.stopImmediatePropagation();}},true);
    window.addEventListener('blur',()=>{stop();suppressClickUntil=Date.now()+500;});window.addEventListener('resize',stop);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();suppressClickUntil=Date.now()+500;}});
    return {stop,get turnDuration(){return turnDuration;},fling(side,speed){
        if(!canRun()||matchMedia('(prefers-reduced-motion:reduce)').matches)return false;
        stop();turnDuration=120;rapid=true;lastStep=0;
        hold={side,source:{type:'inertia'},epoch:epoch(),remaining:Math.min(5,Math.max(2,Math.floor(speed-1))),count:0};
        tick();if(hold)loop=setInterval(tick,24);return true;
    },get active(){return rapid;},keyDown(e){
        if(!['ArrowLeft','ArrowRight'].includes(e.key))return false;
        if(e.repeat||hold?.source.key===e.key){e.preventDefault();return true;}
        begin(e.key==='ArrowLeft'?'left':'right',{type:'key',key:e.key});return false;
    }};
}
