import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DSF_HORIZON_IMMUTABLE_CACHE_CONTROL } from '../js/dsf-horizon-release-contract.js';
import {
    DSF_RELEASE_UPLOAD_CACHE_CONTROL,
    handleDsfReleaseUpload,
    onRequestOptions,
} from '../functions/upload-release.js';

const PUBLIC_BASE_URL = 'https://media.dsf.ink';
const UID = 'reader_owner_1';
const ROOT_PATH = `users/${UID}/dsf/work_horizon_v2/rel_horizon_v2_1`;
const encoder = new TextEncoder();

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function cloneStoredObject(object) {
    if (!object) return null;
    return {
        key: object.key,
        size: object.size,
        httpMetadata: { ...object.httpMetadata },
        customMetadata: { ...object.customMetadata },
    };
}

class MockR2Bucket {
    constructor() {
        this.objects = new Map();
        this.headCalls = [];
        this.putCalls = [];
        this.raceObjectFactory = null;
        this.returnMismatchedPutObject = false;
    }

    seed(key, object) {
        this.objects.set(key, cloneStoredObject({ key, ...object }));
    }

    async head(key) {
        this.headCalls.push(key);
        return cloneStoredObject(this.objects.get(key));
    }

    async put(key, buffer, options) {
        this.putCalls.push({ key, buffer, options });
        assert.equal(options.onlyIf instanceof Headers, true, 'R2 create-only condition must use conditional headers');
        assert.equal(options.onlyIf.get('If-None-Match'), '*', 'release uploads must never overwrite an object');
        if (this.raceObjectFactory) {
            this.objects.set(key, cloneStoredObject(this.raceObjectFactory(key, buffer, options)));
            return null;
        }
        if (this.objects.has(key)) return null;
        const stored = {
            key,
            size: buffer.byteLength,
            httpMetadata: { ...options.httpMetadata },
            customMetadata: { ...options.customMetadata },
        };
        this.objects.set(key, cloneStoredObject(stored));
        if (this.returnMismatchedPutObject) {
            this.objects.delete(key);
            return { ...cloneStoredObject(stored), size: stored.size + 1 };
        }
        return cloneStoredObject(stored);
    }
}

function createEnvironment(bucket = new MockR2Bucket(), overrides = {}) {
    return {
        FIREBASE_PROJECT_ID: 'vmnn-26345',
        R2_BUCKET: bucket,
        R2_PUBLIC_URL: PUBLIC_BASE_URL,
        ...overrides,
    };
}

function createRequest({
    bytes,
    storagePath,
    mimeType,
    declaredMimeType = mimeType,
    declaredByteLength = bytes.byteLength,
    declaredSha256 = sha256(bytes),
    authorization = 'Bearer synthetic-token',
    omit = [],
}) {
    const form = new FormData();
    if (!omit.includes('file')) form.append('file', new Blob([bytes], { type: mimeType }), storagePath.split('/').at(-1));
    if (!omit.includes('path')) form.append('path', storagePath);
    if (!omit.includes('mimeType')) form.append('mimeType', declaredMimeType);
    if (!omit.includes('byteLength')) form.append('byteLength', String(declaredByteLength));
    if (!omit.includes('sha256')) form.append('sha256', declaredSha256);
    const headers = {};
    if (authorization !== null) headers.Authorization = authorization;
    return new Request('https://studio.dsf.ink/upload-release', {
        method: 'POST',
        headers,
        body: form,
    });
}

async function parseResponse(response) {
    return { status: response.status, body: await response.json() };
}

function expectedStoredObject(path, bytes, mimeType) {
    return {
        key: path,
        size: bytes.byteLength,
        httpMetadata: {
            contentType: mimeType,
            cacheControl: DSF_RELEASE_UPLOAD_CACHE_CONTROL,
        },
        customMetadata: {
            dsfSha256: sha256(bytes),
            dsfByteLength: String(bytes.byteLength),
            dsfSchemaVersion: '2',
        },
    };
}

async function invoke(request, env, verifyToken = async () => UID) {
    return handleDsfReleaseUpload({ request, env, verifyToken, cryptoRef: globalThis.crypto });
}

const jsonBytes = encoder.encode(JSON.stringify({ schemaVersion: 2, defaultLang: 'ja' }));
const jsonPath = `${ROOT_PATH}/content.json`;
const languageManifestPath = `${ROOT_PATH}/content/language-0001.json`;
const webpBytes = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const webpPath = `${ROOT_PATH}/assets/images/language-0001/page-00001.webp`;

