import assert from 'node:assert/strict';
import { createFlowImageInsertion } from '../js/flow-image-insertion.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { createFlowDirectEditSession } from '../js/flow-direct-edit.js';
import { createPageBlockFromSection } from '../js/blocks.js';
import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
import { confirmFlowTranslationAgainstCurrentSource, deriveFlowTranslationStatus } from '../js/flow-translation-state.js';
import { createCanonicalFlowPageBox, paginateFlowDocument } from '../js/flow-pagination.js';
import { serializeProject, deserializeProject } from '../js/project-persistence.js';
import { state } from '../js/state.js';
import { clearHistory, pushState, undo, redo } from '../js/history.js';
const image = createPageBlockFromSection({ type: 'image', background: 'https://example.test/image.webp' });
function fixture(type='paragraph') {
    const group = createFlowGroupBlock({ id:'group', sourceLanguage:'ja', document:{
        id:'doc', sourceLanguage:'ja', extra:'document', sections:[
            {id:'first', title:{ja:'前章'}, blocks:[{id:'intro',type:'paragraph',texts:{ja:'冒頭',en:'Intro'}}]},
            {id:'section', title:{ja:'章',en:'Chapter'}, extra:'section', blocks:[
                {id:'body',type,...(type==='heading'?{level:3}:{}),texts:{ja:'前👩‍💻\n後',en:'Before and after'},extra:'body'},
                {id:'following',type:'paragraph',texts:{ja:'続く本文',en:'Following'}}]},
            {id:'last', title:{ja:'終章'}, blocks:[{id:'end',type:'paragraph',texts:{ja:'終わり',en:'End'}}]}
        ]}});
    group.flow.translationState = confirmFlowTranslationAgainstCurrentSource(group,'en').translationState;
    group.flow.translationState.languages.en.lockedUnitIds=['body','following','last'];
    return group;
}
let counter=0;
function insert(group,offset,mode='horizontal-tb',extra={}) {
    const session = createFlowDirectEditSession(group,{pageLanguageKey:'ja',writingMode:mode,
        sourcePoint:{sectionId:'section',blockId:'body',languageKey:'ja',utf16Offset:offset}});
    return createFlowImageInsertion([group],session,{selectionStart:offset,selectionEnd:offset,
        expectedText:session.expectedText,imageBlock:image,idFactory:p=>p+(++counter),...extra});
}
const getBody = group => group.flow.document.sections.flatMap(s=>s.blocks).filter(b=>b.type!=='pageBreak');
for(const mode of ['horizontal-tb','vertical-rl']) for(const type of ['paragraph','heading']) {
    for(const offset of [0,1,6,7,8]) {
        const group=fixture(type), before=JSON.stringify(group);
        const result=insert(group,offset,mode);
        const [leading,fixed,trailing]=result.blocks;
        assert.equal(result.activeBlockIndex,1);
        assert.equal(JSON.stringify(group),before);
        assert.deepEqual(fixed,image);
        assert.equal(getBody(leading).at(-1).texts.ja+getBody(trailing)[0].texts.ja,'前👩‍💻\n後');
        assert.equal(getBody(leading).at(-1).texts.en,'Before and after');
        assert.equal(getBody(trailing)[0].texts.en,undefined);
        assert.deepEqual(getBody(trailing).at(-1),getBody(group).at(-1));
        assert.deepEqual(trailing.flow.layout,group.flow.layout);
        assert.deepEqual(deriveFlowTranslationStatus(trailing,'en').body.ids.stale,[]);
        assert(deriveFlowTranslationStatus(trailing,'en').body.ids.missing.includes(getBody(trailing)[0].id));
        assert.deepEqual(trailing.flow.translationState.languages.en.lockedUnitIds,['following','last']);
        assert.deepEqual(leading.flow.translationState.languages.en.lockedUnitIds,['body']);
        // A change to the leading group never touches the trailing semantic document or layout.
        const tailBefore=JSON.stringify(trailing);
        const grown=applyFlowAuthoringOperation(result.blocks,{type:'setText',groupId:leading.id,
            sectionId:'first',blockId:'intro',languageKey:'ja',text:'増える本文'.repeat(300)});
        assert.equal(JSON.stringify(grown[2]),tailBefore);
        const options={languageKey:'ja',writingMode:mode,pageBox:createCanonicalFlowPageBox(),
            measurePage:({fragments})=>({fits:fragments.reduce((n,f)=>n+(f.text?.length||0),0)<=60})};
        const afterPagination=paginateFlowDocument(trailing.flow.document,options);
        assert.deepEqual(paginateFlowDocument(grown[2].flow.document,options),afterPagination);
        assert(paginateFlowDocument(grown[0].flow.document,options).pages.length>
            paginateFlowDocument(leading.flow.document,options).pages.length);
        // Repeated insertion is legal in the new group and leaves all IDs valid.
        const trailingText=getBody(trailing)[0];
        const nextSession=createFlowDirectEditSession(trailing,{pageLanguageKey:'ja',writingMode:mode,
            sourcePoint:{sectionId:'section',blockId:trailingText.id,languageKey:'ja',utf16Offset:0}});
        assert.equal(createFlowImageInsertion(result.blocks,nextSession,{selectionStart:0,selectionEnd:0,
            expectedText:trailingText.texts.ja,imageBlock:createPageBlockFromSection({type:'image'}),
            idFactory:p=>p+(++counter)}).blocks.length,5);
        const persisted=serializeProject({version:6,blocks:result.blocks,languages:['ja','en'],defaultLang:'ja'});
        assert.deepEqual(deserializeProject(persisted).blocks,result.blocks);
        clearHistory();
        Object.assign(state,{version:6,blocks:[group],sections:[],pages:[],activeIdx:0,activeBlockIdx:0});
        pushState({editorFocus:{mode:'direct',groupId:group.id}});
        state.blocks=result.blocks; state.activeBlockIdx=1;
        undo(()=>{}); assert.deepEqual(state.blocks,[group]);
        redo(()=>{}); assert.deepEqual(state.blocks,result.blocks); assert.equal(state.activeBlockIdx,1);
    }
}
const group=fixture();
assert.throws(()=>insert(group,1,'horizontal-tb',{selectionEnd:2}));
assert.throws(()=>insert(group,1,'horizontal-tb',{expectedText:'stale'}));
assert.throws(()=>insert(group,1,'horizontal-tb',{idFactory:()=> 'group'}));
assert.throws(()=>insert(group,1,'horizontal-tb',{imageBlock:{...image,content:{pageKind:'text'}}}));
const session=createFlowDirectEditSession(group,{pageLanguageKey:'ja',writingMode:'horizontal-tb',
    sourcePoint:{sectionId:'section',blockId:'body',languageKey:'ja',utf16Offset:1}});
assert.throws(()=>createFlowImageInsertion([group],session,{selectionStart:2,selectionEnd:2,
    expectedText:session.expectedText,imageBlock:image}));
const stale=applyFlowAuthoringOperation([group],{type:'setText',groupId:'group',sectionId:'section',blockId:'body',languageKey:'ja',text:'変更後'});
assert.throws(()=>createFlowImageInsertion(stale,session,{selectionStart:1,selectionEnd:1,
    expectedText:session.expectedText,imageBlock:image}));
console.log('Flow image insertion: isolated reflow, translations, IDs, repeated insertion, persistence and Undo/Redo passed.');
