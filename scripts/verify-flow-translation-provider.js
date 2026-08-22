import assert from 'node:assert/strict';
import {
    createFlowTranslationApplyPlan,
    createFlowTranslationRequest,
    FlowTranslationRequestError,
} from '../js/flow-translation-request.js';
import { recordFlowManualTranslationUnitEdit } from '../js/flow-translation-state.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function createGroup() {
    return {
        id: 'flow_group_1',
        kind: 'flow',
        flow: {
            document: {
                id: 'flow_document_1',
                schemaVersion: 1,
                layoutType: 'flow',
                sourceLanguage: 'ja',
                sections: [{
                    id: 'section_1',
                    title: { ja: '第一章' },
                    blocks: [
                        { id: 'heading_1', type: 'heading', level: 1, texts: { ja: '第一章' } },
                        { id: 'paragraph_1', type: 'paragraph', texts: { ja: '冬の金沢は静かだった。' } },
                        { id: 'page_break_1', type: 'pageBreak' },
                        { id: 'paragraph_2', type: 'paragraph', texts: { ja: '' } },
                    ],
                }],
            },
        },
    };
}

const group = createGroup();
const beforeRequest = clone(group);
const request = createFlowTranslationRequest(group, {
    targetLang: 'en-us',
    modelId: 'verify-model',
    constraints: {
        allowTargetPageCountChange: false,
        preserveSemanticStructure: false,
    },
});
assert.deepEqual(group, beforeRequest, 'request creation must not mutate the Flow group');
assert.equal(request.schemaVersion, 1);
assert.equal(request.units.length, 4, 'Section title, Heading, and Paragraphs are provider units');
assert.ok(!request.units.some((unit) => unit.unitId === 'page_break_1'));
assert.equal(request.units.find((unit) => unit.unitId === 'paragraph_2').text, '');
assert.equal(request.constraints.allowTargetPageCountChange, true);
assert.equal(request.constraints.preserveSemanticStructure, true);
assert.equal(request.constraints.sharedPageBreaks, true);

const providerResponse = {
    units: request.units.map((unit) => ({
        unitId: unit.unitId,
        text: unit.text ? `EN(${unit.text})` : '',
        status: 'needs-review',
    })),
};
const beforePlan = clone(group);
const readyPlan = createFlowTranslationApplyPlan(group, request, providerResponse);
assert.deepEqual(group, beforePlan, 'apply planning must not mutate the Flow group');
assert.equal(readyPlan.ready, true);
assert.equal(readyPlan.edits.length, 4);
assert.deepEqual(
    readyPlan.edits.map((edit) => edit.unitKind),
    ['sectionTitle', 'heading', 'paragraph', 'paragraph'],
);

const sourceChanged = clone(group);
sourceChanged.flow.document.sections[0].blocks[1].texts.ja = '冬の金沢はとても静かだった。';
const invalidatedPlan = createFlowTranslationApplyPlan(sourceChanged, request, providerResponse);
assert.equal(invalidatedPlan.ready, false);
assert.equal(invalidatedPlan.reason, 'atomic-validation-failed');
assert.equal(invalidatedPlan.edits.length, 0);
assert.ok(invalidatedPlan.issues.some((issue) => (
    issue.unitId === 'paragraph_1' && issue.reason === 'source-changed'
)));

const providerFailed = clone(providerResponse);
providerFailed.units[1] = {
    unitId: providerFailed.units[1].unitId,
    text: '',
    status: 'error',
    error: 'Provider failed.',
};
const failedPlan = createFlowTranslationApplyPlan(group, request, providerFailed);
assert.equal(failedPlan.ready, false);
assert.equal(failedPlan.edits.length, 0, 'one provider error prevents a partial Project mutation');
assert.ok(failedPlan.issues.some((issue) => issue.reason === 'provider-error'));

const cancelledPlan = createFlowTranslationApplyPlan(group, request, {
    units: providerResponse.units.slice(0, 1),
    cancelled: true,
});
assert.deepEqual(cancelledPlan, {
    ready: false,
    reason: 'cancelled',
    edits: [],
    issues: request.units.slice(1).map((unit) => unit.unitId),
});

const legacy = createGroup();
legacy.flow.document.sections[0].blocks[3].texts['en-us'] = 'Legacy target';
const legacyDefault = createFlowTranslationRequest(legacy, { targetLang: 'en-us' });
assert.ok(!legacyDefault.units.some((unit) => unit.unitId === 'paragraph_2'));
assert.ok(legacyDefault.skipped.some((unit) => (
    unit.unitId === 'paragraph_2' && unit.reason === 'status-untracked'
)));
const legacyProtected = createFlowTranslationRequest(legacy, {
    targetLang: 'en-us',
    statuses: ['untracked'],
});
assert.equal(legacyProtected.units.length, 0);
assert.ok(legacyProtected.skipped.some((unit) => (
    unit.unitId === 'paragraph_2' && unit.reason === 'locked'
)));
const legacyOverwrite = createFlowTranslationRequest(legacy, {
    targetLang: 'en-us',
    statuses: ['untracked'],
    overwriteLocked: true,
});
assert.deepEqual(legacyOverwrite.units.map((unit) => unit.unitId), ['paragraph_2']);

const selected = createFlowTranslationRequest(group, {
    targetLang: 'en-us',
    unitIds: ['paragraph_1'],
    includeOutline: false,
});
assert.deepEqual(selected.units.map((unit) => unit.unitId), ['paragraph_1']);
assert.throws(
    () => createFlowTranslationRequest(group, {
        targetLang: 'en-us',
        unitIds: ['missing_unit'],
    }),
    (error) => error instanceof FlowTranslationRequestError
        && error.code === 'FLOW_TRANSLATION_UNIT_NOT_FOUND',
);

const concurrentManual = clone(group);
concurrentManual.flow.document.sections[0].blocks[1].texts['en-us'] = 'Manually edited';
const manualState = recordFlowManualTranslationUnitEdit(concurrentManual, 'en-us', {
    unitMap: 'blocks',
    unitId: 'paragraph_1',
});
concurrentManual.flow.translationState = manualState.translationState;
const concurrentPlan = createFlowTranslationApplyPlan(concurrentManual, request, providerResponse);
assert.equal(concurrentPlan.ready, false);
assert.ok(concurrentPlan.issues.some((issue) => (
    issue.unitId === 'paragraph_1' && issue.reason === 'target-changed'
)));

assert.throws(
    () => createFlowTranslationApplyPlan({ ...group, id: 'another_group' }, request, providerResponse),
    (error) => error instanceof FlowTranslationRequestError
        && error.code === 'FLOW_TRANSLATION_REQUEST_MISMATCH',
);

console.log('Flow translation provider request and atomic-plan verification passed.');
