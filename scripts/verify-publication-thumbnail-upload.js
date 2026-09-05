import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    getPublicationThumbnailExpectedSha256,
    handleImageUpload,
    verifyPublicationThumbnailContentAddress,
} from '../functions/upload.js';

const UID = 'owner-publication-thumbnail-1';
const PUBLIC_URL = 'https://media-staging.dsf.ink';
const webpBytes = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const digest = createHash('sha256').update(webpBytes).digest('hex');
const thumbnailPath = `users/${UID}/dsf/publication-thumbnails/${digest}.webp`;

class MockR2Bucket {
    constructor() {
        this.putCalls = [];
    }

    async put(path, buffer, options) {
        this.putCalls.push({ path, bytes: new Uint8Array(buffer), options });
        return { key: path };
    }
}

function createEnvironment(bucket) {
    return {
        FIREBASE_PROJECT_ID: 'vmnn-26345-stg',
        R2_BUCKET: bucket,
        R2_PUBLIC_URL: PUBLIC_URL,
    };
}

function createRequest(path, bytes = webpBytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/webp' }), path.split('/').at(-1));
    form.append('path', path);
    return new Request('https://staging.dsf-studio.pages.dev/upload', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-token' },
        body: form,
    });
}

async function invoke({ path = thumbnailPath, bytes = webpBytes, bucket = new MockR2Bucket(), cryptoRef = webcrypto } = {}) {
    const response = await handleImageUpload({
        request: createRequest(path, bytes),
        env: createEnvironment(bucket),
        verifyToken: async () => UID,
        cryptoRef,
    });
    return { bucket, response, body: await response.json() };
}

assert.equal(getPublicationThumbnailExpectedSha256(thumbnailPath, UID), digest);
assert.equal(
    getPublicationThumbnailExpectedSha256(
        `users/${UID}/dsf/publication-thumbnails/${digest.toUpperCase()}.webp`,
        UID,
    ),
    digest,
    'hex path matching is case-insensitive but comparison is canonical lowercase',
);
assert.equal(getPublicationThumbnailExpectedSha256(`users/${UID}/dsf/publication-thumbnails/cover.webp`, UID), null);
assert.equal(getPublicationThumbnailExpectedSha256(`users/${UID}/dsf/${digest}.webp`, UID), null);
assert.equal(getPublicationThumbnailExpectedSha256(thumbnailPath, 'another-owner'), null);

const matchingAddress = await verifyPublicationThumbnailContentAddress({
    path: thumbnailPath,
    uid: UID,
    buffer: webpBytes,
    cryptoRef: webcrypto,
});
assert.deepEqual(matchingAddress, {
    applies: true,
    matches: true,
    expectedSha256: digest,
    actualSha256: digest,
});

{
    const bucket = new MockR2Bucket();
    const first = await invoke({ bucket });
    const second = await invoke({ bucket });
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200, 'the same bytes may be uploaded again idempotently');
    assert.equal(first.body.url, `${PUBLIC_URL}/${thumbnailPath}`);
    assert.equal(bucket.putCalls.length, 2);
    assert.deepEqual(bucket.putCalls[0].bytes, webpBytes);
    assert.equal(bucket.putCalls[0].options.httpMetadata.contentType, 'image/webp');
}

{
    const mismatchedPath = `users/${UID}/dsf/publication-thumbnails/${'0'.repeat(64)}.webp`;
    const result = await invoke({ path: mismatchedPath });
    assert.equal(result.response.status, 422);
    assert.equal(result.body.error, 'Publication thumbnail bytes do not match the SHA-256 upload path');
    assert.equal(result.bucket.putCalls.length, 0, 'hash mismatch must fail before any R2 write');
}

{
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => loggedErrors.push(args);
    let result;
    try {
        result = await invoke({
            path: thumbnailPath,
            cryptoRef: {},
        });
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(result.response.status, 500, 'missing server SHA-256 support fails closed');
    assert.equal(result.bucket.putCalls.length, 0);
    assert.equal(loggedErrors.length, 1, 'server-side digest failure is logged once');
}

{
    const legacyPath = `users/${UID}/dsf/publication-thumbnails/cover.webp`;
    const result = await invoke({
        path: legacyPath,
        cryptoRef: {},
    });
    assert.equal(result.response.status, 200, 'non-content-addressed legacy upload paths retain their contract');
    assert.equal(result.bucket.putCalls.length, 1);
}

{
    const invalidWebP = new TextEncoder().encode('not-webp');
    const invalidDigest = createHash('sha256').update(invalidWebP).digest('hex');
    const result = await invoke({
        path: `users/${UID}/dsf/publication-thumbnails/${invalidDigest}.webp`,
        bytes: invalidWebP,
    });
    assert.equal(result.response.status, 415);
    assert.equal(result.bucket.putCalls.length, 0);
}

const source = readFileSync(new URL('../functions/upload.js', import.meta.url), 'utf8');
assert.match(source, /PUBLICATION_THUMBNAIL_FILENAME_PATTERN/);
assert.match(source, /subtle\.digest\('SHA-256', buffer\)/);
assert.match(source, /thumbnailAddress\.applies && !thumbnailAddress\.matches/);
assert.equal(source.includes('R2_BUCKET.head'), false, 'legacy upload endpoint still allows same-byte retry writes');

console.log('Publication thumbnail upload hash verification passed.');
