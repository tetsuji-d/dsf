import { inspectFlowParagraphMerge } from './flow-paragraph-merge.js';
/**
 * Pure transactions for editing the semantic Flow source.
 *
 * Generated pages never enter this module. Every operation clones the mixed
 * authoring spine, changes exactly one Flow document, and validates the result
 * before it can replace application state.
 */

import {
    createFlowHeading,
    createFlowPageBreak,
    createFlowParagraph,
} from './flow-document.js';
import {
    PROJECT_SCHEMA_VERSION,
    assertValidFlowProjectData,
} from './flow-project-model.js';
import {
    captureFlowTranslationUnitBeforeSourceEdit,
    confirmFlowTranslationAgainstCurrentSource,
    recordFlowManualTranslationUnitEdit,
} from './flow-translation-state.js';
import { validateFlowAnnotations, replaceAnnotatedText, splitAnnotatedText, mergeAnnotatedText } from './flow-annotations.js';
import { segmentGraphemes } from './grapheme.js';
import { createId, deepClone } from './utils.js';

const TEXT_BLOCK_TYPES = new Set(['heading', 'paragraph']);
const INSERTABLE_BLOCK_TYPES = new Set(['heading', 'paragraph', 'pageBreak']);

export class FlowAuthoringError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowAuthoringError';
        this.code = code;
        this.context = context;
    }
}

function fail(code, message, context = {}) {
    throw new FlowAuthoringError(code, message, context);
}

function findFlowGroupContext(blocks, operation) {
    if (!Array.isArray(blocks)) fail('INVALID_BLOCKS', 'Authoring blocks must be an array.');
    const groupId = String(operation?.groupId || '');
    const groupIndex = blocks.findIndex((block) => block?.kind === 'flow' && block.id === groupId);
    if (groupIndex < 0) fail('FLOW_GROUP_NOT_FOUND', `Flow group not found: ${groupId}`, { groupId });

    return { group: blocks[groupIndex], groupIndex };
}

function findFlowContext(blocks, operation, groupContext = findFlowGroupContext(blocks, operation)) {
    const { group, groupIndex } = groupContext;
    const sections = group.flow?.document?.sections;
    const sectionId = String(operation?.sectionId || '');
    const sectionIndex = Array.isArray(sections)
        ? sections.findIndex((section) => section?.id === sectionId)
        : -1;
    if (sectionIndex < 0) {
        fail('FLOW_SECTION_NOT_FOUND', `Flow section not found: ${sectionId}`, {
            groupId: group.id,
            sectionId,
        });
    }

    return {
        group,
        groupIndex,
        section: sections[sectionIndex],
        sectionIndex,
    };
}

function findBlockIndex(section, blockId) {
    const key = String(blockId || '');
    const index = Array.isArray(section?.blocks)
        ? section.blocks.findIndex((block) => block?.id === key)
        : -1;
    if (index < 0) fail('FLOW_BLOCK_NOT_FOUND', `Flow block not found: ${key}`, { blockId: key });
    return index;
}

function createInsertedBlock(type, languageKey, idFactory, id = null) {
    const options = id ? { idFactory, id } : { idFactory };
    if (type === 'heading') return createFlowHeading({ ...options, level: 1, texts: { [languageKey]: '' } });
    if (type === 'paragraph') return createFlowParagraph({ ...options, texts: { [languageKey]: '' } });
    if (type === 'pageBreak') return createFlowPageBreak(options);
    return fail('UNSUPPORTED_FLOW_BLOCK_TYPE', `Unsupported Flow block type: ${String(type)}`, { type });
}

function validateLanguageKey(value) {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        fail('INVALID_LANGUAGE_KEY', 'Flow language keys must be non-empty exact saved keys.', {
            languageKey: value,
        });
    }
    return value;
}

function validateBlockId(value, name = 'Flow block ID') {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        fail('INVALID_FLOW_BLOCK_ID', `${name} must be a non-empty exact ID.`, {
            blockId: value,
        });
    }
    return value;
}

function flowDocumentHasId(document, id) {
    if (document?.id === id) return true;
    return (document?.sections || []).some((section) => (
        section?.id === id || (section?.blocks || []).some((block) => block?.id === id)
    ));
}

function validateGraphemeBoundary(text, utf16Offset, languageKey) {
    const offset = Number(utf16Offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
        fail('INVALID_FLOW_SPLIT_OFFSET', 'Paragraph split offset is outside the source text.', {
            utf16Offset,
            maximum: text.length,
        });
    }
    if (
        offset !== 0
        && offset !== text.length
        && !segmentGraphemes(text, languageKey).some((segment) => segment.index === offset)
    ) {
        fail('FLOW_SPLIT_GRAPHEME_BOUNDARY_REQUIRED', 'Paragraphs can only split between complete graphemes.', {
            utf16Offset: offset,
        });
    }
    return offset;
}

