/**
 * Browser-side Horizon DSF v2 release upload transport.
 *
 * Uploads an already-verified immutable Horizon plan one file at a time to
 * /upload-release, validates every exact receipt, and returns the pure release
 * seal only after the complete file set succeeds. This module has no Firebase,
 * Press UI, Firestore, Viewer, or deployment side effects.
 */

import {
    DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
    DSF_HORIZON_RELEASE_CONTRACT_VERSION,
    DSF_HORIZON_RELEASE_PLAN_KIND,
    sealDsfHorizonReleasePlan,
} from './dsf-horizon-release-contract.js';
import { sha256DsfBytes } from './dsf-release-byte-sealing.js';

export const DSF_HORIZON_RELEASE_UPLOAD_VERSION = 1;
export const DSF_HORIZON_RELEASE_UPLOAD_KIND = 'horizon-v2-release-upload';
export const DSF_HORIZON_RELEASE_UPLOAD_ENDPOINT = '/upload-release';

const JSON_MIME_TYPE = 'application/json';
const WEBP_MIME_TYPE = 'image/webp';
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_WEBP_BYTES = 64 * 1024 * 1024;
const MAX_RELEASE_FILES = 20_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONTENT_PATH_PATTERN = /^content\.json$/;
const LANGUAGE_MANIFEST_PATH_PATTERN = /^content\/language-\d{4}\.json$/;
const IMAGE_PATH_PATTERN = /^assets\/images\/language-\d{4}\/page-\d{5}\.webp$/;
const REMOTE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const INPUT_KEYS = new Set([
    'plan',
    'resolveImageBlob',
    'getAccessToken',
    'fetchImpl',
    'hashBytes',
    'signal',
    'onProgress',
]);
const RESPONSE_KEYS = new Set(['receipt', 'reused']);
const RECEIPT_KEYS = new Set([
    'storagePath',
    'publicUrl',
    'mimeType',
    'byteLength',
    'sha256',
    'cacheControl',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function hasExactKeys(value, keys) {
    return isRecord(value)
        && Object.keys(value).length === keys.size
        && Object.keys(value).every((key) => keys.has(key));
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}, context = {}) {
    throw new DsfHorizonReleaseUploadError(
        [createIssue(code, path, message, details)],
        context,
    );
}

function copyReceipts(receipts) {
    return receipts.map((receipt) => ({ ...receipt }));
}

function uploadContext(receipts, file, fileIndex) {
    return {
        completedReceipts: copyReceipts(receipts),
        storagePath: file?.storagePath || null,
        fileIndex: Number.isInteger(fileIndex) ? fileIndex : null,
    };
}

function throwIfAborted(signal, receipts, file, fileIndex) {
    if (!signal?.aborted) return;
    fail(
        'HORIZON_UPLOAD_ABORTED',
        Number.isInteger(fileIndex) ? `plan.files[${fileIndex}]` : 'signal',
        'Horizon release upload was cancelled.',
        {},
        uploadContext(receipts, file, fileIndex),
    );
}

function parsePublicOrigin(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:'
        || url.username
        || url.password
        || url.search
        || url.hash
        || url.pathname !== '/'
        || url.origin !== value) {
        return null;
    }
    return url.origin;
}

