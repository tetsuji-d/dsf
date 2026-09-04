/**
 * Pure, redacted diagnostics for DSF release operations.
 *
 * This module intentionally accepts error-shaped values instead of importing
 * upload, metadata, Works, Firebase, or UI modules. It returns a small,
 * immutable projection that is safe to show in Studio or include in an
 * operator report. Error causes, stacks, receipts, tokens, request bodies, and
 * release payloads are never copied to the result.
 */

export const DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS = Object.freeze({
    RETRY_SAFE: 'retry-safe',
    REFRESH_REQUIRED: 'refresh-required',
    BLOCKED: 'blocked',
});

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const FIREBASE_CODE_PATTERN = /^(?:[a-z][a-z0-9-]*\/)?[a-z][a-z0-9-]{1,127}$/;
const REMOTE_CODE_PATTERN = CODE_PATTERN;
const DIAGNOSTIC_PATH_PATTERN = /^[A-Za-z0-9_.\-/[\]]{1,256}$/;
const RELEASE_STORAGE_PATH_PATTERN = /^users\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/dsf\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/(?:content\.json|content\/language-\d{4}\.json|assets\/images\/language-\d{4}\/page-\d{5}\.webp)$/;

const RETRY_SAFE_CODES = new Set([
    'HORIZON_UPLOAD_ABORTED',
    'HORIZON_UPLOAD_REQUEST_FAILED',
    'HORIZON_UPLOAD_TOKEN_FAILED',
    'HORIZON_UPLOAD_RESPONSE_INVALID',
    'FIREBASE_ABORTED',
    'FIREBASE_CANCELLED',
    'FIREBASE_DEADLINE_EXCEEDED',
    'FIREBASE_INTERNAL',
    'FIREBASE_RESOURCE_EXHAUSTED',
    'FIREBASE_UNAVAILABLE',
    'FIREBASE_UNKNOWN',
]);

const REFRESH_REQUIRED_CODES = new Set([
    'WORKS_PUBLICATION_STATE_STALE',
    'HORIZON_UPLOAD_SEAL_FAILED',
    'HORIZON_UPLOAD_PLAN_INVALID',
    'HORIZON_UPLOAD_ROOT_INVALID',
    'HORIZON_UPLOAD_SUMMARY_INVALID',
    'HORIZON_UPLOAD_BLOB_MISMATCH',
    'HORIZON_UPLOAD_BLOB_HASH_MISMATCH',
    'HORIZON_UPLOAD_RECEIPT_MISMATCH',
    'FLOW_HORIZON_UPLOAD_HANDOFF_NOT_READY',
    'FLOW_HORIZON_UPLOAD_INPUT_STALE',
    'FLOW_HORIZON_UPLOAD_RESULT_INVALID',
    'FLOW_HORIZON_UPLOAD_USER_MISMATCH',
    'FLOW_HORIZON_DRAFT_INPUT_STALE',
    'FLOW_HORIZON_DRAFT_PROJECT_STALE',
    'FLOW_HORIZON_DRAFT_COMMITTED_INPUT_STALE',
    'FLOW_HORIZON_DRAFT_IDENTITY_MISMATCH',
    'FLOW_HORIZON_DRAFT_LOCATOR_MISMATCH',
    'FLOW_HORIZON_DRAFT_RETRY_INVALID',
    'FLOW_HORIZON_DRAFT_UPLOAD_NOT_SEALED',
    'WORKS_PUBLICATION_CANONICAL_RELEASE_MISSING',
    'WORKS_PUBLICATION_DEFAULT_LANGUAGE_INVALID',
    'WORKS_PUBLICATION_DEFAULT_PAGE_COUNT_MISMATCH',
    'WORKS_PUBLICATION_DELIVERY_MISMATCH',
    'WORKS_PUBLICATION_IDENTITY_MISMATCH',
    'WORKS_PUBLICATION_RELEASE_MISMATCH',
    'WORKS_PUBLICATION_WORK_MISMATCH',
    'FIREBASE_ALREADY_EXISTS',
    'FIREBASE_FAILED_PRECONDITION',
    'FIREBASE_UNAUTHENTICATED',
]);

