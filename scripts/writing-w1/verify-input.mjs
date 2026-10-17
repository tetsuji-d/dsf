import assert from 'node:assert/strict';
import {writingPointerSamples,writingFrameQueue} from '../../js/reader-writing-input.js';
import {renderWritingStrokePreview} from '../../js/reader-writing-renderer.js';
const event={pointerId:7,pointerType:'touch',pressure:.5,clientX:8,clientY:4,timeStamp:12};
assert.deepEqual(writingPointerSamples(event).map(p=>[p.clientX,p.clientY]),[[8,4]]);
assert.equal(writingPointerSamples({...event,getCoalescedEvents:()=>[]}).length,1);
assert.equal(writingPointerSamples({...event,getCoalescedEvents(){throw Error('unsupported');}}).length,1);
const samples=writingPointerSamples({...event,getCoalescedEvents:()=>[
    {...event,clientX:2,clientY:9,timeStamp:10},
    {...event,clientX:5,clientY:1,timeStamp:11},event]});
assert.deepEqual(samples.map(p=>[p.clientX,p.clientY]),[[2,9],[5,1],[8,4]],'retain curved intermediate coordinates, not only the endpoint');
assert.ok(samples.every(p=>p.pointerType==='touch'&&p.pressure===.5));
assert.equal(writingPointerSamples({...event,getCoalescedEvents:()=>[{...event,pointerId:8}]}).length,1);
let next=0,paints=0;const callbacks=new Map();
const frames=writingFrameQueue(()=>paints++,fn=>{callbacks.set(++next,fn);return next;},id=>callbacks.delete(id));
for(let i=0;i<100;i++)frames.schedule();
assert.equal(callbacks.size,1,'many input events schedule one paint');
callbacks.get(next)();callbacks.clear();assert.equal(paints,1);
frames.schedule();frames.clear();assert.equal(callbacks.size,0,'cancel or pointerup must remove stale paints');
class Element{constructor(){this.children=[];this.dataset={};this.attrs={};}setAttribute(k,v){this.attrs[k]=String(v);}append(...nodes){for(const n of nodes){n.parentNode=this;this.children.push(n);}}replaceChildren(...nodes){for(const n of this.children)n.parentNode=null;this.children=[];this.append(...nodes);}}
globalThis.document={createElement:()=>new Element(),createElementNS:()=>new Element()};
const layer=new Element(),stroke={id:'live',type:'stroke',tool:'pen',baseWidth:1,color:'#000',opacity:1,points:[{x:10,y:20,width:1}]};
renderWritingStrokePreview(layer,stroke);const item=layer.children[0],group=item.children[0].children[0],line=group.children[0];
assert.equal(group.children[1].attrs.cx,'10','a tap has a visible dot');
for(let i=1;i<=200;i++)stroke.points.push({x:10+i/10,y:20+i/20,width:1});
renderWritingStrokePreview(layer,stroke);
assert.equal(layer.children[0],item,'reuse the live stroke DOM');assert.equal(group.children[0],line);
assert.equal(group.children.length,2,'long strokes do not allocate two SVG nodes per sample');
assert.ok(line.attrs.points.endsWith('30,30'));
console.log('Pointer batches, fallback, one paint per frame, cancellation, tap dot and stable long-stroke DOM passed.');
