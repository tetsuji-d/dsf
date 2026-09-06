import assert from 'node:assert/strict';
import {
    FIXED_PROJECT_BLOCK_KINDS,
    FLOW_CANONICAL_PAGE_PRESET,
    FLOW_GROUP_KIND,
    FLOW_LAYOUT_SCHEMA_VERSION,
    PROJECT_SCHEMA_VERSION,
    FlowProjectValidationError,
    assertValidFlowProjectData,
    createFlowGroupBlock,
    createFlowLayoutSettings,
    createFlowProjectData,
    getFlowProjectModelVersions,
    hasFlowGroups,
    normalizeFlowProjectData,
    validateFlowGroupBlock,
    validateFlowLayoutSettings,
    validateFlowProjectData,
} from '../js/flow-project-model.js';
import { FLOW_DOCUMENT_SCHEMA_VERSION } from '../js/flow-document.js';
import { FLOW_TRANSLATION_STATE_SCHEMA_VERSION } from '../js/flow-translation-state.js';
import { PAGE_SCHEMA_VERSION, normalizeProjectDataV5 } from '../js/pages.js';

let generatedId = 0;
const idFactory = (prefix) => `${prefix}_${++generatedId}`;

function hasIssue(result, code, path) {
    return result.issues.some((issue) => (
        issue.code === code && (path === undefined || issue.path === path)
    ));
}

function clone(value) {
    return structuredClone(value);
}

assert.deepEqual(getFlowProjectModelVersions(), {
    project: 6,
    flowDocument: 1,
    flowLayout: 1,
    flowTranslationState: 1,
});
assert.equal(PROJECT_SCHEMA_VERSION, 6);
assert.equal(PAGE_SCHEMA_VERSION, 5);
assert.equal(FLOW_DOCUMENT_SCHEMA_VERSION, 1);
assert.equal(FLOW_LAYOUT_SCHEMA_VERSION, 1);
assert.equal(FLOW_TRANSLATION_STATE_SCHEMA_VERSION, 1);

const factoryGroup = createFlowGroupBlock({ idFactory });
assert.equal(factoryGroup.kind, FLOW_GROUP_KIND);
assert.match(factoryGroup.id, /^flow_group_/);
assert.equal(Object.prototype.hasOwnProperty.call(factoryGroup, 'status'), false);
assert.equal(factoryGroup.flow.document.schemaVersion, FLOW_DOCUMENT_SCHEMA_VERSION);
assert.equal(factoryGroup.flow.document.layoutType, 'flow');
assert.equal(factoryGroup.flow.document.sourceLanguage, 'ja');
assert.equal(factoryGroup.flow.document.sections.length, 1);
assert.equal(factoryGroup.flow.document.sections[0].blocks[0].type, 'paragraph');
assert.equal(factoryGroup.flow.layout.schemaVersion, FLOW_LAYOUT_SCHEMA_VERSION);
assert.equal(factoryGroup.flow.layout.pagePreset, FLOW_CANONICAL_PAGE_PRESET);
assert.deepEqual(factoryGroup.flow.layout.padding, { top: 20, right: 20, bottom: 20, left: 20 });
assert.equal(factoryGroup.flow.layout.typographyByLanguage.ja.writingMode, 'horizontal-tb');
assert.equal(validateFlowGroupBlock(factoryGroup).valid, true);

const sourceInjectedGroup = createFlowGroupBlock({
    sourceLanguage: 'en-us',
    document: {
        id: 'source_injected_document',
        sections: [{ id: 'source_injected_section', title: {}, blocks: [] }],
    },
    idFactory,
});
assert.equal(sourceInjectedGroup.flow.document.sourceLanguage, 'en-us');
assert.equal(sourceInjectedGroup.flow.layout.typographyByLanguage['en-us'].writingMode, 'horizontal-tb');
assert.equal(validateFlowGroupBlock(sourceInjectedGroup).valid, true);

