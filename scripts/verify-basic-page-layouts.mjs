import assert from 'node:assert/strict';
import {BASIC_PAGE_LAYOUTS,createBasicLayoutPage,duplicateFixedPage,inspectPageDuplication,layoutInsertionIndex} from '../js/basic-page-layouts.js';
import {validateGraphicObjects} from '../js/graphic-object-model.js';
import {createSectionFromPageBlock} from '../js/blocks.js';
import {prepareProjectForSave,serializeProject,deserializeProject} from '../js/project-persistence.js';
import {createHistorySnapshot,clearHistory,pushState,undo,redo} from '../js/history.js';
import {state} from '../js/state.js';

let sequence=0;const id=prefix=>prefix+'_'+(++sequence);
const asset={id:'photo',name:'Photo',background:'https://example.invalid/photo.webp',thumbnail:'https://example.invalid/thumb.webp',width:1200,height:800,byteLength:1000,mimeType:'image/webp'};
for(const language of ['ja','en'])for(const layout of BASIC_PAGE_LAYOUTS){
    const page=createBasicLayoutPage(layout.id,{language,imageAsset:asset,idFactory:id});
    validateGraphicObjects({blocks:[page],projectAssets:[asset]});
    for(const o of page.content.graphicObjects){
        assert.ok(o.frame.x>=0&&o.frame.y>=0&&o.frame.x+o.frame.width<=360&&o.frame.y+o.frame.height<=640);
        if(o.kind==='text'){assert.ok(o.style.fontSize>=16);assert.ok(o.texts[language]);}
        if(o.kind==='image'){
            assert.ok(Math.abs(o.crop.width*asset.width/(o.crop.height*asset.height)-o.frame.width/o.frame.height)<1e-8);
        }
    }
    const project={version:6,languages:[language],defaultLang:language,blocks:[page],sections:[createSectionFromPageBlock(page)],projectAssets:[asset]};
    const restored=deserializeProject(serializeProject(prepareProjectForSave(project)));
    assert.deepEqual(restored.blocks[0].content.graphicObjects,page.content.graphicObjects);
}
assert.throws(()=>createBasicLayoutPage('photo'),/IMAGE_REQUIRED/);
const original=createBasicLayoutPage('article',{idFactory:id});
original.future={preserve:true};original.content.graphicObjects[0].texts.en='Keep translation';
const flow={id:'flow',kind:'flow',flow:{opaque:'keep'}};
const tail=createBasicLayoutPage('chapter',{idFactory:id});
const project={blocks:[original,flow,tail],pageNavigation:{version:1,
    anchors:[{id:'anchorA',name:'Heading',target:{scope:'graphic',kind:'text',ownerId:original.id,objectId:original.content.graphicObjects[0].id,language:'ja',start:0,end:1,text:'伝'}}],
    links:[{id:'linkA',source:{scope:'graphic',kind:'text',ownerId:original.id,objectId:original.content.graphicObjects[2].id,language:'ja',start:0,end:1,text:'こ'},destination:{kind:'anchor',anchorId:'anchorA'},reference:{format:'page',start:0,end:1,text:'1',contextText:'1'}}]}};
