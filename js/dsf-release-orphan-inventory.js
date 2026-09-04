/**
 * Pure client-side classification for owner DSF storage inventory pages.
 *
 * This module never reads or writes Firebase/R2 itself. It compares an
 * authenticated /release-inventory listing with caller-supplied owner metadata
 * and reports review candidates. It never declares an object safe to delete.
 */

export const DSF_RELEASE_STORAGE_AUDIT_VERSION = 1;
export const DSF_RELEASE_STORAGE_AUDIT_KIND = 'dsf-release-storage-audit';
export const DSF_RELEASE_STORAGE_DEFAULT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const INVENTORY_VERSION = 1;
const INVENTORY_KIND = 'owner-dsf-release-storage-page';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FIRESTORE_RESERVED_ID_PATTERN = /^__.*__$/;
const FIRESTORE_DOCUMENT_ID_MAX_BYTES = 1500;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const V2_CONTENT_PATTERN = /^content\.json$/;
const V2_MANIFEST_PATTERN = /^content\/language-\d{4}\.json$/;
const V2_IMAGE_PATTERN = /^assets\/images\/language-\d{4}\/page-\d{5}\.webp$/;
const V1_PAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}\/page_\d{3,8}\.webp$/;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function issue(code, path, message, details = {}) {
    return { severity: 'warning', code, path, message, ...details };
}

function fail(code, path, message) {
    throw new DsfReleaseStorageAuditError([{
        severity: 'error', code, path, message,
    }]);
}

function assertSafeId(value, path) {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        fail('DSF_RELEASE_AUDIT_ID_INVALID', path, 'Release storage audit identity is invalid.');
    }
    return value;
}

function isSafeWorkId(value) {
    return typeof value === 'string'
        && value.length > 0
        && value === value.trim()
        && value !== '.'
        && value !== '..'
        && !value.includes('/')
        && !/[\u0000-\u001f\u007f]/u.test(value)
        && !FIRESTORE_RESERVED_ID_PATTERN.test(value)
        && new TextEncoder().encode(value).byteLength <= FIRESTORE_DOCUMENT_ID_MAX_BYTES;
}

function normalizeMetadata(value, path) {
    if (!isRecord(value)) fail('DSF_RELEASE_AUDIT_METADATA_INVALID', path, 'Storage object metadata is invalid.');
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item !== 'string') {
            fail('DSF_RELEASE_AUDIT_METADATA_INVALID', `${path}.${key}`, 'Storage object metadata values must be strings.');
        }
        result[key] = item;
    }
    return result;
}

function normalizeUploadedAt(value, path) {
    if (value === null) return null;
    if (typeof value !== 'string') {
        fail('DSF_RELEASE_AUDIT_UPLOADED_AT_INVALID', path, 'Storage upload time must be an ISO string or null.');
    }
    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
        fail('DSF_RELEASE_AUDIT_UPLOADED_AT_INVALID', path, 'Storage upload time is invalid.');
    }
    return new Date(time).toISOString();
}

function normalizeInventoryObject(value, index, expectedPrefix) {
    const path = `inventoryPages[].objects[${index}]`;
    if (!isRecord(value)
        || typeof value.storagePath !== 'string'
        || !value.storagePath.startsWith(expectedPrefix)
        || !Number.isSafeInteger(value.byteLength)
        || value.byteLength < 0) {
        fail('DSF_RELEASE_AUDIT_OBJECT_INVALID', path, 'Storage inventory object is invalid.');
    }
    return {
        storagePath: value.storagePath,
        byteLength: value.byteLength,
        uploadedAt: normalizeUploadedAt(value.uploadedAt, `${path}.uploadedAt`),
        httpMetadata: normalizeMetadata(value.httpMetadata, `${path}.httpMetadata`),
        customMetadata: normalizeMetadata(value.customMetadata, `${path}.customMetadata`),
    };
}

