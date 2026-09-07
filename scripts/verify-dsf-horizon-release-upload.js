import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
    DSF_HORIZON_RELEASE_CONTRACT_VERSION,
    DSF_HORIZON_RELEASE_PLAN_KIND,
} from '../js/dsf-horizon-release-contract.js';
import {
    DSF_HORIZON_RELEASE_UPLOAD_ENDPOINT,
    DSF_HORIZON_RELEASE_UPLOAD_KIND,
    DSF_HORIZON_RELEASE_UPLOAD_VERSION,
    DsfHorizonReleaseUploadError,
    uploadDsfHorizonReleasePlan,
} from '../js/dsf-horizon-release-upload.js';

const UID = 'reader_owner_1';
const WORK_ID = 'work_horizon_v2';
const RELEASE_ID = 'rel_horizon_v2_1';
const PUBLIC_ORIGIN = 'https://media.dsf.ink';
const ROOT_PATH = `users/${UID}/dsf/${WORK_ID}/${RELEASE_ID}`;
const encoder = new TextEncoder();

function sha256(input) {
    return createHash('sha256').update(input).digest('hex');
}

async function hashBlob(blob) {
    return sha256(new Uint8Array(await blob.arrayBuffer()));
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function createFile({ role, relativePath, mimeType, bytes, json, language, pageIndex }) {
    const storagePath = `${ROOT_PATH}/${relativePath}`;
    return {
        role,
        relativePath,
        storagePath,
        publicUrl: `${PUBLIC_ORIGIN}/${storagePath}`,
        mimeType,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        cacheControl: DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
        ...(json !== undefined ? { json } : {}),
        ...(language ? { language } : {}),
        ...(Number.isInteger(pageIndex) ? { pageIndex } : {}),
    };
}

const contentJson = JSON.stringify({ schemaVersion: 2, defaultLang: 'ja' });
const manifestJson = JSON.stringify({ schemaVersion: 2, language: 'ja', pages: [] });
const contentBytes = encoder.encode(contentJson);
const manifestBytes = encoder.encode(manifestJson);
const imageBytes = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const imageBlob = new Blob([imageBytes], { type: 'image/webp' });

function createPlan() {
    const files = [
        createFile({
            role: 'content-index',
            relativePath: 'content.json',
            mimeType: 'application/json',
            bytes: contentBytes,
            json: contentJson,
        }),
        createFile({
            role: 'language-manifest',
            relativePath: 'content/language-0001.json',
            mimeType: 'application/json',
            bytes: manifestBytes,
            json: manifestJson,
            language: 'ja',
        }),
        createFile({
            role: 'image',
            relativePath: 'assets/images/language-0001/page-00001.webp',
            mimeType: 'image/webp',
            bytes: imageBytes,
            language: 'ja',
            pageIndex: 0,
        }),
    ];
    const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0);
    return deepFreeze({
        contractVersion: DSF_HORIZON_RELEASE_CONTRACT_VERSION,
        contractKind: DSF_HORIZON_RELEASE_PLAN_KIND,
        readyForUpload: true,
        readyForMetadataWrite: false,
        identity: { uid: UID, workId: WORK_ID, releaseId: RELEASE_ID },
        publicOrigin: PUBLIC_ORIGIN,
        releaseRootPath: ROOT_PATH,
        files,
        candidate: {
            dsfSchemaVersion: 2,
            dsfContentUrl: files[0].publicUrl,
            dsfContentHash: files[0].sha256,
            dsfLangs: ['ja'],
            dsfPageCounts: { ja: 1 },
            dsfTotalBytes: totalBytes,
            defaultLang: 'ja',
            pageCount: 1,
        },
        summary: {
            fileCount: files.length,
            jsonFileCount: 2,
            imageFileCount: 1,
            externalFontCount: 0,
            totalBytes,
        },
    });
}

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

async function readUploadCall(url, options, plan) {
    assert.equal(url, DSF_HORIZON_RELEASE_UPLOAD_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body instanceof FormData, true);
    assert.equal(typeof options.headers.Authorization, 'string');
    const storagePath = options.body.get('path');
    const file = plan.files.find((entry) => entry.storagePath === storagePath);
    assert.ok(file, `unexpected upload path: ${storagePath}`);
    const blob = options.body.get('file');
    assert.equal(blob instanceof Blob, true);
    assert.equal(blob.type, file.mimeType);
    assert.equal(blob.size, file.byteLength);
    assert.equal(options.body.get('mimeType'), file.mimeType);
    assert.equal(options.body.get('byteLength'), String(file.byteLength));
    assert.equal(options.body.get('sha256'), file.sha256);
    assert.equal(await hashBlob(blob), file.sha256);
    return { file, blob };
}

