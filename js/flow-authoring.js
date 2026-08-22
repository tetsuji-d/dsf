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

function createInsertedBlock(type, languageKey, idFactory) {
    const options = { idFactory };
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

/**
 * Apply one semantic Flow edit without mutating the input.
 *
 * Supported operations:
 * - setText: update heading/paragraph localized text
 * - setSectionTitle: update outline-only section title
 * - setHeadingLevel: update heading level 1..6
 * - insertBlock: insert heading/paragraph/pageBreak after afterBlockId, or append
 * - removeBlock: remove one semantic block
 * - moveBlock: move one semantic block by delta (-1 or +1)
 * - confirmTranslation: accept all present target values against current source
 */
export function applyFlowAuthoringOperation(blocks, operation, options = {}) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
        throw new TypeError('Flow authoring operation must be an object.');
    }
    const nextBlocks = deepClone(blocks);
    const groupContext = findFlowGroupContext(nextBlocks, operation);
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
        case 'insertBlock': {
            const blockType = String(operation.blockType || '');
            if (!INSERTABLE_BLOCK_TYPES.has(blockType)) {
                fail('UNSUPPORTED_FLOW_BLOCK_TYPE', `Unsupported Flow block type: ${blockType}`, { blockType });
            }
            const languageKey = validateLanguageKey(operation.languageKey);
            let insertIndex = section.blocks.length;
            if (operation.afterBlockId != null && operation.afterBlockId !== '') {
                insertIndex = findBlockIndex(section, operation.afterBlockId) + 1;
            }
            const inserted = createInsertedBlock(blockType, languageKey, idFactory);
            section.blocks.splice(insertIndex, 0, inserted);
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
