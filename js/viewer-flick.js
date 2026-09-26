/** Detect a release impulse, not distance alone: pausing or reversing cancels it. */
export function createViewerFlick({eligible}) {
    const contacts=new Set();let gesture=null;
    function down(e){if(e.pointerType!=='touch')return;contacts.add(e.pointerId);
        if(contacts.size!==1){gesture=null;return;}
        if(!eligible()||!e.target.closest?.('#viewer-canvas'))return;
        const rect=document.getElementById('viewer-canvas').getBoundingClientRect();
        gesture={id:e.pointerId,x:e.clientX,y:e.clientY,width:rect.width,samples:[{x:e.clientX,t:performance.now()}]};
    }
    function move(e){if(gesture?.id!==e.pointerId)return;const now=performance.now();gesture.samples.push({x:e.clientX,t:now});while(gesture.samples.length>2&&now-gesture.samples[1].t>100)gesture.samples.shift();}
    function up(e,cancelled=false){if(e.pointerType!=='touch')return null;contacts.delete(e.pointerId);const g=gesture;gesture=null;
        if(cancelled||!g||g.id!==e.pointerId||contacts.size||!eligible())return null;
        const dx=e.clientX-g.x,dy=e.clientY-g.y,now=performance.now(),sample=g.samples.find(s=>now-s.t<=130);
        if(!sample||Math.abs(dx)<Math.max(60,g.width*.2)||Math.abs(dx)<Math.abs(dy)*1.5)return null;
        const velocity=(e.clientX-sample.x)/Math.max(16,now-sample.t),speed=Math.abs(velocity)*1000/g.width;
        if((speed<3.4||Math.abs(velocity)<1.25)||Math.sign(velocity)!==Math.sign(dx))return null;
        return {side:dx>0?'left':'right',speed:Math.min(8,speed)};
    }
    const reset=()=>{contacts.clear();gesture=null;};
    window.addEventListener('blur',reset);window.addEventListener('resize',reset);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
    return {down,move,up};
}
