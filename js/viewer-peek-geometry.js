/** Developable 360 x 640 sheets, projected obliquely from above.
 * The cross-section is integrated by arc length, so opening/bending cannot
 * widen the source image. The vertical generators stay exactly 640 units. */
export const PEEK_PAGE_WIDTH = 360;
export const PEEK_PAGE_HEIGHT = 640;
const radians = degrees => degrees * Math.PI / 180;
const mix = (a, b, t) => a + (b - a) * t;

export function peekPaperProfile(extent = 1, tilt = 0, lift = 0) {
    const e = Math.max(0, Math.min(1, extent));
    // From the gutter the sheet bows outward, then relaxes toward the fore-edge.
    // Keep a visible arch through the rear sheets and soft cover as well.
    // Arc-length integration preserves the paper dimensions at every depth.
    let foreEdge, bend;
    if (e <= .48) { const t=e/.48; foreEdge=mix(90,30,t); bend=58*t; }
    else if (e <= .74) { const t=(e-.48)/.26; foreEdge=mix(30,10,t); bend=58; }
    else { const t=(e-.74)/.26; foreEdge=mix(10,3,t); bend=mix(58,32,t); }
    foreEdge = Math.min(90, foreEdge + lift * 5 * e);
    bend = Math.max(0, Math.min(bend + tilt * 2, 89.5 - foreEdge));
    return {hinge: radians(foreEdge + bend), bend: -radians(bend)};
}

export function peekPaperSection(t, {extent=1, tilt=0, lift=0, length=PEEK_PAGE_WIDTH}={}) {
    const {hinge, bend} = peekPaperProfile(extent, tilt, lift);
    if (Math.abs(bend) < 1e-7) return {x:length*t*Math.cos(hinge), z:length*t*Math.sin(hinge)};
    return {x:length*(Math.sin(hinge+bend*t)-Math.sin(hinge))/bend,
        z:length*(Math.cos(hinge)-Math.cos(hinge+bend*t))/bend};
}

export function peekPaperPoint({side,extent=1,bindingWidth=0,hinge=405,
    stackDepth=0,layer=1,cover=false,lift=0},t,v) {
    const attachment=cover?side*bindingWidth/2:side*bindingWidth/2*(1-layer)+(hinge-405)*layer;
    // The paper block rises away from the soft cover without stretching a sheet.
    const tilt=cover?0:Math.atan2(layer*stackDepth,PEEK_PAGE_WIDTH)*180/Math.PI;
    const section=peekPaperSection(t,{extent,tilt,lift,length:PEEK_PAGE_WIDTH+(cover?2:0)});
    const x=405+attachment+side*section.x;
    const y=20+(cover?-2:0)+v*(PEEK_PAGE_HEIGHT+(cover?4:0))+section.z*.14;
    return {x,y};
}
