/**
 * Local byte sealing for DSF delivery v2 release assets.
 *
 * This module validates actual RIFF/WebP bytes, derives their encoded canvas
 * dimensions, and binds an immutable Blob to its SHA-256 descriptor. It has no
 * dependency on Press UI, Viewer, state, file export, Firebase, R2, or network
 * APIs. Nothing is uploaded or published here.
 */

export const DSF_RELEASE_BYTE_SEALING_VERSION = 1;

const MAX_WEBP_BYTES = 128 * 1024 * 1024;
const MAX_HASH_BYTES = 256 * 1024 * 1024;
const MAX_WEBP_DIMENSION = 32_768;
const MAX_WEBP_CHUNKS = 64;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const INPUT_KEYS = new Set([
    'bytes',
    'expectedWidth',
    'expectedHeight',
    'expectedSha256',
    'pageId',
    'pageLabel',
]);
const SUPPORTED_CHUNKS = new Set([
    'VP8X',
    'ICCP',
    'ALPH',
    'VP8 ',
    'VP8L',
    'EXIF',
    'XMP ',
    'ANIM',
    'ANMF',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function throwIssue(code, path, message, details) {
    throw new DsfReleaseByteSealingError([createIssue(code, path, message, details)]);
}

function readFourCc(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint16Le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24Le(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Le(bytes, offset) {
    return (
        bytes[offset]
        + (bytes[offset + 1] * 0x100)
        + (bytes[offset + 2] * 0x10000)
        + (bytes[offset + 3] * 0x1000000)
    );
}

function validDimension(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_WEBP_DIMENSION;
}

function validateOwnedWebPByteLength(bytes) {
    if (bytes.byteLength < 20) {
        throwIssue('WEBP_BYTES_TOO_SHORT', 'bytes', 'WebP asset is too short to contain a valid image chunk.');
    }
    if (bytes.byteLength > MAX_WEBP_BYTES) {
        throwIssue('WEBP_BYTES_LIMIT_EXCEEDED', 'bytes', 'WebP asset exceeds the release byte limit.');
    }
}

async function toOwnedBytes(input, options = {}) {
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        if (options.requireWebP && input.type && input.type.toLowerCase() !== 'image/webp') {
            throwIssue('WEBP_MIME_TYPE_MISMATCH', 'bytes.type', 'Blob MIME type must be image/webp when supplied.');
        }
        const bytes = new Uint8Array(await input.arrayBuffer());
        if (options.requireWebP) validateOwnedWebPByteLength(bytes);
        else if (bytes.byteLength > MAX_HASH_BYTES) throwIssue('RELEASE_HASH_BYTES_LIMIT_EXCEEDED', 'bytes', 'Hash input exceeds the release sealing limit.');
        return bytes;
    }
    if (input instanceof ArrayBuffer) {
        const bytes = new Uint8Array(input.slice(0));
        if (options.requireWebP) validateOwnedWebPByteLength(bytes);
        else if (bytes.byteLength > MAX_HASH_BYTES) throwIssue('RELEASE_HASH_BYTES_LIMIT_EXCEEDED', 'bytes', 'Hash input exceeds the release sealing limit.');
        return bytes;
    }
    if (ArrayBuffer.isView(input)) {
        const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        const bytes = new Uint8Array(view);
        if (options.requireWebP) validateOwnedWebPByteLength(bytes);
        else if (bytes.byteLength > MAX_HASH_BYTES) throwIssue('RELEASE_HASH_BYTES_LIMIT_EXCEEDED', 'bytes', 'Hash input exceeds the release sealing limit.');
        return bytes;
    }
    throwIssue(
        'WEBP_BYTE_SOURCE_INVALID',
        'bytes',
        'WebP bytes must be a Blob, ArrayBuffer, or ArrayBuffer view.',
    );
}

function parseVp8(bytes, dataOffset, chunkSize) {
    if (chunkSize < 10) {
        throwIssue('WEBP_VP8_HEADER_TRUNCATED', 'bytes', 'VP8 chunk is too short for a key-frame header.');
    }
    if ((bytes[dataOffset] & 0x01) !== 0) {
        throwIssue('WEBP_VP8_KEY_FRAME_REQUIRED', 'bytes', 'A still WebP must contain a VP8 key frame.');
    }
    if (
        bytes[dataOffset + 3] !== 0x9d
        || bytes[dataOffset + 4] !== 0x01
        || bytes[dataOffset + 5] !== 0x2a
    ) {
        throwIssue('WEBP_VP8_START_CODE_INVALID', 'bytes', 'VP8 key-frame start code is invalid.');
    }
    const width = readUint16Le(bytes, dataOffset + 6) & 0x3fff;
    const height = readUint16Le(bytes, dataOffset + 8) & 0x3fff;
    if (!validDimension(width) || !validDimension(height)) {
        throwIssue('WEBP_DIMENSION_INVALID', 'bytes', 'VP8 encoded dimensions are outside the release limit.');
    }
    return { codec: 'VP8', width, height, alpha: false };
}

function parseVp8L(bytes, dataOffset, chunkSize) {
    if (chunkSize < 5) {
        throwIssue('WEBP_VP8L_HEADER_TRUNCATED', 'bytes', 'VP8L chunk is too short for its image header.');
    }
    if (bytes[dataOffset] !== 0x2f) {
        throwIssue('WEBP_VP8L_SIGNATURE_INVALID', 'bytes', 'VP8L signature byte is invalid.');
    }
    const b1 = bytes[dataOffset + 1];
    const b2 = bytes[dataOffset + 2];
    const b3 = bytes[dataOffset + 3];
    const b4 = bytes[dataOffset + 4];
    if ((b4 >> 5) !== 0) {
        throwIssue('WEBP_VP8L_VERSION_UNSUPPORTED', 'bytes', 'VP8L version must be zero.');
    }
    const width = 1 + (((b2 & 0x3f) << 8) | b1);
    const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    if (!validDimension(width) || !validDimension(height)) {
        throwIssue('WEBP_DIMENSION_INVALID', 'bytes', 'VP8L encoded dimensions are outside the release limit.');
    }
    return { codec: 'VP8L', width, height, alpha: (b4 & 0x10) !== 0 };
}

function parseVp8X(bytes, dataOffset, chunkSize, chunkOffset) {
    if (chunkOffset !== 12) {
        throwIssue('WEBP_VP8X_ORDER_INVALID', 'bytes', 'VP8X must be the first WebP chunk.');
    }
    if (chunkSize !== 10) {
        throwIssue('WEBP_VP8X_SIZE_INVALID', 'bytes', 'VP8X chunk payload must be exactly 10 bytes.');
    }
    const flags = bytes[dataOffset];
    if ((flags & 0xc1) !== 0) {
        throwIssue('WEBP_VP8X_RESERVED_FLAGS', 'bytes', 'VP8X reserved feature bits must be zero.');
    }
    if (bytes[dataOffset + 1] || bytes[dataOffset + 2] || bytes[dataOffset + 3]) {
        throwIssue('WEBP_VP8X_RESERVED_BYTES', 'bytes', 'VP8X reserved bytes must be zero.');
    }
    const width = 1 + readUint24Le(bytes, dataOffset + 4);
    const height = 1 + readUint24Le(bytes, dataOffset + 7);
    if (!validDimension(width) || !validDimension(height)) {
        throwIssue('WEBP_DIMENSION_INVALID', 'bytes', 'VP8X canvas dimensions are outside the release limit.');
    }
    return { flags, width, height };
}

function validateExtendedFeatureFlags(vp8x, features) {
    if (!vp8x) {
        if (features.iccp || features.exif || features.xmp || features.alphaChunk) {
            throwIssue('WEBP_EXTENDED_HEADER_REQUIRED', 'bytes', 'Metadata and ALPH chunks require a VP8X header.');
        }
        return;
    }
    const expected = {
        iccp: (vp8x.flags & 0x20) !== 0,
        alpha: (vp8x.flags & 0x10) !== 0,
        exif: (vp8x.flags & 0x08) !== 0,
        xmp: (vp8x.flags & 0x04) !== 0,
        animation: (vp8x.flags & 0x02) !== 0,
    };
    const actual = {
        iccp: features.iccp,
        alpha: features.alphaChunk || features.losslessAlpha,
        exif: features.exif,
        xmp: features.xmp,
        animation: features.animation,
    };
    for (const key of Object.keys(expected)) {
        // VP8L's alpha bit is only an encoder hint. A VP8X alpha flag with a
        // VP8L primary is sufficient even when that hint is zero.
        if (key === 'alpha' && expected.alpha && features.primaryCodec === 'VP8L') continue;
        if (expected[key] !== actual[key]) {
            throwIssue(
                'WEBP_VP8X_FEATURE_MISMATCH',
                'bytes',
                `VP8X ${key} feature flag does not match contained chunks.`,
                { feature: key, flag: expected[key], content: actual[key] },
            );
        }
    }
}

function inspectOwnedWebPBytes(bytes) {
    if (readFourCc(bytes, 0) !== 'RIFF' || readFourCc(bytes, 8) !== 'WEBP') {
        throwIssue('WEBP_CONTAINER_SIGNATURE_INVALID', 'bytes', 'Asset must use the RIFF WEBP container signature.');
    }
    const declaredRiffSize = readUint32Le(bytes, 4);
    if (declaredRiffSize !== bytes.byteLength - 8) {
        throwIssue(
            'WEBP_RIFF_SIZE_MISMATCH',
            'bytes',
            'RIFF size must exactly match the supplied WebP bytes.',
            { declaredRiffSize, actualRiffSize: bytes.byteLength - 8 },
        );
    }

    const chunks = [];
    const features = {
        iccp: false,
        exif: false,
        xmp: false,
        alphaChunk: false,
        losslessAlpha: false,
        primaryCodec: null,
        animation: false,
    };
    let offset = 12;
    let vp8x = null;
    let primary = null;
    while (offset < bytes.byteLength) {
        if (chunks.length >= MAX_WEBP_CHUNKS) {
            throwIssue('WEBP_CHUNK_LIMIT_EXCEEDED', 'bytes', 'WebP contains too many RIFF chunks.');
        }
        if (bytes.byteLength - offset < 8) {
            throwIssue('WEBP_CHUNK_HEADER_TRUNCATED', 'bytes', 'WebP ends inside a RIFF chunk header.');
        }
        const fourCc = readFourCc(bytes, offset);
        const chunkSize = readUint32Le(bytes, offset + 4);
        const dataOffset = offset + 8;
        const dataEnd = dataOffset + chunkSize;
        const paddedEnd = dataEnd + (chunkSize & 1);
        if (dataEnd > bytes.byteLength || paddedEnd > bytes.byteLength) {
            throwIssue('WEBP_CHUNK_TRUNCATED', 'bytes', 'WebP chunk size exceeds the supplied bytes.', {
                fourCc,
                chunkSize,
            });
        }
        if (!SUPPORTED_CHUNKS.has(fourCc)) {
            throwIssue('WEBP_CHUNK_UNSUPPORTED', 'bytes', 'WebP contains an unsupported release chunk.', { fourCc });
        }
        if (chunks.includes(fourCc) && ['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'EXIF', 'XMP '].includes(fourCc)) {
            throwIssue('WEBP_CHUNK_DUPLICATE', 'bytes', 'WebP contains a duplicate singleton chunk.', { fourCc });
        }
        chunks.push(fourCc);

        if (fourCc === 'VP8X') vp8x = parseVp8X(bytes, dataOffset, chunkSize, offset);
        if (fourCc === 'VP8 ' || fourCc === 'VP8L') {
            if (primary) {
                throwIssue('WEBP_PRIMARY_IMAGE_DUPLICATE', 'bytes', 'WebP must contain exactly one VP8 or VP8L image chunk.');
            }
            primary = fourCc === 'VP8 '
                ? parseVp8(bytes, dataOffset, chunkSize)
                : parseVp8L(bytes, dataOffset, chunkSize);
            features.primaryCodec = primary.codec;
            features.losslessAlpha = primary.codec === 'VP8L' && primary.alpha;
        }
        if (fourCc === 'ICCP') features.iccp = true;
        if (fourCc === 'EXIF') features.exif = true;
        if (fourCc === 'XMP ') features.xmp = true;
        if (fourCc === 'ALPH') features.alphaChunk = true;
        if (fourCc === 'ANIM' || fourCc === 'ANMF') features.animation = true;
        offset = paddedEnd;
    }
    if (offset !== bytes.byteLength) {
        throwIssue('WEBP_CONTAINER_TRAILING_BYTES', 'bytes', 'WebP contains bytes outside its chunk sequence.');
    }
    if (features.animation || (vp8x && (vp8x.flags & 0x02) !== 0)) {
        throwIssue('WEBP_ANIMATION_UNSUPPORTED', 'bytes', 'Animated WebP cannot be used as a fixed DSF page asset.');
    }
    if (!primary) {
        throwIssue('WEBP_PRIMARY_IMAGE_MISSING', 'bytes', 'WebP must contain one VP8 or VP8L image chunk.');
    }
    if (features.alphaChunk && primary.codec !== 'VP8') {
        throwIssue('WEBP_ALPHA_CHUNK_INVALID', 'bytes', 'ALPH chunk is only valid with a VP8 primary image.');
    }
    validateExtendedFeatureFlags(vp8x, features);
    if (vp8x && (vp8x.width !== primary.width || vp8x.height !== primary.height)) {
        throwIssue('WEBP_CANVAS_DIMENSION_MISMATCH', 'bytes', 'VP8X canvas and primary image dimensions differ.', {
            canvas: { width: vp8x.width, height: vp8x.height },
            primary: { width: primary.width, height: primary.height },
        });
    }

    return deepFreeze({
        sealingVersion: DSF_RELEASE_BYTE_SEALING_VERSION,
        container: 'RIFF',
        format: 'WEBP',
        codec: primary.codec,
        byteLength: bytes.byteLength,
        width: vp8x?.width || primary.width,
        height: vp8x?.height || primary.height,
        extended: !!vp8x,
        alpha: features.alphaChunk || features.losslessAlpha || !!(vp8x && (vp8x.flags & 0x10)),
        metadata: {
            iccp: features.iccp,
            exif: features.exif,
            xmp: features.xmp,
        },
        chunks: [...chunks],
    });
}

async function sha256OwnedBytes(bytes, cryptoRef) {
    if (!cryptoRef?.subtle || typeof cryptoRef.subtle.digest !== 'function') {
        throwIssue('WEB_CRYPTO_UNAVAILABLE', 'crypto', 'Web Crypto SHA-256 is unavailable.');
    }
    let digest;
    try {
        digest = await cryptoRef.subtle.digest('SHA-256', bytes);
    } catch (error) {
        throwIssue('WEB_CRYPTO_DIGEST_FAILED', 'crypto', 'Web Crypto SHA-256 failed.', {
            cause: error?.message || String(error),
        });
    }
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateSealInput(input) {
    const issues = [];
    if (!isRecord(input)) {
        throw new DsfReleaseByteSealingError([
            createIssue('WEBP_SEAL_INPUT_INVALID', '', 'WebP sealing input must be an object.'),
        ]);
    }
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) {
            issues.push(createIssue('WEBP_SEAL_PROPERTY_UNSUPPORTED', key, 'WebP sealing input contains an unsupported property.'));
        }
    }
    if (!validDimension(input.expectedWidth)) {
        issues.push(createIssue('WEBP_EXPECTED_DIMENSION_INVALID', 'expectedWidth', 'Expected WebP width is invalid.'));
    }
    if (!validDimension(input.expectedHeight)) {
        issues.push(createIssue('WEBP_EXPECTED_DIMENSION_INVALID', 'expectedHeight', 'Expected WebP height is invalid.'));
    }
    if (input.expectedSha256 !== undefined && !SHA256_HEX_PATTERN.test(input.expectedSha256)) {
        issues.push(createIssue('WEBP_EXPECTED_HASH_INVALID', 'expectedSha256', 'Expected hash must be 64-character SHA-256 hex.'));
    }
    if (input.pageId !== undefined && (
        typeof input.pageId !== 'string'
        || !input.pageId
        || input.pageId !== input.pageId.trim()
        || input.pageId.length > 256
    )) {
        issues.push(createIssue('WEBP_PAGE_ID_INVALID', 'pageId', 'Optional page ID must be a non-empty trimmed string.'));
    }
    if (input.pageLabel !== undefined && (typeof input.pageLabel !== 'string' || input.pageLabel.length > 512)) {
        issues.push(createIssue('WEBP_PAGE_LABEL_INVALID', 'pageLabel', 'Optional page label must be a string.'));
    }
    if (issues.length) throw new DsfReleaseByteSealingError(issues);
}

export class DsfReleaseByteSealingError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF release byte seal.');
        this.name = 'DsfReleaseByteSealingError';
        this.code = 'DSF_RELEASE_BYTE_SEALING_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/** Inspect actual WebP bytes without hashing or retaining the byte source. */
export async function inspectDsfWebPBytes(input) {
    const bytes = await toOwnedBytes(input, { requireWebP: true });
    return inspectOwnedWebPBytes(bytes);
}

/** Hash exact bytes with Web Crypto and return lowercase SHA-256 hex. */
export async function sha256DsfBytes(input, options = {}) {
    const bytes = await toOwnedBytes(input);
    return sha256OwnedBytes(bytes, options.cryptoRef || globalThis.crypto);
}

/** Create the hashBytes adapter required by the 9A-4A release assembler. */
export function createDsfWebCryptoSha256(options = {}) {
    const cryptoRef = options.cryptoRef || globalThis.crypto;
    return Object.freeze(async (bytes) => sha256DsfBytes(bytes, { cryptoRef }));
}

/**
 * Copy, inspect, and hash a WebP into an immutable Blob + 9A-4A descriptor.
 * The caller's ArrayBuffer or typed array can be changed later without
 * changing the returned Blob.
 */
export async function sealDsfWebPAsset(input, options = {}) {
    validateSealInput(input);
    const bytes = await toOwnedBytes(input.bytes, { requireWebP: true });
    const inspection = inspectOwnedWebPBytes(bytes);
    if (inspection.width !== input.expectedWidth || inspection.height !== input.expectedHeight) {
        throwIssue('WEBP_EXPECTED_DIMENSION_MISMATCH', 'bytes', 'Encoded WebP dimensions do not match the expected Press output.', {
            expected: { width: input.expectedWidth, height: input.expectedHeight },
            actual: { width: inspection.width, height: inspection.height },
        });
    }
    const sha256 = await sha256OwnedBytes(bytes, options.cryptoRef || globalThis.crypto);
    if (input.expectedSha256 && sha256 !== input.expectedSha256.toLowerCase()) {
        throwIssue('WEBP_EXPECTED_HASH_MISMATCH', 'bytes', 'WebP SHA-256 does not match the expected digest.', {
            expectedSha256: input.expectedSha256.toLowerCase(),
            actualSha256: sha256,
        });
    }
    if (typeof Blob === 'undefined') {
        throwIssue('WEBP_BLOB_UNAVAILABLE', 'bytes', 'Immutable Blob is unavailable in this runtime.');
    }
    const blob = new Blob([bytes], { type: 'image/webp' });
    const descriptor = {
        sha256,
        byteLength: bytes.byteLength,
        width: inspection.width,
        height: inspection.height,
        mimeType: 'image/webp',
        ...(input.pageId === undefined ? {} : { pageId: input.pageId }),
        ...(input.pageLabel === undefined ? {} : { pageLabel: input.pageLabel }),
    };
    return deepFreeze({
        sealingVersion: DSF_RELEASE_BYTE_SEALING_VERSION,
        blob,
        descriptor,
        inspection,
    });
}
