import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    FlowDirectEditError,
    createFlowDirectEditSession,
    createFlowDirectEditTransaction,
    createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction,
    createFlowDirectHeadingParagraphTransaction,
    createFlowDirectParagraphMergeBackwardTransaction,
    createFlowDirectParagraphMergeForwardTransaction,
    createFlowDirectParagraphSplitTransaction,
} from '../js/flow-direct-edit.js';
import { applyFlowAuthoringOperation } from '../js/flow-authoring.js';
import { countGraphemes } from '../js/grapheme.js';
import { createIncrementalFlowPaginator } from '../js/flow-incremental-pagination.js';
import {
    createCanonicalFlowPageBox,
    paginateFlowDocument,
} from '../js/flow-pagination.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import { findFlowSourcePointInPages } from '../js/flow-source-mapping.js';
import { deriveFlowTranslationStatus, captureFlowTranslationUnitBeforeSourceEdit } from '../js/flow-translation-state.js';
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
                }, {
                    id: 'flow_direct_paragraph_next',
                    type: 'paragraph',
                    texts: { ja: '足音が近づいた。' },
                }],
            }],
        },
        ...overrides,
    });
}

function createMergeSession(group = createFixture()) {
    return createSession(group, {
        sourcePoint: {
            sectionId: 'flow_direct_section',
            blockId: 'flow_direct_paragraph_next',
            blockType: 'paragraph',
            languageKey: 'ja',
            utf16Offset: 0,
            graphemeOffset: 0,
            affinity: 'nearest',
        },
    });
}

