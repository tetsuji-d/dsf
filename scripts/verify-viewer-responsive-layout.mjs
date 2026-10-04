import assert from 'node:assert/strict';
import {readerInfoPlacement,readerPageInsets,readerHeaderTop,readerBoundaryTarget,readerControlLayout,fitReaderSheet,fitReaderBookFace,adjacentReaderPage} from '../js/viewer-responsive-layout.js';
import {peekPaperPoint} from '../js/viewer-peek-geometry.js';

for(const [width,height] of [[320,568],[390,844],[844,390],[667,320],[1440,900]]){
    for(const safe of [0,34]){
        const v={left:7,top:13,width,height,safeTop:safe,safeBottom:safe,safeLeft:safe,safeRight:safe};
        const page={left:width/4,top:13,width:width/2,height:height-26,right:width*.75};
        const rail=readerControlLayout(v,page);
        assert.ok(rail.left>=v.left+safe&&rail.top>=v.top+safe);
        assert.ok(rail.left+rail.width<=v.left+width-safe);
        assert.ok(rail.top+rail.height<=v.top+height-(rail.dock==='bottom'?Math.max(2,safe-12):safe));
        assert.equal(rail.dock,height>=width&&width-safe*2-24<700?'bottom':'side');
        assert.ok(rail.size>=44);
        if(rail.dock==='bottom'){
            assert.ok(rail.width>=5*rail.size,'all hit targets fit');
            assert.ok(rail.left>v.left+safe+12,'avoid rounded corners');
            assert.equal(rail.left-v.left,(width-rail.width)/2,'keep the row centred');
            assert.equal(rail.top+rail.height,v.top+height-Math.max(2,safe-12),'retain room for the home indicator');
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

// PWA and browser heights fit the safe viewport without reserving menu rows.
for(const [width,height] of [[320,568],[390,664],[390,844],[430,740],[430,932]])for(const safeTop of [0,47,59]){
 const v={left:0,top:13,width,height,safeTop,safeBottom:34,safeLeft:0,safeRight:0};
 const safe=readerPageInsets(v),paperHeight=Math.min(height-safe.safeTop*2,(width-12)*16/9);
 const top=v.top+(height-paperHeight)/2;
 const header=readerHeaderTop(v,top);
 assert.ok(header>=v.top+safeTop);
 assert.ok(header+48<=v.top+height);
 assert.equal(safe.safeTop,Math.max(safeTop,34));
 assert.equal(paperHeight,Math.min(height-2*Math.max(safeTop,34),(width-12)*16/9));
 const page={top,width:width-12,height:paperHeight,right:width-6};
 const controls=readerControlLayout(v,page);
 assert.ok(controls.progressTop>=v.top+safeTop);
 assert.ok(controls.top+controls.height<=v.top+height);
 const points=[{x:0,y:0},{x:360,y:640}];
 const fit=fitReaderSheet(points,width,height,safe);
 assert.ok(Math.abs((fit.minY+fit.maxY)*fit.scale/2+fit.offsetY-height/2)<1e-8);
}
const covers=i=>({exterior:i===0||i===7});
assert.equal(readerBoundaryTarget(items,0,-1,covers),7);
assert.equal(readerBoundaryTarget(items,7,1,covers),0);
assert.equal(readerBoundaryTarget(items,1,-1,covers),null);
assert.equal(readerBoundaryTarget(items,6,1,covers),null);
assert.equal(readerBoundaryTarget(items,0,-1,()=>({exterior:false})),null);
console.log('Phone paper uses the safe viewport without menu padding; exterior boundary targets wrap both ways.');

for(const [width,height,page,layout] of [
 [430,932,{left:16,top:112,width:398,height:708,right:414},'overlay'],
 [1440,900,{left:480,top:60,width:480,height:780,right:960},'side'],
 [1024,768,{left:90,top:60,width:844,height:648,right:934},'overlay']
]){
 const original=JSON.stringify(page),v={width,height,safeTop:0,safeBottom:0};
 const panel=readerInfoPlacement(v,page);
 assert.equal(panel.layout,layout);assert.equal(JSON.stringify(page),original);
 assert.equal(panel.top,Math.max(page.top,layout==='side'?64:0));assert.equal(panel.top+panel.height,page.top+page.height);
 if(layout==='overlay'){assert.equal(panel.left,page.left);assert.equal(panel.width,page.width);}
 else {assert.ok(panel.left>page.right);assert.ok(panel.left+panel.width<=width-12);}
}
console.log('Info overlays match paper; side information uses existing margin without resizing it.');

const desktopViewport={width:1600,height:900};
const wideSpread={left:290,right:1310,top:30,width:1020,height:840};
const shiftedInfo=readerInfoPlacement(desktopViewport,wideSpread,{allowShift:true});
assert.equal(shiftedInfo.layout,'side');assert.ok(shiftedInfo.pageShift<0);
assert.ok(wideSpread.left+shiftedInfo.pageShift>=12);
assert.ok(shiftedInfo.left>=wideSpread.right+shiftedInfo.pageShift+76);
assert.equal(readerInfoPlacement(desktopViewport,wideSpread).pageShift,0);
const fullSpread={left:12,right:1588,top:30,width:1576,height:840};
assert.equal(readerInfoPlacement(desktopViewport,fullSpread,{allowShift:true}).layout,'overlay');
assert.equal(readerInfoPlacement({width:430,height:932},{left:6,right:424,top:95,width:418,height:742},{allowShift:true}).pageShift,0);
console.log('Desktop spread shifts only enough to fit information; phones and oversized spreads retain overlay.');
