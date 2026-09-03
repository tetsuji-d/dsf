/**
 * Pure identity checks for the owner-only Viewer draft route.
 *
 * The URL contains only a Project ID. The current Firebase Auth UID selects
 * the private owner namespace; an author UID is never trusted from the URL.
 */

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, message) {
    const error = new Error(message);
    error.name = 'ViewerOwnerPreviewError';
    error.code = code;
    throw error;
}

function assertSafeId(value, field) {
    const normalized = String(value || '').trim();
    if (!SAFE_ID_PATTERN.test(normalized)) {
        fail('OWNER_PREVIEW_ID_INVALID', `${field} must be a safe document ID.`);
    }
    return normalized;
}

function assertRecordedOwner(record, uid, field) {
    const recorded = String(record?.ownerUid || record?.authorUid || record?.uid || '').trim();
    if (recorded && recorded !== uid) {
        fail('OWNER_PREVIEW_OWNER_MISMATCH', `${field} does not belong to the signed-in owner.`);
    }
}

export function buildOwnerDraftViewerUrl(origin, projectId) {
    const pid = assertSafeId(projectId, 'projectId');
    let url;
    try {
        url = new URL('/viewer', origin);
    } catch {
        fail('OWNER_PREVIEW_ORIGIN_INVALID', 'Viewer origin is invalid.');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        fail('OWNER_PREVIEW_ORIGIN_INVALID', 'Viewer origin must use HTTP or HTTPS.');
    }
    url.searchParams.set('draft', pid);
    return url.href;
}

export function normalizeOwnerDraftProjectId(projectId) {
    return assertSafeId(projectId, 'projectId');
}

export function resolveOwnerDraftWorkIdentity(input = {}) {
    const uid = assertSafeId(input.uid, 'uid');
    const projectId = assertSafeId(input.projectId, 'projectId');
    if (!isRecord(input.project)) {
        fail('OWNER_PREVIEW_PROJECT_INVALID', 'Owner Project metadata is required.');
    }
    assertRecordedOwner(input.project, uid, 'Project');
    const workId = assertSafeId(input.project.workId || projectId, 'workId');
    return Object.freeze({ uid, projectId, workId });
}

export function resolveOwnerDraftReleaseIdentity(workIdentity, work = {}) {
    if (!isRecord(workIdentity) || !isRecord(work)) {
        fail('OWNER_PREVIEW_WORK_INVALID', 'Owner Work metadata is invalid.');
    }
    const uid = assertSafeId(workIdentity.uid, 'uid');
    const projectId = assertSafeId(workIdentity.projectId, 'projectId');
    const workId = assertSafeId(workIdentity.workId, 'workId');
    assertRecordedOwner(work, uid, 'Work');
    if (work.workId && assertSafeId(work.workId, 'work.workId') !== workId) {
        fail('OWNER_PREVIEW_WORK_MISMATCH', 'Work metadata does not match the requested work.');
    }
    const releaseId = assertSafeId(workIdentity.releaseId || work.latestReleaseId, 'releaseId');
    return Object.freeze({ uid, projectId, workId, releaseId });
}

export function assertOwnerDraftReleaseMetadata(release, identity) {
    if (!isRecord(release) || !isRecord(identity)) {
        fail('OWNER_PREVIEW_RELEASE_INVALID', 'Owner Release metadata is required.');
    }
    const expected = {
        projectId: assertSafeId(identity.projectId, 'projectId'),
        workId: assertSafeId(identity.workId, 'workId'),
        releaseId: assertSafeId(identity.releaseId, 'releaseId'),
    };
    for (const [field, value] of Object.entries(expected)) {
        if (assertSafeId(release[field], `release.${field}`) !== value) {
            fail('OWNER_PREVIEW_RELEASE_MISMATCH', `Release ${field} does not match the owner preview request.`);
        }
    }
    return true;
}
