import assert from 'node:assert/strict';

import {
    createFlowGroupBlock,
    normalizeFlowGroupBlock,
    validateFlowGroupBlock,
} from '../js/flow-project-model.js';
import {
    FLOW_TRANSLATION_FINGERPRINT_PATTERN,
    FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    FlowTranslationStateValidationError,
    assertValidFlowTranslationState,
    buildFlowTranslationSourceFingerprints,
    createFlowBlockSourceFingerprint,
    createFlowSectionTitleSourceFingerprint,
    createFlowTranslationLanguageBaseline,
    deriveFlowTranslationStatus,
    normalizeFlowTranslationState,
    validateFlowTranslationState,
} from '../js/flow-translation-state.js';
import {
    FIRESTORE_AUTHORING_MAX_BYTES,
    assertFirestoreAuthoringSize,
    createPublicProjectProjection,
    deserializeProject,
    measureUtf8JsonBytes,
    prepareProjectForSave,
    serializeProject,
} from '../js/project-persistence.js';

const clone = (value) => structuredClone(value);
let idCounter = 0;
const idFactory = (prefix) => `${prefix}_${++idCounter}`;
const hasIssue = (result, code, path = null) => result.issues.some((issue) => (
    issue.code === code && (path === null || issue.path === path)
));

function createFixtureGroup() {
    return createFlowGroupBlock({
        id: 'flow_translation_fixture',
        sourceLanguage: 'ja',
        idFactory,
        document: {
            id: 'flow_translation_document',
            sourceLanguage: 'ja',
            sections: [{
                id: 'section_one',
                title: { ja: '第一章', 'en-us': 'Chapter One' },
                blocks: [{
                    id: 'heading_one',
                    type: 'heading',
                    level: 1,
                    texts: { ja: '雪の町', 'en-us': 'Town of Snow' },
                }, {
                    id: 'paragraph_one',
                    type: 'paragraph',
                    texts: {
                        ja: '冬の金沢は静かだった。\n結合文字 e\u0301 と絵文字😀を保持する。',
                        'en-us': 'Kanazawa was quiet in winter.\nKeep e\u0301 and 😀 exact.',
                    },
                }, {
                    id: 'page_break_one',
                    type: 'pageBreak',
                }, {
                    id: 'paragraph_empty',
                    type: 'paragraph',
                    texts: { ja: '', 'en-us': '' },
                }],
            }, {
                id: 'section_two',
                title: { ja: '第二章', 'en-us': 'Chapter Two' },
                blocks: [{
                    id: 'paragraph_two',
                    type: 'paragraph',
                    texts: { ja: '次の場面。', 'en-us': 'The next scene.' },
                }],
            }],
        },
        layout: {
            typographyByLanguage: {
                ja: { writingMode: 'vertical-rl', fontSize: 16 },
                'en-us': { writingMode: 'horizontal-tb', fontSize: 15 },
            },
        },
    });
}

const fixture = createFixtureGroup();
const fixtureBefore = clone(fixture);
assert.equal(Object.hasOwn(normalizeFlowGroupBlock(fixture).flow, 'translationState'), false);
const fingerprints = buildFlowTranslationSourceFingerprints(fixture);
assert.deepEqual(fixture, fixtureBefore, 'fingerprinting must not mutate the Flow group');
assert.equal(Object.keys(fingerprints.blocks).length, 4);
assert.equal(Object.keys(fingerprints.sectionTitles).length, 2);
assert.equal(Object.hasOwn(fingerprints.blocks, 'page_break_one'), false);
for (const fingerprint of [
    ...Object.values(fingerprints.blocks),
    ...Object.values(fingerprints.sectionTitles),
]) {
    assert.match(fingerprint, FLOW_TRANSLATION_FINGERPRINT_PATTERN);
    assert.equal(fingerprint.length, 13);
}
assert.deepEqual(buildFlowTranslationSourceFingerprints(clone(fixture)), fingerprints);

