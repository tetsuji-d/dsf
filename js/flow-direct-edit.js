/**
 * Pure contract for editing semantic Flow text from a generated page.
 *
 * Generated page DOM is only a hit-test/rendering surface. The returned
 * operation always targets the persisted heading/paragraph source block.
 */

import { inspectFlowParagraphMerge } from './flow-paragraph-merge.js';
import { mapFlowTextUtf16OffsetToGrapheme } from './flow-source-mapping.js';

const DIRECT_TEXT_TYPES = new Set(['heading', 'paragraph']);
const DIRECT_TEXT_WRITING_MODES = new Set(['horizontal-tb', 'vertical-rl']);
const UNSUPPORTED_DIRECT_TEXT_LINE_BREAK = /[\r\u2028\u2029]/u;

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

function requireDirectText(value) {
    if (typeof value !== 'string') fail('FLOW_DIRECT_TEXT_INVALID', 'Direct Flow text must be a string.');
    return value;
}

function requireDirectEditableText(value) {
    const text = requireDirectText(value);
    if (UNSUPPORTED_DIRECT_TEXT_LINE_BREAK.test(text)) {
        fail(
            'FLOW_DIRECT_NON_LF_LINE_BREAK_UNSUPPORTED',
            'Direct page editing currently supports embedded LF line breaks only.',
        );
    }
    return text;
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

function requireCurrentDirectSession(groupInput, session, allowTranslation = false) {
    const group = requireFlowGroup(groupInput);
    if (!session || session.groupId !== group.id) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit session no longer targets the active Flow group.');
    }
    const sourceLanguage = String(group.flow.document.sourceLanguage || '');
    if ((!allowTranslation && session.languageKey !== sourceLanguage) || !DIRECT_TEXT_WRITING_MODES.has(session.writingMode)) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit language or writing mode changed.');
    }
    const { section, block } = requireSourceTarget(group, session.sectionId, session.blockId);
    if (block.type !== session.blockType) {
        fail('FLOW_DIRECT_SESSION_STALE', 'The direct-edit source block changed type.');
    }
    const languageKey = session.languageKey;
    if (languageKey !== sourceLanguage && !Object.hasOwn(block.texts || {}, languageKey)) fail('FLOW_DIRECT_SOURCE_FALLBACK', 'The exact language text is missing.');
    const currentText = requireDirectEditableText(block.texts?.[languageKey] ?? '');
    if (currentText !== session.expectedText) {
        fail('FLOW_DIRECT_SOURCE_STALE', 'The semantic source changed after the generated page was rendered.', {
            expectedText: session.expectedText,
            currentText,
        });
    }
    return { group, sourceLanguage, languageKey, section, block, currentText };
}

function requireNewBlockId(value) {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        fail('FLOW_DIRECT_NEW_BLOCK_ID_INVALID', 'Structural direct editing requires one exact new block ID.', {
            newBlockId: value,
        });
    }
    return value;
}