function validatePlanFile(file, index, plan) {
    const path = `plan.files[${index}]`;
    if (!isRecord(file)) fail('HORIZON_UPLOAD_FILE_INVALID', path, 'Planned release file is invalid.');
    if (typeof file.relativePath !== 'string'
        || typeof file.storagePath !== 'string'
        || typeof file.publicUrl !== 'string'
        || typeof file.role !== 'string') {
        fail('HORIZON_UPLOAD_FILE_INVALID', path, 'Planned release file identity is incomplete.');
    }

    let expectedMimeType = null;
    let requiresJson = false;
    if (file.role === 'content-index' && CONTENT_PATH_PATTERN.test(file.relativePath)) {
        expectedMimeType = JSON_MIME_TYPE;
        requiresJson = true;
    } else if (file.role === 'language-manifest' && LANGUAGE_MANIFEST_PATH_PATTERN.test(file.relativePath)) {
        expectedMimeType = JSON_MIME_TYPE;
        requiresJson = true;
    } else if (file.role === 'image' && IMAGE_PATH_PATTERN.test(file.relativePath)) {
        expectedMimeType = WEBP_MIME_TYPE;
    }
    if (!expectedMimeType || file.mimeType !== expectedMimeType) {
        fail('HORIZON_UPLOAD_FILE_PATH_INVALID', `${path}.relativePath`, 'Planned release file path or MIME type is not uploadable.');
    }
    if (requiresJson && typeof file.json !== 'string') {
        fail('HORIZON_UPLOAD_JSON_SOURCE_MISSING', `${path}.json`, 'Planned JSON file has no canonical source string.');
    }
    if (!requiresJson && Object.prototype.hasOwnProperty.call(file, 'json')) {
        fail('HORIZON_UPLOAD_IMAGE_SOURCE_INVALID', `${path}.json`, 'Planned image file cannot contain JSON source text.');
    }

    const expectedStoragePath = `${plan.releaseRootPath}/${file.relativePath}`;
    const expectedPublicUrl = new URL(file.storagePath, `${plan.publicOrigin}/`).href;
    if (file.storagePath !== expectedStoragePath
        || file.publicUrl !== expectedPublicUrl
        || file.cacheControl !== DSF_HORIZON_IMMUTABLE_CACHE_CONTROL) {
        fail('HORIZON_UPLOAD_FILE_LOCATION_INVALID', path, 'Planned release file location or cache policy changed.');
    }
    const maximumBytes = expectedMimeType === JSON_MIME_TYPE ? MAX_JSON_BYTES : MAX_WEBP_BYTES;
    if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > maximumBytes) {
        fail('HORIZON_UPLOAD_FILE_SIZE_INVALID', `${path}.byteLength`, 'Planned release file exceeds the upload transport limit.');
    }
    if (!SHA256_PATTERN.test(file.sha256)) {
        fail('HORIZON_UPLOAD_FILE_HASH_INVALID', `${path}.sha256`, 'Planned release file hash is invalid.');
    }
}

