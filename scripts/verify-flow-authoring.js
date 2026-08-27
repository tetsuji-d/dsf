import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyFlowAuthoringOperation, FlowAuthoringError } from '../js/flow-authoring.js';
import {
    getFlowEditorSelection,
    isFlowDirectEditing,
    isFlowSourceSelected,
    resetFlowEditorSelections,
    selectFlowDirectEditing,
    selectFlowGeneratedPage,
    selectFlowSource,
} from '../js/flow-editor-session.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { clearHistory, getHistoryInfo, pushState, redo, undo } from '../js/history.js';
import { deserializeProject, serializeProject } from '../js/project-persistence.js';
import { state } from '../js/state.js';

function deterministicIds() {
    let index = 0;
    return (prefix) => `${prefix}_test_${++index}`;
}

function createFixture() {
    const idFactory = deterministicIds();
    const group = createFlowGroupBlock({
        id: 'flow_group_authoring',
        sourceLanguage: 'ja',
        idFactory,
        extensions: { futureGroup: { keep: true } },
        document: {
            id: 'flow_document_authoring',
            sourceLanguage: 'ja',
            futureDocument: 'keep',
            sections: [{
                id: 'flow_section_authoring',
                title: { ja: '第一章', en: 'Chapter One' },
                futureSection: 17,
                blocks: [
                    {
                        id: 'flow_heading_authoring',
                        type: 'heading',
                        level: 1,
                        texts: { ja: '雪の日', en: 'Snow Day' },
                        futureHeading: true,
                    },
                    {
                        id: 'flow_paragraph_authoring',
                        type: 'paragraph',
                        texts: { ja: '冬の金沢は静かだった。', en: 'Kanazawa was quiet in winter.' },
                        futureParagraph: { keep: true },
                    },
                ],
            }],
        },
    });
    return [
        { id: 'page_before', kind: 'page', content: { pageKind: 'image', futureFixed: 'A' } },
        group,
        { id: 'page_after', kind: 'page', content: { pageKind: 'image', futureFixed: 'B' } },
    ];
}

const originalBlocks = createFixture();
const originalJson = JSON.stringify(originalBlocks);

let blocks = applyFlowAuthoringOperation(originalBlocks, {
    type: 'setText',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    text: '前方へ文章を追加した。冬の金沢は静かだった。',
});
assert.equal(JSON.stringify(originalBlocks), originalJson, 'transaction must not mutate input');
assert.deepEqual(blocks[0], originalBlocks[0], 'Fixed prefix must remain byte-equivalent');
assert.deepEqual(blocks[2], originalBlocks[2], 'Fixed suffix must remain byte-equivalent');
assert.equal(blocks[1].flow.document.sections[0].blocks[1].id, 'flow_paragraph_authoring');
assert.equal(blocks[1].flow.document.sections[0].blocks[1].texts.en, 'Kanazawa was quiet in winter.');
assert.deepEqual(blocks[1].flow.document.sections[0].blocks[1].futureParagraph, { keep: true });

blocks = applyFlowAuthoringOperation(blocks, {
    type: 'setSectionTitle',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    languageKey: 'ja',
    text: '雪の章',
});
assert.equal(blocks[1].flow.document.sections[0].title.ja, '雪の章');
assert.equal(blocks[1].flow.document.sections[0].title.en, 'Chapter One');

blocks = applyFlowAuthoringOperation(blocks, {
    type: 'setHeadingLevel',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_heading_authoring',
    level: 2,
});
assert.equal(blocks[1].flow.document.sections[0].blocks[0].level, 2);

blocks = applyFlowAuthoringOperation(blocks, {
    type: 'insertBlock',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    afterBlockId: 'flow_paragraph_authoring',
    blockType: 'pageBreak',
    languageKey: 'ja',
}, { idFactory: () => 'flow_page_break_inserted' });
const sectionBlocks = blocks[1].flow.document.sections[0].blocks;
assert.deepEqual(sectionBlocks.map((block) => block.type), ['heading', 'paragraph', 'pageBreak']);
assert.equal(sectionBlocks[2].id, 'flow_page_break_inserted');

