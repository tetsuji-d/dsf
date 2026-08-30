/**
 * Pure contract for editing semantic Flow text from a generated page.
 *
 * Generated page DOM is only a hit-test/rendering surface. The returned
 * operation always targets the persisted heading/paragraph source block.
 */

import { mapFlowTextUtf16OffsetToGrapheme } from './flow-source-mapping.js';

const DIRECT_TEXT_TYPES = new Set(['heading', 'paragraph']);
const DIRECT_TEXT_WRITING_MODES = new Set(['horizontal-tb', 'vertical-rl']);
const UNSUPPORTED_LINE_BREAK = /[\r\n\u2028\u2029]/u;

export class FlowDirectEditError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowDirectEditError';
        this.code = code;
        this.context = context;
    }
}

function fail(code, message, context = {}) {
    throw new FlowDirectEditError(code, message, context);
}

function requireFlowGroup(group) {
    if (group?.kind !== 'flow' || !group.id || !group.flow?.document) {
        fail('FLOW_GROUP_REQUIRED', 'Direct editing requires one semantic Flow group.');
    }
    return group;
}

function requireSourceTarget(group, sectionId, blockId) {
    const section = group.flow.document.sections?.find((entry) => entry?.id === sectionId);
    if (!section) fail('FLOW_SECTION_NOT_FOUND', `Flow section not found: ${sectionId}`, { sectionId });
    const block = section.blocks?.find((entry) => entry?.id === blockId);
    if (!block) fail('FLOW_BLOCK_NOT_FOUND', `Flow block not found: ${blockId}`, { blockId });
    if (!DIRECT_TEXT_TYPES.has(block.type)) {
        fail('FLOW_BLOCK_NOT_DIRECT_TEXT', 'Only heading and paragraph blocks support direct page editing.', {
            blockId,
            blockType: block.type,
        });
    }
    return { section, block };
}

function requireSingleLineText(value, code = 'FLOW_DIRECT_MULTILINE_UNSUPPORTED') {
    if (typeof value !== 'string') fail('FLOW_DIRECT_TEXT_INVALID', 'Direct Flow text must be a string.');
    if (UNSUPPORTED_LINE_BREAK.test(value)) {
        fail(code, 'Direct page editing does not yet change paragraph structure or line-break blocks.');
    }
    return value;
}

function requireSelectionOffset(value, maximum, name) {
    const offset = Number(value);
    if (!Number.isInteger(offset) || offset < 0 || offset > maximum) {
        fail('FLOW_DIRECT_SELECTION_INVALID', `${name} is outside the semantic text.`, {
            [name]: value,
            maximum,
        });
    }
    return offset;
}

function createSourcePoint(target, text, utf16Offset, affinity = 'nearest') {
    const mapped = mapFlowTextUtf16OffsetToGrapheme(
        text,
        utf16Offset,
        target.languageKey,
        affinity,
    );
    return Object.freeze({
        sectionId: target.sectionId,
        blockId: target.blockId,
        blockType: target.blockType,
        languageKey: target.languageKey,
        graphemeOffset: mapped.graphemeOffset,
        utf16Offset: mapped.utf16Offset,
        affinity: String(affinity || 'nearest'),
    });
}

function requireCurrentDirectSession(groupInput, session) {
    const group = requireFlowGroup(groupInput);
    if (!session || session.groupId !== group.id) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit session no longer targets the active Flow group.');
    }
    const sourceLanguage = String(group.flow.document.sourceLanguage || '');
    if (session.languageKey !== sourceLanguage || !DIRECT_TEXT_WRITING_MODES.has(session.writingMode)) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit language or writing mode changed.');
    }
    const { section, block } = requireSourceTarget(group, session.sectionId, session.blockId);
    if (block.type !== session.blockType) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit source block changed type.');
    }
    const currentText = requireSingleLineText(block.texts?.[sourceLanguage] ?? '');
    if (currentText !== session.expectedText) {
        fail('FLOW_DIRECT_SOURCE_STALE', 'The semantic source changed after the generated page was rendered.', {
            expectedText: session.expectedText,
            currentText,
        });
    }
    return { group, sourceLanguage, section, block, currentText };
}

function requireHorizontalStructuralSession(session) {
    if (session?.writingMode !== 'horizontal-tb') {
        fail(
            'FLOW_DIRECT_VERTICAL_STRUCTURE_UNSUPPORTED',
            'Vertical direct editing does not yet change Heading or Paragraph structure.',
            { writingMode: session?.writingMode || '' },
        );
    }
}

