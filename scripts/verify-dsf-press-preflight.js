import assert from 'node:assert/strict';

import { DsfFontRegistryValidationError } from '../js/dsf-font-registry.js';
import {
    DSF_PRESS_PREFLIGHT_SCHEMA_VERSION,
    DsfPressPreflightError,
    createDsfPressPreflight,
} from '../js/dsf-press-preflight.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function createSyntheticRegistry() {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-ja-sans-v1': {
                declaration: {
                    family: 'Synthetic JA Sans',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-sans-v1.woff2',
                    sha256: 'a'.repeat(64),
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
                    languages: ['ja'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

function createTextBlock(id = 'fixed_text_1', text = '冬の金沢は静かだった。') {
    return {
        id,
        kind: 'page',
        content: {
            pageKind: 'text',
            texts: { ja: text },
            textAlign: 'start',
            backgroundColor: '#fffdf8',
            textColor: '#1f1b16',
            bubbles: [],
            interactions: [],
        },
    };
}

function createSnapshot(text = '冬の金沢は静かだった。', overrides = {}) {
    return {
        composition: {
            version: 2,
            writingMode: 'horizontal-tb',
            frame: { x: 20, y: 20, w: 320, h: 600 },
            font: {
                family: "'Synthetic JA Sans',sans-serif",
                size: 16,
                lineHeight: 1.8,
                letterSpacing: 0,
            },
            rules: { maxLines: 20, charsPerLine: 32 },
            lines: [text],
            overflow: false,
            overflowText: '',
            ...overrides.composition,
        },
        evidence: {
            sourceText: text,
            layoutVersion: 2,
            fontId: 'synthetic-ja-sans-v1',
            fontSha256: 'a'.repeat(64),
            ...overrides.evidence,
        },
    };
}

const imageBlock = { id: 'graphic_1', kind: 'page', content: { pageKind: 'image', layers: [] } };
const textBlock = createTextBlock();
const baseBlocks = [
    { id: 'chapter_1', kind: 'chapter', meta: { title: { ja: '第一章' } } },
    imageBlock,
    textBlock,
];
const baseSnapshots = { [textBlock.id]: createSnapshot() };
const inputBefore = clone({ blocks: baseBlocks, compositionSnapshots: baseSnapshots });

const emptyRegistryResult = createDsfPressPreflight({
    blocks: baseBlocks,
    language: 'ja',
    compositionSnapshots: baseSnapshots,
});
assert.equal(emptyRegistryResult.schemaVersion, DSF_PRESS_PREFLIGHT_SCHEMA_VERSION);
assert.equal(emptyRegistryResult.publishable, true, 'certification failure must retain the safe WebP route');
assert.deepEqual(emptyRegistryResult.decisions.map((decision) => decision.decisionCode), [
    'GRAPHIC_PAGE_WEBP',
    'FONT_NOT_CERTIFIED',
]);
assert.deepEqual(emptyRegistryResult.summary, {
    fixedPageCount: 2,
    flowPageCount: 0,
    deliveryPageCount: 2,
    fixedTextPageCount: 0,
    imagePageCount: 2,
    fallbackPageCount: 1,
    blockedCount: 0,
    flowGroupCount: 0,
});
assert.deepEqual({ blocks: baseBlocks, compositionSnapshots: baseSnapshots }, inputBefore, 'preflight must not mutate inputs');
assert.equal(Object.isFrozen(emptyRegistryResult), true);
assert.equal(Object.isFrozen(emptyRegistryResult.decisions), true);
assert.equal(Object.isFrozen(emptyRegistryResult.decisions[1]), true);

const certified = createDsfPressPreflight({
    blocks: baseBlocks,
    language: 'ja',
    compositionSnapshots: new Map([[textBlock.id, createSnapshot()]]),
    fontRegistry: createSyntheticRegistry(),
    pageIds: { [textBlock.id]: 'release-fixed-text-ja-0002' },
    pageLabels: { [textBlock.id]: '2' },
});
assert.equal(certified.publishable, true);
assert.equal(certified.decisions[1].renderKind, 'fixedText');
assert.equal(certified.decisions[1].decisionCode, 'FIXED_TEXT_CERTIFIED');
assert.equal(certified.decisions[1].projection.manifest.pages[0].id, 'release-fixed-text-ja-0002');
assert.equal(certified.decisions[1].projection.manifest.pages[0].pageLabel, '2');
assert.deepEqual(certified.requiredFonts, ['synthetic-ja-sans-v1']);
assert.equal(certified.summary.fixedTextPageCount, 1);
assert.equal(certified.summary.fallbackPageCount, 0);

const missingSnapshot = createDsfPressPreflight({
    blocks: [textBlock],
    language: 'ja',
    compositionSnapshots: {},
    fontRegistry: createSyntheticRegistry(),
});
assert.equal(missingSnapshot.publishable, true);
assert.equal(missingSnapshot.decisions[0].decisionCode, 'FIXED_TEXT_COMPOSITION_MISSING');
assert.equal(missingSnapshot.decisions[0].renderKind, 'image');

const rubyText = '今日は{漢字|かんじ}。';
const rubyBlock = createTextBlock('ruby_text', rubyText);
const ruby = createDsfPressPreflight({
    blocks: [rubyBlock],
    language: 'ja',
    compositionSnapshots: { [rubyBlock.id]: createSnapshot(rubyText) },
    fontRegistry: createSyntheticRegistry(),
});
assert.equal(ruby.publishable, true);
assert.equal(ruby.decisions[0].decisionCode, 'RUBY_UNSUPPORTED');
assert.equal(ruby.decisions[0].renderKind, 'image');

const languageMismatch = createDsfPressPreflight({
    blocks: [textBlock],
    language: 'en',
    compositionSnapshots: { [textBlock.id]: createSnapshot() },
    fontRegistry: createSyntheticRegistry(),
});
assert.equal(languageMismatch.publishable, true);
assert.equal(languageMismatch.decisions[0].decisionCode, 'FONT_LANGUAGE_UNSUPPORTED');

const flow = createDsfPressPreflight({
    blocks: [
        imageBlock,
        { id: 'flow_story', kind: 'flow', flow: { document: {}, layout: {} } },
    ],
    language: 'ja',
    compositionSnapshots: {},
    fontRegistry: createSyntheticRegistry(),
});
assert.equal(flow.publishable, false, 'unconnected Flow publication must fail closed');
assert.equal(flow.issues[0].code, 'FLOW_PUBLICATION_PROJECTION_MISSING');
assert.equal(flow.summary.fixedPageCount, 1, 'Flow runtime page count must not be guessed');
assert.equal(flow.summary.flowPageCount, 0, 'missing Flow projection must not invent pages');
assert.equal(flow.summary.deliveryPageCount, 1);
assert.equal(flow.summary.flowGroupCount, 1);
assert.equal(flow.summary.blockedCount, 1);

assert.throws(
    () => createDsfPressPreflight({
        blocks: [imageBlock, { ...imageBlock }],
        language: 'ja',
        compositionSnapshots: {},
    }),
    (error) => error instanceof DsfPressPreflightError
        && error.issues.some((issue) => issue.code === 'AUTHORING_BLOCK_ID_DUPLICATE'),
);

const invalidRegistry = createSyntheticRegistry();
invalidRegistry.fonts['synthetic-ja-sans-v1'].declaration.sha256 = 'bad';
assert.throws(
    () => createDsfPressPreflight({
        blocks: [textBlock],
        language: 'ja',
        compositionSnapshots: baseSnapshots,
        fontRegistry: invalidRegistry,
    }),
    (error) => error instanceof DsfFontRegistryValidationError,
);

console.log('DSF Press preflight verification passed');
