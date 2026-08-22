import assert from 'node:assert/strict';

import { applyFlowAuthoringOperation, FlowAuthoringError } from '../js/flow-authoring.js';
import {
    getFlowTranslationStatusPresentation,
    renderFlowAuthoringView,
} from '../js/flow-authoring-view.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { resolveFlowRuntimeLanguage } from '../js/flow-runtime-pages.js';
import {
    createFlowTranslationLanguageBaseline,
    deriveFlowTranslationStatus,
} from '../js/flow-translation-state.js';
import { clearHistory, pushState, redo, undo } from '../js/history.js';
import {
    deriveFixedCompatibility,
    deserializeProject,
    serializeProject,
} from '../js/project-persistence.js';
import { state } from '../js/state.js';

let nextId = 0;
const idFactory = (prefix) => `${prefix}_translation_ui_${++nextId}`;
const clone = (value) => structuredClone(value);

const fixed = {
    id: 'fixed_translation_ui',
    kind: 'page',
    futureFixed: { keep: true },
    content: {
        pageKind: 'graphic',
        layers: [{ id: 'layer_translation_ui', type: 'shape', futureLayer: { keep: true } }],
    },
};
const legacyGroup = createFlowGroupBlock({
    id: 'flow_translation_ui',
    sourceLanguage: 'ja',
    idFactory,
    document: {
        id: 'flow_document_translation_ui',
        sourceLanguage: 'ja',
        sections: [{
            id: 'section_translation_ui',
            title: { ja: '第一章', 'en-us': 'Chapter One' },
            blocks: [
                {
                    id: 'heading_translation_ui',
                    type: 'heading',
                    level: 1,
                    texts: { ja: '雪の日', 'en-us': 'Snow Day' },
                },
                {
                    id: 'paragraph_translation_ui',
                    type: 'paragraph',
                    texts: { ja: '冬の金沢は静かだった。', 'en-us': 'Kanazawa was quiet in winter.' },
                },
                { id: 'break_translation_ui', type: 'pageBreak' },
            ],
        }],
    },
    layout: {
        typographyByLanguage: {
            ja: { writingMode: 'vertical-rl', fontFamily: 'Noto Serif JP', fontSize: 18 },
            'en-us': { writingMode: 'horizontal-tb', fontFamily: 'Noto Serif', fontSize: 18 },
        },
    },
});
const originalBlocks = [fixed, legacyGroup];
const originalJson = JSON.stringify(originalBlocks);

const legacyStatus = deriveFlowTranslationStatus(legacyGroup, 'en-us');
assert.equal(legacyStatus.status, 'untracked');
assert.equal(legacyStatus.requiresSourceFallback, false);
assert.equal(resolveFlowRuntimeLanguage(legacyGroup, 'en-us').languageKey, 'en-us');
assert.equal(getFlowTranslationStatusPresentation(legacyStatus).tone, 'info');
assert.equal(JSON.stringify(originalBlocks), originalJson, 'status derivation must not mutate legacy content');

const fakeRoot = {
    innerHTML: '',
    dataset: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
};
renderFlowAuthoringView(fakeRoot, {
    group: legacyGroup,
    languageKey: 'en-us',
    pageCount: 2,
    translationStatus: legacyStatus,
});
assert.equal(fakeRoot.dataset.translationStatus, 'untracked');
assert.equal(fakeRoot.dataset.outlineIssues, 'true');
assert.match(fakeRoot.innerHTML, /data-flow-translation-status-panel/);
assert.match(fakeRoot.innerHTML, /data-testid="flow-translation-confirm"/);
assert.match(fakeRoot.innerHTML, /data-flow-translation-unit-status/);
assert.equal(
    (fakeRoot.innerHTML.match(/data-flow-translation-unit-status/g) || []).length,
    2,
    'PageBreak must not receive a translation-unit status slot',
);
assert.equal(JSON.stringify(originalBlocks), originalJson, 'View rendering must not mutate semantic content');

const sourceEdited = applyFlowAuthoringOperation(originalBlocks, {
    type: 'setText',
    groupId: legacyGroup.id,
    sectionId: 'section_translation_ui',
    blockId: 'paragraph_translation_ui',
    languageKey: 'ja',
    text: '冬の金沢は、とても静かだった。',
});
assert.equal(JSON.stringify(originalBlocks), originalJson, 'source transaction must not mutate input blocks');
const staleGroup = sourceEdited[1];
const staleStatus = deriveFlowTranslationStatus(staleGroup, 'en-us');
assert.equal(staleStatus.status, 'stale');
assert.deepEqual(staleStatus.body.ids.stale, ['paragraph_translation_ui']);
assert.equal(staleStatus.requiresSourceFallback, true);
assert.equal(resolveFlowRuntimeLanguage(staleGroup, 'en-us').languageKey, 'ja');
assert.equal(resolveFlowRuntimeLanguage(staleGroup, 'en-us').isSourceFallback, true);
assert.equal(getFlowTranslationStatusPresentation(staleStatus).tone, 'warning');
assert.equal(
    staleGroup.flow.translationState.languages['en-us'].reviewState,
    'needs-review',
    'automatic pre-edit capture must not claim that a legacy translation was reviewed',
);
const capturedFingerprint = staleGroup.flow.translationState.languages['en-us']
    .sourceFingerprints.blocks.paragraph_translation_ui;

