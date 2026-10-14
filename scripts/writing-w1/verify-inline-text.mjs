import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {nodeRuntime} from './node-runtime.mjs';
import {createWritingText,createReaderWritingModel} from '../../js/reader-writing-model.js';
import {writingChromeLayout,writingInspectorPlacement} from '../../js/reader-writing-layout.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
const options=await nodeRuntime(),fontId=options.catalog[0].id,base={fontId,size:20,weight:400,color:'#2363bc',measure:s=>[...s].length*20};
const text=createWritingText({...base,id:'inline-box',text:'文字を直接入力\n書き込み',x:32,y:180,box:[32,180,120,120]});
assert.deepEqual(text.rect,[32,180,120,120]);assert.ok(text.layout[6].y>text.layout[0].y,'Wrap at box width');
const vertical=createWritingText({...base,text:'縦書きのテストです',vertical:true,box:[32,180,120,80]});
assert.ok(vertical.layout[4].x<vertical.layout[0].x,'Wrap vertical text into the next column');
assert.throws(()=>createWritingText({...base,text:'収まらない文字です',box:[20,20,40,30]}),/TEXT_OVERFLOW/);
for(const dims of [[390,844],[844,390],[1920,1080]]){
 const [width,height]=dims,anchor={left:width<600?52:160,top:64,right:width<600?106:220,bottom:164,width:width<600?54:60};
 const p=writingInspectorPlacement({width,height,anchor});assert.ok(p.left>=8&&p.left+p.width<=width-8&&p.top>=8&&p.top+p.height<=height-8);
 assert.ok(p.left<anchor.right+16,'Inspector stays near its invoking tool');
}
const layout=writingChromeLayout({width:390,height:844,paper:{left:2,right:388,top:80,bottom:760},header:{left:230,right:378,top:8,bottom:56,width:148,height:48}});
assert.ok(layout.pens.top>=64&&layout.tools.top>=64,'Tools leave the Reader header available');
const original=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/preview-sample.dsf',import.meta.url))),options);
assert.equal(original.bundle.manifests.ja.pages.length,8);
const model=createReaderWritingModel(original,options.catalog.map(f=>f.id)),root=model.head;
model.change('ja','page2','直接入力',all=>[...all,text]);const written=model.head;
model.restore(root);assert.equal(model.objects('ja','page2').length,0);model.restore(written);
const saved=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope}),reopened=await loadDsfV3(saved.bytes,options);
assert.deepEqual(reopened.envelope,model.envelope);assert.equal(reopened.baseHash,original.baseHash);
for(const entry of original.inventory.filter(e=>!['format.json','manifest.json'].includes(e.path)))assert.deepEqual(reopened.readBytes(entry.path),original.readBytes(entry.path));
await writeFile(new URL('../../outputs/writing-w1/reader-integration-20261013/inline-roundtrip.dsf',import.meta.url),saved.bytes);
console.log('Inline box: horizontal/vertical wrapping, overflow guard, near-tool inspectors, Reader header clearance, 8-page sample, Undo, ZIP reload and unchanged original bytes passed.');
