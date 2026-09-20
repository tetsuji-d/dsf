/** Operator-only maintenance. Deliberately not imported by any HTTP/Pages route. */
import { check, segment } from './common.js';
import { paths, usageValue, AUTHORING_LIMITS, AUTHORING_LEASE_MS } from './service.js';
import { createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor, assertPrivateAuthoringHead } from '../../js/private-authoring-storage.js';
import { prepareFirestoreProjectIngress, createPublicProjectProjection, assertFirestoreAuthoringSize } from '../../js/project-persistence.js';
import { createProjectSummaryForPatch } from '../../js/project-summary.js';
import { encodeFirestoreValue, decodeFirestoreValue } from './firestore.js';
import { canonicalJson, digestValue, hashBytes } from './maintenance-common.js';
export const MAINTENANCE_LEASE_MS = 10 * 60_000;
const fields = data => encodeFirestoreValue(data).mapValue.fields;
const decode = doc => doc ? decodeFirestoreValue({ mapValue: { fields: doc.fields } }) : null;
const descriptorOf = ({ revision, ...value }) => value;
const publicKeys = new Set(['version', 'projectId', 'ownerUid', 'ownerEmail', 'workId', 'releaseId', 'projectName', 'title', 'labelName', 'rating', 'license', 'textPaperPreset', 'meta', 'languages', 'defaultLang', 'languageConfigs', 'bookMode', 'book', 'listThumbnail', 'thumbnail', 'projectBytes', 'pageCount', 'visibility', 'lastUpdated', 'updatedAt', 'createdAt', 'publication', 'dsfStatus', 'dsfPublishedAt', 'dsfRenderStamp', 'dsfResolution', 'dsfQuality', 'dsfQualityMode', 'dsfQualityProfile', 'dsfPages', 'dsfLangs', 'dsfTotalBytes', 'dsfSchemaVersion', 'dsfContentUrl', 'dsfContentHash', 'dsfPageCounts', 'dsfPageCount']);
function boundedRoot(encoded) { check(new TextEncoder().encode(JSON.stringify(decode({ fields: encoded }))).length <= 700 * 1024, 'METADATA_TOO_LARGE', 422); }
function validateScope(scope) { for (const k of ['uid', 'projectId', 'generationId']) segment(scope[k]); }
export function maintenancePaths(scope, kind, requestId) {
    validateScope(scope); check(['migrate', 'rollback'].includes(kind), 'MAINTENANCE_KIND_INVALID', 400); segment(requestId);
    const p = paths(scope.uid, scope.projectId);
    return { ...p, legacy: `${p.root}/authoring/current`, job: `${p.root}/${kind === 'migrate' ? 'authoringMigrations' : 'authoringRollbacks'}/${requestId}`,
        initialOperation: `${p.root}/authoringRevisions/initial`, backupKey: `users/${scope.uid}/projects/${scope.projectId}/migrations/${scope.generationId}/${kind}-${requestId}.json` };
}
function legacyState(root, control, head) {
    return ((root?.version === 6 && root.authoringRef === 'authoring/current' && root.authoringSchemaVersion === 6)
        || (root?.version === 5 && !Object.hasOwn(root, 'authoringRef') && !Object.hasOwn(root, 'authoringSchemaVersion')))
        && !Object.hasOwn(root, 'authoringBackend') && !Object.hasOwn(root, 'authoringStorageVersion')
        && ((!control && !head) || (control?.status === 'rolledBack' && root.authoringRollbackGeneration === control.generationId
            && head?.generationId === control.generationId));
}
function sameVersions(before, after) {
    check(before.length === after.length && before.every((row, i) => row.path === after[i].path
        && row.document?.updateTime === after[i].document?.updateTime
        && canonicalJson(row.document) === canonicalJson(after[i].document)), 'MAINTENANCE_SOURCE_CHANGED', 409);
}
async function collect(tx, scope, kind, requestId) {
    const p = maintenancePaths(scope, kind, requestId);
    const primary = [p.account, p.root, p.control, p.head, p.legacy, p.summary, p.usage, p.job, p.initialOperation];
    const [account, root, control, head, legacy, summary, usage, job] = await tx.getMany(primary);
    check(account?.uid === scope.uid && account.status?.disabled === false, 'ACCOUNT_NOT_EDITABLE', 403);
    check(root?.ownerUid === scope.uid && root.projectId === scope.projectId, 'PROJECT_NOT_FOUND', 404);
    const workId = segment(root.workId), workPath = `users/${scope.uid}/works/${workId}`;
    const publicPaths = [...new Set([workId, scope.projectId])].map(id => `public_projects/${id}`);
    const related = [workPath, ...publicPaths, ...(root.releaseId ? [`${workPath}/releases/${segment(root.releaseId)}`] : [])];
    const [work, ...indexes] = await tx.getMany(related);
    check(work?.ownerUid === scope.uid && work.projectId === scope.projectId, 'WORK_ID_CONFLICT', 409);
    indexes.slice(0, publicPaths.length).forEach(index => check(!index || index.authorUid === scope.uid, 'PUBLIC_INDEX_OWNER_CONFLICT', 409));
    // Only documents this transition can affect, plus immutable release references.
    const names = [p.root, p.control, p.head, p.legacy, p.summary, ...related];
    const documents = names.map(path => ({ path, document: tx.exportDocument(path) }));
    return { p, root, control, head, legacy, summary, usage, job, work, workPath, publicPaths, documents };
}
async function buildPlan(c, scope, kind, requestId, snapshot) {
    if (kind === 'migrate') {
        check(legacyState(c.root, c.control, c.head), 'MIGRATION_REQUIRES_LEGACY_PROJECT', 409);
        check(!c.control || c.control.generationId !== scope.generationId, 'MIGRATION_GENERATION_REUSED', 409);
        const source = c.root.version === 5 ? c.root : c.legacy;
        check(c.root.version !== 5 || c.legacy === null, 'MIGRATION_AMBIGUOUS_SOURCE', 409);
        check(source?.version === c.root.version && source.projectId === scope.projectId && source.workId === c.root.workId, 'MIGRATION_SOURCE_MISSING', 409);
        snapshot = await createPrivateAuthoringSnapshot(prepareFirestoreProjectIngress(source));
    } else {
        check(c.control?.status === 'active' && c.control.generationId === scope.generationId
            && c.root.authoringBackend === 'r2-private', 'ROLLBACK_REQUIRES_ACTIVE_R2', 409);
        assertPrivateAuthoringHead(c.head, scope);
        check(snapshot.sha256 === c.head.sha256 && snapshot.byteLength === c.head.byteLength, 'MAINTENANCE_SOURCE_CHANGED', 409);
        // Never truncate a large source to make a rollback fit Firestore.
        assertFirestoreAuthoringSize({ ...snapshot.project, lastUpdated: new Date(0) });
    }
    check(snapshot.project.workId === c.root.workId, 'WORK_ID_CONFLICT', 409);
    const rawRoot = c.documents.find(row => row.path === c.p.root).document.fields;
    let rootFields = Object.fromEntries(Object.entries(rawRoot).filter(([key]) => publicKeys.has(key)));
    const removeFromRoot = Object.keys(rawRoot).filter(key => !publicKeys.has(key));
    if (kind === 'migrate') Object.assign(rootFields, fields({ authoringBackend: 'r2-private', authoringStorageVersion: 1, authoringRef: 'authoringHeads/current' }));
    else {
        const projection = createPublicProjectProjection(snapshot.project);
        delete projection.releaseId; // Current Release/publication always comes from the live root.
        if (snapshot.project.version === 5) {
            // v5 returns to its original root storage; live Release/publication wins.
            rootFields = { ...fields(snapshot.project), ...rootFields };
        } else Object.assign(rootFields, fields(projection));
        Object.assign(rootFields, fields({ authoringRollbackGeneration: scope.generationId }));
        assertFirestoreAuthoringSize(decode({ fields: rootFields }));
    }
    boundedRoot(rootFields);
    const projectedRoot = decode({ fields: rootFields });
    const projectedSummary = createProjectSummaryForPatch(projectedRoot, {}, { projectId: scope.projectId });
    const sourceDescriptor = kind === 'migrate' ? createPrivateAuthoringDescriptor(snapshot, scope, 'initial') : descriptorOf(c.head);
    const backupJson = canonicalJson({ format: 'dsf-authoring-maintenance-backup', version: 1, kind, scope, requestId,
        sourceDescriptor, documents: c.documents });
    const backup = { objectKey: c.p.backupKey, sha256: await digestValue(JSON.parse(backupJson)), byteLength: new TextEncoder().encode(backupJson).length };
    const planHash = await digestValue({ kind, scope, requestId, backup, sourceDescriptor });
    const imageReferences = new Set();
    // Match Studio's known asset slots; unknown extensions can contain arbitrary prose.
    const slot = (value, key) => { if (typeof value[key] === 'string' && value[key]) imageReferences.add(value[key]); };
    const owner = value => {
        if (!value || typeof value !== 'object') return;
        for (const key of ['background', 'thumbnail', 'publicationThumbnailUrl']) slot(value, key);
        for (const key of Object.keys(value.backgrounds || {})) slot(value.backgrounds, key);
        for (const layer of value.layers || []) { owner(layer); if (layer.type === 'image') slot(layer, 'src'); }
    };
    owner(snapshot.project);
    for (const asset of snapshot.project.projectAssets || []) owner(asset);
    for (const block of snapshot.project.blocks || []) owner(block.content);
    for (const section of snapshot.project.sections || []) owner(section);
    for (const page of snapshot.project.pages || []) owner(page);
    check([...imageReferences].every(url => /^https:\/\//.test(url)), 'MIGRATION_ASSET_UNRESOLVED', 422);
    // A plan is private operational data. report is the only printable part.
    return { kind, scope: structuredClone(scope), requestId, planHash, snapshot, sourceDescriptor, backupJson, backup, rootFields, projectedSummary, documents: c.documents,
        report: { kind, scope, requestId, planHash, sourceBytes: snapshot.byteLength, sourceSha256: snapshot.sha256,
            backupBytes: backup.byteLength, removesRootFields: removeFromRoot, imageReferenceCount: imageReferences.size,
            releaseId: c.root.releaseId || null, publicationStatus: c.root.dsfStatus || 'draft', writesEnabled: false } };
}
/** offline dry run input contains typed Firestore documents exported from one consistent read. */
export async function inspectMigrationBundle({ scope, documents }) {
    maintenancePaths(scope, 'migrate', scope.generationId);
    check(Array.isArray(documents) && new Set(documents.map(row => row.path)).size === documents.length, 'MAINTENANCE_INVENTORY_DUPLICATE', 422);
    const store = new Map(documents.map(row => [row.path, row.document]));
    const tx = { getMany: async names => { names.forEach(name => check(store.has(name), 'MAINTENANCE_INVENTORY_INCOMPLETE', 422)); return names.map(name => decode(store.get(name))); },
        exportDocument: name => { const d = store.get(name); check(!d || (typeof d.updateTime === 'string' && !!d.updateTime), 'DOCUMENT_VERSION_MISSING'); return structuredClone(d); } };
    const c = await collect(tx, scope, 'migrate', scope.generationId);
    return (await buildPlan(c, scope, 'migrate', scope.generationId)).report;
}
export function createAuthoringMaintenance({ db, bucket, backups, authorize, now = Date.now }) {
    check(typeof authorize === 'function', 'CONFIG_MAINTENANCE_AUTHORIZATION');
    async function inspect(scope, kind, requestId) {
        validateScope(scope); await authorize(scope, kind);
        const c = await db.transaction(tx => collect(tx, scope, kind, requestId));
        const source = kind === 'rollback' ? await bucket.read(descriptorOf(c.head), scope) : null;
        const snapshot = source ? await createPrivateAuthoringSnapshot(source.project) : null;
        const plan = await buildPlan(c, scope, kind, requestId, snapshot);
        return plan;
    }
    async function apply(scope, kind, requestId, expectedPlanHash) {
        validateScope(scope); await authorize(scope, kind);
        check(/^[a-f0-9]{64}$/.test(expectedPlanHash), 'MAINTENANCE_PLAN_REQUIRED', 400);
        const p = maintenancePaths(scope, kind, requestId);
        const replay = await db.transaction(async tx => {
            const [job, control, head] = await tx.getMany([p.job, p.control, p.head]);
            if (job?.state !== 'committed') return null;
            check(job.planHash === expectedPlanHash, 'MAINTENANCE_REQUEST_REUSED', 409);
            check(control?.generationId === scope.generationId, 'MAINTENANCE_SOURCE_CHANGED', 409);
            return { state: 'committed', replay: true, kind, generationId: scope.generationId, currentStatus: control.status, currentRevision: head?.revision || null };
        });
        if (replay) return replay;
        const plan = await inspect(scope, kind, requestId);
        check(plan.planHash === expectedPlanHash, 'MAINTENANCE_SOURCE_CHANGED', 409);
        await db.transaction(async tx => {
            const c = await collect(tx, scope, kind, requestId); sameVersions(plan.documents, c.documents);
            if (c.job) check(c.job.planHash === plan.planHash && c.job.state === 'pending', 'MAINTENANCE_REQUEST_REUSED', 409);
            const time = now(), usage = usageValue(c.usage, time);
            check(!c.job || c.job.leaseExpiresAtMs > time, 'MAINTENANCE_LEASE_EXPIRED', 409);
            const bytes = plan.backup.byteLength + (kind === 'migrate' ? plan.snapshot.byteLength : 0);
            const entries = kind === 'migrate' ? 2 : 1;
            check(usage.uploadedBytes + bytes <= AUTHORING_LIMITS.uploadBytesPerDay, 'UPLOAD_QUOTA_EXCEEDED', 429);
            usage.uploadedBytes += bytes;
            if (!c.job) {
                check(usage.reservedBytes + bytes <= AUTHORING_LIMITS.reservedBytes && usage.operationCount + entries <= AUTHORING_LIMITS.operations, 'STORAGE_QUOTA_EXCEEDED', 429);
                usage.reservedBytes += bytes; usage.operationCount += entries;
                tx.set(p.job, { version: 1, kind, generationId: scope.generationId, state: 'pending', planHash: plan.planHash,
                    sourceDescriptor: plan.sourceDescriptor, backup: plan.backup, createdAtMs: time, leaseExpiresAtMs: time + MAINTENANCE_LEASE_MS });
            }
            tx.set(p.usage, usage);
        });
        await backups.put(plan);
        if (kind === 'migrate') await bucket.put(plan.snapshot, plan.sourceDescriptor, scope);
        // Current R2 source is re-read even for rollback, after all backup I/O.
        const verified = await bucket.read(plan.sourceDescriptor, scope);
        check(await hashBytes(verified.bytes) === plan.snapshot.sha256, 'MAINTENANCE_COPY_MISMATCH', 502);
        await authorize(scope, kind);
        return db.transaction(async tx => {
            const c = await collect(tx, scope, kind, requestId);
            check(c.job?.planHash === plan.planHash, 'MAINTENANCE_REQUEST_REUSED', 409);
            if (c.job.state === 'committed') return { state: 'committed', replay: true, kind, generationId: scope.generationId, currentStatus: c.control.status, currentRevision: c.head?.revision || null };
            sameVersions(plan.documents, c.documents);
            const time = now(); check(c.job.leaseExpiresAtMs > time, 'MAINTENANCE_LEASE_EXPIRED', 409);
            let nextHead;
            if (kind === 'migrate') {
                nextHead = { ...plan.sourceDescriptor, revision: 1 };
                tx.set(p.control, { storageVersion: 1, generationId: scope.generationId, status: 'active', initialized: true, previousHead: null, mutationRevision: 0 });
                tx.set(p.head, nextHead);
                tx.set(p.initialOperation, { storageVersion: 1, generationId: scope.generationId, baseRevision: 0, descriptor: plan.sourceDescriptor,
                    state: 'committed', result: 'commit', committedHead: nextHead, createdAtMs: time, leaseExpiresAtMs: time + AUTHORING_LEASE_MS, completedAtMs: time });
                tx.delete(p.legacy);
            } else {
                nextHead = c.head;
                if (plan.snapshot.project.version === 6) tx.set(p.legacy, { ...plan.snapshot.project, lastUpdated: new Date(time) });
                else tx.delete(p.legacy);
                tx.set(p.control, { ...c.control, status: 'rolledBack', rolledBackAtMs: time, mutationRevision: (c.control.mutationRevision || 0) + 1 });
                for (const path of c.publicPaths) {
                    const doc = c.documents.find(row => row.path === path).document;
                    if (doc?.fields.authoringBackend) { const copy = { ...doc.fields }; delete copy.authoringBackend; tx.setEncoded(path, copy); }
                }
            }
            tx.setEncoded(p.root, plan.rootFields);
            tx.set(p.summary, plan.projectedSummary);
            tx.set(p.job, { ...c.job, state: 'committed', committedAtMs: time, committedHead: nextHead });
            return { state: 'committed', replay: false, kind, generationId: scope.generationId, currentStatus: kind === 'migrate' ? 'active' : 'rolledBack', currentRevision: nextHead.revision };
        });
    }
    return {
        inspectMigration: scope => inspect(scope, 'migrate', scope.generationId).then(plan => plan.report),
        migrate: (scope, expectedPlanHash) => apply(scope, 'migrate', scope.generationId, expectedPlanHash),
        inspectRollback: (scope, requestId) => inspect(scope, 'rollback', requestId).then(plan => plan.report),
        rollback: (scope, requestId, expectedPlanHash) => apply(scope, 'rollback', requestId, expectedPlanHash),
    };
}