const sourceEditedAgain = applyFlowAuthoringOperation(sourceEdited, {
    type: 'setText',
    groupId: legacyGroup.id,
    sectionId: 'section_translation_ui',
    blockId: 'paragraph_translation_ui',
    languageKey: 'ja',
    text: '冬の金沢は、さらに静かだった。',
});
assert.equal(
    sourceEditedAgain[1].flow.translationState.languages['en-us']
        .sourceFingerprints.blocks.paragraph_translation_ui,
    capturedFingerprint,
    'later source keystrokes must not move the pre-edit baseline',
);

const manuallyUpdated = applyFlowAuthoringOperation(sourceEdited, {
    type: 'setText',
    groupId: legacyGroup.id,
    sectionId: 'section_translation_ui',
    blockId: 'paragraph_translation_ui',
    languageKey: 'en-us',
    text: 'Kanazawa was very quiet in winter.',
});
const manuallyUpdatedStatus = deriveFlowTranslationStatus(manuallyUpdated[1], 'en-us');
assert.deepEqual(manuallyUpdatedStatus.body.ids.stale, []);
assert.deepEqual(manuallyUpdatedStatus.body.ids.current, ['paragraph_translation_ui']);
assert.deepEqual(manuallyUpdatedStatus.body.ids.untracked, ['heading_translation_ui']);
assert.equal(manuallyUpdatedStatus.status, 'untracked');
assert.equal(manuallyUpdatedStatus.requiresSourceFallback, false);
assert.equal(resolveFlowRuntimeLanguage(manuallyUpdated[1], 'en-us').languageKey, 'en-us');

const confirmed = applyFlowAuthoringOperation(sourceEdited, {
    type: 'confirmTranslation',
    groupId: legacyGroup.id,
    languageKey: 'en-us',
});
const confirmedGroup = confirmed[1];
const confirmedStatus = deriveFlowTranslationStatus(confirmedGroup, 'en-us');
assert.equal(confirmedStatus.status, 'reviewed');
assert.equal(confirmedStatus.body.counts.current, 2);
assert.equal(confirmedStatus.outline.counts.current, 1);
assert.equal(confirmedStatus.requiresSourceFallback, false);
assert.equal(resolveFlowRuntimeLanguage(confirmedGroup, 'en-us').languageKey, 'en-us');
assert.equal(getFlowTranslationStatusPresentation(confirmedStatus).tone, 'ready');
assert.deepEqual(confirmed[0], fixed, 'Fixed opaque data must survive confirmation');

const outlineEdited = applyFlowAuthoringOperation(confirmed, {
    type: 'setSectionTitle',
    groupId: legacyGroup.id,
    sectionId: 'section_translation_ui',
    languageKey: 'ja',
    text: '第一章・改訂',
});
const outlineStatus = deriveFlowTranslationStatus(outlineEdited[1], 'en-us');
assert.equal(outlineStatus.status, 'stale');
assert.equal(outlineStatus.body.counts.stale, 0);
assert.equal(outlineStatus.outline.counts.stale, 1);
assert.equal(outlineStatus.requiresSourceFallback, false);
assert.equal(outlineStatus.hasOutlineIssues, true);
assert.equal(resolveFlowRuntimeLanguage(outlineEdited[1], 'en-us').languageKey, 'en-us');
assert.equal(getFlowTranslationStatusPresentation(outlineStatus).tone, 'outline');

const missing = clone(confirmedGroup);
delete missing.flow.document.sections[0].blocks[1].texts['en-us'];
const missingStatus = deriveFlowTranslationStatus(missing, 'en-us');
assert.equal(missingStatus.status, 'partial');
assert.equal(missingStatus.body.counts.missing, 1);
assert.equal(missingStatus.requiresSourceFallback, true);
assert.equal(resolveFlowRuntimeLanguage(missing, 'en-us').languageKey, 'ja');

const machineGroup = clone(legacyGroup);
machineGroup.flow.translationState = {
    schemaVersion: 1,
    languages: {
        'en-us': {
            ...createFlowTranslationLanguageBaseline(machineGroup, 'en-us', {
                origin: 'machine',
                reviewState: 'needs-review',
            }),
            futureLanguageState: { keep: true },
        },
    },
    futureState: { keep: true },
};
const mixedBlocks = applyFlowAuthoringOperation([fixed, machineGroup], {
    type: 'setText',
    groupId: legacyGroup.id,
    sectionId: 'section_translation_ui',
    blockId: 'paragraph_translation_ui',
    languageKey: 'en-us',
    text: 'A manually refined machine translation.',
});
const mixedState = mixedBlocks[1].flow.translationState;
assert.equal(mixedState.languages['en-us'].origin, 'mixed');
assert.equal(mixedState.languages['en-us'].reviewState, 'needs-review');
assert.deepEqual(mixedState.languages['en-us'].lockedUnitIds, ['paragraph_translation_ui']);
assert.deepEqual(mixedState.languages['en-us'].futureLanguageState, { keep: true });
assert.deepEqual(mixedState.futureState, { keep: true });

