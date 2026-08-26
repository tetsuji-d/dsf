import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION } from '../js/dsf-delivery-v2.js';
import { sha256DsfBytes, sealDsfWebPAsset } from '../js/dsf-release-byte-sealing.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { createFlowPressLocalReleasePlanning } from '../js/flow-press-local-release-planning.js';
import {
    FlowPressLocalReleasePackageError,
    createFlowPressLocalReleasePackage,
} from '../js/flow-press-local-release-package.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const webpBytes = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

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

const fontBytes = createStructuralWoff2();
const fontSha256 = await sha256DsfBytes(fontBytes, { cryptoRef: webcrypto });
const fontId = 'synthetic-ja-variable-v1';
const fontDeclaration = {
    family: 'Synthetic JA Variable',
    version: '1.0.0-test',
    source: 'registry',
    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-variable-v1.woff2',
    sha256: fontSha256,
};
const fontRegistry = {
    schemaVersion: 1,
    registryKind: 'production',
    fonts: {
        [fontId]: {
            declaration: fontDeclaration,
            asset: { format: 'woff2', mimeType: 'font/woff2', byteLength: fontBytes.byteLength, immutable: true },
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

const graphic = { id: 'graphic-cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const flow = {
    id: 'flow-body',
    kind: 'flow',
    flow: { document: { id: 'flow-document', sourceLanguage: 'ja', sections: [] }, layout: {} },
};
const text = '固定テキスト本文';
const projection = {
    ok: true,
    projectionVersion: 1,
    renderKind: 'fixedText',
    flowGroupId: flow.id,
    documentId: flow.flow.document.id,
    language: 'ja',
    revision: 7,
    writingMode: 'horizontal-tb',
    font: { id: fontId, declaration: fontDeclaration },
    manifest: {
        schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
        language: 'ja',
        styles: {
            body: {
                fontRef: fontId,
                fontSize: 16,
                fontWeight: 400,
                fontStyle: 'normal',
                lineHeight: 1.8,
                letterSpacing: 0,
                color: '#111111',
                textDecoration: 'none',
                textAlign: 'start',
            },
        },
        pages: [{
            id: 'flow-ja-0001',
            renderKind: 'fixedText',
            sourceAnchor: {
                kind: 'flow',
                flowGroupId: flow.id,
                sectionId: 'flow-section',
                firstBlockId: 'flow-paragraph',
                blockProgress: 0,
            },
            pageLabel: '2',
            background: { color: '#ffffff' },
            lines: [{
                x: 20,
                y: 20,
                width: 200,
                height: 30,
                writingMode: 'horizontal-tb',
                textOrientation: 'mixed',
                styleRef: 'body',
                runs: [{
                    text,
                    source: { blockId: 'flow-paragraph', startGrapheme: 0, endGrapheme: [...text].length },
                }],
            }],
        }],
    },
    summary: { pageCount: 1, lineCount: 1, runCount: 1 },
};
const preflight = createDsfPressPreflight({
    blocks: [graphic, flow],
    language: 'ja',
    flowPublicationProjections: { [flow.id]: projection },
    flowPublicationRevisions: { [flow.id]: 7 },
    fontRegistry,
});
assert.equal(preflight.publishable, true);

const sealed = await sealDsfWebPAsset({
    bytes: webpBytes,
    expectedWidth: 1,
    expectedHeight: 1,
    pageId: 'graphic-cover-ja',
    pageLabel: '1',
}, { cryptoRef: webcrypto });
const planning = await createFlowPressLocalReleasePlanning({
    preparation: {
        preparationKind: 'production',
        ok: true,
        languages: [{ language: 'ja', state: 'ready', preparationIssues: [], preflight }],
    },
    defaultLang: 'ja',
    languages: ['ja'],
    pageDirections: { ja: 'rtl' },
    imageAssets: { ja: { [graphic.id]: sealed.descriptor } },
    fontRegistry,
    hashBytes,
});
const sealedAssets = [{ language: 'ja', blockId: graphic.id, pageIndex: 0, sealed }];
const metadata = {
    projectId: 'project-local-package',
    workId: 'work-local-package',
    releaseId: 'release-local-package',
    title: 'ローカルZIP検証',
    author: 'DSF Test',
    localizedMeta: { ja: { title: 'ローカルZIP検証', author: 'DSF Test' } },
    created: '2026-08-25T00:00:00.000Z',
    modified: '2026-08-25T00:00:00.000Z',
    generator: 'DSF Studio local package test',
    spread: 'auto',
};
const fetchCalls = [];
const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
        ok: true,
        status: 200,
        headers: {
            get(name) {
                if (name === 'content-type') return 'font/woff2';
                if (name === 'content-length') return String(fontBytes.byteLength);
                return null;
            },
        },
        arrayBuffer: async () => fontBytes.buffer.slice(0),
    };
};

const firstPackage = await createFlowPressLocalReleasePackage({
    planning,
    sealedAssets,
    metadata,
    fontRegistry,
    fetchImpl,
    hashBytes,
    cryptoRef: webcrypto,
});
const secondPackage = await createFlowPressLocalReleasePackage({
    planning,
    sealedAssets,
    metadata,
    fontRegistry,
    fetchImpl,
    hashBytes,
    cryptoRef: webcrypto,
});
assert.equal(Object.isFrozen(firstPackage), true);
assert.equal(firstPackage.ready, true);
assert.equal(firstPackage.packageKind, 'portable-local-only');
assert.equal(firstPackage.summary.roundTripVerified, true);
assert.equal(firstPackage.summary.entryCount, firstPackage.inventory.files.length);
assert.equal(firstPackage.summary.imageFileCount, 1);
assert.equal(firstPackage.summary.fontFileCount, 1);
assert.equal(firstPackage.summary.zipByteLength, firstPackage.zipPackage.blob.size);
assert.equal(firstPackage.summary.zipSha256, secondPackage.summary.zipSha256);
assert.equal(firstPackage.summary.zipByteLength, secondPackage.summary.zipByteLength);
assert.equal(firstPackage.zipPackage.roundTrip.entries.some((entry) => entry.path.startsWith('fonts/')), true);
assert.equal(firstPackage.zipPackage.roundTrip.entries.some((entry) => entry.path.endsWith('.webp')), true);
assert.equal(firstPackage.portablePlan.assembly.files.index.json.includes('https://unit-test-fonts'), false);
assert.equal(fetchCalls.length, 2);
assert.equal(fetchCalls.every((call) => call.url === fontDeclaration.href), true);
assert.equal(fetchCalls.every((call) => call.options.credentials === 'omit' && call.options.redirect === 'error'), true);

await assert.rejects(
    () => createFlowPressLocalReleasePackage({
        planning,
        sealedAssets,
        metadata,
        fontRegistry,
        hashBytes,
        cryptoRef: webcrypto,
        fetchImpl: async () => ({
            ok: true,
            headers: { get: (name) => (name === 'content-type' ? 'application/octet-stream' : null) },
            arrayBuffer: async () => fontBytes.buffer.slice(0),
        }),
    }),
    (error) => error instanceof FlowPressLocalReleasePackageError
        && error.issues.some((issue) => issue.code === 'FLOW_LOCAL_PACKAGE_FONT_MIME_MISMATCH'),
);

const source = readFileSync(new URL('../js/flow-press-local-release-package.js', import.meta.url), 'utf8');
for (const forbidden of ['./firebase', './press', './export', 'uploadPressPage', 'setDoc(', 'saveAs(', 'document.', 'window.', 'localStorage', 'indexedDB']) {
    assert.equal(source.includes(forbidden), false, `local package cannot depend on ${forbidden}`);
}
assert.match(source, /createDsfPortableReleasePlan/);
assert.match(source, /createDsfReleaseFileInventory/);
assert.match(source, /createDsfReleaseZipPackage/);
assert.match(source, /credentials:\s*'omit'/);
assert.match(source, /redirect:\s*'error'/);

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-local-release-package\.js'\)/);
assert.match(pressSource, /press-flow-local-release-package-summary/);
assert.match(pressSource, /data-flow-portable-download/);
assert.match(pressSource, /btn\.disabled = !flowPortableReady/);

console.log('Flow Press exact local portable ZIP verification passed.');