const RETRY_SAFE_REMOTE_CODES = new Set([
    'INTERNAL_ERROR',
    'STORAGE_WRITE_FAILED',
]);

const REFRESH_REQUIRED_REMOTE_CODES = new Set([
    'AUTH_INVALID',
    'AUTH_REQUIRED',
]);

const RETRY_SAFE_HTTP_STATUSES = new Set([408, 425, 429]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstIssue(error) {
    return Array.isArray(error?.issues) && isRecord(error.issues[0])
        ? error.issues[0]
        : null;
}

function normalizeCode(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (CODE_PATTERN.test(trimmed)) return trimmed;
    if (!FIREBASE_CODE_PATTERN.test(trimmed)) return null;
    const firebaseCode = trimmed.split('/').at(-1).replaceAll('-', '_').toUpperCase();
    return `FIREBASE_${firebaseCode}`;
}

function normalizePath(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return DIAGNOSTIC_PATH_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeStoragePath(value) {
    if (typeof value !== 'string' || value !== value.trim()) return null;
    return RELEASE_STORAGE_PATH_PATTERN.test(value) ? value : null;
}

function normalizeRemoteCode(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return REMOTE_CODE_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function completedFileCount(error) {
    return Array.isArray(error?.completedReceipts)
        ? error.completedReceipts.length
        : 0;
}

function classify({ code, remoteCode, status, errorName }) {
    if (remoteCode) {
        if (RETRY_SAFE_REMOTE_CODES.has(remoteCode)) {
            return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE;
        }
        if (REFRESH_REQUIRED_REMOTE_CODES.has(remoteCode)) {
            return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED;
        }
        return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED;
    }
    if (code === 'HORIZON_UPLOAD_HTTP_FAILED') {
        return (RETRY_SAFE_HTTP_STATUSES.has(status) || (Number.isInteger(status) && status >= 500))
            ? DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE
            : DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED;
    }
    if (RETRY_SAFE_CODES.has(code) || errorName === 'AbortError') {
        return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE;
    }
    if (REFRESH_REQUIRED_CODES.has(code)) {
        return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED;
    }
    return DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.BLOCKED;
}

function diagnosticMessage(classification, code) {
    if (code === 'HORIZON_UPLOAD_ABORTED') {
        return 'Release operation was cancelled and can be retried safely.';
    }
    if (classification === DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.RETRY_SAFE) {
        return 'Release operation failed temporarily and can be retried safely.';
    }
    if (classification === DSF_RELEASE_OPERATION_DIAGNOSTIC_CLASSIFICATIONS.REFRESH_REQUIRED) {
        return 'Release state changed or expired. Refresh before retrying.';
    }
    return 'Release operation is blocked until the reported issue is resolved.';
}

/**
 * Return a redacted, immutable diagnostic for one release operation failure.
 * `context.fileCount` may provide the verified plan's total file count. No
 * other context property is read or copied.
 */
export function createDsfReleaseOperationDiagnostic(error, context = {}) {
    const safeError = isRecord(error) || error instanceof Error ? error : {};
    const issue = firstIssue(safeError);
    const code = normalizeCode(issue?.code) || normalizeCode(safeError.code) || 'DSF_RELEASE_OPERATION_FAILED';
    const path = normalizePath(issue?.path) || normalizePath(safeError.path);
    const storagePath = normalizeStoragePath(safeError.storagePath);
    const remoteCode = normalizeRemoteCode(issue?.remoteCode) || normalizeRemoteCode(safeError.remoteCode);
    const status = normalizeCount(issue?.status) ?? normalizeCount(safeError.status);
    const completed = completedFileCount(safeError);
    const requestedFileCount = normalizeCount(context?.fileCount);
    const fileCount = requestedFileCount !== null && requestedFileCount >= completed
        ? requestedFileCount
        : null;
    const classification = classify({
        code,
        remoteCode,
        status,
        errorName: typeof safeError.name === 'string' ? safeError.name : '',
    });

    return Object.freeze({
        classification,
        code,
        path,
        completedFileCount: completed,
        fileCount,
        storagePath,
        remoteCode,
        message: diagnosticMessage(classification, code),
    });
}
