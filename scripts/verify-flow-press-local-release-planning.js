import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION } from '../js/dsf-delivery-v2.js';
import { DSF_PRODUCTION_FONT_REGISTRY } from '../js/dsf-font-registry.js';
import {
    DsfPortableReleaseEstimateError,
    estimateDsfPortableReleaseSize,
} from '../js/dsf-portable-release-estimate.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import {
    FlowPressLocalReleasePlanningError,
    createFlowPressLocalReleasePlanning,
} from '../js/flow-press-local-release-planning.js';

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const SANS_ID = 'noto-sans-jp-2.004-h2';
const SERIF_ID = 'noto-serif-jp-2.003-h1';

function createFlowBlock(id) {
    return {
        id,
        kind: 'flow',
        flow: { document: { id: `${id}-document`, sourceLanguage: 'ja', sections: [] }, layout: {} },
    };
}

function createFlowProjection(block, fontId, pageCount, revision = 41) {
    const declaration = clone(DSF_PRODUCTION_FONT_REGISTRY.fonts[fontId].declaration);
    const pages = Array.from({ length: pageCount }, (_, index) => {
        const text = `${declaration.family} ${index + 1}`;
        return {
            id: `${block.id}-ja-${String(index + 1).padStart(4, '0')}`,
            renderKind: 'fixedText',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: block.id,
                sectionId: `${block.id}-section`,
                firstBlockId: `${block.id}-paragraph`,
                blockProgress: index / pageCount,
            },
            pageLabel: String(index + 1),
            background: { color: '#fffdf8' },
            lines: [{
                x: 20,
                y: 20,
                width: 200,
                height: 30,
                writingMode: 'horizontal-tb',
                textOrientation: 'mixed',
                styleRef: 'body',
                runs: [{
                    text,
                    source: {
                        blockId: `${block.id}-paragraph`,
                        startGrapheme: index * 20,
                        endGrapheme: (index * 20) + [...text].length,
                    },
                }],
            }],
        };
    });
    return {
        ok: true,
        projectionVersion: 1,
        renderKind: 'fixedText',
        flowGroupId: block.id,
        documentId: block.flow.document.id,
        language: 'ja',
        revision,
        writingMode: 'horizontal-tb',
        font: { id: fontId, declaration },
        manifest: {
            schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
            language: 'ja',
            styles: {
                body: {
                    fontRef: fontId,
                    fontSize: 16,
                    fontWeight: 400,
                    fontStyle: 'normal',
                    lineHeight: 1.8,
                    letterSpacing: 0,
                    color: '#1f1b16',
                    textDecoration: 'none',
                    textAlign: 'start',
                },
            },
            pages,
        },
        summary: { pageCount, lineCount: pageCount, runCount: pageCount },
    };
}