function requireNewBlockId(value) {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        fail('FLOW_DIRECT_NEW_BLOCK_ID_INVALID', 'Structural direct editing requires one exact new block ID.', {
            newBlockId: value,
        });
    }
    return value;
}

function requireMergeRemovalSafe(block, sourceLanguage) {
    const translatedLanguageKeys = Object.entries(block.texts || {})
        .filter(([key, value]) => key !== sourceLanguage && typeof value === 'string')
        .map(([key]) => key);
    if (translatedLanguageKeys.length) {
        fail('FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT', 'A Paragraph with saved translations cannot be removed by merging.', {
            blockId: block.id,
            translatedLanguageKeys,
        });
    }
}

function requireDisposableEmptyParagraph(group, block, sourceLanguage) {
    const texts = block?.texts;
    const hasExactEmptySource = !!texts
        && typeof texts === 'object'
        && !Array.isArray(texts)
        && Object.prototype.hasOwnProperty.call(texts, sourceLanguage)
        && texts[sourceLanguage] === '';
    const textKeys = texts && typeof texts === 'object' && !Array.isArray(texts)
        ? Object.keys(texts)
        : [];
    const extraBlockKeys = Object.keys(block || {})
        .filter((key) => key !== 'id' && key !== 'type' && key !== 'texts');
    const translationMetadataLanguages = Object.entries(group.flow?.translationState?.languages || {})
        .filter(([, languageState]) => (
            Object.prototype.hasOwnProperty.call(languageState?.sourceFingerprints?.blocks || {}, block.id)
            || (Array.isArray(languageState?.lockedUnitIds) && languageState.lockedUnitIds.includes(block.id))
        ))
        .map(([languageKey]) => languageKey);
    if (
        !hasExactEmptySource
        || textKeys.length !== 1
        || textKeys[0] !== sourceLanguage
        || extraBlockKeys.length
        || translationMetadataLanguages.length
    ) {
        fail('FLOW_DIRECT_EMPTY_PARAGRAPH_DATA_PRESENT', 'Only an exact source-only empty Paragraph can be removed directly.', {
            blockId: block?.id || '',
            textKeys,
            extraBlockKeys,
            translationMetadataLanguages,
        });
    }
}

/** Validate a page hit and create a runtime-only direct-edit session. */
export function createFlowDirectEditSession(groupInput, options = {}) {
    const group = requireFlowGroup(groupInput);
    const sourceLanguage = String(group.flow.document.sourceLanguage || '');
    const pageLanguageKey = String(options.pageLanguageKey || '');
    const writingMode = String(options.writingMode || '');
    const sourcePoint = options.sourcePoint;

    if (options.isSourceFallback === true) {
        fail('FLOW_DIRECT_SOURCE_FALLBACK', 'A fallback rendering cannot edit the requested language.');
    }
    if (!sourceLanguage || pageLanguageKey !== sourceLanguage) {
        fail('FLOW_DIRECT_SOURCE_LANGUAGE_ONLY', 'Direct page editing currently supports the source language only.', {
            sourceLanguage,
            pageLanguageKey,
        });
    }
    if (!DIRECT_TEXT_WRITING_MODES.has(writingMode)) {
        fail('FLOW_DIRECT_WRITING_MODE_UNSUPPORTED', 'Direct page editing requires horizontal-tb or vertical-rl.', {
            writingMode,
        });
    }
    if (
        !sourcePoint
        || String(sourcePoint.languageKey || '') !== sourceLanguage
        || !String(sourcePoint.sectionId || '')
        || !String(sourcePoint.blockId || '')
    ) {
        fail('FLOW_DIRECT_SOURCE_POINT_INVALID', 'A complete source-language caret is required.');
    }

    const sectionId = String(sourcePoint.sectionId);
    const blockId = String(sourcePoint.blockId);
    const { block } = requireSourceTarget(group, sectionId, blockId);
    if (sourcePoint.blockType && sourcePoint.blockType !== block.type) {
        fail('FLOW_DIRECT_BLOCK_TYPE_MISMATCH', 'The generated fragment no longer matches its source block.', {
            renderedBlockType: sourcePoint.blockType,
            sourceBlockType: block.type,
        });
    }
    const text = requireSingleLineText(block.texts?.[sourceLanguage] ?? '');
    const utf16Offset = requireSelectionOffset(sourcePoint.utf16Offset, text.length, 'utf16Offset');
    const mapped = mapFlowTextUtf16OffsetToGrapheme(
        text,
        utf16Offset,
        sourceLanguage,
        sourcePoint.affinity,
    );
    if (
        sourcePoint.graphemeOffset !== undefined
        && sourcePoint.graphemeOffset !== null
        && Number(sourcePoint.graphemeOffset) !== mapped.graphemeOffset
    ) {
        fail('FLOW_DIRECT_SOURCE_OFFSET_MISMATCH', 'UTF-16 and grapheme offsets identify different carets.', {
            sourcePoint,
            mapped,
        });
    }

    return Object.freeze({
        groupId: group.id,
        sectionId,
        blockId,
        blockType: block.type,
        languageKey: sourceLanguage,
        writingMode,
        expectedText: text,
        selectionStart: mapped.utf16Offset,
        selectionEnd: mapped.utf16Offset,
        selectionDirection: 'none',
        sourcePoint: createSourcePoint({
            sectionId,
            blockId,
            blockType: block.type,
            languageKey: sourceLanguage,
        }, text, mapped.utf16Offset, sourcePoint.affinity),
    });
}

