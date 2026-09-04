import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DSF_RELEASE_INVENTORY_DEFAULT_LIMIT,
    DSF_RELEASE_INVENTORY_KIND,
    DSF_RELEASE_INVENTORY_MAX_LIMIT,
    DSF_RELEASE_INVENTORY_VERSION,
    handleDsfReleaseInventory,
    onRequestOptions,
} from '../functions/release-inventory.js';
import {
    DSF_RELEASE_STORAGE_AUDIT_KIND,
    DSF_RELEASE_STORAGE_AUDIT_VERSION,
    DsfReleaseStorageAuditError,
    createDsfReleaseStorageAudit,
} from '../js/dsf-release-orphan-inventory.js';

const UID = 'owner_inventory_1';
const PREFIX = `users/${UID}/dsf/`;
const NOW = Date.parse('2026-09-05T00:00:00.000Z');
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function storageObject(storagePath, {
    byteLength = 100,
    uploadedAt = '2026-09-01T00:00:00.000Z',
    contentType = 'image/webp',
    schemaVersion = null,
    sha256 = null,
} = {}) {
    return {
        storagePath,
        byteLength,
        uploadedAt,
        httpMetadata: schemaVersion === 2
            ? { contentType, cacheControl: IMMUTABLE_CACHE_CONTROL }
            : {},
        customMetadata: schemaVersion === 2
            ? {
                dsfSha256: sha256 || 'a'.repeat(64),
                dsfByteLength: String(byteLength),
                dsfSchemaVersion: '2',
            }
            : {},
    };
}

function inventoryPage(objects, {
    scannedObjectCount = objects.length,
    truncated = false,
    cursor = truncated ? 'next-page' : null,
} = {}) {
    return {
        inventoryVersion: DSF_RELEASE_INVENTORY_VERSION,
        inventoryKind: DSF_RELEASE_INVENTORY_KIND,
        prefix: PREFIX,
        objects,
        scannedObjectCount,
        truncated,
        cursor,
    };
}

async function responseJson(response, status) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
}

async function mutedConsoleError(callback) {
    const original = console.error;
    console.error = () => {};
    try {
        return await callback();
    } finally {
        console.error = original;
    }
}

assert.equal(DSF_RELEASE_INVENTORY_VERSION, 1);
assert.equal(DSF_RELEASE_INVENTORY_KIND, 'owner-dsf-release-storage-page');
assert.equal(DSF_RELEASE_INVENTORY_DEFAULT_LIMIT, 250);
assert.equal(DSF_RELEASE_INVENTORY_MAX_LIMIT, 1000);

