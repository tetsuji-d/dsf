import assert from 'node:assert/strict';
import {createFlowGroupBlock} from '../js/flow-project-model.js';
import {createFlowTextSelection} from '../js/flow-text-selection.js';
import {applyFlowAuthoringOperation} from '../js/flow-authoring.js';
const make=()=>createFlowGroupBlock({id:'g',sourceLanguage:'ja',document:{schemaVersion:3,sourceLanguage:'ja',sections:[{id:'s',title:{},blocks:[
{id:'a',type:'paragraph',texts:{ja:'前半本文',en:'first'}},
{id:'b',type:'paragraph',texts:{ja:'途中',en:'middle'}},
{id:'c',type:'paragraph',texts:{ja:'本文後半',en:'last'}}]}]}});
const point=(blockId,utf16Offset)=>({sectionId:'s',blockId,languageKey:'ja',utf16Offset});
for(const reverse of [false,true]) {
const g=make(), before=JSON.stringify(g), ends=[point('a',2),point('c',2)];
const selection=createFlowTextSelection(g,...(reverse?ends.reverse():ends));
const op={type:'deleteTextSelection',groupId:'g',selection};
const next=applyFlowAuthoringOperation([g],op)[0];
assert.deepEqual(next.flow.document.sections[0].blocks.map(b=>b.texts.ja),['前半後半']);
assert.equal(next.flow.document.sections[0].blocks[0].texts.en,'first\nmiddle\nlast');
assert.equal(JSON.stringify(g),before);
const stale=structuredClone(g);stale.flow.document.sections[0].blocks[1].texts.ja+='変更';
assert.throws(()=>applyFlowAuthoringOperation([stale],op),{code:'FLOW_SELECTION_STALE'});
const boundary=structuredClone(g);boundary.flow.document.sections[0].blocks[1].titleRegion={id:'title',languageKey:'ja',textAlign:'center',blockAlign:'center'};
assert.throws(()=>applyFlowAuthoringOperation([boundary],op),{code:'FLOW_SELECTION_BOUNDARY'});
}
const g=make(), blocks=g.flow.document.sections[0].blocks;
blocks[0].type='heading';blocks[0].level=1;
blocks[1].texts={ja:'',en:''};blocks[1].annotations={ja:[]};
blocks[0].titleRegion=blocks[1].titleRegion={id:'title',languageKey:'ja',textAlign:'center',blockAlign:'center'};
const next=applyFlowAuthoringOperation([g],{type:'removeEmptyParagraph',groupId:'g',sectionId:'s',blockId:'b',neighborId:'a'})[0];
assert.equal(next.flow.document.sections[0].blocks.length,2);
assert.deepEqual(next.flow.document.sections[0].blocks[0],blocks[0]);
blocks[1].texts.en='translation';
assert.throws(()=>applyFlowAuthoringOperation([g],{type:'removeEmptyParagraph',groupId:'g',sectionId:'s',blockId:'b',neighborId:'a'}),{code:'FLOW_EMPTY_PARAGRAPH_PROTECTED'});
console.log('Selection deletion and empty heading paragraph: text preservation, stale rejection, boundaries and translation protection passed.');

// Empty headings 1-6 inside a title region: retain the actual title/body exactly.
for (let level=1;level<=6;level++) {
    const g=make(), rows=g.flow.document.sections[0].blocks;
    rows[0].type='heading';rows[0].level=level;rows[0].texts={ja:'',en:''};
    rows[0].annotations={ja:[]};
    rows[0].titleRegion=rows[1].titleRegion={id:'title',languageKey:'ja',textAlign:'center',blockAlign:'center'};
    const original=JSON.stringify(g), survivor=structuredClone(rows[1]);
    const operation={type:'removeEmptyParagraph',groupId:'g',sectionId:'s',blockId:'a',neighborId:'b'};
    const result=applyFlowAuthoringOperation([g],operation)[0];
    assert.deepEqual(result.flow.document.sections[0].blocks[0],survivor);
    assert.equal(result.flow.document.sections[0].blocks.length,2);
    assert.equal(JSON.stringify(g),original);
    for(const mutate of [b=>b.texts.ja='見出し',b=>b.texts.en='Title',b=>b.titleRegion={...b.titleRegion,id:'other'},b=>b.custom='protected']) {
        const unsafe=structuredClone(g);mutate(unsafe.flow.document.sections[0].blocks[0]);
        assert.throws(()=>applyFlowAuthoringOperation([unsafe],operation),{code:'FLOW_EMPTY_PARAGRAPH_PROTECTED'});
    }
}
console.log('Empty headings 1-6: title region, survivor formatting, immutable source, translations and unknown metadata protection passed.');
