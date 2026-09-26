/** One trackpad gesture owns one axis and one book action, including its momentum tail. */
export function createViewerBookWheel({enabled, begin, progress, finish, horizontal, busy, step}) {
    let gesture=null,timer=0;
    function release(cancelled=false){
        clearTimeout(timer);const g=gesture;gesture=null;
        const accept=!cancelled&&g?.distance*g.sign>=56;
        if(g?.manual)finish(accept);else if(accept&&g.axis==='y')step(g.sign<0?'up':'down');
    }
    window.addEventListener('blur',()=>release(true));
    window.addEventListener('resize',()=>release(true));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)release(true);});
    return {cancel:()=>release(true),handle(e){
        if(e.ctrlKey||e.metaKey||e.deltaMode!==0||!enabled()) {release(true);return false;}
        if(!e.target.closest?.('#viewer-stage,#viewer-canvas,#viewer-book-pose,.edge-peek-leaf'))return false;
        e.preventDefault();clearTimeout(timer);timer=setTimeout(()=>release(),240);
        if(!gesture)gesture={x:0,y:0,axis:null,manual:false,done:busy()};
        const g=gesture;if(g.done)return true;
        g.x+=e.deltaX;g.y+=e.deltaY;
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
    }};
}
