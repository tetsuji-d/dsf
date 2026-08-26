import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DSF_FONT_CERTIFICATION_CANDIDATES } from '../js/dsf-font-certification-candidates.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import { createDsfPortableReleasePlan } from '../js/dsf-portable-release.js';
import { createDsfReleaseFileInventory } from '../js/dsf-release-file-inventory.js';
import { createDsfReleaseZipPackage } from '../js/dsf-release-zip-package.js';

const assetDirectory = process.argv[2];
if (!assetDirectory) {
    throw new Error('Usage: npm run check:dsf-portable-font-candidates -- <download-directory>');
}

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const candidateEntries = Object.entries(DSF_FONT_CERTIFICATION_CANDIDATES.candidates);
const fontAssets = {};
const registryFonts = {};
for (const [fontId, candidate] of candidateEntries) {
    const bytes = new Uint8Array(readFileSync(join(assetDirectory, candidate.asset.fileName)));
    assert.equal(bytes.byteLength, candidate.asset.byteLength, `${fontId}: byteLength`);
    assert.equal(hashBytes(bytes), candidate.asset.sha256, `${fontId}: SHA-256`);
    fontAssets[fontId] = bytes;
    registryFonts[fontId] = {
        declaration: {
            family: candidate.declaration.family,
            version: candidate.declaration.version,
            source: 'registry',
            href: `https://media-staging.dsf.ink/fonts/${candidate.asset.fileName}`,
            sha256: candidate.asset.sha256,
        },
        asset: {
            format: candidate.asset.format,
            mimeType: candidate.asset.mimeType,
            byteLength: candidate.asset.byteLength,
            immutable: true,
        },
        license: {
            spdxId: candidate.license.spdxId,
            licenseHref: candidate.license.licenseHref,
            rightsHolder: candidate.license.rightsHolder,
            reviewedAt: '2026-08-23',
            reviewedBy: 'Automated staging verification fixture only',
            allowsWebDistribution: candidate.license.allowsWebDistribution,
            allowsPortableEmbedding: candidate.license.allowsPortableEmbedding,
        },
        capabilities: {
            languages: [...candidate.capabilities.languages],
            writingModes: [...candidate.capabilities.writingModes],
            fontWeights: [...candidate.capabilities.fontWeights],
            fontStyles: [...candidate.capabilities.fontStyles],
        },
    };
}
const fontRegistry = {
    schemaVersion: 1,
    registryKind: 'production',
    fonts: registryFonts,
};

function createTextBlock(fontId, text, textColor) {
    return {
        id: `fixed_${fontId}`,
        kind: 'page',
        content: {
            pageKind: 'text',
            texts: { ja: text },
            textAlign: 'start',
            backgroundColor: '#fffdf8',
            textColor,
            bubbles: [],
            interactions: [],
        },
    };
}

function createSnapshot(fontId, text) {
    const entry = registryFonts[fontId];
    return {
        composition: {
            version: 2,
            writingMode: 'vertical-rl',
            frame: { x: 20, y: 20, w: 320, h: 600 },
            font: {
                family: `'${entry.declaration.family}',serif`,
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
            fontId,
            fontSha256: entry.declaration.sha256,
        },
    };
}

const blocks = [
    createTextBlock('noto-sans-jp-2.004-h2', '冬の金沢は静かだった。', '#1f1b16'),
    createTextBlock('noto-serif-jp-2.003-h1', '彼はコートを手に取った。', '#302820'),
];
const snapshots = Object.fromEntries(blocks.map((block) => {
    const fontId = block.id.slice('fixed_'.length);
    return [block.id, createSnapshot(fontId, block.content.texts.ja)];
}));
const preflight = createDsfPressPreflight({
    blocks,
    language: 'ja',
    compositionSnapshots: snapshots,
    fontRegistry,
});
assert.equal(preflight.publishable, true);
assert.equal(preflight.decisions.every((decision) => decision.renderKind === 'fixedText'), true);

const horizonAssembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes,
    languages: [{
        language: 'ja',
        pageDirection: 'rtl',
        preflight,
        imageAssets: {},
    }],
});
const portable = await createDsfPortableReleasePlan({
    assembly: horizonAssembly,
    fontRegistry,
    fontAssets,
    hashBytes,
    cryptoRef: webcrypto,
});
assert.equal(portable.summary.embeddedFontCount, 2);
assert.equal(portable.summary.fontFileCount, 2);
assert.equal(portable.assembly.files.index.json.includes('media-staging.dsf.ink'), false);

const inventory = await createDsfReleaseFileInventory({
    assembly: portable.assembly,
    sealedAssets: [],
    portableFontAssets: portable.fontAssets,
    metadata: {
        workId: 'staging-font-portable-check',
        releaseId: 'staging-font-portable-check-20260823',
        title: 'DSF staging font portable check',
        author: 'DSF automated verification',
        localizedMeta: { ja: { title: 'DSF staging font portable check' } },
        created: '2026-08-23T00:00:00.000Z',
        modified: '2026-08-23T00:00:00.000Z',
    },
    hashBytes,
});
const zip = await createDsfReleaseZipPackage({ inventory, hashBytes });
const fontEntries = zip.roundTrip.entries.filter((entry) => entry.path.startsWith('fonts/'));
assert.equal(fontEntries.length, 2);
for (const [, candidate] of candidateEntries) {
    const expectedPath = `fonts/${candidate.asset.sha256}.woff2`;
    const entry = fontEntries.find((fontEntry) => fontEntry.path === expectedPath);
    assert.ok(entry, expectedPath);
    assert.equal(entry.byteLength, candidate.asset.byteLength, `${expectedPath}: byteLength`);
    assert.equal(entry.sha256, candidate.asset.sha256, `${expectedPath}: SHA-256`);
}

console.log(JSON.stringify({
    status: 'verified',
    artifact: 'portable-dsf-local-round-trip',
    embeddedFontCount: portable.summary.embeddedFontCount,
    fontFileCount: portable.summary.fontFileCount,
    fontByteLength: portable.summary.fontByteLength,
    zipByteLength: zip.byteLength,
    zipSha256: zip.sha256,
    fonts: fontEntries,
}, null, 2));
