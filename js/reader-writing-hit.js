import {highlighterPolygons} from './reader-writing-tools.js';
import {arrowHeadGeometry,arrowShaftGeometry} from './reader-writing-format.js';

const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const polygonHit=(p,points,tolerance)=>{
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
        const [x,y]=points[i],[a,b]=points[j];
        if(distance(p,{x,y},{x:a,y:b})<=tolerance)return true;
        if((y>p.y)!==(b>p.y)&&p.x<(a-x)*(p.y-y)/(b-y)+x)inside=!inside;
    }return inside;
};
/** Select visible ink rather than the empty interior of an object's bounding rectangle. */
export function writingHitTest(o,p,tolerance=6){
    if(o.type==='text'){const [x,y,w,h]=o.rect;return p.x>=x-tolerance&&p.x<=x+w+tolerance&&p.y>=y-tolerance&&p.y<=y+h+tolerance;}
    if(o.type==='stroke'){
        if(o.tool==='highlighter')return highlighterPolygons(o.points).some(poly=>polygonHit(p,poly,tolerance));
        return o.points.some((b,i)=>{const a=o.points[Math.max(0,i-1)];return distance(p,a,b)<=tolerance+Math.max(a.width,b.width)/2;});
    }
    if(o.type==='line'){
        const shaft=arrowShaftGeometry(o),segments=shaft?[[{x:shaft.from[0],y:shaft.from[1]},{x:shaft.to[0],y:shaft.to[1]}]]:[];
        for(const h of arrowHeadGeometry(o)){
            if(h.kind==='circle'){if(Math.hypot(p.x-h.center[0],p.y-h.center[1])<=h.radius+tolerance)return true;}
            else if(h.kind!=='open'){if(polygonHit(p,h.points,tolerance+o.width/2))return true;}
            else for(let i=1;i<h.points.length;i++)segments.push([{x:h.points[i-1][0],y:h.points[i-1][1]},{x:h.points[i][0],y:h.points[i][1]}]);
        }
        return segments.some(([a,b])=>distance(p,a,b)<=tolerance+o.width/2);
    }
    const [x,y,w,h]=o.rect,r=tolerance+o.width/2;
    if(o.shape==='rect'){
        if(o.fill&&p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h)return true;
        return [[{x,y},{x:x+w,y}],[{x:x+w,y},{x:x+w,y:y+h}],[{x:x+w,y:y+h},{x,y:y+h}],[{x,y:y+h},{x,y}]].some(([a,b])=>distance(p,a,b)<=r);
    }
    const cx=x+w/2,cy=y+h/2;
    if(o.fill&&((p.x-cx)/(w/2))**2+((p.y-cy)/(h/2))**2<=1)return true;
    // Sample the ellipse perimeter; spacing is <=2 page pixels even for a full-page ellipse.
    const count=Math.max(32,Math.ceil(Math.PI*Math.max(w,h)/2));let previous={x:x+w,y:cy};
    for(let i=1;i<=count;i++){const a=i/count*Math.PI*2,next={x:cx+w/2*Math.cos(a),y:cy+h/2*Math.sin(a)};if(distance(p,previous,next)<=r)return true;previous=next;}return false;
}
