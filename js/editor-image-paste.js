import { ASSET_MAX_LONG_EDGE, validateProjectAssets } from './project-assets.js';
import { createImagePagePlan, imagePageSnapshot } from './editor-image-page.js';

export function clipboardImageFiles(data) {
    const files = Array.from(data?.files || []).filter(file => file.type.startsWith('image/'));
    return files.length ? files : Array.from(data?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
}

/** Conversion happens before a single history transaction; concurrent changes cancel it. */
export function createImagePageImporter({ readState, prepareImage, applyImagePage, discardImage = () => {}, onStatus = () => {}, createId = () => `asset_${crypto.randomUUID()}` }) {
    let busy = false;
    const captureTarget = () => { const state = readState(); return { identity: state.workIdentity, snapshot: imagePageSnapshot(state) }; };
    async function importFiles(files, expected) {
        if (busy) { onStatus('busy'); return false; }
        const original = readState();
        if (expected && (expected.identity !== original.workIdentity || expected.snapshot !== imagePageSnapshot(original))) { onStatus('cancelled'); return false; }
        if (original.room !== 'editor' || original.busy) { onStatus('busy'); return false; }
        if (!files.length || files.length > 20 || files.some(file => !file.type?.startsWith('image/'))) { onStatus('invalid'); return false; }
        const snapshot = imagePageSnapshot(original), identity = original.workIdentity;
        const prepared = [];
        busy = true; onStatus('converting');
        try {
            let next = { ...original, projectAssets: [...(original.projectAssets || [])] }, result;
            for (const file of files) {
                const image = await prepareImage(file, { uid: null, maxLongEdge: ASSET_MAX_LONG_EDGE });
                prepared.push(image);
                const current = readState();
                if (current.room !== 'editor' || current.busy || current.workIdentity !== identity || imagePageSnapshot(current) !== snapshot) throw Error('cancelled');
                const asset = { id: createId(), name: (file.name || 'Clipboard image').slice(0, 512), background: image.mainUrl, thumbnail: image.thumbUrl,
                    width: image.width, height: image.height, byteLength: image.byteLength, mimeType: 'image/webp' };
                if (!validateProjectAssets([asset])) throw Error('invalid');
                next.projectAssets.push(asset);
                result = createImagePagePlan(next, asset.id, next.activeBlockId ? 'after' : 'end');
                next = { ...next, blocks: result.blocks, activeBlockId: result.pageId };
            }
            applyImagePage({ ...result, projectAssets: next.projectAssets });
            prepared.length = 0;
            onStatus('added'); return true;
        } catch (e) { onStatus(e.message === 'cancelled' ? 'cancelled' : 'failed'); return false; }
        finally { for (const image of prepared) { try { await discardImage(image); } catch { /* Cleanup must not keep the importer locked. */ } } busy = false; }
    }
    return { importFiles, captureTarget, isBusy: () => busy };
}

export function installImagePagePaste({ doc = document, clipboard = navigator.clipboard, importer, inEditor, onStatus }) {
    doc.addEventListener('paste', event => {
        if (!inEditor()) return;
        const files = clipboardImageFiles(event.clipboardData);
        if (!files.length) return;
        // Image-only paste must never enter text handlers and erase selected text.
        const field = event.target.closest?.('input, textarea, [role="dialog"], [data-studio-ai]');
        if (field && !field.matches('.flow-direct-input-proxy')) return;
        event.preventDefault(); event.stopImmediatePropagation();
        void importer.importFiles(files);
    }, true);
    return async () => {
        if (!inEditor()) return;
        const target = importer.captureTarget();
        try {
            if (!clipboard?.read) throw Error('unavailable');
            const items = await clipboard.read();
            const files = [];
            for (const item of items) {
                const type = item.types.find(type => type.startsWith('image/'));
                if (type) files.push(new File([await item.getType(type)], 'Clipboard image', { type }));
            }
            if (!files.length) { onStatus('empty'); return; }
            await importer.importFiles(files, target);
        } catch { onStatus('clipboard'); }
    };
}