/**
 * Apply one semantic Flow edit without mutating the input.
 *
 * Supported operations:
 * - setText: update heading/paragraph localized text
 * - setSectionTitle: update outline-only section title
 * - setHeadingLevel: update heading level 1..6
 * - setBlockType: convert a text block between paragraph and heading, retaining its identity and localized text
 * - insertBlock: insert heading/paragraph/pageBreak after afterBlockId, or append; optional newBlockId preserves caller identity
 * - splitParagraph: split one source Paragraph into two adjacent Paragraphs
 * - insertPageBreakAtCaret: atomically split one source text block around a manual pageBreak
 * - mergeParagraphBackward: merge one source Paragraph into its previous Paragraph
 * - removeBlock: remove one semantic block
 * - moveBlock: move one semantic block by delta (-1 or +1)
 * - removeGroup: remove the complete Flow manuscript from the mixed authoring spine
 * - confirmTranslation: accept all present target values against current source
 */
export function applyFlowAuthoringOperation(blocks, operation, options = {}) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw new TypeError('Flow authoring operation must be an object.');
    }
    const nextBlocks = deepClone(blocks);
    const groupContext = findFlowGroupContext(nextBlocks, operation);
    if (operation.type === 'removeGroup') {
        nextBlocks.splice(groupContext.groupIndex, 1);
        assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks: nextBlocks });
        return nextBlocks;
    }
    if (operation.type === 'confirmTranslation') {
        const languageKey = validateLanguageKey(operation.languageKey);
        const result = confirmFlowTranslationAgainstCurrentSource(groupContext.group, languageKey);
        if (result.changed) groupContext.group.flow.translationState = result.translationState;
        assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks: nextBlocks });
        return nextBlocks;
    }

    const context = findFlowContext(nextBlocks, operation, groupContext);
    const section = context.section;
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : createId;

    switch (operation.type) {
        case 'setAnnotations': {
            const block = section.blocks[findBlockIndex(section, operation.blockId)];
            const language = validateLanguageKey(operation.languageKey);
            if (!TEXT_BLOCK_TYPES.has(block.type) || typeof operation.expectedText !== 'string'
                || block.texts?.[language] !== operation.expectedText
                || JSON.stringify(block.annotations?.[language] || []) !== operation.expectedAnnotations) {
                fail('FLOW_ANNOTATION_SOURCE_CHANGED', 'Annotation source changed.');
            }
            if (!Array.isArray(operation.annotations)) fail('FLOW_ANNOTATIONS_INVALID', 'Annotations must be an array.');
            block.annotations = { ...(block.annotations || {}), [language]: deepClone(operation.annotations) };
            validateFlowAnnotations(block);
            context.group.flow.document.schemaVersion = Math.max(2, context.group.flow.document.schemaVersion);
            break;
        }
        case 'setText': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            if (!TEXT_BLOCK_TYPES.has(block.type)) {
                fail('FLOW_BLOCK_NOT_TEXT', 'Only heading and paragraph blocks contain editable text.', {
                    blockId: block.id,
                    blockType: block.type,
                });
            }
            const languageKey = validateLanguageKey(operation.languageKey);
            if (typeof operation.text !== 'string') fail('INVALID_FLOW_TEXT', 'Flow text must be a string.');
            const sourceLanguage = context.group.flow.document.sourceLanguage;
            if (languageKey === sourceLanguage) {
                const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                    unitMap: 'blocks',
                    unitId: block.id,
                });
                if (captured.changed) context.group.flow.translationState = captured.translationState;
            }
            replaceAnnotatedText(block, languageKey, operation.text);
            block.texts = { ...(block.texts || {}), [languageKey]: operation.text };
            if (languageKey !== sourceLanguage) {
                const recorded = recordFlowManualTranslationUnitEdit(context.group, languageKey, {
                    unitMap: 'blocks',
                    unitId: block.id,
                });
                if (recorded.changed) context.group.flow.translationState = recorded.translationState;
            }
            break;
        }
        case 'setSectionTitle': {
            const languageKey = validateLanguageKey(operation.languageKey);
            if (typeof operation.text !== 'string') fail('INVALID_FLOW_TEXT', 'Section title must be a string.');
            const sourceLanguage = context.group.flow.document.sourceLanguage;
            if (languageKey === sourceLanguage) {
                const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                    unitMap: 'sectionTitles',
                    unitId: section.id,
                });
                if (captured.changed) context.group.flow.translationState = captured.translationState;
            }
            section.title = { ...(section.title || {}), [languageKey]: operation.text };
            if (languageKey !== sourceLanguage) {
                const recorded = recordFlowManualTranslationUnitEdit(context.group, languageKey, {
                    unitMap: 'sectionTitles',
                    unitId: section.id,
                });
                if (recorded.changed) context.group.flow.translationState = recorded.translationState;
            }
            break;
        }
        case 'setHeadingLevel': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            const level = Number(operation.level);
            if (block.type !== 'heading') fail('FLOW_BLOCK_NOT_HEADING', 'Heading level requires a heading block.');
            if (!Number.isInteger(level) || level < 1 || level > 6) {
                fail('INVALID_HEADING_LEVEL', 'Heading level must be an integer from 1 through 6.', { level });
            }
            block.level = level;
            break;
        }
        case 'setBlockType': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            if (!TEXT_BLOCK_TYPES.has(block.type)) {
                fail('FLOW_BLOCK_NOT_TEXT', 'Only heading and paragraph blocks can change text block type.', {
                    blockId: block.id,
                    blockType: block.type,
                });
            }
            const blockType = operation.blockType;
            if (!TEXT_BLOCK_TYPES.has(blockType)) {
                fail('UNSUPPORTED_FLOW_BLOCK_TYPE', 'Text block type must be heading or paragraph.', { blockType });
            }
            const hasLevel = Object.prototype.hasOwnProperty.call(operation, 'level');
            if (hasLevel && (
                blockType !== 'heading'
                || !Number.isInteger(operation.level)
                || operation.level < 1
                || operation.level > 6
            )) {
                fail('INVALID_HEADING_LEVEL', 'A heading level must be an integer from 1 through 6 and requires a heading target.', {
                    level: operation.level,
                    blockType,
                });
            }
            const level = hasLevel ? operation.level : block.type === 'heading' ? block.level : 1;
            if (block.type === blockType) {
                if (blockType === 'heading' && hasLevel) block.level = level;
                break;
            }

            // Translation fingerprints include block type, but not heading level.
            // Capture the old semantic unit before changing its role; never rewrite translations.
            const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                unitMap: 'blocks',
                unitId: block.id,
            });
            if (captured.changed) context.group.flow.translationState = captured.translationState;
            block.type = blockType;
            if (blockType === 'heading') block.level = level;
            else delete block.level;
            break;
        }
        case 'insertBlock': {
            const blockType = String(operation.blockType || '');
            if (!INSERTABLE_BLOCK_TYPES.has(blockType)) {
                fail('UNSUPPORTED_FLOW_BLOCK_TYPE', `Unsupported Flow block type: ${blockType}`, { blockType });
            }
            const languageKey = validateLanguageKey(operation.languageKey);
            const requestedId = operation.newBlockId == null || operation.newBlockId === ''
                ? null
                : validateBlockId(operation.newBlockId, 'New block ID');
            if (requestedId && flowDocumentHasId(context.group.flow.document, requestedId)) {
                fail('FLOW_BLOCK_ID_CONFLICT', `Flow ID is already in use: ${requestedId}`, {
                    blockId: requestedId,
                });
            }
            let insertIndex = section.blocks.length;
            if (operation.afterBlockId != null && operation.afterBlockId !== '') {
                insertIndex = findBlockIndex(section, operation.afterBlockId) + 1;
            }
            const inserted = createInsertedBlock(blockType, languageKey, idFactory, requestedId);
            section.blocks.splice(insertIndex, 0, inserted);
            break;
        }
        case 'splitTextBlock':
        case 'splitParagraph': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            if (operation.type === 'splitParagraph' ? block.type !== 'paragraph' : !TEXT_BLOCK_TYPES.has(block.type)) {
                fail('FLOW_BLOCK_NOT_PARAGRAPH', 'Only paragraph blocks can be split.', {
                    blockId: block.id,
                    blockType: block.type,
                });
            }
            const sourceLanguage = context.group.flow.document.sourceLanguage;
            const languageKey = validateLanguageKey(operation.languageKey);
            if (languageKey !== sourceLanguage) {
                fail('FLOW_SPLIT_SOURCE_LANGUAGE_ONLY', 'Paragraph splitting currently supports the source language only.', {
                    sourceLanguage,
                    languageKey,
                });
            }
            const sourceValue = block.texts?.[sourceLanguage];
            const text = sourceValue === undefined ? '' : sourceValue;
            if (typeof text !== 'string') fail('INVALID_FLOW_TEXT', 'Paragraph source text must be a string.');
            const utf16Offset = validateGraphemeBoundary(text, operation.utf16Offset, sourceLanguage);
            const utf16EndOffset = operation.type === 'splitTextBlock'
                ? validateGraphemeBoundary(text, operation.utf16EndOffset ?? utf16Offset, sourceLanguage) : utf16Offset;
            if (utf16EndOffset < utf16Offset) fail('INVALID_FLOW_SELECTION', 'Selection end precedes its start.');
            const requestedId = operation.newBlockId == null || operation.newBlockId === ''
                ? null
                : validateBlockId(operation.newBlockId, 'New paragraph ID');
            if (requestedId && flowDocumentHasId(context.group.flow.document, requestedId)) {
                fail('FLOW_BLOCK_ID_CONFLICT', `Flow ID is already in use: ${requestedId}`, {
                    blockId: requestedId,
                });
            }

            const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                unitMap: 'blocks',
                unitId: block.id,
            });
            if (captured.changed) context.group.flow.translationState = captured.translationState;

            const trailingAnnotations = splitAnnotatedText(block, sourceLanguage, utf16Offset, utf16EndOffset);
            const beforeText = text.slice(0, utf16Offset);
            const afterText = text.slice(utf16EndOffset);
            block.texts = { ...(block.texts || {}), [sourceLanguage]: beforeText };
            const tailOptions = {
                ...(trailingAnnotations.length ? { annotations: { [sourceLanguage]: trailingAnnotations } } : {}),
                ...(requestedId ? { id: requestedId } : {}),
                idFactory,
                texts: { [sourceLanguage]: afterText },
            };
            const inserted = block.type === 'heading' && afterText.length
                ? createFlowHeading({ ...tailOptions, level: block.level }) : createFlowParagraph(tailOptions);
            section.blocks.splice(blockIndex + 1, 0, inserted);
            break;
        }
        case 'insertPageBreakAtCaret': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            if (!TEXT_BLOCK_TYPES.has(block.type)) {
                fail('FLOW_BLOCK_NOT_TEXT', 'A caret page break requires a heading or paragraph block.', {
                    blockId: block.id,
                    blockType: block.type,
                });
            }
            const sourceLanguage = context.group.flow.document.sourceLanguage;
            const languageKey = validateLanguageKey(operation.languageKey);
            if (languageKey !== sourceLanguage) {
                fail('FLOW_PAGE_BREAK_SOURCE_LANGUAGE_ONLY', 'Caret page breaks currently support the source language only.', {
                    sourceLanguage,
                    languageKey,
                });
            }
            const sourceValue = block.texts?.[sourceLanguage];
            const text = sourceValue === undefined ? '' : sourceValue;
            if (typeof text !== 'string') fail('INVALID_FLOW_TEXT', 'Page break source text must be a string.');
            const utf16Offset = validateGraphemeBoundary(text, operation.utf16Offset, sourceLanguage);
            const newBlockId = validateBlockId(operation.newBlockId, 'New text block ID');
            const pageBreakId = validateBlockId(operation.pageBreakId, 'New page break ID');
            if (newBlockId === pageBreakId) {
                fail('FLOW_BLOCK_ID_CONFLICT', 'The new text block and page break must have different IDs.', {
                    blockId: newBlockId,
                });
            }
            for (const requestedId of [newBlockId, pageBreakId]) {
                if (flowDocumentHasId(context.group.flow.document, requestedId)) {
                    fail('FLOW_BLOCK_ID_CONFLICT', `Flow ID is already in use: ${requestedId}`, {
                        blockId: requestedId,
                    });
                }
            }

            const trailingAnnotations = splitAnnotatedText(block, sourceLanguage, utf16Offset);
            const beforeText = text.slice(0, utf16Offset);
            const afterText = text.slice(utf16Offset);
            // At the end (including a source-missing empty block), the original
            // text/translation unit is unchanged. Do not create new metadata.
            if (beforeText !== text) {
                const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                    unitMap: 'blocks',
                    unitId: block.id,
                });
                if (captured.changed) context.group.flow.translationState = captured.translationState;
                block.texts = { ...(block.texts || {}), [sourceLanguage]: beforeText };
            }
            const trailingOptions = { id: newBlockId, idFactory, texts: { [sourceLanguage]: afterText } };
            if (trailingAnnotations.length) trailingOptions.annotations = { [sourceLanguage]: trailingAnnotations };
            const trailingBlock = block.type === 'heading' && afterText.length > 0
                ? createFlowHeading({ ...trailingOptions, level: block.level })
                : createFlowParagraph(trailingOptions);
            section.blocks.splice(blockIndex + 1, 0,
                createFlowPageBreak({ id: pageBreakId, idFactory }), trailingBlock);
            break;
        }
        case 'mergeParagraphBackward': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const block = section.blocks[blockIndex];
            if (block.type !== 'paragraph') {
                fail('FLOW_BLOCK_NOT_PARAGRAPH', 'Only paragraph blocks can merge backward.', {
                    blockId: block.id,
                    blockType: block.type,
                });
            }
            const sourceLanguage = context.group.flow.document.sourceLanguage;
            const languageKey = validateLanguageKey(operation.languageKey);
            if (languageKey !== sourceLanguage) {
                fail('FLOW_MERGE_SOURCE_LANGUAGE_ONLY', 'Paragraph merging currently supports the source language only.', {
                    sourceLanguage,
                    languageKey,
                });
            }
            const previousBlock = section.blocks[blockIndex - 1];
            if (previousBlock?.type !== 'paragraph') {
                fail('FLOW_PREVIOUS_PARAGRAPH_REQUIRED', 'Paragraph merging requires an immediately preceding Paragraph.', {
                    blockId: block.id,
                    previousBlockId: previousBlock?.id || '',
                    previousBlockType: previousBlock?.type || '',
                });
            }
            const translatedLanguageKeys = Object.entries(block.texts || {})
                .filter(([key, value]) => key !== sourceLanguage && typeof value === 'string')
                .map(([key]) => key);
            if (translatedLanguageKeys.length && !operation.preserveTranslations) {
                fail('FLOW_MERGE_TRANSLATION_DATA_PRESENT', 'A Paragraph with saved translations cannot be removed by merging.', {
                    blockId: block.id,
                    translatedLanguageKeys,
                });
            }
            const previousValue = previousBlock.texts?.[sourceLanguage];
            const currentValue = block.texts?.[sourceLanguage];
            const previousText = previousValue === undefined ? '' : previousValue;
            const currentText = currentValue === undefined ? '' : currentValue;
            if (typeof previousText !== 'string' || typeof currentText !== 'string') {
                fail('INVALID_FLOW_TEXT', 'Paragraph source text must be a string.');
            }

            if (operation.preserveTranslations) {
                const reason = inspectFlowParagraphMerge(previousBlock, block);
                if (reason) fail('FLOW_MERGE_' + reason, 'Paragraph settings differ.');
                // Keep both translations verbatim, separated by a paragraph newline.
                for (const key of translatedLanguageKeys) {
                    const left = previousBlock.texts[key] ?? '';
                    const right = block.texts[key];
                    const separator = left && right ? '\n' : '';
                    previousBlock.texts[key] = left + separator;
                    mergeAnnotatedText(previousBlock, block, key, (left + separator).length);
                    previousBlock.texts[key] += right;
                }
            }
            const captured = captureFlowTranslationUnitBeforeSourceEdit(context.group, {
                unitMap: 'blocks', unitId: previousBlock.id,
            });
            if (captured.changed) context.group.flow.translationState = captured.translationState;
            if (operation.preserveTranslations) {
                for (const [key, language] of Object.entries(context.group.flow.translationState?.languages || {})) {
                    if (language.sourceFingerprints?.blocks) delete language.sourceFingerprints.blocks[block.id];
                    if (language.lockedUnitIds?.includes(block.id)) {
                        language.lockedUnitIds = [...new Set(language.lockedUnitIds.map(id => id === block.id ? previousBlock.id : id))];
                    }
                    if (Object.hasOwn(previousBlock.texts, key)) language.reviewState = 'needs-review';
                }
            }
            mergeAnnotatedText(previousBlock, block, sourceLanguage, previousText.length);
            previousBlock.texts = { ...previousBlock.texts, [sourceLanguage]: previousText + currentText };
            section.blocks.splice(blockIndex, 1);
            break;
        }
        case 'removeBlock': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            section.blocks.splice(blockIndex, 1);
            break;
        }
        case 'moveBlock': {
            const blockIndex = findBlockIndex(section, operation.blockId);
            const delta = Number(operation.delta);
            if (delta !== -1 && delta !== 1) fail('INVALID_MOVE_DELTA', 'Flow block move delta must be -1 or 1.');
            const targetIndex = blockIndex + delta;
            if (targetIndex < 0 || targetIndex >= section.blocks.length) return nextBlocks;
            const [block] = section.blocks.splice(blockIndex, 1);
            section.blocks.splice(targetIndex, 0, block);
            break;
        }
        default:
            fail('UNSUPPORTED_FLOW_OPERATION', `Unsupported Flow authoring operation: ${String(operation.type)}`);
    }

    assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks: nextBlocks });
    return nextBlocks;
}
