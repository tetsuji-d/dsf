import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { clearHistory, getHistoryInfo, pushState, redo, undo } from '../js/history.js';
import { ensureFlowLanguageTypography } from '../js/flow-multilingual-authoring.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import {
    createFlowRuntimeProjectionSignature,
    resolveFlowRuntimeLanguage,
} from '../js/flow-runtime-pages.js';
import { deserializeProject, serializeProject } from '../js/project-persistence.js';
import { state } from '../js/state.js';

function createFixture() {
    const fixed = { id: 'fixed_before_mode', kind: 'page', content: { pageKind: 'image', futureFixed: true } };
    const flow = createFlowGroupBlock({
        id: 'flow_mode_switch',
        sourceLanguage: 'ja',
        writingMode: 'vertical-rl',
        flowExtensions: { futureFlow: { keep: true } },
        layout: {
            futureLayout: { keep: true },
            typographyByLanguage: {
                ja: {
                    writingMode: 'vertical-rl',
                    fontFamily: 'Noto Serif JP',
                    fontSize: 16,
                    lineHeight: 1.625,
                    futureStyle: { keep: true },
                },
                'en-us': {
                    writingMode: 'horizontal-tb',
                    fontFamily: 'Noto Sans JP',
                    futureTranslationStyle: { keep: true },
                },
            },
        },
        document: {
            id: 'flow_document_mode_switch',
            sourceLanguage: 'ja',
            sections: [{
                id: 'flow_section_mode_switch',
                title: { ja: '第一章', 'en-us': 'Chapter One' },
                blocks: [
                    {
                        id: 'flow_heading_mode_switch',
                        type: 'heading',
                        level: 1,
                        texts: { ja: '雪の日', 'en-us': 'Snow Day' },
                    },
                    {
                        id: 'flow_paragraph_mode_switch',
                        type: 'paragraph',
                        texts: {
                            ja: '冬の金沢は静かだった。'.repeat(80),
                            'en-us': 'Kanazawa was quiet in winter. '.repeat(40),
                        },
                    },
                    { id: 'flow_page_break_mode_switch', type: 'pageBreak' },
                ],
            }],
        },
    });
    return [fixed, flow];
}

function createProject(blocks) {
    return {
        version: 6,
        projectName: 'Flow writing mode switch verification',
        languages: ['ja', 'en-us'],
        defaultLang: 'ja',
        activeLang: 'ja',
        languageConfigs: {
            ja: { pageDirection: 'rtl' },
            'en-us': { pageDirection: 'ltr' },
        },
        blocks,
        sections: [{ type: 'image', backgrounds: {}, bubbles: [] }],
        pages: [],
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    };
}

const originalBlocks = createFixture();
const originalJson = JSON.stringify(originalBlocks);
const originalFlow = originalBlocks[1];
const originalEnglishProfile = structuredClone(originalFlow.flow.layout.typographyByLanguage['en-us']);
const originalDocument = structuredClone(originalFlow.flow.document);
const originalLanguageConfigs = structuredClone(createProject(originalBlocks).languageConfigs);
const ownerDocument = {};
const verticalSignature = createFlowRuntimeProjectionSignature(
    createProject(originalBlocks), 'ja', [], ownerDocument, 'writing-mode-switch',
);

const horizontal = ensureFlowLanguageTypography(originalBlocks, {
    groupId: 'flow_mode_switch',
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
});
assert.equal(horizontal.changed, true);
assert.equal(JSON.stringify(originalBlocks), originalJson, 'mode switch must not mutate the input project');
assert.equal(horizontal.blocks[1].flow.layout.typographyByLanguage.ja.writingMode, 'horizontal-tb');
assert.equal(horizontal.blocks[1].flow.layout.typographyByLanguage.ja.fontFamily, 'Noto Serif JP');
assert.deepEqual(horizontal.blocks[1].flow.layout.typographyByLanguage.ja.futureStyle, { keep: true });
assert.deepEqual(horizontal.blocks[1].flow.layout.typographyByLanguage['en-us'], originalEnglishProfile);
assert.deepEqual(horizontal.blocks[1].flow.document, originalDocument, 'semantic source and translations must remain exact');
assert.deepEqual(horizontal.blocks[1].flow.futureFlow, { keep: true });
assert.deepEqual(horizontal.blocks[1].flow.layout.futureLayout, { keep: true });
assert.deepEqual(createProject(horizontal.blocks).languageConfigs, originalLanguageConfigs,
    'Flow writing mode must not rewrite project pageDirection');
