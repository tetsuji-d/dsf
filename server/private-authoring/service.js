import {
    assertPrivateAuthoringHead, assertPrivateAuthoringDescriptor,
    createPrivateAuthoringDescriptor, planPrivateAuthoringCommit,
} from '../../js/private-authoring-storage.js';
import { createProjectSummaryForPatch } from '../../js/project-summary.js';
import { AuthoringApiError, check, segment } from './common.js';

export const AUTHORING_LEASE_MS = 120_000;
export const AUTHORING_LIMITS = Object.freeze({ requestsPerMinute: 120, writesPerMinute: 30,
    uploadBytesPerDay: 256 * 1024 * 1024, reservedBytes: 1024 * 1024 * 1024, operations: 10_000 });
const descriptorOf = ({ revision, ...descriptor }) => descriptor;
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function paths(uid, projectId, requestId) {
    segment(uid); segment(projectId);
    const root = `users/${uid}/projects/${projectId}`;
    return {
        account: `users/${uid}`, root, control: `${root}/authoringControl/current`,
        head: `${root}/authoringHeads/current`, usage: `users/${uid}/authoringUsage/current`,
        operation: requestId ? `${root}/authoringRevisions/${segment(requestId)}` : null,
        summary: `users/${uid}/project_summaries/${projectId}`,
    };
}
export function usageValue(value, time) {
    const result = value === null ? { requestMinute: 0, requestCount: 0, writeMinute: 0, writeCount: 0,
        day: 0, uploadedBytes: 0, reservedBytes: 0, operationCount: 0 } : { ...value };
    for (const key of ['requestMinute', 'requestCount', 'writeMinute', 'writeCount', 'day', 'uploadedBytes', 'reservedBytes', 'operationCount']) {
        check(Number.isSafeInteger(result[key]) && result[key] >= 0, 'INVALID_USAGE_RECORD');
    }
    const minute = Math.floor(time / 60_000), day = Math.floor(time / 86_400_000);
    if (result.requestMinute !== minute) { result.requestMinute = minute; result.requestCount = 0; }
    if (result.writeMinute !== minute) { result.writeMinute = minute; result.writeCount = 0; }
    if (result.day !== day) { result.day = day; result.uploadedBytes = 0; }
    return result;
}
function validateOperation(operation, scope) {
    if (!operation) return;
    check(operation.generationId === scope.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
    check(operation.storageVersion === 1 && ['pending', 'committed', 'rejected'].includes(operation.state)
        && operation.generationId === scope.generationId && Number.isSafeInteger(operation.baseRevision)
        && operation.baseRevision >= 0 && Number.isSafeInteger(operation.leaseExpiresAtMs)
        && Number.isSafeInteger(operation.createdAtMs) && operation.leaseExpiresAtMs > operation.createdAtMs,
    'INVALID_OPERATION_RECORD');
    assertPrivateAuthoringDescriptor(operation.descriptor, scope);
    if (operation.state === 'committed') {
        assertPrivateAuthoringHead(operation.committedHead, scope);
        check(['commit', 'unchanged'].includes(operation.result)
            && operation.committedHead.sha256 === operation.descriptor.sha256
            && operation.committedHead.byteLength === operation.descriptor.byteLength
            && operation.committedHead.revision === operation.baseRevision + (operation.result === 'commit' ? 1 : 0)
            && (operation.result !== 'commit' || operation.committedHead.revisionId === operation.descriptor.revisionId)
            && Number.isSafeInteger(operation.completedAtMs) && operation.completedAtMs >= operation.createdAtMs
            && operation.completedAtMs < operation.leaseExpiresAtMs, 'INVALID_OPERATION_RECORD');
    }
    check(jsonBytes(operation) <= 16 * 1024, 'INVALID_OPERATION_RECORD');
}
export async function readContext(tx, identity, projectId, requestId, generationId) {
    const p = paths(identity.uid, projectId, requestId);
    const names = [p.account, p.root, p.control, p.head, p.usage];
    if (p.operation) names.push(p.operation);
    const [account, root, control, head, usage, operation = null] = await tx.getMany(names);
    check(account?.uid === identity.uid && account.status?.disabled === false, 'ACCOUNT_NOT_EDITABLE', 403);
    check(root && root.ownerUid === identity.uid && root.projectId === projectId, 'PROJECT_NOT_FOUND', 404);
    check(root.version === 6 && root.authoringBackend === 'r2-private' && root.authoringStorageVersion === 1
        && root.authoringRef === 'authoringHeads/current', 'PROJECT_NOT_MIGRATED', 409);
    check(!['blocks', 'sections', 'pages'].some(key => Object.hasOwn(root, key)), 'ROOT_CONTAINS_AUTHORING');
    check(control?.storageVersion === 1 && typeof control.initialized === 'boolean', 'AUTHORING_CONTROL_MISSING');
    segment(control.generationId);
    check(control.status === 'active', 'AUTHORING_NOT_ACTIVE', 409);
    const scope = { uid: identity.uid, projectId, generationId: control.generationId };
    if (generationId !== undefined) check(generationId === scope.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
    check((head !== null) === control.initialized, 'AUTHORING_HEAD_MISSING');
    if (head) assertPrivateAuthoringHead(head, scope);
    validateOperation(operation, scope);
    if (operation) check(operation.descriptor.revisionId === requestId, 'INVALID_OPERATION_RECORD');
    return { p, account, root, control, head, usage, operation, scope };
}
function receipt(operation, currentHead) {
    return { state: 'committed', requestId: operation.descriptor.revisionId,
        result: operation.result, committedHead: operation.committedHead, currentHead };
}
function metadataPatch(project, root, time) {
    check(project.workId === undefined || project.workId === (root.workId || ''), 'WORK_ID_CONFLICT', 409);
    // projectBytes includes image bytes in Studio; do not replace it with JSON-only size.
    const patch = { lastUpdated: new Date(time) };
    for (const key of ['projectName', 'title', 'labelName', 'rating', 'license', 'textPaperPreset', 'defaultLang']) {
        if (!Object.hasOwn(project, key)) continue;
        check(typeof project[key] === 'string' && project[key].length <= 512, 'METADATA_INVALID', 422);
        patch[key] = project[key];
    }
    if (Object.hasOwn(project, 'languages')) {
        check(Array.isArray(project.languages) && project.languages.length >= 1 && project.languages.length <= 16
            && project.languages.every(language => typeof language === 'string' && language.length > 0 && language.length <= 32),
        'METADATA_INVALID', 422);
        patch.languages = [...project.languages];
    }
    check(jsonBytes({ ...root, ...patch }) <= 700 * 1024, 'METADATA_TOO_LARGE', 422);
    return patch;
}
function checkRequest(operation, descriptor, baseRevision) {
    if (!operation) return;
    check(operation.generationId === descriptor.generationId, 'AUTHORING_GENERATION_CONFLICT', 409);
    check(operation.baseRevision === baseRevision
        && Object.keys(descriptor).every(key => operation.descriptor[key] === descriptor[key]), 'AUTHORING_REQUEST_REUSED', 409);
}
function rejectOperation(tx, context, errorCode, time) {
    tx.set(context.p.operation, { ...context.operation, state: 'rejected', errorCode, completedAtMs: time });
    return { errorCode };
}

/** No API here creates/migrates/deletes projects. Those are separate rollout units. */
export function createAuthoringService({ db, bucket, assertLiveIdentity, now = Date.now }) {
    return {
        // Called before reading a PUT body, so authenticated request/CPU load is bounded.
        async access(identity, projectId, { write = false, requestId, generationId } = {}) {
            await assertLiveIdentity(identity);
            return db.transaction(async tx => {
                const context = await readContext(tx, identity, projectId, requestId, generationId);
                const usage = usageValue(context.usage, now());
                check(usage.requestCount < AUTHORING_LIMITS.requestsPerMinute, 'RATE_LIMITED', 429);
                usage.requestCount += 1;
                if (write) {
                    check(usage.writeCount < AUTHORING_LIMITS.writesPerMinute, 'RATE_LIMITED', 429);
                    usage.writeCount += 1;
                }
                tx.set(context.p.usage, usage);
                return context;
            });
        },
        async save(identity, projectId, { snapshot, requestId, generationId, baseRevision }) {
            segment(requestId); segment(generationId);
            check(Number.isSafeInteger(baseRevision) && baseRevision >= 0, 'INVALID_BASE_REVISION', 400);
            const scope = { uid: identity.uid, projectId, generationId };
            const descriptor = createPrivateAuthoringDescriptor(snapshot, scope, requestId);
            const reservation = await db.transaction(async tx => {
                const context = await readContext(tx, identity, projectId, requestId, generationId);
                const time = now(), operation = context.operation;
                checkRequest(operation, descriptor, baseRevision);
                metadataPatch(snapshot.project, context.root, time);
                if (operation?.state === 'committed') return { receipt: receipt(operation, context.head) };
                check(operation?.state !== 'rejected', operation?.errorCode || 'AUTHORING_REJECTED', 409);
                if (operation && operation.leaseExpiresAtMs <= time) return rejectOperation(tx, context, 'AUTHORING_LEASE_EXPIRED', time);
                let decision;
                try { decision = planPrivateAuthoringCommit({ scope, projectStatus: 'active', baseRevision, candidate: descriptor, currentHead: context.head }); }
                catch (error) {
                    if (operation) return rejectOperation(tx, context, error.code || 'AUTHORING_CONFLICT', time);
                    throw error;
                }
                check(decision.action !== 'replay', 'OPERATION_LEDGER_MISSING');
                const usage = usageValue(context.usage, time);
                if (!operation) {
                    check(usage.operationCount < AUTHORING_LIMITS.operations, 'STORAGE_QUOTA_EXCEEDED', 429);
                    usage.operationCount += 1;
                }
                const pending = operation || { storageVersion: 1, generationId, baseRevision, descriptor,
                    state: 'pending', createdAtMs: time, leaseExpiresAtMs: time + AUTHORING_LEASE_MS };
                if (decision.action === 'unchanged') {
                    const committed = { ...pending, state: 'committed', result: 'unchanged', committedHead: context.head, completedAtMs: time };
                    tx.set(context.p.operation, committed);
                    tx.set(context.p.usage, usage);
                    return { receipt: receipt(committed, context.head) };
                }
                check(usage.uploadedBytes + snapshot.byteLength <= AUTHORING_LIMITS.uploadBytesPerDay, 'UPLOAD_QUOTA_EXCEEDED', 429);
                usage.uploadedBytes += snapshot.byteLength;
                if (!operation) {
                    check(usage.reservedBytes + snapshot.byteLength <= AUTHORING_LIMITS.reservedBytes, 'STORAGE_QUOTA_EXCEEDED', 429);
                    usage.reservedBytes += snapshot.byteLength;
                }
                tx.set(context.p.usage, usage);
                tx.set(context.p.operation, pending);
                return { pending: true };
            });
            if (reservation.errorCode) throw new AuthoringApiError(reservation.errorCode, 409);
            if (reservation.receipt) return reservation.receipt;
            await bucket.put(snapshot, descriptor, scope);
            // Revocation and disabled Auth users are checked again after potentially slow R2 I/O.
            await assertLiveIdentity(identity);
            const result = await db.transaction(async tx => {
                const context = await readContext(tx, identity, projectId, requestId, generationId);
                const time = now(), operation = context.operation;
                check(operation, 'OPERATION_LEDGER_MISSING');
                checkRequest(operation, descriptor, baseRevision);
                if (operation.state === 'committed') return receipt(operation, context.head);
                check(operation.state === 'pending', operation.errorCode || 'AUTHORING_REJECTED', 409);
                if (operation.leaseExpiresAtMs <= time) return rejectOperation(tx, context, 'AUTHORING_LEASE_EXPIRED', time);
                let decision;
                try { decision = planPrivateAuthoringCommit({ scope, projectStatus: 'active', baseRevision, candidate: descriptor, currentHead: context.head }); }
                catch (error) { return rejectOperation(tx, context, error.code || 'AUTHORING_CONFLICT', time); }
                check(decision.action === 'commit', 'INVALID_COMMIT_STATE');
                const patch = metadataPatch(snapshot.project, context.root, time);
                const workPath = context.root.workId ? `users/${identity.uid}/works/${segment(context.root.workId)}` : null;
                const related = [context.p.summary];
                if (workPath) related.push(workPath);
                const [, work] = await tx.getMany(related);
                if (workPath) check(work?.ownerUid === identity.uid && work.projectId === projectId, 'WORK_ID_CONFLICT', 409);
                const summary = createProjectSummaryForPatch(context.root, patch, { projectId });
                const committed = { ...operation, state: 'committed', result: 'commit', committedHead: decision.head, completedAtMs: time };
                tx.set(context.p.head, decision.head);
                tx.set(context.p.operation, committed);
                tx.patch(context.p.root, patch);
                tx.set(context.p.summary, summary);
                tx.set(context.p.control, { ...context.control, initialized: true,
                    previousHead: context.head || null });
                if (workPath) {
                    const workPatch = { ...patch, updatedAt: new Date(time) };
                    delete workPatch.projectName; delete workPatch.projectBytes; delete workPatch.lastUpdated;
                    tx.patch(workPath, workPatch);
                }
                return receipt(committed, decision.head);
            });
            if (result.errorCode) throw new AuthoringApiError(result.errorCode, 409);
            return result;
        },
        async load(identity, projectId, context) {
            check(context.head, 'AUTHORING_NOT_SAVED', 404);
            const result = await bucket.read(descriptorOf(context.head), context.scope);
            await assertLiveIdentity(identity);
            await db.transaction(async tx => {
                const latest = await readContext(tx, identity, projectId, undefined, context.scope.generationId);
                check(latest.head?.revision === context.head.revision && latest.head.sha256 === context.head.sha256,
                    'AUTHORING_REVISION_CONFLICT', 409);
            });
            return { bytes: result.bytes, head: context.head };
        },
        operation(context) {
            check(context.operation, 'OPERATION_NOT_FOUND', 404);
            if (context.operation.state === 'committed') return receipt(context.operation, context.head);
            const expired = context.operation.leaseExpiresAtMs <= now();
            return { requestId: context.operation.descriptor.revisionId,
                state: context.operation.state === 'pending' && expired ? 'expired' : context.operation.state,
                errorCode: context.operation.errorCode || (expired ? 'AUTHORING_LEASE_EXPIRED' : null), currentHead: context.head };
        },
    };
}