function validateInput(input) {
    if (!isRecord(input)) fail('HORIZON_UPLOAD_INPUT_INVALID', '', 'Horizon release upload requires an input object.');
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) fail('HORIZON_UPLOAD_PROPERTY_UNSUPPORTED', key, 'Horizon release upload input contains an unsupported property.');
    }
    const plan = input.plan;
    if (!isRecord(plan)
        || plan.contractVersion !== DSF_HORIZON_RELEASE_CONTRACT_VERSION
        || plan.contractKind !== DSF_HORIZON_RELEASE_PLAN_KIND
        || plan.readyForUpload !== true
        || plan.readyForMetadataWrite !== false
        || !isRecord(plan.identity)
        || !isRecord(plan.candidate)
        || !isRecord(plan.summary)
        || !Array.isArray(plan.files)
        || plan.files.length < 2
        || plan.files.length > MAX_RELEASE_FILES) {
        fail('HORIZON_UPLOAD_PLAN_INVALID', 'plan', 'A verified Horizon release upload plan is required.');
    }
    const { uid, workId, releaseId } = plan.identity;
    if (![uid, workId, releaseId].every((value) => typeof value === 'string' && SAFE_ID_PATTERN.test(value))) {
        fail('HORIZON_UPLOAD_IDENTITY_INVALID', 'plan.identity', 'Horizon release identity is invalid.');
    }
    const expectedRoot = `users/${uid}/dsf/${workId}/${releaseId}`;
    if (plan.releaseRootPath !== expectedRoot || !parsePublicOrigin(plan.publicOrigin)) {
        fail('HORIZON_UPLOAD_ROOT_INVALID', 'plan.releaseRootPath', 'Horizon release root or public origin is invalid.');
    }
    const plannedTotalBytes = plan.files.reduce((sum, file) => sum + (Number.isSafeInteger(file?.byteLength) ? file.byteLength : 0), 0);
    if (plan.summary.fileCount !== plan.files.length || plan.summary.totalBytes !== plannedTotalBytes) {
        fail('HORIZON_UPLOAD_SUMMARY_INVALID', 'plan.summary', 'Horizon release file count or byte total is stale.');
    }
    const paths = new Set();
    plan.files.forEach((file, index) => {
        validatePlanFile(file, index, plan);
        const portablePath = file.storagePath.toLowerCase();
        if (paths.has(portablePath)) {
            fail('HORIZON_UPLOAD_FILE_DUPLICATE', `plan.files[${index}].storagePath`, 'Horizon release upload paths collide.');
        }
        paths.add(portablePath);
    });

    if (typeof input.getAccessToken !== 'function') {
        fail('HORIZON_UPLOAD_TOKEN_PROVIDER_INVALID', 'getAccessToken', 'An access-token provider is required.');
    }
    const imageFileCount = plan.files.filter((file) => file.mimeType === WEBP_MIME_TYPE).length;
    if (imageFileCount > 0 && typeof input.resolveImageBlob !== 'function') {
        fail('HORIZON_UPLOAD_IMAGE_RESOLVER_REQUIRED', 'resolveImageBlob', 'An exact image Blob resolver is required.');
    }
    if (input.resolveImageBlob !== undefined && typeof input.resolveImageBlob !== 'function') {
        fail('HORIZON_UPLOAD_IMAGE_RESOLVER_INVALID', 'resolveImageBlob', 'Image Blob resolver must be a function.');
    }
    const fetchImpl = input.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        fail('HORIZON_UPLOAD_FETCH_UNAVAILABLE', 'fetchImpl', 'Fetch is unavailable for Horizon release upload.');
    }
    if (input.hashBytes !== undefined && typeof input.hashBytes !== 'function') {
        fail('HORIZON_UPLOAD_HASHER_INVALID', 'hashBytes', 'hashBytes must be a function when supplied.');
    }
    if (input.signal !== undefined
        && (!isRecord(input.signal) || typeof input.signal.aborted !== 'boolean')) {
        fail('HORIZON_UPLOAD_SIGNAL_INVALID', 'signal', 'signal must be an AbortSignal when supplied.');
    }
    if (input.onProgress !== undefined && typeof input.onProgress !== 'function') {
        fail('HORIZON_UPLOAD_PROGRESS_INVALID', 'onProgress', 'onProgress must be a function when supplied.');
    }
}

function emitProgress(input, progress) {
    if (typeof input.onProgress !== 'function') return;
    try {
        input.onProgress(Object.freeze({ ...progress }));
    } catch (_) {
        // Progress reporting must never alter upload correctness.
    }
}

function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

async function createPlannedBlob(file, index, input, receipts) {
    let blob;
    if (file.mimeType === JSON_MIME_TYPE) {
        blob = new Blob([file.json], { type: JSON_MIME_TYPE });
    } else {
        try {
            blob = await input.resolveImageBlob(file);
        } catch (cause) {
            if (input.signal?.aborted || cause?.name === 'AbortError') {
                throwIfAborted({ aborted: true }, receipts, file, index);
            }
            fail(
                'HORIZON_UPLOAD_IMAGE_RESOLUTION_FAILED',
                `plan.files[${index}]`,
                'Planned image Blob could not be resolved.',
                { cause: cause?.message || String(cause) },
                uploadContext(receipts, file, index),
            );
        }
    }
    if (!isBlob(blob)
        || blob.type !== file.mimeType
        || blob.size !== file.byteLength) {
        fail(
            'HORIZON_UPLOAD_BLOB_MISMATCH',
            `plan.files[${index}]`,
            'Upload Blob does not match the planned MIME type and byte length.',
            {},
            uploadContext(receipts, file, index),
        );
    }
    throwIfAborted(input.signal, receipts, file, index);

    let actualSha256;
    try {
        actualSha256 = await (input.hashBytes || sha256DsfBytes)(blob);
    } catch (cause) {
        if (input.signal?.aborted || cause?.name === 'AbortError') {
            throwIfAborted({ aborted: true }, receipts, file, index);
        }
        fail(
            'HORIZON_UPLOAD_BLOB_HASH_FAILED',
            `plan.files[${index}].sha256`,
            'Upload Blob SHA-256 could not be calculated.',
            { cause: cause?.message || String(cause) },
            uploadContext(receipts, file, index),
        );
    }
    if (actualSha256 !== file.sha256) {
        fail(
            'HORIZON_UPLOAD_BLOB_HASH_MISMATCH',
            `plan.files[${index}].sha256`,
            'Upload Blob bytes do not match the immutable Horizon plan.',
            {},
            uploadContext(receipts, file, index),
        );
    }
    return blob;
}

