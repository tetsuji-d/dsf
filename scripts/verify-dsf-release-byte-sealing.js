import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    DSF_RELEASE_BYTE_SEALING_VERSION,
    DsfReleaseByteSealingError,
    createDsfWebCryptoSha256,
    inspectDsfWebPBytes,
    sealDsfWebPAsset,
    sha256DsfBytes,
} from '../js/dsf-release-byte-sealing.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const realVp8 = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const vp8Payload = realVp8.slice(20);

function ascii(target, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
        target[offset + index] = value.charCodeAt(index);
    }
}

function makeWebP(chunks) {
    const byteLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.payload.length + (chunk.payload.length & 1), 0);
    const bytes = new Uint8Array(byteLength);
    const view = new DataView(bytes.buffer);
    ascii(bytes, 0, 'RIFF');
    view.setUint32(4, byteLength - 8, true);
    ascii(bytes, 8, 'WEBP');
    let offset = 12;
    for (const chunk of chunks) {
        ascii(bytes, offset, chunk.fourCc);
        view.setUint32(offset + 4, chunk.payload.length, true);
        bytes.set(chunk.payload, offset + 8);
        offset += 8 + chunk.payload.length + (chunk.payload.length & 1);
    }
    return bytes;
}

function createVp8XPayload({ width = 1, height = 1, flags = 0 } = {}) {
    const payload = new Uint8Array(10);
    payload[0] = flags;
    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;
    payload[4] = widthMinusOne & 0xff;
    payload[5] = (widthMinusOne >> 8) & 0xff;
    payload[6] = (widthMinusOne >> 16) & 0xff;
    payload[7] = heightMinusOne & 0xff;
    payload[8] = (heightMinusOne >> 8) & 0xff;
    payload[9] = (heightMinusOne >> 16) & 0xff;
    return payload;
}

function createVp8LHeader({ width = 1, height = 1, alpha = false, version = 0 } = {}) {
    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;
    return new Uint8Array([
        0x2f,
        widthMinusOne & 0xff,
        ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6),
        (heightMinusOne >> 2) & 0xff,
        ((heightMinusOne >> 10) & 0x0f) | (alpha ? 0x10 : 0) | ((version & 0x07) << 5),
    ]);
}

async function expectSealIssue(operation, expectedCode, label) {
    await assert.rejects(
        operation,
        (error) => error instanceof DsfReleaseByteSealingError
            && error.code === 'DSF_RELEASE_BYTE_SEALING_INVALID'
            && error.issues.some((issue) => issue.code === expectedCode),
        label,
    );
}

const inspection = await inspectDsfWebPBytes(realVp8);
assert.deepEqual(inspection, {
    sealingVersion: DSF_RELEASE_BYTE_SEALING_VERSION,
    container: 'RIFF',
    format: 'WEBP',
    codec: 'VP8',
    byteLength: 42,
    width: 1,
    height: 1,
    extended: false,
    alpha: false,
    metadata: { iccp: false, exif: false, xmp: false },
    chunks: ['VP8 '],
});
assert.equal(Object.isFrozen(inspection), true);
assert.equal(Object.isFrozen(inspection.chunks), true);

const blobInspection = await inspectDsfWebPBytes(new Blob([realVp8], { type: 'image/webp' }));
assert.deepEqual(blobInspection, inspection);
await expectSealIssue(
    () => inspectDsfWebPBytes(new Blob([realVp8], { type: 'image/png' })),
    'WEBP_MIME_TYPE_MISMATCH',
    'Blob MIME mismatch',
);

const expectedHash = createHash('sha256').update(realVp8).digest('hex');
assert.equal(await sha256DsfBytes(realVp8, { cryptoRef: webcrypto }), expectedHash);
assert.equal(
    await sha256DsfBytes(new TextEncoder().encode('abc'), { cryptoRef: webcrypto }),
    createHash('sha256').update('abc').digest('hex'),
    'the assembler hash adapter must support non-WebP JSON bytes',
);
const hashBytes = createDsfWebCryptoSha256({ cryptoRef: webcrypto });
assert.equal(Object.isFrozen(hashBytes), true);
assert.equal(await hashBytes(realVp8), expectedHash);
await expectSealIssue(
    () => sha256DsfBytes(realVp8, { cryptoRef: {} }),
    'WEB_CRYPTO_UNAVAILABLE',
    'Web Crypto unavailable',
);

const mutableSource = new Uint8Array(realVp8);
const sealed = await sealDsfWebPAsset({
    bytes: mutableSource,
    expectedWidth: 1,
    expectedHeight: 1,
    expectedSha256: expectedHash.toUpperCase(),
    pageId: 'cover-ja',
    pageLabel: '1',
}, { cryptoRef: webcrypto });
assert.equal(sealed.sealingVersion, DSF_RELEASE_BYTE_SEALING_VERSION);
assert.equal(sealed.blob.type, 'image/webp');
assert.equal(sealed.blob.size, realVp8.byteLength);
assert.deepEqual(sealed.descriptor, {
    sha256: expectedHash,
    byteLength: 42,
    width: 1,
    height: 1,
    mimeType: 'image/webp',
    pageId: 'cover-ja',
    pageLabel: '1',
});
assert.equal(Object.isFrozen(sealed), true);
assert.equal(Object.isFrozen(sealed.descriptor), true);
mutableSource.fill(0);
assert.equal(
    createHash('sha256').update(new Uint8Array(await sealed.blob.arrayBuffer())).digest('hex'),
    expectedHash,
    'sealed Blob must not change when the caller mutates its source typed array',
);

