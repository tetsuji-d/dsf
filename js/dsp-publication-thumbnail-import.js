export const DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE = 16384;
export const DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_PIXELS = 80_000_000;

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
});

function hasBytes(bytes, expected, offset = 0) {
    return expected.every((byte, index) => bytes[offset + index] === byte);
}

function fail(code, message, details = {}) {
    throw new DspPublicationThumbnailImportError(code, message, details);
}

function normalizeArchiveAssetPath(reference) {
    if (reference === undefined || reference === null || reference === '') return '';
    if (typeof reference !== 'string'
        || reference !== reference.trim()
        || !reference.startsWith('assets/')
        || reference.includes('\\')
        || /[\u0000-\u001f\u007f]/u.test(reference)) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_REFERENCE_INVALID',
            'Invalid .dsp file: publicationThumbnailUrl must reference an embedded assets/ image.',
            { reference },
        );
    }
    const segments = reference.split('/');
    if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_REFERENCE_INVALID',
            'Invalid .dsp file: publicationThumbnailUrl contains an unsafe archive path.',
            { reference },
        );
    }
    const extension = segments.at(-1).split('.').at(-1).toLowerCase();
    if (!IMAGE_MIME_BY_EXTENSION[extension]) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_EXTENSION_UNSUPPORTED',
            'Invalid .dsp file: publication thumbnail uses an unsupported image extension.',
            { reference, extension },
        );
    }
    return reference;
}

export class DspPublicationThumbnailImportError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'DspPublicationThumbnailImportError';
        this.code = code;
        this.details = details;
    }
}

export function detectDspPublicationThumbnailMimeType(bytes) {
    if (!(bytes instanceof Uint8Array)) return '';
    if (bytes.length >= 12
        && hasBytes(bytes, [0x52, 0x49, 0x46, 0x46])
        && hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
        return 'image/webp';
    }
    if (bytes.length >= 8
        && hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'image/png';
    }
    if (bytes.length >= 3 && hasBytes(bytes, [0xff, 0xd8, 0xff])) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const signature = String.fromCharCode(...bytes.subarray(0, 6));
        if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
    }
    return '';
}

export async function decodeDspPublicationThumbnailImage(blob, {
    createImageBitmapRef = globalThis.createImageBitmap,
    ImageConstructor = globalThis.Image,
    urlApi = globalThis.URL,
} = {}) {
    if (!(blob instanceof Blob)) throw new TypeError('Publication thumbnail decoder requires a Blob.');
    let bitmapError = null;
    if (typeof createImageBitmapRef === 'function') {
        try {
            const bitmap = await createImageBitmapRef(blob);
            try {
                return { width: bitmap.width, height: bitmap.height };
            } finally {
                bitmap.close?.();
            }
        } catch (error) {
            bitmapError = error;
        }
    }
    if (typeof ImageConstructor !== 'function'
        || typeof urlApi?.createObjectURL !== 'function'
        || typeof urlApi?.revokeObjectURL !== 'function') {
        throw bitmapError || new Error('Browser image decoding is unavailable.');
    }
    const objectUrl = urlApi.createObjectURL(blob);
    try {
        const image = new ImageConstructor();
        image.decoding = 'async';
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Publication thumbnail image decoding failed.'));
            image.src = objectUrl;
        });
        return {
            width: Number(image.naturalWidth || image.width),
            height: Number(image.naturalHeight || image.height),
        };
    } finally {
        urlApi.revokeObjectURL(objectUrl);
    }
}

/**
 * Validate the optional DSP authoring thumbnail before any Object URL is made.
 * Only an existing archive-local image with matching extension and signature is returned.
 */
export async function validateDspPublicationThumbnailArchiveAsset({
    reference,
    getArchiveEntry,
    maximumBytes = DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES,
    decodeImage = decodeDspPublicationThumbnailImage,
} = {}) {
    const relativePath = normalizeArchiveAssetPath(reference);
    if (!relativePath) return null;
    if (typeof getArchiveEntry !== 'function') {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_ARCHIVE_INVALID',
            'Invalid .dsp file: publication thumbnail archive lookup is unavailable.',
        );
    }
    const byteLimit = Number.isSafeInteger(maximumBytes) && maximumBytes > 0
        ? Math.min(maximumBytes, DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES)
        : DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_BYTES;
    const entry = getArchiveEntry(relativePath);
    if (!entry || entry.dir || typeof entry.async !== 'function') {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_ASSET_MISSING',
            'Invalid .dsp file: publication thumbnail asset is missing.',
            { relativePath },
        );
    }
    const declaredBytes = entry?._data?.uncompressedSize;
    if (declaredBytes !== undefined
        && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 1 || declaredBytes > byteLimit)) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_SIZE_INVALID',
            'Invalid .dsp file: publication thumbnail exceeds the 25 MB import limit.',
            { relativePath, byteLength: declaredBytes, maximumBytes: byteLimit },
        );
    }
    let bytes;
    try {
        bytes = await entry.async('uint8array');
    } catch (error) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_READ_FAILED',
            'Invalid .dsp file: publication thumbnail could not be read.',
            { relativePath, cause: error?.message || String(error) },
        );
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > byteLimit) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_SIZE_INVALID',
            'Invalid .dsp file: publication thumbnail exceeds the 25 MB import limit.',
            { relativePath, byteLength: bytes?.byteLength, maximumBytes: byteLimit },
        );
    }
    const mimeType = detectDspPublicationThumbnailMimeType(bytes);
    if (!mimeType) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_FORMAT_INVALID',
            'Invalid .dsp file: publication thumbnail is not a supported image.',
            { relativePath },
        );
    }
    const extension = relativePath.split('.').at(-1).toLowerCase();
    if (IMAGE_MIME_BY_EXTENSION[extension] !== mimeType) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_FORMAT_MISMATCH',
            'Invalid .dsp file: publication thumbnail extension does not match its image bytes.',
            { relativePath, mimeType },
        );
    }
    let dimensions;
    try {
        dimensions = await decodeImage(new Blob([bytes], { type: mimeType }), {
            relativePath,
            mimeType,
        });
    } catch (error) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_DECODE_FAILED',
            'Invalid .dsp file: publication thumbnail image could not be decoded.',
            { relativePath, mimeType, cause: error?.message || String(error) },
        );
    }
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width < 1
        || height < 1
        || width > DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE
        || height > DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_EDGE
        || (width * height) > DSP_PUBLICATION_THUMBNAIL_MAX_IMPORT_PIXELS) {
        fail(
            'DSP_PUBLICATION_THUMBNAIL_DIMENSIONS_INVALID',
            'Invalid .dsp file: publication thumbnail dimensions are unsupported.',
            { relativePath, width, height },
        );
    }
    return Object.freeze({
        relativePath,
        mimeType,
        width,
        height,
        bytes: bytes.slice(),
    });
}