function requireMergeRemovalSafe(left, right) {
    const reason = inspectFlowParagraphMerge(left, right);
    if (reason) fail('FLOW_DIRECT_MERGE_' + reason, 'Paragraph settings must be compatible before merging.');
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
    if (!sourceLanguage || !pageLanguageKey) {
        fail('FLOW_DIRECT_LANGUAGE_REQUIRED', 'An exact page language is required.', {
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
        || String(sourcePoint.languageKey || '') !== pageLanguageKey
        || !String(sourcePoint.sectionId || '')
        || !String(sourcePoint.blockId || '')
    ) {
        fail('FLOW_DIRECT_SOURCE_POINT_INVALID', 'A complete caret for the displayed language is required.');
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
    if (pageLanguageKey !== sourceLanguage && !Object.hasOwn(block.texts || {}, pageLanguageKey)) fail('FLOW_DIRECT_SOURCE_FALLBACK', 'The exact language text is missing.');
    const text = requireDirectEditableText(block.texts?.[pageLanguageKey] ?? '');
    const utf16Offset = requireSelectionOffset(sourcePoint.utf16Offset, text.length, 'utf16Offset');
    const mapped = mapFlowTextUtf16OffsetToGrapheme(
        text,
        utf16Offset,
        pageLanguageKey,
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
        languageKey: pageLanguageKey,
        writingMode,
        expectedText: text,
        selectionStart: mapped.utf16Offset,
        selectionEnd: mapped.utf16Offset,
        selectionDirection: 'none',
        sourcePoint: createSourcePoint({
            sectionId,
            blockId,
            blockType: block.type,
            languageKey: pageLanguageKey,
        }, text, mapped.utf16Offset, sourcePoint.affinity),
    });
}

/** Change the active semantic block's role without replacing text or identity. */
export function createFlowDirectBlockFormatTransaction(groupInput, session, input = {}) {
    const { group, block } = requireCurrentDirectSession(groupInput, session);
    const blockType = input.blockType;
    if (!DIRECT_TEXT_TYPES.has(blockType)) {
        fail('FLOW_DIRECT_FORMAT_INVALID', 'Direct format must be heading or paragraph.');
    }
    const level = blockType === 'heading' ? Number(input.level ?? (block.type === 'heading' ? block.level : 1)) : null;
    if ((blockType === 'heading' && (!Number.isInteger(level) || level < 1 || level > 6))
        || (blockType === 'paragraph' && input.level !== undefined)) {
        fail('FLOW_DIRECT_FORMAT_INVALID', 'Only heading levels 1 through 6 are supported.');
    }
    if (block.type === blockType && (blockType === 'paragraph' || block.level === level)) return null;
    return Object.freeze({
        operation: Object.freeze({
            type: 'setBlockType', groupId: group.id, sectionId: session.sectionId,
            blockId: session.blockId, blockType,
            ...(blockType === 'heading' ? { level } : {}),
        }),
        nextSession: Object.freeze({
            ...session, blockType,
            sourcePoint: Object.freeze({ ...session.sourcePoint, blockType }),
        }),
    });
}

/**
 * Convert the current textarea value into one semantic setText transaction.
 * LF stays inside the same semantic block: it may be inserted, deleted, or
 * replaced without creating/removing blocks. Stale source and non-LF line
 * separators are rejected before state mutation.
 */
export function createFlowDirectEditTransaction(groupInput, session, input = {}) {
    const { group, languageKey } = requireCurrentDirectSession(groupInput, session, true);
    const text = requireDirectEditableText(input.text);
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
        languageKey,
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
            languageKey,
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

/** Replace a selection and split a heading/paragraph in one semantic transaction. */
export function createFlowDirectTextSplitTransaction(groupInput, session, input = {}) {
    const { group, sourceLanguage, block, currentText } = requireCurrentDirectSession(groupInput, session);
    const start = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const end = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (start > end) fail('FLOW_DIRECT_SELECTION_INVALID', 'Selection start must precede its end.');
    const target = { sectionId: session.sectionId, blockId: block.id, blockType: block.type, languageKey: sourceLanguage };
    if ([start, end].some(offset => createSourcePoint(target, currentText, offset).utf16Offset !== offset)) {
        fail('FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED', 'Split endpoints must be complete grapheme boundaries.');
    }
    const newBlockId = requireNewBlockId(input.newBlockId);
    const nextText = currentText.slice(end);
    const nextType = block.type === 'heading' && nextText.length ? 'heading' : 'paragraph';
    const focusPoint = createSourcePoint({ ...target, blockId: newBlockId, blockType: nextType }, nextText, 0, 'forward');
    return Object.freeze({
        operation: Object.freeze({ type: 'splitTextBlock', groupId: group.id, sectionId: session.sectionId,
            blockId: block.id, languageKey: sourceLanguage, utf16Offset: start, utf16EndOffset: end, newBlockId }),
        nextSession: Object.freeze({ ...session, blockId: newBlockId, blockType: nextType, expectedText: nextText,
            selectionStart: 0, selectionEnd: 0, selectionDirection: 'none', sourcePoint: focusPoint }),
        selection: Object.freeze({ focusPoint, selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' }),
    });
}

/** Insert a semantic PageBreak at a collapsed source caret in one transaction. */
export function createFlowDirectPageBreakTransaction(groupInput, session, input = {}) {
    const { group, sourceLanguage, block, currentText } = requireCurrentDirectSession(groupInput, session);
    const selectionStart = requireSelectionOffset(input.selectionStart, currentText.length, 'selectionStart');
    const selectionEnd = requireSelectionOffset(input.selectionEnd, currentText.length, 'selectionEnd');
    if (selectionStart !== selectionEnd) {
        fail('FLOW_DIRECT_COLLAPSED_CARET_REQUIRED', 'A manual page break requires a collapsed caret.', {
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
        fail('FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED', 'Page breaks can only be inserted between complete graphemes.', {
            utf16Offset: selectionStart,
            snappedUtf16Offset: splitPoint.utf16Offset,
        });
    }
    const newBlockId = requireNewBlockId(input.newBlockId);
    const pageBreakId = requireNewBlockId(input.pageBreakId);
    const document = group.flow.document;
    const usedIds = new Set([document.id, ...document.sections.flatMap((section) => (
        [section.id, ...section.blocks.map((entry) => entry.id)]
    ))]);
    if (newBlockId === pageBreakId || usedIds.has(newBlockId) || usedIds.has(pageBreakId)) {
        fail('FLOW_DIRECT_BLOCK_ID_CONFLICT', 'A manual page break requires two unused distinct block IDs.', {
            newBlockId,
            pageBreakId,
        });
    }
    const nextText = currentText.slice(selectionStart);
    const nextType = block.type === 'heading' && nextText.length > 0 ? 'heading' : 'paragraph';
    const nextSourcePoint = createSourcePoint({
        sectionId: session.sectionId,
        blockId: newBlockId,
        blockType: nextType,
        languageKey: sourceLanguage,
    }, nextText, 0, 'forward');
    return Object.freeze({
        operation: Object.freeze({
            type: 'insertPageBreakAtCaret',
            groupId: group.id,
            sectionId: session.sectionId,
            blockId: block.id,
            languageKey: sourceLanguage,
            utf16Offset: selectionStart,
            newBlockId,
            pageBreakId,
        }),
        nextSession: Object.freeze({
            ...session,
            blockId: newBlockId,
            blockType: nextType,
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

    const headingText = requireDirectEditableText(previousBlock.texts?.[sourceLanguage] ?? '');
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
 * Translations and annotations are preserved; incompatible title/settings boundaries remain protected.
 */
export function createFlowDirectParagraphMergeBackwardTransaction(groupInput, session, input = {}) {
    const {
        group,
        sourceLanguage,
        section,
        block,
        currentText,
    } = requireCurrentDirectSession(groupInput, session);
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
    requireMergeRemovalSafe(previousBlock, block);

    const previousText = requireDirectEditableText(previousBlock.texts?.[sourceLanguage] ?? '');
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
            preserveTranslations: true,
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
    requireMergeRemovalSafe(block, nextBlock);

    const nextText = requireDirectEditableText(nextBlock.texts?.[sourceLanguage] ?? '');
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
            preserveTranslations: true,
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