const machineUntrackedGroup = clone(machineGroup);
machineUntrackedGroup.flow.translationState.languages['en-us'].sourceFingerprints.futureMap = {
    keep: true,
};
delete machineUntrackedGroup.flow.translationState.languages['en-us']
    .sourceFingerprints.blocks.paragraph_translation_ui;
const machineUntrackedBefore = deriveFlowTranslationStatus(machineUntrackedGroup, 'en-us');
assert.deepEqual(machineUntrackedBefore.body.ids.untracked, ['paragraph_translation_ui']);
assert.ok(machineUntrackedBefore.body.ids.locked.includes('paragraph_translation_ui'));
const machineConfirmed = applyFlowAuthoringOperation([fixed, machineUntrackedGroup], {
    type: 'confirmTranslation',
    groupId: legacyGroup.id,
    languageKey: 'en-us',
});
const machineConfirmedState = machineConfirmed[1].flow.translationState.languages['en-us'];
assert.equal(machineConfirmedState.origin, 'mixed');
assert.ok(machineConfirmedState.lockedUnitIds.includes('paragraph_translation_ui'));
assert.deepEqual(machineConfirmedState.sourceFingerprints.futureMap, { keep: true });
assert.equal(deriveFlowTranslationStatus(machineConfirmed[1], 'en-us').status, 'reviewed');

const allMissingNeedsReview = clone(machineGroup);
delete allMissingNeedsReview.flow.document.sections[0].title['en-us'];
delete allMissingNeedsReview.flow.document.sections[0].blocks[0].texts['en-us'];
delete allMissingNeedsReview.flow.document.sections[0].blocks[1].texts['en-us'];
const allMissingPresentation = getFlowTranslationStatusPresentation(
    deriveFlowTranslationStatus(allMissingNeedsReview, 'en-us'),
);
assert.equal(allMissingPresentation.confirmable, false);

const emptyPresentation = getFlowTranslationStatusPresentation({
    isSourceLanguage: false,
    status: 'empty',
    body: { counts: { present: 0 }, ids: {} },
    outline: { counts: { present: 0 }, ids: {} },
    reviewState: null,
});
assert.equal(emptyPresentation.summary, '翻訳対象なし');
assert.equal(emptyPresentation.confirmable, false);

assert.throws(
    () => applyFlowAuthoringOperation(originalBlocks, {
        type: 'setText',
        groupId: legacyGroup.id,
        sectionId: 'missing_section',
        blockId: 'paragraph_translation_ui',
        languageKey: 'ja',
        text: '到達しない',
    }),
    (error) => error instanceof FlowAuthoringError
        && error.code === 'FLOW_SECTION_NOT_FOUND'
        && error.context.groupId === legacyGroup.id,
);

const persistedProject = {
    version: 6,
    projectName: 'Flow translation UI verification',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    languageConfigs: {
        ja: { writingMode: 'vertical-rl', pageDirection: 'rtl' },
        'en-us': { writingMode: 'horizontal-tb', pageDirection: 'ltr' },
    },
    blocks: confirmed,
    sections: deriveFixedCompatibility(confirmed).sections,
    pages: [],
};
const restored = deserializeProject(serializeProject(persistedProject));
assert.equal(deriveFlowTranslationStatus(restored.blocks[1], 'en-us').status, 'reviewed');
assert.deepEqual(restored.blocks[0].content.layers, fixed.content.layers);

const stateBeforeHistory = structuredClone(state);
try {
    Object.assign(state, {
        ...persistedProject,
        blocks: clone(originalBlocks),
        sections: deriveFixedCompatibility(originalBlocks).sections,
        activeLang: 'ja',
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    });
    clearHistory();
    pushState();
    state.blocks = clone(sourceEdited);
    assert.equal(deriveFlowTranslationStatus(state.blocks[1], 'en-us').status, 'stale');
    assert.equal(undo(() => {}), true);
    assert.equal(state.blocks[1].flow.translationState, undefined);
    assert.equal(
        state.blocks[1].flow.document.sections[0].blocks[1].texts.ja,
        '冬の金沢は静かだった。',
    );
    assert.equal(redo(() => {}), true);
    assert.equal(deriveFlowTranslationStatus(state.blocks[1], 'en-us').status, 'stale');

    clearHistory();
    state.blocks = clone(sourceEdited);
    pushState();
    state.blocks = clone(confirmed);
    assert.equal(deriveFlowTranslationStatus(state.blocks[1], 'en-us').status, 'reviewed');
    assert.equal(undo(() => {}), true);
    assert.equal(deriveFlowTranslationStatus(state.blocks[1], 'en-us').status, 'stale');
    assert.equal(redo(() => {}), true);
    assert.equal(deriveFlowTranslationStatus(state.blocks[1], 'en-us').status, 'reviewed');
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBeforeHistory);
}

console.log('Flow translation UI verification passed.');
