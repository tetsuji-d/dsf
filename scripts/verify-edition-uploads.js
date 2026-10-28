import assert from 'node:assert/strict';
import { handleImageUpload } from '../functions/upload.js';
import { editionStorageTombstone } from '../server/edition-storage.js';
const bytes = Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
const objects = new Map(); let writes = 0, disposeDuringPut = false;
const bucket = {
    async head(key) { return objects.has(key) ? { key } : null; },
    async get(key) { return objects.has(key) ? { arrayBuffer: async () => objects.get(key).buffer } : null; },
    async put(key, data, options) {
        if (options.onlyIf && objects.has(key)) return null;
        writes++; objects.set(key, new Uint8Array(data));
        if (disposeDuringPut) objects.set(editionStorageTombstone('owner','race','release'),new Uint8Array([1]));
        return { key };
    },
    async delete(key) { objects.delete(key); },
};
async function send(path, data = bytes) {
    const form = new FormData(); form.append('path', path); form.append('file', new Blob([data], { type:'image/webp' }), 'page.webp');
    return handleImageUpload({ request: new Request('https://studio.test/upload', {
        method:'POST', headers:{Authorization:'Bearer synthetic'}, body:form,
    }), env:{R2_BUCKET:bucket,R2_PUBLIC_URL:'https://media.test'}, verifyToken:async()=> 'owner' });
}
const path = 'users/owner/dsf/work/release/ja/page_001.webp';
assert.equal((await send(path)).status, 200);
assert.equal((await send(path)).status, 200); assert.equal(writes, 1, 'retry must not overwrite a release asset');
const different = new Uint8Array(bytes); different[different.length - 1] ^= 1;
assert.equal((await send(path, different)).status, 409);
assert.deepEqual(objects.get(path), bytes);
assert.equal((await send('users/owner/dsf/work/release/assets/images/language-0001/page-00001.webp')).status, 400, 'v2 cannot bypass the sealed upload endpoint');
objects.set(editionStorageTombstone('owner','work','release'), new Uint8Array([1]));
assert.equal((await send(path)).status, 409);
assert.equal((await send('users/owner/dsf/work/release/ja/page_002.webp')).status, 409);
disposeDuringPut = true;
assert.equal((await send('users/owner/dsf/race/release/ja/page_001.webp')).status,409);
assert.equal(objects.has('users/owner/dsf/race/release/ja/page_001.webp'),false,'a late upload must not resurrect a shredded asset');
disposeDuringPut = false;
for (const unrelated of ['users/owner/dsf/recovered/image.webp', 'users/owner/authoring/image.webp', 'users/owner/dsf/123_image.webp']) {
    assert.equal((await send(unrelated)).status, 200);
    assert.equal((await send(unrelated,different)).status, 200, 'ordinary authoring images keep existing behavior');
}
console.log('Edition asset create-only upload, exact retry, disposed barriers and unchanged authoring uploads passed.');