function createMockFetch(plan, handler = null) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const upload = await readUploadCall(url, options, plan);
        const call = { url, options, ...upload, index: calls.length };
        calls.push(call);
        if (handler) {
            const handled = await handler(call, calls);
            if (handled) return handled;
        }
        return Response.json({ receipt: exactReceipt(call.file), reused: false });
    };
    return { calls, fetchImpl };
}

function createInput(plan, transport, overrides = {}) {
    let tokenCalls = 0;
    let imageResolutionCalls = 0;
    return {
        input: {
            plan,
            resolveImageBlob: async () => {
                imageResolutionCalls += 1;
                return imageBlob;
            },
            getAccessToken: async () => {
                tokenCalls += 1;
                return `token-${tokenCalls}`;
            },
            fetchImpl: transport.fetchImpl,
            hashBytes: hashBlob,
            ...overrides,
        },
        counts: {
            get tokenCalls() { return tokenCalls; },
            get imageResolutionCalls() { return imageResolutionCalls; },
        },
    };
}

function assertUploadError(error, issueCode, completedCount, fileIndex) {
    assert.equal(error instanceof DsfHorizonReleaseUploadError, true);
    assert.equal(error.code, 'DSF_HORIZON_RELEASE_UPLOAD_FAILED');
    assert.equal(error.issues[0].code, issueCode);
    assert.equal(error.completedReceipts.length, completedCount);
    assert.equal(error.fileIndex, fileIndex);
    assert.equal(Object.isFrozen(error.issues), true);
    assert.equal(Object.isFrozen(error.completedReceipts), true);
    return true;
}

const plan = createPlan();
const planSnapshot = structuredClone(plan);

{
    const transport = createMockFetch(plan, (call) => (
        call.index === 1
            ? Response.json({ receipt: exactReceipt(call.file), reused: true })
            : null
    ));
    const progress = [];
    const { input, counts } = createInput(plan, transport, {
        onProgress(value) { progress.push(value); },
    });
    const result = await uploadDsfHorizonReleasePlan(input);

    assert.equal(result.uploadVersion, DSF_HORIZON_RELEASE_UPLOAD_VERSION);
    assert.equal(result.uploadKind, DSF_HORIZON_RELEASE_UPLOAD_KIND);
    assert.equal(result.readyForMetadataWrite, true);
    assert.equal(result.seal.readyForMetadataWrite, true);
    assert.deepEqual(result.receipts, plan.files.map(exactReceipt));
    assert.deepEqual(result.summary, {
        fileCount: 3,
        totalBytes: plan.summary.totalBytes,
        uploadedObjectCount: 2,
        reusedObjectCount: 1,
    });
    assert.equal(transport.calls.length, 3);
    assert.equal(counts.tokenCalls, 3, 'a fresh cached Firebase token may be requested for each file');
    assert.equal(counts.imageResolutionCalls, 1, 'JSON bytes come from the plan and only WebP uses the resolver');
    assert.equal(transport.calls[0].options.headers.Authorization, 'Bearer token-1');
    assert.equal(transport.calls[2].options.headers.Authorization, 'Bearer token-3');
    assert.equal(progress.length, plan.files.length * 2);
    assert.deepEqual(progress.map((value) => value.phase), [
        'uploading', 'uploaded', 'uploading', 'uploaded', 'uploading', 'uploaded',
    ]);
    assert.equal(progress.at(-1).completedFileCount, plan.files.length);
    assert.equal(progress[0].completedBytes, 0);
    let confirmedBytes = 0;
    for (let i = 0; i < plan.files.length; i++) {
        assert.equal(progress[i * 2].completedBytes, confirmedBytes);
        confirmedBytes += plan.files[i].byteLength;
        assert.equal(progress[i * 2 + 1].completedBytes, confirmedBytes);
        assert.equal(progress[i * 2 + 1].totalBytes, plan.summary.totalBytes);
    }
    assert.equal(confirmedBytes, plan.summary.totalBytes);

    assert.equal(Object.isFrozen(progress.at(-1)), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.receipts), true);
    assert.deepEqual(structuredClone(plan), planSnapshot, 'upload transport cannot mutate the immutable plan');
}

{
    const mutablePlan = structuredClone(plan);
    mutablePlan.files[0].json = contentJson.replace('ja', 'en');
    const transport = createMockFetch(mutablePlan);
    const { input } = createInput(mutablePlan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_BLOB_HASH_MISMATCH', 0, 0),
    );
    assert.equal(transport.calls.length, 0, 'changed canonical JSON must fail before the first request');
}

{
    const transport = createMockFetch(plan);
    const changedImageBytes = new Uint8Array(imageBytes);
    changedImageBytes[15] ^= 0x01;
    const { input } = createInput(plan, transport, {
        resolveImageBlob: async () => new Blob([changedImageBytes], { type: 'image/webp' }),
    });
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_BLOB_HASH_MISMATCH', 2, 2),
    );
    assert.equal(transport.calls.length, 2, 'changed image bytes must not reach the endpoint');
}

