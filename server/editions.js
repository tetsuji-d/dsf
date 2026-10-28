import { normalizeEmbedPolicy } from '../js/embed-policy.js';
import { check, segment, AuthoringApiError, parseJson, readBounded } from './private-authoring/common.js';
import { createGoogleClient, createIdTokenVerifier } from './private-authoring/google-auth.js';
import { createFirestoreStore } from './private-authoring/firestore.js';
import { assertPersonalMutation } from './private-authoring/shared-boundary.js';
import { editionIdFor, nextEditionStatus } from '../js/edition-policy.js';
import { createWorksPublicationTransition } from '../js/works-publication-transition.js';
import { reconcilePublicationForPlan, isPublicationActive, toDate } from '../js/publication.js';
import { assignedPublishingSpace } from '../js/publishing-space-policy.js';
import { editionStorageTombstone } from './edition-storage.js';
import { createProjectSummaryForPatch } from '../js/project-summary.js';

const visible = status => ['public', 'unlisted'].includes(status);
const publicPath = id => `public_editions/${id}`;
const reply = (value, status = 200) => Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin',
} });

/** Only server transactions mutate lifecycle. Release/source bytes are never rewritten. */
export function createEditionsService({ db, bucket, assertLiveIdentity, publicBaseUrl, requirePublishingSpace = false, now = Date.now }) {
    async function execute(identity, command) {
        const uid = segment(identity?.uid), workId = segment(command?.workId), releaseId = segment(command?.releaseId);
        check(['context', 'public', 'unlisted', 'private', 'archive', 'restore', 'discard', 'successor', 'label', 'embed', 'stats'].includes(command.action), 'EDITION_ACTION_INVALID', 400);
        const editionId = await editionIdFor(uid, workId, releaseId);
        const workPath = `users/${uid}/works/${workId}`, releasePath = `${workPath}/releases/${releaseId}`;
        const statePath = `${workPath}/edition_states/${releaseId}`, indexPath = publicPath(editionId);
        await assertLiveIdentity(identity);
        const result = await db.transaction(async tx => {
            const [account, work, release, stored, edition] = await tx.getMany([`users/${uid}`, workPath, releasePath, statePath, indexPath]);
            check(account?.uid === uid && account.status?.disabled === false, 'ACCOUNT_UNAVAILABLE', 403);
            check(work?.ownerUid === uid && work.workId === workId, 'EDITION_OWNER_REQUIRED', 403);
            check(!edition || (edition.authorUid === uid && edition.workId === workId && edition.releaseId === releaseId), 'EDITION_ID_CONFLICT', 409);
            check(release || stored?.status === 'disposed', 'EDITION_NOT_FOUND', 404);
            if (release) check(release.workId === workId && release.releaseId === releaseId && release.projectId === work.projectId, 'EDITION_IDENTITY_INVALID', 409);
            const projectId = segment(work.projectId);
            const projectPath = `users/${uid}/projects/${projectId}`;
            const [project, catalogue] = await tx.getMany([projectPath, `users/${uid}/publishing/catalogue`]);
            await assertPersonalMutation(tx, uid, projectId, { ...project, workId });
            const legacyPaths = [...new Set([workId, projectId])].map(id => `public_projects/${id}`);
            const legacy = await tx.getMany(legacyPaths);
            const matching = legacy.find(index => index?.authorUid === uid && index.workId === workId && index.releaseId === releaseId);
            const current = stored || {
                schemaVersion: 1, editionId, workId, releaseId, projectId, revision: 0,
                status: visible(matching?.dsfStatus) ? matching.dsfStatus : 'private',
                publication: matching?.publication || release?.publication || {},
                firstPublishedAtMs: matching ? toDate(matching.dsfPublishedAt)?.getTime() || now() : null,
                publicSnapshot: matching || null, successorEditionId: null,
            };
            check(current.editionId === editionId && Number.isSafeInteger(current.revision), 'EDITION_STATE_INVALID', 409);
            if (command.action === 'context') return current;
            if (command.action === 'stats') { const [counts] = await tx.getMany(["reader_view_totals/" + editionId]); return {...current, viewCounts: counts || {views:0,embed:0,reader:0}}; }
            segment(command.requestId);
            check(Number.isSafeInteger(command.baseRevision) && command.baseRevision >= 0, 'EDITION_REVISION_INVALID', 400);
            const signature = JSON.stringify([command.action, command.baseRevision, command.successorReleaseId ?? null, command.editionLabel ?? null, command.embedPolicy ?? null]);
            if (current.requestId === command.requestId) {
                check(current.signature === signature, 'EDITION_REQUEST_REUSED', 409); return current;
            }
            check(current.revision === command.baseRevision, 'EDITION_CHANGED', 409);
            let status;
            try { status = nextEditionStatus(current.status, command.action); }
            catch (error) { throw new AuthoringApiError(error.message, 409); }
            check(command.action !== 'discard' || bucket, 'EDITION_STORAGE_UNAVAILABLE', 503);
            let snapshot = current.publicSnapshot, publication = current.publication;
            const moderationRejected = current.moderationRejected === true || edition?.moderationRejected === true
                || edition?.dsfStatus === 'rejected'
                || legacy.some(index => index?.releaseId === releaseId && (index.dsfStatus === 'rejected' || index.moderationRejected === true));
            if (visible(status) && (!stored || !edition || !['successor', 'label', 'embed', 'stats'].includes(command.action))) {
                check(account.status?.moderationHold !== true && !work.rejected && release?.dsfStatus !== 'rejected'
                    && !moderationRejected, 'EDITION_PUBLICATION_BLOCKED', 403);
                check(!project?.projectTrash, 'PROJECT_TRASHED', 409);
                if (requirePublishingSpace) check(assignedPublishingSpace(catalogue, projectId), 'PUBLISHING_SPACE_REQUIRED', 409);
                publication = reconcilePublicationForPlan(publication, status, account, new Date(now()));
                check(isPublicationActive(publication, status, new Date(now())), 'EDITION_PUBLICATION_EXPIRED', 409);
                {
                    if (release.dsfSchemaVersion !== 2) {
                        const prefix = `${publicBaseUrl}/users/${uid}/dsf/${workId}/${releaseId}/`;
                        const urls = (release.dsfPages || []).flatMap(page => Object.values(page.urls || {}));
                        check(urls.length > 0 && urls.every(url => typeof url === 'string' && url.startsWith(prefix)), 'EDITION_LEGACY_STORAGE_MIGRATION_REQUIRED', 409);
                    }
                    // Validate a selected historical Release without substituting current manuscript delivery fields.
                    const source = snapshot || { ...release, title: release.title || work.title || '', meta: release.meta || work.meta || {},
                        defaultLang: release.defaultLang || release.dsfLangs?.[0], workId, releaseId, projectId };
                    const canonicalWork = { ...work, title: source.title, meta: source.meta,
                        latestReleaseId: releaseId, latestProjectId: projectId };
                    const verified = createWorksPublicationTransition({ uid, projectId, project: source, work: canonicalWork,
                        release, status, publication, account, publicIndexes: {},
                        allowedContentOrigins: [new URL(publicBaseUrl).origin], publicationThumbnailR2BaseUrl: publicBaseUrl,
                    }).publicIndex.payload;
                    if (!snapshot) snapshot = verified;
                }
            }
            let successorEditionId = current.successorEditionId || null;
            let embedPolicy = current.embedPolicy || normalizeEmbedPolicy();
            if (command.action === 'embed') {
                try { embedPolicy = normalizeEmbedPolicy(command.embedPolicy); } catch (error) { check(false, error.message, 422); }
            }
            let editionLabel = current.editionLabel || '';
            if (command.action === 'label') {
                check(typeof command.editionLabel === 'string' && command.editionLabel.trim().length <= 80
                    && !/[\u0000-\u001f\u007f]/u.test(command.editionLabel), 'EDITION_LABEL_INVALID', 422);
                editionLabel = command.editionLabel.trim();
            }
            if (command.action === 'successor') {
                successorEditionId = null;
                if (command.successorReleaseId) {
                    const successorReleaseId = segment(command.successorReleaseId);
                    check(successorReleaseId !== releaseId, 'EDITION_SUCCESSOR_INVALID', 409);
                    successorEditionId = await editionIdFor(uid, workId, successorReleaseId);
                    let cursor = successorEditionId;
                    const seen = new Set([editionId]);
                    for (let depth = 0; cursor; depth++) {
                        check(depth < 32 && !seen.has(cursor), 'EDITION_SUCCESSOR_CYCLE', 409); seen.add(cursor);
                        const [target] = await tx.getMany([publicPath(cursor)]);
                        check(target?.authorUid === uid && target.workId === workId, 'EDITION_SUCCESSOR_INVALID', 409);
                        if (depth === 0) check(visible(target.dsfStatus) && isPublicationActive(target.publication, target.dsfStatus, new Date(now())), 'EDITION_SUCCESSOR_UNAVAILABLE', 409);
                        cursor = target.successorEditionId;
                    }
                }
            }
            const next = { ...current, revision: current.revision + 1, status, publication,
                moderationRejected,
                firstPublishedAtMs: current.firstPublishedAtMs || (visible(status) ? now() : null),
                publicSnapshot: status === 'disposed' ? null : snapshot,
                successorEditionId, editionLabel, embedPolicy, requestId: command.requestId, signature, updatedAtMs: now(),
                cleanupPending: status === 'disposed',
            };
            const tombstone = { editionId, workId, releaseId, projectId, authorUid: uid,
                dsfStatus: status, successorEditionId, editionLabel, moderationRejected, updatedAt: new Date(now()) };
            tx.set(statePath, next);
            tx.set(indexPath, visible(status) ? { ...snapshot, ...tombstone, publication } : tombstone);
            legacy.forEach((index, i) => {
                if (index?.authorUid !== uid || index.releaseId !== releaseId) return;
                // Old links remain permanently bound to the same Release.
                tx.set(legacyPaths[i], { ...(visible(status) ? snapshot : { authorUid: uid, workId, releaseId, projectId }), dsfStatus: visible(status) ? status : 'private',
                    editionId, successorEditionId, moderationRejected, publication, updatedAt: new Date(now()) });
            });
            return next;
        });
        if (result.status === 'disposed' && result.cleanupPending && command.action === 'discard') {
            await bucket.put(editionStorageTombstone(uid, workId, releaseId), 'disposed', { httpMetadata: { contentType: 'text/plain' } });
            // Repeated first-page deletion is restartable; never enumerate another edition's prefix.
            const prefix = `users/${uid}/dsf/${workId}/${releaseId}/`;
            const page = await bucket.list({ prefix, limit: 100 });
            check(Array.isArray(page.objects) && page.objects.every(object => object.key.startsWith(prefix)), 'EDITION_STORAGE_INVALID');
            if (page.objects.length) await bucket.delete(page.objects.map(object => object.key));
            const remaining = await bucket.list({ prefix, limit: 1 });
            if (remaining.objects.length || remaining.truncated) return { ...result, cleanupPending: true };
            return db.transaction(async tx => {
                const projectPath = `users/${uid}/projects/${result.projectId}`;
                const summaryPath = `users/${uid}/project_summaries/${result.projectId}`;
                const [stored, release, project] = await tx.getMany([statePath, releasePath, projectPath, summaryPath]);
                check(stored?.status === 'disposed', 'EDITION_CHANGED', 409);
                // Old v1 assets outside a dedicated release prefix cannot be safely deleted here.
                const urls = (release?.dsfPages || []).flatMap(page => Object.values(page.urls || {}));
                const managed = urls.every(url => typeof url === 'string' && url.startsWith(`${publicBaseUrl}/${prefix}`));
                check(managed, 'EDITION_LEGACY_STORAGE_MIGRATION_REQUIRED', 409);
                const done = { ...stored, cleanupPending: false, cleanupCompletedAtMs: now() };
                if (release) tx.delete(releasePath);
                if (project?.releaseId === releaseId) {
                    const cleared = { ...project, releaseId: null, dsfPages: [], dsfStatus: null, visibility: 'private', dsfTotalBytes: 0 };
                    for (const key of ['dsfContentUrl', 'dsfContentHash', 'dsfPageCounts', 'dsfSchemaVersion']) delete cleared[key];
                    tx.set(projectPath, cleared);
                    tx.set(summaryPath, createProjectSummaryForPatch(cleared, {}, { projectId: result.projectId }));
                }
                tx.set(statePath, done); return done;
            });
        }
        return result;
    }
    return { execute };
}