function normalizeInventoryPages(pages, uid) {
    if (!Array.isArray(pages) || pages.length < 1) {
        fail('DSF_RELEASE_AUDIT_PAGES_REQUIRED', 'inventoryPages', 'At least one storage inventory page is required.');
    }
    const expectedPrefix = `users/${uid}/dsf/`;
    const objects = [];
    const paths = new Set();
    let scannedObjectCount = 0;
    pages.forEach((page, pageIndex) => {
        const path = `inventoryPages[${pageIndex}]`;
        if (!isRecord(page)
            || page.inventoryVersion !== INVENTORY_VERSION
            || page.inventoryKind !== INVENTORY_KIND
            || page.prefix !== expectedPrefix
            || !Array.isArray(page.objects)
            || !Number.isSafeInteger(page.scannedObjectCount)
            || page.scannedObjectCount < page.objects.length
            || typeof page.truncated !== 'boolean'
            || (page.truncated && (typeof page.cursor !== 'string' || !page.cursor))
            || (!page.truncated && page.cursor !== null)) {
            fail('DSF_RELEASE_AUDIT_PAGE_INVALID', path, 'Storage inventory page contract is invalid.');
        }
        if (pageIndex < pages.length - 1 && !page.truncated) {
            fail('DSF_RELEASE_AUDIT_PAGE_SEQUENCE_INVALID', path, 'A completed inventory page cannot be followed by another page.');
        }
        scannedObjectCount += page.scannedObjectCount;
        page.objects.forEach((object, objectIndex) => {
            const normalized = normalizeInventoryObject(object, objectIndex, expectedPrefix);
            if (paths.has(normalized.storagePath)) {
                fail('DSF_RELEASE_AUDIT_OBJECT_DUPLICATE', normalized.storagePath, 'Storage inventory pages contain a duplicate object.');
            }
            paths.add(normalized.storagePath);
            objects.push(normalized);
        });
    });
    return {
        prefix: expectedPrefix,
        objects,
        scannedObjectCount,
        complete: pages.at(-1).truncated === false,
        nextCursor: pages.at(-1).truncated ? pages.at(-1).cursor : null,
    };
}

function normalizeReferenceArray(value, path) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
        fail('DSF_RELEASE_AUDIT_REFERENCE_INVALID', path, 'Release storage references must be an array of objects.');
    }
    return value.map((item) => ({ ...item }));
}

function referenceId(record, field) {
    const value = record?.[field] ?? (field === 'projectId' || field === 'workId' || field === 'releaseId' ? record?.id : null);
    return typeof value === 'string' ? value.trim() : '';
}

function releaseKey(workId, releaseId) {
    return `${workId}\u0000${releaseId}`;
}

function parseReleaseStorageObject(object, prefix) {
    const relativeStoragePath = object.storagePath.slice(prefix.length);
    const segments = relativeStoragePath.split('/');
    if (segments.length < 3) return null;
    const [workId, releaseId] = segments;
    if (!isSafeWorkId(workId) || !SAFE_ID_PATTERN.test(releaseId)) return null;
    const relativePath = segments.slice(2).join('/');
    let format = null;
    let role = null;
    let expectedMimeType = null;
    if (V2_CONTENT_PATTERN.test(relativePath)) {
        format = 'v2';
        role = 'content-index';
        expectedMimeType = 'application/json';
    } else if (V2_MANIFEST_PATTERN.test(relativePath)) {
        format = 'v2';
        role = 'language-manifest';
        expectedMimeType = 'application/json';
    } else if (V2_IMAGE_PATTERN.test(relativePath)) {
        format = 'v2';
        role = 'image';
        expectedMimeType = 'image/webp';
    } else if (V1_PAGE_PATTERN.test(relativePath)) {
        format = 'v1';
        role = 'page';
        expectedMimeType = 'image/webp';
    } else {
        return null;
    }
    return { ...object, workId, releaseId, relativePath, format, role, expectedMimeType };
}

