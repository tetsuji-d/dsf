import { assertPrivateAuthoringDescriptor, readPrivateAuthoringSnapshot } from '../../js/private-authoring-storage.js';
import { AuthoringApiError, check, readBounded } from './common.js';

/** Accept ONLY the separate AUTHORING_BUCKET binding, never the public media bucket. */
export function createAuthoringBucket(bucket) {
    check(bucket && typeof bucket.get === 'function' && typeof bucket.put === 'function', 'CONFIG_AUTHORING_BUCKET');
    async function read(descriptor, scope) {
        assertPrivateAuthoringDescriptor(descriptor, scope);
        let object;
        try { object = await bucket.get(descriptor.objectKey); }
        catch { throw new AuthoringApiError('R2_UNAVAILABLE'); }
        check(object, 'AUTHORING_OBJECT_MISSING', 502);
        try {
            check(object.size === descriptor.byteLength
                && object.customMetadata?.sha256 === descriptor.sha256
                && object.customMetadata?.storageVersion === '1'
                && object.httpMetadata?.contentType === 'application/json', 'AUTHORING_OBJECT_CORRUPT', 502);
            const bytes = await readBounded(object.body, descriptor.byteLength);
            const project = await readPrivateAuthoringSnapshot(bytes, descriptor, scope);
            return { bytes, project };
        } catch {
            await object.body?.cancel().catch(() => {});
            throw new AuthoringApiError('AUTHORING_OBJECT_CORRUPT', 502);
        }
    }
    return {
        read,
        async put(snapshot, descriptor, scope) {
            assertPrivateAuthoringDescriptor(descriptor, scope);
            let stored;
            try {
                stored = await bucket.put(descriptor.objectKey, new TextEncoder().encode(snapshot.json), {
                    onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: descriptor.sha256,
                    httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
                    customMetadata: { sha256: descriptor.sha256, storageVersion: '1' },
                });
            } catch { throw new AuthoringApiError('R2_UNAVAILABLE'); }
            // Verify actual bytes for both new writes and a racing/retried immutable key.
            // A successful put or an ETag alone is not a committed authoring save.
            try { await read(descriptor, scope); }
            catch (error) {
                if (stored === null && error.code === 'AUTHORING_OBJECT_CORRUPT') throw new AuthoringApiError('IMMUTABLE_COLLISION', 409);
                throw error;
            }
        },
    };
}
