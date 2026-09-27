/** Own deliberate pose gestures; progress follows the finger until release. */
export function createViewerBookSwipe({canvas, enabled, contextKey, onClaim, onConsume, onPose,canOpenEdge=()=>false,onBegin=()=>false,onProgress=()=>{},onFinish=()=>{}}) {
    const contacts=new Set();let gesture=null,blocked=false;
    function consume(e){e.preventDefault();e.stopImmediatePropagation();onConsume();return true;}
    function cancel(){if(gesture?.owned){if(gesture.manual)onFinish(false);blocked=contacts.size>0;onConsume();}gesture=null;}
    window.addEventListener('resize',cancel);window.addEventListener('blur',()=>{cancel();contacts.clear();blocked=false;});
    function pointerDown(e){
        if(e.pointerType!=='touch')return false;contacts.add(e.pointerId);
        if(blocked)return consume(e);if(contacts.size!==1){cancel();return blocked?consume(e):false;}
        if(!enabled()||!(canvas.contains(e.target)||e.target.closest?.('#viewer-book-pose,.edge-peek-leaf')))return false;
        const r=(e.target.closest?.('.edge-peek-leaf')||canvas).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return false;
        gesture={id:e.pointerId,x:e.clientX,y:e.clientY,key:contextKey(),owned:false,threshold:Math.max(48,Math.min(84,r.height*.1)),width:r.width,height:r.height};return false;
    }
    function pointerMove(e){
        if(blocked&&contacts.has(e.pointerId))return consume(e);if(gesture?.id!==e.pointerId)return false;
        if(!enabled()||gesture.key!==contextKey()){cancel();return blocked?consume(e):false;}
        const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
        if(!gesture.owned){
            if(Math.max(Math.abs(dx),Math.abs(dy))<12)return false;
            const vertical=Math.abs(dy)>Math.abs(dx)*1.35,horizontal=Math.abs(dx)>Math.abs(dy)*1.35;
            if(!vertical&&!(horizontal&&canOpenEdge())){gesture=null;return false;}
            gesture.axis=vertical?'y':'x';gesture.sign=Math.sign(vertical?dy:dx);gesture.action=vertical?(dy<0?'up':'down'):'open';
            gesture.travel=vertical?Math.max(150,Math.min(300,gesture.height*.35)):Math.max(120,Math.min(360,gesture.width*.65));
            gesture.owned=true;onClaim();gesture.manual=onBegin(gesture.action);
            try{canvas.setPointerCapture(e.pointerId);}catch{}
        }
        if(gesture.manual)onProgress(Math.max(0,Math.min(1,(gesture.axis==='y'?dy:dx)*gesture.sign/gesture.travel)));
        return consume(e);
    }
    function finish(e,cancelled){
        if(e.pointerType!=='touch')return false;contacts.delete(e.pointerId);
        if(blocked){if(!contacts.size)blocked=false;return consume(e);}if(gesture?.id!==e.pointerId)return false;
        const g=gesture;gesture=null;if(!g.owned)return false;try{canvas.releasePointerCapture(e.pointerId);}catch{}consume(e);
        const dx=e.clientX-g.x,dy=e.clientY-g.y,primary=g.axis==='y'?dy:dx,secondary=g.axis==='y'?dx:dy;
        const accept=!cancelled&&enabled()&&g.key===contextKey()&&primary*g.sign>=g.threshold&&Math.abs(primary)>Math.abs(secondary)*1.35;
        if(g.manual)onFinish(accept);else if(accept)onPose(g.action);return true;
    }
    return {reset(){cancel();contacts.clear();blocked=false;},pointerDown,pointerMove,pointerUp:e=>finish(e,false),pointerCancel:e=>finish(e,true)};
}
