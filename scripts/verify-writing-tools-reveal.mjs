import assert from 'node:assert/strict';
import {installWritingToolsReveal} from '../js/reader-writing-input.js';
const target=new EventTarget(),life=new AbortController(),pending=new Map();
let allowed=true,shown=0,serial=0;
installWritingToolsReveal({target,signal:life.signal,bottom:()=>800,canReveal:()=>allowed,reveal:()=>shown++,
 schedule:(fn,ms)=>{assert.equal(ms,200);pending.set(++serial,fn);return serial;},cancel:id=>pending.delete(id)});
const emit=(type,extra={})=>target.dispatchEvent(Object.assign(new Event(type),{clientY:790,pointerType:'mouse',buttons:0,...extra}));
const tick=()=>{const jobs=[...pending.values()];pending.clear();jobs.forEach(fn=>fn());};
emit('pointermove');emit('pointermove');assert.equal(pending.size,1);assert.equal(shown,0);tick();assert.equal(shown,1);
emit('pointermove');emit('pointermove',{clientY:750});tick();assert.equal(shown,1);
for(const type of ['pointerdown','pointercancel','pointerleave']){emit('pointermove');emit(type);tick();assert.equal(shown,1);}
for(const extra of [{buttons:1},{pointerType:'touch'},{pointerType:'pen'},{clientY:801}]){emit('pointermove',extra);tick();assert.equal(shown,1);}
emit('pointermove');allowed=false;tick();assert.equal(shown,1);
emit('pointermove');assert.equal(pending.size,0);allowed=true;
emit('pointermove');life.abort();tick();assert.equal(shown,1);emit('pointermove');assert.equal(pending.size,0);
console.log('PASS: dwell, leave, drawing, touch/pen, blocked state, disposal');
