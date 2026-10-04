import assert from 'node:assert/strict';
import {readerControlLayout,fitReaderSheet,fitReaderBookFace,adjacentReaderPage} from '../js/viewer-responsive-layout.js';
import {peekPaperPoint} from '../js/viewer-peek-geometry.js';

for(const [width,height] of [[320,568],[390,844],[844,390],[667,320],[1440,900]]){
    for(const safe of [0,34]){
        const v={left:7,top:13,width,height,safeTop:safe,safeBottom:safe,safeLeft:safe,safeRight:safe};
        const page={left:width/4,top:13,width:width/2,height:height-26,right:width*.75};
        const rail=readerControlLayout(v,page);
        assert.ok(rail.left>=v.left+safe&&rail.top>=v.top+safe);
        assert.ok(rail.left+rail.width<=v.left+width-safe);
        assert.ok(rail.top+rail.height<=v.top+height-safe);
        assert.equal(rail.dock,height>=width&&width-safe*2-24<700?'bottom':'side');
        assert.ok(rail.size>=44);
        if(rail.dock==='bottom'){
            assert.equal(rail.width,width-safe*2-24,'use the full safe width');
            assert.equal(rail.top+rail.height,v.top+height-safe-2,'dock two pixels above the bottom safe area');
        }
        for(const side of [-1,1]){
            const points=[];
            for(let i=0;i<=40;i++)for(const y of [0,1])points.push(peekPaperPoint({side,extent:.48,reading:1,compact:.8},i/40,y));
            const fit=fitReaderSheet(points,width,height,v);
            for(const p of points){
                const x=(p.x+fit.offsetX)*fit.scale,y=p.y*fit.scale+fit.offsetY;
                assert.ok(x>=safe-1e-6&&x<=width-safe+1e-6);
                assert.ok(y>=safe-1e-6&&y<=height-safe+1e-6);
            }
            assert.ok(fit.scale>0);
        }
    }
}
const items=Array.from({length:8},(_,index)=>({index}));
const position=i=>i===0?-1:i===7?3:Math.floor((i-1)/2);
// A phone must visit both faces of a spread, forwards and backwards, including covers.
for(let i=0;i<8;i++){
    assert.equal(adjacentReaderPage(items,i,1,position,true),i===7?null:i+1);
    assert.equal(adjacentReaderPage(items,i,-1,position,true),i===0?null:i-1);
}
assert.equal(adjacentReaderPage(items,1,1,position,false),3);
assert.equal(adjacentReaderPage(items,4,-1,position,false),1);
assert.equal(fitReaderSheet([],390,844),null);
// Both halves share the full book's structure. The binding and selected half
// fit, while the opposite fore-edge remains outside the phone crop.
for(const thickness of [8,32,64])for(const side of [-1,1]){
    const hinge=405,bindingWidth=thickness*1.25,points=[],structure=[];
    for(const s of [-1,1])for(let i=0;i<=40;i++)for(const y of [0,1]){
        structure.push(peekPaperPoint({side:s,cover:true,bindingWidth,reading:1},i/40,y));
        if(s===side)points.push(peekPaperPoint({side:s,extent:.48,stackDepth:thickness/2,bindingWidth,reading:1},i/40,y));
    }
    const spine=[{x:405-bindingWidth/2,y:18},{x:405+bindingWidth/2,y:662}];
    structure.push(...spine);
    const fit=fitReaderBookFace(points,structure,390,844,{side,hinge,bindingWidth});
    for(const p of [...points,...spine]){
        assert.ok((p.x+fit.offsetX)*fit.scale>=0&&(p.x+fit.offsetX)*fit.scale<=390);
        assert.ok(p.y*fit.scale+fit.offsetY>=0&&p.y*fit.scale+fit.offsetY<=844);
    }
    const opposite=peekPaperPoint({side:-side,reading:1},1,0);
    const x=(opposite.x+fit.offsetX)*fit.scale;
    assert.ok(side<0?x>390:x<0,'opposite page is cropped, not removed');
    for(let i=0;i<=40;i++){
        const geometry={side,stackDepth:thickness/2,bindingWidth,reading:1};
        const a=peekPaperPoint({...geometry,extent:.48},i/40,0),b=peekPaperPoint({...geometry,extent:1},i/40,0);
        assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-8,'paper block and readable page meet');
    }
}
console.log('Responsive controls stay in safe viewport; curved single faces fit uniformly; page sequence has no skipped faces.');
