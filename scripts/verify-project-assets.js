import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { validateProjectAssets, mapProjectAssetUrls, getAssetUsage } from '../js/project-assets.js';
import { prepareProjectForSave, hydrateProjectFromPersistence, createPublicProjectProjection } from '../js/project-persistence.js';
import { createPageBlockFromSection } from '../js/blocks.js';
import { createHistorySnapshot } from '../js/history.js';
import { state, dispatch, actionTypes } from '../js/state.js';
const asset = { id: 'asset_test', name: 'unused.webp', background: 'blob:image', thumbnail: 'blob:thumb', width: 7680, height: 3840, byteLength: 2000, mimeType: 'image/webp' };
const project = prepareProjectForSave({version:5, blocks:[createPageBlockFromSection({type:'image'})], projectAssets:[asset], languages:['ja'], defaultLang:'ja'});
assert.equal(project.version, 6);
assert.deepEqual(hydrateProjectFromPersistence(JSON.parse(JSON.stringify(project))).projectAssets, [asset]);
assert.equal(Object.hasOwn(createPublicProjectProjection(project), 'projectAssets'), false);
assert.equal(getAssetUsage(project.blocks, asset), false);
project.blocks[0].content.backgrounds = {ja:asset.background};
assert.equal(getAssetUsage(project.blocks, asset), true);
assert.deepEqual(createHistorySnapshot(project).projectAssets, [asset]);
const archive = await mapProjectAssetUrls([asset], async (_, a, kind) => `assets/library/${a.id}-${kind}.webp`);
assert.equal(archive[0].background, 'assets/library/asset_test-image.webp');
assert.equal(archive[0].byteLength, 2000);
assert.throws(() => validateProjectAssets([{...asset,width:7681}]));
assert.throws(() => validateProjectAssets([asset,asset]));
assert.throws(() => validateProjectAssets([{...asset,background:'javascript:alert(1)'}]));
assert.throws(() => prepareProjectForSave({...project,version:7}));
state.projectAssets=[asset];
dispatch({type:actionTypes.LOAD_PROJECT,payload:{projectId:'other'}});
assert.deepEqual(state.projectAssets,[]);
console.log('Project asset persistence, isolation, size and history verification passed.');

// Shared page/library URLs must not consume the local mapping on first upload.
const firebaseSource = await readFile(new URL('../js/firebase.js', import.meta.url), 'utf8');
const resolverSource = firebaseSource.match(/async function _uploadBlobUrlToStorage\(blobUrl, uid\) \{[\s\S]*?\n\}/)[0];
let uploads = 0;
const localImageMap = { 'blob:shared': 'local-image' };
const resolve = runInNewContext(`(${resolverSource})`, {
    recoveredAssetUrls: new Map(), window: { localImageMap },
    idbGet: async () => new Blob(['image']), createId: () => 'image-id',
    _storeFile: async (_, path) => { uploads++; return `https://example.test/${path}`; },
    console,
});
const pageUrl = await resolve('blob:shared', 'owner');
assert.equal(await resolve('blob:shared', 'owner'), pageUrl);
assert.equal(uploads, 1);
assert.equal(localImageMap['blob:shared'], 'local-image');
assert.notEqual(await resolve('blob:shared', 'another-owner'), pageUrl);
assert.equal(uploads, 2);
console.log('Shared cloud image resolution verification passed.');
