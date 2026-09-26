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
// The outward arch lies beyond the straight chord, and flattens toward the edge.
// An inward roll has the opposite curvature and must fail this check.
for(const extent of [.48,.74,1]) for(const tilt of [0,6,12]) {
    const profile=peekPaperProfile(extent,tilt);
    assert.ok(profile.bend<0,'tangent relaxes from gutter toward fore-edge');
    const mid=peekPaperSection(.5,{extent,tilt}),end=peekPaperSection(1,{extent,tilt});
    assert.ok(mid.z*end.x-mid.x*end.z>0,'paper arches outward from its chord');
    const mirrored={x:end.x-mid.x,z:end.z-mid.z};
    assert.ok(mid.x<mirrored.x,'outer half spreads out instead of rolling inward');
}
// Even the rearmost leaf and its soft cover must visibly bow beyond their chord.
for(const cover of [false,true]) for(const side of [-1,1]) {
    const geometry={side,cover,extent:1,layer:0,bindingWidth:16};
    const start=peekPaperPoint(geometry,0,0),mid=peekPaperPoint(geometry,.5,0),end=peekPaperPoint(geometry,1,0);
    const fraction=(mid.x-start.x)/(end.x-start.x);
    assert.ok(mid.y-(start.y+(end.y-start.y)*fraction)>3,'rear leaf and soft cover have a visible outward arch');
}
for(let t=0;t<=1;t+=.025) {
    const geometry={side:1,extent:1,layer:0,bindingWidth:16};
    const cover=peekPaperPoint({...geometry,cover:true},t,0),paper=peekPaperPoint(geometry,t,0);
    assert.ok(Math.hypot(cover.x-paper.x,cover.y-paper.y)<3,'soft cover follows the adjacent paper block closely');
}
const spans=[.48,.74,1].map(extent=>peekPaperSection(1,{extent}).x);
assert.ok((spans[1]-spans[0])/spans[1]>.3,'middle page reveals readable content');
assert.ok((spans[2]-spans[1])/spans[2]>.2,'rear page is more than a decorative sliver');
assert.ok(spans[2]/640<=9/16,'rear page never becomes wider than the source');
console.log('9:16 sheet metric, unstretched arc/height, gutter continuity, bounds and rear exposure passed');
