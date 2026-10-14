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
