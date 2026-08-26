import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    createDsfWebCryptoSha256,
    sealDsfWebPAsset,
} from '../js/dsf-release-byte-sealing.js';
import {
    DSF_ARCHIVE_MANIFEST_FORMAT,
    DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    DSF_CONTENT_MIMETYPE,
    DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION,
    DsfReleaseFileInventoryError,
    createDsfReleaseFileInventory,
} from '../js/dsf-release-file-inventory.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const realVp8 = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const hashBytes = createDsfWebCryptoSha256({ cryptoRef: webcrypto });
const clone = (value) => structuredClone(value);

function hashBlob(blob) {
    return blob.arrayBuffer().then((buffer) => createHash('sha256').update(new Uint8Array(buffer)).digest('hex'));
}

const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image' } };
function createPreflight(language) {
    return createDsfPressPreflight({
        blocks: [graphicBlock],
        language,
        compositionSnapshots: {},
    });
}

const sealedJa = await sealDsfWebPAsset({
    bytes: realVp8,
    expectedWidth: 1,
    expectedHeight: 1,
    pageId: 'cover-ja',
    pageLabel: '1',
}, { cryptoRef: webcrypto });
const sealedEn = await sealDsfWebPAsset({
    bytes: realVp8,
    expectedWidth: 1,
    expectedHeight: 1,
    pageId: 'cover-en',
    pageLabel: '1',
}, { cryptoRef: webcrypto });

const assembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes,
    languages: [
        {
            language: 'ja',
            pageDirection: 'rtl',
            preflight: createPreflight('ja'),
            imageAssets: { [graphicBlock.id]: sealedJa.descriptor },
        },
        {
            language: 'en',
            pageDirection: 'ltr',
            preflight: createPreflight('en'),
            imageAssets: { [graphicBlock.id]: sealedEn.descriptor },
        },
    ],
});
const sealedAssets = [
    { language: 'ja', blockId: graphicBlock.id, pageIndex: 0, sealed: sealedJa },
    { language: 'en', blockId: graphicBlock.id, pageIndex: 0, sealed: sealedEn },
];
const metadata = {
    projectId: 'project_story',
    workId: 'work_story',
    releaseId: 'release_20260823_1',
    title: '冬の金沢',
    author: 'DSF Author',
    labelName: 'DSF Books',
    rating: 'all',
    license: 'all-rights-reserved',
    localizedMeta: {
        ja: {
            title: '冬の金沢',
            author: '著作者',
            description: '冬の物語',
            linerNotes: '制作ノート',
            copyright: '© 2026 著作者',
        },
        en: {
            title: 'Winter in Kanazawa',
            author: 'Author',
            description: 'A winter story',
        },
    },
    created: '2026-08-23T00:00:00.000Z',
    modified: '2026-08-23T01:00:00.000Z',
    generator: 'DSF Studio test',
    spread: 'auto',
};
const criticalInputBefore = clone({ assembly, metadata });
const inventory = await createDsfReleaseFileInventory({ assembly, sealedAssets, metadata, hashBytes });

assert.equal(inventory.schemaVersion, DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION);
assert.deepEqual({ assembly, metadata }, criticalInputBefore, 'file inventory must not mutate assembly or metadata');
assert.equal(Object.isFrozen(inventory), true);
assert.equal(Object.isFrozen(inventory.files), true);
assert.equal(Object.isFrozen(inventory.archiveManifest), true);

assert.deepEqual(inventory.files.map((file) => file.path), [
    'mimetype',
    'manifest.json',
    'meta.json',
    'content.json',
    'content/language-0001.json',
    'content/language-0002.json',
    'assets/images/language-0001/page-00001.webp',
    'assets/images/language-0002/page-00001.webp',
]);
assert.equal(await inventory.files[0].blob.text(), DSF_CONTENT_MIMETYPE);
assert.equal((await inventory.files[0].blob.text()).includes('\n'), false, 'mimetype must not contain a trailing newline');
assert.equal(inventory.files[0].mimeType, 'text/plain');
assert.equal(inventory.files[1].role, 'archive-manifest');