const goldenFingerprints = [
    ['ascii', { id: 'b_ascii', type: 'paragraph', texts: { ja: 'abc' } }, 'u12BVQUeUq1PM'],
    ['japanese', { id: 'b_jp', type: 'paragraph', texts: { ja: '雪の町' } }, 'u1ASkkXD3Hfv0'],
    ['emoji-combining', { id: 'b_emoji', type: 'paragraph', texts: { ja: 'e\u0301😀' } }, 'u1NYyepqX8R1U'],
    ['intentional-empty', { id: 'b_empty', type: 'paragraph', texts: { ja: '' } }, 'u1MUDqJ2yRxwk'],
    ['missing-key', { id: 'b_missing', type: 'paragraph', texts: {} }, 'u1iG7OEqsC0n0'],
];
for (const [label, block, expected] of goldenFingerprints) {
    assert.equal(
        createFlowBlockSourceFingerprint('s', block, 'ja'),
        expected,
        `${label} fingerprint is an on-disk compatibility vector; algorithm changes require u2`,
    );
}
assert.equal(
    createFlowSectionTitleSourceFingerprint({ id: 's_title', title: { ja: '第一章' } }, 'ja'),
    'u1zWL-o0aCMo4',
    'Section title fingerprint is an on-disk compatibility vector; algorithm changes require u2',
);
assert.equal(
    createFlowSectionTitleSourceFingerprint({ id: 's_empty', title: { ja: '' } }, 'ja'),
    'u1SzBmxae3llo',
    'empty Section title fingerprint is an on-disk compatibility vector; algorithm changes require u2',
);

const sourceChanged = clone(fixture);
sourceChanged.flow.document.sections[0].blocks[1].texts.ja += ' ';
const changedFingerprints = buildFlowTranslationSourceFingerprints(sourceChanged);
assert.notEqual(changedFingerprints.blocks.paragraph_one, fingerprints.blocks.paragraph_one);
assert.equal(changedFingerprints.blocks.heading_one, fingerprints.blocks.heading_one);
assert.equal(changedFingerprints.blocks.paragraph_two, fingerprints.blocks.paragraph_two);

const targetChanged = clone(fixture);
targetChanged.flow.document.sections[0].blocks[1].texts['en-us'] = 'Changed target only';
targetChanged.flow.document.sections[0].title['en-us'] = 'Changed target title only';
targetChanged.flow.layout.typographyByLanguage['en-us'].fontSize = 99;
assert.deepEqual(buildFlowTranslationSourceFingerprints(targetChanged), fingerprints);

const headingLevelChanged = clone(fixture);
headingLevelChanged.flow.document.sections[0].blocks[0].level = 6;
assert.deepEqual(buildFlowTranslationSourceFingerprints(headingLevelChanged), fingerprints);

const pageBreakMoved = clone(fixture);
const pageBreak = pageBreakMoved.flow.document.sections[0].blocks.splice(2, 1)[0];
pageBreakMoved.flow.document.sections[0].blocks.unshift(pageBreak);
assert.deepEqual(buildFlowTranslationSourceFingerprints(pageBreakMoved), fingerprints);

const pageBreakAdded = clone(fixture);
pageBreakAdded.flow.document.sections[1].blocks.push({ id: 'page_break_two', type: 'pageBreak' });
assert.deepEqual(buildFlowTranslationSourceFingerprints(pageBreakAdded), fingerprints);

const reordered = clone(fixture);
const reorderedBlocks = reordered.flow.document.sections[0].blocks;
[reorderedBlocks[0], reorderedBlocks[1]] = [reorderedBlocks[1], reorderedBlocks[0]];
assert.deepEqual(buildFlowTranslationSourceFingerprints(reordered), fingerprints);

const movedSection = clone(fixture);
const movedBlock = movedSection.flow.document.sections[0].blocks.splice(1, 1)[0];
movedSection.flow.document.sections[1].blocks.push(movedBlock);
assert.notEqual(
    buildFlowTranslationSourceFingerprints(movedSection).blocks.paragraph_one,
    fingerprints.blocks.paragraph_one,
);

const titleChanged = clone(fixture);
titleChanged.flow.document.sections[0].title.ja += ' ';
const titleFingerprints = buildFlowTranslationSourceFingerprints(titleChanged);
assert.notEqual(titleFingerprints.sectionTitles.section_one, fingerprints.sectionTitles.section_one);
assert.deepEqual(titleFingerprints.blocks, fingerprints.blocks);

