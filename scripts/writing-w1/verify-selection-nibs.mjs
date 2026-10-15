import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {writingMarqueeObjects,moveWritingSelection,createReaderWritingModel} from '../../js/reader-writing-model.js';
import {highlighterPolygons,brushGeometry,naturalBrushInkPaths,penPixels,penTipScale,PEN_TOOLS} from '../../js/reader-writing-tools.js';
import {writingHitTest} from '../../js/reader-writing-hit.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {nodeRuntime} from './node-runtime.mjs';

const a={id:'a',type:'shape',shape:'rect',rect:[40,80,40,50],color:'#20272b',fill:null,width:2,opacity:1};
const b={...a,id:'b',rect:[100,140,40,50]},locked={...a,id:'locked',locked:true};
assert.deepEqual(writingMarqueeObjects([a,b,locked],[20,60,140,150]).map(o=>o.id),['a','b']);
assert.deepEqual(writingMarqueeObjects([a,b],[45,85,100,100]),[],'Partial containment does not select');
const moved=moveWritingSelection([a,b],500,500);
assert.deepEqual(moved.map(o=>o.rect),[[260,530,40,50],[320,590,40,50]],'Shared displacement preserves relative positions at page edges');
assert.deepEqual(a.rect,[40,80,40,50],'Original geometry remains immutable');

for(const angle of [0,Math.PI/4,Math.PI/2,Math.PI*.8]){
 const points=[{x:100,y:100,width:20,pressure:.5},{x:100+80*Math.cos(angle),y:100+80*Math.sin(angle),width:20,pressure:.5}];
 const normal=[-Math.sin(angle),Math.cos(angle)],poly=highlighterPolygons(points).at(-1),across=poly.map(([x,y])=>x*normal[0]+y*normal[1]);
 assert.ok(Math.abs(Math.max(...across)-Math.min(...across)-20)<1e-8,'Full width in every direction');
 const stroke={type:'stroke',tool:'highlighter',points},mid={x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};
 assert.ok(writingHitTest(stroke,{x:mid.x+normal[0]*9,y:mid.y+normal[1]*9},0));
 assert.ok(!writingHitTest(stroke,{x:mid.x+normal[0]*12,y:mid.y+normal[1]*12},0));
}
for(const tool of PEN_TOOLS)assert.ok(penTipScale(tool,penPixels(.3))<penTipScale(tool,penPixels(8)));
const raw=Array.from({length:61},(_,i)=>({x:40+i*4,y:240,pressure:.5,pen:false,time:i*(i<21?35:5)}));
// Fixed spatial path; vary only input time to isolate speed from pressure/distance.
const slow=brushGeometry(raw.map((p,i)=>({...p,time:i*40})),12,true,true),fast=brushGeometry(raw.map((p,i)=>({...p,time:i*2})),12,true,true);
assert.ok(slow[40].dryness+.4<fast[40].dryness);
const mixed=brushGeometry(raw.map((p,i)=>({...p,time:i<=20?i*40:i<=40?800+(i-20)*2:840+(i-40)*40})),12,true,true);
assert.ok(mixed[65].dryness>mixed[25].dryness+.4,'Fast section dries');
assert.ok(mixed[110].dryness<mixed[65].dryness-.3,'Ink recovers when slowing down');
assert.notDeepEqual(naturalBrushInkPaths(slow,.65,true),naturalBrushInkPaths(fast,.65,true));

const options=await nodeRuntime(),original=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/original.dsf',import.meta.url))),options);
const model=createReaderWritingModel(original,options.catalog.map(c=>c.id));
model.change('ja','page1','objects',()=>[a,b,locked]);const before=model.head;
model.change('ja','page1','move selection',()=>[...moved,locked]);const after=model.head;
model.restore(before);assert.deepEqual(model.objects('ja','page1'),[a,b,locked]);
model.restore(after);assert.deepEqual(model.objects('ja','page1'),[...moved,locked]);
model.change('ja','page1','delete selection',all=>all.filter(o=>o.locked));assert.equal(model.objects('ja','page1').length,1);
model.restore(after);assert.equal(model.objects('ja','page1').length,3);
const output=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope}),reopened=await loadDsfV3(output.bytes,options);
assert.deepEqual(reopened.envelope,model.envelope);
for(const e of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(reopened.readBytes(e.path),original.readBytes(e.path));
console.log('Marquee containment/locks, grouped clamping/Undo/Redo, full-width directional marker hit testing, pen tip scale, local brush speed/recovery, ZIP roundtrip and immutable original passed.');
