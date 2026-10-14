import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {arrowHeadGeometry,arrowShaftGeometry,lineStrokeAttributes,LINE_STYLES} from '../../js/reader-writing-format.js';
import {writingUiText} from '../../js/reader-writing-i18n.js';
import {createReaderWritingModel,createWritingText} from '../../js/reader-writing-model.js';
import {loadDsfV3,resaveDsfV3} from '../../js/dsf-writing-package.js';
import {nodeRuntime} from './node-runtime.mjs';

// A circle's shaft ends inside its disk, even with a thick stroke or diagonal line.
for(const width of [.3,2,12,30])for(const angle of [0,.4,Math.PI/2,Math.PI])for(const arrow of ['start','end','both']){
    const o={from:[180,250],to:[180+140*Math.cos(angle),250+140*Math.sin(angle)],width,arrow,arrowHead:'circle'};
    const shaft=arrowShaftGeometry(o),heads=arrowHeadGeometry(o);assert.ok(shaft);
    for(const [i,end] of (arrow==='both'?['from','to']:[arrow==='start'?'from':'to']).entries()){
        const p=shaft[end],h=heads[i];assert.ok(Math.hypot(p[0]-h.center[0],p[1]-h.center[1])+width/2<=h.radius+.00001);
    }
}
for(const arrowHead of ['triangle','circle','diamond'])for(const to of [[5,0],[0,0]])assert.equal(arrowShaftGeometry({from:[0,0],to,width:8,arrow:'both',arrowHead}),null);
assert.deepEqual(arrowShaftGeometry({from:[0,0],to:[40,0],width:2,arrow:'none',arrowHead:'circle'}),{from:[0,0],to:[40,0]});
assert.equal(lineStrokeAttributes('solid',3)['stroke-dasharray'],undefined);
assert.equal(lineStrokeAttributes('dotted',3)['stroke-linecap'],'round');
assert.equal(lineStrokeAttributes('dash-dot',3)['stroke-dasharray'],'18 7.5 0 7.5');
for(const [ja,en] of [['筆ペンの設定','Brush pen settings'],['コーラル / 35色','Coral / 35 colors'],['一点鎖線','Dash-dot'],['道具の表示：ペン。押すと道具','Pens. Show Tools'],['文字を追加','Add text']]){
    assert.equal(writingUiText(ja,'en'),en);assert.equal(writingUiText(ja,'ja'),ja);
}

const runtime=await nodeRuntime(),base=await loadDsfV3(new Uint8Array(await readFile(new URL('../../outputs/writing-w1/preview-sample.dsf',import.meta.url))),runtime);
const model=createReaderWritingModel(base,runtime.catalog.map(f=>f.id));
for(const [lineStyle] of LINE_STYLES)model.change('ja','page1',lineStyle,all=>[...all,
    {id:'line-'+lineStyle,type:'line',from:[30,50],to:[300,100],color:'#2363bc',width:4,arrow:'both',arrowHead:'circle',lineStyle},
    {id:'shape-'+lineStyle,type:'shape',shape:'ellipse',rect:[30,140,240,80],color:'#d33544',width:2,opacity:1,fill:null,lineStyle}]);
const text=createWritingText({text:'テキスト Border',fontId:runtime.catalog[0].id,size:20,weight:400,color:'#2363bc',box:[30,300,300,120],measure:s=>s.length*20});
text.boxStyle={stroke:'#2363bc',fill:'#f7e3a1',width:2};model.change('ja','page1','text box',all=>[...all,text]);
const styled=model.envelope;model.restore(model.parent);assert.ok(!model.pageObjects('ja','page1').some(o=>o.id===text.id));model.restore(model.children.at(-1).id);assert.deepEqual(model.envelope,styled);
for(const invalid of [{...text,boxStyle:{...text.boxStyle,fill:'url(x)'}},{...text,boxStyle:{...text.boxStyle,width:-1}},{id:'bad',type:'line',from:[0,0],to:[100,0],color:'#123456',width:1,arrow:'none',lineStyle:'invalid'}]){
    const before=model.envelope;assert.throws(()=>model.change('ja','page1','invalid',all=>[...all,{...invalid,id:'invalid'}]));assert.deepEqual(model.envelope,before);
}
const saved=await resaveDsfV3(base,{copyKind:'writing-editable',envelope:model.envelope}),loaded=await loadDsfV3(saved.bytes,runtime);
assert.deepEqual(loaded.envelope,model.envelope);
for(const entry of base.inventory.filter(e=>!['format.json','manifest.json'].includes(e.path)))assert.deepEqual(loaded.readBytes(entry.path),base.readBytes(entry.path));
const shared=await resaveDsfV3(loaded,{copyKind:'writing-shared'});assert.deepEqual(shared.handle.envelope.document.pages,model.envelope.document.pages);assert.equal(shared.handle.envelope.history,null);
const output=new URL('../../outputs/writing-w1/style-settings-20261014/',import.meta.url);await mkdir(output,{recursive:true});await writeFile(new URL('style-roundtrip.dsf',output),saved.bytes);
console.log('PASS: circle shaft containment (48 cases), short/zero arrows, four line styles, EN/JA labels, border/fill undo-redo, invalid-style atomic rejection, editable/shared ZIP roundtrip, original bytes preserved.');