function buildReferenceMaps({ projects, works, releases, publicIndexes }, uid, issues) {
    const projectById = new Map();
    const currentProjectKeys = new Set();
    for (const [index, project] of projects.entries()) {
        const projectId = referenceId(project, 'projectId');
        if (projectId) projectById.set(projectId, project);
        const workId = referenceId(project, 'workId');
        const releaseId = referenceId(project, 'releaseId');
        if (isSafeWorkId(workId) && SAFE_ID_PATTERN.test(releaseId)) {
            currentProjectKeys.add(releaseKey(workId, releaseId));
        } else if (releaseId) {
            issues.push(issue('DSF_RELEASE_AUDIT_PROJECT_REFERENCE_INVALID', `projects[${index}]`, 'Project release reference is invalid.'));
        }
    }

    const workById = new Map();
    const currentWorkKeys = new Set();
    for (const [index, work] of works.entries()) {
        const workId = referenceId(work, 'workId');
        if (!workId) continue;
        workById.set(workId, work);
        const releaseId = referenceId(work, 'latestReleaseId');
        if (releaseId && isSafeWorkId(workId) && SAFE_ID_PATTERN.test(releaseId)) {
            currentWorkKeys.add(releaseKey(workId, releaseId));
        } else if (releaseId) {
            issues.push(issue('DSF_RELEASE_AUDIT_WORK_REFERENCE_INVALID', `works[${index}]`, 'Work release reference is invalid.'));
        }
    }

    const releaseByKey = new Map();
    for (const [index, release] of releases.entries()) {
        const workId = referenceId(release, 'workId');
        const releaseId = referenceId(release, 'releaseId');
        if (!isSafeWorkId(workId) || !SAFE_ID_PATTERN.test(releaseId)) {
            issues.push(issue('DSF_RELEASE_AUDIT_RELEASE_REFERENCE_INVALID', `releases[${index}]`, 'Release identity is invalid.'));
            continue;
        }
        const key = releaseKey(workId, releaseId);
        if (releaseByKey.has(key)) {
            issues.push(issue('DSF_RELEASE_AUDIT_RELEASE_REFERENCE_DUPLICATE', `releases[${index}]`, 'Release metadata contains a duplicate identity.', { workId, releaseId }));
            continue;
        }
        releaseByKey.set(key, release);
    }

    const publicByKey = new Map();
    for (const [index, publicIndex] of publicIndexes.entries()) {
        if (publicIndex.authorUid !== undefined && publicIndex.authorUid !== uid) {
            issues.push(issue('DSF_RELEASE_AUDIT_PUBLIC_OWNER_MISMATCH', `publicIndexes[${index}]`, 'Public index is not owned by the audited user.'));
            continue;
        }
        const workId = referenceId(publicIndex, 'workId');
        const releaseId = referenceId(publicIndex, 'releaseId');
        if (!isSafeWorkId(workId) || !SAFE_ID_PATTERN.test(releaseId)) {
            issues.push(issue('DSF_RELEASE_AUDIT_PUBLIC_REFERENCE_INVALID', `publicIndexes[${index}]`, 'Public release reference is invalid.'));
            continue;
        }
        publicByKey.set(releaseKey(workId, releaseId), publicIndex);
    }

    return { projectById, currentProjectKeys, workById, currentWorkKeys, releaseByKey, publicByKey };
}

function addV2ObjectIssues(group, release, issues) {
    const contentObjects = group.files.filter((file) => file.role === 'content-index');
    if (contentObjects.length !== 1) {
        issues.push(issue('DSF_RELEASE_AUDIT_V2_CONTENT_MISSING', group.storageRoot, 'DSF v2 storage root must contain exactly one content.json.', {
            workId: group.workId,
            releaseId: group.releaseId,
        }));
    }
    for (const file of group.files.filter((item) => item.format === 'v2')) {
        const metadataPath = file.storagePath;
        if (file.httpMetadata.contentType !== file.expectedMimeType) {
            issues.push(issue('DSF_RELEASE_AUDIT_MIME_MISMATCH', metadataPath, 'Stored release MIME type is missing or invalid.'));
        }
        if (file.httpMetadata.cacheControl !== IMMUTABLE_CACHE_CONTROL) {
            issues.push(issue('DSF_RELEASE_AUDIT_CACHE_MISMATCH', metadataPath, 'Stored release cache policy is not immutable.'));
        }
        if (file.customMetadata.dsfSchemaVersion !== '2'
            || file.customMetadata.dsfByteLength !== String(file.byteLength)
            || !SHA256_PATTERN.test(file.customMetadata.dsfSha256 || '')) {
            issues.push(issue('DSF_RELEASE_AUDIT_OBJECT_METADATA_MISMATCH', metadataPath, 'Stored DSF v2 verification metadata is incomplete or invalid.'));
        }
    }
    if (release && contentObjects.length === 1) {
        const contentHash = contentObjects[0].customMetadata.dsfSha256 || '';
        if (typeof release.dsfContentHash === 'string' && release.dsfContentHash !== contentHash) {
            issues.push(issue('DSF_RELEASE_AUDIT_CONTENT_HASH_MISMATCH', contentObjects[0].storagePath, 'Release metadata and R2 content hash do not match.'));
        }
    }
}