assert.equal(
    DSF_RELEASE_UPLOAD_CACHE_CONTROL,
    DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
    'endpoint cache metadata must match the Horizon release plan contract',
);

{
    const bucket = new MockR2Bucket();
    const response = await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket),
    );
    const result = await parseResponse(response);
    assert.equal(result.status, 200);
    assert.equal(result.body.reused, false);
    assert.deepEqual(Object.keys(result.body.receipt).sort(), [
        'byteLength', 'cacheControl', 'mimeType', 'publicUrl', 'sha256', 'storagePath',
    ]);
    assert.deepEqual(result.body.receipt, {
        storagePath: jsonPath,
        publicUrl: `${PUBLIC_BASE_URL}/${jsonPath}`,
        mimeType: 'application/json',
        byteLength: jsonBytes.byteLength,
        sha256: sha256(jsonBytes),
        cacheControl: DSF_RELEASE_UPLOAD_CACHE_CONTROL,
    });
    assert.equal(bucket.putCalls.length, 1);
    assert.equal(bucket.putCalls[0].options.sha256, sha256(jsonBytes));
    assert.deepEqual(new Uint8Array(bucket.putCalls[0].buffer), jsonBytes);
    assert.deepEqual(bucket.objects.get(jsonPath), expectedStoredObject(jsonPath, jsonBytes, 'application/json'));
}

{
    const bucket = new MockR2Bucket();
    bucket.seed(jsonPath, expectedStoredObject(jsonPath, jsonBytes, 'application/json'));
    const result = await parseResponse(await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket),
    ));
    assert.equal(result.status, 200);
    assert.equal(result.body.reused, true, 'same immutable object may be retried idempotently');
    assert.equal(bucket.putCalls.length, 0, 'idempotent retry must not rewrite R2');
}

{
    const bucket = new MockR2Bucket();
    bucket.seed(jsonPath, {
        ...expectedStoredObject(jsonPath, jsonBytes, 'application/json'),
        customMetadata: {
            ...expectedStoredObject(jsonPath, jsonBytes, 'application/json').customMetadata,
            dsfSha256: 'f'.repeat(64),
        },
    });
    const result = await parseResponse(await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket),
    ));
    assert.deepEqual(result, {
        status: 409,
        body: {
            code: 'IMMUTABLE_COLLISION',
            error: 'An immutable release object already exists with different bytes or metadata.',
        },
    });
    assert.equal(bucket.putCalls.length, 0, 'immutable collision must not overwrite R2');
}

{
    const bucket = new MockR2Bucket();
    bucket.raceObjectFactory = (key, buffer, options) => ({
        key,
        size: buffer.byteLength,
        httpMetadata: { ...options.httpMetadata },
        customMetadata: { ...options.customMetadata },
    });
    const result = await parseResponse(await invoke(
        createRequest({ bytes: webpBytes, storagePath: webpPath, mimeType: 'image/webp' }),
        createEnvironment(bucket),
    ));
    assert.equal(result.status, 200);
    assert.equal(result.body.reused, true, 'matching concurrent create is an idempotent retry');
    assert.equal(bucket.putCalls.length, 1);
    assert.equal(bucket.headCalls.length, 2, 'conditional race must be verified by a second R2 HEAD');
}

{
    const bucket = new MockR2Bucket();
    bucket.returnMismatchedPutObject = true;
    const result = await parseResponse(await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket),
    ));
    assert.equal(result.status, 502);
    assert.equal(result.body.code, 'STORAGE_WRITE_FAILED');
}

