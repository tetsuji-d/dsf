import assert from 'node:assert/strict';

import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
import { renderFlowAuthoringView } from '../js/flow-authoring-view.js';
import {
    ensureFlowLanguageTypography,
    getFlowLanguageProgress,
    getFlowSourceLanguageGroupIds,
    resolveFlowAuthoringLanguage,
} from '../js/flow-multilingual-authoring.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { resolveFlowRuntimeLanguage } from '../js/flow-runtime-pages.js';
import { clearHistory, pushState, redo, undo } from '../js/history.js';
import {
    deriveFixedCompatibility,
    deserializeProject,
    serializeProject,
} from '../js/project-persistence.js';
import { state } from '../js/state.js';

let nextId = 0;
const idFactory = (prefix) => `${prefix}_multilingual_${++nextId}`;

const fixed = {
    id: 'fixed_opaque',
    kind: 'page',
    futureFixed: { preserve: true },
    content: {
        pageKind: 'graphic',
        layers: [{ id: 'layer_opaque', type: 'shape', futureLayer: { preserve: true } }],
        futureContent: { preserve: true },
    },
};
const flow = createFlowGroupBlock({
    id: 'flow_multilingual',
    sourceLanguage: 'ja',
    idFactory,
    document: {
        id: 'flow_document_multilingual',
        sourceLanguage: 'ja',
        sections: [{
            id: 'flow_section_multilingual',
            title: { ja: '第一章' },
            blocks: [
                { id: 'flow_heading_multilingual', type: 'heading', level: 1, texts: { ja: '雪の日' } },
                { id: 'flow_paragraph_multilingual', type: 'paragraph', texts: { ja: '冬の金沢は静かだった。' } },
                { id: 'flow_page_break_multilingual', type: 'pageBreak' },
            ],
        }],
    },
    layout: {
        typographyByLanguage: {
            ja: {
                writingMode: 'vertical-rl',
                fontFamily: 'Noto Serif JP',
                fontSize: 18,
                lineHeight: 1.8,
                textColor: '#241f1a',
                futureStyle: { preserve: true },
            },
        },
    },
});
const originalBlocks = [fixed, flow];
const originalJson = JSON.stringify(originalBlocks);

assert.equal(resolveFlowAuthoringLanguage(flow, 'en-us', ['ja', 'en-us']), 'en-us');
assert.equal(resolveFlowAuthoringLanguage(flow, 'en-US', ['ja', 'en-us']), 'ja');
assert.equal(resolveFlowAuthoringLanguage(flow, '', ['ja', 'en-us']), 'ja');
assert.equal(JSON.stringify(originalBlocks), originalJson, 'language resolution must not mutate source');

assert.deepEqual(getFlowLanguageProgress(flow, 'en-us'), {
    languageKey: 'en-us',
    sourceLanguage: 'ja',
    isSourceLanguage: false,
    total: 2,
    completed: 0,
    missing: 2,
    hasAny: false,
    complete: false,
});
assert.equal(Object.hasOwn(flow.flow.document.sections[0].blocks[0].texts, 'en-us'), false);
assert.equal(JSON.stringify(originalBlocks), originalJson, 'progress inspection must not seed target text');

