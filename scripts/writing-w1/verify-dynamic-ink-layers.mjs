import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {naturalBrushInkPaths,brushGeometry,brushDryness} from '../../js/reader-writing-tools.js';
import {createReaderWritingModel,duplicateWritingObject} from '../../js/reader-writing-model.js';
import {spreadStrokeParts} from '../../js/reader-writing-spread.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {nodeRuntime} from './node-runtime.mjs';
const brushInkPaths=(points,ink)=>naturalBrushInkPaths(points,ink,true);
const stroke={id:'ink',type:'stroke',tool:'brush',color:'#20272b',opacity:1,baseWidth:12,geometryVersion:4,inkAmount:.2,
 points:Array.from({length:120},(_,i)=>({x:40+i*2,y:250+Math.sin(i/20)*25,width:10,pressure:.5,dryness:brushDryness(i*2,.3)}))};
const dry=brushInkPaths(stroke.points,.2),wet=brushInkPaths(stroke.points,1);
assert.ok(dry.length<=24);assert.ok(wet.length<=24);assert.notDeepEqual(dry,wet);
assert.deepEqual(dry,brushInkPaths(structuredClone(stroke.points),.2));
assert.ok([...dry,...wet,...brushInkPaths(stroke.points.slice(0,1),0)].every(p=>p.d.endsWith(' Z')&&!p.d.includes('NaN')&&p.opacity>0&&p.opacity<=1));
const numeric=d=>d.match(/-?\d+(?:\.\d+)?/g).map(Number);
function translated(a,b,dx,dy){a.forEach((path,i)=>{const before=numeric(path.d),after=numeric(b[i].d);assert.equal(before.length,after.length);
 before.forEach((v,j)=>assert.ok(Math.abs(after[j]-v-(j%2?dy:dx))<.002));assert.equal(path.opacity,b[i].opacity);});}
const copy=duplicateWritingObject(stroke);assert.equal(copy.inkAmount,.2);translated(dry,brushInkPaths(copy.points,.2),12,12);
const spanning={...stroke,points:stroke.points.map(p=>({...p,x:p.x+220}))};
const parts=spreadStrokeParts(spanning,[0,1],['page1','page2'],()=>crypto.randomUUID());assert.equal(parts.length,2);
translated(brushInkPaths(parts[0].object.points,.2),brushInkPaths(parts[1].object.points,.2),-360,0);
const options=await nodeRuntime(),original=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/original.dsf',import.meta.url))),options);
const model=createReaderWritingModel(original,options.catalog.map(c=>c.id));model.change('ja','page1','墨量',all=>[...all,stroke]);
const before=model.envelope;
for(const inkAmount of [-.01,1.01,NaN,undefined]){assert.throws(()=>model.change('ja','page1','不正',all=>all.map(o=>({...o,inkAmount}))));assert.deepEqual(model.envelope,before);}
assert.throws(()=>model.change('ja','page1','不正道具',all=>all.map(o=>({...o,tool:'pen'}))));
const output=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope}),reopened=await loadDsfV3(output.bytes,options);
assert.deepEqual(reopened.envelope,model.envelope);
for(const e of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(reopened.readBytes(e.path),original.readBytes(e.path));
const shared=await resaveDsfV3(reopened,{copyKind:'writing-shared'});assert.equal(shared.handle.envelope.history,null);assert.deepEqual(shared.handle.envelope.document.pages,model.envelope.document.pages);
await writeFile(new URL('../../outputs/writing-w1/dynamic-ink-verification.json',import.meta.url),JSON.stringify({ok:true,deterministic:true,copyTranslation:true,spreadSeam:true,invalidRejectedAtomically:true,zipRoundtrip:true,sharedAppearance:true,originalBytesUnchanged:true},null,2));
console.log('Brush ink texture, copy/spread stability, validation, editable/shared ZIP roundtrip and original byte preservation passed.');
const {reorderWritingObject}=await import('../../js/reader-writing-model.js');
const stack=[{...stroke,id:'back'},{...stroke,id:'middle'},{...stroke,id:'front'}];
const ids=all=>all.map(o=>o.id);
assert.deepEqual(ids(reorderWritingObject(stack,'back','front')),['middle','front','back']);
assert.deepEqual(ids(reorderWritingObject(stack,'front','back')),['front','back','middle']);
assert.deepEqual(ids(reorderWritingObject(stack,'middle','up')),['back','front','middle']);
assert.deepEqual(ids(reorderWritingObject(stack,'middle','down')),['middle','back','front']);
assert.deepEqual(ids(stack),['back','middle','front']);
model.change('ja','page1','stack',()=>stack);const oldHead=model.head;
model.change('ja','page1','reorder',all=>reorderWritingObject(all,'back','front'));const newHead=model.head;
assert.deepEqual(ids(model.objects('ja','page1')),['middle','front','back']);model.restore(oldHead);assert.deepEqual(ids(model.objects('ja','page1')),ids(stack));model.restore(newHead);
const ordered=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope});
const orderedRead=await loadDsfV3(ordered.bytes,options);assert.deepEqual(orderedRead.envelope.document.pages,model.envelope.document.pages);
console.log('Layer order, Undo/Redo and saved paint order passed.');


const raw=Array.from({length:5},(_,i)=>({x:30+i*60,y:100,time:i*200,pressure:.5,pen:false}));
const slow=brushGeometry(raw,10,true,true),fast=brushGeometry(raw.map(p=>({...p,time:p.time/5})),10,true,true);
assert.equal(slow[0].dryness,0);assert.ok(slow.at(-1).dryness>slow[10].dryness);
assert.ok(fast[50].dryness>slow[50].dryness);
const {reorderWritingObjectAt}=await import('../../js/reader-writing-model.js');
assert.deepEqual(ids(reorderWritingObjectAt(stack,'back',2)),['middle','front','back']);
assert.deepEqual(ids(reorderWritingObjectAt(stack,'front',0)),['front','back','middle']);
const snapshot=model.envelope;
assert.throws(()=>model.change('ja','page1','invalid dryness',all=>all.map(o=>({...o,points:o.points.map(p=>({...p,dryness:1.1}))}))));assert.deepEqual(snapshot,model.envelope);
console.log('Saved input speed and distance dryness, drop indices and atomic invalid dynamics rejection passed.');