// The sealed descriptor feeds 9A-4A without any R2 or Press runtime connection.
const graphicBlock = { id: 'graphic_cover', kind: 'page', content: { pageKind: 'image' } };
const preflight = createDsfPressPreflight({
    blocks: [graphicBlock],
    language: 'ja',
    compositionSnapshots: {},
});
const assembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes,
    languages: [{
        language: 'ja',
        pageDirection: 'rtl',
        preflight,
        imageAssets: { [graphicBlock.id]: sealed.descriptor },
    }],
});
assert.equal(assembly.bundle.manifests.ja.pages[0].image.width, 1);
assert.equal(assembly.files.assets[0].sha256, expectedHash);
assert.equal(assembly.files.index.sha256, await hashBytes(new TextEncoder().encode(assembly.files.index.json)));

const lossless = makeWebP([{ fourCc: 'VP8L', payload: createVp8LHeader({ width: 3, height: 5, alpha: true }) }]);
const losslessInspection = await inspectDsfWebPBytes(lossless);
assert.equal(losslessInspection.codec, 'VP8L');
assert.equal(losslessInspection.width, 3);
assert.equal(losslessInspection.height, 5);
assert.equal(losslessInspection.alpha, true);

const extended = makeWebP([
    { fourCc: 'VP8X', payload: createVp8XPayload() },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
const extendedInspection = await inspectDsfWebPBytes(extended);
assert.equal(extendedInspection.extended, true);
assert.deepEqual(extendedInspection.chunks, ['VP8X', 'VP8 ']);

const extendedLosslessAlpha = makeWebP([
    { fourCc: 'VP8X', payload: createVp8XPayload({ flags: 0x10 }) },
    { fourCc: 'VP8L', payload: createVp8LHeader({ alpha: false }) },
]);
assert.equal((await inspectDsfWebPBytes(extendedLosslessAlpha)).alpha, true,
    'VP8L alpha hint may be zero when the VP8X alpha feature is declared');

const badSignature = new Uint8Array(realVp8);
badSignature[0] = 0;
await expectSealIssue(() => inspectDsfWebPBytes(badSignature), 'WEBP_CONTAINER_SIGNATURE_INVALID', 'container signature');

const badRiffSize = new Uint8Array(realVp8);
badRiffSize[4] -= 1;
await expectSealIssue(() => inspectDsfWebPBytes(badRiffSize), 'WEBP_RIFF_SIZE_MISMATCH', 'RIFF size');

const truncatedChunk = new Uint8Array(realVp8);
new DataView(truncatedChunk.buffer).setUint32(16, 999, true);
await expectSealIssue(() => inspectDsfWebPBytes(truncatedChunk), 'WEBP_CHUNK_TRUNCATED', 'chunk truncation');

const unsupportedChunk = makeWebP([
    { fourCc: 'JUNK', payload: new Uint8Array([1, 2]) },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
await expectSealIssue(() => inspectDsfWebPBytes(unsupportedChunk), 'WEBP_CHUNK_UNSUPPORTED', 'unknown chunk');

const duplicatePrimary = makeWebP([
    { fourCc: 'VP8 ', payload: vp8Payload },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
await expectSealIssue(() => inspectDsfWebPBytes(duplicatePrimary), 'WEBP_CHUNK_DUPLICATE', 'duplicate primary');

const animated = makeWebP([
    { fourCc: 'VP8X', payload: createVp8XPayload({ flags: 0x02 }) },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
await expectSealIssue(() => inspectDsfWebPBytes(animated), 'WEBP_ANIMATION_UNSUPPORTED', 'animation flag');

const canvasMismatch = makeWebP([
    { fourCc: 'VP8X', payload: createVp8XPayload({ width: 2, height: 1 }) },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
await expectSealIssue(() => inspectDsfWebPBytes(canvasMismatch), 'WEBP_CANVAS_DIMENSION_MISMATCH', 'canvas dimensions');

const featureMismatch = makeWebP([
    { fourCc: 'VP8X', payload: createVp8XPayload({ flags: 0x04 }) },
    { fourCc: 'VP8 ', payload: vp8Payload },
]);
await expectSealIssue(() => inspectDsfWebPBytes(featureMismatch), 'WEBP_VP8X_FEATURE_MISMATCH', 'feature flags');

const badVp8LVersion = makeWebP([{ fourCc: 'VP8L', payload: createVp8LHeader({ version: 1 }) }]);
await expectSealIssue(() => inspectDsfWebPBytes(badVp8LVersion), 'WEBP_VP8L_VERSION_UNSUPPORTED', 'VP8L version');

await expectSealIssue(
    () => sealDsfWebPAsset({ bytes: realVp8, expectedWidth: 1080, expectedHeight: 1920 }, { cryptoRef: webcrypto }),
    'WEBP_EXPECTED_DIMENSION_MISMATCH',
    'Press output dimensions',
);
await expectSealIssue(
    () => sealDsfWebPAsset({
        bytes: realVp8,
        expectedWidth: 1,
        expectedHeight: 1,
        expectedSha256: '0'.repeat(64),
    }, { cryptoRef: webcrypto }),
    'WEBP_EXPECTED_HASH_MISMATCH',
    'expected hash',
);
await expectSealIssue(
    () => sealDsfWebPAsset({ bytes: realVp8, expectedWidth: 1, expectedHeight: 1, href: 'unsafe.webp' }, { cryptoRef: webcrypto }),
    'WEBP_SEAL_PROPERTY_UNSUPPORTED',
    'caller path injection',
);

const moduleSource = readFileSync(new URL('../js/dsf-release-byte-sealing.js', import.meta.url), 'utf8');
for (const forbiddenDependency of [
    './press',
    './viewer',
    './state',
    './firebase',
    './export',
    'fetch(',
    'XMLHttpRequest',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `byte sealing cannot depend on ${forbiddenDependency}`);
}

console.log('DSF release byte sealing verification passed');