const missingSourceKey = clone(fixture);
delete missingSourceKey.flow.document.sections[0].blocks[3].texts.ja;
assert.notEqual(
    buildFlowTranslationSourceFingerprints(missingSourceKey).blocks.paragraph_empty,
    fingerprints.blocks.paragraph_empty,
    'missing exact source key must differ from an intentional empty string',
);
assert.notEqual(
    createFlowBlockSourceFingerprint(
        'section_one',
        fixture.flow.document.sections[0].blocks[1],
        'ja',
    ),
    createFlowBlockSourceFingerprint(
        'section_one',
        { ...fixture.flow.document.sections[0].blocks[1], texts: { JA: fixture.flow.document.sections[0].blocks[1].texts.ja } },
        'JA',
    ),
    'exact saved language keys must participate in the fingerprint',
);

const legacyStatus = deriveFlowTranslationStatus(fixture, 'en-us');
assert.equal(legacyStatus.status, 'untracked');
assert.equal(legacyStatus.contentReady, true);
assert.equal(legacyStatus.requiresSourceFallback, false, '8B-1 manual translations remain visible');
assert.equal(legacyStatus.body.counts.untracked, 4);
assert.equal(legacyStatus.body.counts.locked, 4);
assert.equal(legacyStatus.outline.counts.untracked, 2);

const exactCaseStatus = deriveFlowTranslationStatus(fixture, 'EN-US');
assert.equal(exactCaseStatus.status, 'missing');
assert.equal(exactCaseStatus.body.counts.missing, 4);
assert.equal(exactCaseStatus.requiresSourceFallback, true);
const sourceStatus = deriveFlowTranslationStatus(fixture, 'ja');
assert.equal(sourceStatus.status, 'source');
assert.equal(sourceStatus.body.counts.current, 4);

const partial = clone(fixture);
delete partial.flow.document.sections[1].blocks[0].texts['en-us'];
const partialStatus = deriveFlowTranslationStatus(partial, 'en-us');
assert.equal(partialStatus.status, 'partial');
assert.deepEqual(partialStatus.body.ids.missing, ['paragraph_two']);
assert.equal(partialStatus.requiresSourceFallback, true);

const machineBaseline = createFlowTranslationLanguageBaseline(fixture, 'en-us', {
    origin: 'machine',
    reviewState: 'needs-review',
});
assert.equal(Object.hasOwn(machineBaseline, 'lockedUnitIds'), false);
const tracked = clone(fixture);
tracked.flow.translationState = {
    schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    languages: { 'en-us': machineBaseline },
};
assert.equal(validateFlowGroupBlock(tracked).valid, true);
const needsReview = deriveFlowTranslationStatus(tracked, 'en-us');
assert.equal(needsReview.status, 'needs-review');
assert.equal(needsReview.body.counts.current, 4);
assert.equal(needsReview.outline.counts.current, 2);
assert.equal(needsReview.requiresSourceFallback, false);

const reviewed = clone(tracked);
reviewed.flow.translationState.languages['en-us'].reviewState = 'reviewed';
assert.equal(deriveFlowTranslationStatus(reviewed, 'en-us').status, 'reviewed');

const staleBody = clone(tracked);
staleBody.flow.document.sections[0].blocks[1].texts.ja += '追記';
const staleBodyStatus = deriveFlowTranslationStatus(staleBody, 'en-us');
assert.equal(staleBodyStatus.status, 'stale');
assert.deepEqual(staleBodyStatus.body.ids.stale, ['paragraph_one']);
assert.equal(staleBodyStatus.body.counts.current, 3);
assert.equal(staleBodyStatus.requiresSourceFallback, true);

const staleOutline = clone(tracked);
staleOutline.flow.document.sections[0].title.ja += '追記';
const staleOutlineStatus = deriveFlowTranslationStatus(staleOutline, 'en-us');
assert.equal(staleOutlineStatus.status, 'stale');
assert.deepEqual(staleOutlineStatus.outline.ids.stale, ['section_one']);
assert.equal(staleOutlineStatus.requiresSourceFallback, false);
assert.equal(staleOutlineStatus.hasOutlineIssues, true);
const reviewedStaleOutline = clone(staleOutline);
reviewedStaleOutline.flow.translationState.languages['en-us'].reviewState = 'reviewed';
assert.equal(deriveFlowTranslationStatus(reviewedStaleOutline, 'en-us').status, 'stale');

