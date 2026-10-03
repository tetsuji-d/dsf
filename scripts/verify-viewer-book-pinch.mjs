import assert from 'node:assert/strict';
import {createViewerBookPinch} from '../js/viewer-book-pinch.js';
import {peekPaperSection,peekViewportFrame} from '../js/viewer-peek-geometry.js';
globalThis.window={addEventListener(){}};globalThis.document={addEventListener(){}};
function fixture({mode='peek',wide=true,scale=1,reduced=false}={}){
    const calls=[];let progress=0,target;
    const pinch=createViewerBookPinch({enabled:()=>true,state:()=>mode,scale:()=>scale,wide:()=>wide,busy:()=>false,
        claim:()=>calls.push('claim'),begin:(to,manual)=>{target=to;calls.push(['begin',to,manual]);if(!manual)mode=to;return !reduced;},
        draw:p=>{progress=p;},finish:accept=>{calls.push(['finish',accept]);if(accept)mode=target;},zoom:s=>{scale=Math.max(1,s);},consume(){}});
    const el={closest:s=>s.startsWith('button')?null:el};
    const e=(id,x)=>({pointerId:id,clientX:x,clientY:100,pointerType:'touch',target:el,preventDefault(){},stopImmediatePropagation(){}});
    function start(){pinch.pointerDown(e(1,100));assert.ok(pinch.pointerDown(e(2,200)));}
    function move(ratio){pinch.pointerMove(e(1,150-50*ratio));pinch.pointerMove(e(2,150+50*ratio));}
    function end(cancel=false){assert.ok(pinch.pointerEnd(e(1,100),cancel));assert.ok(pinch.pointerEnd(e(2,200)),'remaining contact must not turn a page');}
    return {pinch,calls,start,move,end,get mode(){return mode;},get progress(){return progress;},get scale(){return scale;}};
}
for(const wide of [true,false]){
    const f=fixture({wide});f.start();f.move(1.4);assert.equal(f.progress,1);f.move(1);f.end();assert.equal(f.mode,'peek','reversing before release cancels');
    f.start();f.move(1.4);f.end();assert.equal(f.mode,wide?'book':'reading');
}
for(const mode of ['book','reading']){const f=fixture({mode});f.start();f.move(.7);f.end();assert.equal(f.mode,'peek');}
const zoom=fixture({mode:'reading',scale:2});zoom.start();zoom.move(.4);zoom.end();assert.equal(zoom.mode,'reading');assert.equal(zoom.scale,1);zoom.start();zoom.move(.7);zoom.end();assert.equal(zoom.mode,'peek');
const cancel=fixture();cancel.start();cancel.move(1.4);cancel.end(true);assert.equal(cancel.mode,'peek');
const reduced=fixture({reduced:true});reduced.start();reduced.move(1.4);assert.equal(reduced.mode,'peek');reduced.end();assert.equal(reduced.mode,'book','reduced motion switches only on release');
// The mode morph and the turn retain physical paper width, including a held partial transition.
for(const reading of [0,.25,.5,.75,1])for(const extent of [.018,.2,.48,.74,1])for(const compact of [0,1]){
    const options={reading,extent,compact};let prev=peekPaperSection(0,options),length=0;
    for(let i=1;i<=2000;i++){const p=peekPaperSection(i/2000,options);length+=Math.hypot(p.x-prev.x,p.z-prev.z);prev=p;}
    assert.ok(Math.abs(length-360)<.002,`paper width ${length}`);
}
for(const [w,h] of [[1600,1000],[820,1180]]){const f=peekViewportFrame(w,h,8,1);assert.ok(f.width*f.scale<=w&&f.height*f.scale<=h);assert.ok(Math.max(f.width*f.scale/w,f.height*f.scale/h)>.97,'reading fills the limiting viewport dimension');}
console.log('Pinch ownership, cancellation, width routing, zoom priority, reduced motion and equal-width reading morph passed');