function createForwardMergeSession(group = createFixture()) {
    const text = group.flow.document.sections[0].blocks
        .find((block) => block.id === 'flow_direct_paragraph')
        .texts.ja;
    return createSession(group, {
        sourcePoint: {
            sectionId: 'flow_direct_section',
            blockId: 'flow_direct_paragraph',
            blockType: 'paragraph',
            languageKey: 'ja',
            utf16Offset: text.length,
            affinity: 'nearest',
        },
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

function createPageBoundaryFixture() {
    return createFlowGroupBlock({
        id: 'flow_direct_boundary_group',
        sourceLanguage: 'ja',
        idFactory: (prefix) => `${prefix}_boundary`,
        document: {
            id: 'flow_direct_boundary_document',
            sourceLanguage: 'ja',
            sections: [{
                id: 'flow_direct_boundary_section',
                title: {},
                blocks: [{
                    id: 'flow_direct_boundary_paragraph',
                    type: 'paragraph',
                    texts: { ja: 'あいうえおかきく' },
                }],
            }],
        },
    });
}

function createPageBoundaryMeasurer(capacity) {
    return ({ fragments }) => ({
        fits: fragments.reduce((total, fragment) => (
            total
            + Math.max(1, countGraphemes(fragment.text, fragment.languageKey))
            + (fragment.isBlockStart ? 2 : 0)
        ), 0) <= capacity,
    });
}

function createPageBoundaryPaginator(pageBox, measurePage, writingMode = 'horizontal-tb') {
    return createIncrementalFlowPaginator({
        pageBox,
        languageKey: 'ja',
        writingMode,
        measurePage,
        measurementKey: `flow-direct-page-boundary-capacity-5-${writingMode}`,
        getPageVariantKey: () => 'uniform',
    });
}

function paginatePageBoundary(paginator, group, pageBox, measurePage, writingMode = 'horizontal-tb') {
    const result = paginator.paginate(group.flow.document);
    const cold = paginateFlowDocument(group.flow.document, {
        pageBox,
        languageKey: 'ja',
        writingMode,
        measurePage,
    });
    assert.deepEqual(result.pagination, cold, 'direct edits must remain cold-pagination equivalent');
    return result;
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

const verticalSession = createSession(group, { writingMode: 'vertical-rl' });
assert.equal(verticalSession.writingMode, 'vertical-rl');
assert.equal(verticalSession.expectedText, session.expectedText);
const verticalInserted = createFlowDirectEditTransaction(group, verticalSession, {
    text: '雪深い👩‍💻の日',
    selectionStart: 3,
    selectionEnd: 3,
    selectionDirection: 'none',
});
assert.equal(verticalInserted.nextSession.writingMode, 'vertical-rl');
assert.equal(verticalInserted.selection.focusPoint.utf16Offset, 3);
assert.equal(
    verticalInserted.selection.focusPoint.affinity,
    'forward',
    'a collapsed direct-input caret must advance to the following vertical glyph position',
);
const verticalAppliedGroup = applyFlowAuthoringOperation([group], verticalInserted.operation)[0];
assert.equal(
    verticalAppliedGroup.flow.document.sections[0].blocks[1].texts.ja,
    '雪深い👩‍💻の日',
    'vertical direct input must update semantic source through the shared setText operation',
);
assert.equal(Object.hasOwn(verticalAppliedGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(verticalAppliedGroup.flow.document, 'fragments'), false);

const verticalHeadingSession = createSession(group, {
    writingMode: 'vertical-rl',
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_heading',
        blockType: 'heading',
        languageKey: 'ja',
        utf16Offset: 3,
        graphemeOffset: 3,
        affinity: 'nearest',
    },
});
const verticalHeadingEdited = createFlowDirectEditTransaction(group, verticalHeadingSession, {
    text: '縦書き見出し',
    selectionStart: 6,
    selectionEnd: 6,
});
const verticalHeadingGroup = applyFlowAuthoringOperation([group], verticalHeadingEdited.operation)[0];
assert.equal(verticalHeadingGroup.flow.document.sections[0].blocks[0].texts.ja, '縦書き見出し');

const verticalSplit = createFlowDirectParagraphSplitTransaction(group, verticalSession, {
    selectionStart: 1,
    selectionEnd: 1,
    newBlockId: 'flow_direct_vertical_split',
});
const verticalSplitGroup = applyFlowAuthoringOperation([group], verticalSplit.operation)[0];
assert.deepEqual(
    verticalSplitGroup.flow.document.sections[0].blocks.slice(1, 3).map((block) => block.texts.ja),
    ['雪', '👩‍💻の日'],
    'vertical Enter must split one semantic Paragraph without changing text order',
);
assert.equal(verticalSplit.nextSession.writingMode, 'vertical-rl');
assert.equal(verticalSplit.nextSession.blockId, 'flow_direct_vertical_split');
assert.equal(verticalSplit.nextSession.selectionStart, 0);
assert.equal(Object.hasOwn(verticalSplitGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(verticalSplitGroup.flow.document, 'fragments'), false);

const verticalHeadingParagraph = createFlowDirectHeadingParagraphTransaction(
    group,
    verticalHeadingSession,
    {
        selectionStart: verticalHeadingSession.expectedText.length,
        selectionEnd: verticalHeadingSession.expectedText.length,
        newBlockId: 'flow_direct_vertical_after_heading',
    },
);
const verticalHeadingParagraphGroup = applyFlowAuthoringOperation(
    [group],
    verticalHeadingParagraph.operation,
)[0];
assert.deepEqual(
    verticalHeadingParagraphGroup.flow.document.sections[0].blocks.slice(0, 2).map((block) => block.type),
    ['heading', 'paragraph'],
);
assert.equal(
    verticalHeadingParagraphGroup.flow.document.sections[0].blocks[1].id,
    'flow_direct_vertical_after_heading',
);
assert.equal(verticalHeadingParagraph.nextSession.writingMode, 'vertical-rl');

const multilineHeadingGroup = createFixture();
const multilineHeadingText = '見出し\n続き';
multilineHeadingGroup.flow.document.sections[0].blocks[0].texts.ja = multilineHeadingText;
const multilineHeadingSession = createSession(multilineHeadingGroup, {
    writingMode: 'vertical-rl',
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_heading',
        blockType: 'heading',
        languageKey: 'ja',
        utf16Offset: multilineHeadingText.length,
        graphemeOffset: countGraphemes(multilineHeadingText, 'ja'),
        affinity: 'nearest',
    },
});
const multilineHeadingParagraph = createFlowDirectHeadingParagraphTransaction(
    multilineHeadingGroup,
    multilineHeadingSession,
    {
        selectionStart: multilineHeadingText.length,
        selectionEnd: multilineHeadingText.length,
        newBlockId: 'flow_direct_multiline_heading_paragraph',
    },
);
const multilineHeadingParagraphGroup = applyFlowAuthoringOperation(
    [multilineHeadingGroup],
    multilineHeadingParagraph.operation,
)[0];
assert.equal(
    multilineHeadingParagraphGroup.flow.document.sections[0].blocks[0].texts.ja,
    multilineHeadingText,
    'Heading end Enter must preserve existing line breaks exactly',
);
assert.equal(
    multilineHeadingParagraphGroup.flow.document.sections[0].blocks[1].id,
    'flow_direct_multiline_heading_paragraph',
);

const verticalRejoined = createFlowDirectParagraphMergeBackwardTransaction(
    verticalSplitGroup,
    verticalSplit.nextSession,
    { selectionStart: 0, selectionEnd: 0 },
);
assert.deepEqual(applyFlowAuthoringOperation([verticalSplitGroup], verticalRejoined.operation)[0], group,
    'Vertical Enter then Backspace must restore the exact source group');
assert.equal(verticalRejoined.nextSession.writingMode, 'vertical-rl');
assert.equal(verticalRejoined.selection.focusPoint.utf16Offset, 1);
const verticalEmptyRemoved = createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
    multilineHeadingParagraphGroup,
    multilineHeadingParagraph.nextSession,
    { selectionStart: 0, selectionEnd: 0 },
);
assert.deepEqual(applyFlowAuthoringOperation([multilineHeadingParagraphGroup], verticalEmptyRemoved.operation)[0],
    multilineHeadingGroup, 'Vertical Backspace must remove the source-only empty Paragraph after a multiline Heading');
assert.equal(verticalEmptyRemoved.nextSession.expectedText, multilineHeadingText);
assert.equal(verticalEmptyRemoved.nextSession.selectionStart, multilineHeadingText.length);

for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const multilineMergeGroup = createFixture();
    const first = multilineMergeGroup.flow.document.sections[0].blocks[1];
    const next = multilineMergeGroup.flow.document.sections[0].blocks[2];
    first.texts = { ja: '雪\nの日', en: 'Snowy day' };
    first.futureParagraph = { keep: true };
    next.texts.ja = '足音\n続き';
    const beforeMerge = JSON.stringify(multilineMergeGroup);
    const backwardSession = createSession(multilineMergeGroup, {
        writingMode,
        sourcePoint: { ...createMergeSession(multilineMergeGroup).sourcePoint },
    });
    const forwardSession = createSession(multilineMergeGroup, {
        writingMode,
        sourcePoint: { ...createForwardMergeSession(multilineMergeGroup).sourcePoint },
    });
    const backward = createFlowDirectParagraphMergeBackwardTransaction(multilineMergeGroup, backwardSession,
        { selectionStart: 0, selectionEnd: 0 });
    const forward = createFlowDirectParagraphMergeForwardTransaction(multilineMergeGroup, forwardSession,
        { selectionStart: first.texts.ja.length, selectionEnd: first.texts.ja.length });
    assert.deepEqual(forward.operation, backward.operation,
        `${writingMode}: Delete and Backspace must remove the same Paragraph boundary`);
    assert.equal(JSON.stringify(multilineMergeGroup), beforeMerge, 'Merge planning must not mutate source');
    for (const transaction of [backward, forward]) {
        const merged = applyFlowAuthoringOperation([multilineMergeGroup], transaction.operation)[0];
        const surviving = merged.flow.document.sections[0].blocks[1];
        assert.equal(surviving.id, first.id);
        assert.equal(surviving.texts.ja, '雪\nの日足音\n続き', 'Merging must preserve embedded LF exactly');
        assert.equal(surviving.texts.en, 'Snowy day');
        assert.deepEqual(surviving.futureParagraph, { keep: true });
        assert.deepEqual(deriveFlowTranslationStatus(merged, 'en').body.ids.stale, [first.id]);
        assert.equal(transaction.nextSession.writingMode, writingMode);
        assert.equal(transaction.selection.focusPoint.utf16Offset, first.texts.ja.length);
        assert.equal(transaction.selection.focusPoint.graphemeOffset, countGraphemes(first.texts.ja, 'ja'));
    }
    const protectedMergeGroup = structuredClone(multilineMergeGroup);
    protectedMergeGroup.flow.document.sections[0].blocks[2].texts.en = '';
    for (const [createTransaction, targetSession, selection] of [
        [createFlowDirectParagraphMergeBackwardTransaction, backwardSession, { selectionStart: 0, selectionEnd: 0 }],
        [createFlowDirectParagraphMergeForwardTransaction, forwardSession,
            { selectionStart: first.texts.ja.length, selectionEnd: first.texts.ja.length }],
    ]) {
        const tx = createTransaction(protectedMergeGroup, targetSession, selection);
        const joined = applyFlowAuthoringOperation([protectedMergeGroup], tx.operation)[0];
        assert.equal(joined.flow.document.sections[0].blocks[1].texts.en, 'Snowy day');
    }
    const protectedEmptyGroup = structuredClone(multilineHeadingParagraphGroup);
    protectedEmptyGroup.flow.document.sections[0].blocks[1].futureData = { keep: true };
    assert.throws(() => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
        protectedEmptyGroup,
        { ...multilineHeadingParagraph.nextSession, writingMode },
        { selectionStart: 0, selectionEnd: 0 },
    ), { code: 'FLOW_DIRECT_EMPTY_PARAGRAPH_DATA_PRESENT' },
    `${writingMode}: Empty Paragraph unknown fields must still prevent removal`);
}

const verticalBoundaryPageBox = createCanonicalFlowPageBox();
const verticalBoundaryMeasurePage = createPageBoundaryMeasurer(5);
const verticalBoundaryGroup = createPageBoundaryFixture();
const verticalBoundaryPaginator = createPageBoundaryPaginator(
    verticalBoundaryPageBox,
    verticalBoundaryMeasurePage,
    'vertical-rl',
);
const verticalBoundaryInitial = paginatePageBoundary(
    verticalBoundaryPaginator,
    verticalBoundaryGroup,
    verticalBoundaryPageBox,
    verticalBoundaryMeasurePage,
    'vertical-rl',
);
assert.equal(verticalBoundaryInitial.pagination.pages.length, 2);
const verticalBoundaryText = verticalBoundaryGroup.flow.document.sections[0].blocks[0].texts.ja;
const verticalBoundarySession = createFlowDirectEditSession(verticalBoundaryGroup, {
    pageLanguageKey: 'ja',
    writingMode: 'vertical-rl',
    isSourceFallback: false,
    sourcePoint: {
        sectionId: 'flow_direct_boundary_section',
        blockId: 'flow_direct_boundary_paragraph',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: verticalBoundaryText.length,
        graphemeOffset: countGraphemes(verticalBoundaryText, 'ja'),
        affinity: 'forward',
    },
});
const verticalExpandedText = `${verticalBoundaryText}さしすせそたちつてと`;
const verticalExpandedTransaction = createFlowDirectEditTransaction(
    verticalBoundaryGroup,
    verticalBoundarySession,
    {
        text: verticalExpandedText,
        selectionStart: verticalExpandedText.length,
        selectionEnd: verticalExpandedText.length,
    },
);
const verticalExpandedGroup = applyFlowAuthoringOperation(
    [verticalBoundaryGroup],
    verticalExpandedTransaction.operation,
)[0];
const verticalBoundaryExpanded = paginatePageBoundary(
    verticalBoundaryPaginator,
    verticalExpandedGroup,
    verticalBoundaryPageBox,
    verticalBoundaryMeasurePage,
    'vertical-rl',
);
assert.equal(verticalBoundaryExpanded.changeSet.mode, 'incremental');
assert.ok(
    verticalBoundaryExpanded.pagination.pages.length > verticalBoundaryInitial.pagination.pages.length,
    'vertical direct input must add generated pages when semantic text grows',
);
const verticalShrunkTransaction = createFlowDirectEditTransaction(
    verticalExpandedGroup,
    verticalExpandedTransaction.nextSession,
    {
        text: verticalBoundaryText,
        selectionStart: verticalBoundaryText.length,
        selectionEnd: verticalBoundaryText.length,
    },
);
const verticalShrunkGroup = applyFlowAuthoringOperation(
    [verticalExpandedGroup],
    verticalShrunkTransaction.operation,
)[0];
const verticalBoundaryShrunk = paginatePageBoundary(
    verticalBoundaryPaginator,
    verticalShrunkGroup,
    verticalBoundaryPageBox,
    verticalBoundaryMeasurePage,
    'vertical-rl',
);
assert.equal(verticalBoundaryShrunk.changeSet.mode, 'incremental');
assert.deepEqual(verticalBoundaryShrunk.pagination, verticalBoundaryInitial.pagination);
assert.equal(Object.hasOwn(verticalShrunkGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(verticalShrunkGroup.flow.document, 'fragments'), false);

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

const translatedHeadingGroup = createFixture();
const translatedHeading = translatedHeadingGroup.flow.document.sections[0].blocks[0];
translatedHeading.texts.en = 'Heading';
translatedHeading.futureHeading = { keep: true };
const translatedHeadingBefore = structuredClone(translatedHeading);
const headingEnd = translatedHeading.texts.ja.length;
const headingEndSession = createSession(translatedHeadingGroup, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_heading',
        blockType: 'heading',
        languageKey: 'ja',
        utf16Offset: headingEnd,
        affinity: 'nearest',
    },
});
const headingParagraph = createFlowDirectHeadingParagraphTransaction(
    translatedHeadingGroup,
    headingEndSession,
    {
        selectionStart: headingEnd,
        selectionEnd: headingEnd,
        newBlockId: 'flow_direct_paragraph_after_heading',
    },
);
assert.deepEqual(headingParagraph.operation, {
    type: 'insertBlock',
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    afterBlockId: 'flow_direct_heading',
    blockType: 'paragraph',
    languageKey: 'ja',
    newBlockId: 'flow_direct_paragraph_after_heading',
});
assert.equal(headingParagraph.nextSession.blockId, 'flow_direct_paragraph_after_heading');
assert.equal(headingParagraph.nextSession.blockType, 'paragraph');
assert.equal(headingParagraph.nextSession.expectedText, '');
assert.equal(headingParagraph.selection.focusPoint.utf16Offset, 0);
assert.equal(headingParagraph.selection.focusPoint.graphemeOffset, 0);
const headingInsertedGroup = applyFlowAuthoringOperation(
    [translatedHeadingGroup],
    headingParagraph.operation,
)[0];
const headingInsertedBlocks = headingInsertedGroup.flow.document.sections[0].blocks;
assert.deepEqual(
    headingInsertedBlocks.map((block) => block.id),
    [
        'flow_direct_heading',
        'flow_direct_paragraph_after_heading',
        'flow_direct_paragraph',
        'flow_direct_paragraph_next',
    ],
);
assert.deepEqual(headingInsertedBlocks[0], translatedHeadingBefore, 'Heading source, translation, and unknown fields remain exact');
assert.deepEqual(headingInsertedBlocks[1].texts, { ja: '' }, 'Inserted Paragraph starts untranslated');
assert.deepEqual(translatedHeadingGroup.flow.document.sections[0].blocks[0], translatedHeadingBefore, 'Transaction application must not mutate input');
assert.throws(
    () => createFlowDirectHeadingParagraphTransaction(translatedHeadingGroup, headingEndSession, {
        selectionStart: 0,
        selectionEnd: headingEnd,
        newBlockId: 'flow_direct_selected_heading_insert',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED',
);
assert.throws(
    () => createFlowDirectHeadingParagraphTransaction(translatedHeadingGroup, headingEndSession, {
        selectionStart: 1,
        selectionEnd: 1,
        newBlockId: 'flow_direct_mid_heading_insert',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_HEADING_END_REQUIRED',
);
assert.throws(
    () => createFlowDirectHeadingParagraphTransaction(group, session, {
        selectionStart: 1,
        selectionEnd: 1,
        newBlockId: 'flow_direct_paragraph_heading_insert',
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_HEADING_REQUIRED',
);

const headingRemovalInputJson = JSON.stringify(headingInsertedGroup);
const headingRemoval = createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
    headingInsertedGroup,
    headingParagraph.nextSession,
    {
        selectionStart: 0,
        selectionEnd: 0,
    },
);
assert.equal(JSON.stringify(headingInsertedGroup), headingRemovalInputJson, 'Empty Paragraph removal planning must not mutate source');
assert.deepEqual(headingRemoval.operation, {
    type: 'removeBlock',
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    blockId: 'flow_direct_paragraph_after_heading',
});
assert.equal(headingRemoval.nextSession.blockId, 'flow_direct_heading');
assert.equal(headingRemoval.nextSession.blockType, 'heading');
assert.equal(headingRemoval.nextSession.expectedText, '見出し');
assert.equal(headingRemoval.nextSession.selectionStart, headingEnd);
assert.equal(headingRemoval.nextSession.selectionEnd, headingEnd);
assert.equal(headingRemoval.selection.focusPoint.blockId, 'flow_direct_heading');
assert.equal(headingRemoval.selection.focusPoint.utf16Offset, headingEnd);
const headingRestoredGroup = applyFlowAuthoringOperation(
    [headingInsertedGroup],
    headingRemoval.operation,
)[0];
assert.deepEqual(
    headingRestoredGroup,
    translatedHeadingGroup,
    'Heading Enter followed by empty-Paragraph Backspace must restore the exact semantic group',
);

const nonEmptyAfterHeadingGroup = structuredClone(headingInsertedGroup);
nonEmptyAfterHeadingGroup.flow.document.sections[0].blocks[1].texts.ja = '本文';
const nonEmptyAfterHeadingSession = createSession(nonEmptyAfterHeadingGroup, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph_after_heading',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: 0,
        affinity: 'nearest',
    },
});
assert.throws(
    () => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
        nonEmptyAfterHeadingGroup,
        nonEmptyAfterHeadingSession,
        { selectionStart: 0, selectionEnd: 0 },
    ),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_REQUIRED',
);
assert.throws(
    () => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
        nonEmptyAfterHeadingGroup,
        nonEmptyAfterHeadingSession,
        { selectionStart: 0, selectionEnd: 1 },
    ),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED',
);

for (const protectedEmptyParagraphGroup of (() => {
    const translated = structuredClone(headingInsertedGroup);
    translated.flow.document.sections[0].blocks[1].texts.en = '';
    const extended = structuredClone(headingInsertedGroup);
    extended.flow.document.sections[0].blocks[1].futureParagraph = { keep: true };
    const tracked = structuredClone(headingInsertedGroup);
    tracked.flow.translationState = {
        schemaVersion: 1,
        languages: {
            en: {
                sourceFingerprints: {
                    blocks: { flow_direct_paragraph_after_heading: 'u1aaaaaaaaaaa' },
                    sectionTitles: {},
                },
                reviewState: 'reviewed',
                origin: 'manual',
                lockedUnitIds: ['flow_direct_paragraph_after_heading'],
            },
        },
    };
    return [translated, extended, tracked];
})()) {
    const protectedSession = createSession(protectedEmptyParagraphGroup, {
        sourcePoint: {
            sectionId: 'flow_direct_section',
            blockId: 'flow_direct_paragraph_after_heading',
            blockType: 'paragraph',
            languageKey: 'ja',
            utf16Offset: 0,
            affinity: 'nearest',
        },
    });
    assert.throws(
        () => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
            protectedEmptyParagraphGroup,
            protectedSession,
            { selectionStart: 0, selectionEnd: 0 },
        ),
        (error) => error instanceof FlowDirectEditError
            && error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_DATA_PRESENT',
    );
}

