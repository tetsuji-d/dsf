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
import { deriveFlowTranslationStatus } from '../js/flow-translation-state.js';
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

function createMergeFixture(options = {}) {
    const blocks = createFixture();
    blocks[1].flow.document.sections[0].blocks.push({
        id: 'flow_paragraph_merge_current',
        type: 'paragraph',
        texts: {
            ja: '神谷はコートを手に取った。',
            ...(options.includeTranslation ? { en: options.translationText ?? 'Kamiya picked up his coat.' } : {}),
        },
        futureMergeParagraph: { keep: true },
    });
    return blocks;
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

const splitInput = createFixture();
const splitInputJson = JSON.stringify(splitInput);
const splitOffset = '冬の金沢は'.length;
const splitBlocks = applyFlowAuthoringOperation(splitInput, {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    utf16Offset: splitOffset,
    newBlockId: 'flow_paragraph_after_split',
});
const splitSectionBlocks = splitBlocks[1].flow.document.sections[0].blocks;
assert.equal(JSON.stringify(splitInput), splitInputJson, 'Paragraph split must not mutate input');
assert.deepEqual(splitBlocks[0], splitInput[0], 'Paragraph split must preserve the Fixed prefix');
assert.deepEqual(splitBlocks[2], splitInput[2], 'Paragraph split must preserve the Fixed suffix');
assert.deepEqual(splitSectionBlocks.map((block) => block.type), ['heading', 'paragraph', 'paragraph']);
assert.equal(splitSectionBlocks[1].id, 'flow_paragraph_authoring', 'The leading Paragraph keeps its identity');
assert.equal(splitSectionBlocks[1].texts.ja, '冬の金沢は');
assert.equal(splitSectionBlocks[1].texts.en, 'Kanazawa was quiet in winter.', 'Existing translation is not guessed or split');
assert.deepEqual(splitSectionBlocks[1].futureParagraph, { keep: true });
assert.equal(splitSectionBlocks[2].id, 'flow_paragraph_after_split');
assert.equal(splitSectionBlocks[2].texts.ja, '静かだった。');
assert.equal(Object.hasOwn(splitSectionBlocks[2].texts, 'en'), false, 'The new Paragraph starts untranslated');
const splitTranslationStatus = deriveFlowTranslationStatus(splitBlocks[1], 'en');
assert.equal(splitTranslationStatus.status, 'partial');
assert.equal(splitTranslationStatus.requiresSourceFallback, true);
assert.deepEqual(splitTranslationStatus.body.ids.stale, ['flow_paragraph_authoring']);
assert.deepEqual(splitTranslationStatus.body.ids.missing, ['flow_paragraph_after_split']);

const splitRoundTrip = deserializeProject(serializeProject({
    version: 6,
    languages: ['ja', 'en'],
    defaultLang: 'ja',
    blocks: splitBlocks,
    sections: [
        { type: 'image', backgrounds: {}, bubbles: [] },
        { type: 'image', backgrounds: {}, bubbles: [] },
    ],
    pages: [],
}));
assert.deepEqual(
    splitRoundTrip.blocks[1].flow.document.sections[0].blocks,
    splitSectionBlocks,
    'Both semantic Paragraphs must survive save/reload',
);
assert.throws(() => applyFlowAuthoringOperation(createFixture(), {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_heading_authoring',
    languageKey: 'ja',
    utf16Offset: 1,
    newBlockId: 'flow_heading_split_rejected',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_BLOCK_NOT_PARAGRAPH');
assert.throws(() => applyFlowAuthoringOperation(createFixture(), {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'en',
    utf16Offset: 1,
    newBlockId: 'flow_translation_split_rejected',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_SPLIT_SOURCE_LANGUAGE_ONLY');
assert.throws(() => applyFlowAuthoringOperation(createFixture(), {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    utf16Offset: 1,
    newBlockId: 'flow_heading_authoring',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_BLOCK_ID_CONFLICT');
const graphemeSplitInput = createFixture();
graphemeSplitInput[1].flow.document.sections[0].blocks[1].texts.ja = '雪👩‍💻の日';
assert.throws(() => applyFlowAuthoringOperation(graphemeSplitInput, {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    utf16Offset: 2,
    newBlockId: 'flow_mid_grapheme_rejected',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_SPLIT_GRAPHEME_BOUNDARY_REQUIRED');
const missingSourceSplitInput = createFixture();
delete missingSourceSplitInput[1].flow.document.sections[0].blocks[1].texts.ja;
const missingSourceSplitBlocks = applyFlowAuthoringOperation(missingSourceSplitInput, {
    type: 'splitParagraph',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
    utf16Offset: 0,
    newBlockId: 'flow_missing_source_after_split',
});
assert.deepEqual(
    missingSourceSplitBlocks[1].flow.document.sections[0].blocks.slice(1).map((block) => block.texts.ja),
    ['', ''],
    'A valid source-missing empty Paragraph must still split safely',
);

const mergeInput = createMergeFixture();
const mergeInputJson = JSON.stringify(mergeInput);
const mergedBlocks = applyFlowAuthoringOperation(mergeInput, {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_merge_current',
    languageKey: 'ja',
});
const mergedSectionBlocks = mergedBlocks[1].flow.document.sections[0].blocks;
assert.equal(JSON.stringify(mergeInput), mergeInputJson, 'Paragraph merge must not mutate input');
assert.deepEqual(mergedBlocks[0], mergeInput[0], 'Paragraph merge must preserve the Fixed prefix');
assert.deepEqual(mergedBlocks[2], mergeInput[2], 'Paragraph merge must preserve the Fixed suffix');
assert.deepEqual(mergedSectionBlocks.map((block) => block.type), ['heading', 'paragraph']);
assert.equal(mergedSectionBlocks[1].id, 'flow_paragraph_authoring', 'The preceding Paragraph keeps its identity');
assert.equal(
    mergedSectionBlocks[1].texts.ja,
    '冬の金沢は静かだった。神谷はコートを手に取った。',
    'Removing the Paragraph boundary must concatenate source text without guessing a separator',
);
assert.equal(
    mergedSectionBlocks[1].texts.en,
    'Kanazawa was quiet in winter.',
    'The preceding Paragraph translation must be retained',
);
assert.deepEqual(mergedSectionBlocks[1].futureParagraph, { keep: true });
assert.equal(
    mergedSectionBlocks.some((block) => block.id === 'flow_paragraph_merge_current'),
    false,
    'The current Paragraph must be removed after merging',
);
const mergeTranslationStatus = deriveFlowTranslationStatus(mergedBlocks[1], 'en');
assert.deepEqual(mergeTranslationStatus.body.ids.stale, ['flow_paragraph_authoring']);

const mergeRoundTrip = deserializeProject(serializeProject({
    version: 6,
    languages: ['ja', 'en'],
    defaultLang: 'ja',
    blocks: mergedBlocks,
    sections: [
        { type: 'image', backgrounds: {}, bubbles: [] },
        { type: 'image', backgrounds: {}, bubbles: [] },
    ],
    pages: [],
}));
assert.deepEqual(
    mergeRoundTrip.blocks[1].flow.document.sections[0].blocks,
    mergedSectionBlocks,
    'Merged semantic Paragraph structure must survive save/reload',
);

assert.throws(() => applyFlowAuthoringOperation(createMergeFixture({
    includeTranslation: true,
    translationText: '',
}), {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_merge_current',
    languageKey: 'ja',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_MERGE_TRANSLATION_DATA_PRESENT');
assert.throws(() => applyFlowAuthoringOperation(createFixture(), {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_authoring',
    languageKey: 'ja',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_PREVIOUS_PARAGRAPH_REQUIRED');
const pageBreakMergeInput = createMergeFixture();
pageBreakMergeInput[1].flow.document.sections[0].blocks.splice(-1, 0, {
    id: 'flow_merge_page_break',
    type: 'pageBreak',
});
assert.throws(() => applyFlowAuthoringOperation(pageBreakMergeInput, {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_merge_current',
    languageKey: 'ja',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_PREVIOUS_PARAGRAPH_REQUIRED');
assert.throws(() => applyFlowAuthoringOperation(createMergeFixture(), {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_merge_current',
    languageKey: 'en',
}), (error) => error instanceof FlowAuthoringError && error.code === 'FLOW_MERGE_SOURCE_LANGUAGE_ONLY');
const missingSourceMergeInput = createMergeFixture();
delete missingSourceMergeInput[1].flow.document.sections[0].blocks[1].texts.ja;
delete missingSourceMergeInput[1].flow.document.sections[0].blocks[2].texts.ja;
const missingSourceMergedBlocks = applyFlowAuthoringOperation(missingSourceMergeInput, {
    type: 'mergeParagraphBackward',
    groupId: 'flow_group_authoring',
    sectionId: 'flow_section_authoring',
    blockId: 'flow_paragraph_merge_current',
    languageKey: 'ja',
});
assert.equal(
    missingSourceMergedBlocks[1].flow.document.sections[0].blocks[1].texts.ja,
    '',
    'Valid source-missing Paragraphs must merge as empty source strings',
);

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
    state.blocks = createFixture();
    pushState();
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'splitParagraph',
        groupId: 'flow_group_authoring',
        sectionId: 'flow_section_authoring',
        blockId: 'flow_paragraph_authoring',
        languageKey: 'ja',
        utf16Offset: splitOffset,
        newBlockId: 'history_paragraph_split',
    });
    assert.deepEqual(
        state.blocks[1].flow.document.sections[0].blocks.map((block) => block.id),
        ['flow_heading_authoring', 'flow_paragraph_authoring', 'history_paragraph_split'],
    );
    assert.equal(undo(() => {}), true, 'Paragraph split must undo as one project transaction');
    assert.deepEqual(
        state.blocks[1].flow.document.sections[0].blocks.map((block) => block.id),
        ['flow_heading_authoring', 'flow_paragraph_authoring'],
    );
    assert.equal(redo(() => {}), true, 'Paragraph split must redo as one project transaction');
    assert.equal(state.blocks[1].flow.document.sections[0].blocks.at(-1).id, 'history_paragraph_split');

    clearHistory();
    state.blocks = createMergeFixture();
    pushState();
    state.blocks = applyFlowAuthoringOperation(state.blocks, {
        type: 'mergeParagraphBackward',
        groupId: 'flow_group_authoring',
        sectionId: 'flow_section_authoring',
        blockId: 'flow_paragraph_merge_current',
        languageKey: 'ja',
    });
    assert.equal(getHistoryInfo().undoCount, 1, 'Paragraph merge must create one history snapshot');
    assert.deepEqual(
        state.blocks[1].flow.document.sections[0].blocks.map((block) => block.id),
        ['flow_heading_authoring', 'flow_paragraph_authoring'],
    );
    assert.equal(undo(() => {}), true, 'Paragraph merge must undo as one project transaction');
    assert.deepEqual(
        state.blocks[1].flow.document.sections[0].blocks.map((block) => block.id),
        ['flow_heading_authoring', 'flow_paragraph_authoring', 'flow_paragraph_merge_current'],
    );
    assert.equal(redo(() => {}), true, 'Paragraph merge must redo as one project transaction');
    assert.equal(
        state.blocks[1].flow.document.sections[0].blocks.some((block) => block.id === 'flow_paragraph_merge_current'),
        false,
    );

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
