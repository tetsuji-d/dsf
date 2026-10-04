import assert from 'node:assert/strict';
import {animateViewerHeldProgress} from '../js/viewer-held-progress.js';
let now=0,id=0,frames=new Map();
globalThis.performance={now:()=>now};
globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
function advance(ms){now+=ms;const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(now);}
for(const reduced of [false,true])for(const accept of [false,true]){
    const gesture={progress:.35,ended:null},values=[];
    const animation=animateViewerHeldProgress({gesture,draw:p=>values.push(p),reduced});
    advance(16);advance(5000);
    assert.equal(values.at(-1),reduced?0:.35,'holding for five seconds must not settle');
    gesture.progress=.7;advance(16);assert.equal(values.at(-1),reduced?0:.7);
    gesture.progress=.2;advance(16);assert.equal(values.at(-1),reduced?0:.2,'reverse follows input');
    gesture.ended=accept;advance(16);advance(1000);
    assert.equal(await animation.finished,accept);assert.equal(values.at(-1),accept?1:0);
}
const cancelled=animateViewerHeldProgress({gesture:{progress:.5,ended:null},draw(){}});
advance(16);cancelled.cancel();assert.equal(await cancelled.finished,false);assert.equal(frames.size,0);
console.log('Held progress pauses, reverses, accepts, cancels and respects reduced motion.');