{
    const calls = [];
    const env = {
        FIREBASE_PROJECT_ID: 'vmnn-26345-stg',
        R2_BUCKET: {
            async list(options) {
                calls.push(options);
                return {
                    objects: [
                        {
                            key: `${PREFIX}work_1/release_1/content.json`,
                            size: 42,
                            uploaded: new Date('2026-09-05T01:02:03.000Z'),
                            httpMetadata: {
                                contentType: 'application/json',
                                cacheControl: IMMUTABLE_CACHE_CONTROL,
                                contentDisposition: 'private-leak-test',
                            },
                            customMetadata: {
                                dsfSha256: 'b'.repeat(64),
                                dsfByteLength: '42',
                                dsfSchemaVersion: '2',
                                privateNote: 'must-not-leak',
                            },
                        },
                    ],
                    truncated: true,
                    cursor: 'opaque-r2-cursor',
                };
            },
        },
    };
    const authCalls = [];
    const request = new Request('https://studio.example/release-inventory?limit=2&cursor=incoming-cursor', {
        headers: { Authorization: 'Bearer owner-token' },
    });
    const response = await handleDsfReleaseInventory({
        request,
        env,
        verifyToken: async (token, projectId) => {
            authCalls.push({ token, projectId });
            return UID;
        },
    });
    const body = await responseJson(response, 200);

    assert.deepEqual(authCalls, [{ token: 'owner-token', projectId: 'vmnn-26345-stg' }]);
    assert.deepEqual(calls, [{
        prefix: PREFIX,
        limit: 2,
        cursor: 'incoming-cursor',
        include: ['httpMetadata', 'customMetadata'],
    }]);
    assert.equal(body.prefix, PREFIX, 'R2 prefix must come from the verified token UID');
    assert.equal(body.scannedObjectCount, 1);
    assert.equal(body.objects.length, 1);
    assert.equal(body.objects[0].uploadedAt, '2026-09-05T01:02:03.000Z');
    assert.deepEqual(body.objects[0].httpMetadata, {
        contentType: 'application/json',
        cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
    assert.deepEqual(body.objects[0].customMetadata, {
        dsfSha256: 'b'.repeat(64),
        dsfByteLength: '42',
        dsfSchemaVersion: '2',
    });
    assert.equal(body.truncated, true);
    assert.equal(body.cursor, 'opaque-r2-cursor');
}

{
    const verifyToken = async () => UID;
    const listOnlyBucket = { list: async () => ({ objects: [], truncated: false }) };
    const cases = [
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 502,
            expectedCode: 'STORAGE_LIST_INVALID',
            verifyToken,
            env: {
                R2_BUCKET: {
                    list: async () => ({
                        objects: [{
                            key: 'users/another-owner/dsf/work/release/content.json',
                            size: 10,
                            uploaded: new Date(),
                        }],
                        truncated: false,
                    }),
                },
            },
        },
        {
            request: new Request('https://studio.example/release-inventory'),
            expectedStatus: 401,
            expectedCode: 'AUTH_REQUIRED',
            verifyToken,
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer bad-token' },
            }),
            expectedStatus: 401,
            expectedCode: 'AUTH_INVALID',
            verifyToken: async () => '',
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer unsafe-owner-token' },
            }),
            expectedStatus: 401,
            expectedCode: 'AUTH_INVALID',
            verifyToken: async () => '../another-owner',
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory?uid=another-owner', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 400,
            expectedCode: 'REQUEST_QUERY_INVALID',
            verifyToken,
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory?limit=0', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 400,
            expectedCode: 'REQUEST_QUERY_INVALID',
            verifyToken,
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory?cursor=a&cursor=b', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 400,
            expectedCode: 'REQUEST_QUERY_INVALID',
            verifyToken,
            env: { R2_BUCKET: listOnlyBucket },
        },
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 500,
            expectedCode: 'CONFIG_R2_MISSING',
            verifyToken,
            env: {},
        },
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 502,
            expectedCode: 'STORAGE_LIST_FAILED',
            verifyToken,
            env: { R2_BUCKET: { list: async () => { throw new Error('synthetic list failure'); } } },
        },
        {
            request: new Request('https://studio.example/release-inventory', {
                headers: { Authorization: 'Bearer token' },
            }),
            expectedStatus: 502,
            expectedCode: 'STORAGE_LIST_INVALID',
            verifyToken,
            env: { R2_BUCKET: { list: async () => ({ objects: [], truncated: true }) } },
        },
    ];

    for (const testCase of cases) {
        const response = await mutedConsoleError(() => handleDsfReleaseInventory({
            request: testCase.request,
            env: testCase.env,
            verifyToken: testCase.verifyToken,
        }));
        const body = await responseJson(response, testCase.expectedStatus);
        assert.equal(body.code, testCase.expectedCode);
        assert.equal(Object.hasOwn(body, 'prefix'), false, 'error responses must not disclose a storage prefix');
    }
}