assert.equal(inventory.meta.schemaVersion, 2);
assert.equal(inventory.meta.format, 'dsf');
assert.equal(inventory.meta.workId, metadata.workId);
assert.equal(inventory.meta.releaseId, metadata.releaseId);
assert.deepEqual(inventory.meta.languages, ['ja', 'en']);
assert.equal(inventory.meta.defaultLang, 'ja');
assert.equal(inventory.meta.presentation.aspectRatio, '9:16');
assert.equal(inventory.meta.presentation.canonicalLogicalWidth, 360);
assert.equal(inventory.meta.presentation.canonicalLogicalHeight, 640);
assert.deepEqual(inventory.meta.linerNotes, { ja: '制作ノート' });
const metaFile = inventory.files.find((file) => file.path === 'meta.json');
assert.deepEqual(JSON.parse(await metaFile.blob.text()), inventory.meta);

assert.equal(inventory.archiveManifest.schemaVersion, DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION);
assert.equal(inventory.archiveManifest.format, DSF_ARCHIVE_MANIFEST_FORMAT);
assert.deepEqual(inventory.archiveManifest.self, {
    path: 'manifest.json',
    integrity: 'external-inventory',
});
assert.equal(inventory.archiveManifest.files.some((file) => file.path === 'manifest.json'), false,
    'archive manifest cannot recursively contain its own hash');
assert.deepEqual(inventory.archiveManifest.files.map((file) => file.path), inventory.files
    .filter((file) => file.path !== 'manifest.json')
    .map((file) => file.path));
assert.equal(inventory.archiveManifest.fileCount, inventory.summary.payloadFileCount);
assert.equal(inventory.archiveManifest.payloadByteLength, inventory.files
    .filter((file) => file.path !== 'manifest.json')
    .reduce((sum, file) => sum + file.byteLength, 0));

for (const file of inventory.files) {
    assert.equal(file.blob.size, file.byteLength, file.path);
    assert.equal(await hashBlob(file.blob), file.sha256, file.path);
}
assert.equal(inventory.integrity.archiveManifestSha256, inventory.files[1].sha256);
assert.equal(inventory.integrity.contentSha256, assembly.files.index.sha256);
assert.equal(inventory.releaseMetadata.dsfContentHash, assembly.releaseMetadata.dsfContentHash);
assert.equal(inventory.releaseMetadata.dsfTotalBytes, inventory.summary.totalBytes);
assert.equal(inventory.summary.fileCount, 8);
assert.equal(inventory.summary.payloadFileCount, 7);
assert.equal(inventory.summary.imageFileCount, 2);
assert.equal(inventory.summary.jsonFileCount, 5);
assert.equal(inventory.summary.totalBytes, inventory.files.reduce((sum, file) => sum + file.byteLength, 0));

async function expectInventoryIssue(input, expectedCode, label) {
    await assert.rejects(
        () => createDsfReleaseFileInventory(input),
        (error) => error instanceof DsfReleaseFileInventoryError
            && error.code === 'DSF_RELEASE_FILE_INVENTORY_INVALID'
            && error.issues.some((issue) => issue.code === expectedCode),
        label,
    );
}

await expectInventoryIssue(
    { assembly, sealedAssets: sealedAssets.slice(0, 1), metadata, hashBytes },
    'RELEASE_SEALED_ASSET_MISSING',
    'missing sealed asset',
);
await expectInventoryIssue(
    { assembly, sealedAssets: [...sealedAssets, sealedAssets[0]], metadata, hashBytes },
    'RELEASE_SEALED_ASSET_DUPLICATE',
    'duplicate sealed asset',
);
await expectInventoryIssue(
    {
        assembly,
        sealedAssets: [...sealedAssets, { language: 'fr', blockId: 'extra', pageIndex: 0, sealed: sealedJa }],
        metadata,
        hashBytes,
    },
    'RELEASE_SEALED_ASSET_UNEXPECTED',
    'unexpected sealed asset',
);

