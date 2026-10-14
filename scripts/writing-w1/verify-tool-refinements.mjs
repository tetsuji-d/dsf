import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {penPixels,penMillimeters,penWidthLabel,toolDefaults,highlighterPolygons} from '../../js/reader-writing-tools.js';
import {createReaderWritingModel,duplicateWritingObject,writingBounds} from '../../js/reader-writing-model.js';
import {renderWritingLayer} from '../../js/reader-writing-renderer.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {nodeRuntime} from './node-runtime.mjs';
for(const mm of [.1,.3,.5,.7,1,2.5,4,8]){assert.ok(Math.abs(penMillimeters(penPixels(mm))-mm)<1e-12);assert.equal(penWidthLabel(penPixels(mm)),String(mm));}
assert.equal(penWidthLabel(toolDefaults().highlighter.width),'4');
const dot={x:100,y:100,width:20,pressure:.5};
const box=highlighterPolygons([dot])[0];assert.equal(box.length,4);
assert.equal(Math.max(...box.map(p=>p[1]))-Math.min(...box.map(p=>p[1])),20);
assert.ok(Math.abs(Math.max(...box.map(p=>p[0]))-Math.min(...box.map(p=>p[0]))-5.6)<1e-10);
for(const end of [{x:200,y:100},{x:100,y:200},{x:50,y:50}]){
    const polygons=highlighterPolygons([dot,{...dot,...end}]);
    assert.ok(polygons.every(p=>p.length>=4&&p.flat().every(Number.isFinite)));
    // Both rectangular endpoints are inside the swept convex hull, including a diagonal stroke.
    const hull=polygons[1];for(const p of [...box,...highlighterPolygons([{...dot,...end}])[0]]){
        assert.ok(hull.every((a,i)=>{const b=hull[(i+1)%hull.length];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>=-1e-8;}));
    }
}
const mark={id:'highlighter',type:'stroke',tool:'highlighter',color:'#f3ed35',opacity:.48,baseWidth:20,geometryVersion:1,points:[dot,{...dot,x:200}]};
class Element{constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.style={};}setAttribute(k,v){this.attrs[k]=v;}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}}
globalThis.document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
const layer=new Element('div');renderWritingLayer(layer,[mark],{});
const group=layer.children[0].children[0].children[0];assert.equal(group.attrs.opacity,.48);assert.ok(group.children.every(e=>e.tag==='polygon'));
const shapes=[mark,{id:'line',type:'line',from:[340,600],to:[360,640],color:'#000000',width:2,arrow:'end'},
    {id:'rect',type:'shape',shape:'rect',rect:[330,610,30,30],color:'#000000',fill:null,width:2,opacity:1},
    {id:'text',type:'text',rect:[10,10,20,20],layout:[{start:0,end:1,x:10,y:10}],text:'A',runs:[],writingMode:'horizontal-tb'}];
for(const o of shapes){const original=structuredClone(o),copy=duplicateWritingObject(o);assert.notEqual(copy.id,o.id);assert.deepEqual(o,original);
    const [x,y,w,h]=writingBounds(copy);assert.ok(x>=0&&y>=0&&x+w<=360&&y+h<=640);
    if(o.type==='text'){assert.equal(copy.layout[0].x,22);assert.equal(copy.text,o.text);}}
const options=await nodeRuntime(),original=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/original.dsf',import.meta.url))),options);
const model=createReaderWritingModel(original,options.catalog.map(c=>c.id));
model.change('ja','page1','マーカー',all=>[...all,mark]);const beforeCut=model.head;
const clipboard=model.objects('ja','page1')[0];model.change('ja','page1','切り取り',all=>all.filter(o=>o.id!==clipboard.id));
assert.equal(model.objects('ja','page1').length,0);model.restore(beforeCut);assert.equal(model.objects('ja','page1').length,1);
const copy=duplicateWritingObject(clipboard);model.change('ja','page2','貼り付け',all=>[...all,copy]);
assert.notEqual(model.objects('ja','page2')[0].id,mark.id);
const saved=await resaveDsfV3(original,{copyKind:'writing-editable',envelope:model.envelope}),reopened=await loadDsfV3(saved.bytes,options);
assert.deepEqual(reopened.envelope,model.envelope);
for(const e of JSON.parse(new TextDecoder().decode(original.readBytes('base.json'))).entries)assert.deepEqual(reopened.readBytes(e.path),original.readBytes(e.path));
await writeFile(new URL('../../outputs/writing-w1/tool-refinements-verification.json',import.meta.url),JSON.stringify({ok:true,mmRoundtrip:true,rectangularNib:true,groupOpacity:true,duplicateBounds:true,cutUndo:true,crossPagePaste:true,zipRoundtrip:true,originalBytesUnchanged:true},null,2));
console.log('mm conversion, rectangular nib sweeps, group opacity, object copies, cut/Undo, cross-page paste, ZIP roundtrip and original bytes passed.');
