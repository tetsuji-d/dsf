/** Project-owned image library; never a delivery page list. */
export const ASSET_MAX_LONG_EDGE = 7680;
export const ASSET_MAX_BYTES = 25 * 1024 * 1024;
export function validateProjectAssets(assets = []) {
    if (!Array.isArray(assets)) throw new Error('Invalid project asset list');
    const ids = new Set();
    for (const asset of assets) {
        if (!asset || typeof asset.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(asset.id)
            || ids.has(asset.id) || typeof asset.name !== 'string' || asset.name.length > 512
            || asset.mimeType !== 'image/webp'
            || !Number.isSafeInteger(asset.width) || asset.width < 1 || asset.width > ASSET_MAX_LONG_EDGE
            || !Number.isSafeInteger(asset.height) || asset.height < 1 || asset.height > ASSET_MAX_LONG_EDGE
            || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || asset.byteLength > ASSET_MAX_BYTES
            || typeof asset.background !== 'string' || !asset.background
            || typeof asset.thumbnail !== 'string' || !asset.thumbnail
            || ![asset.background, asset.thumbnail].every(url => /^(https:\/\/|blob:|assets\/)/.test(url))) throw new Error('Invalid project asset');
        ids.add(asset.id);
    }
    return assets;
}
export function getAssetUsage(blocks, asset) {
    let count = 0;
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, entry] of Object.entries(value)) {
            if (key === 'assetId' && entry === asset.id) count++;
            else if (key === 'background' && entry === asset.background) count++;
            else if (key === 'backgrounds' && entry && Object.values(entry).includes(asset.background)) count++;
            else if (typeof entry === 'object') visit(entry);
        }
    };
    visit(blocks);
    return count > 0;
}
/** Shared sequential URL mapping for cloud and portable archives. */
export async function mapProjectAssetUrls(assets, resolve) {
    validateProjectAssets(assets);
    const result = [];
    for (const asset of assets) result.push({ ...asset,
        background: await resolve(asset.background, asset, 'image'),
        thumbnail: await resolve(asset.thumbnail, asset, 'thumbnail') });
    return result;
}

/** Register a prepared image once, reusing its stored bytes and thumbnail. */
export function appendPreparedProjectAsset(assets = [], image, name, id) {
    if (assets.some(asset => asset.background === image.mainUrl)) return assets;
    const asset = { id, name: String(name || 'Image').slice(0, 512), background: image.mainUrl,
        thumbnail: image.thumbUrl || image.mainUrl, width: image.width, height: image.height,
        byteLength: image.byteLength, mimeType: 'image/webp' };
    validateProjectAssets([asset]);
    return [...assets, asset];
}

/** Display old page backgrounds without silently rewriting or downloading the project. */
export function listUnregisteredPageImages(blocks = [], assets = []) {
    const registered = new Set(assets.map(asset => asset.background)), images = new Map();
    for (const block of blocks) {
        const content = block.content;
        if (!content || block.kind === 'flow' || (block.kind === 'page' && content.pageKind === 'text')) continue;
        for (const [language, url] of Object.entries({ '': content.background, ...content.backgrounds })) {
            if (typeof url !== 'string' || !/^(https:\/\/|blob:|assets\/)/.test(url) || registered.has(url)) continue;
            if (!images.has(url)) images.set(url, { background: url, thumbnail: url, blockIds: [], languages: [] });
            const image = images.get(url);
            if (!image.blockIds.includes(block.id)) image.blockIds.push(block.id);
            if (language && !image.languages.includes(language)) image.languages.push(language);
        }
    }
    return [...images.values()];
}
