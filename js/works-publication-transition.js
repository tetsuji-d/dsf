/**
 * Pure Works publication transition contract.
 *
 * Firestore reads and writes stay in works.js. This module validates the
 * current Project / Work / Release snapshot and builds the exact public index
 * payload without importing Firebase or performing side effects.
 */

import { resolveWorksDsfRelease } from './works-dsf-release.js';

const VISIBLE_STATUSES = new Set(['public', 'unlisted']);
const ALL_STATUSES = new Set(['draft', 'public', 'unlisted', 'private']);
const SAFE_ID_PATTERN = /^[^/]{1,512}$/;

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value) {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function deepClone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(deepClone);
    if (!isPlainRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]));
}

function deepFreeze(value, seen = new WeakSet()) {
    if ((!Array.isArray(value) && !isPlainRecord(value)) || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function fail(code, path, message) {
    throw new WorksPublicationTransitionError(code, path, message);
}

function assertId(value, path) {
    if (typeof value !== 'string' || value !== value.trim() || !SAFE_ID_PATTERN.test(value)) {
        fail('WORKS_PUBLICATION_ID_INVALID', path, `${path} must be a non-empty Firestore document ID.`);
    }
    return value;
}

function assertOptionalExactId(value, expected, path) {
    if (value !== undefined && value !== null && value !== '' && value !== expected) {
        fail('WORKS_PUBLICATION_IDENTITY_MISMATCH', path, `${path} does not match the selected release identity.`);
    }
}

function sameValue(left, right) {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => sameValue(value, right[index]));
    }
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(left[key], right[key]));
}

function assertSameDelivery(projectRelease, canonicalRelease) {
    if (projectRelease.releaseKind !== canonicalRelease.releaseKind) {
        fail('WORKS_PUBLICATION_DELIVERY_MISMATCH', 'release.dsfSchemaVersion', 'Project and Release use different DSF delivery versions.');
    }
    const fields = projectRelease.releaseKind === 'horizon-v2'
        ? ['dsfSchemaVersion', 'dsfContentUrl', 'dsfContentHash', 'dsfLangs', 'dsfPageCounts', 'dsfTotalBytes', 'defaultLang', 'pageCount']
        : ['dsfSchemaVersion', 'dsfPages', 'dsfLangs', 'defaultLang', 'pageCount'];
    for (const field of fields) {
        if (!sameValue(projectRelease.deliveryFields[field], canonicalRelease.deliveryFields[field])) {
            fail('WORKS_PUBLICATION_DELIVERY_MISMATCH', `release.${field}`, `Project and Release disagree on ${field}.`);
        }
    }
}

function assertCanonicalV2Language(release, projection) {
    if (projection.releaseKind !== 'horizon-v2') return;
    if (typeof release.defaultLang !== 'string'
        || !release.defaultLang
        || release.defaultLang !== release.defaultLang.trim()
        || !projection.languages.includes(release.defaultLang)) {
        fail('WORKS_PUBLICATION_DEFAULT_LANGUAGE_INVALID', 'release.defaultLang', 'Release default language must be an exact published language.');
    }
    const expectedPageCount = projection.deliveryFields.dsfPageCounts[release.defaultLang];
    if ((release.pageCount !== undefined && release.pageCount !== expectedPageCount)
        || (release.dsfPageCount !== undefined && release.dsfPageCount !== expectedPageCount)) {
        fail('WORKS_PUBLICATION_DEFAULT_PAGE_COUNT_MISMATCH', 'release.pageCount', 'Release default-language page count is stale.');
    }
}

function normalizeAuthorProfile(account = {}, fallbackName = '') {
    const profile = isRecord(account.publicProfile) ? account.publicProfile : {};
    const displayName = String(profile.displayName || fallbackName || '').trim();
    const handle = String(profile.handle || account.handle || '').trim() || null;
    return {
        displayName,
        handle,
        avatarUrl: String(profile.avatarUrl || '').trim(),
        backgroundUrl: String(profile.backgroundUrl || '').trim(),
        bio: String(profile.bio || ''),
    };
}