const factoryProject = createFlowProjectData({
    version: 5,
    projectName: 'Flow project',
    blocks: [factoryGroup],
});
assert.equal(factoryProject.version, PROJECT_SCHEMA_VERSION);
assert.equal(factoryProject.blocks.length, 1);
assert.equal(hasFlowGroups(factoryProject), true);
assert.equal(validateFlowProjectData(factoryProject).valid, true);
assert.equal(Object.prototype.hasOwnProperty.call(factoryProject, 'pages'), false);
assert.equal(Object.prototype.hasOwnProperty.call(factoryProject.blocks[0].flow, 'generatedPages'), false);

const fixedKinds = FIXED_PROJECT_BLOCK_KINDS.map((kind, index) => ({
    id: `fixed_${kind}_${index}`,
    kind,
    futureFixed: { keep: kind },
    content: {
        texts: { ja: `固定 ${kind}`, 'en-us': `Fixed ${kind}` },
        backgrounds: { ja: `https://example.test/${kind}.webp` },
        layers: [{ id: `layer_${index}`, type: 'text', futureLayer: true }],
        _flow: { legacyFixedContinuation: true },
    },
}));
const fixedInput = {
    version: 5,
    projectName: 'Legacy fixed',
    futureRoot: { keep: true },
    blocks: fixedKinds,
};
const fixedBefore = clone(fixedInput);
const fixedNormalized = normalizeFlowProjectData(fixedInput);
assert.deepEqual(fixedInput, fixedBefore);
assert.equal(fixedNormalized.version, PROJECT_SCHEMA_VERSION);
assert.deepEqual(fixedNormalized.blocks, fixedKinds);
assert.deepEqual(fixedNormalized.futureRoot, { keep: true });
assert.equal(validateFlowProjectData(fixedNormalized).valid, true);
assert.equal(hasFlowGroups(fixedNormalized), false);
fixedNormalized.blocks[0].futureFixed.keep = 'changed';
assert.equal(fixedInput.blocks[0].futureFixed.keep, 'cover_front');

const existingV5Fixture = normalizeProjectDataV5({
    version: 5,
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    blocks: [{
        id: 'existing-page',
        kind: 'page',
        content: {
            pageKind: 'image',
            background: 'https://example.test/fixed.webp',
            backgrounds: { ja: 'https://example.test/fixed.webp' },
            texts: { ja: '固定本文' },
        },
    }],
});
assert.equal(existingV5Fixture.version, PAGE_SCHEMA_VERSION);
assert.equal(existingV5Fixture.blocks.length, 1);
assert.equal(existingV5Fixture.blocks[0].kind, 'page');
assert.equal(existingV5Fixture.blocks[0].content.background, 'https://example.test/fixed.webp');

