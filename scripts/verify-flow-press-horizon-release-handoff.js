import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION } from '../js/dsf-delivery-v2.js';
import { uploadDsfHorizonReleasePlan } from '../js/dsf-horizon-release-upload.js';
import { sha256DsfBytes, sealDsfWebPAsset } from '../js/dsf-release-byte-sealing.js';
import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import {
    FLOW_PRESS_HORIZON_HANDOFF_KIND,
    FLOW_PRESS_HORIZON_HANDOFF_VERSION,
    FlowPressHorizonReleaseHandoffError,
    createFlowPressHorizonReleaseHandoff,
    resolveFlowPressHorizonImageBlob,
} from '../js/flow-press-horizon-release-handoff.js';
import { createFlowPressLocalReleasePlanning } from '../js/flow-press-local-release-planning.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const webpBytes = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const UID = 'reader_owner_1';
const WORK_ID = 'work_horizon_v2';
const RELEASE_ID = 'rel_horizon_v2_1';
const PUBLIC_ORIGIN = 'https://media.dsf.ink';
const ROOT_PATH = `users/${UID}/dsf/${WORK_ID}/${RELEASE_ID}`;

async function hashBytes(input) {
    const bytes = input instanceof Blob
        ? new Uint8Array(await input.arrayBuffer())
        : input;
    return createHash('sha256').update(bytes).digest('hex');
}

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

function createHandoff(overrides = {}) {
    return createFlowPressHorizonReleaseHandoff({
        planning,
        sealedAssets,
        uid: UID,
        workId: WORK_ID,
        releaseId: RELEASE_ID,
        publicBaseUrl: PUBLIC_ORIGIN,
        fontRegistry,
        hashBytes,
        cryptoRef: webcrypto,
        ...overrides,
    });
}

function assertHandoffError(error, issueCode) {
    assert.equal(error instanceof FlowPressHorizonReleaseHandoffError, true);
    assert.equal(error.code, 'DSF_FLOW_PRESS_HORIZON_HANDOFF_INVALID');
    assert.equal(error.issues[0].code, issueCode);
    assert.equal(Object.isFrozen(error.issues), true);
    return true;
}

const planningSnapshot = JSON.stringify(planning);
const handoff = await createHandoff();
assert.equal(handoff.handoffVersion, FLOW_PRESS_HORIZON_HANDOFF_VERSION);
assert.equal(handoff.handoffKind, FLOW_PRESS_HORIZON_HANDOFF_KIND);
assert.equal(handoff.ready, true);
assert.equal(handoff.readyForUpload, true);
assert.equal(handoff.readyForMetadataWrite, false);
assert.deepEqual(handoff.identity, { uid: UID, workId: WORK_ID, releaseId: RELEASE_ID });
assert.equal(handoff.plan.releaseRootPath, ROOT_PATH);
assert.equal(handoff.imageFiles.length, 1);
assert.equal(handoff.imageFiles[0].blob, sealed.blob, 'handoff must retain the exact sealed Blob identity');
assert.equal(handoff.imageFiles[0].sha256, sealed.descriptor.sha256);
assert.equal(handoff.imageFiles[0].byteLength, sealed.blob.size);
assert.equal(handoff.imageFiles[0].storagePath.startsWith(`${ROOT_PATH}/`), true);
assert.equal(handoff.imageFiles[0].publicUrl, `${PUBLIC_ORIGIN}/${handoff.imageFiles[0].storagePath}`);
assert.equal(handoff.summary.imageFileCount, 1);
assert.equal(handoff.summary.boundImageBytes, sealed.blob.size);
assert.equal(Object.isFrozen(handoff), true);
assert.equal(Object.isFrozen(handoff.plan), true);
assert.equal(Object.isFrozen(handoff.imageFiles), true);
assert.equal(JSON.stringify(planning), planningSnapshot, 'handoff cannot mutate the Press planning result');

const imagePlanFile = handoff.plan.files.find((file) => file.mimeType === 'image/webp');
const jsonPlanFile = handoff.plan.files.find((file) => file.mimeType === 'application/json');
assert.equal(resolveFlowPressHorizonImageBlob(handoff, imagePlanFile), sealed.blob);
assert.throws(
    () => resolveFlowPressHorizonImageBlob(handoff, jsonPlanFile),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_IMAGE_NOT_FOUND'),
);
assert.throws(
    () => resolveFlowPressHorizonImageBlob(handoff, { ...imagePlanFile, sha256: 'f'.repeat(64) }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_IMAGE_FILE_MISMATCH'),
);

function exactReceipt(file) {
    return {
        storagePath: file.storagePath,
        publicUrl: file.publicUrl,
        mimeType: file.mimeType,
        byteLength: file.byteLength,
        sha256: file.sha256,
        cacheControl: file.cacheControl,
    };
}

const uploadCalls = [];
const uploadResult = await uploadDsfHorizonReleasePlan({
    plan: handoff.plan,
    resolveImageBlob: async (file) => resolveFlowPressHorizonImageBlob(handoff, file),
    getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url, options) => {
        const storagePath = options.body.get('path');
        const file = handoff.plan.files.find((entry) => entry.storagePath === storagePath);
        assert.ok(file);
        uploadCalls.push({ url, file });
        assert.equal(await hashBytes(options.body.get('file')), file.sha256);
        return Response.json({ receipt: exactReceipt(file), reused: false });
    },
    hashBytes,
});
assert.equal(uploadCalls.length, handoff.plan.files.length);
assert.equal(uploadResult.readyForMetadataWrite, true);
assert.deepEqual(uploadResult.receipts, handoff.plan.files.map(exactReceipt));
assert.equal(handoff.readyForMetadataWrite, false, 'dry-run handoff itself must never become a metadata-write seal');

