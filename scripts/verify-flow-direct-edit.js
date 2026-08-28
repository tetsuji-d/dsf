import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    FlowDirectEditError,
    createFlowDirectEditSession,
    createFlowDirectEditTransaction,
    createFlowDirectParagraphSplitTransaction,
} from '../js/flow-direct-edit.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { getWritingModeFromConfigs } from '../js/layout.js';

function createFixture(overrides = {}) {
    return createFlowGroupBlock({
        id: 'flow_direct_group',
        sourceLanguage: 'ja',
        idFactory: (prefix) => `${prefix}_direct`,
        document: {
            id: 'flow_direct_document',
            sourceLanguage: 'ja',
            sections: [{
                id: 'flow_direct_section',
                title: { ja: '直接編集' },
                blocks: [{
                    id: 'flow_direct_heading',
                    type: 'heading',
                    level: 1,
                    texts: { ja: '見出し' },
                }, {
                    id: 'flow_direct_paragraph',
                    type: 'paragraph',
                    texts: { ja: '雪👩‍💻の日' },
                }],
            }],
        },
        ...overrides,
    });
}

function createSession(group = createFixture(), overrides = {}) {
    return createFlowDirectEditSession(group, {
        pageLanguageKey: 'ja',
        writingMode: 'horizontal-tb',
        isSourceFallback: false,
        sourcePoint: {
            sectionId: 'flow_direct_section',
            blockId: 'flow_direct_paragraph',
            blockType: 'paragraph',
            languageKey: 'ja',
            utf16Offset: 1,
            graphemeOffset: 1,
            affinity: 'nearest',
        },
        ...overrides,
    });
}

const group = createFixture();
const before = JSON.stringify(group);
const session = createSession(group);
assert.equal(session.expectedText, '雪👩‍💻の日');
assert.equal(session.selectionStart, 1);
assert.equal(JSON.stringify(group), before, 'session creation must not mutate semantic source');
assert.equal(getWritingModeFromConfigs('ja', { ja: { pageDirection: 'ltr' } }), 'horizontal-tb');
assert.equal(getWritingModeFromConfigs('ja', { ja: { pageDirection: 'rtl' } }), 'vertical-rl');
assert.equal(
    getWritingModeFromConfigs('ja', { ja: { writingMode: 'vertical-rl', pageDirection: 'ltr' } }),
    'vertical-rl',
    'an explicit saved writingMode must remain authoritative',
);

const inserted = createFlowDirectEditTransaction(group, session, {
    text: '雪深い👩‍💻の日',
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
});
assert.deepEqual(inserted.operation, {
    type: 'setText',
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    blockId: 'flow_direct_paragraph',
    languageKey: 'ja',
    text: '雪深い👩‍💻の日',
});
assert.equal(inserted.selection.focusPoint.utf16Offset, 3);
assert.equal(inserted.selection.focusPoint.graphemeOffset, 3);

const emojiEnd = '雪深い👩‍💻'.length;
const emojiSelection = createFlowDirectEditTransaction(group, session, {
    text: '雪深い👩‍💻の日',
    selectionStart: emojiEnd,
    selectionEnd: emojiEnd,
});
assert.equal(emojiSelection.selection.focusPoint.utf16Offset, emojiEnd);
assert.equal(emojiSelection.selection.focusPoint.graphemeOffset, 4);

const selected = createFlowDirectEditTransaction(group, session, {
    text: session.expectedText,
    selectionStart: 1,
    selectionEnd: '雪👩‍💻'.length,
    selectionDirection: 'backward',
});
assert.equal(selected.selection.focusPoint.utf16Offset, 1);
assert.equal(selected.selection.startPoint.graphemeOffset, 1);
assert.equal(selected.selection.endPoint.graphemeOffset, 2);

const splitOffset = '雪👩‍💻'.length;
const split = createFlowDirectParagraphSplitTransaction(group, session, {
    selectionStart: splitOffset,
    selectionEnd: splitOffset,
    newBlockId: 'flow_direct_paragraph_after',
});
assert.deepEqual(split.operation, {
    type: 'splitParagraph',
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    blockId: 'flow_direct_paragraph',
    languageKey: 'ja',
    utf16Offset: splitOffset,
    newBlockId: 'flow_direct_paragraph_after',
});
assert.equal(split.selection.splitPoint.graphemeOffset, 2);
assert.equal(split.nextSession.blockId, 'flow_direct_paragraph_after');
assert.equal(split.nextSession.expectedText, 'の日');
assert.equal(split.nextSession.selectionStart, 0);
assert.equal(split.selection.focusPoint.utf16Offset, 0);
assert.equal(split.selection.focusPoint.graphemeOffset, 0);