assert.equal(resolveFlowRuntimeLanguage(horizontal.blocks[1], 'ja').profile.writingMode, 'horizontal-tb');
const horizontalSignature = createFlowRuntimeProjectionSignature(
    createProject(horizontal.blocks), 'ja', [], ownerDocument, 'writing-mode-switch',
);
assert.notEqual(horizontalSignature, verticalSignature,
    'runtime projection signature must change so old writing-mode pages cannot be reused');

const noOp = ensureFlowLanguageTypography(horizontal.blocks, {
    groupId: 'flow_mode_switch',
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
});
assert.equal(noOp.changed, false);
assert.equal(noOp.blocks, horizontal.blocks, 'same-mode selection must be a true no-op');

const verticalAgain = ensureFlowLanguageTypography(horizontal.blocks, {
    groupId: 'flow_mode_switch',
    languageKey: 'ja',
    writingMode: 'vertical-rl',
});
assert.equal(verticalAgain.blocks[1].flow.layout.typographyByLanguage.ja.writingMode, 'vertical-rl');
assert.deepEqual(verticalAgain.blocks[1].flow.document, originalDocument);

assert.throws(() => ensureFlowLanguageTypography(horizontal.blocks, {
    groupId: 'flow_mode_switch',
    languageKey: 'en-us',
    writingMode: 'vertical-rl',
}), RangeError, 'unsupported vertical Latin writing must be rejected');

const restored = deserializeProject(serializeProject(createProject(horizontal.blocks)));
assert.equal(restored.blocks[1].flow.layout.typographyByLanguage.ja.writingMode, 'horizontal-tb');
assert.deepEqual(restored.blocks[1].flow.document, originalDocument);
assert.deepEqual(restored.blocks[1].flow.layout.typographyByLanguage['en-us'], originalEnglishProfile);

const stateBackup = structuredClone(state);
try {
    Object.assign(state, createProject(structuredClone(originalBlocks)));
    clearHistory();
    assert.equal(pushState(), true);
    state.blocks = structuredClone(horizontal.blocks);
    assert.equal(getHistoryInfo().undoCount, 1, 'one switch must create one Undo item');
    assert.equal(undo(() => {}), true);
    assert.equal(state.blocks[1].flow.layout.typographyByLanguage.ja.writingMode, 'vertical-rl');
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[1].flow.layout.typographyByLanguage.ja.writingMode, 'horizontal-tb');
    assert.deepEqual(state.blocks[1].flow.document, originalDocument);
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBackup);
}

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');

assert.match(htmlSource, /id="flow-authoring-writing-mode"[^>]*data-testid="flow-authoring-writing-mode"/);
assert.match(htmlSource, /value="horizontal-tb"/);
assert.match(htmlSource, /value="vertical-rl"/);
assert.match(cssSource, /\.flow-authoring-setting\[hidden\]\s*\{\s*display:\s*none;/);
assert.match(appSource, /languageKey === sourceLanguage/,
    'the first UI unit must remain limited to source-language authoring');
assert.match(appSource, /sourceAuthoring = !!isFlowAuthoring\s*&& activeBlock\?\.kind === 'flow'\s*&& isFlowSourceSelected\(activeBlock\.id\)/,
    'a stale select event must not reveal the control outside source authoring');
assert.match(appSource, /isFlowWritingModeSupported\(languageKey, writingMode\)/);
assert.match(appSource, /ensureFlowLanguageTypography\(state\.blocks \|\| \[\], \{/);
assert.match(appSource, /scheduleFlowAuthoringReflow\(groupId, \{ immediate: true \}\);/);
assert.match(appSource, /_flowAuthoringSourceRevision \+= 1;/);
assert.match(appSource, /triggerAutoSave\(\);/);
assert.match(i18nSource, /flow_writing_mode_label:\s*'文字方向'/);
assert.match(i18nSource, /flow_writing_mode_horizontal_only:/);
assert.match(i18nSource, /flow_writing_mode_unsupported:/);

console.log('Flow writing mode switch verification passed.');
