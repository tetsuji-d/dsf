import { check, segment } from './common.js';
import { paths, readContext, usageValue, AUTHORING_LIMITS } from './service.js';
import { createPrivateAuthoringSnapshot, assertPrivateAuthoringHead } from '../../js/private-authoring-storage.js';
import { createProjectSummaryForPatch } from '../../js/project-summary.js';
import { createFlowPressHorizonDraftWrite } from '../../js/flow-press-horizon-draft-write.js';
import { createWorksPublicationTransition } from '../../js/works-publication-transition.js';
import { createDefaultPublication, reconcilePublicationForPlan, planAllowsPublicScheduling, getPublicationExpireReason, toDate } from '../../js/publication.js';
import { resolveWorksDsfRelease } from '../../js/works-dsf-release.js';
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const descriptor = ({ revision, ...value }) => value;
async function digest(value) {
    const hash = await crypto.subtle.digest('SHA-256', bytes(value));
    return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function bounded(value) { check(bytes(value).length <= 700 * 1024, 'METADATA_TOO_LARGE', 422); return value; }
function assertBase(context, command) {
    check(context.control.generationId === command.generationId && context.head?.revision === command.baseRevision
        && (context.control.mutationRevision || 0) === command.mutationRevision, 'AUTHORING_REVISION_CONFLICT', 409);
}
export function createProjectActions({ db, bucket, service, assertLiveIdentity, verifyRelease, publicBaseUrl, now = Date.now }) {
    const origins = () => [new URL(publicBaseUrl).origin];
    async function gate(identity, projectId, command) {
        await assertLiveIdentity(identity);
        return db.transaction(async tx => {
            const p = paths(identity.uid, projectId);
            const [account, control, usage] = await tx.getMany([p.account, p.control, p.usage]);
            check(account?.uid === identity.uid && account.status?.disabled === false, 'ACCOUNT_NOT_EDITABLE', 403);
            check(control?.generationId === command.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
            check(control.status === 'active' || (command.kind === 'delete' && control.status === 'deleted'), 'AUTHORING_NOT_ACTIVE', 409);
            const next = usageValue(usage, now()); check(next.requestCount < AUTHORING_LIMITS.requestsPerMinute, 'RATE_LIMITED', 429);
            check(next.writeCount < AUTHORING_LIMITS.writesPerMinute, 'RATE_LIMITED', 429);
            next.requestCount++; next.writeCount++; tx.set(p.usage, next);
        });
    }
    async function replay(tx, p, operation, command) {
        check(operation.signature === await digest(command), 'AUTHORING_REQUEST_REUSED', 409);
        const [control, head] = await tx.getMany([p.control, p.head]);
        check(control?.generationId === command.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
        check(control.status === (command.kind === 'delete' ? 'deleted' : 'active')
            && (control.mutationRevision || 0) === operation.fence.mutationRevision
            && head?.revision === operation.fence.headRevision, 'AUTHORING_REVISION_CONFLICT', 409);
        return operation.result;
    }
    return {
        async context(identity, projectId) {
            const c = await service.access(identity, projectId);
            return { head: c.head, mutationRevision: c.control.mutationRevision || 0,
                previousRevisionId: c.control.previousHead?.revisionId || null,
                releaseId: c.root.releaseId || null, dsfStatus: c.root.dsfStatus || 'draft' };
        },
        async execute(identity, projectId, command) {
            check(command && ['draft', 'publication', 'delete', 'restore', 'profile', 'listing'].includes(command.kind), 'ACTION_INVALID', 400);
            segment(command.requestId); segment(command.generationId);
            check(Number.isSafeInteger(command.baseRevision) && command.baseRevision >= 1
                && Number.isSafeInteger(command.mutationRevision) && command.mutationRevision >= 0, 'ACTION_BASE_INVALID', 400);
            const payload = command.payload || {}, signature = await digest(command);
            const p = paths(identity.uid, projectId), actionPath = `${p.root}/authoringActions/${command.requestId}`;
            await gate(identity, projectId, command);
            const prior = await db.transaction(async tx => (await tx.getMany([actionPath]))[0]);
            if (prior) { check(prior.signature === signature, 'AUTHORING_REQUEST_REUSED', 409); if (prior.result) return db.transaction(tx => replay(tx, p, prior, command)); }
            const initial = await db.transaction(tx => readContext(tx, identity, projectId));
            if (command.kind === 'restore') {
                const previous = await db.transaction(async tx => {
                    const c = await readContext(tx, identity, projectId);
                    const [operation] = await tx.getMany([actionPath]);
                    if (operation) { check(operation.signature === signature, 'AUTHORING_REQUEST_REUSED', 409); return operation.restoreHead; }
                    assertBase(c, command);
                    check(c.control.previousHead?.revisionId === payload.revisionId, 'RESTORE_REVISION_UNAVAILABLE', 409);
                    const usage = usageValue(c.usage, now());
                    check(usage.operationCount < AUTHORING_LIMITS.operations, 'STORAGE_QUOTA_EXCEEDED', 429);
                    usage.operationCount++; tx.set(c.p.usage, usage);
                    tx.set(actionPath, { signature, restoreHead: c.control.previousHead, result: null });
                    return c.control.previousHead;
                });
                assertPrivateAuthoringHead(previous, initial.scope);
                const source = await bucket.read(descriptor(previous), initial.scope);
                const snapshot = await createPrivateAuthoringSnapshot(source.project);
                const result = await service.save(identity, projectId, { snapshot, requestId: command.requestId,
                    generationId: command.generationId, baseRevision: command.baseRevision });
                await db.transaction(async tx => {
                    const [operation] = await tx.getMany([actionPath]);
                    check(operation?.signature === signature, 'AUTHORING_REQUEST_REUSED', 409);
                    const [control, head] = await tx.getMany([p.control, p.head]);
                    check(control?.status === 'active' && control.generationId === command.generationId
                        && head?.revision === result.committedHead.revision, 'AUTHORING_REVISION_CONFLICT', 409);
                    tx.set(actionPath, { ...operation, result, fence: { headRevision: head.revision, mutationRevision: control.mutationRevision || 0 }, completedAt: new Date(now()) });
                });
                return result;
            }
            assertBase(initial, command);
            let savedSource = null, draft = null;
            if (command.kind === 'draft') {
                check(initial.account.status?.moderationHold !== true, 'ACCOUNT_CANNOT_PUBLISH', 403);
                savedSource = (await bucket.read(descriptor(initial.head), initial.scope)).project;
                const workId = segment(initial.root.workId), releaseId = segment(payload.upload?.identity?.releaseId || payload.releaseId);
                const publication = createDefaultPublication(initial.account, new Date(now()));
                if (payload.upload) {
                    check(payload.upload.identity.uid === identity.uid && payload.upload.identity.workId === workId, 'RELEASE_IDENTITY_INVALID', 422);
                    draft = createFlowPressHorizonDraftWrite({ upload: payload.upload, projectId, project: savedSource,
                        publication, bookConfig: payload.bookConfig, thumbnail: payload.thumbnail, renderStamp: now() });
                } else {
                    check(Array.isArray(payload.dsfPages) && payload.dsfPages.every(page => page && Object.keys(page).every(key => ['pageNum', 'pageType', 'workId', 'releaseId', 'urls', 'bytesByLang', 'totalBytes', 'spreadImage'].includes(key))), 'RELEASE_PAGES_INVALID', 422);
                    const projection = resolveWorksDsfRelease({ ...payload, workId, releaseId, defaultLang: savedSource.defaultLang }, { uid: identity.uid, workId, releaseId, allowedContentOrigins: origins() });
                    check(projection.releaseKind === 'webp-v1', 'RELEASE_KIND_INVALID', 422);
                    const release = { ...projection.deliveryFields, workId, releaseId, projectId,
                        book: payload.bookConfig?.book || null, bookMode: payload.bookConfig?.bookMode || 'simple',
                        languageConfigs: savedSource.languageConfigs || {}, thumbnail: payload.thumbnail,
                        dsfStatus: 'draft', publication, dsfRenderStamp: now(), dsfTotalBytes: 0,
                        dsfResolution: String(payload.dsfResolution || ''), dsfQuality: Number(payload.dsfQuality || 0) };
                    draft = { projectPatch: { ...release, visibility: 'private', meta: savedSource.meta || {} },
                        workPatch: { workId, projectId, ownerUid: identity.uid, title: savedSource.title || '',
                            latestReleaseId: releaseId, latestProjectId: projectId, thumbnail: payload.thumbnail,
                            publication, languages: savedSource.languages, defaultLang: savedSource.defaultLang }, releaseDocument: release };
                }
                const total = await verifyRelease({ uid: identity.uid, workId, releaseId, payload, metadata: draft.releaseDocument });
                if (!payload.upload) { draft.projectPatch.dsfTotalBytes = total; draft.releaseDocument.dsfTotalBytes = total; }
            }
            await assertLiveIdentity(identity);
            return db.transaction(async tx => {
                const c = await readContext(tx, identity, projectId);
                const [existingAction] = await tx.getMany([actionPath]);
                if (existingAction) return replay(tx, p, existingAction, command);
                assertBase(c, command);
                const workId = segment(c.root.workId), releaseId = draft?.releaseDocument.releaseId || c.root.releaseId;
                const workPath = `users/${identity.uid}/works/${workId}`;
                const releasePath = releaseId ? `${workPath}/releases/${segment(releaseId)}` : null;
                const indexPaths = [...new Set([workId, projectId])].map(id => `public_projects/${id}`);
                const related = [workPath, c.p.summary, ...indexPaths, ...(releasePath ? [releasePath] : [])];
                const [work, , ...remaining] = await tx.getMany(related);
                check(work?.ownerUid === identity.uid && work.projectId === projectId, 'WORK_ID_CONFLICT', 409);
                const indexes = remaining.slice(0, indexPaths.length), release = releasePath ? remaining.at(-1) : null;
                indexes.forEach(index => check(!index || index.authorUid === identity.uid, 'PUBLIC_INDEX_OWNER_CONFLICT', 409));
                const timestamp = new Date(now()); let result, patch = null;
                const publicIndexes = Object.fromEntries(indexPaths.map((path, i) => [path.split('/').at(-1), indexes[i]]));
                if (command.kind === 'delete') {
                    tx.delete(c.p.root); tx.delete(c.p.summary);
                    indexPaths.forEach(path => tx.delete(path));
                    tx.set(c.p.control, { ...c.control, status: 'deleted', deletedAt: timestamp, mutationRevision: command.mutationRevision + 1 });
                    result = { state: 'deleted', projectId };
                } else if (command.kind === 'draft') {
                    check(c.account.status?.moderationHold !== true, 'ACCOUNT_CANNOT_PUBLISH', 403);
                    check(!release, 'RELEASE_ALREADY_EXISTS', 409);
                    patch = bounded({ ...draft.projectPatch, dsfPublishedAt: timestamp });
                    tx.set(releasePath, bounded({ ...draft.releaseDocument, createdAt: timestamp, dsfPublishedAt: timestamp }));
                    tx.patch(workPath, bounded({ ...draft.workPatch, updatedAt: timestamp }));
                    indexPaths.forEach(path => tx.delete(path));
                    result = { state: 'committed', releaseId, projectPatch: patch };
                } else if (command.kind === 'publication') {
                    check(payload.expectedStatus === (c.root.dsfStatus || 'draft') && payload.expectedReleaseId === (c.root.releaseId || null), 'PUBLICATION_STATE_CONFLICT', 409);
                    check(['draft', 'private', 'public', 'unlisted'].includes(payload.status), 'PUBLICATION_STATUS_INVALID', 422);
                    if (['public', 'unlisted'].includes(payload.status)) check(c.account.status?.moderationHold !== true, 'ACCOUNT_CANNOT_PUBLISH', 403);
                    for (const key of ['publicFrom', 'publicUntil']) check(payload[key] == null || (typeof payload[key] === 'string' && toDate(payload[key])), 'PUBLICATION_WINDOW_INVALID', 422);
                    const previous = { ...c.root.publication };
                    if (planAllowsPublicScheduling(c.account, timestamp)) {
                        if (Object.hasOwn(payload, 'publicFrom')) previous.publicFrom = payload.publicFrom == null ? null : toDate(payload.publicFrom);
                        if (Object.hasOwn(payload, 'publicUntil')) previous.publicUntil = payload.publicUntil == null ? null : toDate(payload.publicUntil);
                        check(!previous.publicUntil || !previous.publicFrom || previous.publicUntil >= previous.publicFrom, 'PUBLICATION_WINDOW_INVALID', 422);
                    }
                    const publication = reconcilePublicationForPlan(previous, payload.status, c.account, timestamp);
                    const status = ['public', 'unlisted'].includes(payload.status) && getPublicationExpireReason(publication, payload.status, timestamp) ? 'draft' : payload.status;
                    const plan = createWorksPublicationTransition({ uid: identity.uid, projectId, project: c.root, work, release,
                        status, publication, account: c.account, publicIndexes, allowedContentOrigins: origins(), publicationThumbnailR2BaseUrl: publicBaseUrl });
                    patch = plan.projectPatch;
                    plan.deleteDocumentIds.forEach(id => tx.delete(`public_projects/${id}`));
                    if (plan.publicIndex) tx.set(`public_projects/${plan.publicIndex.documentId}`, bounded({ ...plan.publicIndex.payload, authoringBackend: 'r2-private', updatedAt: timestamp }));
                    result = plan;
                } else if (command.kind === 'profile') {
                    const profile = c.account.publicProfile || {};
                    const profilePatch = { authorName: profile.displayName || '', authorHandle: profile.handle || null,
                        authorAvatarUrl: profile.avatarUrl || '', authorProfile: { displayName: profile.displayName || '',
                            handle: profile.handle || null, avatarUrl: profile.avatarUrl || '', backgroundUrl: profile.backgroundUrl || '', bio: profile.bio || '' }, updatedAt: timestamp };
                    indexPaths.forEach((path, i) => { if (indexes[i]) tx.patch(path, bounded(profilePatch)); });
                    result = { state: 'committed' };
                } else if (command.kind === 'listing') {
                    check(Number.isSafeInteger(payload.projectBytes) && payload.projectBytes >= c.head.byteLength
                        && payload.projectBytes <= 1024 ** 4 && Number.isSafeInteger(payload.pageCount) && payload.pageCount >= 0 && payload.pageCount <= 100_000,
                    'LISTING_INVALID', 422);
                    check(typeof payload.listThumbnail === 'string' && payload.listThumbnail.length <= 2048
                        && (!payload.listThumbnail || payload.listThumbnail.startsWith(`${publicBaseUrl}/users/${identity.uid}/`)), 'LISTING_INVALID', 422);
                    patch = { projectBytes: payload.projectBytes, pageCount: payload.pageCount, listThumbnail: payload.listThumbnail };
                    result = { state: 'committed' };
                }
                if (patch) { bounded({ ...c.root, ...patch }); tx.patch(c.p.root, patch); tx.set(c.p.summary, createProjectSummaryForPatch(c.root, patch, { projectId })); }
                if (command.kind !== 'delete') tx.set(c.p.control, { ...c.control, mutationRevision: command.mutationRevision + 1 });
                const usage = usageValue(c.usage, now()); check(usage.operationCount < AUTHORING_LIMITS.operations, 'STORAGE_QUOTA_EXCEEDED', 429);
                usage.operationCount++; tx.set(c.p.usage, usage);
                tx.set(actionPath, { signature, result: bounded(result), fence: { headRevision: c.head.revision, mutationRevision: command.mutationRevision + 1 }, completedAt: timestamp });
                return result;
            });
        },
    };
}
