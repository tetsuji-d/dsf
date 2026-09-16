import { assertValidFlowProjectData } from './flow-project-model.js';
import { replaceAnnotatedText, validateFlowAnnotations } from './flow-annotations.js';
import { remapPlacementText } from './flow-page-placement.js';
import { captureFlowTranslationUnitBeforeSourceEdit, recordFlowManualTranslationUnitEdit } from './flow-translation-state.js';

/** One semantic paragraph, never a generated page or paragraph/translation split. */
export function editFlowParagraph(blocks, target, expectedText, text) {
    const fail = code => { throw Object.assign(new Error(code), { code }); };
    if (typeof text !== 'string' || text.length > 12000 || /[\r\n\u2028\u2029]/u.test(text)) fail('INVALID_TEXT');
    assertValidFlowProjectData({ version: 6, blocks });
    const original = blocks.find(g => g.kind === 'flow' && g.id === target.groupId);
    const originalBlock = original?.flow.document.sections.find(s => s.id === target.sectionId)?.blocks.find(b => b.id === target.blockId);
    if (!originalBlock || !['paragraph', 'heading'].includes(originalBlock.type)) fail('INVALID_TARGET');
    if ((originalBlock.texts?.[target.languageKey] ?? '') !== expectedText) fail('STALE_TEXT');
    if (text === expectedText) return { blocks, count: 0 };
    const next = structuredClone(blocks), group = next.find(g => g.id === target.groupId);
    const block = group.flow.document.sections.find(s => s.id === target.sectionId).blocks.find(b => b.id === target.blockId);
    const language = target.languageKey, source = language === group.flow.document.sourceLanguage;
    if (source) {
        const captured = captureFlowTranslationUnitBeforeSourceEdit(group, { unitMap: 'blocks', unitId: block.id });
        if (captured.changed) group.flow.translationState = captured.translationState;
    }
    replaceAnnotatedText(block, language, text);
    remapPlacementText(group, block.id, language, expectedText, text);
    block.texts[language] = text;
    validateFlowAnnotations(block);
    if (!source) {
        const recorded = recordFlowManualTranslationUnitEdit(group, language, { unitMap: 'blocks', unitId: block.id });
        if (recorded.changed) group.flow.translationState = recorded.translationState;
    }
    assertValidFlowProjectData({ version: 6, blocks: next });
    return { blocks: next, count: 1 };
}
