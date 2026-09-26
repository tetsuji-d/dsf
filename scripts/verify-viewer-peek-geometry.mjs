import assert from 'node:assert/strict';
import {peekPaperSection, peekPaperPoint, peekPaperProfile, peekViewportFrame, peekPaperSample, PEEK_PAGE_WIDTH, PEEK_PAGE_HEIGHT} from '../js/viewer-peek-geometry.js';
assert.equal(PEEK_PAGE_WIDTH / PEEK_PAGE_HEIGHT, 9 / 16);
for(const compact of [0,.8,1]) for (const extent of [0,.018,.2,.48,.6,.74,.9,1]) {
    for (const tilt of [0,6,12]) for (const lift of [0,1]) {
        let previous=peekPaperSection(0,{extent,tilt,lift,compact}), arc=0;
        for(let i=1;i<=2000;i++) {
            const point=peekPaperSection(i/2000,{extent,tilt,lift,compact});
            arc+=Math.hypot(point.x-previous.x,point.z-previous.z); previous=point;
        }
        assert.ok(Math.abs(arc-360)<.001, `source paper must not stretch: ${arc}`);
    }
    for(const side of [-1,1]) for(const layer of [0,.5,1]) {
        const geometry={compact,side,extent,layer,bindingWidth:80,hinge:430,stackDepth:64};
        for(let t=0;t<=1;t+=.025){
            const top=peekPaperPoint(geometry,t,0),bottom=peekPaperPoint(geometry,t,1);
            assert.equal(top.x,bottom.x);
            assert.ok(Math.abs(bottom.y-top.y-640)<1e-9,'same height at hinge and fore-edge');
            assert.ok(top.x>=0&&top.x<=810&&top.y>=-140&&bottom.y<=820,'book fits its unscaled frame');
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
assert.ok((spans[1]-spans[0])/spans[1]>.2,'middle page reveals readable content');
assert.ok((spans[2]-spans[1])/spans[2]>.15,'rear page is more than a decorative sliver');
assert.ok(spans[2]/640<=9/16,'rear page never becomes wider than the source');

for(const compact of [0,.8,1]) {
    const profiles=[.48,.74,1].map(e=>peekPaperProfile(e,0,0,compact));
    const curvatures=profiles.map(p=>Math.abs(p.bend)/p.knee);
    assert.ok(curvatures[2]>curvatures[1]&&curvatures[1]>curvatures[0],'rear pages bend more strongly');
    assert.ok(peekPaperSection(1,{extent:1,compact}).z<0,'rear fore-edge passes behind the binding');
}
for(const [width,height] of [[390,844],[360,640],[844,390],[1600,1000]])for(const thickness of [8,64]) {
    const f=peekViewportFrame(width,height,thickness);
    assert.ok(f.height*f.scale/height>.85,'portrait book uses screen height');
    assert.ok(f.width*f.scale<=width&&f.height*f.scale<=height,'uniform fit stays in viewport');
}

for(const knee of [.04,.22,.55,1]) {
    const samples=Array.from({length:17},(_,i)=>peekPaperSample(i,16,knee));
    assert.equal(samples[0],0);assert.equal(samples[16],1);
    assert.ok(samples.every((x,i)=>!i||x>samples[i-1]),'adaptive strips cover the entire source exactly once');
    assert.ok(samples.filter(x=>x<=knee).length>=16,'curved region retains smooth sampling on phones');
}

for(const compact of [0,.5,1]) {
    const profile=peekPaperProfile(1,0,0,compact);
    const radius=PEEK_PAGE_WIDTH*profile.knee/Math.abs(profile.bend);
    assert.ok(Math.abs(radius-PEEK_PAGE_WIDTH/3)<1e-8,'cover radius stays one third of the paper width');
    assert.ok(profile.knee>.5,'cover curvature extends through the page centre on every viewport');
}
for(const compact of [0,.5,1]) {
    const mid=peekPaperSection(.5,{extent:1,compact}),a=peekPaperSection(.49,{extent:1,compact}),b=peekPaperSection(.51,{extent:1,compact});
    assert.ok(Math.hypot(mid.x-(a.x+b.x)/2,mid.z-(a.z+b.z)/2)>.04,'cover centre is curved on both desktop and phones');
}

// Screen-space sag must remain visible, not only the 3D radius.
const coverShape={side:1,cover:true,extent:1};
const start=peekPaperPoint(coverShape,0,0),end=peekPaperPoint(coverShape,1,0),middle=peekPaperPoint(coverShape,.4,0);
const chordY=start.y+(end.y-start.y)*(middle.x-start.x)/(end.x-start.x);
assert.ok(middle.y-chordY>25,'cover arch is visibly deep in the rendered projection');
for(const compact of [0,.5,1]) {
    const radii=[1,.74,.48].map(e=>{const p=peekPaperProfile(e,0,0,compact);return 360*p.knee/Math.abs(p.bend)});
    assert.ok(radii[0]<radii[1]&&radii[1]<radii[2],'radius increases towards inner pages');
}

// Inner sheets keep bending past the centre, rather than ending in a rigid tail.
for(const compact of [0,.5,1]) {
    assert.equal(peekPaperProfile(.74,0,0,compact).knee,1,'middle leaf bends all the way to its fore-edge');
    const a=peekPaperSection(.84,{extent:.74,compact}),m=peekPaperSection(.85,{extent:.74,compact}),b=peekPaperSection(.86,{extent:.74,compact});
    assert.ok(Math.hypot(m.x-(a.x+b.x)/2,m.z-(a.z+b.z)/2)>.007,'outer half of middle leaf is still curved');
    const reach=[.48,.74,1].map(extent=>peekPaperSection(1,{extent,compact}).x);
    assert.ok(reach[0]<reach[1]&&reach[1]<reach[2],'opening the front keeps both rear layers exposed');
}
assert.ok(peekPaperSection(1,{extent:.48}).x>200,'desktop front leaf opens farther');
assert.ok(peekPaperSection(1,{extent:.48,compact:1}).x>55,'portrait front leaf opens farther');
const desktopFrame=peekViewportFrame(1600,1000,8);
assert.ok(desktopFrame.width*desktopFrame.scale>800,'desktop uses a wider physical book without stretching');

console.log('Unstretched 9:16 paper, outward/backward curl, adaptive sampling and full-height viewport fit passed');
