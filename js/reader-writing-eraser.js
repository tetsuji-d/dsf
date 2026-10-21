/** Per-object transparent masks: never alter the original page or later annotations. */
function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a[0]-t*dx,p.y-a[1]-t*dy);}
export function writingPointErased(object,point){return (object.erasures||[]).some(mask=>{const [sx,sy,tx,ty]=mask.transform,p={x:(point.x-tx)/sx,y:(point.y-ty)/sy};return mask.points.some((b,i)=>distance(p,mask.points[Math.max(0,i-1)],b)<=mask.width/2);});}
export function transformWritingErasures(object,sx=1,sy=1,tx=0,ty=0){if(object.erasures)object.erasures=object.erasures.map(mask=>({...mask,transform:[mask.transform[0]*sx,mask.transform[1]*sy,mask.transform[2]*sx+tx,mask.transform[3]*sy+ty]}));return object;}
export function resizeWritingErasures(object,before,after){const sx=after[2]/before[2],sy=after[3]/before[3];return transformWritingErasures(object,sx,sy,after[0]-before[0]*sx,after[1]-before[1]*sy);}
export function eraseWritingObjects(objects,stroke,hitTest){
    const points=stroke.points.map(p=>[p.x,p.y]),width=stroke.baseWidth,samples=[];
    for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.max(1,width/4)));for(let j=1;j<=steps;j++)samples.push({x:a[0]+(b[0]-a[0])*j/steps,y:a[1]+(b[1]-a[1])*j/steps});}
    let changed=false;
    const result=objects.map(o=>{if(o.locked||!samples.some(p=>hitTest(o,p,width/2,true)))return o;
        changed=true;return {...o,erasures:[...(o.erasures||[]),{width,points,transform:[1,1,0,0]}]};});
    return changed?result:objects;
}
/** The SVG image has transparent holes; CSS uses its alpha for both text and SVG ink. */
export function writingEraseMask(object){
    if(!object.erasures?.length)return '';
    const paths=object.erasures.map(m=>{const [sx,sy,tx,ty]=m.transform;return '<g transform="matrix('+[sx,0,0,sy,tx,ty].join(' ')+')"><polyline fill="none" stroke="black" stroke-linecap="round" stroke-linejoin="round" stroke-width="'+m.width+'" points="'+m.points.map(p=>p.join(',')).join(' ')+'"/><circle fill="black" cx="'+m.points[0][0]+'" cy="'+m.points[0][1]+'" r="'+m.width/2+'"/></g>';}).join('');
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 640"><defs><mask id="erase" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="640" style="mask-type:luminance"><rect width="360" height="640" fill="white"/>'+paths+'</mask></defs><rect width="360" height="640" fill="white" mask="url(#erase)"/></svg>';
    return 'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
}
