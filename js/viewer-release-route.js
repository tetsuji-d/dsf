/**
 * Pure checks for release-locked public Viewer routes.
 *
 * A public `r` parameter is a lock on the Release currently projected by
 * `public_projects/{workId}`. It never grants access to an older owner Release.
 */

const SAFE_VIEWER_ROUTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FIRESTORE_RESERVED_ID_PATTERN = /^__.*__$/;
const FIRESTORE_DOCUMENT_ID_MAX_BYTES = 1500;

function fail(code, message) {
    const error = new Error(message);
    error.name = 'ViewerReleaseRouteError';
    error.code = code;
    throw error;
}

function normalizeReleaseId(value, field, { required = false } = {}) {
    const raw = String(value ?? '');
    if (!raw) {
        if (required) fail('VIEWER_RELEASE_UNAVAILABLE', `${field} is not available.`);
        return '';
    }
    const normalized = raw.trim();
    if (raw !== normalized || !SAFE_VIEWER_ROUTE_ID_PATTERN.test(normalized)) {
        fail('VIEWER_RELEASE_ID_INVALID', `${field} is invalid.`);
    }
    return normalized;
}

function normalizeWorkId(value) {
    const raw = String(value ?? '');
    const normalized = raw.trim();
    const byteLength = new TextEncoder().encode(normalized).byteLength;
    if (!normalized
        || raw !== normalized
        || normalized === '.'
        || normalized === '..'
        || normalized.includes('/')
        || /[\u0000-\u001f\u007f]/u.test(normalized)
        || FIRESTORE_RESERVED_ID_PATTERN.test(normalized)
        || byteLength > FIRESTORE_DOCUMENT_ID_MAX_BYTES) {
        fail('VIEWER_WORK_ID_INVALID', 'Work ID is invalid.');
    }
    return normalized;
}

/**
 * Build a public Viewer URL without exposing arbitrary path/query input.
 * Omitting releaseId preserves the legacy `?work=` route; when supplied, `r`
 * locks the link to the Release currently projected by public_projects.
 */
export function buildPublicViewerUrl(origin, workId, releaseId = '') {
    let base;
    try {
        base = new URL(String(origin ?? ''));
    } catch {
        fail('VIEWER_ORIGIN_INVALID', 'Viewer origin is invalid.');
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
        fail('VIEWER_ORIGIN_INVALID', 'Viewer origin must use HTTP or HTTPS.');
    }

    const url = new URL('/viewer', base.origin);
    url.searchParams.set('work', normalizeWorkId(workId));
    const normalizedReleaseId = normalizeRequestedViewerReleaseId(releaseId);
    if (normalizedReleaseId) url.searchParams.set('r', normalizedReleaseId);
    return url.href;
}

/** Normalize an optional `r` query value without consulting Firestore. */
export function normalizeRequestedViewerReleaseId(value) {
    return normalizeReleaseId(value, 'Requested Release ID');
}

/**
 * Fail closed when a release-locked URL does not name the Release currently
 * exposed by the public index. An unversioned URL preserves the existing v1/v2
 * latest-public behavior, including legacy v1 indexes without a Release ID.
 */
export function assertRequestedViewerReleaseIsCurrent(requestedReleaseId, publicReleaseId) {
    const requested = normalizeRequestedViewerReleaseId(requestedReleaseId);
    if (!requested) return '';
    const current = normalizeReleaseId(publicReleaseId, 'Published Release ID', { required: true });
    if (requested !== current) {
        fail(
            'VIEWER_RELEASE_NOT_CURRENT',
            'The requested DSF release is not the currently published release.',
        );
    }
    return current;
}