let blocks = applyFlowAuthoringOperation(originalBlocks, {
    type: 'setText',
    groupId: 'flow_multilingual',
    sectionId: 'flow_section_multilingual',
    blockId: 'flow_heading_multilingual',
    languageKey: 'en-us',
    text: 'Snow Day',
});
blocks = applyFlowAuthoringOperation(blocks, {
    type: 'setSectionTitle',
    groupId: 'flow_multilingual',
    sectionId: 'flow_section_multilingual',
    languageKey: 'en-us',
    text: 'Chapter One',
});
const partialGroup = blocks[1];
assert.equal(partialGroup.flow.document.sections[0].blocks[0].texts.ja, '雪の日');
assert.equal(partialGroup.flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
assert.deepEqual(partialGroup.flow.document.sections[0].blocks.map((block) => block.id), [
    'flow_heading_multilingual',
    'flow_paragraph_multilingual',
    'flow_page_break_multilingual',
]);
assert.equal(Object.hasOwn(partialGroup.flow.document.sections[0].blocks[2], 'texts'), false);
assert.deepEqual(blocks[0], fixed, 'opaque Fixed content and layers must survive target edits');
assert.equal(getFlowLanguageProgress(partialGroup, 'en-us').completed, 1);
assert.equal(getFlowLanguageProgress(partialGroup, 'en-us').complete, false);
assert.equal(resolveFlowRuntimeLanguage(partialGroup, 'en-us').languageKey, 'ja');
assert.equal(resolveFlowRuntimeLanguage(partialGroup, 'en-us').isSourceFallback, true);

function createViewRoot() {
    return {
        innerHTML: '',
        dataset: {},
        querySelectorAll() { return []; },
    };
}

const partialBeforeView = JSON.stringify(partialGroup);
const translationRoot = createViewRoot();
renderFlowAuthoringView(translationRoot, {
    group: partialGroup,
    languageKey: 'en-us',
    pageCount: 2,
});
assert.equal(translationRoot.dataset.authoringMode, 'translation');
assert.equal(translationRoot.dataset.languageKey, 'en-us');
assert.equal(translationRoot.dataset.sourceLanguage, 'ja');
assert.match(translationRoot.innerHTML, /FLOW TRANSLATION/);
assert.match(translationRoot.innerHTML, /data-flow-page-break="true"/);
assert.match(translationRoot.innerHTML, /ここで改ページ（原稿と共通）/);
assert.match(translationRoot.innerHTML, /flow-authoring-translation-lock/);
assert.match(translationRoot.innerHTML, /is-translation-missing/);
assert.doesNotMatch(translationRoot.innerHTML, /data-flow-action="insert"/);
assert.doesNotMatch(translationRoot.innerHTML, /data-flow-action="move"/);
assert.doesNotMatch(translationRoot.innerHTML, /data-flow-action="remove"/);
assert.doesNotMatch(translationRoot.innerHTML, /data-flow-field="heading-level"/);
assert.equal(JSON.stringify(partialGroup), partialBeforeView, 'translation View must not mutate semantic source');

const sourceRoot = createViewRoot();
renderFlowAuthoringView(sourceRoot, {
    group: flow,
    languageKey: 'ja',
    pageCount: 1,
});
assert.equal(sourceRoot.dataset.authoringMode, 'source');
assert.match(sourceRoot.innerHTML, /FLOW SOURCE/);
assert.match(sourceRoot.innerHTML, /data-flow-action="insert"/);
assert.match(sourceRoot.innerHTML, /data-flow-action="move"/);
assert.match(sourceRoot.innerHTML, /data-flow-action="remove"/);
assert.match(sourceRoot.innerHTML, /data-flow-field="heading-level"/);

const beforeEnsure = JSON.stringify(blocks);
const ensured = ensureFlowLanguageTypography(blocks, {
    groupId: 'flow_multilingual',
    languageKey: 'en-us',
    writingMode: 'horizontal-tb',
});
assert.equal(ensured.changed, true);
assert.notEqual(ensured.blocks, blocks);
assert.equal(JSON.stringify(blocks), beforeEnsure, 'typography ensure must not mutate input');
assert.deepEqual(ensured.profile, {
    writingMode: 'horizontal-tb',
    fontFamily: 'Noto Serif JP',
    fontSize: 18,
    lineHeight: 1.8,
    textColor: '#241f1a',
    futureStyle: { preserve: true },
});
assert.deepEqual(ensured.blocks[0], fixed, 'opaque Fixed data must survive typography creation');
assert.equal(
    Object.hasOwn(ensured.blocks[1].flow.document.sections[0].blocks[1].texts, 'en-us'),
    false,
    'typography creation must not seed untranslated text',
);

const idempotent = ensureFlowLanguageTypography(ensured.blocks, {
    groupId: 'flow_multilingual',
    languageKey: 'en-us',
    writingMode: 'horizontal-tb',
});
assert.equal(idempotent.changed, false);
assert.equal(idempotent.blocks, ensured.blocks);
assert.deepEqual(idempotent.profile, ensured.profile);

blocks = applyFlowAuthoringOperation(ensured.blocks, {
    type: 'setText',
    groupId: 'flow_multilingual',
    sectionId: 'flow_section_multilingual',
    blockId: 'flow_paragraph_multilingual',
    languageKey: 'en-us',
    text: '  Kanazawa was quiet in winter.  ',
});
const completeGroup = blocks[1];
assert.deepEqual(getFlowLanguageProgress(completeGroup, 'en-us'), {
    languageKey: 'en-us',
    sourceLanguage: 'ja',
    isSourceLanguage: false,
    total: 2,
    completed: 2,
    missing: 0,
    hasAny: true,
    complete: true,
});
assert.deepEqual(resolveFlowRuntimeLanguage(completeGroup, 'en-us'), {
    requestedLanguageKey: 'en-us',
    languageKey: 'en-us',
    profile: completeGroup.flow.layout.typographyByLanguage['en-us'],
    isSourceFallback: false,
});
assert.equal(completeGroup.flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
assert.equal(completeGroup.flow.document.sections[0].blocks[1].texts['en-us'], '  Kanazawa was quiet in winter.  ');
assert.equal(Object.hasOwn(completeGroup.flow.document.sections[0].blocks[2], 'texts'), false);
assert.deepEqual(blocks[0].content.layers, fixed.content.layers);

const persistenceInput = {
    version: 6,
    projectName: 'Flow multilingual verification',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    languageConfigs: {
        ja: { writingMode: 'vertical-rl', pageDirection: 'rtl' },
        'en-us': { writingMode: 'horizontal-tb', pageDirection: 'ltr' },
    },
    blocks,
    sections: deriveFixedCompatibility(blocks).sections,
    pages: [],
};
const persistenceBefore = JSON.stringify(persistenceInput);
const restored = deserializeProject(serializeProject(persistenceInput));
assert.equal(JSON.stringify(persistenceInput), persistenceBefore, 'save preparation must not mutate multilingual input');
assert.equal(restored.blocks[1].flow.document.sections[0].title['en-us'], 'Chapter One');
assert.equal(restored.blocks[1].flow.document.sections[0].blocks[0].texts['en-us'], 'Snow Day');
assert.equal(
    restored.blocks[1].flow.document.sections[0].blocks[1].texts['en-us'],
    '  Kanazawa was quiet in winter.  ',
);
assert.equal(restored.blocks[1].flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
assert.deepEqual(
    restored.blocks[1].flow.document.sections[0].blocks.map((block) => [block.id, block.type]),
    [
        ['flow_heading_multilingual', 'heading'],
        ['flow_paragraph_multilingual', 'paragraph'],
        ['flow_page_break_multilingual', 'pageBreak'],
    ],
);
assert.equal(Object.hasOwn(restored.blocks[1].flow.document.sections[0].blocks[2], 'texts'), false);
assert.deepEqual(restored.blocks[1].flow.layout.typographyByLanguage['en-us'], ensured.profile);
assert.deepEqual(restored.blocks[0].content.layers, fixed.content.layers);
assert.equal(JSON.stringify(restored).includes('generatedPages'), false);

const stateBeforeHistory = structuredClone(state);
try {
    Object.assign(state, {
        version: 6,
        languages: ['ja', 'en-us'],
        defaultLang: 'ja',
        activeLang: 'en-us',
        languageConfigs: persistenceInput.languageConfigs,
        blocks: structuredClone(originalBlocks),
        sections: deriveFixedCompatibility(originalBlocks).sections,
        pages: [],
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    });
    clearHistory();
    pushState({ groupKey: 'flow:translation:en-us' });
    const withTargetTypography = ensureFlowLanguageTypography(state.blocks, {
        groupId: 'flow_multilingual',
        languageKey: 'en-us',
        writingMode: 'horizontal-tb',
    }).blocks;
    state.blocks = applyFlowAuthoringOperation(withTargetTypography, {
        type: 'setText',
        groupId: 'flow_multilingual',
        sectionId: 'flow_section_multilingual',
        blockId: 'flow_paragraph_multilingual',
        languageKey: 'en-us',
        text: 'Translated for Undo',
    });
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts['en-us'], 'Translated for Undo');
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
    assert.equal(state.blocks[1].flow.layout.typographyByLanguage['en-us'].writingMode, 'horizontal-tb');
    assert.equal(undo(() => {}), true);
    assert.equal(Object.hasOwn(state.blocks[1].flow.document.sections[0].blocks[1].texts, 'en-us'), false);
    assert.equal(Object.hasOwn(state.blocks[1].flow.layout.typographyByLanguage, 'en-us'), false);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts.ja, '冬の金沢は静かだった。');
    assert.deepEqual(state.blocks[0].content.layers, fixed.content.layers);
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[1].texts['en-us'], 'Translated for Undo');
    assert.equal(state.blocks[1].flow.layout.typographyByLanguage['en-us'].writingMode, 'horizontal-tb');
    assert.deepEqual(state.blocks[1].flow.document.sections[0].blocks.map((block) => block.id), [
        'flow_heading_multilingual',
        'flow_paragraph_multilingual',
        'flow_page_break_multilingual',
    ]);
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBeforeHistory);
}

