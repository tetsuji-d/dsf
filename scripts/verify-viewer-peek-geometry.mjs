import assert from 'node:assert/strict';
import {peekPaperSection,peekPaperPoint,peekPaperProfile,peekPaperSample,peekViewportFrame,PEEK_PAGE_WIDTH,PEEK_PAGE_HEIGHT} from '../js/viewer-peek-geometry.js';
const near=(a,b,tolerance,message)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} vs ${b}`);
assert.equal(PEEK_PAGE_WIDTH/PEEK_PAGE_HEIGHT,9/16);

// A/B/C and every intermediate turn are the same physical sheet. Integrating
// their 3D cross-sections independently catches stretched source content.
for(const compact of [0,.4,.8,1])for(const extent of [0,.018,.2,.48,.6,.74,.9,1])
for(const tilt of [0,6,12])for(const lift of [0,1]){
    const geometry={extent,compact,tilt,lift};
    let last=peekPaperSection(0,geometry),arc=0;
    for(let i=1;i<=2000;i++){
        const p=peekPaperSection(i/2000,geometry);
        assert.ok(p.x>=last.x-1e-8,'paper never folds through the gutter or reverses content');
        arc+=Math.hypot(p.x-last.x,p.z-last.z);last=p;
    }
    near(arc,360,.001,'all sheets retain the same paper width');
}

// The spine and C fore-edges share the desk plane, including thick books.
// The entire soft cover arches above it, with no artificial raised binding.
for(const compact of [0,.5,1])for(const tilt of [0,12]){
    near(peekPaperSection(0,{compact,tilt}).z,0,1e-10,'spine touches the desk');
    near(peekPaperSection(1,{compact,tilt}).z,0,1e-10,'rear fore-edge touches the desk');
    const end=peekPaperSection(1,{compact,tilt});let peak={z:0};
    for(let i=1;i<2000;i++){
        const p=peekPaperSection(i/2000,{compact,tilt});
        assert.ok(p.z>0,'soft cover stays above the desk');
        if(p.z>peak.z)peak=p;
    }
    near(peak.x/end.x,1/3,.001,'bow crest lies one third across the visible chord');
    assert.ok(peak.z>70,'rear sheet has a visible rounded bow');
    for(const side of [-1,1])for(const cover of [false,true]){
        const g={side,cover,compact,stackDepth:64,bindingWidth:80,hinge:430};
        for(const v of [0,1])near(peekPaperPoint(g,0,v).y,peekPaperPoint(g,1,v).y,1e-8,'rear hinge and tip project to the same level');
    }
}
for(const hinge of [369,405,441]){
    const l=peekPaperPoint({side:-1,hinge,bindingWidth:80,stackDepth:60},0,0);
    const r=peekPaperPoint({side:1,hinge,bindingWidth:80,stackDepth:4},0,0);
    assert.deepEqual(l,r,'left and right papers meet at their shared gutter');
}
for(const compact of [0,.5,1])for(const extent of [.48,.74,1])for(const side of [-1,1]){
    const g={side,extent,compact};
    for(let i=0;i<=40;i++){
        const top=peekPaperPoint(g,i/40,0),bottom=peekPaperPoint(g,i/40,1);
        near(top.x,bottom.x,1e-8,'parallel vertical generators');
        near(bottom.y-top.y,640,1e-8,'paper height stays constant from gutter to tip');
    }
}

// A and B have a broad bow as well, above their inclined gutter-to-tip chord.
// This prevents solving the desk contacts by turning inner leaves into boards.
for(const compact of [0,.5,1])for(const extent of [.48,.74]){
    const end=peekPaperSection(1,{extent,compact});let crest={above:0};
    for(let i=1;i<2000;i++){
        const p=peekPaperSection(i/2000,{extent,compact}),above=p.z-end.z*p.x/end.x;
        if(above>crest.above)crest={above,x:p.x};
    }
    near(crest.x/end.x,1/3,.002,'inner bows also peak towards the gutter');
    assert.ok(crest.above>40,'inner paper has a substantial bow across its width');
}

// Covers stay close to their adjacent paper and use the same curve family.
for(const compact of [0,.5,1])for(let i=0;i<=40;i++){
    const g={side:1,extent:1,layer:0,bindingWidth:16,compact};
    const cover=peekPaperPoint({...g,cover:true},i/40,0),paper=peekPaperPoint(g,i/40,0);
    assert.ok(Math.hypot(cover.x-paper.x,cover.y-paper.y)<3,'soft cover follows the paper block');
}

// Check actual visible source fractions, not merely the gap between tips.
function exposed(extent,x,compact){
    let lo=0,hi=1;
    for(let i=0;i<32;i++){const t=(lo+hi)/2;if(peekPaperSection(t,{extent,compact}).x<x)lo=t;else hi=t;}
    return 1-(lo+hi)/2;
}
for(const [width,height] of [[1600,1000],[1024,768],[768,1024],[390,844],[390,664],[360,640],[844,390]])
for(const thickness of [8,64]){
    const f=peekViewportFrame(width,height,thickness);
    assert.ok(f.height*f.scale/height>.85,'book still uses the screen height');
    assert.ok(f.width*f.scale<=width&&f.height*f.scale<=height,'uniform fit remains inside the viewport');
    const reach=[.48,.74,1].map(extent=>peekPaperSection(1,{extent,compact:f.compact}).x);
    assert.ok(reach[0]<reach[1]&&reach[1]<reach[2],'all three layers remain exposed');
    const middle=exposed(.74,reach[0],f.compact),rear=exposed(1,reach[1],f.compact);
    assert.ok(middle>.16&&rear>.14,'both neighbouring sheets expose useful content');
    assert.ok(middle/rear>.65&&middle/rear<1.5,'middle content is balanced against the cover-side content');
    for(const side of [-1,1])for(const extent of [.48,.74,1])for(let i=0;i<=40;i++){
        const g={side,extent,compact:f.compact,bindingWidth:thickness*1.25,stackDepth:thickness*1.1};
        for(const v of [0,1]){const p=peekPaperPoint(g,i/40,v),x=(p.x+f.offsetX)*f.scale,y=p.y*f.scale+f.offsetY;
            assert.ok(x>=0&&x<=width&&y>=0&&y<=height,'paper fits without clipping or axis-specific scaling');}
    }
}
assert.ok(peekViewportFrame(1600,1000).width*peekViewportFrame(1600,1000).scale>800,'desktop retains a broad book');

// Keep the bounded phone strip count, but place samples where they are needed.
// Every strip covers its own source pixels; subpixel sag prevents faceted tips.
for(const compact of [0,.5,1])for(const extent of [.018,.48,.74,1])for(const count of [12,16,24]){
    const profile=peekPaperProfile(extent,0,0,compact),g={side:1,extent,compact};
    const samples=Array.from({length:count+1},(_,i)=>peekPaperSample(i,count,profile));
    assert.equal(samples[0],0);assert.equal(samples[count],1);
    assert.ok(samples.every((t,i)=>!i||t>samples[i-1]),'complete monotone source coverage');
    for(let i=0;i<count;i++){
        const a=peekPaperPoint(g,samples[i],0),b=peekPaperPoint(g,samples[i+1],0),m=peekPaperPoint(g,(samples[i]+samples[i+1])/2,0);
        const sag=Math.abs((m.x-a.x)*(b.y-a.y)-(m.y-a.y)*(b.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y);
        assert.ok(sag<(count===12?.65:.4),'curve chord error stays below visible faceting');
    }
}
console.log('Desk contacts, equal 9:16 sheets, rounded bow, exposed neighbours, phone sampling and responsive fit passed');
