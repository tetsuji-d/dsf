// Test-only Worker fixture. Not a Pages route and never included in deployment.
import { createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor } from '../../js/private-authoring-storage.js';
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
        return Response.json({ passed: true, byteLength: snapshot.byteLength });
    },
};