const exactText = '  Leading\nTrailing  ';
const mixedGroup = createFlowGroupBlock({
    id: 'flow_group_story',
    sourceLanguage: 'en-us',
    document: {
        schemaVersion: 1,
        layoutType: 'flow',
        id: 'flow_document_story',
        sourceLanguage: 'en-us',
        futureDocument: { keep: true },
        sections: [{
            id: 'flow_section_story',
            title: { 'en-us': ' Chapter ', ja: ' 章 ' },
            futureSection: { keep: true },
            blocks: [{
                id: 'flow_paragraph_story',
                type: 'paragraph',
                texts: { 'en-us': exactText, ja: ' 日本語 ' },
                futureSemantic: { keep: true },
            }],
        }],
    },
    layout: {
        schemaVersion: 1,
        pagePreset: 'dsf-canonical',
        padding: { top: 24, right: 22, bottom: 24, left: 22 },
        typographyByLanguage: {
            'en-us': { writingMode: 'horizontal-tb', fontSize: 17 },
            ja: { writingMode: 'vertical-rl', fontSize: 16 },
        },
        futureLayout: { keep: true },
    },
    extensions: { futureGroup: { keep: true } },
    flowExtensions: { futureFlowPayload: { keep: true } },
});
const mixedInput = {
    version: 6,
    languages: ['ja', 'en-us'],
    blocks: [
        fixedKinds[7],
        mixedGroup,
        { ...fixedKinds[7], id: 'fixed_after_flow' },
    ],
};
const mixedBefore = clone(mixedInput);
const mixedNormalized = normalizeFlowProjectData(mixedInput);
assert.deepEqual(mixedInput, mixedBefore);
assert.deepEqual(mixedNormalized.blocks.map((block) => block.kind), ['page', 'flow', 'page']);
assert.deepEqual(mixedNormalized.blocks.map((block) => block.id), [
    fixedKinds[7].id,
    'flow_group_story',
    'fixed_after_flow',
]);
assert.deepEqual(mixedNormalized.blocks[0], fixedKinds[7]);
assert.deepEqual(mixedNormalized.blocks[2], { ...fixedKinds[7], id: 'fixed_after_flow' });
assert.equal(mixedNormalized.blocks[1].flow.document.sections[0].blocks[0].texts['en-us'], exactText);
assert.equal(Object.prototype.hasOwnProperty.call(
    mixedNormalized.blocks[1].flow.document.sections[0].blocks[0].texts,
    'en-US',
), false);
assert.deepEqual(mixedNormalized.blocks[1].futureGroup, { keep: true });
assert.deepEqual(mixedNormalized.blocks[1].flow.futureFlowPayload, { keep: true });
assert.deepEqual(mixedNormalized.blocks[1].flow.layout.futureLayout, { keep: true });
assert.deepEqual(mixedNormalized.blocks[1].flow.document.futureDocument, { keep: true });
assert.deepEqual(mixedNormalized.blocks[1].flow.document.sections[0].futureSection, { keep: true });
assert.deepEqual(
    mixedNormalized.blocks[1].flow.document.sections[0].blocks[0].futureSemantic,
    { keep: true },
);
assert.deepEqual(validateFlowProjectData(mixedNormalized).issues, []);
assert.deepEqual(normalizeFlowProjectData(mixedNormalized), mixedNormalized);

const flowOnly = normalizeFlowProjectData({ version: 5, blocks: [factoryGroup] });
assert.equal(flowOnly.blocks.length, 1);
assert.equal(flowOnly.blocks[0].kind, 'flow');
assert.equal(Object.prototype.hasOwnProperty.call(flowOnly, 'sections'), false);
assert.equal(Object.prototype.hasOwnProperty.call(flowOnly, 'pages'), false);

const futureVersion = normalizeFlowProjectData({ version: 7, blocks: [] });
assert.equal(futureVersion.version, 7);
assert.equal(hasIssue(validateFlowProjectData(futureVersion), 'unsupported_project_schema_version', 'version'), true);
const invalidVersion = normalizeFlowProjectData({ version: 0, blocks: [] });
assert.equal(invalidVersion.version, 0);
assert.equal(validateFlowProjectData(invalidVersion).valid, false);

const legacySectionsOnly = normalizeFlowProjectData({
    version: 5,
    languages: ['ja'],
    sections: [{
        type: 'image',
        background: 'https://example.test/legacy-section.webp',
        texts: { ja: '旧セクション' },
    }],
});
assert.equal(legacySectionsOnly.version, 6);
assert.equal(legacySectionsOnly.blocks.length, 1);
assert.equal(legacySectionsOnly.blocks[0].kind, 'page');
assert.equal(validateFlowProjectData(legacySectionsOnly).valid, true);

const legacyPagesOnly = normalizeFlowProjectData({
    version: 5,
    languages: ['ja'],
    pages: [{
        id: 'legacy-page-only',
        role: 'normal',
        bodyKind: 'image',
        content: { background: 'https://example.test/legacy-page.webp' },
    }],
});
assert.equal(legacyPagesOnly.version, 6);
assert.equal(legacyPagesOnly.blocks[0].id, 'legacy-page-only');
assert.equal(validateFlowProjectData(legacyPagesOnly).valid, true);

const wronglyVersionedFlow = normalizeFlowProjectData({ version: 5, blocks: [factoryGroup] });
assert.equal(wronglyVersionedFlow.version, 5);
assert.equal(wronglyVersionedFlow.blocks[0].kind, 'flow');
assert.equal(hasIssue(
    validateFlowProjectData(wronglyVersionedFlow),
    'unsupported_project_schema_version',
    'version',
), true);