function firstPageThumbnail(data) {
    if (typeof data.thumbnail === 'string' && data.thumbnail) return data.thumbnail;
    if (typeof data.listThumbnail === 'string' && data.listThumbnail) return data.listThumbnail;
    const firstDsfPage = Array.isArray(data.dsfPages) ? data.dsfPages[0] : null;
    if (isRecord(firstDsfPage?.urls)) {
        const firstUrl = Object.values(firstDsfPage.urls).find((value) => typeof value === 'string' && value);
        if (firstUrl) return firstUrl;
    }
    const sourcePage = Array.isArray(data.pages)
        ? data.pages.find((page) => page?.content?.thumbnail || page?.content?.background)
        : null;
    return sourcePage?.content?.thumbnail || sourcePage?.content?.background || null;
}

function validateCanonicalIdentity({ uid, projectId, workId, releaseId, project, work, release }) {
    assertOptionalExactId(project.projectId, projectId, 'project.projectId');
    assertOptionalExactId(project.workId, workId, 'project.workId');
    assertOptionalExactId(project.releaseId, releaseId, 'project.releaseId');

    if (!isRecord(work) || !isRecord(release)) {
        fail('WORKS_PUBLICATION_CANONICAL_RELEASE_MISSING', 'work/release', 'The current Work and Release documents are required for this publication.');
    }
    if (work.workId !== workId
        || work.ownerUid !== uid
        || work.projectId !== projectId
        || work.latestProjectId !== projectId
        || work.latestReleaseId !== releaseId) {
        fail('WORKS_PUBLICATION_WORK_MISMATCH', 'work', 'Work does not point to the selected Project and Release.');
    }
    if (release.releaseId !== releaseId || release.workId !== workId || release.projectId !== projectId) {
        fail('WORKS_PUBLICATION_RELEASE_MISMATCH', 'release', 'Release does not point back to the selected Project and Work.');
    }
}

function assertPublicIndexOwnership(publicIndexes, workId, uid) {
    const existing = publicIndexes[workId];
    if (existing && existing.authorUid !== uid) {
        fail('WORKS_PUBLICATION_PUBLIC_INDEX_OWNERSHIP', `publicIndexes.${workId}`, 'The canonical public index belongs to another owner.');
    }
}

function buildPublicPayload({
    uid,
    projectId,
    workId,
    releaseId,
    project,
    work,
    release,
    projection,
    status,
    publication,
    account,
    fallbackAuthorName,
}) {
    const profile = normalizeAuthorProfile(account, fallbackAuthorName);
    const metadata = isRecord(work) ? work : project;
    const releaseMetadata = isRecord(release) ? release : project;
    return {
        title: metadata.title || project.title || '無題のプロジェクト',
        projectId,
        workId,
        releaseId: releaseId || null,
        authorUid: uid,
        authorName: profile.displayName,
        authorHandle: profile.handle,
        authorAvatarUrl: profile.avatarUrl,
        authorProfile: profile,
        thumbnail: firstPageThumbnail(project),
        dsfStatus: status,
        publication: deepClone(publication),
        dsfPublishedAt: releaseMetadata.dsfPublishedAt || project.dsfPublishedAt || null,
        dsfRenderStamp: releaseMetadata.dsfRenderStamp || project.dsfRenderStamp || null,
        dsfResolution: releaseMetadata.dsfResolution || project.dsfResolution || '',
        dsfQuality: releaseMetadata.dsfQuality ?? project.dsfQuality ?? null,
        dsfQualityMode: releaseMetadata.dsfQualityMode || project.dsfQualityMode || '',
        dsfQualityProfile: deepClone(releaseMetadata.dsfQualityProfile || project.dsfQualityProfile || null),
        dsfTotalBytes: projection.deliveryFields.dsfTotalBytes || project.dsfTotalBytes || 0,
        book: deepClone(releaseMetadata.book || project.book || null),
        bookMode: releaseMetadata.bookMode || releaseMetadata.book?.mode || project.bookMode || project.book?.mode || 'simple',
        languageConfigs: deepClone(project.languageConfigs || {}),
        languages: [...projection.languages],
        defaultLang: projection.defaultLang,
        labelName: metadata.labelName || project.labelName || '',
        rating: metadata.rating || project.rating || 'all',
        license: metadata.license || project.license || 'all-rights-reserved',
        meta: deepClone(metadata.meta || project.meta || {}),
        ...deepClone(projection.deliveryFields),
    };
}