const untrackedOne = clone(tracked);
delete untrackedOne.flow.translationState.languages['en-us'].sourceFingerprints.blocks.paragraph_one;
const untrackedOneStatus = deriveFlowTranslationStatus(untrackedOne, 'en-us');
assert.equal(untrackedOneStatus.status, 'untracked');
assert.deepEqual(untrackedOneStatus.body.ids.untracked, ['paragraph_one']);
assert.ok(untrackedOneStatus.body.ids.locked.includes('paragraph_one'));

const manualBaseline = createFlowTranslationLanguageBaseline(fixture, 'en-us');
assert.equal(manualBaseline.origin, 'manual');
assert.equal(manualBaseline.reviewState, 'reviewed');
assert.equal(Object.hasOwn(manualBaseline, 'lockedUnitIds'), false);
assert.deepEqual(fixture, fixtureBefore, 'baseline creation must not mutate target text or source');
assert.throws(() => createFlowTranslationLanguageBaseline(fixture, 'ja'), RangeError);
assert.throws(
    () => createFlowTranslationLanguageBaseline(fixture, 'en-us', { lockedUnitIds: null }),
    TypeError,
);

assert.equal(validateFlowTranslationState(undefined, fixture.flow.document).valid, true);
assert.equal(validateFlowTranslationState(tracked.flow.translationState, fixture.flow.document).valid, true);
assert.deepEqual(normalizeFlowTranslationState(tracked.flow.translationState), tracked.flow.translationState);
const futureState = clone(tracked.flow.translationState);
futureState.schemaVersion = 2;
assert.equal(hasIssue(
    validateFlowTranslationState(futureState, fixture.flow.document),
    'unsupported_flow_translation_state_schema_version',
    'schemaVersion',
), true);
const futureGroup = clone(tracked);
futureGroup.flow.translationState = futureState;
assert.equal(hasIssue(
    validateFlowGroupBlock(futureGroup),
    'unsupported_flow_translation_state_schema_version',
    'flow.translationState.schemaVersion',
), true);
assert.throws(
    () => prepareProjectForSave({ version: 6, blocks: [futureGroup], sections: [] }),
    (error) => error?.code === 'FLOW_PROJECT_INVALID',
);
const whitespaceLanguage = clone(tracked.flow.translationState);
whitespaceLanguage.languages['en-us '] = whitespaceLanguage.languages['en-us'];
delete whitespaceLanguage.languages['en-us'];
assert.equal(hasIssue(validateFlowTranslationState(whitespaceLanguage, fixture.flow.document), 'invalid_language_key'), true);
const sourceEntry = clone(tracked.flow.translationState);
sourceEntry.languages.ja = sourceEntry.languages['en-us'];
assert.equal(hasIssue(validateFlowTranslationState(sourceEntry, fixture.flow.document), 'source_language_translation_state'), true);
const invalidFingerprint = clone(tracked.flow.translationState);
invalidFingerprint.languages['en-us'].sourceFingerprints.blocks.paragraph_one = 'bad';
assert.equal(hasIssue(validateFlowTranslationState(invalidFingerprint, fixture.flow.document), 'invalid_flow_translation_fingerprint'), true);
const invalidOrigin = clone(tracked.flow.translationState);
invalidOrigin.languages['en-us'].origin = 'provider';
assert.equal(hasIssue(validateFlowTranslationState(invalidOrigin, fixture.flow.document), 'invalid_flow_translation_origin'), true);
const invalidReview = clone(tracked.flow.translationState);
invalidReview.languages['en-us'].reviewState = 'queued';
assert.equal(hasIssue(validateFlowTranslationState(invalidReview, fixture.flow.document), 'invalid_flow_translation_review_state'), true);
const providerSetting = clone(tracked.flow.translationState);
providerSetting.languages['en-us'].providerId = 'chrome-translator';
assert.equal(hasIssue(validateFlowTranslationState(providerSetting, fixture.flow.document), 'persisted_flow_translation_provider_setting'), true);
for (const [key, value] of [
    ['apiKey', 'secret'],
    ['providerId', 'external'],
    ['modelId', 'model'],
    ['baseUrl', 'http://127.0.0.1:1234'],
    ['endpoint', '/v1/chat/completions'],
]) {
    const rootProviderSetting = clone(tracked.flow.translationState);
    rootProviderSetting[key] = value;
    assert.equal(
        hasIssue(
            validateFlowTranslationState(rootProviderSetting, fixture.flow.document),
            'persisted_flow_translation_provider_setting',
            key,
        ),
        true,
    );
}
const runtimeState = clone(tracked.flow.translationState);
runtimeState.languages['en-us'].progress = 0.5;
assert.equal(hasIssue(validateFlowTranslationState(runtimeState, fixture.flow.document), 'persisted_flow_translation_runtime_data'), true);
const pageBreakFingerprint = clone(tracked.flow.translationState);
pageBreakFingerprint.languages['en-us'].sourceFingerprints.blocks.page_break_one = fingerprints.blocks.paragraph_one;
assert.equal(hasIssue(validateFlowTranslationState(pageBreakFingerprint, fixture.flow.document), 'unsupported_flow_translation_unit'), true);
const pageBreakLock = clone(tracked.flow.translationState);
pageBreakLock.languages['en-us'].lockedUnitIds = ['page_break_one'];
assert.equal(hasIssue(validateFlowTranslationState(pageBreakLock, fixture.flow.document), 'unsupported_flow_translation_unit'), true);
const orphanFingerprint = clone(tracked.flow.translationState);
orphanFingerprint.languages['en-us'].sourceFingerprints.blocks.removed_old_block = fingerprints.blocks.paragraph_one;
assert.equal(validateFlowTranslationState(orphanFingerprint, fixture.flow.document).valid, true);
const duplicateLock = clone(tracked.flow.translationState);
duplicateLock.languages['en-us'].lockedUnitIds = ['paragraph_one', 'paragraph_one'];
assert.equal(hasIssue(validateFlowTranslationState(duplicateLock, fixture.flow.document), 'duplicate_flow_translation_unit_id'), true);
assert.throws(
    () => assertValidFlowTranslationState(futureState, fixture.flow.document),
    (error) => error instanceof FlowTranslationStateValidationError
        && error.code === 'FLOW_TRANSLATION_STATE_INVALID',
);

