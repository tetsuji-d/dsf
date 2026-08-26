import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    createDsfProductionFontRuntimeLease,
    fetchDsfProductionFontRuntimeLease,
} from '../js/dsf-production-font-runtime.js';
import { sha256DsfBytes } from '../js/dsf-release-byte-sealing.js';

function createStructuralWoff2(length = 64) {
    const bytes = new Uint8Array(length);
    bytes.set([0x77, 0x4f, 0x46, 0x32], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 0x00010000, false);
    view.setUint32(8, length, false);
    view.setUint16(12, 1, false);
    view.setUint32(16, 64, false);
    view.setUint32(20, 8, false);
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
                asset: { format: 'woff2', mimeType: 'font/woff2', byteLength: bytes.byteLength, immutable: true },
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

class FakeFontFace {
    constructor(family, buffer, descriptors) {
        this.family = family;
        this.buffer = buffer;
        this.descriptors = descriptors;
        this.status = 'unloaded';
    }

    async load() {
        this.status = 'loaded';
        return this;
    }
}

function createDocumentFixture() {
    const added = new Set();
    return {
        defaultView: { FontFace: FakeFontFace },
        fonts: {
            added,
            add(face) {
                added.add(face);
            },
            delete(face) {
                return added.delete(face);
            },
            check() {
                return added.size > 0;
            },
        },
    };
}

const bytes = createStructuralWoff2();
const sha256 = await sha256DsfBytes(bytes);
const registry = createRegistry(bytes, sha256);
const documentRef = createDocumentFixture();
const lease = await createDsfProductionFontRuntimeLease({
    registry,
    fontId: 'synthetic-ja-variable-v1',
    bytes,
    documentRef,
    fontWeights: [400, 700],
});
assert.equal(lease.evidence.status, 'verified');
assert.equal(lease.certifiedFamily, 'Synthetic JA Variable');
assert.notEqual(lease.runtimeFontFamily, lease.certifiedFamily);
assert.match(lease.runtimeFontFamily, /^DSF Verified synthetic-ja-variable-v1 /);
assert.equal(documentRef.fonts.added.size, 2);
assert.deepEqual([...documentRef.fonts.added].map((face) => face.descriptors.weight), ['400', '700']);
lease.dispose();
lease.dispose();
assert.equal(documentRef.fonts.added.size, 0);

const fetchCalls = [];
const fetchDocument = createDocumentFixture();
const fetchedLease = await fetchDsfProductionFontRuntimeLease({
    registry,
    fontId: 'synthetic-ja-variable-v1',
    documentRef: fetchDocument,
    fontWeights: [400],
    async fetchImpl(url, options) {
        fetchCalls.push({ url, options });
        return {
            ok: true,
            status: 200,
            headers: {
                get(name) {
                    if (name === 'content-type') return 'font/woff2';
                    if (name === 'content-length') return String(bytes.byteLength);
                    return null;
                },
            },
            async arrayBuffer() {
                return bytes.buffer.slice(0);
            },
        };
    },
});
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, registry.fonts['synthetic-ja-variable-v1'].declaration.href);
assert.equal(fetchCalls[0].options.credentials, 'omit');
assert.equal(fetchCalls[0].options.redirect, 'error');
assert.equal(fetchedLease.evidence.sha256, sha256);
fetchedLease.dispose();

await assert.rejects(
    () => fetchDsfProductionFontRuntimeLease({
        registry,
        fontId: 'synthetic-ja-variable-v1',
        documentRef: createDocumentFixture(),
        async fetchImpl() {
            return {
                ok: true,
                headers: { get: (name) => (name === 'content-length' ? '1' : 'font/woff2') },
                arrayBuffer: async () => bytes.buffer.slice(0),
            };
        },
    }),
    (error) => error?.code === 'FONT_ASSET_RESPONSE_LENGTH_MISMATCH',
);

const source = readFileSync(new URL('../js/dsf-production-font-runtime.js', import.meta.url), 'utf8');
for (const forbidden of ['./firebase', './press', './export', 'uploadPressPage', 'setDoc(', 'localStorage', 'indexedDB']) {
    assert.equal(source.includes(forbidden), false, `font runtime cannot depend on ${forbidden}`);
}
assert.match(source, /credentials:\s*'omit'/);
assert.match(source, /redirect:\s*'error'/);
assert.match(source, /verifyDsfProductionFontAsset/);

console.log('DSF verified production font runtime lease passed.');
