import assert from 'node:assert/strict';

import { applyFlowTranslationPlan, FlowTranslationApplyError } from '../js/flow-translation-apply.js';
import { createFlowTranslationApplyPlan, createFlowTranslationRequest } from '../js/flow-translation-request.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import {
    deriveFlowTranslationStatus,
    recordFlowManualTranslationUnitEdit,
} from '../js/flow-translation-state.js';
import { clearHistory, pushState, redo, undo } from '../js/history.js';
import { state } from '../js/state.js';

const clone = (value) => structuredClone(value);
let idCounter = 0;
const idFactory = (prefix) => `${prefix}_translation_apply_${++idCounter}`;

function createGroup() {
    return createFlowGroupBlock({
        id: 'flow_translation_apply',
        sourceLanguage: 'ja',
        idFactory,
        document: {
            id: 'flow_document_translation_apply',
            sourceLanguage: 'ja',
            sections: [{
                id: 'section_translation_apply',
                title: { ja: '第一章' },
                blocks: [
                    {
                        id: 'heading_translation_apply',
                        type: 'heading',
                        level: 1,
                        texts: { ja: '雪の日', en: 'Snow Day' },
                    },
                    {
                        id: 'paragraph_translation_apply',
                        type: 'paragraph',
                        texts: { ja: '冬の金沢は静かだった。' },
                    },
                    { id: 'break_translation_apply', type: 'pageBreak' },
                ],
            }],
        },
        layout: {
            typographyByLanguage: {
                ja: { writingMode: 'vertical-rl', fontFamily: 'Noto Serif JP', fontSize: 18 },
                en: { writingMode: 'horizontal-tb', fontFamily: 'Noto Serif', fontSize: 18 },
            },
        },
    });
}

const fixed = {
    id: 'fixed_translation_apply',
    kind: 'page',
    content: { pageKind: 'graphic', layers: [] },
};

const manualGroup = createGroup();
const manualResult = recordFlowManualTranslationUnitEdit(manualGroup, 'en', {
    unitMap: 'blocks',
    unitId: 'heading_translation_apply',
});
manualGroup.flow.translationState = manualResult.translationState;
const inputBlocks = [fixed, manualGroup];
const inputJson = JSON.stringify(inputBlocks);

const request = createFlowTranslationRequest(manualGroup, {
    targetLang: 'en',
    modelId: 'verify-model',
});
assert.deepEqual(
    request.units.map((unit) => unit.unitId),
    ['section_translation_apply', 'paragraph_translation_apply'],
    'default request must leave the existing manual heading untouched',
);
const response = {
    units: request.units.map((unit) => ({
        unitId: unit.unitId,
        text: unit.unitKind === 'sectionTitle' ? 'Chapter One' : 'Kanazawa was quiet in winter.',
        status: 'needs-review',
    })),
};
const plan = createFlowTranslationApplyPlan(manualGroup, request, response);
assert.equal(plan.ready, true);

const applied = applyFlowTranslationPlan(inputBlocks, {
    groupId: manualGroup.id,
    targetLang: 'en',
    plan,
});
assert.equal(JSON.stringify(inputBlocks), inputJson, 'machine apply must not mutate input blocks');
assert.deepEqual(applied[0], fixed, 'Fixed opaque content must survive machine translation');
assert.equal(applied[1].flow.document.sections[0].title.en, 'Chapter One');
assert.equal(
    applied[1].flow.document.sections[0].blocks[1].texts.en,
    'Kanazawa was quiet in winter.',
);
assert.deepEqual(
    applied[1].flow.document.sections[0].blocks[2],
    { id: 'break_translation_apply', type: 'pageBreak' },
    'PageBreak must remain shared semantic structure',
);
const languageState = applied[1].flow.translationState.languages.en;
assert.equal(languageState.origin, 'mixed');
assert.equal(languageState.reviewState, 'needs-review');
assert.ok(languageState.lockedUnitIds.includes('heading_translation_apply'));
assert.equal(deriveFlowTranslationStatus(applied[1], 'en').status, 'needs-review');

const machineGroup = createGroup();
delete machineGroup.flow.document.sections[0].blocks[0].texts.en;
const machineRequest = createFlowTranslationRequest(machineGroup, { targetLang: 'en', modelId: 'verify-model' });
const machineResponse = {
    units: machineRequest.units.map((unit) => ({
        unitId: unit.unitId,
        text: `EN:${unit.text}`,
        status: 'needs-review',
    })),
};
const machinePlan = createFlowTranslationApplyPlan(machineGroup, machineRequest, machineResponse);
const machineApplied = applyFlowTranslationPlan([machineGroup], {
    groupId: machineGroup.id,
    targetLang: 'en',
    plan: machinePlan,
});
assert.equal(machineApplied[0].flow.translationState.languages.en.origin, 'machine');
assert.equal(machineApplied[0].flow.translationState.languages.en.lockedUnitIds, undefined);

assert.throws(
    () => applyFlowTranslationPlan(inputBlocks, {
        groupId: manualGroup.id,
        targetLang: 'en',
        plan: { ready: false, edits: [] },
    }),
    (error) => error instanceof FlowTranslationApplyError
        && error.code === 'FLOW_TRANSLATION_PLAN_NOT_READY',
);

const stateBeforeHistory = clone(state);
try {
    Object.assign(state, {
        version: 6,
        blocks: clone(inputBlocks),
        sections: [],
        pages: [],
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 1,
        activeBubbleIdx: null,
    });
    clearHistory();
    pushState();
    state.blocks = clone(applied);
    assert.equal(state.blocks[1].flow.document.sections[0].title.en, 'Chapter One');
    assert.equal(undo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].title.en, undefined);
    assert.equal(state.blocks[1].flow.document.sections[0].blocks[0].texts.en, 'Snow Day');
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[1].flow.document.sections[0].title.en, 'Chapter One');
    assert.equal(state.blocks[1].flow.translationState.languages.en.origin, 'mixed');
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBeforeHistory);
}

console.log('Flow translation atomic apply and Undo/Redo verification passed.');
