/** One trackpad gesture owns one axis and one book action, including its momentum tail. */
export function createViewerBookWheel({enabled, begin, progress, finish, horizontal, busy, step, onClaim=()=>{}}) {
    let gesture=null,timer=0;
    function release(cancelled=false){
        clearTimeout(timer);const g=gesture;gesture=null;
        const accept=!cancelled&&g&&g.distance*g.sign>=56;
        if(g?.manual)finish(accept);else if(accept&&g.axis==='y')step(g.sign<0?'up':'down');
    }
    window.addEventListener('blur',()=>release(true));
    window.addEventListener('resize',()=>release(true));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)release(true);});
    return {get active(){return !!gesture;},cancel:()=>release(true),handle(e){
        if(e.ctrlKey||e.metaKey||!enabled()) {release(true);return false;}
        // The book changes its hit area while closing and turning. Keep ownership
        // for the whole gesture, and accept the reader background in every pose.
        if(!gesture){
            if(e.target.closest?.('button,a,input,select,textarea,summary,[contenteditable],#viewer-header,#viewer-info-panel,#reader-assist-panel,#viewer-page-settings,.edge-peek-controls,[role=dialog]'))return false;
            if(e.target!==document.body&&e.target!==document.documentElement&&!e.target.closest?.('#viewer-layout,#viewer-book-pose,#viewer-edge-peek,.viewer-pose-transition'))return false;
            gesture={x:0,y:0,axis:null,manual:false,done:busy()};onClaim();
        }
        e.preventDefault();clearTimeout(timer);
        try {
            const g=gesture;if(g.done)return true;
            const unit=e.deltaMode===1?16:e.deltaMode===2?innerHeight:1;
            g.x+=e.deltaX*unit;g.y+=e.deltaY*unit;
            if(!g.axis){
                if(Math.max(Math.abs(g.x),Math.abs(g.y))<14)return true;
                if(Math.abs(g.y)>Math.abs(g.x)*1.35)g.axis='y';
                else if(Math.abs(g.x)>Math.abs(g.y)*1.35)g.axis='x';
                else return true;
                g.sign=Math.sign(g[g.axis]);
                if(g.axis==='y')g.manual=begin(g.sign<0?'up':'down');
            }
            g.distance=g[g.axis];
            if(g.axis==='y') {
                if(g.manual)progress(Math.max(0,Math.min(1,g.distance*g.sign/220)));
            } else if(Math.abs(g.distance)>=56){g.done=true;horizontal(g.distance>0?'right':'left');}
            return true;
        } finally {
            // Building the first fan can block the main thread. Measure silence
            // after processing this event, not before that synchronous rendering.
            timer=setTimeout(()=>release(),240);
        }
    }};
}
