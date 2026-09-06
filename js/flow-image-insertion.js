/**
 * Insert a Fixed image at a semantic caret. Each side paginates independently.
 * Source, layout and translation data stay in the existing Project v6 model.
 */
import { applyFlowAuthoringOperation, FlowAuthoringError } from './flow-authoring.js';
import { assertValidFlowProjectData } from './flow-project-model.js';
import { createFlowDirectTextSplitTransaction } from './flow-direct-edit.js';
import { deepClone, createId } from './utils.js';

function fail(code) { throw new FlowAuthoringError(code, 'Cannot insert an image at this source position.'); }

/** Plan against the actual source, never a generated page number. */
export function createFlowImageInsertion(blocks, session, options = {}) {
    const groupIndex = blocks.findIndex(block => block.kind === 'flow' && block.id === session?.groupId);
    if (groupIndex < 0) fail('FLOW_IMAGE_SOURCE_CHANGED');
    const group = blocks[groupIndex];
    const start = options.selectionStart;
    if (!Number.isInteger(start) || start !== options.selectionEnd) fail('FLOW_IMAGE_CARET_REQUIRED');
    if (options.expectedText !== session.expectedText) fail('FLOW_IMAGE_SOURCE_CHANGED');
    const image = options.imageBlock;
    if (image?.kind !== 'page' || image.content?.pageKind !== 'image' || image.content.spreadImage) {
        fail('FLOW_IMAGE_PAGE_REQUIRED');
    }
    const idFactory = options.idFactory || createId;
    const newGroupId = idFactory('flow');
    const newDocumentId = idFactory('flow_document');
    const newBlockId = idFactory('flow_text');
    const existingIds = new Set();
    for (const entry of blocks) {
        existingIds.add(entry.id);
        if (entry.kind !== 'flow') continue;
        existingIds.add(entry.flow.document.id);
        for (const section of entry.flow.document.sections) {
            existingIds.add(section.id);
            section.blocks.forEach(block => existingIds.add(block.id));
        }
    }
    const ids = [image.id, newGroupId, newDocumentId, newBlockId];
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id || id !== id.trim() || existingIds.has(id))) {
        fail('FLOW_IMAGE_ID_CONFLICT');
    }
    // This shares grapheme, source-language and stale-session checks with Enter.
    const split = createFlowDirectTextSplitTransaction(group, session, {
        selectionStart: start, selectionEnd: start, newBlockId,
    });
    const nextBlocks = applyFlowAuthoringOperation(blocks, split.operation);
    const leading = nextBlocks[groupIndex];
    const document = leading.flow.document;
    const sectionIndex = document.sections.findIndex(section => section.id === session.sectionId);
    const section = document.sections[sectionIndex];
    const tailIndex = section.blocks.findIndex(block => block.id === newBlockId);
    const trailing = deepClone(leading);
    trailing.id = newGroupId;
    trailing.flow.document.id = newDocumentId;
    // Section IDs are document-scoped. Keeping the split section ID preserves
    // fingerprints for intact translated blocks that move into the trailing group.
    trailing.flow.document.sections = [
        { ...deepClone(section), blocks: deepClone(section.blocks.slice(tailIndex)) },
        ...deepClone(document.sections.slice(sectionIndex + 1)),
    ];
    document.sections = [
        ...document.sections.slice(0, sectionIndex),
        { ...section, blocks: section.blocks.slice(0, tailIndex) },
    ];
    const trailingBlockIds = new Set(trailing.flow.document.sections.flatMap(s => s.blocks.map(b => b.id)));
    const trailingSectionIds = new Set(trailing.flow.document.sections.map(s => s.id));
    const leadingSectionIds = new Set(document.sections.map(s => s.id));
    // Route known metadata with its units. Retain unknown/orphan metadata on the
    // original group rather than silently deleting forward-compatible data.
    for (const [language, target] of Object.entries(trailing.flow.translationState?.languages || {})) {
        const original = leading.flow.translationState.languages[language];
        for (const [map, ids] of [['blocks', trailingBlockIds], ['sectionTitles', trailingSectionIds]]) {
            target.sourceFingerprints[map] = Object.fromEntries(Object.entries(target.sourceFingerprints[map])
                .filter(([id]) => ids.has(id)));
            original.sourceFingerprints[map] = Object.fromEntries(Object.entries(original.sourceFingerprints[map])
                .filter(([id]) => !ids.has(id) || (map === 'sectionTitles' && leadingSectionIds.has(id))));
        }
        if (target.lockedUnitIds) {
            target.lockedUnitIds = target.lockedUnitIds.filter(id => trailingBlockIds.has(id) || trailingSectionIds.has(id));
            original.lockedUnitIds = original.lockedUnitIds.filter(id => !trailingBlockIds.has(id)
                && (!trailingSectionIds.has(id) || leadingSectionIds.has(id)));
        }
    }
    nextBlocks.splice(groupIndex + 1, 0, deepClone(image), trailing);
    assertValidFlowProjectData({ version: 6, blocks: nextBlocks });
    return Object.freeze({ blocks: nextBlocks, activeBlockIndex: groupIndex + 1,
        leadingGroupId: leading.id, trailingGroupId: trailing.id });
}