const before=structuredClone(project),result=duplicateFixedPage(project,0,id),copy=result.blocks[1];
assert.equal(result.activeBlockIndex,1);assert.equal(result.blocks[2],flow);assert.equal(result.blocks[3],tail);
assert.notEqual(copy.id,original.id);assert.deepEqual(copy.future,original.future);
assert.equal(copy.content.graphicObjects[0].texts.en,'Keep translation');
assert.notEqual(copy.content.graphicObjects[0].id,original.content.graphicObjects[0].id);
assert.deepEqual(copy.content.objectOrder,copy.content.graphicObjects.map(o=>o.id));
assert.equal(result.pageNavigation.anchors[1].target.ownerId,copy.id);
assert.equal(result.pageNavigation.links[1].destination.anchorId,result.pageNavigation.anchors[1].id);
assert.deepEqual(project,before);
copy.content.graphicObjects[0].texts.ja='Changed';assert.notEqual(original.content.graphicObjects[0].texts.ja,'Changed');
assert.equal(inspectPageDuplication(project.blocks,1).ok,false);
assert.equal(layoutInsertionIndex(project.blocks,1),2);
const left=structuredClone(tail),right=structuredClone(tail);left.id='left';right.id='right';
left.content.spreadImage={groupId:'spread',role:'left'};right.content.spreadImage={groupId:'spread',role:'right'};
const spread={blocks:[original,left,right,flow,tail]};
const dup=duplicateFixedPage(spread,2,id);
assert.equal(dup.activeBlockIndex,3);assert.equal(dup.blocks[3].content.spreadImage.groupId,dup.blocks[4].content.spreadImage.groupId);
assert.notEqual(dup.blocks[3].content.spreadImage.groupId,'spread');assert.equal(dup.blocks[5],flow);
assert.equal(layoutInsertionIndex(spread.blocks,1),3);
assert.equal(inspectPageDuplication([left,flow,right],0).ok,false);
assert.throws(()=>duplicateFixedPage({blocks:[left,flow,right]},0,id));
const backup=structuredClone(state);
try{
    Object.assign(state,{version:6,blocks:[original,tail],sections:[original,tail].map(createSectionFromPageBlock),pages:[],pageNavigation:null,projectAssets:[],activeBlockIdx:0,activeIdx:0});
    clearHistory();const old=createHistorySnapshot();pushState();
    const d=duplicateFixedPage(state,0,id);state.blocks=d.blocks;state.sections=d.blocks.map(createSectionFromPageBlock);state.activeBlockIdx=d.activeBlockIndex;
    assert.equal(undo(()=>{}),true);assert.deepEqual(state.blocks,old.blocks);
    assert.equal(redo(()=>{}),true);assert.deepEqual(state.blocks,d.blocks);
    const saved=deserializeProject(serializeProject(prepareProjectForSave(state)));
    assert.deepEqual(saved.blocks.map(b=>b.id),d.blocks.map(b=>b.id));
}finally{for(const k of Object.keys(state))delete state[k];Object.assign(state,backup);clearHistory();}
console.log('PASS: six layouts in JA/EN, bounds, image crop, graphic schema and save round-trip; canonical duplicate, translated text, IDs/navigation, spread boundaries, Undo/Redo.');



import {resolveBasicLayoutContext,basicLayoutWritingModes,languageTextDirection} from '../js/basic-layout-context.js';
import {basicLayoutSamples} from '../js/basic-layout-samples.js';

const blank={id:'blank',kind:'page',content:{}};
const base={activeLang:'ja',defaultLang:'en',activeBlockIdx:0,blocks:[blank],languageConfigs:{ja:{pageDirection:'rtl'}}};
assert.equal(resolveBasicLayoutContext(base).writingMode,'vertical-rl');
assert.equal(resolveBasicLayoutContext({...base,languageConfigs:{ja:{pageDirection:'ltr'}}}).writingMode,'horizontal-tb');
assert.equal(resolveBasicLayoutContext({...base,languageConfigs:{ja:{writingMode:'horizontal-tb',pageDirection:'rtl'}}}).writingMode,'horizontal-tb');
assert.equal(resolveBasicLayoutContext({...base,languageConfigs:{ja:{writingMode:'vertical-rl',pageDirection:'ltr'}}}).pageDirection,'ltr');
const manuscript={id:'flow-settings',kind:'flow',flow:{document:{sourceLanguage:'ja'},layout:{writingMode:'vertical-rl',typographyByLanguage:{ja:{writingMode:'horizontal-tb'}}}}};
assert.equal(resolveBasicLayoutContext({...base,blocks:[manuscript]}).writingMode,'horizontal-tb');
assert.equal(resolveBasicLayoutContext({...base,blocks:[manuscript]}).source,'manuscript');
assert.equal(resolveBasicLayoutContext({...base,activeLang:'en',blocks:[manuscript]}).writingMode,'horizontal-tb');
assert.equal(resolveBasicLayoutContext({...base,activeLang:'ar'}).textDirection,'rtl');
assert.equal(resolveBasicLayoutContext({...base,activeLang:'ar'}).writingMode,'horizontal-tb');
assert.equal(languageTextDirection('ar-Latn'),'ltr');
assert.equal(languageTextDirection('he'),'rtl');
assert.deepEqual(basicLayoutWritingModes('zh-Hant'),['horizontal-tb','vertical-rl']);
assert.equal(basicLayoutSamples('en-GB').fallback,false);
assert.equal(basicLayoutSamples('unknown').fallback,true);
assert.throws(()=>createBasicLayoutPage('cover',{language:'en',writingMode:'vertical-rl'}),/UNSUPPORTED/);

