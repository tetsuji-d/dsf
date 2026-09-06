/** Atomic state.blocks transaction for an already validated Flow translation plan. */

import { replaceAnnotatedText } from './flow-annotations.js';
import { PROJECT_SCHEMA_VERSION, assertValidFlowProjectData } from './flow-project-model.js';
import { recordFlowMachineTranslationUnitBatch } from './flow-translation-state.js';
import { deepClone } from './utils.js';

export class FlowTranslationApplyError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'FlowTranslationApplyError';
        this.code = code;
        Object.assign(this, details);
    }
}

function requireExactKey(value, label) {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        throw new FlowTranslationApplyError('INVALID_TRANSLATION_APPLY', `${label} must be an exact saved key.`);
    }
    return value;
}

function failUnit(unitId, message) {
    throw new FlowTranslationApplyError('FLOW_TRANSLATION_APPLY_UNIT_INVALID', message, { unitId });
}

export function applyFlowTranslationPlan(blocks, options = {}) {
    if (!Array.isArray(blocks)) {
        throw new FlowTranslationApplyError('INVALID_TRANSLATION_APPLY', 'Authoring blocks must be an array.');
    }
    const groupId = requireExactKey(options.groupId, 'Flow group ID');
    const targetLang = requireExactKey(options.targetLang, 'Flow target language');
    const plan = options.plan;
    if (!plan?.ready || !Array.isArray(plan.edits) || plan.edits.length === 0) {
        throw new FlowTranslationApplyError('FLOW_TRANSLATION_PLAN_NOT_READY', 'Flow translation plan is not ready to apply.');
    }

    const nextBlocks = deepClone(blocks);
    const group = nextBlocks.find((block) => block?.kind === 'flow' && block.id === groupId);
    if (!group) {
        throw new FlowTranslationApplyError('FLOW_GROUP_NOT_FOUND', `Flow group not found: ${groupId}`);
    }
    if (group.flow?.document?.sourceLanguage === targetLang) {
        throw new FlowTranslationApplyError('INVALID_LANGUAGE_PAIR', 'Flow translation cannot target its source language.');
    }

    const seen = new Set();
    const stateUnits = [];
    for (const edit of plan.edits) {
        const unitId = requireExactKey(edit?.unitId, 'Flow translation unit ID');
        if (seen.has(unitId)) failUnit(unitId, `Duplicate Flow translation edit: ${unitId}`);
        seen.add(unitId);
        if (edit.languageKey !== targetLang || typeof edit.text !== 'string') {
            failUnit(unitId, `Invalid Flow translation edit payload: ${unitId}`);
        }
        const section = group.flow.document.sections.find((entry) => entry?.id === edit.sectionId);
        if (!section) failUnit(unitId, `Flow translation Section not found: ${edit.sectionId}`);

        if (edit.unitKind === 'sectionTitle') {
            if (unitId !== section.id || edit.blockId) {
                failUnit(unitId, `Flow Section title identity changed: ${unitId}`);
            }
            section.title = { ...(section.title || {}), [targetLang]: edit.text };
            stateUnits.push({
                unitMap: 'sectionTitles',
                unitId,
                sourceFingerprint: edit.sourceFingerprint,
            });
            continue;
        }

        const block = section.blocks.find((entry) => entry?.id === edit.blockId);
        if (!block || block.id !== unitId || block.type !== edit.unitKind) {
            failUnit(unitId, `Flow translation Block identity changed: ${unitId}`);
        }
        if (block.type !== 'heading' && block.type !== 'paragraph') {
            failUnit(unitId, `Unsupported Flow translation Block: ${unitId}`);
        }
        replaceAnnotatedText(block, targetLang, edit.text);
        block.texts = { ...(block.texts || {}), [targetLang]: edit.text };
        stateUnits.push({
            unitMap: 'blocks',
            unitId,
            sourceFingerprint: edit.sourceFingerprint,
        });
    }

    const stateResult = recordFlowMachineTranslationUnitBatch(group, targetLang, stateUnits);
    if (stateResult.changed) group.flow.translationState = stateResult.translationState;
    assertValidFlowProjectData({ version: PROJECT_SCHEMA_VERSION, blocks: nextBlocks });
    return nextBlocks;
}
