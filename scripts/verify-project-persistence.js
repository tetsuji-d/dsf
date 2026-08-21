import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { syncBlocksWithSections } from '../js/blocks.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
import {
    FIRESTORE_AUTHORING_MAX_BYTES,
    applyDspMetadataFallbacks,
    assertSupportedDspEnvelope,
    assertFirestoreAuthoringSize,
    deserializeProject,
    createPublicProjectProjection,
    hydrateProjectFromPersistence,
    isProjectVersionTransitionAllowed,
    measureUtf8JsonBytes,
    prepareProjectForSave,
    prepareFirestoreProjectIngress,
    serializeProject,
} from '../js/project-persistence.js';
import { clearHistory, pushState, redo, undo } from '../js/history.js';
import { state } from '../js/state.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
let idCounter = 0;
const idFactory = (prefix) => `${prefix}_${++idCounter}`;

const fixedSection = {
    type: 'text',
    text: '固定本文',
    texts: { ja: '固定本文', 'en-us': 'Fixed body' },
    headings: { ja: '固定見出し' },
    bubbles: [],
};
const fixedBlock = {
    id: 'fixed_a',
    kind: 'page',
    futureRoot: { keep: true },
    content: {
        pageKind: 'text',
        text: '旧本文',
        texts: { ja: '旧本文' },
        layers: [{ id: 'layer_a', type: 'shape', future: true }],
        futureContent: { keep: true },
    },
};

const legacySaved = prepareProjectForSave({
    version: 5,
    blocks: [fixedBlock],
    sections: [fixedSection],
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
});
assert.equal(legacySaved.version, 5, 'Fixed-only projects must not be upgraded implicitly');
assert.deepEqual(legacySaved.blocks[0].futureRoot, { keep: true });
assert.deepEqual(legacySaved.blocks[0].content.layers, fixedBlock.content.layers);
assert.deepEqual(legacySaved.blocks[0].content.futureContent, { keep: true });
assert.equal(legacySaved.blocks[0].content.texts['en-us'], 'Fixed body');
const legacyHydrated = hydrateProjectFromPersistence(legacySaved);
assert.equal(legacyHydrated.version, 5);
assert.deepEqual(legacyHydrated.blocks[0].futureRoot, { keep: true });
assert.deepEqual(legacyHydrated.blocks[0].content.layers, fixedBlock.content.layers);
assert.deepEqual(legacyHydrated.blocks[0].content.futureContent, { keep: true });

const legacyBlocksOnly = prepareProjectForSave({
    version: 5,
    blocks: [fixedBlock, { ...fixedBlock, id: 'fixed_blocks_only_b' }],
});
assert.equal(legacyBlocksOnly.blocks.length, 2, 'blocks-only v5 must not lose Fixed pages');
const legacyEmptySections = prepareProjectForSave({
    version: 5,
    blocks: [fixedBlock, { ...fixedBlock, id: 'fixed_empty_sections_b' }],
    sections: [],
});
assert.equal(legacyEmptySections.blocks.length, 2, 'empty compatibility sections must not erase v5 blocks');

const legacySupplemented = hydrateProjectFromPersistence({
    version: 5,
    languages: ['ja', 'en'],
    blocks: [{
        ...fixedBlock,
        id: 'fixed_supplemented',
        content: { ...fixedBlock.content, backgrounds: {}, imagePositions: {}, headings: {} },
    }],
    sections: [{
        ...fixedSection,
        backgrounds: { en: 'en-background.webp' },
        imagePositions: { en: { x: 12, y: 8, scale: 1.2 } },
        headings: { ja: '補完見出し' },
    }],
    languageConfigs: {
        ja: { writingMode: 'vertical-rl' },
        en: { writingMode: 'horizontal-tb' },
    },
    textPaperPreset: 'book',
});
assert.equal(legacySupplemented.blocks[0].content.backgrounds.en, 'en-background.webp');
assert.equal(legacySupplemented.blocks[0].content.imagePositions.en.x, 12);
assert.equal(legacySupplemented.blocks[0].content.headings.ja, '補完見出し');
assert.equal(legacySupplemented.languageConfigs.ja.pageDirection, 'rtl');
assert.equal(legacySupplemented.languageConfigs.en.pageDirection, 'ltr');
assert.equal(legacySupplemented.blocks[0].content.paperPreset, 'book');
assert.equal(legacySupplemented.blocks[0].content.backgroundColor, '#f7f1df');