const missingFlowPayload = normalizeFlowProjectData({
    version: 6,
    blocks: [{ id: 'flow_missing_payload', kind: 'flow', future: { keep: true } }],
});
assert.equal(Object.prototype.hasOwnProperty.call(missingFlowPayload.blocks[0], 'flow'), false);
assert.deepEqual(missingFlowPayload.blocks[0].future, { keep: true });
assert.equal(hasIssue(
    validateFlowProjectData(missingFlowPayload),
    'invalid_flow_group_payload',
    'blocks[0].flow',
), true);

const invalidNestedFlow = normalizeFlowProjectData({
    version: 6,
    blocks: [{
        id: 'flow_invalid_nested',
        kind: 'flow',
        flow: { document: null, layout: 'not-layout' },
    }],
});
assert.equal(invalidNestedFlow.blocks[0].flow.document, null);
assert.equal(invalidNestedFlow.blocks[0].flow.layout, 'not-layout');
const invalidNestedResult = validateFlowProjectData(invalidNestedFlow);
assert.equal(hasIssue(invalidNestedResult, 'invalid_flow_document', 'blocks[0].flow.document'), true);
assert.equal(hasIssue(invalidNestedResult, 'invalid_flow_layout', 'blocks[0].flow.layout'), true);

const futureSemanticProject = normalizeFlowProjectData({
    version: 6,
    blocks: [{
        id: 'flow_future_semantic',
        kind: 'flow',
        flow: {
            document: {
                schemaVersion: 1,
                layoutType: 'flow',
                id: 'future_semantic_document',
                sourceLanguage: 'ja',
                sections: [{
                    id: 'future_semantic_section',
                    title: {},
                    blocks: [{
                        id: 'future_semantic_block',
                        type: 'futureWidget',
                        payload: { keep: true },
                    }],
                }],
            },
            layout: createFlowLayoutSettings(),
        },
    }],
});
assert.deepEqual(
    futureSemanticProject.blocks[0].flow.document.sections[0].blocks[0].payload,
    { keep: true },
);
assert.equal(hasIssue(
    validateFlowProjectData(futureSemanticProject),
    'unsupported_block_type',
    'blocks[0].flow.document.sections[0].blocks[0].type',
), true);

const unknownProjectBlock = normalizeFlowProjectData({
    version: 6,
    blocks: [{ id: 'future_outer', kind: 'futureProjectBlock', payload: { keep: true } }],
});
assert.deepEqual(unknownProjectBlock.blocks[0].payload, { keep: true });
assert.equal(hasIssue(
    validateFlowProjectData(unknownProjectBlock),
    'unsupported_project_block_kind',
    'blocks[0].kind',
), true);

const futureDocumentVersion = normalizeFlowProjectData({
    version: 6,
    blocks: [{
        ...factoryGroup,
        id: 'future_document_group',
        flow: {
            ...factoryGroup.flow,
            document: { ...factoryGroup.flow.document, id: 'future_document', schemaVersion: 3 },
        },
    }],
});
assert.equal(futureDocumentVersion.blocks[0].flow.document.schemaVersion, 3);
assert.equal(hasIssue(
    validateFlowProjectData(futureDocumentVersion),
    'unsupported_schema_version',
    'blocks[0].flow.document.schemaVersion',
), true);

const duplicateGroup = clone(factoryGroup);
duplicateGroup.flow.document.id = 'duplicate_document_a';
const duplicateGroupTwo = clone(factoryGroup);
duplicateGroupTwo.flow.document.id = 'duplicate_document_b';
const duplicateOuterResult = validateFlowProjectData({
    version: 6,
    blocks: [duplicateGroup, duplicateGroupTwo],
});
assert.equal(hasIssue(duplicateOuterResult, 'duplicate_project_block_id', 'blocks[1].id'), true);

duplicateGroupTwo.id = 'different_group';
duplicateGroupTwo.flow.document.id = duplicateGroup.flow.document.id;
const duplicateDocumentResult = validateFlowProjectData({
    version: 6,
    blocks: [duplicateGroup, duplicateGroupTwo],
});
assert.equal(hasIssue(
    duplicateDocumentResult,
    'duplicate_flow_document_id',
    'blocks[1].flow.document.id',
), true);

