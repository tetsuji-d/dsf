import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import JSZip from 'jszip';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    createDsfWebCryptoSha256,
    sealDsfWebPAsset,
} from '../js/dsf-release-byte-sealing.js';
import {
    DSF_CONTENT_MIMETYPE,
    createDsfReleaseFileInventory,
} from '../js/dsf-release-file-inventory.js';
import {
    DSF_RELEASE_ZIP_PACKAGE_FORMAT,
    DSF_RELEASE_ZIP_PACKAGE_SCHEMA_VERSION,
    DSF_RELEASE_ZIP_ROUND_TRIP_FORMAT,
    DsfReleaseZipPackageError,
    createDsfReleaseZipPackage,
    verifyDsfReleaseZipRoundTrip,
} from '../js/dsf-release-zip-package.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const realVp8 = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const hashBytes = createDsfWebCryptoSha256({ cryptoRef: webcrypto });
const clone = (value) => structuredClone(value);
const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image' } };

function createPreflight(language) {
    return createDsfPressPreflight({
        blocks: [graphicBlock],
        language,
        compositionSnapshots: {},
    });
}

function hashBlob(blob) {
    return blob.arrayBuffer().then((buffer) => createHash('sha256').update(new Uint8Array(buffer)).digest('hex'));
}

async function expectPackageIssue(action, expectedCode, label) {
    await assert.rejects(
        action,
        (error) => error instanceof DsfReleaseZipPackageError
            && error.code === 'DSF_RELEASE_ZIP_PACKAGE_INVALID'
            && error.issues.some((issue) => issue.code === expectedCode),
        label,
    );
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
const inventory = await createDsfReleaseFileInventory({
    assembly,
    sealedAssets: [
        { language: 'ja', blockId: graphicBlock.id, pageIndex: 0, sealed: sealedJa },
        { language: 'en', blockId: graphicBlock.id, pageIndex: 0, sealed: sealedEn },
    ],
    metadata: {
        projectId: 'project_story',
        workId: 'work_story',
        releaseId: 'release_20260823_1',
        title: '冬の金沢',
        author: 'DSF Author',
        localizedMeta: {
            ja: { title: '冬の金沢', author: '著作者', description: '冬の物語' },
            en: { title: 'Winter in Kanazawa', author: 'Author', description: 'A winter story' },
        },
        created: '2026-08-23T00:00:00.000Z',
        modified: '2026-08-23T01:00:00.000Z',
        generator: 'DSF Studio ZIP test',
    },
    hashBytes,
});

const inventorySnapshot = clone(inventory);
const firstPackage = await createDsfReleaseZipPackage({ inventory, hashBytes });
const secondPackage = await createDsfReleaseZipPackage({ inventory, hashBytes });

assert.equal(firstPackage.schemaVersion, DSF_RELEASE_ZIP_PACKAGE_SCHEMA_VERSION);
assert.equal(firstPackage.format, DSF_RELEASE_ZIP_PACKAGE_FORMAT);
assert.equal(firstPackage.mimeType, DSF_CONTENT_MIMETYPE);
assert.equal(firstPackage.blob.type, DSF_CONTENT_MIMETYPE);
assert.equal(firstPackage.blob.size, firstPackage.byteLength);
assert.equal(await hashBlob(firstPackage.blob), firstPackage.sha256);
assert.equal(firstPackage.roundTrip.format, DSF_RELEASE_ZIP_ROUND_TRIP_FORMAT);
assert.equal(firstPackage.roundTrip.entryCount, inventory.files.length);
assert.deepEqual(firstPackage.roundTrip.entries.map((entry) => entry.path), inventory.files.map((file) => file.path));
assert.equal(firstPackage.roundTrip.entries[0].compression, 'STORE');
assert.equal(firstPackage.roundTrip.entries.slice(1).every((entry) => entry.compression === 'DEFLATE'), true);
assert.equal(Object.isFrozen(firstPackage), true);
assert.equal(Object.isFrozen(firstPackage.roundTrip), true);
assert.equal(Object.isFrozen(firstPackage.roundTrip.entries), true);
assert.deepEqual(inventory, inventorySnapshot, 'ZIP packaging must not mutate the 9A-4C inventory');

const firstBytes = new Uint8Array(await firstPackage.blob.arrayBuffer());
const secondBytes = new Uint8Array(await secondPackage.blob.arrayBuffer());
assert.deepEqual(firstBytes, secondBytes, 'same inventory must produce deterministic ZIP bytes');
assert.equal(firstPackage.sha256, secondPackage.sha256);

const explicitRoundTrip = await verifyDsfReleaseZipRoundTrip({
    inventory,
    zipBytes: firstPackage.blob,
    hashBytes,
});
assert.equal(explicitRoundTrip.sha256, firstPackage.sha256);
assert.equal(explicitRoundTrip.byteLength, firstPackage.byteLength);

const reopened = await JSZip.loadAsync(firstBytes, { checkCRC32: true, createFolders: false });
const reopenedEntries = Object.values(reopened.files);
assert.deepEqual(reopenedEntries.map((entry) => entry.name), inventory.files.map((file) => file.path));
assert.equal(reopenedEntries.some((entry) => entry.dir), false, 'ZIP must not synthesize directory entries');
assert.equal(reopenedEntries[0].date.toISOString(), '1980-01-01T00:00:00.000Z');
assert.equal(await reopenedEntries[0].async('string'), DSF_CONTENT_MIMETYPE);
for (const [index, entry] of reopenedEntries.entries()) {
    const bytes = await entry.async('uint8array');
    assert.equal(bytes.byteLength, inventory.files[index].byteLength, entry.name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), inventory.files[index].sha256, entry.name);
}

