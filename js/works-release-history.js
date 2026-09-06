/** Read-only history projection. No Firebase, network, DOM, clock or write plan. */
import { resolveWorksDsfRelease } from './works-dsf-release.js';
import { resolveProjectCanonicalTitle } from './project-display-title.js';
import { selectProjectListingThumbnail, isManagedPublicationThumbnailUrl } from './project-listing-thumbnail.js';
import { toDate, isPublicationActive, reconcilePublicationForPlan } from './publication.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
export const RELEASE_HISTORY_REASONS = Object.freeze([
    'identity', 'metadata', 'account', 'title', 'thumbnail', 'period',
    'not_checked', 'incomplete', 'missing', 'mismatch', 'legacy_evidence', 'unavailable',
]);

export function releaseInspectionKey({ uid, workId, releaseId, release = {} }) {
    return JSON.stringify([uid, workId, releaseId, release.dsfSchemaVersion,
        release.dsfContentUrl, release.dsfContentHash, release.dsfPages,
        release.dsfLangs, release.dsfPageCounts, release.defaultLang, release.dsfTotalBytes, release.thumbnail]);
}

export function projectReleaseHistory(input) {
    const { uid, workId, releaseId, projectId, release = {}, work, project, publicIndex, account, now } = input;
    if (!Number.isFinite(now)) throw new TypeError('History evaluation requires an explicit time.');
    const reasons = [];
    const snapshotIdentityValid = [uid, workId, releaseId, projectId].every(value => ID.test(value || ''))
        && release.releaseId === releaseId && release.workId === workId && release.projectId === projectId
        && (!release.ownerUid || release.ownerUid === uid) && (!release.authorUid || release.authorUid === uid) && (!release.uid || release.uid === uid)
        && !!work && work.workId === workId && work.ownerUid === uid
        && work.projectId === projectId && (!work.latestProjectId || work.latestProjectId === projectId);
    const identityValid = snapshotIdentityValid
        && !!project && (project.workId || projectId) === workId
        && (!project.uid || project.uid === uid) && (!project.ownerUid || project.ownerUid === uid)
        && (!project.authorUid || project.authorUid === uid);
    if (!identityValid) reasons.push('identity');
    let projection = null;
    try {
        projection = resolveWorksDsfRelease(release, { uid, workId, releaseId, allowedContentOrigins: input.allowedContentOrigins || [] });
        if (!projection.languages.length) throw new Error('Missing release languages');
        if (projection.schemaVersion === 2 && release.defaultLang !== projection.defaultLang) throw new Error('Invalid canonical language');
    } catch { reasons.push('metadata'); }
    const selectedThumbnail = selectProjectListingThumbnail({}, { release });
    const managedThumbnail = isManagedPublicationThumbnailUrl(selectedThumbnail, {
        ownerUid: uid, r2PublicBaseUrl: input.r2PublicBaseUrl,
        firebaseStorageBucket: input.firebaseStorageBucket,
    });
    let safeLegacyThumbnail = false;
    try {
        const url = new URL(selectedThumbnail);
        safeLegacyThumbnail = projection?.schemaVersion === 1 && input.allowedContentOrigins?.includes(url.origin)
            && url.pathname.startsWith(`/users/${uid}/dsf/${workId}/${releaseId}/`)
            && !url.search && !url.hash && !url.username && !url.password;
    } catch { /* no safe snapshot thumbnail */ }
    const thumbnail = managedThumbnail || safeLegacyThumbnail ? selectedThumbnail : '';
    if (projection?.schemaVersion === 2 && !managedThumbnail) reasons.push('thumbnail');
    if (!account || account.status?.disabled || account.status?.moderationHold) reasons.push('account');
    if (!resolveProjectCanonicalTitle(work || {})) reasons.push('title');
    // Evaluate today's policy without renewing a release's original listing start.
    if (!toDate(release.publication?.listedFrom)) reasons.push('period');
    else {
        const candidate = reconcilePublicationForPlan(release.publication, 'public', account || {}, new Date(now));
        if (!isPublicationActive(candidate, 'public', new Date(now))
            || toDate(candidate.listedUntil)?.getTime() <= now
            || (toDate(candidate.publicUntil) && toDate(candidate.publicUntil).getTime() <= now)) reasons.push('period');
    }
    const checked = input.inspection?.key === releaseInspectionKey(input) ? input.inspection : null;
    const integrity = checked?.status || 'not_checked';
    if (integrity !== 'verified') reasons.push(RELEASE_HISTORY_REASONS.includes(checked?.reason) ? checked.reason : 'not_checked');
    const hardFailure = reasons.some(reason => ['identity', 'metadata', 'account', 'title', 'thumbnail', 'period', 'missing', 'mismatch'].includes(reason));
    const referencedByPublic = !!publicIndex && publicIndex.authorUid === uid
        && publicIndex.workId === workId && publicIndex.releaseId === releaseId;
    const isCurrentPublic = referencedByPublic && ['public', 'unlisted'].includes(publicIndex.dsfStatus)
        && isPublicationActive(publicIndex.publication || {}, publicIndex.dsfStatus, new Date(now))
        && !publicIndex.publication?.expiredAt && !publicIndex.publication?.expireReason
        && !!toDate(publicIndex.publication?.listedUntil) && toDate(publicIndex.publication.listedUntil).getTime() > now
        && !!toDate(publicIndex.publication?.publicFrom)
        && (!toDate(publicIndex.publication?.publicUntil) || toDate(publicIndex.publication.publicUntil).getTime() > now);
    const schemaVersion = projection?.schemaVersion || null;
    const pageCounts = checked?.pageCounts || projection?.deliveryFields.dsfPageCounts
        || Object.fromEntries((projection?.languages || []).map(lang => [lang, projection.pageCount]));
    return Object.freeze({
        releaseId: ID.test(releaseId || '') ? releaseId : '—',
        publishedAt: toDate(release.dsfPublishedAt || release.createdAt)?.getTime() ?? null,
        schemaVersion, languages: projection?.languages || [], pageCounts,
        kindsByLanguage: checked?.kindsByLanguage || null,
        totalBytes: Number.isSafeInteger(release.dsfTotalBytes) && release.dsfTotalBytes > 0 ? release.dsfTotalBytes : null,
        hash: schemaVersion === 2 && HASH.test(release.dsfContentHash || '') ? release.dsfContentHash : null,
        thumbnail, isLatest: work?.latestReleaseId === releaseId, referencedByPublic, isCurrentPublic,
        integrity, checkedAt: checked?.checkedAt || null,
        eligibility: reasons.length === 0 ? 'eligible' : hardFailure ? 'blocked' : 'unknown',
        reasons: Object.freeze([...new Set(reasons)]),
        canPreview: identityValid && !!projection,
        canInspect: snapshotIdentityValid && !!projection,
    });
}
