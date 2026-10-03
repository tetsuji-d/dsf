// Optional, derived file preview. Failure must never prevent manuscript saving.
export const DSP_COVER_PATH = 'preview/cover.png';
export const DSP_COVER_INFO_PATH = 'preview/cover.json';
export const DSP_COVER_WIDTH = 360;
export const DSP_COVER_HEIGHT = 640;
const MAX_BYTES = 1024 * 1024;
let pendingRender = null;

export function selectDspCoverSection(project) {
    const first = project.blocks?.find(block => block?.kind === 'page' || block?.kind === 'flow');
    if (first?.kind === 'flow') return null;
    const section = project.sections?.[0];
    if (!section || !['image', 'text'].includes(section.type)) return null;
    // Older bubbles need a defined composition order to include them faithfully.
    if (section.bubbles?.length && !section.objectOrder) return null;
    return section;
}

export async function webpToCoverPng(blob) {
    const image = await createImageBitmap(blob);
    try {
        if (image.width !== DSP_COVER_WIDTH || image.height !== DSP_COVER_HEIGHT) return null;
        const canvas = document.createElement('canvas');
        canvas.width = DSP_COVER_WIDTH; canvas.height = DSP_COVER_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0);
        return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } finally { image.close(); }
}

export async function createDspCoverPreview({project, guard, readGuard, render, encode = webpToCoverPng, timeoutMs = 1500}) {
    let timer;
    try {
        const section = selectDspCoverSection(project);
        if (!section || pendingRender || readGuard() !== guard) return null;
        const work = (async () => {
            const webp = await render(structuredClone(section), project.defaultLang || 'ja', DSP_COVER_WIDTH, DSP_COVER_HEIGHT);
            if (!(webp instanceof Blob) || readGuard() !== guard) return null;
            const png = await encode(webp);
            if (!(png instanceof Blob) || png.type !== 'image/png' || !png.size || png.size > MAX_BYTES || readGuard() !== guard) return null;
            return png;
        })().catch(() => null);
        pendingRender = work;
        void work.finally(() => { if (pendingRender === work) pendingRender = null; });
        return await Promise.race([work, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    } catch { return null; }
    finally { clearTimeout(timer); }
}

export async function addDspCoverPreview(zip, {png, projectJson, language, hashBytes}) {
    try {
        if (!(png instanceof Blob) || png.type !== 'image/png' || !png.size || png.size > MAX_BYTES) return false;
        const bytes = new Uint8Array(await png.arrayBuffer());
        const info = {
            schemaVersion: 1, language,
            width: DSP_COVER_WIDTH, height: DSP_COVER_HEIGHT,
            sourceSha256: await hashBytes(new TextEncoder().encode(projectJson)),
            imageSha256: await hashBytes(bytes),
        };
        zip.file(DSP_COVER_PATH, bytes, {createFolders:false});
        zip.file(DSP_COVER_INFO_PATH, JSON.stringify(info), {createFolders:false});
        return true;
    } catch {
        zip.remove(DSP_COVER_PATH); zip.remove(DSP_COVER_INFO_PATH);
        return false;
    }
}
