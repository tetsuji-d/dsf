import { check, readBounded, segment } from './common.js';
export const MAINTENANCE_MAX_BACKUP_BYTES = 8 * 1024 * 1024;
export async function hashBytes(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function canonicalJson(value) {
    let nodes = 0;
    const sort = (v, depth = 0) => {
        check(depth <= 80 && ++nodes <= 1_000_000, 'MAINTENANCE_DATA_TOO_COMPLEX', 422);
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v === 'number') { check(Number.isFinite(v), 'MAINTENANCE_DATA_INVALID', 422); return v; }
        check(v && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null), 'MAINTENANCE_DATA_INVALID', 422);
        return Array.isArray(v) ? v.map(e => sort(e, depth + 1)) : Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k], depth + 1)]));
    };
    const json = JSON.stringify(sort(value));
    check(new TextEncoder().encode(json).length <= MAINTENANCE_MAX_BACKUP_BYTES, 'MAINTENANCE_BACKUP_TOO_LARGE', 413);
    return json;
}
export async function digestValue(value) { return hashBytes(new TextEncoder().encode(canonicalJson(value))); }
/** Separate private binding only. Never accepts a caller supplied object key. */
export function createMaintenanceBackupStore(rawBucket) {
    check(rawBucket?.get && rawBucket?.put, 'CONFIG_AUTHORING_BUCKET');
    return {
        async put(plan) {
            const { backupJson, backup, scope, kind, requestId } = plan;
            for (const key of ['uid', 'projectId', 'generationId']) segment(scope[key]); segment(requestId);
            check(['migrate', 'rollback'].includes(kind) && backup.objectKey === `users/${scope.uid}/projects/${scope.projectId}/migrations/${scope.generationId}/${kind}-${requestId}.json`, 'BACKUP_SCOPE_INVALID', 422);
            check(await digestValue(JSON.parse(backupJson)) === backup.sha256, 'BACKUP_PLAN_INVALID', 422);
            const bytes = new TextEncoder().encode(backupJson);
            check(bytes.length === backup.byteLength, 'BACKUP_PLAN_INVALID', 422);
            await rawBucket.put(backup.objectKey, bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: backup.sha256,
                httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
                customMetadata: { sha256: backup.sha256, kind: 'authoring-migration-backup', version: '1' } });
            const object = await rawBucket.get(backup.objectKey);
            check(object && object.size === bytes.length && object.customMetadata?.sha256 === backup.sha256
                && object.customMetadata?.kind === 'authoring-migration-backup', 'BACKUP_VERIFICATION_FAILED', 502);
            const actual = await readBounded(object.body, bytes.length);
            check(await hashBytes(actual) === backup.sha256, 'BACKUP_VERIFICATION_FAILED', 502);
        },
    };
}