const unknownState = clone(tracked);
unknownState.flow.translationState.futureState = { keep: true };
unknownState.flow.translationState.languages['en-us'].futureLanguageState = { keep: true };
const normalizedUnknown = normalizeFlowGroupBlock(unknownState);
assert.deepEqual(normalizedUnknown.flow.translationState.futureState, { keep: true });
assert.deepEqual(
    normalizedUnknown.flow.translationState.languages['en-us'].futureLanguageState,
    { keep: true },
);
assert.notEqual(normalizedUnknown.flow.translationState, unknownState.flow.translationState);
assert.equal(validateFlowGroupBlock(normalizedUnknown).valid, true);

const manualTracked = clone(fixture);
manualTracked.flow.translationState = {
    schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    languages: { 'en-us': manualBaseline },
};
manualTracked.flow.document.sections[1].blocks.push({
    id: 'new_missing_paragraph',
    type: 'paragraph',
    texts: { ja: '後から追加した原文' },
});
const manualWithNewUnit = deriveFlowTranslationStatus(manualTracked, 'en-us');
assert.deepEqual(manualWithNewUnit.body.ids.missing, ['new_missing_paragraph']);
assert.equal(manualWithNewUnit.body.ids.locked.includes('new_missing_paragraph'), false);
assert.equal(manualWithNewUnit.body.ids.locked.includes('paragraph_one'), true);

