// Test-only Worker fixture. Not a Pages route and never included in deployment.
import { createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor } from '../../js/private-authoring-storage.js';
import { createMaintenanceBackupStore, canonicalJson, hashBytes } from '../../server/private-authoring/maintenance-common.js';
import { createAuthoringBucket } from '../../server/private-authoring/r2.js';
function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectError(operation, code) {
    try { await operation(); } catch (error) { assert(error.code === code, `Expected ${code}, got ${error.code}`); return; }
    throw new Error(`Expected ${code}`);
}
export default {
    async fetch(request, env) {
        const adapter = createAuthoringBucket(env.AUTHORING_BUCKET);
        const scope = { uid: 'owner_1', projectId: 'project_1', generationId: 'generation_1' };
        const snapshot = await createPrivateAuthoringSnapshot({ version: 6, projectId: 'project_1', blocks: [],
            languages: ['ja'], defaultLang: 'ja', futurePrivate: { text: '日本語\r\n本文😀' } });
        const descriptor = createPrivateAuthoringDescriptor(snapshot, scope, 'request_1');
        await adapter.put(snapshot, descriptor, scope);
        await adapter.put(snapshot, descriptor, scope);
        assert((await env.AUTHORING_BUCKET.list()).objects.length === 1, 'retry duplicated object');
        const restored = await adapter.read(descriptor, scope);
        assert(new TextDecoder().decode(restored.bytes) === snapshot.json, 'snapshot changed');
        await expectError(() => adapter.read(descriptor, { ...scope, uid: 'other' }), 'AUTHORING_SCOPE_MISMATCH');
        await env.AUTHORING_BUCKET.put(descriptor.objectKey, 'damaged', {
            httpMetadata: { contentType: 'application/json' }, customMetadata: { sha256: descriptor.sha256, storageVersion: '1' },
        });
        await expectError(() => adapter.read(descriptor, scope), 'AUTHORING_OBJECT_CORRUPT');
        await expectError(() => adapter.put(snapshot, descriptor, scope), 'IMMUTABLE_COLLISION');
        const backupJson = canonicalJson({ fields: { createdAt: { timestampValue: '2026-09-19T01:02:03.123456789Z' } }, source: snapshot.project });
        const plan = { scope, kind: 'migrate', requestId: 'generation_1', backupJson, backup: {
            objectKey: 'users/owner_1/projects/project_1/migrations/generation_1/migrate-generation_1.json',
            sha256: await hashBytes(new TextEncoder().encode(backupJson)), byteLength: new TextEncoder().encode(backupJson).length } };
        const backups = createMaintenanceBackupStore(env.AUTHORING_BUCKET);
        await backups.put(plan); await backups.put(plan);
        assert(await (await env.AUTHORING_BUCKET.get(plan.backup.objectKey)).text() === backupJson, 'typed backup changed');
        await expectError(() => backups.put({ ...plan, backup: { ...plan.backup, objectKey: 'public/forged' } }), 'BACKUP_SCOPE_INVALID');
        await env.AUTHORING_BUCKET.put(plan.backup.objectKey, 'corrupted backup');
        await expectError(() => backups.put(plan), 'BACKUP_VERIFICATION_FAILED');
        return Response.json({ passed: true, byteLength: snapshot.byteLength });
    },
};
