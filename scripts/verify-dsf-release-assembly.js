import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { validateDsfDeliveryBundle } from '../js/dsf-delivery-v2.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import {
    DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
    DsfReleaseAssemblyError,
    assembleDsfV2Release,
} from '../js/dsf-release-assembly.js';

const clone = (value) => structuredClone(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function createSyntheticRegistry() {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-global-sans-v1': {
                declaration: {
                    family: 'Synthetic Global Sans',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-global-sans-v1.woff2',
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
                    languages: ['ja', 'en'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

function createTextBlock(id, texts, textColor) {
    return {
        id,
        kind: 'page',
        content: {
            pageKind: 'text',
            texts,
            textAlign: 'start',
            backgroundColor: '#fffdf8',
            textColor,
            bubbles: [],
            interactions: [],
        },
    };
}

function createSnapshot(text, lines = [text]) {
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
            lines,
            overflow: false,
            overflowText: '',
        },
        evidence: {
            sourceText: text,
            layoutVersion: 2,
            fontId: 'synthetic-global-sans-v1',
            fontSha256: 'a'.repeat(64),
        },
    };
}

const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const textBlockA = createTextBlock(
    'fixed_text_a',
    { ja: '冬の金沢は静かだった。', en: 'Kanazawa was quiet in winter.' },
    '#1f1b16',
);
const textBlockB = createTextBlock(
    'fixed_text_b',
    { ja: '彼はコートを手に取った。', en: 'He reached for his coat.' },
    '#304050',
);
const blocks = [graphicBlock, textBlockA, textBlockB];
const registry = createSyntheticRegistry();

function createLanguagePreflight(language) {
    return createDsfPressPreflight({
        blocks,
        language,
        compositionSnapshots: {
            [textBlockA.id]: createSnapshot(textBlockA.content.texts[language]),
            [textBlockB.id]: createSnapshot(textBlockB.content.texts[language]),
        },
        fontRegistry: registry,
        pageLabels: {
            [textBlockA.id]: '2',
            [textBlockB.id]: '3',
        },
    });
}

function createImageAssets(language) {
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
        {
            language: 'ja',
            pageDirection: 'rtl',
            preflight: createLanguagePreflight('ja'),
            imageAssets: createImageAssets('ja'),
        },
        {
            language: 'en',
            pageDirection: 'ltr',
            preflight: createLanguagePreflight('en'),
            imageAssets: createImageAssets('en'),
        },
    ],
};
const assemblyInputBefore = clone({
    defaultLang: assemblyInput.defaultLang,
    languages: assemblyInput.languages,
});
const assembly = await assembleDsfV2Release(assemblyInput);

assert.equal(assembly.schemaVersion, DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION);
assert.equal(validateDsfDeliveryBundle(assembly.bundle).valid, true);
assert.deepEqual({ defaultLang: assemblyInput.defaultLang, languages: assemblyInput.languages }, assemblyInputBefore,
    'release assembly must not mutate preflight or asset inputs');
assert.equal(Object.isFrozen(assembly), true);
assert.equal(Object.isFrozen(assembly.bundle.index), true);
assert.equal(Object.isFrozen(assembly.bundle.manifests.ja.pages), true);

assert.deepEqual(assembly.releaseMetadata.dsfLangs, ['ja', 'en']);
assert.deepEqual(assembly.releaseMetadata.dsfPageCounts, { ja: 3, en: 3 });
assert.equal(hasOwn(assembly.releaseMetadata, 'dsfContentUrl'), false, 'pure assembly must not invent an R2 URL');
assert.equal(assembly.summary.languageCount, 2);
assert.equal(assembly.summary.pageCount, 6);
assert.equal(assembly.summary.fixedTextPageCount, 4);
assert.equal(assembly.summary.imagePageCount, 2);
assert.equal(assembly.summary.externalFontCount, 1, 'the same certified font must be deduplicated across languages');

assert.equal(assembly.bundle.index.languages.ja.href, 'content/language-0001.json');
assert.equal(assembly.bundle.index.languages.en.href, 'content/language-0002.json');
assert.equal(assembly.files.assets[0].path, 'assets/images/language-0001/page-00001.webp');
assert.equal(assembly.files.assets[1].path, 'assets/images/language-0002/page-00001.webp');
assert.equal(assembly.bundle.manifests.ja.pages[0].image.href, '../assets/images/language-0001/page-00001.webp');
assert.deepEqual(assembly.bundle.manifests.ja.pages.map((page) => page.sourceAnchor.blockId), [
    graphicBlock.id,
    textBlockA.id,
    textBlockB.id,
]);

assert.deepEqual(Object.keys(assembly.bundle.manifests.ja.styles), ['body', 'body_2'],
    'style IDs with different values must be rebased deterministically');
assert.equal(assembly.bundle.manifests.ja.pages[1].lines[0].styleRef, 'body');
assert.equal(assembly.bundle.manifests.ja.pages[2].lines[0].styleRef, 'body_2');

assert.deepEqual(JSON.parse(assembly.files.index.json), assembly.bundle.index);
assert.equal(assembly.files.index.sha256, sha256(new TextEncoder().encode(assembly.files.index.json)));
assert.equal(assembly.releaseMetadata.dsfContentHash, assembly.files.index.sha256);
for (const language of ['ja', 'en']) {
    const file = assembly.files.manifests[language];
    assert.deepEqual(JSON.parse(file.json), assembly.bundle.manifests[language]);
    assert.equal(file.sha256, sha256(new TextEncoder().encode(file.json)));
    assert.equal(assembly.bundle.index.languages[language].sha256, file.sha256);
}
const expectedTotalBytes = assembly.files.index.byteLength
    + Object.values(assembly.files.manifests).reduce((sum, file) => sum + file.byteLength, 0)
    + assembly.files.assets.reduce((sum, asset) => sum + asset.byteLength, 0);
assert.equal(assembly.summary.totalBytes, expectedTotalBytes);
assert.equal(assembly.releaseMetadata.dsfTotalBytes, expectedTotalBytes);

// The currently empty production registry safely assembles text as WebP when
// the caller provides the verified rendered asset descriptor.
const fallbackText = createTextBlock('fallback_text', { ja: 'WebPへ戻す本文' }, '#111111');
const fallbackPreflight = createDsfPressPreflight({
    blocks: [fallbackText],
    language: 'ja',
    compositionSnapshots: { [fallbackText.id]: createSnapshot(fallbackText.content.texts.ja) },
});
assert.equal(fallbackPreflight.decisions[0].decisionCode, 'FONT_NOT_CERTIFIED');
const fallbackAssembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes: sha256,
    languages: [{
        language: 'ja',
        pageDirection: 'rtl',
        preflight: fallbackPreflight,
        imageAssets: {
            [fallbackText.id]: {
                sha256: 'd'.repeat(64),
                byteLength: 32100,
                width: 1080,
                height: 1920,
                mimeType: 'image/webp',
            },
        },
    }],
});
assert.equal(fallbackAssembly.bundle.manifests.ja.pages[0].renderKind, 'image');
assert.equal(fallbackAssembly.files.assets[0].decisionCode, 'FONT_NOT_CERTIFIED');
assert.equal(fallbackAssembly.summary.externalFontCount, 0);