{
    const response = await onRequestOptions();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

const currentWorkId = 'work_current';
const currentReleaseId = 'release_current';
const historicalReleaseId = 'release_history';
const detachedWorkId = '20290901FLOWテスト';
const contentHash = 'c'.repeat(64);
const objects = [
    storageObject(`${PREFIX}${currentWorkId}/${currentReleaseId}/content.json`, {
        byteLength: 40,
        contentType: 'application/json',
        schemaVersion: 2,
        sha256: contentHash,
    }),
    storageObject(`${PREFIX}${currentWorkId}/${currentReleaseId}/content/language-0001.json`, {
        byteLength: 50,
        contentType: 'application/json',
        schemaVersion: 2,
    }),
    storageObject(`${PREFIX}${currentWorkId}/${currentReleaseId}/assets/images/language-0001/page-00001.webp`, {
        byteLength: 500,
        schemaVersion: 2,
    }),
    storageObject(`${PREFIX}${currentWorkId}/${historicalReleaseId}/ja/page_001.webp`, {
        byteLength: 400,
        uploadedAt: '2026-07-01T00:00:00.000Z',
    }),
    storageObject(`${PREFIX}${detachedWorkId}/release_detached/ja/page_001.webp`, {
        uploadedAt: '2026-07-01T00:00:00.000Z',
    }),
    storageObject(`${PREFIX}work_recent/release_recent/content.json`, {
        contentType: 'application/json',
        schemaVersion: 2,
        uploadedAt: '2026-09-03T00:00:00.000Z',
    }),
    storageObject(`${PREFIX}work_aged/release_aged/assets/images/language-0001/page-00001.webp`, {
        schemaVersion: 2,
        uploadedAt: '2026-08-01T00:00:00.000Z',
    }),
    storageObject(`${PREFIX}work_unknown/release_unknown/ja/page_001.webp`, {
        uploadedAt: null,
    }),
    storageObject(`${PREFIX}work_ref_missing/release_ref_missing/ja/page_001.webp`),
    storageObject(`${PREFIX}work_current/authoring/thumbs/page-00001.webp`),
];

const references = {
    projects: [
        {
            id: 'project_current',
            projectId: 'project_current',
            workId: currentWorkId,
            releaseId: currentReleaseId,
        },
        {
            id: 'project_ref_missing',
            projectId: 'project_ref_missing',
            workId: 'work_ref_missing',
            releaseId: 'release_ref_missing',
        },
        {
            id: 'project_missing_storage',
            projectId: 'project_missing_storage',
            workId: 'work_missing_storage',
            releaseId: 'release_missing_storage',
        },
    ],
    works: [
        {
            id: currentWorkId,
            workId: currentWorkId,
            projectId: 'project_current',
            latestReleaseId: currentReleaseId,
        },
        {
            id: 'work_ref_missing',
            workId: 'work_ref_missing',
            projectId: 'project_ref_missing',
            latestReleaseId: 'release_ref_missing',
        },
        {
            id: 'work_missing_storage',
            workId: 'work_missing_storage',
            projectId: 'project_missing_storage',
            latestReleaseId: 'release_missing_storage',
        },
    ],
    releases: [
        {
            id: currentReleaseId,
            workId: currentWorkId,
            releaseId: currentReleaseId,
            projectId: 'project_current',
            dsfSchemaVersion: 2,
            dsfContentHash: contentHash,
        },
        {
            id: historicalReleaseId,
            workId: currentWorkId,
            releaseId: historicalReleaseId,
            projectId: 'project_current',
            dsfSchemaVersion: 1,
        },
        {
            id: 'release_detached',
            workId: detachedWorkId,
            releaseId: 'release_detached',
            projectId: 'project_deleted',
            dsfSchemaVersion: 1,
        },
        {
            id: 'release_missing_storage',
            workId: 'work_missing_storage',
            releaseId: 'release_missing_storage',
            projectId: 'project_missing_storage',
            dsfSchemaVersion: 2,
        },
    ],
    publicIndexes: [{
        id: currentWorkId,
        authorUid: UID,
        workId: currentWorkId,
        releaseId: currentReleaseId,
    }],
};

{
    const audit = createDsfReleaseStorageAudit({
        uid: UID,
        inventoryPages: [
            inventoryPage(objects.slice(0, 5), { truncated: true, cursor: 'page-2' }),
            inventoryPage(objects.slice(5), { scannedObjectCount: 6 }),
        ],
        ...references,
        now: NOW,
    });

    assert.equal(audit.auditVersion, DSF_RELEASE_STORAGE_AUDIT_VERSION);
    assert.equal(audit.auditKind, DSF_RELEASE_STORAGE_AUDIT_KIND);
    assert.equal(audit.complete, true);
    assert.equal(audit.nextCursor, null);
    assert.equal(audit.summary.scannedObjectCount, 11);
    assert.equal(audit.summary.returnedObjectCount, 10);
    assert.equal(audit.summary.ignoredObjectCount, 1, 'authoring assets are outside release-root classification');
    assert.equal(audit.summary.releaseRootCount, 7);
    assert.equal(audit.summary.safeToDeleteCount, 0);
    assert.equal(Object.isFrozen(audit), true);
    assert.equal(Object.isFrozen(audit.releaseGroups), true);

    const groups = new Map(audit.releaseGroups.map((group) => [group.releaseId, group]));
    assert.equal(groups.get(currentReleaseId).classification, 'published');
    assert.equal(groups.get(currentReleaseId).recommendedAction, 'retain');
    assert.deepEqual(groups.get(currentReleaseId).issueCodes, []);
    assert.equal(groups.get(historicalReleaseId).classification, 'historical-release');
    assert.equal(groups.get('release_detached').classification, 'detached-release-history');
    assert.equal(groups.get('release_detached').workId, detachedWorkId,
        'Legacy v1 release roots may use safely encoded Unicode Firestore Work IDs.');
    assert.equal(groups.get('release_recent').classification, 'recent-untracked-upload');
    assert.equal(groups.get('release_recent').recommendedAction, 'wait');
    assert.equal(groups.get('release_aged').classification, 'aged-untracked-upload');
    assert.equal(groups.get('release_unknown').classification, 'untracked-upload-unknown-age');
    assert.equal(groups.get('release_ref_missing').classification, 'referenced-release-missing');
    assert.equal(groups.get('release_ref_missing').recommendedAction, 'repair');
    assert.ok(groups.get('release_aged').issueCodes.includes('DSF_RELEASE_AUDIT_V2_CONTENT_MISSING'));
    assert.equal(audit.releaseGroups.every((group) => group.safeToDelete === false), true);
    assert.ok(audit.issues.some((item) => (
        item.code === 'DSF_RELEASE_AUDIT_V2_STORAGE_MISSING'
        && item.releaseId === 'release_missing_storage'
    )));
    assert.ok(audit.issues.some((item) => (
        item.code === 'DSF_RELEASE_AUDIT_RELEASE_DOCUMENT_MISSING'
        && item.releaseId === 'release_ref_missing'
    )));
}

{
    const partialAudit = createDsfReleaseStorageAudit({
        uid: UID,
        inventoryPages: [inventoryPage([], { truncated: true, cursor: 'continue' })],
        ...references,
        now: NOW,
    });
    assert.equal(partialAudit.complete, false);
    assert.equal(partialAudit.nextCursor, 'continue');
    assert.equal(
        partialAudit.issues.some((item) => item.code === 'DSF_RELEASE_AUDIT_V2_STORAGE_MISSING'),
        false,
        'a partial listing must never infer missing R2 storage',
    );
}

{
    const brokenContent = storageObject(`${PREFIX}work_broken/release_broken/content.json`, {
        byteLength: 10,
        contentType: 'text/plain',
        schemaVersion: 2,
        sha256: 'd'.repeat(64),
    });
    brokenContent.httpMetadata.cacheControl = 'no-cache';
    brokenContent.customMetadata.dsfByteLength = '11';
    const audit = createDsfReleaseStorageAudit({
        uid: UID,
        inventoryPages: [inventoryPage([brokenContent])],
        releases: [{
            workId: 'work_broken',
            releaseId: 'release_broken',
            dsfSchemaVersion: 2,
            dsfContentHash: 'e'.repeat(64),
        }],
        now: NOW,
    });
    const codes = new Set(audit.issues.map((item) => item.code));
    assert.equal(codes.has('DSF_RELEASE_AUDIT_MIME_MISMATCH'), true);
    assert.equal(codes.has('DSF_RELEASE_AUDIT_CACHE_MISMATCH'), true);
    assert.equal(codes.has('DSF_RELEASE_AUDIT_OBJECT_METADATA_MISMATCH'), true);
    assert.equal(codes.has('DSF_RELEASE_AUDIT_CONTENT_HASH_MISMATCH'), true);
}

for (const invalidInput of [
    {
        uid: '../another-owner',
        inventoryPages: [inventoryPage([])],
    },
    {
        uid: UID,
        inventoryPages: [{ ...inventoryPage([]), prefix: 'users/another-owner/dsf/' }],
    },
    {
        uid: UID,
        inventoryPages: [inventoryPage([objects[0], objects[0]])],
    },
]) {
    assert.throws(
        () => createDsfReleaseStorageAudit(invalidInput),
        (error) => {
            assert.equal(error instanceof DsfReleaseStorageAuditError, true);
            assert.equal(error.code, 'DSF_RELEASE_STORAGE_AUDIT_INVALID');
            assert.equal(Object.isFrozen(error.issues), true);
            return true;
        },
    );
}

const endpointSource = readFileSync(new URL('../functions/release-inventory.js', import.meta.url), 'utf8');
for (const forbidden of ['R2_BUCKET.put', 'R2_BUCKET.delete', '.delete(', 'firebase/firestore', 'setDoc(', 'deleteDoc(']) {
    assert.equal(endpointSource.includes(forbidden), false, `inventory endpoint must not include mutation primitive ${forbidden}`);
}
const classifierSource = readFileSync(new URL('../js/dsf-release-orphan-inventory.js', import.meta.url), 'utf8');
for (const forbidden of ['fetch(', 'firebase/firestore', 'R2_BUCKET', '.delete(', 'setDoc(', 'deleteDoc(']) {
    assert.equal(classifierSource.includes(forbidden), false, `pure classifier must not include transport/mutation primitive ${forbidden}`);
}
assert.match(classifierSource, /safeToDelete:\s*false/);
assert.doesNotMatch(classifierSource, /safeToDelete:\s*true/);

console.log('DSF release orphan inventory read-only foundation verification passed.');