const descriptorMismatch = {
    ...sealedJa,
    descriptor: { ...sealedJa.descriptor, width: 2 },
};
await expectInventoryIssue(
    {
        assembly,
        sealedAssets: [{ ...sealedAssets[0], sealed: descriptorMismatch }, sealedAssets[1]],
        metadata,
        hashBytes,
    },
    'RELEASE_SEALED_ASSET_DESCRIPTOR_MISMATCH',
    'descriptor mismatch',
);

const changedBytes = new Uint8Array(realVp8);
changedBytes[changedBytes.length - 1] ^= 0x01;
const changedBlobSeal = { ...sealedJa, blob: new Blob([changedBytes], { type: 'image/webp' }) };
await expectInventoryIssue(
    {
        assembly,
        sealedAssets: [{ ...sealedAssets[0], sealed: changedBlobSeal }, sealedAssets[1]],
        metadata,
        hashBytes,
    },
    'RELEASE_SEALED_ASSET_HASH_MISMATCH',
    'actual Blob hash mismatch',
);

const staleJsonAssembly = clone(assembly);
staleJsonAssembly.bundle.index.defaultLang = 'en';
await expectInventoryIssue(
    { assembly: staleJsonAssembly, sealedAssets, metadata, hashBytes },
    'RELEASE_ASSEMBLY_JSON_MISMATCH',
    'stale canonical JSON',
);

const staleHashAssembly = clone(assembly);
staleHashAssembly.files.index.sha256 = '0'.repeat(64);
staleHashAssembly.releaseMetadata.dsfContentHash = '0'.repeat(64);
await expectInventoryIssue(
    { assembly: staleHashAssembly, sealedAssets, metadata, hashBytes },
    'RELEASE_ASSEMBLY_JSON_HASH_MISMATCH',
    'stale content hash',
);

const pathInjectionAssembly = clone(assembly);
pathInjectionAssembly.files.assets[0].path = '../outside.webp';
await expectInventoryIssue(
    { assembly: pathInjectionAssembly, sealedAssets, metadata, hashBytes },
    'RELEASE_ASSEMBLY_ASSET_PAGE_MISMATCH',
    'asset plan path tampering',
);

await expectInventoryIssue(
    { assembly, sealedAssets, metadata: { ...metadata, modified: '2026-08-22T00:00:00.000Z' }, hashBytes },
    'RELEASE_META_DATE_ORDER_INVALID',
    'metadata date order',
);
await expectInventoryIssue(
    {
        assembly,
        sealedAssets,
        metadata: { ...metadata, localizedMeta: { ...metadata.localizedMeta, fr: { title: 'Unexpected' } } },
        hashBytes,
    },
    'RELEASE_META_LANGUAGE_UNEXPECTED',
    'unexpected metadata language',
);
await expectInventoryIssue(
    { assembly, sealedAssets, metadata: { ...metadata, html: '<script>' }, hashBytes },
    'RELEASE_INVENTORY_PROPERTY_UNSUPPORTED',
    'metadata property injection',
);
await expectInventoryIssue(
    { assembly, sealedAssets, metadata, hashBytes: () => 'bad' },
    'RELEASE_INVENTORY_HASH_INVALID',
    'invalid hash function result',
);

const moduleSource = readFileSync(new URL('../js/dsf-release-file-inventory.js', import.meta.url), 'utf8');
for (const forbiddenDependency of [
    'jszip',
    'file-saver',
    './press',
    './viewer',
    './state',
    './firebase',
    './export',
    'fetch(',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `file inventory cannot depend on ${forbiddenDependency}`);
}

console.log('DSF release file inventory verification passed');