function classifyGroup(group, maps, now, gracePeriodMs, globalIssues) {
    const key = releaseKey(group.workId, group.releaseId);
    const release = maps.releaseByKey.get(key) || null;
    const work = maps.workById.get(group.workId) || null;
    const projectId = referenceId(release, 'projectId') || referenceId(work, 'projectId');
    const project = projectId ? maps.projectById.get(projectId) || null : null;
    const isPublic = maps.publicByKey.has(key);
    const isCurrent = maps.currentProjectKeys.has(key) || maps.currentWorkKeys.has(key);
    const formats = [...group.formats].sort();
    const groupIssues = [];

    if (formats.includes('v2')) addV2ObjectIssues(group, release, groupIssues);
    if (formats.length > 1) {
        groupIssues.push(issue('DSF_RELEASE_AUDIT_FORMAT_MIXED', group.storageRoot, 'One release root contains both v1 and v2 object layouts.'));
    }
    if (release?.dsfSchemaVersion === 2 && formats.length === 1 && formats[0] !== 'v2') {
        groupIssues.push(issue('DSF_RELEASE_AUDIT_RELEASE_FORMAT_MISMATCH', group.storageRoot, 'Release declares DSF v2 but storage uses the v1 layout.'));
    }
    if (release && release.dsfSchemaVersion !== 2 && formats.length === 1 && formats[0] === 'v2') {
        groupIssues.push(issue('DSF_RELEASE_AUDIT_RELEASE_FORMAT_MISMATCH', group.storageRoot, 'Storage uses DSF v2 but Release metadata does not declare it.'));
    }

    const latestTime = group.latestUploadedAt ? Date.parse(group.latestUploadedAt) : NaN;
    const ageMs = Number.isFinite(latestTime) ? Math.max(0, now - latestTime) : null;
    let classification;
    let recommendedAction;
    if (!release) {
        if (isPublic || isCurrent) {
            classification = 'referenced-release-missing';
            recommendedAction = 'repair';
            groupIssues.push(issue('DSF_RELEASE_AUDIT_RELEASE_DOCUMENT_MISSING', group.storageRoot, 'Storage is referenced but its Release document is missing.'));
        } else if (ageMs !== null && ageMs < gracePeriodMs) {
            classification = 'recent-untracked-upload';
            recommendedAction = 'wait';
        } else if (ageMs === null) {
            classification = 'untracked-upload-unknown-age';
            recommendedAction = 'review';
        } else {
            classification = 'aged-untracked-upload';
            recommendedAction = 'review';
        }
    } else if (isPublic) {
        classification = 'published';
        recommendedAction = groupIssues.length ? 'repair' : 'retain';
    } else if (isCurrent) {
        classification = 'current';
        recommendedAction = groupIssues.length ? 'repair' : 'retain';
    } else if (!work || (projectId && !project)) {
        classification = 'detached-release-history';
        recommendedAction = 'review';
    } else {
        classification = 'historical-release';
        recommendedAction = groupIssues.length ? 'repair' : 'retain';
    }

    globalIssues.push(...groupIssues.map((value) => ({
        ...value,
        workId: value.workId || group.workId,
        releaseId: value.releaseId || group.releaseId,
    })));
    return {
        workId: group.workId,
        releaseId: group.releaseId,
        storageRoot: group.storageRoot,
        format: formats.length === 1 ? formats[0] : 'mixed',
        classification,
        recommendedAction,
        safeToDelete: false,
        releaseDocumentPresent: !!release,
        workDocumentPresent: !!work,
        projectDocumentPresent: !!project,
        publicIndexPresent: isPublic,
        currentReferencePresent: isCurrent,
        fileCount: group.files.length,
        totalBytes: group.totalBytes,
        oldestUploadedAt: group.oldestUploadedAt,
        latestUploadedAt: group.latestUploadedAt,
        ageMs,
        issueCodes: [...new Set(groupIssues.map((value) => value.code))],
    };
}

function buildStorageGroups(objects, prefix) {
    const groups = new Map();
    let ignoredObjectCount = 0;
    for (const object of objects) {
        const parsed = parseReleaseStorageObject(object, prefix);
        if (!parsed) {
            ignoredObjectCount += 1;
            continue;
        }
        const key = releaseKey(parsed.workId, parsed.releaseId);
        let group = groups.get(key);
        if (!group) {
            group = {
                workId: parsed.workId,
                releaseId: parsed.releaseId,
                storageRoot: `${prefix}${parsed.workId}/${parsed.releaseId}`,
                files: [],
                formats: new Set(),
                totalBytes: 0,
                oldestUploadedAt: null,
                latestUploadedAt: null,
            };
            groups.set(key, group);
        }
        group.files.push(parsed);
        group.formats.add(parsed.format);
        group.totalBytes += parsed.byteLength;
        if (parsed.uploadedAt) {
            if (!group.oldestUploadedAt || parsed.uploadedAt < group.oldestUploadedAt) group.oldestUploadedAt = parsed.uploadedAt;
            if (!group.latestUploadedAt || parsed.uploadedAt > group.latestUploadedAt) group.latestUploadedAt = parsed.uploadedAt;
        }
    }
    for (const group of groups.values()) {
        group.files.sort((a, b) => a.storagePath.localeCompare(b.storagePath));
    }
    return { groups, ignoredObjectCount };
}