await assert.rejects(
    () => createHandoff({ sealedAssets: [] }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_SEALED_ASSET_MISSING'),
);
await assert.rejects(
    () => createHandoff({ sealedAssets: [...sealedAssets, ...sealedAssets] }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_SEALED_ASSET_DUPLICATE'),
);
await assert.rejects(
    () => createHandoff({
        sealedAssets: [{ language: 'ja', blockId: 'unexpected-page', pageIndex: 0, sealed }],
    }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_SEALED_ASSET_UNEXPECTED'),
);
await assert.rejects(
    () => createHandoff({
        sealedAssets: [{
            ...sealedAssets[0],
            sealed: { ...sealed, descriptor: { ...sealed.descriptor, width: 2 } },
        }],
    }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_DESCRIPTOR_MISMATCH'),
);

const changedBytes = new Uint8Array(webpBytes);
changedBytes[changedBytes.length - 1] ^= 0x01;
await assert.rejects(
    () => createHandoff({
        sealedAssets: [{
            ...sealedAssets[0],
            sealed: { ...sealed, blob: new Blob([changedBytes], { type: 'image/webp' }) },
        }],
    }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_HASH_MISMATCH'),
);
await assert.rejects(
    () => createHandoff({ planning: { ...planning, planningKind: 'remote' } }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_PLANNING_NOT_READY'),
);

const controller = new AbortController();
controller.abort();
await assert.rejects(
    () => createHandoff({ signal: controller.signal }),
    (error) => assertHandoffError(error, 'FLOW_HORIZON_HANDOFF_ABORTED'),
);

const moduleSource = readFileSync(new URL('../js/flow-press-horizon-release-handoff.js', import.meta.url), 'utf8').toLowerCase();
for (const forbidden of ['fetch(', 'formdata', 'getaccesstoken', "from './firebase", 'firebase/firestore', 'setdoc(', "from './press", "from './viewer", 'uploadpresspage']) {
    assert.equal(moduleSource.includes(forbidden), false, `dry-run handoff must not include ${forbidden}`);
}
for (const relativePath of ['../js/firebase.js', '../js/viewer.js']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /flow-press-horizon-release-handoff|createFlowPressHorizonReleaseHandoff/,
        `${relativePath} must not connect the isolated dry-run handoff unit`);
}

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-horizon-release-handoff\.js'\)/);
assert.match(pressSource, /createFlowPressHorizonReleaseHandoff\(\{/);
assert.match(pressSource, /press-flow-horizon-handoff-readiness/);
assert.match(pressSource, /dataset\.flowHorizonState/);
assert.match(pressSource, /btn\.disabled = !flowHorizonReady \|\| working \|\| saved/);
assert.match(pressSource, /アップロード未実行/);
assert.match(pressSource, /Horizonへ下書き保存/);
assert.match(pressSource, /export function getFlowHorizonDryRunHandoff/);
assert.match(pressSource, /export function refreshFlowHorizonDryRunReadiness/);
assert.match(pressSource, /function _createPressFlowPreflightPreviewSignature\(\)[\s\S]*?_getSelectedPressLangs\(\)/);
assert.match(pressSource, /prepareFlowPressPublication\(\{[\s\S]*?languages: _getSelectedPressLangs\(\)/);
assert.match(pressSource, /function _handlePressLocalReleaseSettingChange\(\)[\s\S]*?_requestPressFlowProductionPreparation\(\)/);
assert.match(pressSource, /if \(hasFlowGroups\(state\)\)[\s\S]*await uploadFlowHorizonReleaseFiles\(\)/);
assert.match(pressSource, /if \(hasFlow && isHorizonPublish\)[\s\S]*flowHorizonReady \? 'ready' : 'waiting'/,
    'Flow Horizon draft save must become available only after the verified handoff is ready');
assert.doesNotMatch(pressSource, /import\('\.\/dsf-horizon-release-upload\.js'\)/,
    'Press readiness must not connect the real client transport');

const requestStart = pressSource.indexOf('async function _requestPressFlowHorizonHandoff');
const requestEnd = pressSource.indexOf('function _isPressFlowHorizonHandoffReady', requestStart);
assert.ok(requestStart >= 0 && requestEnd > requestStart, 'Press dry-run request boundary must remain auditable');
const requestSource = pressSource.slice(requestStart, requestEnd);
for (const forbidden of ['fetch(', 'uploadDsfHorizonReleasePlan', '/upload-release', 'getIdToken(', 'setDoc(', 'publishToCloud']) {
    assert.equal(requestSource.includes(forbidden), false, `Press dry-run readiness must not include ${forbidden}`);
}

const studioCss = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');
assert.match(studioCss, /\.press-flow-horizon-readiness/);
assert.match(studioCss, /\.press-flow-horizon-readiness\[data-state="ready"\]/);

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(appSource, /refreshFlowHorizonDryRunReadiness/);
assert.match(appSource, /getFlowHorizonPublishControlTitle/);
assert.match(appSource, /flowHorizonState === 'ready'/);
assert.match(appSource, /検証済み配信ファイルをアップロードし、非公開draftとして保存します/);
assert.doesNotMatch(appSource, /isFlowHorizonDryRunControl|getFlowHorizonDryRunControlTitle/,
    'all auth and editor UI guards must use the connected Flow Horizon control state');

console.log('Flow Press Horizon dry-run handoff and read-only readiness verification passed.');
