/** Developable 360 x 640 sheets, projected obliquely from above.
 * The cross-section is integrated by arc length, so opening/bending cannot
 * widen the source image. The vertical generators stay exactly 640 units. */
export const PEEK_PAGE_WIDTH = 360;
export const PEEK_PAGE_HEIGHT = 640;
// Show the depth of the bow instead of flattening it almost edge-on.
export const PEEK_DEPTH_PROJECTION = .30;
const radians = degrees => degrees * Math.PI / 180;
const mix = (a, b, t) => a + (b - a) * t;

// A soft-cover section has a rounded crest one third across the horizontal
// gutter-to-fore-edge chord. Both ends of the rear sheet lie on the desk (z=0).
// Arc-length parametrization maps the entire fixed-layout page onto this shape
// without changing its physical width, even as portrait view deepens the bow.
const bowAt = u => 6.75*u*(1-u)*(1-u);
const bowSlope = u => 6.75*(1-u)*(1-3*u);
const PROFILE_STEPS = 256;
const profileCache = new Map();
export function peekPaperProfile(extent=1, tilt=0, lift=0, compact=0, reading=0) {
    const e=Math.max(0,Math.min(1,extent)),c=Math.max(0,Math.min(1,compact));
    const key=`${e}:${tilt}:${lift}:${c}:${reading}`;
    if(profileCache.has(key))return profileCache.get(key);
    const pose=(e,h,d)=>({e,angle:Math.atan(d),bow:h/Math.hypot(1,d)});
    const poses=[{e:0,angle:Math.PI/2,bow:0},
        pose(.48,mix(.26,.75,c),mix(1.7,4.7,c)),
        pose(.74,mix(.35,.95,c),mix(.98,3.3,c)),
        pose(1,mix(.26,1.15,c),0)];
    const index=poses.findIndex(p=>p.e>=e),a=poses[Math.max(0,index-1)],b=poses[index];
    const t=b.e===a.e?0:(e-a.e)/(b.e-a.e);
    const angle=mix(mix(a.angle,b.angle,t),Math.max(0,1-e/.48)*Math.PI/2,reading);
    const run=Math.cos(angle),rise=Math.sin(angle);
    // Thickness raises the body of the sheet, not either desk contact. A turn
    // can lift the paper while keeping its attachment and arc length unchanged.
    const bow=mix(mix(a.bow,b.bow,t),.085,reading)+run*(radians(tilt)*.35+lift*.06)*e;
    const speed=u=>Math.hypot(run,rise+bow*bowSlope(u));
    const arcs=new Float64Array(PROFILE_STEPS+1);
    for(let i=1;i<=PROFILE_STEPS;i++){
        const u0=(i-1)/PROFILE_STEPS,u1=i/PROFILE_STEPS;
        arcs[i]=arcs[i-1]+(speed(u0)+4*speed((u0+u1)/2)+speed(u1))/(6*PROFILE_STEPS);
    }
    const arc=arcs[PROFILE_STEPS];
    const profile={run,rise,bow,arcs,arc};
    if(profileCache.size>=96)profileCache.delete(profileCache.keys().next().value);
    profileCache.set(key,profile);
    return profile;
}
function sourceAt(profile,u) {
    const index=Math.min(PROFILE_STEPS-1,Math.floor(u*PROFILE_STEPS)),t=u*PROFILE_STEPS-index;
    return mix(profile.arcs[index],profile.arcs[index+1],t)/profile.arc;
}
export function peekPaperSection(t, {extent=1, tilt=0, lift=0, compact=0, reading=0, length=PEEK_PAGE_WIDTH}={}) {
    const p=peekPaperProfile(extent,tilt,lift,compact,reading),distance=Math.max(0,Math.min(1,t))*p.arc;
    let lo=0,hi=PROFILE_STEPS;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(p.arcs[mid]<distance)lo=mid;else hi=mid;}
    const u=(lo+(distance-p.arcs[lo])/(p.arcs[hi]-p.arcs[lo]))/PROFILE_STEPS;
    const scale=length/p.arc;
    return {x:scale*p.run*u,z:scale*(p.rise*u+p.bow*bowAt(u))};
}