const englishSource = createFlowGroupBlock({
    id: 'flow_english_source',
    sourceLanguage: 'en-us',
    idFactory,
    document: {
        id: 'flow_document_english_source',
        sourceLanguage: 'en-us',
        sections: [{
            id: 'flow_section_english_source',
            title: { 'en-us': 'English source' },
            blocks: [{ id: 'flow_paragraph_english_source', type: 'paragraph', texts: { 'en-us': 'Body' } }],
        }],
    },
    writingMode: 'horizontal-tb',
});
const guardedBlocks = [...blocks, englishSource];
const guardedBefore = JSON.stringify(guardedBlocks);
assert.deepEqual(getFlowSourceLanguageGroupIds(guardedBlocks, 'ja'), ['flow_multilingual']);
assert.deepEqual(getFlowSourceLanguageGroupIds(guardedBlocks, 'en-us'), ['flow_english_source']);
assert.deepEqual(getFlowSourceLanguageGroupIds(guardedBlocks, 'en-US'), []);
assert.equal(JSON.stringify(guardedBlocks), guardedBefore, 'source-language guard must not mutate blocks');

assert.throws(
    () => ensureFlowLanguageTypography(blocks, {
        groupId: 'flow_multilingual',
        languageKey: 'en-us',
        writingMode: 'vertical-rl',
    }),
    RangeError,
);
const invalidProjectBlocks = structuredClone(blocks);
delete invalidProjectBlocks[1].flow.document.id;
assert.throws(
    () => ensureFlowLanguageTypography(invalidProjectBlocks, {
        groupId: 'flow_multilingual',
        languageKey: 'en-us',
        writingMode: 'horizontal-tb',
    }),
    (error) => error?.code === 'FLOW_PROJECT_INVALID',
);

console.log('Flow multilingual authoring verification passed.');
