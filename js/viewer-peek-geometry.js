/** Developable 360 x 640 sheets, projected obliquely from above.
 * The cross-section is integrated by arc length, so opening/bending cannot
 * widen the source image. The vertical generators stay exactly 640 units. */
export const PEEK_PAGE_WIDTH = 360;
export const PEEK_PAGE_HEIGHT = 640;
// Show the depth of the bow instead of flattening it almost edge-on.
export const PEEK_DEPTH_PROJECTION = .30;
const radians = degrees => degrees * Math.PI / 180;
const mix = (a, b, t) => a + (b - a) * t;

export function peekPaperProfile(extent=1, tilt=0, lift=0, compact=0) {
    const e=Math.max(0,Math.min(1,extent)), c=Math.max(0,Math.min(1,compact));
    // Use physical bend radii: the cover/rear leaf has R = page width / 3.
    // The broad arc reaches the middle of the page instead of making a short
    // hinge followed by a long, rigid panel. Portrait mode changes its pose,
    // not its radius or the source paper dimensions.
    // Inner leaves curve across their whole width, including on narrow screens.
    // A short circular hinge followed by a long flat tail looks like a board.
    const poses=[{e:0,h:90,f:90,r:Infinity},
        {e:.48,h:mix(80,87,c),f:mix(28,74,c),r:Infinity},
        {e:.74,h:mix(79,88,c),f:mix(0,62,c),r:Infinity},
        {e:1,h:mix(70,10,c),f:mix(-30,-89,c),r:PEEK_PAGE_WIDTH/3}];
    const index=poses.findIndex(p=>p.e>=e),a=poses[Math.max(0,index-1)],b=poses[index];
    const t=b.e===a.e?0:(e-a.e)/(b.e-a.e),raise=tilt*(1-.85*c)+lift*5*e;
    const hinge=Math.min(89.5,mix(a.h,b.h,t)+raise),edge=Math.min(89.5,mix(a.f,b.f,t)+raise);
    const bend=radians(edge-hinge);
    const kneeFor=p=>Number.isFinite(p.r)?Math.min(1,Math.abs(radians(p.f-p.h))*p.r/PEEK_PAGE_WIDTH):1;
    return {hinge:radians(hinge),bend,knee:mix(kneeFor(a),kneeFor(b),t)};
}

export function peekPaperSection(t, {extent=1, tilt=0, lift=0, compact=0, length=PEEK_PAGE_WIDTH}={}) {
    const {hinge,bend,knee}=peekPaperProfile(extent,tilt,lift,compact);
    if(Math.abs(bend)<1e-7)return {x:length*t*Math.cos(hinge),z:length*t*Math.sin(hinge)};
    const u=Math.min(t/knee,1),angle=hinge+bend*u,tail=Math.max(0,t-knee)*length;
    return {x:length*knee*(Math.sin(angle)-Math.sin(hinge))/bend+tail*Math.cos(angle),
        z:length*knee*(Math.cos(hinge)-Math.cos(angle))/bend+tail*Math.sin(angle)};
}

export function peekPaperPoint({side,extent=1,bindingWidth=0,hinge=405,
    stackDepth=0,layer=1,cover=false,lift=0,compact=0},t,v) {
    const attachment=cover?side*bindingWidth/2:side*bindingWidth/2*(1-layer)+(hinge-405)*layer;
    // The paper block rises away from the soft cover without stretching a sheet.
    const tilt=cover?0:Math.atan2(layer*stackDepth,PEEK_PAGE_WIDTH)*180/Math.PI;
    const section=peekPaperSection(t,{extent,tilt,lift,compact,length:PEEK_PAGE_WIDTH+(cover?2:0)});
    const x=405+attachment+side*section.x;
    const y=20+(cover?-2:0)+v*(PEEK_PAGE_HEIGHT+(cover?4:0))+section.z*PEEK_DEPTH_PROJECTION;
    return {x,y};
}

// Fit the physical shape, never the x/y axes independently. A narrow viewport
// increases the backward curl until the book can use the available height.
let lastFrameKey, lastFrame;
export function peekViewportFrame(width,height,thickness=8) {
    const key=`${width}:${height}:${thickness}`;
    if(key===lastFrameKey)return lastFrame;
    const binding=Math.max(2,Math.min(64,thickness))*1.25,depth=Math.min(64,thickness)*1.1;
    function measure(compact) {
        let minX=Infinity,maxX=-Infinity,minY=18,maxY=662;
        for(const side of [-1,1])for(const extent of [0,.48,.74,1])for(const cover of [false,true])
        for(const layer of [0,1])for(const shift of [-.45,.45])for(let i=0;i<=32;i++) {
            const args={side,extent,cover,layer,hinge:405+shift*binding,bindingWidth:binding,stackDepth:depth,compact};
            const top=peekPaperPoint(args,i/32,0),bottom=peekPaperPoint(args,i/32,1);
            minX=Math.min(minX,top.x);maxX=Math.max(maxX,top.x);minY=Math.min(minY,top.y);maxY=Math.max(maxY,bottom.y);
        }
        return {minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY};
    }
    let compact=0,frame=measure(0);
    const ratio=(width-8)/(height-8);
    if(frame.width/frame.height>ratio){let lo=0,hi=1;for(let i=0;i<12;i++){const mid=(lo+hi)/2,f=measure(mid);if(f.width/f.height>ratio)lo=mid;else hi=mid;}compact=hi;frame=measure(compact);}
    const scale=Math.min((width-8)/frame.width,(height-8)/frame.height);
    lastFrameKey=key;
    return lastFrame={...frame,compact,scale,offsetX:(width/scale-frame.width)/2-frame.minX,offsetY:(height-frame.height*scale)/2-frame.minY*scale};
}

// Allocate the existing strips to the curved part; the relaxed tail is planar.
export function peekPaperSample(index,count,knee=1) {
    if(knee>=.999||count<2)return index/count;
    return index===count?1:knee*index/(count-1);
}
