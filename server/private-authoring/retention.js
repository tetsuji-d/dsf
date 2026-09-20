/** Read-only retention inventory. This module has no delete, write or network capability. */
import { assertPrivateAuthoringDescriptor, assertPrivateAuthoringHead } from '../../js/private-authoring-storage.js';
import { check, segment } from './common.js';
export const PRIVATE_AUTHORING_RETENTION = Object.freeze({ recentRevisions: 3, dailyDays: 30, graceHours: 48, timezone: 'UTC', automaticDeletion: false });
const DAY = 86_400_000, GRACE = 48 * 3_600_000;
export function createPrivateAuthoringRetentionReport(input) {
    const { scope, control, head, nowMs, complete = {} } = input;
    for (const key of ['uid', 'projectId', 'generationId']) segment(scope[key]);
    check(Number.isSafeInteger(nowMs) && nowMs > 0, 'INVENTORY_TIME_REQUIRED', 422);
    const rows = input.objects || [], operations = input.revisions || [], actions = input.actions || [], migrations = input.migrations || [], rollbacks = input.rollbacks || [];
    const issues = [], protect = new Map(), commits = new Map(), keys = new Set();
    const keep = (key, reason) => { if (!protect.has(key)) protect.set(key, new Set()); protect.get(key).add(reason); };
    const descriptor = (d, asHead = false) => { try { (asHead ? assertPrivateAuthoringHead : assertPrivateAuthoringDescriptor)(d, scope); return true; } catch { issues.push('INVALID_REVISION_REFERENCE'); return false; } };
    const time = value => Number.isSafeInteger(value) && value >= 0 && value <= nowMs;
    for (const key of ['objects', 'revisions', 'actions', 'migrations', 'rollbacks']) if (complete[key] !== true) issues.push(`INCOMPLETE_${key.toUpperCase()}`);
    if (control?.generationId !== scope.generationId || !['active', 'deleted', 'rolledBack'].includes(control?.status)) issues.push('CONTROL_REVIEW_REQUIRED');
    if (head && descriptor(head, true)) keep(head.objectKey, 'current-head'); else issues.push('HEAD_REQUIRED');
    if (control?.previousHead && descriptor(control.previousHead, true)) keep(control.previousHead.objectKey, 'previous-head');
    const prefix = `users/${scope.uid}/projects/${scope.projectId}/generations/${scope.generationId}/revisions/`;
    const backupPrefix = `users/${scope.uid}/projects/${scope.projectId}/migrations/${scope.generationId}/`;
    for (const object of rows) {
        if (keys.has(object.key)) issues.push('DUPLICATE_OBJECT_KEY'); keys.add(object.key);
        const revision = typeof object.key === 'string' && object.key.startsWith(prefix) && /^[A-Za-z0-9_-]{1,128}\.json$/.test(object.key.slice(prefix.length));
        const backup = typeof object.key === 'string' && object.key.startsWith(backupPrefix) && /^(migrate|rollback)-[A-Za-z0-9_-]{1,128}\.json$/.test(object.key.slice(backupPrefix.length));
        if (!revision && !backup) issues.push('OBJECT_SCOPE_REVIEW_REQUIRED');
        if (!Number.isSafeInteger(object.size) || object.size < 0 || !time(object.uploadedAtMs)) issues.push('OBJECT_METADATA_INVALID');
        if (backup) keep(object.key, 'migration-backup-manual-retention');
        if (time(object.uploadedAtMs) && object.uploadedAtMs > nowMs - GRACE) keep(object.key, 'object-younger-than-48h');
        if (control?.status === 'rolledBack') keep(object.key, 'rollback-recovery');
    }
    for (const entry of operations) {
        const op = entry.data;
        if (!op || op.storageVersion !== 1 || op.generationId !== scope.generationId
            || !Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0 || !descriptor(op.descriptor) || entry.id !== op.descriptor.revisionId || !time(op.createdAtMs)
            || !Number.isSafeInteger(op.leaseExpiresAtMs) || op.leaseExpiresAtMs <= op.createdAtMs
            || !['pending', 'committed', 'rejected'].includes(op.state)) { issues.push('REVISION_LEDGER_INVALID'); continue; }
        if (op.state === 'pending' && op.leaseExpiresAtMs > nowMs) keep(op.descriptor.objectKey, 'live-pending-save');
        if (op.leaseExpiresAtMs > nowMs - GRACE) keep(op.descriptor.objectKey, 'save-retry-grace');
        if (op.state === 'committed') {
            if (!descriptor(op.committedHead, true) || !time(op.completedAtMs) || op.completedAtMs < op.createdAtMs || op.completedAtMs >= op.leaseExpiresAtMs
                || !['commit', 'unchanged'].includes(op.result)
                || op.committedHead.revision !== op.baseRevision + (op.result === 'commit' ? 1 : 0)
                || op.committedHead.revision > (head?.revision || 0)
                || op.committedHead.sha256 !== op.descriptor.sha256 || op.committedHead.byteLength !== op.descriptor.byteLength
                || (op.result === 'commit' && op.committedHead.objectKey !== op.descriptor.objectKey)) { issues.push('REVISION_LEDGER_INVALID'); continue; }
            if (op.completedAtMs > nowMs - GRACE) keep(op.committedHead.objectKey, 'receipt-retry-grace');
            if (op.result === 'commit') {
                const prior = commits.get(op.committedHead.revision);
                if (prior && prior.head.objectKey !== op.committedHead.objectKey) issues.push('REVISION_NUMBER_COLLISION');
                commits.set(op.committedHead.revision, { head: op.committedHead, at: op.completedAtMs });
            }
        }
    }
    for (const entry of [...migrations, ...rollbacks]) {
        const op = entry.data;
        if (!op || !['pending', 'committed'].includes(op.state) || op.generationId !== scope.generationId || !time(op.createdAtMs)) { issues.push('MAINTENANCE_LEDGER_INVALID'); continue; }
        if (op.backup?.objectKey) {
            if (!op.backup.objectKey.startsWith(backupPrefix)) issues.push('BACKUP_SCOPE_INVALID');
            else keep(op.backup.objectKey, 'migration-backup-manual-retention');
        } else issues.push('BACKUP_REFERENCE_MISSING');
        if (op.state === 'pending' && descriptor(op.sourceDescriptor)) keep(op.sourceDescriptor.objectKey, 'pending-maintenance');
    }
    for (const entry of actions) {
        const op = entry.data;
        if (!op || (!op.result && !op.restoreHead)) { issues.push('ACTION_LEDGER_INVALID'); continue; }
        if (!op.result && op.restoreHead && descriptor(op.restoreHead, true)) keep(op.restoreHead.objectKey, 'pending-restore');
    }
    const ordered = [...commits.values()].sort((a, b) => b.head.revision - a.head.revision);
    // Protect current plus its two preceding actual commits, not two unchanged receipts.
    const previous = ordered.filter(row => row.head.revision < (head?.revision || 0)).slice(0, 2);
    previous.forEach(row => keep(row.head.objectKey, 'last-three-revisions'));
    const daily = new Map(), firstDay = Math.floor(nowMs / DAY) - 29;
    for (const row of ordered) {
        const day = Math.floor(row.at / DAY);
        if (day < firstDay || day > Math.floor(nowMs / DAY)) continue;
        const old = daily.get(day);
        if (!old || row.at > old.at || (row.at === old.at && row.head.revision > old.head.revision)) daily.set(day, row);
    }
    daily.forEach(row => keep(row.head.objectKey, 'utc-daily-last-30-days'));
    if (!ordered.some(row => row.head.objectKey === head?.objectKey && row.head.revision === head?.revision)) issues.push('CURRENT_COMMIT_RECEIPT_MISSING');
    for (const [key, reasons] of protect) if (!keys.has(key) && [...reasons].some(reason => ['last-three-revisions', 'utc-daily-last-30-days'].includes(reason))) issues.push('RETAINED_REVISION_MISSING');
    for (const d of [head, control?.previousHead]) if (d?.objectKey && !keys.has(d.objectKey)) issues.push('PROTECTED_OBJECT_MISSING');
    const deletedAt = control?.deletedAt instanceof Date ? control.deletedAt.getTime() : typeof control?.deletedAt === 'string' ? new Date(control.deletedAt).getTime() : control?.deletedAtMs;
    if (control?.status === 'deleted' && !time(deletedAt)) issues.push('DELETION_TIME_INVALID');
    const warnings = [...new Set(issues)];
    const objects = rows.map(row => {
        const reasons = [...(protect.get(row.key) || [])];
        if (control?.status === 'deleted') reasons.push('tombstone-cleanup-requires-separate-transition');
        const decision = warnings.length ? 'blocked' : reasons.length ? 'keep' : 'candidate';
        return { key: row.key, bytes: row.size, uploadedAtMs: row.uploadedAtMs, decision,
            reasons: warnings.length ? [...reasons, 'inventory-not-safe'] : reasons.length ? reasons : ['unreferenced-beyond-retention-and-48h'] };
    });
    return { scope, nowMs, policy: PRIVATE_AUTHORING_RETENTION, readOnly: true, warnings,
        objects, totals: { objects: objects.length, bytes: objects.reduce((sum, row) => sum + (Number.isSafeInteger(row.bytes) ? row.bytes : 0), 0),
            candidateCount: objects.filter(row => row.decision === 'candidate').length,
            candidateBytes: objects.filter(row => row.decision === 'candidate').reduce((sum, row) => sum + row.bytes, 0) },
        notes: ['Candidate is not deletion permission. Re-read head, pending operations and generation transactionally before any future cleanup.',
            'No receipt removal, quota refund, public Release deletion or automatic R2 lifecycle is performed.'] };
}