async function getToken(input, receipts, file, index) {
    let token;
    try {
        token = await input.getAccessToken();
    } catch (cause) {
        if (input.signal?.aborted || cause?.name === 'AbortError') {
            throwIfAborted({ aborted: true }, receipts, file, index);
        }
        fail(
            'HORIZON_UPLOAD_TOKEN_FAILED',
            'getAccessToken',
            'Horizon release access token could not be acquired.',
            { cause: cause?.message || String(cause) },
            uploadContext(receipts, file, index),
        );
    }
    if (typeof token !== 'string'
        || token !== token.trim()
        || token.length < 1
        || token.length > 8192
        || /[\u0000-\u001f\u007f]/u.test(token)) {
        fail(
            'HORIZON_UPLOAD_TOKEN_INVALID',
            'getAccessToken',
            'Horizon release access token is invalid.',
            {},
            uploadContext(receipts, file, index),
        );
    }
    return token;
}

async function parseResponseJson(response, receipts, file, index) {
    const contentType = String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json' || typeof response?.json !== 'function') {
        fail(
            'HORIZON_UPLOAD_RESPONSE_INVALID',
            `responses[${index}]`,
            'Horizon release upload response must be JSON.',
            { status: response?.status ?? null },
            uploadContext(receipts, file, index),
        );
    }
    try {
        return await response.json();
    } catch {
        fail(
            'HORIZON_UPLOAD_RESPONSE_INVALID',
            `responses[${index}]`,
            'Horizon release upload response JSON is invalid.',
            { status: response?.status ?? null },
            uploadContext(receipts, file, index),
        );
    }
}

function validateReceiptResponse(body, file, index, receipts) {
    const context = uploadContext(receipts, file, index);
    if (!hasExactKeys(body, RESPONSE_KEYS) || typeof body.reused !== 'boolean' || !hasExactKeys(body.receipt, RECEIPT_KEYS)) {
        fail('HORIZON_UPLOAD_RECEIPT_INVALID', `responses[${index}]`, 'Horizon release upload receipt shape is invalid.', {}, context);
    }
    for (const key of RECEIPT_KEYS) {
        if (body.receipt[key] !== file[key]) {
            fail(
                'HORIZON_UPLOAD_RECEIPT_MISMATCH',
                `responses[${index}].receipt.${key}`,
                'Horizon release upload receipt does not match the immutable plan.',
                {},
                context,
            );
        }
    }
    return { receipt: { ...body.receipt }, reused: body.reused };
}

export class DsfHorizonReleaseUploadError extends Error {
    constructor(issues, context = {}) {
        super(issues?.[0]?.message || 'Horizon DSF v2 release upload failed.');
        this.name = 'DsfHorizonReleaseUploadError';
        this.code = 'DSF_HORIZON_RELEASE_UPLOAD_FAILED';
        this.issues = deepFreeze(Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : []);
        this.completedReceipts = deepFreeze(copyReceipts(context.completedReceipts || []));
        this.storagePath = context.storagePath || null;
        this.fileIndex = Number.isInteger(context.fileIndex) ? context.fileIndex : null;
    }
}

