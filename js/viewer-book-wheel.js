/** One trackpad stroke owns one axis, including its momentum tail. */
export function createViewerBookWheel({enabled, begin, progress, finish, horizontal, busy, step, onClaim=()=>{}}) {
    const threshold=32;
    let gesture=null,timer=0,queued=null,queueFrame=0;
    function cancelQueue(){queued=null;cancelAnimationFrame(queueFrame);}
    function dispatch(action){
        cancelQueue();
        if(!busy()){action();return;}
        queued={action,until:performance.now()+1500};
        function retry(){
            if(!queued)return;
            if(!enabled()||performance.now()>queued.until){cancelQueue();return;}
            if(busy()){queueFrame=requestAnimationFrame(retry);return;}
            const run=queued.action;queued=null;run();
        }
        queueFrame=requestAnimationFrame(retry);
    }
    function release(cancelled=false){
        clearTimeout(timer);const g=gesture;gesture=null;
        const accept=!!(!cancelled&&g&&g.distance*g.sign>=threshold);
        if(g?.manual)finish(accept);
        else if(accept&&!g.done)dispatch(()=>g.axis==='y'?step(g.sign<0?'up':'down'):horizontal(g.sign>0?'right':'left'));
        if(cancelled)cancelQueue();
    }
    window.addEventListener('blur',()=>release(true));
    window.addEventListener('resize',()=>release(true));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)release(true);});
    return {get active(){return !!gesture||!!queued;},cancel:()=>release(true),handle(e){
        if(e.ctrlKey||e.metaKey||!enabled()){release(true);return false;}
        const unit=e.deltaMode===1?16:e.deltaMode===2?innerHeight:1;
        const x=e.deltaX*unit,y=e.deltaY*unit,now=performance.now();
        // A renewed impulse after a decaying tail is a fresh stroke. Do not make
        // the user wait for every tiny momentum event to disappear first.
        if(gesture?.axis){
            const g=gesture,d=g.axis==='x'?x:y,amp=Math.abs(d),impulse=Math.max(3,Math.min(10,g.peak*.6));
            const renewed=g.committedAt&&now-g.committedAt>180&&g.decayed&&amp>=impulse&&amp>g.lastAmplitude*2;
            const reversed=g.done&&Math.sign(d)!==g.sign&&amp>=impulse;
            if(renewed||reversed)release();
        }
        if(!gesture){
            if(e.target.closest?.('button,a,input,select,textarea,summary,[contenteditable],#viewer-header,#viewer-info-panel,#reader-assist-panel,#viewer-page-settings,.edge-peek-controls,[role=dialog]'))return false;
            if(e.target!==document.body&&e.target!==document.documentElement&&!e.target.closest?.('#viewer-layout,#viewer-book-pose,#viewer-edge-peek,.viewer-pose-transition'))return false;
            gesture={x:0,y:0,axis:null,manual:false,started:false,done:false,peak:0,lastAmplitude:0,decayed:false};onClaim();
        }
        e.preventDefault();clearTimeout(timer);
        try{
            const g=gesture;g.x+=x;g.y+=y;
            if(!g.axis){
                if(Math.max(Math.abs(g.x),Math.abs(g.y))<10)return true;
                if(Math.abs(g.y)>Math.abs(g.x)*1.15)g.axis='y';
                else if(Math.abs(g.x)>Math.abs(g.y)*1.15)g.axis='x';
                else return true;
                g.sign=Math.sign(g[g.axis]);
            }
            const amplitude=Math.abs(g.axis==='x'?x:y);
            g.peak=Math.max(g.peak,amplitude);if(amplitude<g.peak*.4)g.decayed=true;g.lastAmplitude=amplitude;
            g.distance=g[g.axis];
            if(g.distance*g.sign>=threshold&&!g.committedAt)g.committedAt=now;
            if(g.done)return true;
            if(g.axis==='y'){
                if(!g.started&&!busy()){g.started=true;g.manual=begin(g.sign<0?'up':'down');}
                if(g.manual)progress(Math.max(0,Math.min(1,g.distance*g.sign/160)));
            }else if(g.distance*g.sign>=threshold&&!busy()){
                g.done=true;horizontal(g.sign>0?'right':'left');
            }
            return true;
        }finally{
            // Start the silence window after synchronous fan rendering finishes.
            timer=setTimeout(()=>release(),180);
        }
    }};
}