const flow = createFlowGroupBlock({
    id: 'flow_story',
    sourceLanguage: 'ja',
    idFactory,
    document: {
        id: 'flow_document_story',
        sections: [{
            id: 'flow_section_story',
            title: { ja: '第一章', 'en-us': 'Chapter One' },
            blocks: [{
                id: 'flow_paragraph_story',
                type: 'paragraph',
                texts: {
                    ja: 'blob: という語から始まる本文\n空白も保持する  ',
                    'en-us': '  Exact language key and whitespace  ',
                },
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

const mixedInput = {
    version: 6,
    projectId: 'project_mixed',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
    blocks: [fixedBlock, flow, { ...fixedBlock, id: 'fixed_b' }],
    sections: [fixedSection, { ...fixedSection, text: '後半', texts: { ja: '後半' } }],
    futureProject: { keep: true },
};
const mixedBefore = clone(mixedInput);
const mixedSaved = prepareProjectForSave(mixedInput);
assert.deepEqual(mixedInput, mixedBefore, 'save preparation must not mutate its input');
assert.deepEqual(mixedSaved.blocks.map((block) => block.kind), ['page', 'flow', 'page']);
assert.deepEqual(mixedSaved.blocks.map((block) => block.id), ['fixed_a', 'flow_story', 'fixed_b']);
assert.deepEqual(mixedSaved.futureProject, { keep: true });
assert.equal(
    mixedSaved.blocks[1].flow.document.sections[0].blocks[0].texts.ja,
    'blob: という語から始まる本文\n空白も保持する  ',
);
assert.equal(mixedSaved.blocks[0].content.layers[0].id, 'layer_a');
const mixedWithBoundaries = prepareProjectForSave({
    ...mixedInput,
    blocks: [
        { id: 'boundary_front', kind: 'cover_front', future: { keep: 'front' } },
        flow,
        { id: 'boundary_back', kind: 'cover_back', future: { keep: 'back' } },
    ],
    sections: [],
});
assert.deepEqual(mixedWithBoundaries.blocks.map((block) => block.kind), ['cover_front', 'flow', 'cover_back']);
assert.equal(mixedWithBoundaries.blocks[0].future.keep, 'front');
assert.equal(mixedWithBoundaries.blocks[2].future.keep, 'back');
const publicProjection = createPublicProjectProjection(mixedSaved);
assert.deepEqual(publicProjection.blocks.map((block) => block.kind), ['page', 'page']);
assert.equal(publicProjection.authoringRef, 'authoring/current');
assert.equal(publicProjection.authoringSchemaVersion, 6);
assert.equal(JSON.stringify(publicProjection).includes('blob: という語から始まる本文'), false);
assert.equal(Object.hasOwn(publicProjection, 'futureProject'), false, 'unknown authoring fields must stay private');

const serialized = serializeProject(mixedSaved);
const roundTripped = deserializeProject(serialized);
assert.deepEqual(roundTripped, hydrateProjectFromPersistence(mixedSaved));
assert.deepEqual(roundTripped.blocks.map((block) => block.kind), ['page', 'flow', 'page']);

const staleCompatibility = clone(mixedSaved);
staleCompatibility.sections[0].texts.ja = 'STALE';
const canonicalBody = staleCompatibility.blocks[0].content.texts.ja;
const staleHydrated = hydrateProjectFromPersistence(staleCompatibility);
assert.equal(staleHydrated.sections[0].texts.ja, canonicalBody, 'v6 sections must be derived from canonical blocks');

const flowOnly = prepareProjectForSave({
    version: 6,
    blocks: [flow],
    sections: [],
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
});
assert.deepEqual(flowOnly.sections, []);
assert.deepEqual(flowOnly.pages, []);
assert.deepEqual(syncBlocksWithSections(flowOnly.blocks, []), flowOnly.blocks);

assert.throws(
    () => prepareProjectForSave({ ...mixedInput, sections: [fixedSection] }),
    (error) => error?.code === 'MIXED_SPINE_FIXED_PAGE_COUNT_MISMATCH',
);
assert.throws(
    () => prepareProjectForSave({ ...mixedInput, version: 5 }),
    (error) => error?.code === 'FLOW_REQUIRES_PROJECT_V6',
);
assert.throws(
    () => hydrateProjectFromPersistence({ ...mixedInput, version: 7 }),
    (error) => error?.code === 'UNSUPPORTED_PROJECT_VERSION',
);
const invalidNullSpine = clone(mixedInput);
invalidNullSpine.blocks.push(null);
assert.throws(
    () => prepareProjectForSave(invalidNullSpine),
    (error) => error?.code === 'FLOW_PROJECT_INVALID',
);
const invalidMissingPageId = clone(mixedInput);
delete invalidMissingPageId.blocks[0].id;
assert.throws(
    () => prepareProjectForSave(invalidMissingPageId),
    (error) => error?.code === 'FLOW_PROJECT_INVALID',
);
const withRuntimePages = clone(mixedInput);
withRuntimePages.blocks[1].flow.document.generatedPages = [];
assert.throws(() => prepareProjectForSave(withRuntimePages), (error) => error?.code === 'FLOW_PROJECT_INVALID');
for (const runtimeKey of ['generatedPages', 'flowGeneratedPages', 'fragments', 'pagination', 'paginationCache']) {
    assert.throws(
        () => prepareProjectForSave({ ...mixedInput, [runtimeKey]: [] }),
        (error) => error?.code === 'PERSISTED_PROJECT_RUNTIME_DATA' && error?.path === runtimeKey,
    );
}
const sparseProject = clone(mixedInput);
delete sparseProject.blocks[1].flow.document.sections[0];
assert.throws(
    () => prepareProjectForSave(sparseProject),
    (error) => error?.code === 'PROJECT_NOT_JSON_SAFE' && /sections\[0\]/.test(error?.path || ''),
);
assert.throws(
    () => prepareProjectForSave({ ...mixedInput, futureProject: undefined }),
    (error) => error?.code === 'PROJECT_NOT_JSON_SAFE',
);

assert.equal(measureUtf8JsonBytes('日本😀'), Buffer.byteLength('日本😀', 'utf8'));
assert.equal(assertFirestoreAuthoringSize({ text: '短文' }), measureUtf8JsonBytes({ text: '短文' }));
assert.throws(
    () => assertFirestoreAuthoringSize({ text: 'あ'.repeat(FIRESTORE_AUTHORING_MAX_BYTES) }),
    (error) => error?.code === 'FIRESTORE_AUTHORING_TOO_LARGE',
);
assert.equal(isProjectVersionTransitionAllowed(5, 6), true);
assert.equal(isProjectVersionTransitionAllowed(6, 6), true);
assert.equal(isProjectVersionTransitionAllowed(6, 5), false);
assert.equal(isProjectVersionTransitionAllowed(7, 6), false);
assert.equal(isProjectVersionTransitionAllowed(undefined, 5), true);
assert.equal(isProjectVersionTransitionAllowed(6, undefined), false);
assert.equal(assertSupportedDspEnvelope({ format: 'dsp', schemaVersion: 1 }, 5), 1);
assert.equal(assertSupportedDspEnvelope({ format: 'dsp', schemaVersion: 2, projectVersion: 6 }, 6), 2);
assert.throws(
    () => assertSupportedDspEnvelope({ format: 'dsp', schemaVersion: 2, projectVersion: 5 }, 6),
    (error) => error?.code === 'DSP_PROJECT_VERSION_MISMATCH',
);
assert.throws(
    () => assertSupportedDspEnvelope({ format: 'dsp', schemaVersion: 1 }, 6),
    (error) => error?.code === 'DSP_V2_REQUIRED',
);
assert.throws(
    () => assertSupportedDspEnvelope({ format: 'dsp', schemaVersion: 3 }, 6),
    (error) => error?.code === 'UNSUPPORTED_DSP_SCHEMA_VERSION',
);

const dspV1Fallback = applyDspMetadataFallbacks(
    { version: 5, blocks: [fixedBlock], sections: [fixedSection] },
    { languages: ['ja', 'en-us'], defaultLang: 'en-us' },
);
assert.deepEqual(dspV1Fallback.languages, ['ja', 'en-us']);
assert.equal(dspV1Fallback.defaultLang, 'en-us');
class FakeTimestamp {
    toDate() { return new Date('2026-08-19T00:00:00.000Z'); }
}
const firestoreIngress = prepareFirestoreProjectIngress({
    version: 5,
    blocks: [fixedBlock],
    sections: [fixedSection],
    lastUpdated: new FakeTimestamp(),
    dsfPublishedAt: new FakeTimestamp(),
    publication: { publicFrom: new FakeTimestamp() },
    moderationAuditAt: new FakeTimestamp(),
});
assert.equal(Object.hasOwn(firestoreIngress, 'lastUpdated'), false);
assert.equal(Object.hasOwn(firestoreIngress, 'publication'), false);
assert.equal(firestoreIngress.moderationAuditAt, '2026-08-19T00:00:00.000Z');
assert.equal(hydrateProjectFromPersistence(firestoreIngress).version, 5);

const firestoreRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
assert.match(firestoreRules, /function projectVersionDoesNotRegress\(\)/);
assert.match(firestoreRules, /function projectV6AuthoringExistsAfter\(uid, pid\)/);
assert.match(firestoreRules, /getAfter\([^\n]+authoring\/current/);
assert.match(firestoreRules, /authoring\/current/);
assert.match(firestoreRules, /match \/authoring\/\{authoringId\}/);
assert.match(firestoreRules, /!existsAfter\([^\n]+authoring\/current\)/);
assert.match(firestoreRules, /!existsAfter\([^\n]+projects\/\$\(pid\)\)/);
assert.match(firestoreRules, /!request\.resource\.data\.keys\(\)\.hasAny\(\['authoringRef', 'authoringSchemaVersion'\]\)/);

const exportSource = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const sectionsSource = readFileSync(new URL('../js/sections.js', import.meta.url), 'utf8');
const firebaseSource = readFileSync(new URL('../js/firebase.js', import.meta.url), 'utf8');
assert.match(exportSource, /FLOW_PUBLICATION_NOT_CONNECTED/);
assert.match(pressSource, /hasFlowGroups\(state\)/);
assert.match(sectionsSource, /data-testid="flow-source-card"/);
assert.match(sectionsSource, /changeFlowGeneratedPage/);
assert.match(firebaseSource, /rootData\.version === 6/);
assert.match(firebaseSource, /prepareFirestoreProjectIngress\(persistedData\)/);

const stateBeforeHistoryTest = clone(state);
try {
    clearHistory();
    Object.assign(state, clone(flowOnly), {
        activeIdx: 0,
        activePageIdx: 0,
        activeBlockIdx: 0,
        activeBubbleIdx: null,
    });
    pushState();
    state.blocks[0].flow.document.sections[0].blocks[0].texts.ja = '変更後';
    state.blocks[0].flow.layout.typographyByLanguage.ja.writingMode = 'horizontal-tb';
    assert.equal(undo(() => {}), true);
    assert.equal(
        state.blocks[0].flow.document.sections[0].blocks[0].texts.ja,
        'blob: という語から始まる本文\n空白も保持する  ',
    );
    assert.equal(state.blocks[0].flow.layout.typographyByLanguage.ja.writingMode, 'vertical-rl');
    assert.equal(redo(() => {}), true);
    assert.equal(state.blocks[0].flow.document.sections[0].blocks[0].texts.ja, '変更後');
    assert.equal(state.blocks[0].flow.layout.typographyByLanguage.ja.writingMode, 'horizontal-tb');
} finally {
    clearHistory();
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, stateBeforeHistoryTest);
}

console.log('Project persistence verification passed.');
