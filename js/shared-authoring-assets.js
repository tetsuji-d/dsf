// Private references are scoped by the opened work, never by a caller-supplied bucket key.
export const privateImageRef = hash => `assets/private/${hash}.webp`;
export const privateImageHash = ref => typeof ref === 'string' ? /^assets\/private\/([a-f0-9]{64})\.webp$/.exec(ref)?.[1] || null : null;
export async function mapSharedImageSlots(project, transform) {
    const result = structuredClone(project);
    async function slot(object, key) {
        const value = object[key];
        if (typeof value === 'string' && value) object[key] = await transform(value);
    }
    async function owner(value) {
        if (!value || typeof value !== 'object') return;
        for (const key of ['background', 'thumbnail', 'publicationThumbnailUrl']) await slot(value, key);
        for (const key of Object.keys(value.backgrounds || {})) await slot(value.backgrounds, key);
        for (const layer of value.layers || []) { await owner(layer); if (layer.type === 'image') await slot(layer, 'src'); }
    }
    await owner(result);
    for (const value of result.projectAssets || []) await owner(value);
    for (const block of result.blocks || []) await owner(block.content);
    for (const value of result.sections || []) await owner(value);
    for (const value of result.pages || []) await owner(value);
    return result;
}
