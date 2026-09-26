import assert from 'node:assert/strict';
import {peekPaperSection, peekPaperPoint, peekPaperProfile, PEEK_PAGE_WIDTH, PEEK_PAGE_HEIGHT} from '../js/viewer-peek-geometry.js';
assert.equal(PEEK_PAGE_WIDTH / PEEK_PAGE_HEIGHT, 9 / 16);
for (const extent of [0,.018,.2,.48,.6,.74,.9,1]) {
    for (const tilt of [0,6,12]) for (const lift of [0,1]) {
        let previous=peekPaperSection(0,{extent,tilt,lift}), arc=0;
        for(let i=1;i<=2000;i++) {
            const point=peekPaperSection(i/2000,{extent,tilt,lift});
            arc+=Math.hypot(point.x-previous.x,point.z-previous.z); previous=point;
        }
        assert.ok(Math.abs(arc-360)<.001, `source paper must not stretch: ${arc}`);
    }
    for(const side of [-1,1]) for(const layer of [0,.5,1]) {
        const geometry={side,extent,layer,bindingWidth:80,hinge:430,stackDepth:64};
        for(let t=0;t<=1;t+=.025){
            const top=peekPaperPoint(geometry,t,0),bottom=peekPaperPoint(geometry,t,1);
            assert.equal(top.x,bottom.x);
            assert.ok(Math.abs(bottom.y-top.y-640)<1e-9,'same height at hinge and fore-edge');
            assert.ok(top.x>=0&&top.x<=810&&top.y>=18&&bottom.y<=720,'book fits its unscaled frame');
        }
    }
}
for(const hinge of [369,405,441]) {
    const left=peekPaperPoint({side:-1,hinge,bindingWidth:80,stackDepth:60},0,0);
    const right=peekPaperPoint({side:1,hinge,bindingWidth:80,stackDepth:4},0,0);
    assert.deepEqual(left,right,'unbalanced page blocks meet at the same gutter');
}
for(const tilt of [0,6,12]) {
    const rearOpening=180-2*peekPaperProfile(1,tilt).hinge*180/Math.PI;
    assert.ok(rearOpening>=170&&rearOpening<180,'rear sheets open almost flat at every book thickness');
}
const spans=[.48,.74,1].map(extent=>peekPaperSection(1,{extent}).x);
assert.ok((spans[1]-spans[0])/spans[1]>.3,'middle page reveals readable content');
assert.ok((spans[2]-spans[1])/spans[2]>.2,'rear page is more than a decorative sliver');
assert.ok(spans[2]/640<=9/16,'rear page never becomes wider than the source');
console.log('9:16 sheet metric, unstretched arc/height, gutter continuity, bounds and rear exposure passed');