export class WorksPublicationTransitionError extends Error {
    constructor(code, path, message) {
        super(message);
        this.name = 'WorksPublicationTransitionError';
        this.code = code;
        this.path = path;
    }
}

/**
 * Validate one publication transition and return the exact writes to stage.
 * `updatedAt` is intentionally added by the Firestore boundary so this module
 * never needs to clone or freeze a serverTimestamp sentinel.
 */
export function createWorksPublicationTransition(input = {}) {
    if (!isRecord(input)) fail('WORKS_PUBLICATION_INPUT_INVALID', '', 'Publication transition input must be an object.');
    const uid = assertId(input.uid, 'uid');
    const projectId = assertId(input.projectId, 'projectId');
    const status = String(input.status || '').trim();
    if (!ALL_STATUSES.has(status)) fail('WORKS_PUBLICATION_STATUS_INVALID', 'status', 'Unsupported DSF publication status.');
    if (!isRecord(input.project)) fail('WORKS_PUBLICATION_PROJECT_MISSING', 'project', 'The owner Project document is required.');
    if (!isRecord(input.publication)) fail('WORKS_PUBLICATION_WINDOW_INVALID', 'publication', 'A normalized publication window is required.');

    const project = input.project;
    const workId = assertId(String(project.workId || projectId), 'project.workId');
    const releaseId = String(project.releaseId || '').trim();
    const allowedContentOrigins = Array.isArray(input.allowedContentOrigins) ? input.allowedContentOrigins : [];
    const projectProjection = resolveWorksDsfRelease(project, {
        uid,
        workId,
        releaseId,
        allowedContentOrigins,
    });

    let work = isRecord(input.work) ? input.work : null;
    let release = isRecord(input.release) ? input.release : null;
    let projection = projectProjection;
    let identityMode = 'legacy-project-v1';

    if (projectProjection.releaseKind === 'horizon-v2' || work || release) {
        assertId(releaseId, 'project.releaseId');
        validateCanonicalIdentity({ uid, projectId, workId, releaseId, project, work, release });
        projection = resolveWorksDsfRelease(release, {
            uid,
            workId,
            releaseId,
            allowedContentOrigins,
        });
        assertCanonicalV2Language(release, projection);
        assertSameDelivery(projectProjection, projection);
        identityMode = 'canonical-release';
    } else if (releaseId) {
        fail('WORKS_PUBLICATION_CANONICAL_RELEASE_MISSING', 'work/release', 'A referenced Release must have matching Work and Release documents.');
    }

    const publicIndexes = isRecord(input.publicIndexes) ? input.publicIndexes : {};
    assertPublicIndexOwnership(publicIndexes, workId, uid);
    const legacyProjectIndex = workId !== projectId ? publicIndexes[projectId] : null;
    const deleteDocumentIds = [];
    if (publicIndexes[workId]) deleteDocumentIds.push(workId);
    if (legacyProjectIndex?.authorUid === uid) deleteDocumentIds.push(projectId);

    const visible = VISIBLE_STATUSES.has(status);
    const projectPatch = {
        dsfStatus: status,
        visibility: visible ? status : 'private',
        publication: deepClone(input.publication),
    };
    const publicIndex = visible
        ? {
            documentId: workId,
            payload: buildPublicPayload({
                uid,
                projectId,
                workId,
                releaseId,
                project,
                work,
                release,
                projection,
                status,
                publication: input.publication,
                account: input.account,
                fallbackAuthorName: input.fallbackAuthorName,
            }),
        }
        : null;

    return deepFreeze({
        workId,
        releaseId: releaseId || null,
        releaseKind: projection.releaseKind,
        identityMode,
        projectPatch,
        publicIndex,
        deleteDocumentIds: [...new Set(deleteDocumentIds.filter((documentId) => documentId !== publicIndex?.documentId))],
    });
}
