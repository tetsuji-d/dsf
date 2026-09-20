import { check, segment } from './common.js';
import { paths, usageValue, AUTHORING_LIMITS, AUTHORING_LEASE_MS, metadataPatch } from './service.js';
import { createPrivateAuthoringDescriptor } from '../../js/private-authoring-storage.js';
import { createProjectSummary } from '../../js/project-summary.js';

// Reserve an ID without exposing an empty project. Root, head, Work and summary
// become visible together only after the immutable source has been verified.
export function createProjectCreation({ db, bucket, assertLiveIdentity, now = Date.now }) {
    const accountOK = (account, identity) => {
        check(account?.uid === identity.uid && account.status?.disabled === false, 'ACCOUNT_NOT_EDITABLE', 403);
        check(account.entitlements?.canCreateProject === true, 'PROJECT_CREATION_FORBIDDEN', 403);
    };
    async function context(tx, identity, projectId, requestId, workId) {
        const p = paths(identity.uid, projectId, requestId);
        const work = `users/${identity.uid}/works/${segment(workId)}`, legacy = p.root + '/authoring/current';
        const rows = await tx.getMany([p.account, p.root, p.control, p.head, p.usage, p.operation, p.summary, work, legacy]);
        const [account, root, control, head, usage, operation, summary, existingWork, oldSource] = rows;
        accountOK(account, identity);
        return { p, work, account, root, control, head, usage, operation, summary, existingWork, oldSource };
    }
    function replay(c, descriptor, workId) {
        const creation = c.control?.creation;
        if (!creation) {
            check(!c.root && !c.control && !c.head && !c.operation && !c.summary && !c.existingWork && !c.oldSource,
                'PROJECT_ALREADY_EXISTS', 409);
            return null;
        }
        check(creation.workId === workId && Object.keys(descriptor).every(k => creation.descriptor[k] === descriptor[k]),
            'AUTHORING_REQUEST_REUSED', 409);
        check(c.control.generationId === descriptor.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
        if (creation.state === 'committed') {
            check(c.control.status === 'active' && c.root?.authoringBackend === 'r2-private'
                && c.head?.revision === 1 && c.head.sha256 === descriptor.sha256
                && c.head.revisionId === descriptor.revisionId, 'AUTHORING_REVISION_CONFLICT', 409);
            return { state: 'committed', result: 'commit', requestId: descriptor.revisionId, committedHead: c.head, currentHead: c.head };
        }
        check(c.control.status === 'creating' && creation.state === 'pending'
            && !c.root && !c.head && !c.operation && !c.summary && !c.existingWork && !c.oldSource,
            'PROJECT_ALREADY_EXISTS', 409);
        check(creation.leaseExpiresAtMs > now(), 'AUTHORING_LEASE_EXPIRED', 409);
        return null;
    }
    return {
        async access(identity) {
            await assertLiveIdentity(identity);
            await db.transaction(async tx => {
                const p = paths(identity.uid, 'creation');
                const [account, usage] = await tx.getMany([p.account, p.usage]); accountOK(account, identity);
                const next = usageValue(usage, now());
                check(next.requestCount < AUTHORING_LIMITS.requestsPerMinute && next.writeCount < AUTHORING_LIMITS.writesPerMinute, 'RATE_LIMITED', 429);
                next.requestCount++; next.writeCount++; tx.set(p.usage, next);
            });
        },
        async create(identity, projectId, { snapshot, requestId }) {
            segment(requestId);
            check(snapshot.project.projectId === projectId, 'AUTHORING_SCOPE_INVALID', 422);
            const workId = segment(snapshot.project.workId), scope = { uid: identity.uid, projectId, generationId: requestId };
            const descriptor = createPrivateAuthoringDescriptor(snapshot, scope, requestId);
            const time = now();
            const root = { ...metadataPatch(snapshot.project, { version: snapshot.project.version, workId }, time),
                ownerUid: identity.uid, projectId, workId, authoringBackend: 'r2-private', authoringStorageVersion: 1,
                authoringRef: 'authoringHeads/current', visibility: 'private', dsfStatus: 'draft', releaseId: null,
                createdAt: new Date(time), listThumbnail: '', pageCount: 0, projectBytes: descriptor.byteLength };
            const reserved = await db.transaction(async tx => {
                const c = await context(tx, identity, projectId, requestId, workId), receipt = replay(c, descriptor, workId);
                if (receipt) return receipt;
                const next = usageValue(c.usage, now());
                if (!c.control) {
                    check(next.operationCount < AUTHORING_LIMITS.operations
                        && next.reservedBytes + descriptor.byteLength <= AUTHORING_LIMITS.reservedBytes, 'STORAGE_QUOTA_EXCEEDED', 429);
                    next.operationCount++; next.reservedBytes += descriptor.byteLength;
                }
                check(next.uploadedBytes + descriptor.byteLength <= AUTHORING_LIMITS.uploadBytesPerDay, 'UPLOAD_QUOTA_EXCEEDED', 429);
                next.uploadedBytes += descriptor.byteLength;
                tx.set(c.p.usage, next);
                if (!c.control) tx.set(c.p.control, { storageVersion: 1, generationId: requestId, status: 'creating', initialized: false,
                    mutationRevision: 0, creation: { state: 'pending', workId, descriptor, createdAtMs: time, leaseExpiresAtMs: time + AUTHORING_LEASE_MS } });
                return null;
            });
            if (reserved) return reserved;
            await bucket.put(snapshot, descriptor, scope);
            await assertLiveIdentity(identity);
            return db.transaction(async tx => {
                const c = await context(tx, identity, projectId, requestId, workId), receipt = replay(c, descriptor, workId);
                if (receipt) return receipt;
                check(c.control?.creation, 'AUTHORING_CONTROL_MISSING');
                const head = { ...descriptor, revision: 1 }, creation = c.control.creation;
                const operation = { storageVersion: 1, generationId: requestId, baseRevision: 0, descriptor,
                    state: 'committed', result: 'commit', committedHead: head, createdAtMs: creation.createdAtMs,
                    leaseExpiresAtMs: creation.leaseExpiresAtMs, completedAtMs: now() };
                tx.set(c.p.root, root); tx.set(c.p.head, head); tx.set(c.p.operation, operation);
                tx.set(c.p.control, { ...c.control, status: 'active', initialized: true, previousHead: null,
                    creation: { ...creation, state: 'committed' } });
                tx.set(c.p.summary, createProjectSummary(root));
                tx.set(c.work, { ownerUid: identity.uid, projectId, workId, title: root.title || '', createdAt: new Date(time), updatedAt: new Date(time) });
                return { state: 'committed', result: 'commit', requestId, committedHead: head, currentHead: head };
            });
        },
    };
}