const inheritedNameIds = createFlowGroupBlock({
    id: 'special_id_group',
    sourceLanguage: 'ja',
    document: {
        id: 'special_id_document',
        sourceLanguage: 'ja',
        sections: [{
            id: 'toString',
            title: { ja: '特殊ID', 'en-us': 'Special IDs' },
            blocks: [{
                id: '__proto__',
                type: 'paragraph',
                texts: { ja: '原文A', 'en-us': 'Source A' },
            }, {
                id: 'constructor',
                type: 'paragraph',
                texts: { ja: '原文B', 'en-us': 'Source B' },
            }, {
                id: 'pagination',
                type: 'paragraph',
                texts: { ja: '原文C', 'en-us': 'Source C' },
            }],
        }],
    },
    layout: {
        typographyByLanguage: {
            ja: { writingMode: 'vertical-rl' },
            'en-us': { writingMode: 'horizontal-tb' },
        },
    },
});
const specialFingerprints = buildFlowTranslationSourceFingerprints(inheritedNameIds);
assert.equal(Object.hasOwn(specialFingerprints.blocks, '__proto__'), true);
assert.equal(Object.hasOwn(specialFingerprints.blocks, 'constructor'), true);
assert.equal(Object.hasOwn(specialFingerprints.blocks, 'pagination'), true);
assert.equal(Object.hasOwn(specialFingerprints.sectionTitles, 'toString'), true);
const specialBaseline = createFlowTranslationLanguageBaseline(inheritedNameIds, 'en-us', {
    origin: 'machine',
    reviewState: 'reviewed',
});
inheritedNameIds.flow.translationState = {
    schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    languages: { 'en-us': specialBaseline },
};
const specialStatus = deriveFlowTranslationStatus(inheritedNameIds, 'en-us');
assert.equal(specialStatus.status, 'reviewed');
assert.equal(specialStatus.body.counts.current, 3);
assert.equal(validateFlowGroupBlock(inheritedNameIds).valid, true);
const normalizedSpecialIds = normalizeFlowGroupBlock(inheritedNameIds);
assert.equal(
    Object.hasOwn(normalizedSpecialIds.flow.translationState.languages['en-us'].sourceFingerprints.blocks, '__proto__'),
    true,
);

const titleWithoutSource = clone(fixture);
delete titleWithoutSource.flow.document.sections[0].title.ja;
delete titleWithoutSource.flow.document.sections[0].title['en-us'];
assert.equal(
    Object.hasOwn(buildFlowTranslationSourceFingerprints(titleWithoutSource).sectionTitles, 'section_one'),
    false,
);
assert.equal(deriveFlowTranslationStatus(titleWithoutSource, 'en-us').outline.counts.total, 1);
const intentionalEmptyTitle = clone(titleWithoutSource);
intentionalEmptyTitle.flow.document.sections[0].title.ja = '';
intentionalEmptyTitle.flow.document.sections[0].title['en-us'] = '';
assert.equal(
    Object.hasOwn(buildFlowTranslationSourceFingerprints(intentionalEmptyTitle).sectionTitles, 'section_one'),
    true,
);

function createLargeGroup(
    sectionCount = 100,
    paragraphsPerSection = 10,
    targetLanguages = ['en-us'],
    options = {},
) {
    const useLongIds = options.longIds === true;
    const sections = Array.from({ length: sectionCount }, (_, sectionIndex) => {
        const sectionSuffix = String(sectionIndex).padStart(12, '0');
        const title = { ja: `容量確認 第${sectionIndex + 1}節` };
        for (const languageKey of targetLanguages) {
            title[languageKey] = `${languageKey} capacity section ${sectionIndex + 1}`;
        }
        const blocks = Array.from({ length: paragraphsPerSection }, (_, paragraphIndex) => {
            const paragraphSuffix = `${String(sectionIndex).padStart(6, '0')}${String(paragraphIndex).padStart(6, '0')}`;
            const texts = {
                ja: `容量確認の原文 ${sectionIndex}-${paragraphIndex}。短い指紋以外は翻訳状態へ複製しない。`,
            };
            for (const languageKey of targetLanguages) {
                texts[languageKey] = `${languageKey} capacity translation ${sectionIndex}-${paragraphIndex}. No copied prose in metadata.`;
            }
            return {
                id: useLongIds
                    ? `paragraph-00000000-0000-4000-8000-${paragraphSuffix}`
                    : `large_paragraph_${String(sectionIndex).padStart(3, '0')}_${String(paragraphIndex).padStart(2, '0')}`,
                type: 'paragraph',
                texts,
            };
        });
        return {
            id: useLongIds
                ? `section-00000000-0000-4000-8000-${sectionSuffix}`
                : `large_section_${String(sectionIndex).padStart(3, '0')}`,
            title,
            blocks,
        };
    });
    const typographyByLanguage = { ja: { writingMode: 'vertical-rl' } };
    for (const languageKey of targetLanguages) {
        typographyByLanguage[languageKey] = { writingMode: 'horizontal-tb' };
    }
    return createFlowGroupBlock({
        id: 'large_flow_group',
        sourceLanguage: 'ja',
        document: { id: 'large_flow_document', sourceLanguage: 'ja', sections },
        layout: { typographyByLanguage },
    });
}

