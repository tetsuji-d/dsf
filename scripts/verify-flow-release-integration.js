import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    validateDsfDeliveryBundle,
} from '../js/dsf-delivery-v2.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import {
    DsfReleaseAssemblyError,
    assembleDsfV2Release,
} from '../js/dsf-release-assembly.js';

const FONT_ID = 'synthetic-global-sans-v1';
const FONT_HASH = 'a'.repeat(64);
const clone = (value) => structuredClone(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function createRegistry() {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            [FONT_ID]: {
                declaration: {
                    family: 'Synthetic Global Sans',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-global-sans-v1.woff2',
                    sha256: FONT_HASH,
                },
                asset: {
                    format: 'woff2',
                    mimeType: 'font/woff2',
                    byteLength: 123456,
                    immutable: true,
                },
                license: {
                    spdxId: 'OFL-1.1',
                    licenseHref: 'https://unit-test-fonts.dsf-format.org/licenses/ofl-1.1',
                    rightsHolder: 'Synthetic test fixture only',
                    reviewedAt: '2026-08-23',
                    reviewedBy: 'Automated test fixture',
                    allowsWebDistribution: true,
                    allowsPortableEmbedding: true,
                },
                capabilities: {
                    languages: ['ja', 'en'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

function createTextBlock(id, ja, en, textColor) {
    return {
        id,
        kind: 'page',
        content: {
            pageKind: 'text',
            texts: { ja, en },
            textAlign: 'start',
            backgroundColor: '#fffdf8',
            textColor,
            bubbles: [],
            interactions: [],
        },
    };
}

function createFixedSnapshot(text) {
    return {
        composition: {
            version: 2,
            writingMode: 'horizontal-tb',
            frame: { x: 20, y: 20, w: 320, h: 600 },
            font: {
                family: "'Synthetic Global Sans',sans-serif",
                size: 16,
                lineHeight: 1.8,
                letterSpacing: 0,
            },
            rules: { maxLines: 20, charsPerLine: 32 },
            lines: [text],
            overflow: false,
            overflowText: '',
        },
        evidence: {
            sourceText: text,
            layoutVersion: 2,
            fontId: FONT_ID,
            fontSha256: FONT_HASH,
        },
    };
}

function createFlowBlock(id = 'flow_story') {
    return {
        id,
        kind: 'flow',
        flow: {
            document: {
                id: `${id}_document`,
                sourceLanguage: 'ja',
                sections: [],
            },
            layout: {},
        },
    };
}

function createFlowProjection(flowBlock, language, pageCount, registry) {
    const style = {
        fontRef: FONT_ID,
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        lineHeight: 1.8,
        letterSpacing: 0,
        color: '#405060',
        textDecoration: 'none',
        textAlign: 'start',
    };
    const pages = Array.from({ length: pageCount }, (_, index) => {
        const text = `Flow ${language} ${index + 1}`;
        return {
            id: `${flowBlock.id}-${language}-${String(index + 1).padStart(4, '0')}`,
            renderKind: 'fixedText',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: flowBlock.id,
                sectionId: `${flowBlock.id}_section`,
                firstBlockId: `${flowBlock.id}_paragraph`,
                blockProgress: index / pageCount,
            },
            pageLabel: `F${index + 1}`,
            background: { color: '#fffdf8' },
            lines: [{
                x: 20,
                y: 20,
                width: 160,
                height: 30,
                writingMode: 'horizontal-tb',
                textOrientation: 'mixed',
                styleRef: 'body',
                runs: [{
                    text,
                    source: {
                        blockId: `${flowBlock.id}_paragraph`,
                        startGrapheme: index * 10,
                        endGrapheme: (index * 10) + [...text].length,
                    },
                }],
            }],
        };
    });
    return {
        ok: true,
        projectionVersion: 1,
        renderKind: 'fixedText',
        flowGroupId: flowBlock.id,
        documentId: flowBlock.flow.document.id,
        language,
        revision: 23,
        writingMode: 'horizontal-tb',
        font: {
            id: FONT_ID,
            declaration: clone(registry.fonts[FONT_ID].declaration),
        },
        manifest: {
            schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
            language,
            styles: { body: style },
            pages,
        },
        summary: {
            pageCount,
            lineCount: pageCount,
            runCount: pageCount,
        },
    };
}

const registry = createRegistry();
const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const fixedA = createTextBlock(
    'fixed_a',
    '固定ページA',
    'Fixed page A',
    '#1f1b16',
);
const flowBlock = createFlowBlock();
const fixedB = createTextBlock(
    'fixed_b',
    '固定ページB',
    'Fixed page B',
    '#304050',
);
const blocks = [graphicBlock, fixedA, flowBlock, fixedB];

function createPreflight(language, flowPageCount) {
    return createDsfPressPreflight({
        blocks,
        language,
        compositionSnapshots: {
            [fixedA.id]: createFixedSnapshot(fixedA.content.texts[language]),
            [fixedB.id]: createFixedSnapshot(fixedB.content.texts[language]),
        },
        flowPublicationProjections: {
            [flowBlock.id]: createFlowProjection(flowBlock, language, flowPageCount, registry),
        },
        flowPublicationRevisions: { [flowBlock.id]: 23 },
        fontRegistry: registry,
    });
}

const jaPreflight = createPreflight('ja', 2);
const enPreflight = createPreflight('en', 3);
assert.equal(jaPreflight.publishable, true);
assert.equal(enPreflight.publishable, true);
assert.deepEqual(jaPreflight.decisions.map((decision) => decision.sourceKind), [
    'fixed', 'fixed', 'flow', 'fixed',
]);
assert.deepEqual(jaPreflight.decisions.map((decision) => decision.deliveryPageIndex), [0, 1, 2, 4]);
assert.deepEqual(
    jaPreflight.decisions.filter((decision) => decision.sourceKind === 'fixed').map((decision) => decision.fixedPageIndex),
    [0, 1, 2],
);
assert.equal(Object.hasOwn(jaPreflight.decisions[2], 'fixedPageIndex'), false);
assert.equal(jaPreflight.decisions[2].decisionCode, 'FLOW_FIXED_TEXT_CERTIFIED');
assert.deepEqual(jaPreflight.summary, {
    fixedPageCount: 3,
    flowPageCount: 2,
    deliveryPageCount: 5,
    fixedTextPageCount: 4,
    imagePageCount: 1,
    fallbackPageCount: 0,
    blockedCount: 0,
    flowGroupCount: 1,
});
assert.equal(enPreflight.summary.flowPageCount, 3);
assert.equal(enPreflight.summary.deliveryPageCount, 6, 'each language may have a different Flow page count');
assert.deepEqual(jaPreflight.requiredFonts, [FONT_ID]);
assert.equal(Object.isFrozen(jaPreflight.decisions[2].projection.manifest.pages), true);

const missing = createDsfPressPreflight({
    blocks: [flowBlock],
    language: 'ja',
    compositionSnapshots: {},
    fontRegistry: registry,
});
assert.equal(missing.publishable, false);
assert.equal(missing.issues[0].code, 'FLOW_PUBLICATION_PROJECTION_MISSING');
assert.equal(missing.summary.flowPageCount, 0);

const mismatchedProjection = createFlowProjection(flowBlock, 'en', 2, registry);
const mismatched = createDsfPressPreflight({
    blocks: [flowBlock],
    language: 'ja',
    compositionSnapshots: {},
    flowPublicationProjections: { [flowBlock.id]: mismatchedProjection },
    flowPublicationRevisions: { [flowBlock.id]: 23 },
    fontRegistry: registry,
});
assert.equal(mismatched.publishable, false);
assert.equal(mismatched.issues[0].code, 'FLOW_PUBLICATION_PROJECTION_CONTEXT_MISMATCH');

const uncertifiedProjection = createFlowProjection(flowBlock, 'ja', 2, registry);
uncertifiedProjection.font.id = 'unknown-font';
uncertifiedProjection.manifest.styles.body.fontRef = 'unknown-font';
const uncertified = createDsfPressPreflight({
    blocks: [flowBlock],
    language: 'ja',
    compositionSnapshots: {},
    flowPublicationProjections: { [flowBlock.id]: uncertifiedProjection },
    flowPublicationRevisions: { [flowBlock.id]: 23 },
    fontRegistry: registry,
});
assert.equal(uncertified.publishable, false);
assert.equal(uncertified.issues[0].code, 'FLOW_PUBLICATION_FONT_NOT_CERTIFIED');

const unusedProjection = createDsfPressPreflight({
    blocks: [graphicBlock],
    language: 'ja',
    compositionSnapshots: {},
    flowPublicationProjections: { [flowBlock.id]: createFlowProjection(flowBlock, 'ja', 2, registry) },
    flowPublicationRevisions: { [flowBlock.id]: 23 },
    fontRegistry: registry,
});
assert.equal(unusedProjection.publishable, false);
assert.equal(unusedProjection.issues[0].code, 'FLOW_PUBLICATION_PROJECTION_UNUSED');

const staleProjection = createDsfPressPreflight({
    blocks: [flowBlock],
    language: 'ja',
    compositionSnapshots: {},
    flowPublicationProjections: { [flowBlock.id]: createFlowProjection(flowBlock, 'ja', 2, registry) },
    flowPublicationRevisions: { [flowBlock.id]: 24 },
    fontRegistry: registry,
});
assert.equal(staleProjection.publishable, false);
assert.equal(staleProjection.issues[0].code, 'FLOW_PUBLICATION_PROJECTION_CONTEXT_MISMATCH');

function imageAssets(language) {
    return {
        [graphicBlock.id]: {
            pageId: `cover-${language}`,
            pageLabel: '1',
            sha256: language === 'ja' ? 'b'.repeat(64) : 'c'.repeat(64),
            byteLength: language === 'ja' ? 42000 : 43000,
            width: 1080,
            height: 1920,
            mimeType: 'image/webp',
        },
    };
}

const assemblyInput = {
    defaultLang: 'ja',
    hashBytes: sha256,
    languages: [
        { language: 'ja', pageDirection: 'rtl', preflight: jaPreflight, imageAssets: imageAssets('ja') },
        { language: 'en', pageDirection: 'ltr', preflight: enPreflight, imageAssets: imageAssets('en') },
    ],
};
const before = clone({ defaultLang: assemblyInput.defaultLang, languages: assemblyInput.languages });
const assembly = await assembleDsfV2Release(assemblyInput);
assert.equal(validateDsfDeliveryBundle(assembly.bundle).valid, true);
assert.deepEqual({ defaultLang: assemblyInput.defaultLang, languages: assemblyInput.languages }, before);
assert.deepEqual(assembly.releaseMetadata.dsfPageCounts, { ja: 5, en: 6 });
assert.equal(assembly.summary.pageCount, 11);
assert.equal(assembly.summary.fixedTextPageCount, 9);
assert.equal(assembly.summary.imagePageCount, 2);
assert.equal(assembly.summary.externalFontCount, 1);
assert.deepEqual(
    assembly.bundle.manifests.ja.pages.map((page) => (
        page.sourceAnchor.kind === 'flow' ? page.sourceAnchor.flowGroupId : page.sourceAnchor.blockId
    )),
    [graphicBlock.id, fixedA.id, flowBlock.id, flowBlock.id, fixedB.id],
);
assert.deepEqual(
    assembly.bundle.manifests.en.pages.map((page) => (
        page.sourceAnchor.kind === 'flow' ? page.sourceAnchor.flowGroupId : page.sourceAnchor.blockId
    )),
    [graphicBlock.id, fixedA.id, flowBlock.id, flowBlock.id, flowBlock.id, fixedB.id],
);
assert.equal(assembly.files.assets[0].pageIndex, 0);
assert.equal(assembly.files.assets[1].pageIndex, 0);
assert.equal(assembly.files.assets[0].path, 'assets/images/language-0001/page-00001.webp');
assert.equal(assembly.bundle.manifests.ja.pages[4].sourceAnchor.blockId, fixedB.id);

async function expectAssemblyIssue(input, code, label) {
    await assert.rejects(
        () => assembleDsfV2Release(input),
        (error) => error instanceof DsfReleaseAssemblyError
            && error.issues.some((issue) => issue.code === code),
        label,
    );
}

const orderGap = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
orderGap.hashBytes = sha256;
orderGap.languages[0].preflight.decisions[2].deliveryPageIndex = 3;
await expectAssemblyIssue(orderGap, 'RELEASE_DECISION_ORDER_INVALID', 'Flow delivery order gap');

const wrongAnchor = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
wrongAnchor.hashBytes = sha256;
wrongAnchor.languages[0].preflight.decisions[2].projection.manifest.pages[1].sourceAnchor.flowGroupId = 'other-flow';
await expectAssemblyIssue(wrongAnchor, 'RELEASE_FLOW_TEXT_PROJECTION_INVALID', 'Flow anchor mismatch');

const flowAsImage = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
flowAsImage.hashBytes = sha256;
flowAsImage.languages[0].preflight.decisions[2].renderKind = 'image';
flowAsImage.languages[0].preflight.decisions[2].decisionCode = 'FLOW_WEBP_IMPLICIT';
await expectAssemblyIssue(flowAsImage, 'RELEASE_FLOW_IMAGE_UNSUPPORTED', 'implicit Flow WebP fallback');

const preflightSource = readFileSync(new URL('../js/dsf-press-preflight.js', import.meta.url), 'utf8');
const assemblySource = readFileSync(new URL('../js/dsf-release-assembly.js', import.meta.url), 'utf8');
const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(preflightSource, /flowPublicationProjections/);
assert.match(preflightSource, /FLOW_FIXED_TEXT_CERTIFIED/);
assert.match(assemblySource, /decision\.sourceKind === 'flow'/);
assert.equal(pressSource.includes('flowPublicationProjections'), false, '9A-5C must not connect Flow projections to Press runtime');
assert.equal(pressSource.includes('flowPublicationRevisions'), false, '9A-5C must not connect Flow revisions to Press runtime');
for (const source of [preflightSource, assemblySource]) {
    for (const forbidden of ['./press', './state', './firebase', './export', 'document.', 'window.', 'fetch(']) {
        assert.equal(source.includes(forbidden), false, `9A-5C pure integration cannot depend on ${forbidden}`);
    }
}

console.log('Flow preflight and release assembly integration verified.');