blocks = applyFlowAuthoringOperation(blocks, {
    type: 'moveBlock',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_page_break_inserted',
    delta: -1,
});
assert.deepEqual(blocks[1].flow.document.sections[0].blocks.map((block) => block.type), ['heading', 'pageBreak', 'paragraph']);

const pageBreakRoundTrip = deserializeProject(serializeProject({
    version: 6,
    languages: ['ja', 'en'],
    defaultLang: 'ja',
    blocks,
    sections: [
        { type: 'image', backgrounds: {}, bubbles: [] },
        { type: 'image', backgrounds: {}, bubbles: [] },
    ],
    pages: [],
}));
assert.deepEqual(
    pageBreakRoundTrip.blocks[1].flow.document.sections[0].blocks.map((block) => [block.id, block.type]),
    [['flow_heading_authoring', 'heading'], ['flow_page_break_inserted', 'pageBreak'], ['flow_paragraph_authoring', 'paragraph']],
    'PageBreak identity and order must survive save/reload',
);

blocks = applyFlowAuthoringOperation(blocks, {
    type: 'removeBlock',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_page_break_inserted',
});
assert.deepEqual(blocks[1].flow.document.sections[0].blocks.map((block) => block.type), ['heading', 'paragraph']);
assert.throws(() => applyFlowAuthoringOperation(blocks, {
    type: 'setText',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'missing',
    languageKey: 'ja',
    text: 'lost',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_BLOCK_NOT_FOUND');

const groupRemovalInputJson = JSON.stringify(blocks);
const blocksWithoutFlowGroup = applyFlowAuthoringOperation(blocks, {
    type: 'removeGroup',
    groupId: 'flow_group_authoring',
});
assert.equal(JSON.stringify(blocks), groupRemovalInputJson, 'Flow group removal must not mutate its input');
assert.deepEqual(
    blocksWithoutFlowGroup.map((block) => block.id),
    ['page_before', 'page_after'],
    'Flow group removal must preserve the surrounding authoring spine',
);
assert.equal(blocksWithoutFlowGroup[0].content.futureFixed, 'A');
assert.equal(blocksWithoutFlowGroup[1].content.futureFixed, 'B');
assert.throws(() => applyFlowAuthoringOperation(blocksWithoutFlowGroup, {
    type: 'removeGroup',
    groupId: 'flow_group_authoring',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_GROUP_NOT_FOUND');

resetFlowEditorSelections();
assert.equal(isFlowSourceSelected('flow_group_authoring'), true);
selectFlowGeneratedPage('flow_group_authoring');
assert.equal(getFlowEditorSelection('flow_group_authoring').mode, 'page');
selectFlowSource('flow_group_authoring', {
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
});
assert.deepEqual(getFlowEditorSelection('flow_group_authoring'), {
    mode: 'source',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: '',
    graphemeOffset: null,
    utf16Offset: null,
    affinity: 'nearest',
});
selectFlowSource('flow_group_authoring', {
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    graphemeOffset: 4,
    utf16Offset: 4,
    affinity: 'forward',
});
assert.deepEqual(getFlowEditorSelection('flow_group_authoring'), {
    mode: 'source',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    graphemeOffset: 4,
    utf16Offset: 4,
    affinity: 'forward',
});
selectFlowGeneratedPage('flow_group_authoring');
assert.equal(getFlowEditorSelection('flow_group_authoring').graphemeOffset, 4);
selectFlowDirectEditing('flow_group_authoring', {
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    graphemeOffset: 5,
    utf16Offset: 5,
    affinity: 'forward',
});
assert.equal(isFlowDirectEditing('flow_group_authoring'), true);
assert.equal(isFlowSourceSelected('flow_group_authoring'), false);
assert.deepEqual(getFlowEditorSelection('flow_group_authoring'), {
    mode: 'direct',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    graphemeOffset: 5,
    utf16Offset: 5,
    affinity: 'forward',
});

const persisted = {
    version: 6,
    projectName: 'Flow authoring verify',
    languages: ['ja', 'en'],
    defaultLang: 'ja',
    blocks,
    sections: [
        { type: 'image', backgrounds: {}, bubbles: [] },
        { type: 'image', backgrounds: {}, bubbles: [] },
    ],
    pages: [],
};
const restored = deserializeProject(serializeProject(persisted));
assert.deepEqual(restored.blocks[1], blocks[1], 'semantic Flow source must survive save/reload');
assert.deepEqual(restored.blocks.map((block) => block.id), ['page_before', 'flow_group_authoring', 'page_after']);
assert.equal(restored.blocks[0].content.futureFixed, 'A');
assert.equal(restored.blocks[2].content.futureFixed, 'B');
assert.equal(JSON.stringify(restored).includes('generatedPages'), false);

const stateBackup = structuredClone(state);
try {
    Object.assign(state, {
        version: 6,
        blocks: createFixture(),
        sections: persisted.sections,
        pages: [],
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    });
    clearHistory();
    assert.equal(pushState({ groupKey: 'flow:paragraph', now: 1000, mergeWindowMs: 900 }), true);
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'setText',
        groupId: 'flow_group_authoring',
        sectionId: 'flow_section_authoring',
        blockId: 'flow_paragraph_authoring',
        languageKey: 'ja',
        text: '一文字目',
    });
    assert.equal(pushState({ groupKey: 'flow:paragraph', now: 1500, mergeWindowMs: 900 }), false);
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'setText',
        groupId: 'flow_group_authoring',
        sectionId: 'flow_section_authoring',
        blockId: 'flow_paragraph_authoring',
        languageKey: 'ja',
        text: '一文字目と二文字目',
    });
    assert.equal(getHistoryInfo().undoCount, 1, 'typing burst must create one history snapshot');
    assert.equal(undo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts.ja, '一文字目と二文字目');

    pushState();
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'insertBlock',
        groupId: 'flow_group_authoring',
        sectionId: 'flow_section_authoring',
        afterBlockId: 'flow_paragraph_authoring',
        blockType: 'pageBreak',
        languageKey: 'ja',
    }, { idFactory: () => 'history_page_break' });
    assert.equal(state.blocks[1].flow.document.sections[0].blocks.at(-1).id, 'history_page_break');
    assert.equal(undo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks.some((block) => block.id === 'history_page_break'), false);
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks.at(-1).id, 'history_page_break');

    clearHistory();
    state.version = 5;
    state.blocks = [structuredClone(createFixture()[0])];
    pushState();
    state.version = 6;
    state.blocks = [state.blocks[0], structuredClone(createFixture()[1])];
    assert.equal(undo(() => {}), true);
    assert.equal(state.version, 5, 'Undo must restore the Fixed-only project schema');
    assert.deepEqual(state.blocks.map((block) => block.kind), ['page']);
    assert.equal(redo(() => {}), true);
    assert.equal(state.version, 6, 'Redo must restore the Flow-capable project schema');
    assert.deepEqual(state.blocks.map((block) => block.kind), ['page', 'flow']);

    clearHistory();
    Object.assign(state, {
        version: 6,
        blocks: createFixture(),
        sections: persisted.sections,
        pages: [],
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    });
    pushState();
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'removeGroup',
        groupId: 'flow_group_authoring',
    });
    state.activeBlockIdx = 1;
    assert.deepEqual(state.blocks.map((block) => block.id), ['page_before', 'page_after']);
    assert.equal(undo(() => {}), true);
    assert.deepEqual(
        state.blocks.map((block) => block.id),
        ['page_before', 'flow_group_authoring', 'page_after'],
        'Undo must restore the complete Flow manuscript',
    );
    assert.equal(redo(() => {}), true);
    assert.deepEqual(
        state.blocks.map((block) => block.id),
        ['page_before', 'page_after'],
        'Redo must remove the complete Flow manuscript again',
    );
} finally {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBackup);
    clearHistory();
    resetFlowEditorSelections();
}

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
assert.match(appSource, /const canDeleteFlowSource = isFlowAuthoring;/);
assert.match(appSource, /window\.confirm\(t\('confirm_delete_flow'\)\)/);
assert.match(appSource, /type: 'removeGroup'/);
assert.match(appSource, /resetFlowRuntimeAfterGroupRemoval\(activeBlock\.id\)/);
assert.match(appSource, /flow_delete_generated_title/);
assert.match(i18nSource, /btn_delete_flow:\s+'Flow原稿を削除'/);
assert.match(i18nSource, /Generated pages cannot be deleted individually/);

console.log('Flow authoring verification passed.');
