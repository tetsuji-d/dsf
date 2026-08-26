import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    DsfPortableReleaseError,
    createDsfPortableReleasePlan,
} from '../js/dsf-portable-release.js';
import {
    DsfReleaseFileInventoryError,
    createDsfReleaseFileInventory,
} from '../js/dsf-release-file-inventory.js';
import { createDsfReleaseZipPackage } from '../js/dsf-release-zip-package.js';

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

function createStructuralWoff2(length = 64) {
    const bytes = new Uint8Array(length);
    bytes.set([0x77, 0x4f, 0x46, 0x32], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 0x00010000, false);
    view.setUint32(8, length, false);
    view.setUint16(12, 1, false);
    view.setUint16(14, 0, false);
    view.setUint32(16, 64, false);
    view.setUint32(20, Math.min(8, length - 48), false);
    view.setUint16(24, 1, false);
    view.setUint16(26, 0, false);
    for (let index = 48; index < length; index += 1) bytes[index] = index & 0xff;
    return bytes;
}

function createRegistry(bytes, sha256, allowsPortableEmbedding = true) {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-ja-variable-v1': {
                declaration: {
                    family: 'Synthetic JA Variable',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-variable-v1.woff2',
                    sha256,
                },
                asset: {
                    format: 'woff2',
                    mimeType: 'font/woff2',
                    byteLength: bytes.byteLength,
                    immutable: true,
                },
                license: {
                    spdxId: 'OFL-1.1',
                    licenseHref: 'https://unit-test-fonts.dsf-format.org/licenses/ofl-1.1',
                    rightsHolder: 'Synthetic test fixture only',
                    reviewedAt: '2026-08-23',
                    reviewedBy: 'Automated test fixture',
                    allowsWebDistribution: true,
                    allowsPortableEmbedding,
                },
                capabilities: {
                    languages: ['ja'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400, 700],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

const fontBytes = createStructuralWoff2();
const fontSha256 = hashBytes(fontBytes);
const registry = createRegistry(fontBytes, fontSha256);
const text = '冬の金沢は静かだった。';
const textBlock = {
    id: 'fixed_text_story',
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
const snapshot = {
    composition: {
        version: 2,
        writingMode: 'horizontal-tb',
        frame: { x: 20, y: 20, w: 320, h: 600 },
        font: {
            family: "'Synthetic JA Variable',sans-serif",
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
        fontId: 'synthetic-ja-variable-v1',
        fontSha256,
    },
};
const preflight = createDsfPressPreflight({
    blocks: [textBlock],
    language: 'ja',
    compositionSnapshots: { [textBlock.id]: snapshot },
    fontRegistry: registry,
});
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

assert.equal(horizonAssembly.bundle.index.fonts['synthetic-ja-variable-v1'].source, 'registry');
assert.equal(horizonAssembly.bundle.index.fonts['synthetic-ja-variable-v1'].href.startsWith('https://'), true);
const sourceBefore = structuredClone(horizonAssembly);
const portable = await createDsfPortableReleasePlan({
    assembly: horizonAssembly,
    fontRegistry: registry,
    fontAssets: { 'synthetic-ja-variable-v1': fontBytes },
    hashBytes,
    cryptoRef: webcrypto,
});

assert.deepEqual(horizonAssembly, sourceBefore, 'portable planning must not mutate the Horizon assembly');
assert.equal(Object.isFrozen(portable), true);
assert.equal(portable.summary.embeddedFontCount, 1);
assert.equal(portable.summary.fontFileCount, 1);
assert.equal(portable.summary.fontByteLength, fontBytes.byteLength);
const portableDeclaration = portable.assembly.bundle.index.fonts['synthetic-ja-variable-v1'];
assert.equal(portableDeclaration.source, 'embedded');
assert.equal(portableDeclaration.href, `fonts/${fontSha256}.woff2`);
assert.equal(portableDeclaration.sha256, fontSha256);
assert.equal(portable.assembly.summary.externalFontCount, 0);
assert.equal(portable.assembly.summary.embeddedFontCount, 1);
assert.equal(portable.assembly.releaseMetadata.dsfContentHash, portable.assembly.files.index.sha256);
assert.equal(portable.assembly.releaseMetadata.dsfTotalBytes,
    horizonAssembly.releaseMetadata.dsfTotalBytes
        - horizonAssembly.files.index.byteLength
        + portable.assembly.files.index.byteLength
        + fontBytes.byteLength);
assert.equal(portable.assembly.files.index.json.includes('https://unit-test-fonts'), false,
    'portable content.json cannot retain the CDN font URL');

const metadata = {
    workId: 'work_portable',
    releaseId: 'release_portable_1',
    title: '冬の金沢',
    author: 'DSF Author',
    localizedMeta: { ja: { title: '冬の金沢', author: '著作者' } },
    created: '2026-08-23T00:00:00.000Z',
    modified: '2026-08-23T01:00:00.000Z',
};
const inventory = await createDsfReleaseFileInventory({
    assembly: portable.assembly,
    sealedAssets: [],
    portableFontAssets: portable.fontAssets,
    metadata,
    hashBytes,
});
assert.equal(inventory.summary.fontFileCount, 1);
assert.deepEqual(inventory.files.map((file) => file.role), [
    'mimetype',
    'archive-manifest',
    'metadata',
    'content-index',
    'language-manifest',
    'font',
]);
const embeddedFontFile = inventory.files.find((file) => file.role === 'font');
assert.equal(embeddedFontFile.path, portableDeclaration.href);
assert.equal(embeddedFontFile.sha256, fontSha256);
assert.equal(embeddedFontFile.byteLength, fontBytes.byteLength);
assert.equal(inventory.archiveManifest.files.some((file) => file.path === embeddedFontFile.path), true);

const zip = await createDsfReleaseZipPackage({ inventory, hashBytes });
assert.equal(zip.roundTrip.entries.some((entry) => entry.path === portableDeclaration.href), true);
assert.equal(zip.roundTrip.entryCount, inventory.files.length);

await assert.rejects(
    () => createDsfReleaseFileInventory({
        assembly: horizonAssembly,
        sealedAssets: [],
        metadata,
        hashBytes,
    }),
    (error) => error instanceof DsfReleaseFileInventoryError
        && error.issues.some((issue) => issue.code === 'RELEASE_PORTABLE_FONT_SOURCE_REQUIRED'),
    'download inventory must reject CDN-only font declarations',
);
await assert.rejects(
    () => createDsfPortableReleasePlan({
        assembly: horizonAssembly,
        fontRegistry: registry,
        fontAssets: {},
        hashBytes,
        cryptoRef: webcrypto,
    }),
    (error) => error instanceof DsfPortableReleaseError
        && error.issues.some((issue) => issue.code === 'PORTABLE_RELEASE_FONT_ASSET_MISSING'),
    'every used font must have exact bytes',
);
await assert.rejects(
    () => createDsfPortableReleasePlan({
        assembly: horizonAssembly,
        fontRegistry: createRegistry(fontBytes, fontSha256, false),
        fontAssets: { 'synthetic-ja-variable-v1': fontBytes },
        hashBytes,
        cryptoRef: webcrypto,
    }),
    (error) => error instanceof DsfPortableReleaseError
        && error.issues.some((issue) => issue.code === 'PORTABLE_RELEASE_FONT_EMBEDDING_FORBIDDEN'),
    'portable embedding rights must be explicit',
);

const source = readFileSync(new URL('../js/dsf-portable-release.js', import.meta.url), 'utf8');
for (const forbidden of ['./press', './viewer', './firebase', './export', 'fetch(', 'document.', 'window.', 'localStorage']) {
    assert.equal(source.includes(forbidden), false, `portable release planning cannot depend on ${forbidden}`);
}

console.log('DSF portable release font embedding verification passed.');