const largeGroup = createLargeGroup();
const largeBaseline = createFlowTranslationLanguageBaseline(largeGroup, 'en-us', {
    origin: 'machine',
    reviewState: 'needs-review',
});
largeGroup.flow.translationState = {
    schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    languages: { 'en-us': largeBaseline },
};
const translationMetadataBytes = measureUtf8JsonBytes(largeGroup.flow.translationState);
assert.ok(
    translationMetadataBytes < 80 * 1024,
    `100-section/1,000-paragraph metadata should stay compact, got ${translationMetadataBytes} bytes`,
);
assert.equal(JSON.stringify(largeGroup.flow.translationState).includes('容量確認の原文'), false);
assert.equal(JSON.stringify(largeGroup.flow.translationState).includes('Capacity translation'), false);

const largeProject = prepareProjectForSave({
    version: 6,
    projectId: 'large_translation_project',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    blocks: [largeGroup],
    sections: [],
});
const largeProjectBytes = assertFirestoreAuthoringSize(largeProject);
assert.ok(largeProjectBytes > translationMetadataBytes);

const fiveTargetLanguages = ['en-us', 'fr', 'de', 'es', 'pt-br'];
const multiLanguageGroup = createLargeGroup(100, 10, fiveTargetLanguages, { longIds: true });
multiLanguageGroup.flow.translationState = {
    schemaVersion: FLOW_TRANSLATION_STATE_SCHEMA_VERSION,
    languages: Object.fromEntries(fiveTargetLanguages.map((languageKey) => [
        languageKey,
        createFlowTranslationLanguageBaseline(multiLanguageGroup, languageKey, {
            origin: 'manual',
            reviewState: 'reviewed',
        }),
    ])),
};
for (const languageState of Object.values(multiLanguageGroup.flow.translationState.languages)) {
    assert.equal(Object.hasOwn(languageState, 'lockedUnitIds'), false, 'manual origin must not duplicate every tracked ID');
}
const multiLanguageMetadataBytes = measureUtf8JsonBytes(multiLanguageGroup.flow.translationState);
assert.ok(
    multiLanguageMetadataBytes < 400 * 1024,
    `five-language UUID-length metadata should stay below 400 KiB, got ${multiLanguageMetadataBytes} bytes`,
);
const multiLanguageProject = prepareProjectForSave({
    version: 6,
    projectId: 'large_multi_translation_project',
    languages: ['ja', ...fiveTargetLanguages],
    defaultLang: 'ja',
    blocks: [multiLanguageGroup],
    sections: [],
});
const multiLanguageProjectBytes = measureUtf8JsonBytes(multiLanguageProject);
assert.ok(multiLanguageProjectBytes > FIRESTORE_AUTHORING_MAX_BYTES);
assert.ok(serializeProject(multiLanguageProject).includes('large_multi_translation_project'));
assert.throws(
    () => assertFirestoreAuthoringSize(multiLanguageProject),
    (error) => error?.code === 'FIRESTORE_AUTHORING_TOO_LARGE'
        && error.actualBytes > FIRESTORE_AUTHORING_MAX_BYTES,
);

const persistedProject = prepareProjectForSave({
    version: 6,
    projectId: 'translation_roundtrip_project',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    blocks: [tracked],
    sections: [],
});
const restoredProject = deserializeProject(serializeProject(persistedProject));
assert.deepEqual(restoredProject.blocks[0].flow.translationState, tracked.flow.translationState);
const publicProjection = createPublicProjectProjection(persistedProject);
assert.equal(JSON.stringify(publicProjection).includes('translationState'), false);
assert.equal(publicProjection.blocks.some((block) => block.kind === 'flow'), false);

console.log(
    `Flow translation state verification passed (${translationMetadataBytes} single-language metadata bytes; `
    + `${largeProjectBytes} single-language project bytes; ${multiLanguageMetadataBytes} five-language metadata bytes; `
    + `${multiLanguageProjectBytes} five-language project bytes).`,
);