const graphic = { id: 'graphic-cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const sansFlow = createFlowBlock('flow-sans');
const serifFlow = createFlowBlock('flow-serif');
const blocks = [graphic, sansFlow, serifFlow];
const revision = 41;
const preflight = createDsfPressPreflight({
    blocks,
    language: 'ja',
    flowPublicationProjections: {
        [sansFlow.id]: createFlowProjection(sansFlow, SANS_ID, 2, revision),
        [serifFlow.id]: createFlowProjection(serifFlow, SERIF_ID, 3, revision),
    },
    flowPublicationRevisions: {
        [sansFlow.id]: revision,
        [serifFlow.id]: revision,
    },
    fontRegistry: DSF_PRODUCTION_FONT_REGISTRY,
});
assert.equal(preflight.publishable, true);

const preparation = {
    preparationKind: 'production',
    publicationPreparationVersion: 1,
    ok: true,
    languages: [{ language: 'ja', state: 'ready', preparationIssues: [], preflight }],
};
const imageAssets = {
    ja: {
        [graphic.id]: {
            pageId: 'graphic-cover-ja',
            pageLabel: '1',
            sha256: 'b'.repeat(64),
            byteLength: 42000,
            width: 1080,
            height: 1920,
            mimeType: 'image/webp',
        },
    },
};

const planning = await createFlowPressLocalReleasePlanning({
    preparation,
    defaultLang: 'ja',
    languages: ['ja'],
    pageDirections: { ja: 'rtl' },
    imageAssets,
    fontRegistry: DSF_PRODUCTION_FONT_REGISTRY,
    hashBytes,
});
assert.equal(Object.isFrozen(planning), true);
assert.equal(planning.ready, true);
assert.equal(planning.planningKind, 'local-only');
assert.equal(planning.summary.languageCount, 1);
assert.equal(planning.summary.pageCount, 6);
assert.equal(planning.summary.fixedTextPageCount, 5);
assert.equal(planning.summary.imagePageCount, 1);
assert.equal(planning.summary.externalFontCount, 2);
assert.equal(planning.summary.portableFontFileCount, 2);
assert.equal(planning.summary.portableFontBytes, 4_350_080 + 5_965_452);
assert.equal(planning.summary.horizonPayloadBytes, planning.assembly.releaseMetadata.dsfTotalBytes);
assert.equal(planning.summary.portablePayloadBytes, planning.portableEstimate.summary.totalBytes);
assert.equal(
    planning.summary.portableAdditionalBytes,
    planning.portableEstimate.summary.fontByteLength + planning.portableEstimate.summary.indexByteDelta,
);
assert.equal(planning.portableEstimate.contentIndex.json.includes('https://media.dsf.ink/fonts/'), false);
assert.deepEqual(planning.portableEstimate.fontFiles.map((file) => file.fontIds[0]), [SANS_ID, SERIF_ID]);

const textOnlyPreflight = createDsfPressPreflight({
    blocks: [sansFlow],
    language: 'ja',
    flowPublicationProjections: {
        [sansFlow.id]: createFlowProjection(sansFlow, SANS_ID, 2, revision),
    },
    flowPublicationRevisions: { [sansFlow.id]: revision },
    fontRegistry: DSF_PRODUCTION_FONT_REGISTRY,
});
const textOnlyPlanning = await createFlowPressLocalReleasePlanning({
    preparation: {
        preparationKind: 'production',
        publicationPreparationVersion: 1,
        ok: true,
        languages: [{ language: 'ja', state: 'ready', preparationIssues: [], preflight: textOnlyPreflight }],
    },
    defaultLang: 'ja',
    languages: ['ja'],
    pageDirections: { ja: 'rtl' },
    imageAssets: { ja: {} },
    fontRegistry: DSF_PRODUCTION_FONT_REGISTRY,
    hashBytes,
});
assert.equal(textOnlyPlanning.ready, true, 'Flow fixedText-only releases must not require an image asset');
assert.equal(textOnlyPlanning.summary.pageCount, 2);
assert.equal(textOnlyPlanning.summary.fixedTextPageCount, 2);
assert.equal(textOnlyPlanning.summary.imagePageCount, 0);
assert.equal(textOnlyPlanning.assembly.files.assets.length, 0);

const inconsistentAssembly = clone(planning.assembly);
inconsistentAssembly.releaseMetadata.dsfTotalBytes += 1;
assert.throws(
    () => estimateDsfPortableReleaseSize({
        assembly: inconsistentAssembly,
        fontRegistry: DSF_PRODUCTION_FONT_REGISTRY,
    }),
    (error) => error instanceof DsfPortableReleaseEstimateError
        && error.issues.some((issue) => issue.code === 'PORTABLE_ESTIMATE_ASSEMBLY_SIZE_MISMATCH'),
);

await assert.rejects(
    () => createFlowPressLocalReleasePlanning({
        preparation: { ...preparation, ok: false },
        defaultLang: 'ja',
        pageDirections: { ja: 'rtl' },
        imageAssets,
        hashBytes,
    }),
    (error) => error instanceof FlowPressLocalReleasePlanningError
        && error.issues.some((issue) => issue.code === 'FLOW_LOCAL_RELEASE_PREPARATION_NOT_READY'),
);

const embeddingBlockedRegistry = clone(DSF_PRODUCTION_FONT_REGISTRY);
embeddingBlockedRegistry.fonts[SANS_ID].license.allowsPortableEmbedding = false;
assert.throws(
    () => estimateDsfPortableReleaseSize({
        assembly: planning.assembly,
        fontRegistry: embeddingBlockedRegistry,
    }),
    (error) => error instanceof DsfPortableReleaseEstimateError
        && error.issues.some((issue) => issue.code === 'PORTABLE_ESTIMATE_FONT_EMBEDDING_FORBIDDEN'),
);

const localPlanningSource = readFileSync(new URL('../js/flow-press-local-release-planning.js', import.meta.url), 'utf8');
const portableEstimateSource = readFileSync(new URL('../js/dsf-portable-release-estimate.js', import.meta.url), 'utf8');
for (const source of [localPlanningSource, portableEstimateSource]) {
    for (const forbidden of ['./press', './firebase', './export', 'uploadPressPage', 'setDoc(', 'fetch(', 'document.', 'window.', 'localStorage']) {
        assert.equal(source.includes(forbidden), false, `local planning cannot depend on ${forbidden}`);
    }
}

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-local-release-planning\.js'\)/);
assert.match(pressSource, /press-flow-local-release-summary/);
assert.match(pressSource, /btn\.disabled = hasFlow/);
assert.match(pressSource, /if \(hasFlowGroups\(state\)\)[\s\S]*await uploadFlowHorizonReleaseFiles\(\)/);
assert.match(pressSource, /if \(hasFlow && isHorizonPublish\)[\s\S]*btn\.disabled = !flowHorizonReady \|\| working \|\| saved/,
    'Flow Horizon draft save must remain gated by verified handoff readiness');

console.log('Flow Press local release assembly and payload estimate verification passed.');
