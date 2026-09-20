// Test-only Worker fixture. Not a Pages route and never included in deployment.
import { createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor } from '../../js/private-authoring-storage.js';
import { createMaintenanceBackupStore, canonicalJson, hashBytes } from '../../server/private-authoring/maintenance-common.js';
import { fetchJson } from '../../server/private-authoring/common.js';
import { createAuthoringBucket } from '../../server/private-authoring/r2.js';
function assert(condition, message) { if (!condition) throw new Error(message); }
async function expectError(operation, code) {
    try { await operation(); } catch (error) { assert(error.code === code, `Expected ${code}, got ${error.code}`); return; }
    throw new Error(`Expected ${code}`);
}
export default {
    async fetch(request, env) {
        const upstream = await fetchJson(async (url, options) => {
            const outgoing = new Request(url, options); // Real workerd rejects redirect:error.
            assert(outgoing.redirect === 'manual', 'upstream redirect must not be followed');
            return Response.json({ ok: true });
        }, 'https://upstream.test');
        assert(upstream.data.ok, 'upstream request options incompatible with Workers');
        await expectError(() => fetchJson(async () => new Response(null, { status: 302, headers: { Location: 'https://foreign.test' } }), 'https://upstream.test'), 'UPSTREAM_REDIRECT_BLOCKED');
        const adapter = createAuthoringBucket(env.AUTHORING_BUCKET);
        const scope = { uid: 'owner_1', projectId: '作品１', generationId: 'generation_1' };
        const snapshot = await createPrivateAuthoringSnapshot({ version: 5, projectId: '作品１', blocks: [],
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
            objectKey: 'users/owner_1/projects/作品１/migrations/generation_1/migrate-generation_1.json',
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
