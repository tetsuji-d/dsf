import { detectDspPublicationThumbnailMimeType, decodeDspPublicationThumbnailImage } from './dsp-publication-thumbnail-import.js';
export const AI_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const AI_IMAGE_MAX_BASE64 = 4 * Math.ceil(AI_IMAGE_MAX_BYTES / 3);
export const AI_IMAGE_MAX_EDGE = 16384;
export const AI_IMAGE_MAX_PIXELS = 40_000_000;
export const AI_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Decode only inline raster bytes. No URL fetch, clipboard access or markup. */
export function decodeAIImagePayload({ name, mimeType, dataBase64 }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name)
        || !AI_IMAGE_MIME_TYPES.includes(mimeType) || typeof dataBase64 !== 'string') throw Error('INVALID_ARGUMENTS');
    if (dataBase64.length > AI_IMAGE_MAX_BASE64) throw Error('IMAGE_TOO_LARGE');
    // Avoid repeated-group regexes that can overflow the stack on multi-MB inputs.
    const padding = dataBase64.indexOf('=');
    if (!dataBase64.length || dataBase64.length % 4 || /[^A-Za-z0-9+/=]/u.test(dataBase64)
        || (padding >= 0 && (padding < dataBase64.length - 2 || !/^={1,2}$/u.test(dataBase64.slice(padding))))) throw Error('INVALID_IMAGE_DATA');
    let binary;
    try { binary = atob(dataBase64); } catch { throw Error('INVALID_IMAGE_DATA'); }
    if (!binary.length || binary.length > AI_IMAGE_MAX_BYTES) throw Error('IMAGE_TOO_LARGE');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (detectDspPublicationThumbnailMimeType(bytes) !== mimeType) throw Error('INVALID_IMAGE_DATA');
    return new File([bytes], name.trim(), { type: mimeType });
}

export async function validateAIImageDimensions(file, decode = decodeDspPublicationThumbnailImage) {
    let size;
    try { size = await decode(file); } catch { throw Error('INVALID_IMAGE_DATA'); }
    if (![size.width, size.height].every(n => Number.isSafeInteger(n) && n > 0)) throw Error('INVALID_IMAGE_DATA');
    if (size.width > AI_IMAGE_MAX_EDGE || size.height > AI_IMAGE_MAX_EDGE || size.width * size.height > AI_IMAGE_MAX_PIXELS) throw Error('IMAGE_TOO_LARGE');
    return size;
}