const runtimeDataProject = normalizeFlowProjectData({
    version: 6,
    blocks: [{
        ...factoryGroup,
        id: 'runtime_data_group',
        flow: {
            ...factoryGroup.flow,
            document: { ...factoryGroup.flow.document, id: 'runtime_data_document' },
            generatedPages: [{ index: 0 }],
            paginationCache: { stale: true },
        },
    }],
});
assert.deepEqual(runtimeDataProject.blocks[0].flow.generatedPages, [{ index: 0 }]);
const runtimeDataResult = validateFlowProjectData(runtimeDataProject);
assert.equal(hasIssue(runtimeDataResult, 'persisted_flow_runtime_data', 'blocks[0].flow.generatedPages'), true);
assert.equal(hasIssue(runtimeDataResult, 'persisted_flow_runtime_data', 'blocks[0].flow.paginationCache'), true);

const deepRuntimeDataProject = normalizeFlowProjectData({
    version: 6,
    blocks: [{
        ...factoryGroup,
        id: 'deep_runtime_group',
        flow: {
            ...factoryGroup.flow,
            document: {
                ...factoryGroup.flow.document,
                id: 'deep_runtime_document',
                generatedPages: [{ index: 0 }],
                sections: [{
                    id: 'deep_runtime_section',
                    title: {},
                    blocks: [{
                        id: 'deep_runtime_paragraph',
                        type: 'paragraph',
                        texts: { pages: 'exact language key is not structural', ja: '本文' },
                        fragments: [{ text: 'derived' }],
                    }],
                }],
            },
            layout: {
                ...factoryGroup.flow.layout,
                paginationCache: { stale: true },
            },
        },
    }],
});
const deepRuntimeResult = validateFlowProjectData(deepRuntimeDataProject);
assert.equal(hasIssue(
    deepRuntimeResult,
    'persisted_flow_runtime_data',
    'blocks[0].flow.document.generatedPages',
), true);
assert.equal(hasIssue(
    deepRuntimeResult,
    'persisted_flow_runtime_data',
    'blocks[0].flow.document.sections[0].blocks[0].fragments',
), true);
assert.equal(hasIssue(
    deepRuntimeResult,
    'persisted_flow_runtime_data',
    'blocks[0].flow.layout.paginationCache',
), true);
assert.equal(deepRuntimeResult.issues.some((issue) => issue.path.endsWith('.texts.pages')), false);

const extensionRuntimeBypass = clone(factoryGroup);
extensionRuntimeBypass.id = 'extension_runtime_group';
extensionRuntimeBypass.flow.document.id = 'extension_runtime_document';
extensionRuntimeBypass.flow.document.extension = {
    texts: { generatedPages: [{ index: 0 }] },
    title: { paginationCache: { stale: true } },
};
const extensionRuntimeResult = validateFlowGroupBlock(extensionRuntimeBypass);
assert.equal(hasIssue(
    extensionRuntimeResult,
    'persisted_flow_runtime_data',
    'flow.document.extension.texts.generatedPages',
), true);
assert.equal(hasIssue(
    extensionRuntimeResult,
    'persisted_flow_runtime_data',
    'flow.document.extension.title.paginationCache',
), true);

