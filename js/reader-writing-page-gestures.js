/** One finger in reading mode; two fingers while writing. Never turn on a pen stroke. */
export function installWritingPageGestures(input,{isReading,cancelStroke,turn,isRtl}){
    const points=new Map();let session=null,blocked=false;
    const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
    input.addEventListener('pointerdown',e=>{
        if(e.pointerType!=='touch')return;
        points.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(points.size===2){cancelStroke();const p=[...points.values()];session={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,dx:0,dy:0};blocked=true;
            for(const id of points.keys())input.setPointerCapture(id);consume(e);
        }else if(points.size===1&&isReading()){session={x:e.clientX,y:e.clientY,dx:0,dy:0};blocked=true;input.setPointerCapture(e.pointerId);consume(e);}
        else if(points.size>2){session=null;blocked=true;consume(e);}
    },true);
    input.addEventListener('pointermove',e=>{
        if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(!blocked)return;
        if(session){const values=[...points.values()],x=values.reduce((n,p)=>n+p.x,0)/values.length,y=values.reduce((n,p)=>n+p.y,0)/values.length;
            session.dx=x-session.x;session.dy=y-session.y;}
        consume(e);
    },true);
    const end=(e,cancel)=>{if(!points.has(e.pointerId))return;points.delete(e.pointerId);
        if(blocked){consume(e);if(session&&!cancel&&Math.abs(session.dx)>48&&Math.abs(session.dx)>Math.abs(session.dy)*1.4)turn((session.dx<0?1:-1)*(isRtl()?-1:1));session=null;}
        if(!points.size){blocked=false;session=null;}
    };
    input.addEventListener('pointerup',e=>end(e,false),true);input.addEventListener('pointercancel',e=>end(e,true),true);
}

/** Vertical drawer drags coexist with the shelf's native horizontal scrolling. */
export function installWritingToolDrawer(target,{enabled,isOpen,settle,drag,finish,signal,captureStart=false}){
    let gesture=null,suppressClick=false;const pointers=new Set();
    const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
    const reset=()=>{if(gesture?.vertical){settle(gesture.open);finish();}gesture=null;};
    target.addEventListener('pointerdown',e=>{
        if(!enabled()||e.pointerType==='pen'||e.button>0)return;
        pointers.add(e.pointerId);suppressClick=false;
        if(pointers.size>1){reset();return;}
        gesture={id:e.pointerId,x:e.clientX,y:e.clientY,dy:0,open:isOpen(),vertical:false};
        if(captureStart)target.setPointerCapture(e.pointerId);
    },{capture:true,signal});
    target.addEventListener('pointermove',e=>{
        if(!gesture||gesture.id!==e.pointerId)return;
        if(!enabled()){reset();return;}
        const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
        if(!gesture.vertical){
            if(Math.max(Math.abs(dx),Math.abs(dy))<9)return;
            if(Math.abs(dx)>Math.abs(dy)*1.2){gesture=null;return;}
            if(Math.abs(dy)<=Math.abs(dx)*1.2)return;
            gesture.vertical=true;suppressClick=true;target.setPointerCapture(e.pointerId);
        }
        gesture.dy=dy;consume(e);drag(dy,gesture.open);
    },{capture:true,signal});
    const end=(e,cancel)=>{
        pointers.delete(e.pointerId);if(gesture?.id!==e.pointerId)return;
        const g=gesture;gesture=null;
        if(g.vertical){consume(e);settle(cancel?g.open:g.open?g.dy>-28:g.dy>=28);finish();}
        if(target.hasPointerCapture?.(e.pointerId))target.releasePointerCapture(e.pointerId);
    };
    target.addEventListener('pointerup',e=>end(e,false),{capture:true,signal});
    target.addEventListener('pointercancel',e=>end(e,true),{capture:true,signal});
    target.addEventListener('click',e=>{if(suppressClick){consume(e);suppressClick=false;}},{capture:true,signal});
    signal?.addEventListener('abort',reset,{once:true});
}