const changedBlobInventory = clone(inventory);
const changedBytes = new Uint8Array(await changedBlobInventory.files.at(-1).blob.arrayBuffer());
changedBytes[changedBytes.length - 1] ^= 0x01;
changedBlobInventory.files.at(-1).blob = new Blob([changedBytes], { type: 'image/webp' });
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: changedBlobInventory, hashBytes }),
    'RELEASE_ZIP_INVENTORY_HASH_MISMATCH',
    'changed inventory Blob',
);

const unsafePathInventory = clone(inventory);
unsafePathInventory.files.at(-1).path = '../outside.webp';
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: unsafePathInventory, hashBytes }),
    'RELEASE_ZIP_PATH_INVALID',
    'path traversal',
);

const caseCollisionInventory = clone(inventory);
caseCollisionInventory.files.at(-1).path = 'CONTENT.JSON';
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: caseCollisionInventory, hashBytes }),
    'RELEASE_ZIP_PORTABLE_PATH_COLLISION',
    'case-insensitive path collision',
);

const reorderedInventory = clone(inventory);
[reorderedInventory.files[0], reorderedInventory.files[1]] = [reorderedInventory.files[1], reorderedInventory.files[0]];
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: reorderedInventory, hashBytes }),
    'RELEASE_ZIP_ROOT_ORDER_INVALID',
    'required root order',
);

const wrongBlobMimeInventory = clone(inventory);
wrongBlobMimeInventory.files[2].blob = new Blob(
    [await wrongBlobMimeInventory.files[2].blob.arrayBuffer()],
    { type: 'text/html' },
);
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: wrongBlobMimeInventory, hashBytes }),
    'RELEASE_ZIP_FILE_BLOB_MIME_MISMATCH',
    'Blob MIME mismatch',
);

const unknownRoleInventory = clone(inventory);
unknownRoleInventory.files.at(-1).role = 'script';
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: unknownRoleInventory, hashBytes }),
    'RELEASE_ZIP_FILE_ROLE_UNSUPPORTED',
    'unsupported file role',
);

const contentOrderInventory = clone(inventory);
const firstImage = contentOrderInventory.files.pop();
contentOrderInventory.files.splice(4, 0, firstImage);
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: contentOrderInventory, hashBytes }),
    'RELEASE_ZIP_CONTENT_ORDER_INVALID',
    'language manifest after image',
);

const staleManifestInventory = clone(inventory);
staleManifestInventory.archiveManifest.payloadByteLength += 1;
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: staleManifestInventory, hashBytes }),
    'RELEASE_ZIP_JSON_MISMATCH',
    'stale archive manifest object',
);

const staleIntegrityInventory = clone(inventory);
staleIntegrityInventory.integrity.contentSha256 = '0'.repeat(64);
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: staleIntegrityInventory, hashBytes }),
    'RELEASE_ZIP_INTEGRITY_MISMATCH',
    'stale integrity summary',
);

const staleSummaryInventory = clone(inventory);
staleSummaryInventory.summary.totalBytes += 1;
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory: staleSummaryInventory, hashBytes }),
    'RELEASE_ZIP_SUMMARY_MISMATCH',
    'stale inventory summary',
);

await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory, hashBytes: () => 'bad' }),
    'RELEASE_ZIP_HASH_INVALID',
    'invalid hasher result',
);
await expectPackageIssue(
    () => createDsfReleaseZipPackage({ inventory, hashBytes, download: true }),
    'RELEASE_ZIP_PROPERTY_UNSUPPORTED',
    'package property injection',
);
await expectPackageIssue(
    () => verifyDsfReleaseZipRoundTrip({ inventory, zipBytes: firstBytes, hashBytes, upload: true }),
    'RELEASE_ZIP_PROPERTY_UNSUPPORTED',
    'round-trip property injection',
);

const corruptSignature = firstBytes.slice();
corruptSignature[0] ^= 0xff;
await expectPackageIssue(
    () => verifyDsfReleaseZipRoundTrip({ inventory, zipBytes: corruptSignature, hashBytes }),
    'RELEASE_ZIP_LOCAL_HEADER_INVALID',
    'corrupt ZIP signature',
);
await expectPackageIssue(
    () => verifyDsfReleaseZipRoundTrip({ inventory, zipBytes: firstBytes.subarray(0, firstBytes.length - 20), hashBytes }),
    'RELEASE_ZIP_ROUND_TRIP_LOAD_FAILED',
    'truncated ZIP',
);

const moduleSource = readFileSync(new URL('../js/dsf-release-zip-package.js', import.meta.url), 'utf8');
assert.equal(moduleSource.includes("from 'jszip'"), true, 'existing JSZip dependency must be reused');
for (const forbiddenDependency of [
    'file-saver',
    './press',
    './viewer',
    './state',
    './firebase',
    './export',
    'saveAs(',
    'fetch(',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `ZIP package cannot depend on ${forbiddenDependency}`);
}

console.log('DSF release ZIP package verification passed');