{
    const mutablePlan = structuredClone(plan);
    mutablePlan.summary.totalBytes += 1;
    const transport = createMockFetch(mutablePlan);
    const { input } = createInput(mutablePlan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_SUMMARY_INVALID', 0, null),
    );
    assert.equal(transport.calls.length, 0, 'stale plan summary must fail before upload');
}

{
    const transport = createMockFetch(plan, (call) => {
        if (call.index !== 1) return null;
        return Response.json(
            { code: 'STORAGE_WRITE_FAILED', error: 'Release storage did not confirm the uploaded object.' },
            { status: 503 },
        );
    });
    const { input } = createInput(plan, transport);
    let firstError;
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => {
            firstError = error;
            assert.equal(error.issues[0].status, 503);
            assert.equal(error.issues[0].remoteCode, 'STORAGE_WRITE_FAILED');
            return assertUploadError(error, 'HORIZON_UPLOAD_HTTP_FAILED', 1, 1);
        },
    );
    assert.equal(transport.calls.length, 2, 'partial failure must stop before later files');
    assert.deepEqual(firstError.completedReceipts, [exactReceipt(plan.files[0])]);

    const retryTransport = createMockFetch(plan, (call) => (
        call.index === 0
            ? Response.json({ receipt: exactReceipt(call.file), reused: true })
            : null
    ));
    const retry = createInput(plan, retryTransport);
    const retryResult = await uploadDsfHorizonReleasePlan(retry.input);
    assert.equal(retryTransport.calls.length, 3, 'safe retry rechecks the complete immutable file set');
    assert.equal(retryResult.summary.reusedObjectCount, 1);
    assert.equal(retryResult.readyForMetadataWrite, true);
}

{
    const transport = createMockFetch(plan, (call) => {
        if (call.index !== 1) return null;
        return Response.json({
            receipt: { ...exactReceipt(call.file), sha256: 'f'.repeat(64) },
            reused: false,
        });
    });
    const { input } = createInput(plan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_RECEIPT_MISMATCH', 1, 1),
    );
    assert.equal(transport.calls.length, 2, 'mismatched receipt must stop the upload set');
}

{
    const transport = createMockFetch(plan, (call) => {
        if (call.index !== 0) return null;
        return Response.json({
            receipt: exactReceipt(call.file),
            reused: false,
            unexpected: true,
        });
    });
    const { input } = createInput(plan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_RECEIPT_INVALID', 0, 0),
    );
    assert.equal(transport.calls.length, 1);
}

{
    const transport = createMockFetch(plan, (call) => (
        call.index === 1
            ? new Response('<html>gateway error</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
            : null
    ));
    const { input } = createInput(plan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_RESPONSE_INVALID', 1, 1),
    );
}

{
    const transport = createMockFetch(plan, (call) => {
        if (call.index === 1) throw new TypeError('synthetic network failure');
        return null;
    });
    const { input } = createInput(plan, transport);
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_REQUEST_FAILED', 1, 1),
    );
    assert.equal(transport.calls.length, 2);
}

{
    const transport = createMockFetch(plan);
    let tokenCalls = 0;
    const { input } = createInput(plan, transport, {
        getAccessToken: async () => {
            tokenCalls += 1;
            return tokenCalls === 2 ? '' : 'token';
        },
    });
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_TOKEN_INVALID', 1, 1),
    );
    assert.equal(transport.calls.length, 1, 'missing refreshed token must fail before the next request');
}

{
    const controller = new AbortController();
    const transport = createMockFetch(plan, (call) => {
        if (call.index === 0) controller.abort();
        return null;
    });
    const { input } = createInput(plan, transport, { signal: controller.signal });
    await assert.rejects(
        () => uploadDsfHorizonReleasePlan(input),
        (error) => assertUploadError(error, 'HORIZON_UPLOAD_ABORTED', 1, 0),
    );
    assert.equal(transport.calls.length, 1, 'aborted upload must not start another file');
}

for (const relativePath of ['../js/press.js', '../js/firebase.js', '../js/viewer.js']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /dsf-horizon-release-upload|uploadDsfHorizonReleasePlan/,
        `${relativePath} must not connect the isolated client transport unit`);
}

const moduleSource = readFileSync(new URL('../js/dsf-horizon-release-upload.js', import.meta.url), 'utf8').toLowerCase();
for (const forbidden of ["from './firebase", 'firebase/firestore', 'setdoc(', 'uploadpresspage', "from './press", "from './viewer"]) {
    assert.equal(moduleSource.includes(forbidden), false, `release upload transport must not include ${forbidden}`);
}

console.log('DSF Horizon v2 release upload client transport verification passed.');