/**
 * Sequentially upload a Horizon plan and return a publishable pure seal.
 * A failed run never returns a seal; rerunning the complete plan is safe
 * because /upload-release treats exact existing objects as idempotent retries.
 */
export async function uploadDsfHorizonReleasePlan(input = {}) {
    validateInput(input);
    const fetchImpl = input.fetchImpl || globalThis.fetch;
    const receipts = [];
    let reusedObjectCount = 0;

    for (const [index, file] of input.plan.files.entries()) {
        throwIfAborted(input.signal, receipts, file, index);
        emitProgress(input, {
            phase: 'uploading',
            fileIndex: index,
            fileCount: input.plan.files.length,
            completedFileCount: receipts.length,
            storagePath: file.storagePath,
        });
        const blob = await createPlannedBlob(file, index, input, receipts);
        throwIfAborted(input.signal, receipts, file, index);
        const token = await getToken(input, receipts, file, index);
        throwIfAborted(input.signal, receipts, file, index);

        const formData = new FormData();
        formData.append('file', blob, file.relativePath.split('/').at(-1));
        formData.append('path', file.storagePath);
        formData.append('mimeType', file.mimeType);
        formData.append('byteLength', String(file.byteLength));
        formData.append('sha256', file.sha256);

        let response;
        try {
            response = await fetchImpl(DSF_HORIZON_RELEASE_UPLOAD_ENDPOINT, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
                credentials: 'same-origin',
                cache: 'no-store',
                redirect: 'error',
                signal: input.signal,
            });
        } catch (cause) {
            if (input.signal?.aborted || cause?.name === 'AbortError') {
                throwIfAborted({ aborted: true }, receipts, file, index);
            }
            fail(
                'HORIZON_UPLOAD_REQUEST_FAILED',
                `requests[${index}]`,
                'Horizon release upload request failed.',
                { cause: cause?.message || String(cause) },
                uploadContext(receipts, file, index),
            );
        }
        const body = await parseResponseJson(response, receipts, file, index);
        if (response.status !== 200 || response.ok !== true) {
            const remoteCode = typeof body?.code === 'string' && REMOTE_ERROR_CODE_PATTERN.test(body.code)
                ? body.code
                : null;
            fail(
                'HORIZON_UPLOAD_HTTP_FAILED',
                `responses[${index}]`,
                'Horizon release upload endpoint rejected a planned file.',
                { status: response.status, remoteCode },
                uploadContext(receipts, file, index),
            );
        }
        const validated = validateReceiptResponse(body, file, index, receipts);
        receipts.push(validated.receipt);
        if (validated.reused) reusedObjectCount += 1;
        emitProgress(input, {
            phase: 'uploaded',
            fileIndex: index,
            fileCount: input.plan.files.length,
            completedFileCount: receipts.length,
            storagePath: file.storagePath,
            reused: validated.reused,
        });
        throwIfAborted(input.signal, receipts, file, index);
    }

    throwIfAborted(input.signal, receipts, null, null);
    let seal;
    try {
        seal = sealDsfHorizonReleasePlan({ plan: input.plan, receipts });
    } catch (cause) {
        fail(
            'HORIZON_UPLOAD_SEAL_FAILED',
            'receipts',
            'Complete Horizon release receipts failed the publication seal.',
            { causeCode: cause?.code || null },
            { completedReceipts: copyReceipts(receipts) },
        );
    }
    return deepFreeze({
        uploadVersion: DSF_HORIZON_RELEASE_UPLOAD_VERSION,
        uploadKind: DSF_HORIZON_RELEASE_UPLOAD_KIND,
        readyForMetadataWrite: true,
        identity: { ...input.plan.identity },
        receipts: copyReceipts(receipts),
        seal,
        summary: {
            fileCount: input.plan.files.length,
            totalBytes: input.plan.summary.totalBytes,
            uploadedObjectCount: input.plan.files.length - reusedObjectCount,
            reusedObjectCount,
        },
    });
}