const invalidLayout = createFlowLayoutSettings({
    sourceLanguage: 'en-us',
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    typographyByLanguage: { 'en-us': { writingMode: 'vertical-rl' } },
});
assert.equal(hasIssue(
    validateFlowLayoutSettings(invalidLayout),
    'unsupported_flow_writing_mode',
    'typographyByLanguage.en-us.writingMode',
), true);
const noContentArea = createFlowLayoutSettings({
    padding: { top: 320, right: 20, bottom: 320, left: 20 },
});
assert.equal(hasIssue(validateFlowLayoutSettings(noContentArea), 'invalid_flow_padding', 'padding'), true);
const invalidFontWeight = createFlowLayoutSettings({
    typographyByLanguage: { ja: { writingMode: 'horizontal-tb', fontWeight: Number.POSITIVE_INFINITY } },
});
assert.equal(hasIssue(
    validateFlowLayoutSettings(invalidFontWeight),
    'invalid_flow_typography',
    'typographyByLanguage.ja.fontWeight',
), true);
const whitespaceLanguageKey = createFlowLayoutSettings({
    typographyByLanguage: {
        ja: { writingMode: 'horizontal-tb' },
        'ja ': { writingMode: 'horizontal-tb' },
    },
});
assert.equal(hasIssue(
    validateFlowLayoutSettings(whitespaceLanguageKey),
    'invalid_language_key',
    'typographyByLanguage.ja ',
), true);

const missingSourceTypography = clone(factoryGroup);
missingSourceTypography.flow.layout.typographyByLanguage = {};
assert.equal(hasIssue(
    validateFlowGroupBlock(missingSourceTypography),
    'missing_source_typography',
    'flow.layout.typographyByLanguage.ja',
), true);
const wrongSourceTypography = clone(factoryGroup);
wrongSourceTypography.flow.layout.typographyByLanguage = {
    'en-us': { writingMode: 'horizontal-tb' },
};
assert.equal(validateFlowGroupBlock(wrongSourceTypography).valid, false);
assert.throws(() => createFlowGroupBlock({
    sourceLanguage: 'ja',
    document: {
        schemaVersion: 1,
        layoutType: 'flow',
        id: 'conflicting-source-document',
        sourceLanguage: 'en-us',
        sections: [],
    },
}), RangeError);
assert.throws(() => createFlowGroupBlock({ document: null }), TypeError);
assert.throws(() => createFlowGroupBlock({ layout: null }), TypeError);

const duplicateNestedId = clone(factoryGroup);
duplicateNestedId.id = 'duplicate_nested_group';
duplicateNestedId.flow.document.id = duplicateNestedId.flow.document.sections[0].id;
const duplicateNestedResult = validateFlowProjectData({ version: 6, blocks: [duplicateNestedId] });
const duplicateNestedIssue = duplicateNestedResult.issues.find((issue) => issue.code === 'duplicate_id');
assert.equal(duplicateNestedIssue.path, 'blocks[0].flow.document.sections[0].id');
assert.equal(duplicateNestedIssue.firstPath, 'blocks[0].flow.document.id');

assert.throws(() => normalizeFlowProjectData(null), TypeError);
assert.throws(() => createFlowProjectData(null), TypeError);
const invalidBlocks = normalizeFlowProjectData({ version: 6, blocks: null, sections: [{ keep: true }] });
assert.equal(invalidBlocks.blocks, null);
assert.deepEqual(invalidBlocks.sections, [{ keep: true }]);
assert.equal(hasIssue(validateFlowProjectData(invalidBlocks), 'invalid_project_blocks', 'blocks'), true);
const nullBlock = normalizeFlowProjectData({ version: 6, blocks: [null] });
assert.equal(nullBlock.blocks[0], null);
assert.equal(hasIssue(validateFlowProjectData(nullBlock), 'invalid_project_block', 'blocks[0]'), true);
const fixedMissingId = normalizeFlowProjectData({ version: 6, blocks: [{ kind: 'page', content: {} }] });
assert.equal(hasIssue(validateFlowProjectData(fixedMissingId), 'missing_id', 'blocks[0].id'), true);
const orphanedLegacyProjection = normalizeFlowProjectData({
    version: 6,
    blocks: [],
    sections: [{ type: 'image', background: 'orphaned.webp' }],
});
assert.equal(hasIssue(
    validateFlowProjectData(orphanedLegacyProjection),
    'legacy_content_without_blocks',
    'blocks',
), true);

assert.throws(
    () => assertValidFlowProjectData(missingFlowPayload),
    (error) => error instanceof FlowProjectValidationError
        && error.code === 'FLOW_PROJECT_INVALID'
        && error.issues.length > 0,
);

console.log('Flow Project v6 authoring model verification passed.');