const emptyAfterParagraphGroup = structuredClone(group);
emptyAfterParagraphGroup.flow.document.sections[0].blocks.at(-1).texts.ja = '';
const emptyAfterParagraphSession = createSession(emptyAfterParagraphGroup, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph_next',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: 0,
        affinity: 'nearest',
    },
});
assert.throws(
    () => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
        emptyAfterParagraphGroup,
        emptyAfterParagraphSession,
        { selectionStart: 0, selectionEnd: 0 },
    ),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PREVIOUS_HEADING_REQUIRED',
);
assert.throws(
    () => createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(
        group,
        headingSession,
        { selectionStart: 1, selectionEnd: 1 },
    ),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED',
);

const mergeSession = createMergeSession(group);
const merge = createFlowDirectParagraphMergeBackwardTransaction(group, mergeSession, {
    selectionStart: 0,
    selectionEnd: 0,
});
const mergeJoinOffset = '雪👩‍💻の日'.length;
assert.deepEqual(merge.operation, {
    type: 'mergeParagraphBackward',
    preserveTranslations: true,
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    blockId: 'flow_direct_paragraph_next',
    languageKey: 'ja',
});
assert.equal(merge.nextSession.blockId, 'flow_direct_paragraph');
assert.equal(merge.nextSession.expectedText, '雪👩‍💻の日足音が近づいた。');
assert.equal(merge.nextSession.selectionStart, mergeJoinOffset);
assert.equal(merge.nextSession.selectionEnd, mergeJoinOffset);
assert.equal(merge.selection.focusPoint.blockId, 'flow_direct_paragraph');
assert.equal(merge.selection.focusPoint.utf16Offset, mergeJoinOffset);
assert.equal(merge.selection.focusPoint.graphemeOffset, 4);
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(group, mergeSession, {
        selectionStart: 0,
        selectionEnd: 1,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED',
);
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(group, mergeSession, {
        selectionStart: 1,
        selectionEnd: 1,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_START_REQUIRED',
);
const firstParagraphSession = createSession(group, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: 0,
        graphemeOffset: 0,
        affinity: 'nearest',
    },
});
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(group, firstParagraphSession, {
        selectionStart: 0,
        selectionEnd: 0,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PREVIOUS_PARAGRAPH_REQUIRED',
);
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(group, headingSession, {
        selectionStart: 1,
        selectionEnd: 1,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED',
);
const pageBreakGroup = structuredClone(group);
pageBreakGroup.flow.document.sections[0].blocks.splice(-1, 0, {
    id: 'flow_direct_page_break',
    type: 'pageBreak',
});
const pageBreakMergeSession = createMergeSession(pageBreakGroup);
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(pageBreakGroup, pageBreakMergeSession, {
        selectionStart: 0,
        selectionEnd: 0,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PREVIOUS_PARAGRAPH_REQUIRED',
);
const translatedMergeGroup = structuredClone(group);
translatedMergeGroup.flow.document.sections[0].blocks.at(-1).texts.en = '';
const translatedMergeSession = createMergeSession(translatedMergeGroup);
assert.doesNotThrow(() => createFlowDirectParagraphMergeBackwardTransaction(translatedMergeGroup, translatedMergeSession, {
        selectionStart: 0,
        selectionEnd: 0,
    }));

const forwardMergeSession = createForwardMergeSession(group);
const forwardMergeInputJson = JSON.stringify(group);
const forwardMerge = createFlowDirectParagraphMergeForwardTransaction(group, forwardMergeSession, {
    selectionStart: forwardMergeSession.expectedText.length,
    selectionEnd: forwardMergeSession.expectedText.length,
});
assert.equal(JSON.stringify(group), forwardMergeInputJson, 'Forward Paragraph merge planning must not mutate source');
assert.deepEqual(forwardMerge.operation, {
    type: 'mergeParagraphBackward',
    preserveTranslations: true,
    groupId: 'flow_direct_group',
    sectionId: 'flow_direct_section',
    blockId: 'flow_direct_paragraph_next',
    languageKey: 'ja',
});
assert.equal(forwardMerge.nextSession.blockId, 'flow_direct_paragraph');
assert.equal(forwardMerge.nextSession.expectedText, '雪👩‍💻の日足音が近づいた。');
assert.equal(forwardMerge.nextSession.selectionStart, mergeJoinOffset);
assert.equal(forwardMerge.nextSession.selectionEnd, mergeJoinOffset);
assert.equal(forwardMerge.selection.focusPoint.blockId, 'flow_direct_paragraph');
assert.equal(forwardMerge.selection.focusPoint.utf16Offset, mergeJoinOffset);
assert.equal(forwardMerge.selection.focusPoint.graphemeOffset, 4);
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(group, forwardMergeSession, {
        selectionStart: mergeJoinOffset - 1,
        selectionEnd: mergeJoinOffset,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED',
);
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(group, forwardMergeSession, {
        selectionStart: mergeJoinOffset - 1,
        selectionEnd: mergeJoinOffset - 1,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_END_REQUIRED',
);
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(group, headingSession, {
        selectionStart: 1,
        selectionEnd: 1,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED',
);
const pageBreakForwardGroup = structuredClone(group);
pageBreakForwardGroup.flow.document.sections[0].blocks.splice(2, 0, {
    id: 'flow_direct_forward_page_break',
    type: 'pageBreak',
});
const pageBreakForwardSession = createForwardMergeSession(pageBreakForwardGroup);
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(pageBreakForwardGroup, pageBreakForwardSession, {
        selectionStart: pageBreakForwardSession.expectedText.length,
        selectionEnd: pageBreakForwardSession.expectedText.length,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_NEXT_PARAGRAPH_REQUIRED',
);
const lastParagraphText = group.flow.document.sections[0].blocks.at(-1).texts.ja;
const lastParagraphSession = createSession(group, {
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph_next',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: lastParagraphText.length,
        affinity: 'nearest',
    },
});
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(group, lastParagraphSession, {
        selectionStart: lastParagraphText.length,
        selectionEnd: lastParagraphText.length,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_NEXT_PARAGRAPH_REQUIRED',
);
const translatedForwardGroup = structuredClone(group);
translatedForwardGroup.flow.document.sections[0].blocks.at(-1).texts.en = '';
const translatedForwardSession = createForwardMergeSession(translatedForwardGroup);
assert.doesNotThrow(() => createFlowDirectParagraphMergeForwardTransaction(translatedForwardGroup, translatedForwardSession, {
        selectionStart: translatedForwardSession.expectedText.length,
        selectionEnd: translatedForwardSession.expectedText.length,
    }));

// A semantic Paragraph may span generated pages. Structural edits must reflow
// from the semantic source, move the caret to the new fragment, and never save
// generated page state back into the FlowDocument.
const boundaryPageBox = createCanonicalFlowPageBox();
const boundaryMeasurePage = createPageBoundaryMeasurer(5);
const boundaryGroup = createPageBoundaryFixture();
const boundaryParagraphText = boundaryGroup.flow.document.sections[0].blocks[0].texts.ja;
const splitUtf16Offset = 6;
const boundarySourcePoint = {
    sectionId: 'flow_direct_boundary_section',
    blockId: 'flow_direct_boundary_paragraph',
    blockType: 'paragraph',
    languageKey: 'ja',
    utf16Offset: splitUtf16Offset,
    graphemeOffset: splitUtf16Offset,
    affinity: 'nearest',
};
const backwardBoundaryPaginator = createPageBoundaryPaginator(boundaryPageBox, boundaryMeasurePage);
const initialBoundary = paginatePageBoundary(
    backwardBoundaryPaginator,
    boundaryGroup,
    boundaryPageBox,
    boundaryMeasurePage,
);
assert.equal(initialBoundary.pagination.pages.length, 2);
assert.deepEqual(initialBoundary.pagination.pages.map((page) => (
    page.fragments.map((entry) => [entry.blockId, entry.sourceRange.startGrapheme, entry.sourceRange.endGrapheme])
)), [
    [['flow_direct_boundary_paragraph', 0, 3]],
    [['flow_direct_boundary_paragraph', 3, 8]],
]);
assert.equal(
    findFlowSourcePointInPages(initialBoundary.pagination.pages, boundarySourcePoint).pageIndex,
    1,
    'a caret in the continuation fragment must resolve to the second generated page',
);

const boundarySession = createFlowDirectEditSession(boundaryGroup, {
    pageLanguageKey: 'ja',
    writingMode: 'horizontal-tb',
    isSourceFallback: false,
    sourcePoint: boundarySourcePoint,
});
const boundarySplit = createFlowDirectParagraphSplitTransaction(boundaryGroup, boundarySession, {
    selectionStart: splitUtf16Offset,
    selectionEnd: splitUtf16Offset,
    newBlockId: 'flow_direct_boundary_paragraph_after',
});
const splitBoundaryGroup = applyFlowAuthoringOperation([boundaryGroup], boundarySplit.operation)[0];
const splitBoundary = paginatePageBoundary(
    backwardBoundaryPaginator,
    splitBoundaryGroup,
    boundaryPageBox,
    boundaryMeasurePage,
);
assert.equal(splitBoundary.changeSet.mode, 'incremental');
assert.equal(splitBoundary.pagination.pages.length, 3);
assert.deepEqual(
    splitBoundaryGroup.flow.document.sections[0].blocks.map((entry) => [entry.id, entry.texts.ja]),
    [
        ['flow_direct_boundary_paragraph', boundaryParagraphText.slice(0, splitUtf16Offset)],
        ['flow_direct_boundary_paragraph_after', boundaryParagraphText.slice(splitUtf16Offset)],
    ],
);
assert.equal(
    findFlowSourcePointInPages(splitBoundary.pagination.pages, boundarySplit.selection.focusPoint).pageIndex,
    2,
    'Enter must move the semantic caret to the new Paragraph on its reflowed generated page',
);
assert.equal(Object.hasOwn(splitBoundaryGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(splitBoundaryGroup.flow.document, 'fragments'), false);

const boundaryBackwardMerge = createFlowDirectParagraphMergeBackwardTransaction(
    splitBoundaryGroup,
    boundarySplit.nextSession,
    { selectionStart: 0, selectionEnd: 0 },
);
const backwardMergedGroup = applyFlowAuthoringOperation(
    [splitBoundaryGroup],
    boundaryBackwardMerge.operation,
)[0];
const backwardMergedBoundary = paginatePageBoundary(
    backwardBoundaryPaginator,
    backwardMergedGroup,
    boundaryPageBox,
    boundaryMeasurePage,
);
assert.equal(backwardMergedBoundary.changeSet.mode, 'incremental');
assert.equal(backwardMergedBoundary.pagination.pages.length, 2);
assert.deepEqual(backwardMergedBoundary.pagination, initialBoundary.pagination);
assert.deepEqual(
    backwardMergedGroup.flow.document.sections[0].blocks.map((entry) => [entry.id, entry.texts.ja]),
    [['flow_direct_boundary_paragraph', boundaryParagraphText]],
);
assert.equal(
    findFlowSourcePointInPages(
        backwardMergedBoundary.pagination.pages,
        boundaryBackwardMerge.selection.focusPoint,
    ).pageIndex,
    1,
    'Backspace must keep the join caret on the surviving Paragraph continuation page',
);

const forwardBoundaryPaginator = createPageBoundaryPaginator(boundaryPageBox, boundaryMeasurePage);
paginatePageBoundary(forwardBoundaryPaginator, boundaryGroup, boundaryPageBox, boundaryMeasurePage);
paginatePageBoundary(forwardBoundaryPaginator, splitBoundaryGroup, boundaryPageBox, boundaryMeasurePage);
const boundaryForwardSession = createFlowDirectEditSession(splitBoundaryGroup, {
    pageLanguageKey: 'ja',
    writingMode: 'horizontal-tb',
    isSourceFallback: false,
    sourcePoint: boundarySourcePoint,
});
const boundaryForwardMerge = createFlowDirectParagraphMergeForwardTransaction(
    splitBoundaryGroup,
    boundaryForwardSession,
    { selectionStart: splitUtf16Offset, selectionEnd: splitUtf16Offset },
);
assert.deepEqual(
    boundaryForwardMerge.operation,
    boundaryBackwardMerge.operation,
    'Delete and Backspace must remove the same semantic Paragraph boundary',
);
const forwardMergedGroup = applyFlowAuthoringOperation(
    [splitBoundaryGroup],
    boundaryForwardMerge.operation,
)[0];
const forwardMergedBoundary = paginatePageBoundary(
    forwardBoundaryPaginator,
    forwardMergedGroup,
    boundaryPageBox,
    boundaryMeasurePage,
);
assert.equal(forwardMergedBoundary.changeSet.mode, 'incremental');
assert.equal(forwardMergedBoundary.pagination.pages.length, 2);
assert.deepEqual(forwardMergedBoundary.pagination, initialBoundary.pagination);
assert.deepEqual(
    forwardMergedGroup.flow.document.sections[0].blocks.map((entry) => [entry.id, entry.texts.ja]),
    [['flow_direct_boundary_paragraph', boundaryParagraphText]],
);
assert.equal(
    findFlowSourcePointInPages(
        forwardMergedBoundary.pagination.pages,
        boundaryForwardMerge.selection.focusPoint,
    ).pageIndex,
    1,
    'Delete must keep the join caret on the surviving Paragraph continuation page',
);

// The same page-spanning Paragraph boundary is removable in vertical writing.
const verticalPageBoundarySession = createFlowDirectEditSession(boundaryGroup, {
    pageLanguageKey: 'ja', writingMode: 'vertical-rl', sourcePoint: boundarySourcePoint,
});
const verticalPageBoundarySplit = createFlowDirectParagraphSplitTransaction(boundaryGroup,
    verticalPageBoundarySession, {
        selectionStart: splitUtf16Offset, selectionEnd: splitUtf16Offset,
        newBlockId: 'flow_direct_vertical_boundary_after',
    });
const verticalPageBoundarySplitGroup = applyFlowAuthoringOperation([boundaryGroup], verticalPageBoundarySplit.operation)[0];
for (const direction of ['backward', 'forward']) {
    const paginator = createPageBoundaryPaginator(boundaryPageBox, boundaryMeasurePage, 'vertical-rl');
    const original = paginatePageBoundary(paginator, boundaryGroup, boundaryPageBox, boundaryMeasurePage, 'vertical-rl');
    const split = paginatePageBoundary(paginator, verticalPageBoundarySplitGroup, boundaryPageBox, boundaryMeasurePage, 'vertical-rl');
    assert.equal(original.pagination.pages.length, 2);
    assert.equal(split.pagination.pages.length, 3);
    const forwardSession = createFlowDirectEditSession(verticalPageBoundarySplitGroup, {
        pageLanguageKey: 'ja', writingMode: 'vertical-rl', sourcePoint: boundarySourcePoint,
    });
    const transaction = direction === 'backward'
        ? createFlowDirectParagraphMergeBackwardTransaction(verticalPageBoundarySplitGroup,
            verticalPageBoundarySplit.nextSession, { selectionStart: 0, selectionEnd: 0 })
        : createFlowDirectParagraphMergeForwardTransaction(verticalPageBoundarySplitGroup,
            forwardSession, { selectionStart: splitUtf16Offset, selectionEnd: splitUtf16Offset });
    const joined = applyFlowAuthoringOperation([verticalPageBoundarySplitGroup], transaction.operation)[0];
    const reflowed = paginatePageBoundary(paginator, joined, boundaryPageBox, boundaryMeasurePage, 'vertical-rl');
    assert.equal(reflowed.changeSet.mode, 'incremental');
    assert.deepEqual(reflowed.pagination, original.pagination,
        `Vertical ${direction} merge must remove the extra generated page and match cold pagination`);
    assert.deepEqual(joined, boundaryGroup, 'Vertical boundary edits must restore all original source text');
    assert.equal(findFlowSourcePointInPages(reflowed.pagination.pages, transaction.selection.focusPoint).pageIndex, 1,
        'Vertical merge caret must remain on the surviving continuation page');
}

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
const softLineBreak = createFlowDirectEditTransaction(group, session, {
    text: '段落\n追加',
    selectionStart: 3,
    selectionEnd: 3,
});
assert.equal(softLineBreak.operation.type, 'setText');
assert.equal(softLineBreak.operation.blockId, session.blockId);
assert.equal(softLineBreak.nextSession.expectedText, '段落\n追加');
assert.equal(softLineBreak.selection.focusPoint.utf16Offset, 3);
for (const unsupportedBreak of ['\r', '\r\n', '\u2028', '\u2029']) {
    assert.throws(() => createFlowDirectEditTransaction(group, session, {
        text: `段落${unsupportedBreak}追加`,
        selectionStart: 2,
        selectionEnd: 2,
    }), { code: 'FLOW_DIRECT_NON_LF_LINE_BREAK_UNSUPPORTED' },
    'Only LF is accepted; non-LF separators must not be silently normalized');
}
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
    () => createSession(group, { writingMode: 'sideways-rl' }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_WRITING_MODE_UNSUPPORTED',
);

const multilineGroup = createFixture();
multilineGroup.flow.document.sections[0].blocks[1].texts.ja = '既存\n改行';
const multilineSession = createSession(multilineGroup, { writingMode: 'vertical-rl' });
assert.equal(multilineSession.expectedText, '既存\n改行');
const multilineEdited = createFlowDirectEditTransaction(multilineGroup, multilineSession, {
    text: '既存の\n改行',
    selectionStart: 3,
    selectionEnd: 3,
});
assert.equal(multilineEdited.operation.text, '既存の\n改行');
assert.equal(multilineEdited.nextSession.expectedText, '既存の\n改行');
const multilineAfterBreakSession = createSession(multilineGroup, {
    writingMode: 'vertical-rl',
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: 4,
        affinity: 'nearest',
    },
});
const multilineAfterBreakEdited = createFlowDirectEditTransaction(
    multilineGroup,
    multilineAfterBreakSession,
    {
        text: '既存\n改訂行',
        selectionStart: 5,
        selectionEnd: 5,
    },
);
const multilineAppliedGroup = applyFlowAuthoringOperation(
    [multilineGroup],
    multilineAfterBreakEdited.operation,
)[0];
assert.equal(
    multilineAppliedGroup.flow.document.sections[0].blocks[1].texts.ja,
    '既存\n改訂行',
);
assert.equal(multilineAfterBreakEdited.selection.focusPoint.utf16Offset, 5);
assert.equal(Object.hasOwn(multilineAppliedGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(multilineAppliedGroup.flow.document, 'fragments'), false);
for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    for (const blockType of ['heading', 'paragraph']) {
        const editableGroup = createFixture();
        const target = editableGroup.flow.document.sections[0].blocks.find(entry => entry.type === blockType);
        target.texts = { ja: '既存\n改行', en: 'Existing line break' };
        target.futureField = { keep: true };
        const targetSource = JSON.stringify(editableGroup);
        for (const [action, caretBefore, text, caretAfter] of [
            ['Backspace after LF', 3, '既存改行', 2],
            ['Delete before LF', 2, '既存改行', 2],
            ['replacement across LF', 1, '既X行', 2],
            ['replacement containing LF', 1, '既X\nY行', 4],
            ['Shift+Enter adds LF', 3, '既存\n\n改行', 4],
            ['Shift+Enter at start', 0, '\n既存\n改行', 1],
            ['Shift+Enter at end', 5, '既存\n改行\n', 6],
            ['clear whole block including LF', 0, '', 0],
        ]) {
            const editableSession = createSession(editableGroup, {
                writingMode,
                sourcePoint: { sectionId: 'flow_direct_section', blockId: target.id, blockType,
                    languageKey: 'ja', utf16Offset: caretBefore, affinity: 'forward' },
            });
            const edited = createFlowDirectEditTransaction(editableGroup, editableSession, {
                text, selectionStart: caretAfter, selectionEnd: caretAfter,
            });
            const applied = applyFlowAuthoringOperation([editableGroup], edited.operation)[0];
            const resulting = applied.flow.document.sections[0].blocks.find(entry => entry.id === target.id);
            assert.equal(resulting.type, blockType);
            assert.equal(resulting.texts.ja, text, `${writingMode}/${blockType}: ${action}`);
            assert.equal(resulting.texts.en, 'Existing line break', 'Text editing must preserve saved translations');
            assert.deepEqual(resulting.futureField, { keep: true });
            assert.equal(applied.flow.document.sections[0].blocks.length, 3,
                'LF editing must not create or remove semantic Paragraphs');
            assert.equal(edited.nextSession.writingMode, writingMode);
            assert.equal(edited.selection.focusPoint.utf16Offset, caretAfter);
            assert.equal(edited.selection.focusPoint.graphemeOffset, countGraphemes(text.slice(0, caretAfter), 'ja'));
            assert.deepEqual(deriveFlowTranslationStatus(applied, 'en').body.ids.stale, [target.id]);
        }
        assert.equal(JSON.stringify(editableGroup), targetSource, 'LF transactions must not mutate source input');
    }
}
const trailingLineBreakGroup = createFixture();
const trailingLineBreakText = 'おはようございます\n\n';
const trailingLineBreakSplitOffset = 'おはようございます\n'.length;
trailingLineBreakGroup.flow.document.sections[0].blocks[1].texts.ja = trailingLineBreakText;
const trailingLineBreakSession = createSession(trailingLineBreakGroup, {
    writingMode: 'vertical-rl',
    sourcePoint: {
        sectionId: 'flow_direct_section',
        blockId: 'flow_direct_paragraph',
        blockType: 'paragraph',
        languageKey: 'ja',
        utf16Offset: trailingLineBreakSplitOffset,
        graphemeOffset: countGraphemes(
            trailingLineBreakText.slice(0, trailingLineBreakSplitOffset),
            'ja',
        ),
        affinity: 'forward',
    },
});
const trailingLineBreakSplit = createFlowDirectParagraphSplitTransaction(
    trailingLineBreakGroup,
    trailingLineBreakSession,
    {
        selectionStart: trailingLineBreakSplitOffset,
        selectionEnd: trailingLineBreakSplitOffset,
        newBlockId: 'paragraph_multiline_vertical_split',
    },
);
const trailingLineBreakSplitGroup = applyFlowAuthoringOperation(
    [trailingLineBreakGroup],
    trailingLineBreakSplit.operation,
)[0];
const trailingLineBreakParagraphs = trailingLineBreakSplitGroup.flow.document.sections[0].blocks
    .filter((block) => block.type === 'paragraph')
    .slice(0, 2);
assert.deepEqual(
    trailingLineBreakParagraphs.map((block) => block.texts.ja),
    ['おはようございます\n', '\n'],
    'vertical Enter must distribute existing line breaks across semantic Paragraphs without loss',
);
assert.equal(
    trailingLineBreakParagraphs.map((block) => block.texts.ja).join(''),
    trailingLineBreakText,
);
assert.equal(trailingLineBreakSplit.nextSession.blockId, 'paragraph_multiline_vertical_split');
assert.equal(trailingLineBreakSplit.nextSession.expectedText, '\n');
assert.equal(trailingLineBreakSplit.nextSession.selectionStart, 0);
assert.equal(Object.hasOwn(trailingLineBreakSplitGroup.flow.document, 'pages'), false);
assert.equal(Object.hasOwn(trailingLineBreakSplitGroup.flow.document, 'fragments'), false);

const horizontalTrailingLineBreakSession = createSession(trailingLineBreakGroup, {
    sourcePoint: trailingLineBreakSession.sourcePoint,
});
const horizontalTrailingLineBreakSplit = createFlowDirectParagraphSplitTransaction(
    trailingLineBreakGroup,
    horizontalTrailingLineBreakSession,
    {
        selectionStart: trailingLineBreakSplitOffset,
        selectionEnd: trailingLineBreakSplitOffset,
        newBlockId: 'paragraph_multiline_horizontal_split',
    },
);
const horizontalTrailingLineBreakSplitGroup = applyFlowAuthoringOperation(
    [trailingLineBreakGroup],
    horizontalTrailingLineBreakSplit.operation,
)[0];
assert.deepEqual(
    horizontalTrailingLineBreakSplitGroup.flow.document.sections[0].blocks
        .filter((block) => block.type === 'paragraph')
        .slice(0, 2)
        .map((block) => block.texts.ja),
    ['おはようございます\n', '\n'],
    'the shared semantic Enter operation must remain lossless in horizontal writing too',
);

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const directEditSource = await readFile(new URL('../js/flow-direct-edit.js', import.meta.url), 'utf8');
const studioCss = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
assert.match(appSource, /createFlowDirectEditTransaction\(/);
assert.match(appSource, /createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction\(/);
assert.match(appSource, /createFlowDirectHeadingParagraphTransaction\(/);
assert.match(appSource, /createFlowDirectParagraphSplitTransaction\(/);
assert.match(appSource, /createFlowDirectParagraphMergeBackwardTransaction\(/);
assert.match(appSource, /createFlowDirectParagraphMergeForwardTransaction\(/);
assert.match(appSource, /newBlockId: createId\('flow_paragraph'\)/);
assert.match(appSource, /applyFlowAuthoringEdit\(transaction\.operation, \{ immediate: true \}\)/);
assert.match(appSource, /event\.inputType === 'deleteContentBackward'/);
assert.match(appSource, /event\.inputType === 'deleteContentForward'/);
assert.match(appSource, /event\.key === 'Backspace'/);
assert.match(appSource, /event\.key === 'Delete'/);
assert.match(appSource, /function applyFlowDirectEnter\(proxy\)/);
assert.match(appSource, /function applyFlowDirectBackspace\(proxy\)/);
assert.match(appSource, /isFlowDirectParagraphImmediatelyAfterHeading\(/);
assert.match(appSource, /_flowDirectEditSession\?\.blockType === 'heading'/);
assert.match(appSource, /addEventListener\('beforeinput', handleFlowDirectBeforeInput\)/);
assert.match(appSource, /addEventListener\('compositionstart', handleFlowDirectCompositionStart\)/);
assert.match(appSource, /addEventListener\('compositionend', handleFlowDirectCompositionEnd\)/);
assert.match(appSource, /event\.isComposing \|\| event\.keyCode === 229 \|\| _flowAuthoringComposing/);
assert.match(appSource, /event\.inputType === 'insertParagraph'/);
assert.match(appSource, /event\.inputType === 'insertLineBreak'/);
assert.match(appSource, /dataset\.flowCompositionResumeReflow/);
assert.match(appSource, /_editorFlowProjectionController\?\.abort\(\)/);
assert.match(appSource, /proxy\.dataset\.flowWritingMode = session\.writingMode/);
assert.match(appSource, /writingMode: 'vertical-rl'/);
assert.match(appSource, /fontFeatureSettings/);
assert.match(appSource, /applyFlowAuthoringEdit\(transaction\.operation/);
assert.match(appSource, /historyKey: `flow:\$\{transaction\.operation\.groupId\}/);
assert.match(appSource, /immediate: true/);
assert.match(appSource, /findFlowSourcePointInPages\(/);
assert.match(studioCss, /\.flow-direct-input-proxy/);
assert.match(studioCss, /\.flow-direct-input-proxy\[data-flow-writing-mode="vertical-rl"\]/);
assert.match(studioCss, /\.flow-direct-caret/);
assert.match(studioCss, /\.flow-direct-composition\[data-flow-writing-mode="vertical-rl"\]/);
assert.match(directEditSource, /DIRECT_TEXT_WRITING_MODES = new Set\(\['horizontal-tb', 'vertical-rl'\]\)/);
assert.doesNotMatch(directEditSource, /FLOW_DIRECT_VERTICAL_STRUCTURE_UNSUPPORTED/);
assert.doesNotMatch(directEditSource, /FLOW_DIRECT_LINE_BREAK_STRUCTURE_UNSUPPORTED/);
assert.doesNotMatch(appSource, /geometry-only/);
assert.doesNotMatch(appSource, /renderFlowDirectCaretPreview/);
assert.doesNotMatch(appSource, /pageElement\.contentEditable\s*=/);

console.log('Flow direct edit verification passed.');

// Both directions preserve translations, annotations and title membership.
for (const mode of ['horizontal-tb', 'vertical-rl']) {
    const g = createFixture();
    g.flow.document.schemaVersion = 3;
    const [heading, a, b] = g.flow.document.sections[0].blocks;
    a.texts.en = 'First'; b.texts.en = 'Second';
    a.titleRegion = b.titleRegion = {id:'title',languageKey:'ja',textAlign:'center',blockAlign:'center'};
    b.annotations = {ja:[{id:'ruby',type:'ruby',start:0,end:1,reading:'あし'}],
        en:[{id:'em',type:'emphasis',start:0,end:1,mark:'sesame'}]};
    g.flow.translationState = captureFlowTranslationUnitBeforeSourceEdit(g,{unitMap:'blocks',unitId:b.id}).translationState;
    g.flow.translationState.languages.en.lockedUnitIds = [b.id];
    const before = JSON.stringify(g);
    for (const forward of [false,true]) {
        const session = forward ? createForwardMergeSession(g) : createMergeSession(g);
        const offset = forward ? a.texts.ja.length : 0;
        const tx = (forward ? createFlowDirectParagraphMergeForwardTransaction : createFlowDirectParagraphMergeBackwardTransaction)(g,
            {...session,writingMode:mode},{selectionStart:offset,selectionEnd:offset});
        const merged = applyFlowAuthoringOperation([g],tx.operation)[0];
        const target = merged.flow.document.sections[0].blocks[1];
        assert.equal(target.texts.en,'First\nSecond');
        assert.equal(target.texts.ja,a.texts.ja+b.texts.ja);
        assert.equal(target.annotations.en[0].start,6);
        assert.equal(target.annotations.ja[0].start,a.texts.ja.length);
        assert.deepEqual(target.titleRegion,a.titleRegion);
        assert.equal(merged.flow.translationState.languages.en.reviewState,'needs-review');
        assert.deepEqual(merged.flow.translationState.languages.en.lockedUnitIds,[a.id]);
        assert.equal(Object.hasOwn(merged.flow.translationState.languages.en.sourceFingerprints.blocks,b.id),false);
        assert.deepEqual(deriveFlowTranslationStatus(merged,'en').body.ids.stale,[a.id]);
        assert.equal(tx.nextSession.selectionStart,a.texts.ja.length);
    }
    assert.equal(JSON.stringify(g),before);
    delete b.titleRegion;
    assert.throws(()=>createFlowDirectParagraphMergeBackwardTransaction(g,createMergeSession(g),{selectionStart:0,selectionEnd:0}),{code:'FLOW_DIRECT_MERGE_TITLE_BOUNDARY'});
}
console.log('Translated paragraph joins: both keys/modes, annotation offsets, review status, title boundary and immutable input passed.');
