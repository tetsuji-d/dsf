import assert from 'node:assert/strict';
import {readerControlLayout,fitReaderSheet,adjacentReaderPage} from '../js/viewer-responsive-layout.js';
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
console.log('Responsive controls stay in safe viewport; curved single faces fit uniformly; page sequence has no skipped faces.');
