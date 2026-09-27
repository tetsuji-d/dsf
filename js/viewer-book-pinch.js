/** Pinch owns both contacts until both lift. Page swipes never receive its tail.
 * A gesture that begins zoomed only changes zoom; a fresh inward pinch at 1x
 * returns to the fan. Trackpad ctrl-wheel uses the same reversible timeline. */
export function createViewerBookPinch({enabled,state,scale,wide,busy,claim,begin,draw,finish,zoom,consume=()=>{}}){
    const contacts=new Map();let gesture=null,owned=false,wheelTimer=0;
    const blockedTarget=e=>e.target.closest?.('button,a,input,select,textarea,summary,[contenteditable],#viewer-header,#viewer-info-panel,#reader-assist-panel,#viewer-page-settings,[role=dialog]');
    const allowed=e=>!blockedTarget(e)&&(e.target===document.body||e.target===document.documentElement||e.target.closest?.('#viewer-layout,#viewer-edge-peek,.viewer-pose-transition'));
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();consume();return true;};
    function start(kind,point,distance=1){
        const mode=state();gesture={kind,mode,initial:scale(),distance,amount:0,target:null,manual:false,progress:0,zoomOnly:scale()>1.05,point};owned=true;claim(point);
    }
    function update(amount,point){
        const g=gesture;if(!g)return;
        g.amount=amount;g.point=point;
        if(g.zoomOnly){zoom(g.initial*Math.exp(amount),point);return;}
        if(!g.target){
            if(Math.abs(amount)<.03)return;
            if(g.mode==='reading'&&amount>0){g.zoomOnly=true;zoom(g.initial*Math.exp(amount),point);return;}
            const target=g.mode==='peek'&&amount>0?(wide()?'book':'reading')
                :g.mode==='book'?(amount<0?'peek':'reading')
                :g.mode==='reading'&&amount<0?'peek':null;
            if(!target)return;
            g.target=target;g.sign=Math.sign(amount);g.manual=begin(target,true);
        }
        g.progress=Math.max(0,Math.min(1,amount*g.sign/.28));
        if(g.manual)draw(g.progress);
    }
    function release(cancelled=false){
        clearTimeout(wheelTimer);const g=gesture;gesture=null;
        if(g?.target){const accept=!cancelled&&g.progress>=.45;if(g.manual)finish(accept);else if(accept)begin(g.target,false);}
    }
    function cancel(){release(true);contacts.clear();owned=false;}
    window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    const pair=()=>{const [a,b]=[...contacts.values()];return {distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),point:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};};
    return {cancel,get active(){return owned||!!gesture;},pointerDown(e){
        if(e.pointerType!=='touch'||(!owned&&(!enabled()||!allowed(e))))return false;
        contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(contacts.size===2&&!owned&&!busy()&&['peek','book','reading'].includes(state())){const p=pair();start('touch',p.point,p.distance);}
        return owned?stop(e):false;
    },pointerMove(e){
        if(contacts.has(e.pointerId))contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(!owned)return false;
        if(contacts.size===2&&gesture?.kind==='touch'){const p=pair();update(Math.log(p.distance/gesture.distance),p.point);}
        return stop(e);
    },pointerEnd(e,cancelled=false){
        const known=contacts.delete(e.pointerId);if(!owned||!known)return false;
        if(gesture?.kind==='touch')release(cancelled);
        if(!contacts.size)owned=false;
        return stop(e);
    },wheel(e){
        if(!e.ctrlKey||e.metaKey||!enabled()||!allowed(e))return false;
        if(owned&&gesture?.kind!=='wheel')return stop(e);
        if(!gesture){if(busy()||!['peek','book','reading'].includes(state()))return false;start('wheel',{x:e.clientX,y:e.clientY});}
        update(gesture.amount-e.deltaY*.01,{x:e.clientX,y:e.clientY});
        clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{release();owned=false;},320);
        return stop(e);
    }};
}