/**
 * Convert the current textarea value into one semantic setText transaction.
 * Stale source and structural line breaks are rejected before state mutation.
 */
export function createFlowDirectEditTransaction(groupInput, session, input = {}) {
    const { group, sourceLanguage } = requireCurrentDirectSession(groupInput, session);
    const text = requireSingleLineText(input.text, 'FLOW_DIRECT_STRUCTURAL_EDIT_UNSUPPORTED');
    const selectionStart = requireSelectionOffset(input.selectionStart, text.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, text.length, 'selectionEnd');
    if (selectionStart > selectionEnd) {
        fail('FLOW_DIRECT_SELECTION_INVALID', 'selectionStart must not exceed selectionEnd.');
    }
    const selectionDirection = input.selectionDirection === 'backward' ? 'backward' : 'none';
    const target = {
        sectionId: session.sectionId,
        blockId: session.blockId,
        blockType: session.blockType,
        languageKey: sourceLanguage,
    };
    const collapsed = selectionStart === selectionEnd;
    const startPoint = createSourcePoint(target, text, selectionStart, 'forward');
    const endPoint = createSourcePoint(target, text, selectionEnd, collapsed ? 'forward' : 'backward');
    const focusPoint = selectionDirection === 'backward' ? startPoint : endPoint;

    return Object.freeze({
        operation: Object.freeze({
            type: 'setText',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: session.blockId,
            languageKey: sourceLanguage,
            text,
        }),
        nextSession: Object.freeze({
            ...session,
            expectedText: text,
            selectionStart,
            selectionEnd,
            selectionDirection,
            sourcePoint: focusPoint,
        }),
        selection: Object.freeze({
            startPoint,
            endPoint,
            focusPoint,
            selectionStart,
            selectionEnd,
            selectionDirection,
        }),
    });
}

/**
 * Convert a collapsed Enter caret into one atomic semantic Paragraph split.
 * Translations are never divided by a source-language offset.
 */
export function createFlowDirectParagraphSplitTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
    requireHorizontalStructuralSession(session);
    if (block.type !== 'paragraph') {
        fail('FLOW_DIRECT_PARAGRAPH_REQUIRED', 'Enter directly splits Paragraph blocks only.', {
            blockId: block.id,
            blockType: block.type,
        });
    }
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'Paragraph splitting requires a collapsed caret.', {
            selectionStart,
            selectionEnd,
        });
    }
    const splitPoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: session.blockId,
        blockType: block.type,
        languageKey: sourceLanguage,
    }, currentText, selectionStart, 'nearest');
    if (splitPoint.utf16Offset !== selectionStart) {
        fail('FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED', 'Paragraphs can only split between complete graphemes.', {
            utf16Offset: selectionStart,
            snappedUtf16Offset: splitPoint.utf16Offset,
        });
    }
    const newBlockId = requireNewBlockId(input.newBlockId);
    const nextText = currentText.slice(selectionStart);
    const nextSourcePoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: newBlockId,
        blockType: 'paragraph',
        languageKey: sourceLanguage,
    }, nextText, 0, 'forward');

    return Object.freeze({
        operation: Object.freeze({
            type: 'splitParagraph',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: session.blockId,
            languageKey: sourceLanguage,
            utf16Offset: selectionStart,
            newBlockId,
        }),
        nextSession: Object.freeze({
            ...session,
            blockId: newBlockId,
            blockType: 'paragraph',
            expectedText: nextText,
            selectionStart: 0,
            selectionEnd: 0,
            selectionDirection: 'none',
            sourcePoint: nextSourcePoint,
        }),
        selection: Object.freeze({
            splitPoint,
            focusPoint: nextSourcePoint,
            selectionStart: 0,
            selectionEnd: 0,
            selectionDirection: 'none',
        }),
    });
}