export function peekPaperPoint({side,extent=1,bindingWidth=0,hinge=405,
    stackDepth=0,layer=1,cover=false,lift=0,compact=0,reading=0},t,v) {
    const attachment=cover?side*bindingWidth/2:side*bindingWidth/2*(1-layer)+(hinge-405)*layer;
    // The paper block rises away from the soft cover without stretching a sheet.
    const tilt=cover?0:Math.atan2(layer*stackDepth,PEEK_PAGE_WIDTH)*180/Math.PI;
    const section=peekPaperSection(t,{extent,tilt,lift,compact,reading,length:PEEK_PAGE_WIDTH+(cover?2:0)});
    const x=405+attachment+side*section.x;
    const y=20+(cover?-2:0)+v*(PEEK_PAGE_HEIGHT+(cover?4:0))+section.z*PEEK_DEPTH_PROJECTION;
    return {x,y};
}

// Fit the physical shape, never the x/y axes independently. A narrow viewport
// deepens the bow while keeping the spine and rear fore-edges on the desk.
const frameCache=new Map();
export function peekViewportFrame(width,height,thickness=8,reading=0) {
    const key=`${width}:${height}:${thickness}:${reading}`;
    if(frameCache.has(key))return frameCache.get(key);
    const binding=Math.max(2,Math.min(64,thickness))*1.25,depth=Math.min(64,thickness)*1.1;
    function measure(compact) {
        let minX=Infinity,maxX=-Infinity,minY=18,maxY=662;
        for(const side of [-1,1])for(const extent of (reading?[.48,.74,1]:[0,.48,.74,1]))for(const cover of [false,true])
        for(const layer of [0,1])for(const shift of [-.45,.45])for(let i=0;i<=32;i++) {
            const args={side,extent,cover,layer,hinge:405+shift*binding,bindingWidth:binding,stackDepth:depth,compact,reading};
            const top=peekPaperPoint(args,i/32,0),bottom=peekPaperPoint(args,i/32,1);
            minX=Math.min(minX,top.x);maxX=Math.max(maxX,top.x);minY=Math.min(minY,top.y);maxY=Math.max(maxY,bottom.y);
        }
        return {minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY};
    }
    let compact=0,frame=measure(0);
    const ratio=(width-8)/(height-8);
    if(!reading&&frame.width/frame.height>ratio){let lo=0,hi=1;for(let i=0;i<12;i++){const mid=(lo+hi)/2,f=measure(mid);if(f.width/f.height>ratio)lo=mid;else hi=mid;}compact=hi;frame=measure(compact);}
    const scale=Math.min((width-8)/frame.width,(height-8)/frame.height);
    const fitted={...frame,compact,scale,offsetX:(width/scale-frame.width)/2-frame.minX,offsetY:(height-frame.height*scale)/2-frame.minY*scale};
    if(frameCache.size>=8)frameCache.delete(frameCache.keys().next().value);
    frameCache.set(key,fitted);return fitted;
}

// Distribute the existing strip budget by the projected curve's deviation
// from a straight chord. This puts samples around the bow, not only the gutter.
// The primitive integrates sqrt(abs(bowAt''(u))) (constant factor cancels).
const sampleCache=new Map();
export function peekPaperSample(index,count,profile) {
    if(index===0)return 0;if(index===count)return 1;
    if(!sampleCache.has(count)){
        const primitive=u=>u<=2/3?(8-(4-6*u)**1.5)/9:(8+(6*u-4)**1.5)/9;
        const total=primitive(1),values=[];
        for(let i=0;i<=count;i++){
            let lo=0,hi=1;
            for(let j=0;j<32;j++){const mid=(lo+hi)/2;if(primitive(mid)<total*i/count)lo=mid;else hi=mid;}
            values.push((lo+hi)/2);
        }
        sampleCache.set(count,values);
    }
    return sourceAt(profile,sampleCache.get(count)[index]);
}