const rejectedCases = [
    {
        name: 'missing auth',
        request: createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json', authorization: null }),
        status: 401,
        code: 'AUTH_REQUIRED',
    },
    {
        name: 'wrong uid',
        request: createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        verifyToken: async () => 'another_user',
        status: 403,
        code: 'PATH_FORBIDDEN',
    },
    {
        name: 'path traversal',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: `users/${UID}/dsf/work_horizon_v2/rel_horizon_v2_1/../content.json`,
            mimeType: 'application/json',
        }),
        status: 400,
        code: 'PATH_INVALID',
    },
    {
        name: 'arbitrary authoring asset path',
        request: createRequest({
            bytes: webpBytes,
            storagePath: `users/${UID}/dsf/work_horizon_v2/cover.webp`,
            mimeType: 'image/webp',
        }),
        status: 400,
        code: 'PATH_INVALID',
    },
    {
        name: 'declared MIME mismatch',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: languageManifestPath,
            mimeType: 'application/json',
            declaredMimeType: 'image/webp',
        }),
        status: 415,
        code: 'MIME_INVALID',
    },
    {
        name: 'file MIME mismatch',
        request: createRequest({ bytes: webpBytes, storagePath: webpPath, mimeType: 'application/octet-stream' }),
        status: 415,
        code: 'MIME_INVALID',
    },
    {
        name: 'invalid hash syntax',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: jsonPath,
            mimeType: 'application/json',
            declaredSha256: sha256(jsonBytes).toUpperCase(),
        }),
        status: 400,
        code: 'HASH_INVALID',
    },
    {
        name: 'hash mismatch',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: jsonPath,
            mimeType: 'application/json',
            declaredSha256: 'a'.repeat(64),
        }),
        status: 422,
        code: 'HASH_MISMATCH',
    },
    {
        name: 'byte length mismatch',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: jsonPath,
            mimeType: 'application/json',
            declaredByteLength: jsonBytes.byteLength + 1,
        }),
        status: 413,
        code: 'SIZE_INVALID',
    },
    {
        name: 'invalid JSON',
        request: createRequest({
            bytes: encoder.encode('{not-json'),
            storagePath: jsonPath,
            mimeType: 'application/json',
        }),
        status: 415,
        code: 'JSON_INVALID',
    },
    {
        name: 'non-object JSON',
        request: createRequest({
            bytes: encoder.encode('[]'),
            storagePath: jsonPath,
            mimeType: 'application/json',
        }),
        status: 415,
        code: 'JSON_INVALID',
    },
    {
        name: 'invalid WebP',
        request: createRequest({
            bytes: encoder.encode('not-a-webp'),
            storagePath: webpPath,
            mimeType: 'image/webp',
        }),
        status: 415,
        code: 'WEBP_INVALID',
    },
    {
        name: 'missing required field',
        request: createRequest({
            bytes: jsonBytes,
            storagePath: jsonPath,
            mimeType: 'application/json',
            omit: ['sha256'],
        }),
        status: 400,
        code: 'REQUEST_FIELD_MISSING',
    },
];

for (const testCase of rejectedCases) {
    const bucket = new MockR2Bucket();
    const result = await parseResponse(await invoke(
        testCase.request,
        createEnvironment(bucket),
        testCase.verifyToken || (async () => UID),
    ));
    assert.equal(result.status, testCase.status, testCase.name);
    assert.equal(result.body.code, testCase.code, testCase.name);
    assert.equal(bucket.headCalls.length, 0, `${testCase.name} must fail before R2 HEAD`);
    assert.equal(bucket.putCalls.length, 0, `${testCase.name} must fail before R2 PUT`);
}

{
    const bucket = new MockR2Bucket();
    const result = await parseResponse(await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket, { R2_BUCKET: null }),
    ));
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'CONFIG_R2_MISSING');
    assert.equal(bucket.headCalls.length, 0);
}

{
    const bucket = new MockR2Bucket();
    const result = await parseResponse(await invoke(
        createRequest({ bytes: jsonBytes, storagePath: jsonPath, mimeType: 'application/json' }),
        createEnvironment(bucket, { R2_PUBLIC_URL: 'http://media.dsf.ink/releases' }),
    ));
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'CONFIG_PUBLIC_URL_INVALID');
    assert.equal(bucket.headCalls.length, 0);
}

{
    const response = await onRequestOptions();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
}

const legacyUploadSource = readFileSync(new URL('../functions/upload.js', import.meta.url), 'utf8');
assert.match(legacyUploadSource, /POST \/upload\b/);
assert.match(legacyUploadSource, /Response\.json\(\{ url: publicUrl \}/);
assert.doesNotMatch(legacyUploadSource, /upload-release/,
    'legacy authoring image upload must remain separate from the release endpoint');

for (const relativePath of ['../js/press.js', '../js/firebase.js', '../js/viewer.js']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /upload-release/,
        `${relativePath} must not connect the new endpoint in the isolated backend unit`);
}

console.log('DSF release upload endpoint verification passed.');