async function assertAssemblyIssue(input, expectedCode, label) {
    await assert.rejects(
        () => assembleDsfV2Release(input),
        (error) => error instanceof DsfReleaseAssemblyError
            && error.code === 'DSF_RELEASE_ASSEMBLY_INVALID'
            && error.issues.some((issue) => issue.code === expectedCode),
        label,
    );
}

const flowPreflight = createDsfPressPreflight({
    blocks: [{ id: 'flow_story', kind: 'flow', flow: { document: {}, layout: {} } }],
    language: 'ja',
    compositionSnapshots: {},
});
await assertAssemblyIssue({
    defaultLang: 'ja',
    hashBytes: sha256,
    languages: [{ language: 'ja', pageDirection: 'rtl', preflight: flowPreflight, imageAssets: {} }],
}, 'RELEASE_PREFLIGHT_BLOCKED', 'Flow must remain blocked');

const missingAssetInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
missingAssetInput.hashBytes = sha256;
missingAssetInput.languages[0].imageAssets = {};
await assertAssemblyIssue(missingAssetInput, 'RELEASE_IMAGE_ASSET_MISSING', 'missing image asset');

const unusedAssetInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
unusedAssetInput.hashBytes = sha256;
unusedAssetInput.languages[0].imageAssets.unused = createImageAssets('ja')[graphicBlock.id];
await assertAssemblyIssue(unusedAssetInput, 'RELEASE_IMAGE_ASSET_UNUSED', 'unused image asset');

const badHashAssetInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
badHashAssetInput.hashBytes = sha256;
badHashAssetInput.languages[0].imageAssets[graphicBlock.id].sha256 = 'not-a-hash';
await assertAssemblyIssue(badHashAssetInput, 'RELEASE_IMAGE_ASSET_HASH_INVALID', 'invalid image hash');

const injectedPathInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
injectedPathInput.hashBytes = sha256;
injectedPathInput.languages[0].imageAssets[graphicBlock.id].href = 'https://attacker.invalid/page.webp';
await assertAssemblyIssue(injectedPathInput, 'RELEASE_INPUT_PROPERTY_UNSUPPORTED', 'caller-provided asset path');

const duplicateLanguageInput = clone({ defaultLang: 'ja', languages: assemblyInput.languages });
duplicateLanguageInput.hashBytes = sha256;
duplicateLanguageInput.languages[1].language = 'ja';
await assertAssemblyIssue(duplicateLanguageInput, 'RELEASE_LANGUAGE_DUPLICATE', 'duplicate language');

await assertAssemblyIssue({ ...assemblyInput, defaultLang: 'fr' }, 'RELEASE_DEFAULT_LANGUAGE_MISSING', 'missing default language');
await assertAssemblyIssue({ ...assemblyInput, hashBytes: () => 'bad' }, 'RELEASE_HASH_INVALID', 'invalid hasher result');
await assertAssemblyIssue({ ...assemblyInput, hashBytes: () => { throw new Error('hash unavailable'); } }, 'RELEASE_HASH_FAILED', 'hasher failure');

const anchorMismatchInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
anchorMismatchInput.hashBytes = sha256;
anchorMismatchInput.languages[0].preflight.decisions[1].projection.manifest.pages[0].sourceAnchor.blockId = 'different';
await assertAssemblyIssue(anchorMismatchInput, 'RELEASE_FIXED_TEXT_ANCHOR_MISMATCH', 'source anchor mismatch');

const fontConflictInput = clone({ defaultLang: 'ja', languages: assemblyInput.languages });
fontConflictInput.hashBytes = sha256;
fontConflictInput.languages[1].preflight.decisions[1].projection.font.declaration.href = 'https://unit-test-fonts.dsf-format.org/assets/conflict.woff2';
await assertAssemblyIssue(fontConflictInput, 'RELEASE_FONT_CONFLICT', 'font declaration conflict');

const duplicatePageInput = clone({ defaultLang: 'ja', languages: [assemblyInput.languages[0]] });
duplicatePageInput.hashBytes = sha256;
duplicatePageInput.languages[0].imageAssets[graphicBlock.id].pageId = `fixed:${textBlockA.id}:ja`;
await assertAssemblyIssue(duplicatePageInput, 'RELEASE_BUNDLE_INVALID', 'duplicate delivery page ID');

const moduleSource = readFileSync(new URL('../js/dsf-release-assembly.js', import.meta.url), 'utf8');
for (const forbiddenDependency of [
    './press',
    './viewer',
    './state',
    './firebase',
    './export',
    'document.',
    'window.',
    'fetch(',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `pure release assembly cannot depend on ${forbiddenDependency}`);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

console.log('DSF release assembly verification passed');
