import assert from 'node:assert/strict';
import { moveAuthoringUnitInSpine } from '../js/fixed-page-spine.js';
import { moveExistingImageIntoFlow } from '../js/flow-image-insertion.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { createFlowDirectEditSession } from '../js/flow-direct-edit.js';
import { resolveEditorFlowPageBoundary, resolveEditorFlowSourcePoint } from '../js/editor-canvas-projection.js';
import { serializeProject, deserializeProject } from '../js/project-persistence.js';
import { state } from '../js/state.js';
import { clearHistory, pushState, undo, redo } from '../js/history.js';

const flow = id => createFlowGroupBlock({ id, sourceLanguage:'ja', document:{id:id+'-doc',sourceLanguage:'ja',
    sections:[{id:'section',title:{ja:'章'},blocks:[{id:'body',type:'paragraph',texts:{ja:'前半👩‍💻後半',en:'Translation'}},
    {id:'next',type:'paragraph',texts:{ja:'続き',en:'Continued'}}]}]}});
const image={id:'image',kind:'page',content:{pageKind:'image',background:'asset.webp',backgrounds:{ja:'ja.webp',en:'en.webp'},
    bubbles:[{id:'bubble',texts:{ja:'画像上の文字',en:'Overlay'}}],imagePosition:{x:18,rotation:35},future:{keep:true}}};
const fixed={id:'fixed',kind:'page',content:{pageKind:'text',texts:{ja:'固定本文'}}};
const a=flow('a'), b=flow('b'), blocks=[a,image,fixed,b];
const original=JSON.stringify(blocks);
const moved=moveAuthoringUnitInSpine(blocks,{sourceBlockId:'a',targetBlockId:'b',position:'after'});
assert.deepEqual(moved.blocks.map(b=>b.id),['image','fixed','b','a']);
assert.equal(moved.blocks[3],a); assert.equal(moved.activeBlockIndex,3);
assert.equal(JSON.stringify(blocks),original);
const first=moveAuthoringUnitInSpine(blocks,{sourceBlockId:'b',targetBlockId:'a',position:'before'});
assert.deepEqual(first.blocks.map(b=>b.id),['b','a','image','fixed']);
assert.equal(moveAuthoringUnitInSpine(blocks,{sourceBlockId:'a',targetBlockId:'a'}).changed,false);
assert.equal(moveAuthoringUnitInSpine(blocks,{sourceBlockId:'a',targetBlockId:'image',position:'before'}).changed,false);
const left={id:'left',kind:'page',content:{pageKind:'image',spreadImage:{groupId:'spread',role:'left'}}};
const right={id:'right',kind:'page',content:{pageKind:'image',spreadImage:{groupId:'spread',role:'right'}}};
assert.deepEqual(moveAuthoringUnitInSpine([a,left,right,b],{sourceBlockId:'a',targetBlockId:'left',position:'after'})
    .blocks.map(b=>b.id),['left','right','a','b']);
assert.equal(moveAuthoringUnitInSpine([a,left,b],{sourceBlockId:'a',targetBlockId:'left'}).changed,false);
const marked=[a,{id:'chapter',kind:'chapter',meta:{}},image,b];
assert.equal(moveAuthoringUnitInSpine(marked,{sourceBlockId:'a',targetBlockId:'b'}).reason,'spine_boundary');
const page={kind:'flow',groupId:a.id,languageKey:'ja',page:{fragments:[{sectionId:'section',blockId:'body',blockType:'paragraph',
    languageKey:'ja',text:'後半',sourceRange:{start:7,end:9,startGrapheme:3,endGrapheme:5}}]}};
assert.equal(resolveEditorFlowPageBoundary(page,'before').utf16Offset,7);
assert.equal(resolveEditorFlowPageBoundary(page,'after').utf16Offset,9);
assert.equal(resolveEditorFlowPageBoundary({...page,isSourceFallback:true},'before'),null);
assert.equal(resolveEditorFlowSourcePoint(a,page).utf16Offset,7,'Open source at later-page fragment, not block start');
const session=createFlowDirectEditSession(a,{pageLanguageKey:'ja',writingMode:'vertical-rl',
    sourcePoint:{sectionId:'section',blockId:'body',languageKey:'ja',utf16Offset:2}});
assert.equal(resolveEditorFlowSourcePoint(a,page,session,{start:2,end:7,direction:'backward'}).utf16Offset,2);
assert.equal(resolveEditorFlowSourcePoint(a,page,session,{start:2,end:7,direction:'none'}).utf16Offset,7);
for(const input of [blocks,[image,a,fixed,b]]) {
    const result=moveExistingImageIntoFlow(input,session,{imageBlockId:'image',selectionStart:2,selectionEnd:2,expectedText:session.expectedText});
    assert.equal(result.blocks.filter(b=>b.id==='image').length,1);
    assert.deepEqual(result.blocks[result.activeBlockIndex],image);
    const leading=result.blocks[result.activeBlockIndex-1],tail=result.blocks[result.activeBlockIndex+1];
    assert.equal(leading.flow.document.sections[0].blocks[0].texts.ja,'前半');
    assert.equal(tail.flow.document.sections[0].blocks[0].texts.ja,'👩‍💻後半');
    assert.equal(leading.flow.document.sections[0].blocks[0].texts.en,'Translation');
    assert.equal(tail.flow.document.sections[0].blocks[1].texts.en,'Continued');
    const restored=deserializeProject(serializeProject({version:6,blocks:result.blocks,languages:['ja','en'],defaultLang:'ja'})).blocks;
    assert.deepEqual(restored.map(b=>b.id),result.blocks.map(b=>b.id));
    assert.deepEqual(restored.filter(b=>b.kind==='flow'),result.blocks.filter(b=>b.kind==='flow'));
    for(const [key,value] of Object.entries(image.content)) assert.deepEqual(restored.find(b=>b.id==='image').content[key],value);
    clearHistory();Object.assign(state,{version:6,blocks:input,sections:[],pages:[],activeBlockIdx:0,activeIdx:0});pushState();
    state.blocks=result.blocks;undo(()=>{});assert.deepEqual(state.blocks,input);
    redo(()=>{});assert.deepEqual(state.blocks,result.blocks);
}
assert.throws(()=>moveExistingImageIntoFlow(marked,session,{imageBlockId:'image',selectionStart:2,selectionEnd:2,expectedText:session.expectedText}));
assert.throws(()=>moveExistingImageIntoFlow([a,left,right],session,{imageBlockId:'left',selectionStart:2,selectionEnd:2,expectedText:session.expectedText}));
assert.throws(()=>moveExistingImageIntoFlow(blocks,session,{imageBlockId:'fixed',selectionStart:2,selectionEnd:2,expectedText:session.expectedText}));
assert.throws(()=>moveExistingImageIntoFlow(blocks,session,{imageBlockId:'image',selectionStart:3,selectionEnd:3,expectedText:session.expectedText}));
assert.equal(JSON.stringify(blocks),original);
console.log('Editor Flow interactions: source positions, atomic group moves, image relocation, boundary protection, persistence and Undo passed.');