let directionalCases=0;
for(const language of ['ja','en','zh-Hant','zh-Hans','ar','fr','de','es','pt','ko']){
    for(const writingMode of basicLayoutWritingModes(language))for(const pageDirection of ['rtl','ltr'])for(const preset of BASIC_PAGE_LAYOUTS){
        const page=createBasicLayoutPage(preset.id,{language,writingMode,pageDirection,imageAsset:asset,idFactory:id});
        validateGraphicObjects({blocks:[page],projectAssets:[asset]});
        for(const object of page.content.graphicObjects){
            const f=object.frame;assert.ok(f.x>=0&&f.y>=0&&f.x+f.width<=360&&f.y+f.height<=640);
            if(object.kind==='text'&&!/^\d+$/.test(object.texts[language]))assert.equal(object.style.writingMode,writingMode);
            if(object.kind==='text'&&language==='ar'&&!/^\d+$/.test(object.texts[language]))assert.equal(object.style.align,'right');
        }
        const p={version:6,languages:[language],defaultLang:language,blocks:[page],projectAssets:[asset],languageConfigs:{[language]:{pageDirection}}};
        const restored=deserializeProject(serializeProject(prepareProjectForSave(p)));
        assert.deepEqual(restored.blocks[0].content.graphicObjects,page.content.graphicObjects);
        assert.equal(restored.languageConfigs[language].pageDirection,pageDirection);
        directionalCases++;
    }
}
const verticalSteps=createBasicLayoutPage('steps',{language:'ja',writingMode:'vertical-rl',pageDirection:'ltr'});
assert.equal(resolveBasicLayoutContext({...base,blocks:[verticalSteps],languageConfigs:{ja:{pageDirection:'ltr'}}}).writingMode,'vertical-rl');
const horizontalPage=createBasicLayoutPage('article',{language:'ja',writingMode:'horizontal-tb'});
assert.equal(resolveBasicLayoutContext({...base,blocks:[horizontalPage]}).writingMode,'horizontal-tb');
const mixed=structuredClone(horizontalPage);mixed.content.graphicObjects[0].style.writingMode='vertical-rl';
assert.equal(resolveBasicLayoutContext({...base,blocks:[mixed]}).mixed,true);
assert.equal(resolveBasicLayoutContext({...base,blocks:[mixed]}).source,'project');
const ltrSteps=createBasicLayoutPage('steps',{language:'ja',pageDirection:'ltr'}),rtlSteps=createBasicLayoutPage('steps',{language:'ja',pageDirection:'rtl'});
assert.deepEqual(rtlSteps.content.graphicObjects.map(o=>o.frame),ltrSteps.content.graphicObjects.map(o=>o.frame));
for(const language of ['ja','en-us','ar'])for(const pageDirection of ['ltr','rtl']){
    const objects=createBasicLayoutPage('steps',{language,pageDirection}).content.graphicObjects;
    const number=objects[2],heading=objects[3];
    assert.equal(number.frame.x < heading.frame.x,language!=='ar','Badge placement follows text direction, not page order');
}
assert.equal(rtlSteps.content.graphicObjects[3].style.writingMode,'horizontal-tb');
console.log('PASS: '+directionalCases+' language/writing-mode/page-order layouts, save round trips, manuscript/page overrides, mixed modes and language aliases.');

// Number badges and headings share a center axis in both writing directions.
import {layoutGraphicText} from '../js/graphic-text-layout.js';
for(const writingMode of ['horizontal-tb','vertical-rl'])for(const pageDirection of ['rtl','ltr']){
    const objects=createBasicLayoutPage('steps',{language:'ja',writingMode,pageDirection}).content.graphicObjects;
    const numbers=objects.filter(o=>o.name==='手順番号'),headings=objects.filter(o=>o.name==='手順の見出し');
    assert.equal(numbers.length,3);assert.equal(headings.length,3);
    numbers.forEach((number,i)=>{
        const badge=objects[objects.indexOf(number)-1],heading=headings[i];
        assert.deepEqual(number.frame,badge.frame);
        assert.equal(number.style.valign,'center');assert.equal(heading.style.valign,'center');
        const axis=writingMode==='vertical-rl'?'x':'y',size=axis==='x'?'width':'height';
        assert.equal(number.frame[axis]+number.frame[size]/2,heading.frame[axis]+heading.frame[size]/2);
    });
}
const metricContext={measureText:text=>({width:text.length*12,actualBoundingBoxAscent:-4,actualBoundingBoxDescent:19})};
const centeredStyle={fontSize:20,fontFamily:'sans-serif',padding:0,align:'center',valign:'center',writingMode:'horizontal-tb'};
const centerLine=layoutGraphicText(metricContext,'1',centeredStyle,{width:42,height:42})[0];
assert.equal(centerLine.x+6,21);
assert.equal(centerLine.y+(4+19)/2,21);
const centerColumn=layoutGraphicText(metricContext,'準備する',{...centeredStyle,writingMode:'vertical-rl'},{width:40,height:190})[0];
assert.equal(centerColumn.x+10,20);
console.log('PASS: number badge/headings center axes in vertical/horizontal RTL/LTR; visible single-line glyph centering.');
