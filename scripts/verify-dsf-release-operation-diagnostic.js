import assert from 'node:assert/strict';
import {
    createDsfReleaseOperationDiagnostic,
    DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS,
} from '../js/dsf-release-operation-diagnostic.js';

const EXACT_KEYS = [
    'classification',
    'code',
    'path',
    'completedFileCount',
    'fileCount',
    'storagePath',
    'remoteCode',
    'message',
].sort();

const releasePath = 'users/owner-1/dsf/work-1/release-1/content/language-0001.json';
const transientUpload = createDsfReleaseOperationDiagnostic({
    name: 'DsfHorizonReleaseUploadError',
    code: 'DSF_HORIZON_RELEASE_UPLOAD_FAILED',
    message: 'Bearer secret-access-token payload={"private":true}',
    token: 'secret-access-token',
    payload: { private: true },
    stack: 'private stack',
    issues: [{
        code: 'HORIZON_UPLOAD_REQUEST_FAILED',
        path: 'requests[1]',
        message: 'request failed with secret-access-token',
        cause: 'secret cause',
    }],
    completedReceipts: [{ storagePath: 'private', token: 'receipt-token' }],
    storagePath: releasePath,
    fileIndex: 1,
}, {
    fileCount: 3,
    token: 'context-token',
    payload: { private: true },
});

assert.deepEqual(Object.keys(transientUpload).sort(), EXACT_KEYS);
assert.equal(transientUpload.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE);
assert.equal(transientUpload.code, 'HORIZON_UPLOAD_REQUEST_FAILED');
assert.equal(transientUpload.path, 'requests[1]');
assert.equal(transientUpload.completedFileCount, 1);
assert.equal(transientUpload.fileCount, 3);
assert.equal(transientUpload.storagePath, releasePath);
assert.equal(transientUpload.remoteCode, null);
assert.equal(Object.isFrozen(transientUpload), true);
const transientJson = JSON.stringify(transientUpload);
for (const secret of ['secret-access-token', 'context-token', 'receipt-token', 'private stack', 'secret cause']) {
    assert.doesNotMatch(transientJson, new RegExp(secret));
}

const authRefresh = createDsfReleaseOperationDiagnostic({
    code: 'DSF_HORIZON_RELEASE_UPLOAD_FAILED',
    issues: [{
        code: 'HORIZON_UPLOAD_HTTP_FAILED',
        path: 'responses[0]',
        status: 401,
        remoteCode: 'AUTH_INVALID',
        message: 'remote auth failed',
    }],
    storagePath: 'users/owner-1/dsf/work-1/release-1/content.json',
});
assert.equal(authRefresh.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED);
assert.equal(authRefresh.remoteCode, 'AUTH_INVALID');

const immutableCollision = createDsfReleaseOperationDiagnostic({
    issues: [{
        code: 'HORIZON_UPLOAD_HTTP_FAILED',
        path: 'responses[2]',
        status: 409,
        remoteCode: 'IMMUTABLE_COLLISION',
    }],
});
assert.equal(immutableCollision.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED);

const serverFailure = createDsfReleaseOperationDiagnostic({
    issues: [{ code: 'HORIZON_UPLOAD_HTTP_FAILED', path: 'responses[2]', status: 503 }],
});
assert.equal(serverFailure.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE);

const stalePublication = createDsfReleaseOperationDiagnostic({
    name: 'WorksPublicationTransitionError',
    code: 'WORKS_PUBLICATION_WORK_MISMATCH',
    path: 'work',
    message: 'Work does not point to the selected release.',
});
assert.equal(stalePublication.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED);
assert.equal(stalePublication.path, 'work');

const stalePublicationStatus = createDsfReleaseOperationDiagnostic({
    code: 'WORKS_PUBLICATION_STATE_STALE',
    message: 'must not leak',
});
assert.equal(stalePublicationStatus.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED);
assert.doesNotMatch(JSON.stringify(stalePublicationStatus), /must not leak/);

for (const code of [
    'FLOW_HORIZON_UPLOAD_INPUT_STALE',
    'FLOW_HORIZON_DRAFT_INPUT_STALE',
    'FLOW_HORIZON_DRAFT_PROJECT_STALE',
    'FLOW_HORIZON_DRAFT_COMMITTED_INPUT_STALE',
    'HORIZON_UPLOAD_SEAL_FAILED',
]) {
    const stale = createDsfReleaseOperationDiagnostic({ code, message: 'private detail' });
    assert.equal(stale.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED, code);
    assert.doesNotMatch(JSON.stringify(stale), /private detail/);
}

const ownershipCollision = createDsfReleaseOperationDiagnostic({
    code: 'WORKS_PUBLICATION_PUBLIC_INDEX_OWNERSHIP',
    path: 'publicIndexes.work-1',
    message: 'token=must-not-leak',
});
assert.equal(ownershipCollision.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED);
assert.doesNotMatch(JSON.stringify(ownershipCollision), /must-not-leak/);

const invalidMetadataRetry = createDsfReleaseOperationDiagnostic({
    code: 'DSF_FLOW_PRESS_HORIZON_DRAFT_WRITE_INVALID',
    issues: [{
        code: 'FLOW_HORIZON_DRAFT_RETRY_INVALID',
        path: 'existingRelease',
        message: 'Existing release retry input is invalid.',
    }],
});
assert.equal(invalidMetadataRetry.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED);

const invalidMetadata = createDsfReleaseOperationDiagnostic({
    issues: [{ code: 'FLOW_HORIZON_DRAFT_PAGE_COUNTS_INVALID', path: 'release.dsfPageCounts' }],
});
assert.equal(invalidMetadata.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED);

const firebaseUnavailable = createDsfReleaseOperationDiagnostic({
    name: 'FirebaseError',
    code: 'firestore/unavailable',
    message: 'payload=private',
});
assert.equal(firebaseUnavailable.code, 'FIREBASE_UNAVAILABLE');
assert.equal(firebaseUnavailable.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE);
assert.doesNotMatch(JSON.stringify(firebaseUnavailable), /private/);

const unsafeUnknown = createDsfReleaseOperationDiagnostic({
    code: 'not a safe code',
    path: 'request?access_token=secret',
    storagePath: 'users/owner-1/dsf/work-1/release-1/content.json?token=secret',
    remoteCode: 'bad-remote-code',
    message: 'Bearer eyJ.private.signature payload={"secret":true}',
});
assert.deepEqual(unsafeUnknown, {
    classification: 'blocked',
    code: 'DSF_RELEASE_OPERATION_FAILED',
    path: null,
    completedFileCount: 0,
    fileCount: null,
    storagePath: null,
    remoteCode: null,
    message: 'Release operation is blocked until the reported issue is resolved.',
});
assert.doesNotMatch(JSON.stringify(unsafeUnknown), /secret|payload|Bearer|eyJ/);

const invalidTotal = createDsfReleaseOperationDiagnostic({
    code: 'HORIZON_UPLOAD_ABORTED',
    completedReceipts: [{}, {}],
}, { fileCount: 1 });
assert.equal(invalidTotal.fileCount, null, 'total file count must not be smaller than completed file count');
assert.equal(invalidTotal.classification, DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE);

console.log('DSF release operation diagnostic verification passed.');
