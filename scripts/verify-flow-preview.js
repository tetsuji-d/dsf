import assert from 'node:assert/strict';
import { validateFlowDocument } from '../js/flow-document.js';
import { countGraphemes } from '../js/grapheme.js';
import { createCanonicalFlowPageBox, paginateFlowDocument } from '../js/flow-pagination.js';
import {
    FLOW_PREVIEW_PAGE_BREAK_MARKER,
    countFlowPreviewSourceGraphemes,
    createFlowPreviewDocument,
    insertFlowPreviewPageBreak,
    parseFlowPreviewBody,
} from '../js/flow-preview-model.js';
import {
    FlowDomMeasurementError,
    assertFlowDomWritingMode,
    resolveFlowDomTypography,
} from '../js/flow-dom-measurer.js';

const parsed = parseFlowPreviewBody([
    '第一段落',
    '第二段落',
    FLOW_PREVIEW_PAGE_BREAK_MARKER,
    '===',
    'これは通常文字',
].join('\n'));
assert.deepEqual(parsed.map((block) => block.type), [
    'paragraph',
    'paragraph',
    'pageBreak',
    'paragraph',
    'paragraph',
]);
assert.equal(parsed[0].texts.ja, '第一段落');
assert.equal(parsed[1].texts.ja, '第二段落');
assert.equal(parsed[2].type, 'pageBreak');
assert.equal(parsed[3].texts.ja, '===');
assert.equal(parsed[4].texts.ja, 'これは通常文字');

const blankParagraphs = parseFlowPreviewBody('A\n\nB\n');
assert.deepEqual(blankParagraphs.map((block) => block.texts?.ja), ['A', '', 'B', '']);

const consecutiveBreaks = parseFlowPreviewBody([
    FLOW_PREVIEW_PAGE_BREAK_MARKER,
    FLOW_PREVIEW_PAGE_BREAK_MARKER,
].join('\n'));
assert.deepEqual(consecutiveBreaks.map((block) => block.type), ['pageBreak', 'pageBreak']);

const empty = parseFlowPreviewBody('');
assert.equal(empty.length, 1);
assert.equal(empty[0].type, 'paragraph');
assert.equal(empty[0].texts.ja, '');

const inserted = insertFlowPreviewPageBreak('ABCD', 2, 2);
assert.equal(inserted.value, `AB\n${FLOW_PREVIEW_PAGE_BREAK_MARKER}\nCD`);
assert.deepEqual(parseFlowPreviewBody(inserted.value).map((block) => block.type), [
    'paragraph',
    'pageBreak',
    'paragraph',
]);

const insertedAtEnd = insertFlowPreviewPageBreak('A', 1, 1);
assert.equal(insertedAtEnd.value, `A\n${FLOW_PREVIEW_PAGE_BREAK_MARKER}\n`);
assert.deepEqual(parseFlowPreviewBody(`${insertedAtEnd.value}B`).map((block) => block.type), [
    'paragraph',
    'pageBreak',
    'paragraph',
]);

const insertedBeforeSelection = insertFlowPreviewPageBreak('重要本文を残す', 0, 4);
assert.equal(insertedBeforeSelection.value, `${FLOW_PREVIEW_PAGE_BREAK_MARKER}\n重要本文を残す`);
assert.equal(insertedBeforeSelection.value.includes('重要本文'), true);
assert.equal(insertedBeforeSelection.selectionEnd - insertedBeforeSelection.selectionStart, 4);
const backwardSelection = insertFlowPreviewPageBreak('重要本文を残す', 0, 4, {
    selectionDirection: 'backward',
});
assert.equal(backwardSelection.selectionDirection, 'backward');
assert.equal(countFlowPreviewSourceGraphemes('章', '本文'), 3);

const document = createFlowPreviewDocument({
    heading: '第1章',
    body: inserted.value,
});
assert.equal(validateFlowDocument(document).valid, true);
assert.deepEqual(document.sections[0].blocks.map((block) => block.type), [
    'heading',
    'paragraph',
    'pageBreak',
    'paragraph',
]);

const pageBox = createCanonicalFlowPageBox();
const pages = paginateFlowDocument(document, {
    pageBox,
    writingMode: 'horizontal-tb',
    measurePage: ({ fragments }) => ({
        fits: fragments.reduce((total, fragment) => (
            total + Math.max(1, countGraphemes(fragment.text, fragment.languageKey))
        ), 0) <= 20,
    }),
});
assert.equal(pages.pages.length, 2);
assert.equal(pages.pages[1].manualBreakBefore?.blockId, 'flow_preview_page_break_1');

const typography = resolveFlowDomTypography('ja');
assert.equal(typography.fontSize, 16);
assert.equal(typography.lineHeight, 1.8);
assert.equal(typography.paragraphSpacing, 12);
assert.equal(assertFlowDomWritingMode(), 'horizontal-tb');
assert.throws(
    () => assertFlowDomWritingMode('vertical-rl'),
    (error) => error instanceof FlowDomMeasurementError && error.code === 'UNSUPPORTED_WRITING_MODE',
);
assert.throws(
    () => resolveFlowDomTypography('ja', { fontSize: 0 }),
    (error) => error instanceof FlowDomMeasurementError && error.code === 'INVALID_TYPOGRAPHY',
);

console.log('Flow DOM preview contract verification passed.');