const splitAtStart = createFlowDirectParagraphSplitTransaction(group, session, {
    selectionStart: 0,
    selectionEnd: 0,
    newBlockId: 'flow_direct_paragraph_at_start',
});
assert.equal(splitAtStart.nextSession.expectedText, session.expectedText);
const splitAtEnd = createFlowDirectParagraphSplitTransaction(group, session, {
    selectionStart: session.expectedText.length,
    selectionEnd: session.expectedText.length,
    newBlockId: 'flow_direct_paragraph_at_end',
});
assert.equal(splitAtEnd.nextSession.expectedText, '');
assert.throws(
    () => createFlowDirectParagraphSplitTransaction(group, session, {
        selectionStart: 1,
        selectionEnd: splitOffset,
        newBlockId: 'flow_direct_selected_split',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED',
);
assert.throws(
    () => createFlowDirectParagraphSplitTransaction(group, session, {
        selectionStart: 2,
        selectionEnd: 2,
        newBlockId: 'flow_direct_mid_grapheme_split',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED',
);
const headingSession = createSession(group, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_heading',
        blockType: 'heading',
        languageKey: 'ja',
        utf16Offset: 1,
        graphemeOffset: 1,
        affinity: 'nearest',
    },
});
assert.throws(
    () => createFlowDirectParagraphSplitTransaction(group, headingSession, {
        selectionStart: 1,
        selectionEnd: 1,
        newBlockId: 'flow_direct_heading_split',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED',
);

const staleGroup = structuredClone(group);
staleGroup.flow.document.sections[0].blocks[1].texts.ja = '別の編集';
assert.throws(
    () => createFlowDirectEditTransaction(staleGroup, session, {
        text: '上書き',
        selectionStart: 3,
        selectionEnd: 3,
    }),
    (error) => error instanceof FlowDirectEditError && error.code === 'FLOW_DIRECT_SOURCE_STALE',
);
assert.throws(
    () => createFlowDirectEditTransaction(group, session, {
        text: '段落\n追加',
        selectionStart: 5,
        selectionEnd: 5,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_STRUCTURAL_EDIT_UNSUPPORTED',
);
assert.throws(
    () => createSession(group, { pageLanguageKey: 'en' }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_SOURCE_LANGUAGE_ONLY',
);
assert.throws(
    () => createSession(group, { isSourceFallback: true }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_SOURCE_FALLBACK',
);
assert.throws(
    () => createSession(group, { writingMode: 'vertical-rl' }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_HORIZONTAL_ONLY',
);

const multilineGroup = createFixture();
multilineGroup.flow.document.sections[0].blocks[1].texts.ja = '既存\n改行';
assert.throws(
    () => createSession(multilineGroup),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_MULTILINE_UNSUPPORTED',
);

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const studioCss = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
assert.match(appSource, /createFlowDirectEditTransaction\(/);
assert.match(appSource, /createFlowDirectParagraphSplitTransaction\(/);
assert.match(appSource, /newBlockId: createId\('flow_paragraph'\)/);
assert.match(appSource, /applyFlowAuthoringEdit\(transaction\.operation, \{ immediate: true \}\)/);
assert.match(appSource, /addEventListener\('beforeinput', handleFlowDirectBeforeInput\)/);
assert.match(appSource, /addEventListener\('compositionstart', handleFlowDirectCompositionStart\)/);
assert.match(appSource, /addEventListener\('compositionend', handleFlowDirectCompositionEnd\)/);
assert.match(appSource, /applyFlowAuthoringEdit\(transaction\.operation/);
assert.match(appSource, /historyKey: `flow:\$\{transaction\.operation\.groupId\}/);
assert.match(appSource, /immediate: true/);
assert.match(appSource, /findFlowSourcePointInPages\(/);
assert.match(studioCss, /\.flow-direct-input-proxy/);
assert.match(studioCss, /\.flow-direct-caret/);
assert.doesNotMatch(appSource, /pageElement\.contentEditable\s*=/);

console.log('Flow direct edit verification passed.');
