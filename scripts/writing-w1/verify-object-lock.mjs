import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReaderWritingModel,reorderWritingObject,reorderWritingObjectAt} from '../../js/reader-writing-model.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {nodeRuntime} from './node-runtime.mjs';
const options=await nodeRuntime(),original=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/original.dsf',import.meta.url))),options);
const model=createReaderWritingModel(original,options.catalog.map(c=>c.id));
const rect={id:'locked',type:'shape',shape:'rect',rect:[30,40,100,60],width:2,opacity:1,color:'#20272b',fill:null,locked:true};
const second={...rect,id:'free',locked:false};model.change('ja','page1','追加',()=>[rect,second]);const lockedHead=model.head;
for(const transform of [all=>all.filter(o=>o.id!=='locked'),all=>all.map(o=>o.id==='locked'?{...o,color:'#ff0000'}:o),all=>all.map(o=>o.id==='locked'?{...o,locked:false,rect:[0,0,100,60]}:o)]){
 const before=model.envelope;assert.throws(()=>model.change('ja','page1','禁止',transform),/WRITING_OBJECT_LOCKED/);assert.deepEqual(model.envelope,before);
}
assert.deepEqual(reorderWritingObject([rect,second],'locked','front'),[rect,second]);assert.deepEqual(reorderWritingObjectAt([rect,second],'locked',1),[rect,second]);
const saved=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope}),read=await loadDsfV3(saved.bytes,options);assert.deepEqual(read.envelope,model.envelope);
const shared=await resaveDsfV3(read,{copyKind:'writing-shared'});assert.deepEqual(shared.handle.envelope.document.pages,model.envelope.document.pages);
model.change('ja','page1','解除',all=>all.map(o=>({...o,locked:false})));const unlockedHead=model.head;
model.change('ja','page1','削除',all=>all.filter(o=>o.id!=='locked'));assert.equal(model.objects('ja','page1').length,1);
model.restore(unlockedHead);assert.equal(model.objects('ja','page1').length,2);model.restore(lockedHead);assert.equal(model.objects('ja','page1')[0].locked,true);
const before=model.envelope;assert.throws(()=>model.change('ja','page1','型不正',all=>all.map(o=>o.id==='free'?{...o,locked:'yes'}:o)),/WRITING_OBJECT_LOCK/);assert.deepEqual(model.envelope,before);
for(const e of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(read.readBytes(e.path),original.readBytes(e.path));
await writeFile(new URL('../../outputs/writing-w1/object-lock-verification.json',import.meta.url),JSON.stringify({ok:true,lockedEditDeleteRejected:true,unlockRequiredBeforeEditing:true,orderHelpersGuarded:true,lockUndo:true,deleteUndo:true,editableSharedRoundtrip:true,invalidTypeRejected:true,originalUnchanged:true},null,2));
console.log('Object lock guards, unlock, deletion, Undo, strict types, editable/shared ZIP roundtrip and original bytes passed.');
