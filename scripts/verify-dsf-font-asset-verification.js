import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DsfFontAssetVerificationError,
    inspectDsfWoff2Bytes,
    verifyDsfProductionFontAsset,
} from '../js/dsf-font-asset-verification.js';
import { sha256DsfBytes } from '../js/dsf-release-byte-sealing.js';

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

function createRegistry(bytes, sha256) {
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
                    allowsPortableEmbedding: true,
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

const bytes = createStructuralWoff2();
const sha256 = await sha256DsfBytes(bytes);
const registry = createRegistry(bytes, sha256);
const inspection = await inspectDsfWoff2Bytes(bytes);
assert.equal(inspection.signature, 'wOF2');
assert.equal(inspection.byteLength, bytes.byteLength);
assert.equal(inspection.numTables, 1);

const evidence = await verifyDsfProductionFontAsset({
    registry,
    fontId: 'synthetic-ja-variable-v1',
    bytes,
});
assert.equal(evidence.status, 'verified');
assert.equal(evidence.sha256, sha256);
assert.equal(evidence.byteLength, bytes.byteLength);
assert.equal(evidence.blob.type, 'font/woff2');
assert.equal(evidence.blob.size, bytes.byteLength);
bytes[48] = 0;
assert.equal(new Uint8Array(await evidence.blob.arrayBuffer())[48], 48, 'evidence must own immutable bytes');

async function assertFailure(mutator, code) {
    const nextBytes = createStructuralWoff2();
    const nextHash = await sha256DsfBytes(nextBytes);
    const nextRegistry = createRegistry(nextBytes, nextHash);
    mutator(nextBytes, nextRegistry);
    await assert.rejects(
        () => verifyDsfProductionFontAsset({
            registry: nextRegistry,
            fontId: 'synthetic-ja-variable-v1',
            bytes: nextBytes,
        }),
        (error) => error instanceof DsfFontAssetVerificationError && error.code === code,
    );
}

await assertFailure((value) => { value[0] = 0; }, 'WOFF2_SIGNATURE_INVALID');
await assertFailure((value) => { new DataView(value.buffer).setUint32(8, value.byteLength - 1, false); }, 'WOFF2_LENGTH_MISMATCH');
await assertFailure((_value, nextRegistry) => {
    nextRegistry.fonts['synthetic-ja-variable-v1'].asset.byteLength += 1;
}, 'FONT_ASSET_BYTE_LENGTH_MISMATCH');
await assertFailure((_value, nextRegistry) => {
    nextRegistry.fonts['synthetic-ja-variable-v1'].declaration.sha256 = 'f'.repeat(64);
}, 'FONT_ASSET_SHA256_MISMATCH');

await assert.rejects(
    () => inspectDsfWoff2Bytes(new Blob([createStructuralWoff2()], { type: 'text/plain' })),
    (error) => error?.code === 'FONT_ASSET_MIME_TYPE_MISMATCH',
);

const source = readFileSync(new URL('../js/dsf-font-asset-verification.js', import.meta.url), 'utf8');
for (const forbidden of ['fetch(', './firebase', './press', './export', 'upload', 'setDoc(']) {
    assert.equal(source.includes(forbidden), false, `font byte verifier cannot depend on ${forbidden}`);
}

console.log('DSF production font asset exact-byte verification passed.');