export function createEditionsApi({ service, verifyToken }) {
    return async ({ request }) => {
        try {
            check(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
            const origin = request.headers.get('Origin');
            check((!origin || origin === new URL(request.url).origin) && request.headers.get('Sec-Fetch-Site') !== 'cross-site', 'ORIGIN_FORBIDDEN', 403);
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''), 'CONTENT_TYPE_INVALID', 415);
            check(!request.headers.has('Content-Encoding') || request.headers.get('Content-Encoding') === 'identity', 'CONTENT_ENCODING_INVALID', 415);
            const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
            check(token, 'AUTH_REQUIRED', 401);
            const identity = await verifyToken(token[1]);
            return reply(await service.execute(identity, parseJson(await readBounded(request.body, 4096))));
        } catch (error) {
            const known = error instanceof AuthoringApiError || /^WORKS_PUBLICATION_/.test(error.code || '');
            return reply({ error: known ? error.code : 'EDITION_UNAVAILABLE' }, known ? error.status || 422 : 503);
        }
    };
}
const runtimes = new WeakMap();
export async function handleEditions(context) {
    try {
        let handler = runtimes.get(context.env);
        if (!handler) {
            const google = createGoogleClient({ projectId: context.env.FIREBASE_PROJECT_ID, serviceAccountJson: context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT });
            const db = createFirestoreStore(google, { additionalRootCollections: ['reader_view_totals', 'public_editions', 'publishing_work_scopes', 'publishing_spaces', 'publishing_labels'] });
            handler = createEditionsApi({ verifyToken: createIdTokenVerifier({ projectId: context.env.FIREBASE_PROJECT_ID }),
                service: createEditionsService({ db, bucket: context.env.R2_BUCKET, assertLiveIdentity: google.assertLiveIdentity,
                    publicBaseUrl: context.env.R2_PUBLIC_URL, requirePublishingSpace: context.env.PUBLISHING_SPACE_REQUIRED === 'true' }) });
            runtimes.set(context.env, handler);
        }
        return await handler(context);
    } catch { return reply({ error: 'EDITION_UNAVAILABLE' }, 503); }
}
