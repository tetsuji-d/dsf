import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    FlowDirectEditError,
    createFlowDirectEditSession,
    createFlowDirectEditTransaction,
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

function createPageBoundaryPaginator(pageBox, measurePage) {
    return createIncrementalFlowPaginator({
        pageBox,
        languageKey: 'ja',
        writingMode: 'horizontal-tb',
        measurePage,
        measurementKey: 'flow-direct-page-boundary-capacity-5',
        getPageVariantKey: () => 'uniform',
    });
}

function paginatePageBoundary(paginator, group, pageBox, measurePage) {
    const result = paginator.paginate(group.flow.document);
    const cold = paginateFlowDocument(group.flow.document, {
        pageBox,
        languageKey: 'ja',
        writingMode: 'horizontal-tb',
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

const mergeSession = createMergeSession(group);
const merge = createFlowDirectParagraphMergeBackwardTransaction(group, mergeSession, {
    selectionStart: 0,
    selectionEnd: 0,
});
const mergeJoinOffset = '雪👩‍💻の日'.length;
assert.deepEqual(merge.operation, {
    type: 'mergeParagraphBackward',
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
assert.throws(
    () => createFlowDirectParagraphMergeBackwardTransaction(translatedMergeGroup, translatedMergeSession, {
        selectionStart: 0,
        selectionEnd: 0,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT',
);

const forwardMergeSession = createForwardMergeSession(group);
const forwardMergeInputJson = JSON.stringify(group);
const forwardMerge = createFlowDirectParagraphMergeForwardTransaction(group, forwardMergeSession, {
    selectionStart: forwardMergeSession.expectedText.length,
    selectionEnd: forwardMergeSession.expectedText.length,
});
assert.equal(JSON.stringify(group), forwardMergeInputJson, 'Forward Paragraph merge planning must not mutate source');
assert.deepEqual(forwardMerge.operation, {
    type: 'mergeParagraphBackward',
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
assert.throws(
    () => createFlowDirectParagraphMergeForwardTransaction(translatedForwardGroup, translatedForwardSession, {
        selectionStart: translatedForwardSession.expectedText.length,
        selectionEnd: translatedForwardSession.expectedText.length,
    }),
    (error) => error instanceof FlowDirectEditError
        && error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT',
);

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
assert.match(appSource, /_flowDirectEditSession\?\.blockType === 'heading'/);
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