/**
 * Convert Enter at a source Heading end into one empty source Paragraph.
 * The Heading text, identity, level, translations, and unknown fields remain untouched.
 */
export function createFlowDirectHeadingParagraphTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
    requireHorizontalStructuralSession(session);
    if (block.type !== 'heading') {
        fail('FLOW_DIRECT_HEADING_REQUIRED', 'Heading Paragraph insertion requires a Heading block.', {
            blockId: block.id,
            blockType: block.type,
        });
    }
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'Heading Paragraph insertion requires a collapsed caret.', {
            selectionStart,
            selectionEnd,
        });
    }
    if (selectionEnd !== currentText.length) {
        fail('FLOW_DIRECT_HEADING_END_REQUIRED', 'Heading Paragraph insertion requires a caret at the Heading end.', {
            selectionEnd,
            maximum: currentText.length,
        });
    }
    const newBlockId = requireNewBlockId(input.newBlockId);
    const nextSourcePoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: newBlockId,
        blockType: 'paragraph',
        languageKey: sourceLanguage,
    }, '', 0, 'forward');

    return Object.freeze({
        operation: Object.freeze({
            type: 'insertBlock',
            groupId: group.id,
            sectionId: session.sectionId,
            afterBlockId: session.blockId,
            blockType: 'paragraph',
            languageKey: sourceLanguage,
            newBlockId,
        }),
        nextSession: Object.freeze({
            ...session,
            blockId: newBlockId,
            blockType: 'paragraph',
            expectedText: '',
            selectionStart: 0,
            selectionEnd: 0,
            selectionDirection: 'none',
            sourcePoint: nextSourcePoint,
        }),
        selection: Object.freeze({
            focusPoint: nextSourcePoint,
            selectionStart: 0,
            selectionEnd: 0,
            selectionDirection: 'none',
        }),
    });
}

/**
 * Remove one exact source-only empty Paragraph immediately after a Heading.
 * The preceding Heading is not edited; the caret returns to its source-text end.
 */
export function createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        section,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
    requireHorizontalStructuralSession(session);
    if (block.type !== 'paragraph') {
        fail('FLOW_DIRECT_PARAGRAPH_REQUIRED', 'Empty Paragraph removal requires a Paragraph block.', {
            blockId: block.id,
            blockType: block.type,
        });
    }
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'Empty Paragraph removal requires a collapsed caret.', {
            selectionStart,
            selectionEnd,
        });
    }
    if (selectionStart !== 0) {
        fail('FLOW_DIRECT_PARAGRAPH_START_REQUIRED', 'Empty Paragraph removal requires a caret at the Paragraph start.', {
            selectionStart,
        });
    }
    if (currentText !== '') {
        fail('FLOW_DIRECT_EMPTY_PARAGRAPH_REQUIRED', 'Backspace after a Heading only removes an empty Paragraph.', {
            blockId: block.id,
            textLength: currentText.length,
        });
    }

    const blockIndex = section.blocks.findIndex((entry) => entry?.id === block.id);
    const previousBlock = section.blocks[blockIndex - 1];
    if (previousBlock?.type !== 'heading') {
        fail('FLOW_DIRECT_PREVIOUS_HEADING_REQUIRED', 'Empty Paragraph removal requires an immediately preceding Heading.', {
            blockId: block.id,
            previousBlockId: previousBlock?.id || '',
            previousBlockType: previousBlock?.type || '',
        });
    }
    requireDisposableEmptyParagraph(group, block, sourceLanguage);

    const headingText = requireSingleLineText(previousBlock.texts?.[sourceLanguage] ?? '');
    const headingEnd = headingText.length;
    const focusPoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: previousBlock.id,
        blockType: 'heading',
        languageKey: sourceLanguage,
    }, headingText, headingEnd, 'backward');

    return Object.freeze({
        operation: Object.freeze({
            type: 'removeBlock',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: block.id,
        }),
        nextSession: Object.freeze({
            ...session,
            blockId: previousBlock.id,
            blockType: 'heading',
            expectedText: headingText,
            selectionStart: headingEnd,
            selectionEnd: headingEnd,
            selectionDirection: 'none',
            sourcePoint: focusPoint,
        }),
        selection: Object.freeze({
            focusPoint,
            selectionStart: headingEnd,
            selectionEnd: headingEnd,
            selectionDirection: 'none',
        }),
    });
}

/**
 * Convert Backspace at the start of a Paragraph into one atomic backward merge.
 * The removed Paragraph must not own saved target-language text.
 */
export function createFlowDirectParagraphMergeBackwardTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        section,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
    requireHorizontalStructuralSession(session);
    if (block.type !== 'paragraph') {
        fail('FLOW_DIRECT_PARAGRAPH_REQUIRED', 'Backspace directly merges Paragraph blocks only.', {
            blockId: block.id,
            blockType: block.type,
        });
    }
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'Paragraph merging requires a collapsed caret.', {
            selectionStart,
            selectionEnd,
        });
    }
    if (selectionStart !== 0) {
        fail('FLOW_DIRECT_PARAGRAPH_START_REQUIRED', 'Paragraph merging requires a caret at the Paragraph start.', {
            selectionStart,
        });
    }

    const blockIndex = section.blocks.findIndex((entry) => entry?.id === block.id);
    const previousBlock = section.blocks[blockIndex - 1];
    if (previousBlock?.type !== 'paragraph') {
        fail('FLOW_DIRECT_PREVIOUS_PARAGRAPH_REQUIRED', 'Paragraph merging requires an immediately preceding Paragraph.', {
            blockId: block.id,
            previousBlockId: previousBlock?.id || '',
            previousBlockType: previousBlock?.type || '',
        });
    }
    requireMergeRemovalSafe(block, sourceLanguage);

    const previousText = requireSingleLineText(previousBlock.texts?.[sourceLanguage] ?? '');
    const mergedText = previousText + currentText;
    const joinOffset = previousText.length;
    const focusPoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: previousBlock.id,
        blockType: 'paragraph',
        languageKey: sourceLanguage,
    }, mergedText, joinOffset, 'forward');

    return Object.freeze({
        operation: Object.freeze({
            type: 'mergeParagraphBackward',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: session.blockId,
            languageKey: sourceLanguage,
        }),
        nextSession: Object.freeze({
            ...session,
            blockId: previousBlock.id,
            blockType: 'paragraph',
            expectedText: mergedText,
            selectionStart: joinOffset,
            selectionEnd: joinOffset,
            selectionDirection: 'none',
            sourcePoint: focusPoint,
        }),
        selection: Object.freeze({
            focusPoint,
            selectionStart: joinOffset,
            selectionEnd: joinOffset,
            selectionDirection: 'none',
        }),
    });
}

/**
 * Convert Delete at the end of a Paragraph into one atomic forward merge.
 * The following Paragraph is removed through the shared backward-merge operation.
 */
export function createFlowDirectParagraphMergeForwardTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        section,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
    requireHorizontalStructuralSession(session);
    if (block.type !== 'paragraph') {
        fail('FLOW_DIRECT_PARAGRAPH_REQUIRED', 'Delete directly merges Paragraph blocks only.', {
            blockId: block.id,
            blockType: block.type,
        });
    }
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'Forward Paragraph merging requires a collapsed caret.', {
            selectionStart,
            selectionEnd,
        });
    }
    if (selectionEnd !== currentText.length) {
        fail('FLOW_DIRECT_PARAGRAPH_END_REQUIRED', 'Forward Paragraph merging requires a caret at the Paragraph end.', {
            selectionEnd,
            maximum: currentText.length,
        });
    }

    const blockIndex = section.blocks.findIndex((entry) => entry?.id === block.id);
    const nextBlock = section.blocks[blockIndex + 1];
    if (nextBlock?.type !== 'paragraph') {
        fail('FLOW_DIRECT_NEXT_PARAGRAPH_REQUIRED', 'Forward Paragraph merging requires an immediately following Paragraph.', {
            blockId: block.id,
            nextBlockId: nextBlock?.id || '',
            nextBlockType: nextBlock?.type || '',
        });
    }
    requireMergeRemovalSafe(nextBlock, sourceLanguage);

    const nextText = requireSingleLineText(nextBlock.texts?.[sourceLanguage] ?? '');
    const mergedText = currentText + nextText;
    const joinOffset = currentText.length;
    const focusPoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: block.id,
        blockType: 'paragraph',
        languageKey: sourceLanguage,
    }, mergedText, joinOffset, 'forward');

    return Object.freeze({
        operation: Object.freeze({
            type: 'mergeParagraphBackward',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: nextBlock.id,
            languageKey: sourceLanguage,
        }),
        nextSession: Object.freeze({
            ...session,
            expectedText: mergedText,
            selectionStart: joinOffset,
            selectionEnd: joinOffset,
            selectionDirection: 'none',
            sourcePoint: focusPoint,
        }),
        selection: Object.freeze({
            focusPoint,
            selectionStart: joinOffset,
            selectionEnd: joinOffset,
            selectionDirection: 'none',
        }),
    });
}
