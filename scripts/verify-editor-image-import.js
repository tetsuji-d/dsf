import assert from 'node:assert/strict';
import { decodeAIImagePayload, validateAIImageDimensions, AI_IMAGE_MAX_BASE64 } from '../js/editor-image-payload.js';
import { createEditorImageTools } from '../js/editor-image-tools.js';
import { createEditorReadonlyTools } from '../js/editor-readonly-tools.js';
import { createFlowGroupBlock } from '../js/flow-project-model.js';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
const payload = { name: 'AI cover.png', mimeType: 'image/png', dataBase64: png };
assert.equal(decodeAIImagePayload(payload).type, 'image/png');
for (const bad of [{ mimeType: 'image/svg+xml' }, { dataBase64: `data:image/png;base64,${png}` }, { dataBase64: 'https://example.org/a.png' },
    { dataBase64: '===' }, { dataBase64: 'YW=J' }, { mimeType: 'image/jpeg' }, { dataBase64: 'YQ==' }, { name: '' }, { name: 'bad\nname' }]) {
    assert.throws(() => decodeAIImagePayload({ ...payload, ...bad }));
}
assert.throws(() => decodeAIImagePayload({ ...payload, dataBase64: 'A'.repeat(AI_IMAGE_MAX_BASE64 + 4) }), /IMAGE_TOO_LARGE/);
for (const size of [{ width: 16385, height: 1 }, { width: 10000, height: 10000 }, { width: 0, height: 100 }])
    await assert.rejects(() => validateAIImageDimensions(decodeAIImagePayload(payload), async () => size));
await assert.rejects(() => validateAIImageDimensions(decodeAIImagePayload(payload), async () => { throw Error('bad decode'); }), /INVALID_IMAGE_DATA/);
await validateAIImageDimensions(decodeAIImagePayload(payload), async () => ({ width: 1024, height: 1536 }));

const original = { room: 'editor', workIdentity: 'test', blocks: [createFlowGroupBlock({ id: 'flow' })], projectAssets: [],
    activeBlockId: 'flow', activeGroupId: 'flow', languageKey: 'ja', languageKeys: ['ja', 'en-GB'], busy: false };
let state = structuredClone(original), conversions = 0, applied = 0, history = [], discarded = [], pause = false, finish, serial = 0, failApply = false;
const readState = () => state;
const readonly = createEditorReadonlyTools({ readState }); readonly.enable();
const token = () => readonly.execute('dsf_get_editor_context', {}).workToken;
const prepareImage = async (file, options) => {
    assert.equal(file.type, 'image/png'); assert.equal(options.uid, null); assert.equal(options.maxLongEdge, 7680);
    conversions++;
    if (pause) await new Promise(resolve => { finish = resolve; });
    return { mainUrl: `blob:main${conversions}`, thumbUrl: `blob:thumb${conversions}`, width: 360, height: 640, byteLength: 2000 };
};
const service = createEditorImageTools({ readState, readonly, prepareImage, validateImage: async () => ({ width: 360, height: 640 }),
    discardImage: image => discarded.push(image), createToken: () => `test${++serial}`,
    applyImagePage: plan => { if (failApply) throw Error('failed'); history.push(structuredClone(state)); state = { ...state, blocks: plan.blocks, projectAssets: plan.projectAssets || state.projectAssets, activeBlockId: plan.pageId }; applied++; } });
const prepare = (args = {}, options = {}) => service.execute('dsf_prepare_image_import', { workToken: token(), ...payload, position: 'start', ...args }, options);
const add = imageToken => service.execute('dsf_add_image_page', { workToken: token(), imageToken });
const code = (value, expected) => assert.equal(value.error?.code, expected);
const settle = () => new Promise(resolve => setImmediate(resolve));
assert.ok(!service.getTools(false).some(t => t.name === 'dsf_prepare_image_import'));
assert.ok(service.getTools(true).some(t => t.name === 'dsf_prepare_image_import'));
code(await prepare({ url: 'https://example.org' }), 'INVALID_ARGUMENTS'); assert.equal(conversions, 0);
code(await prepare({ mimeType: 'image/jpeg' }), 'INVALID_IMAGE_DATA'); assert.equal(conversions, 0);
let prepared = await prepare(); assert.equal(prepared.changed, false); assert.equal(prepared.image.mimeType, 'image/webp');
assert.equal(prepared.nextBlockId, 'flow'); assert.deepEqual(state, original); assert.ok(!JSON.stringify(prepared).includes(png));
assert.equal(add(prepared.imageToken).changed, true); assert.equal(state.projectAssets.length, 1); assert.equal(state.blocks.length, 2);
assert.deepEqual(state.blocks[1], original.blocks[0]); assert.equal(state.blocks[0].content.backgrounds.ja, 'blob:main1');
assert.equal(add(prepared.imageToken).replayed, true); assert.equal(applied, 1);
state = history.pop(); assert.deepEqual(state, original, 'one Undo restores assets and pages');
prepared = await prepare(); state.languageKey = 'en-GB'; code(add(prepared.imageToken), 'STALE_IMAGE_TOKEN'); await settle(); assert.equal(discarded.length, 1);
state = structuredClone(original); prepared = await prepare(); service.reset(); await settle(); code(add(prepared.imageToken), 'STALE_IMAGE_TOKEN'); assert.equal(discarded.length, 2);
prepared = await prepare(); await prepare(); await settle(); assert.equal(discarded.length, 3, 'reprepare cleans previous ticket');
service.reset(); await settle();
pause = true; let pending = prepare(); await settle(); code(await prepare(), 'BUSY'); service.reset(); finish(); code(await pending, 'TARGET_CHANGED'); await settle();
assert.deepEqual(state, original); const countAfterReset = discarded.length;
pending = prepare(); await settle(); state.workIdentity = 'other'; finish(); code(await pending, 'TARGET_CHANGED'); await settle(); assert.equal(discarded.length, countAfterReset + 1);
state = structuredClone(original); readonly.enable(); const abort = new AbortController(); pending = prepare({}, { signal: abort.signal }); await settle(); abort.abort(); finish(); code(await pending, 'TARGET_CHANGED'); await settle();
pause = false; failApply = true; prepared = await prepare(); const beforeFailure = discarded.length; code(add(prepared.imageToken), 'EDIT_FAILED'); await settle(); assert.equal(discarded.length, beforeFailure + 1); assert.deepEqual(state, original);
failApply = false; service.reset(); readonly.disable(); code(await service.execute('dsf_prepare_image_import', { workToken: 'revoked', ...payload, position: 'start' }), 'DISABLED');
console.log('AI image import passed: bounded raster bytes, MIME/dimension validation, shared WebP options, prepare/add/Undo/replay, changed target, revocation, abort, cleanup and write permission registration.');