function addMissingStorageIssues(maps, groups, complete, issues) {
    if (!complete) return;
    for (const [key, release] of maps.releaseByKey.entries()) {
        if (release.dsfSchemaVersion !== 2 || groups.has(key)) continue;
        const workId = referenceId(release, 'workId');
        const releaseId = referenceId(release, 'releaseId');
        issues.push(issue(
            'DSF_RELEASE_AUDIT_V2_STORAGE_MISSING',
            `releases/${workId}/${releaseId}`,
            'DSF v2 Release metadata has no matching R2 release objects.',
            { workId, releaseId },
        ));
    }
    for (const key of new Set([...maps.currentProjectKeys, ...maps.currentWorkKeys, ...maps.publicByKey.keys()])) {
        if (maps.releaseByKey.has(key)) continue;
        const [workId, releaseId] = key.split('\u0000');
        issues.push(issue(
            'DSF_RELEASE_AUDIT_RELEASE_DOCUMENT_MISSING',
            `releases/${workId}/${releaseId}`,
            'A current or public reference has no matching Release document.',
            { workId, releaseId },
        ));
    }
}

export class DsfReleaseStorageAuditError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'DSF release storage audit input is invalid.');
        this.name = 'DsfReleaseStorageAuditError';
        this.code = 'DSF_RELEASE_STORAGE_AUDIT_INVALID';
        this.issues = deepFreeze(Array.isArray(issues) ? issues.map((value) => ({ ...value })) : []);
    }
}

/**
 * Build a non-destructive audit report. `recommendedAction: review` is never a
 * delete authorization; every release result explicitly has safeToDelete:false.
 */
export function createDsfReleaseStorageAudit(input = {}) {
    if (!isRecord(input)) fail('DSF_RELEASE_AUDIT_INPUT_INVALID', '', 'Release storage audit input must be an object.');
    const uid = assertSafeId(input.uid, 'uid');
    const pages = normalizeInventoryPages(input.inventoryPages, uid);
    const now = input.now === undefined ? Date.now() : Number(input.now);
    const gracePeriodMs = input.gracePeriodMs === undefined
        ? DSF_RELEASE_STORAGE_DEFAULT_GRACE_MS
        : Number(input.gracePeriodMs);
    if (!Number.isFinite(now) || now < 0
        || !Number.isSafeInteger(gracePeriodMs) || gracePeriodMs < 1) {
        fail('DSF_RELEASE_AUDIT_TIME_INVALID', 'now', 'Release storage audit time or grace period is invalid.');
    }

    const references = {
        projects: normalizeReferenceArray(input.projects, 'projects'),
        works: normalizeReferenceArray(input.works, 'works'),
        releases: normalizeReferenceArray(input.releases, 'releases'),
        publicIndexes: normalizeReferenceArray(input.publicIndexes, 'publicIndexes'),
    };
    const issues = [];
    const maps = buildReferenceMaps(references, uid, issues);
    const { groups, ignoredObjectCount } = buildStorageGroups(pages.objects, pages.prefix);
    const releaseGroups = [...groups.values()]
        .map((group) => classifyGroup(group, maps, now, gracePeriodMs, issues))
        .sort((a, b) => a.storageRoot.localeCompare(b.storageRoot));
    addMissingStorageIssues(maps, groups, pages.complete, issues);

    const countsByClassification = {};
    const countsByAction = {};
    for (const group of releaseGroups) {
        countsByClassification[group.classification] = (countsByClassification[group.classification] || 0) + 1;
        countsByAction[group.recommendedAction] = (countsByAction[group.recommendedAction] || 0) + 1;
    }

    return deepFreeze({
        auditVersion: DSF_RELEASE_STORAGE_AUDIT_VERSION,
        auditKind: DSF_RELEASE_STORAGE_AUDIT_KIND,
        generatedAt: new Date(now).toISOString(),
        uid,
        complete: pages.complete,
        nextCursor: pages.nextCursor,
        gracePeriodMs,
        releaseGroups,
        issues,
        summary: {
            scannedObjectCount: pages.scannedObjectCount,
            returnedObjectCount: pages.objects.length,
            ignoredObjectCount,
            releaseRootCount: releaseGroups.length,
            totalReleaseBytes: releaseGroups.reduce((sum, group) => sum + group.totalBytes, 0),
            countsByClassification,
            countsByAction,
            safeToDeleteCount: 0,
        },
    });
}
