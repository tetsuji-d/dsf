/** Exact-byte verification for production-certified DSF WOFF2 assets. */

import { validateDsfProductionFontRegistry } from './dsf-font-registry.js';
import { sha256DsfBytes } from './dsf-release-byte-sealing.js';

export const DSF_FONT_ASSET_EVIDENCE_VERSION = 1;

const WOFF2_HEADER_BYTES = 48;
const MAX_FONT_BYTES = 50 * 1024 * 1024;

export class DsfFontAssetVerificationError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'DsfFontAssetVerificationError';
        this.code = code;
        this.context = context;
        if (context.cause) this.cause = context.cause;
    }
}

function fail(code, message, context = {}) {
    throw new DsfFontAssetVerificationError(code, message, context);
}

async function copyFontBytes(input) {
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        if (input.type && input.type.toLowerCase() !== 'font/woff2') {
            fail('FONT_ASSET_MIME_TYPE_MISMATCH', 'Font Blob MIME type must be font/woff2.', {
                mimeType: input.type,
            });
        }
        return new Uint8Array(await input.arrayBuffer());
    }
    if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
    if (ArrayBuffer.isView(input)) {
        const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        return new Uint8Array(view);
    }
    fail('FONT_ASSET_BYTES_INVALID', 'Font bytes must be a Blob, ArrayBuffer, or ArrayBuffer view.');
}

function readFourCc(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function validateOptionalBlock(bytes, label, offset, length, originalLength = length) {
    if (offset === 0) {
        if (length !== 0 || originalLength !== 0) {
            fail(`WOFF2_${label}_OFFSET_MISSING`, `WOFF2 ${label.toLowerCase()} lengths require a non-zero offset.`, {
                offset,
                length,
                originalLength,
            });
        }
        return;
    }
    if (offset < WOFF2_HEADER_BYTES || length < 1 || originalLength < 1 || offset + length > bytes.byteLength) {
        fail(`WOFF2_${label}_RANGE_INVALID`, `WOFF2 ${label.toLowerCase()} block is outside the supplied bytes.`, {
            offset,
            length,
            originalLength,
            byteLength: bytes.byteLength,
        });
    }
}

export async function inspectDsfWoff2Bytes(input) {
    const bytes = await copyFontBytes(input);
    if (bytes.byteLength < WOFF2_HEADER_BYTES) {
        fail('WOFF2_HEADER_TRUNCATED', 'WOFF2 bytes end before the 48-byte header.', {
            byteLength: bytes.byteLength,
        });
    }
    if (bytes.byteLength > MAX_FONT_BYTES) {
        fail('WOFF2_BYTES_LIMIT_EXCEEDED', 'WOFF2 bytes exceed the DSF production font limit.', {
            byteLength: bytes.byteLength,
        });
    }
    if (readFourCc(bytes, 0) !== 'wOF2') {
        fail('WOFF2_SIGNATURE_INVALID', 'Font asset must use the WOFF2 signature.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const flavor = view.getUint32(4, false);
    const declaredLength = view.getUint32(8, false);
    const numTables = view.getUint16(12, false);
    const reserved = view.getUint16(14, false);
    const totalSfntSize = view.getUint32(16, false);
    const totalCompressedSize = view.getUint32(20, false);
    const majorVersion = view.getUint16(24, false);
    const minorVersion = view.getUint16(26, false);
    const metaOffset = view.getUint32(28, false);
    const metaLength = view.getUint32(32, false);
    const metaOrigLength = view.getUint32(36, false);
    const privOffset = view.getUint32(40, false);
    const privLength = view.getUint32(44, false);

    if (declaredLength !== bytes.byteLength) {
        fail('WOFF2_LENGTH_MISMATCH', 'WOFF2 declared length must equal the supplied byte length.', {
            declaredLength,
            byteLength: bytes.byteLength,
        });
    }
    if (numTables < 1 || numTables > 4096) {
        fail('WOFF2_TABLE_COUNT_INVALID', 'WOFF2 table count is outside the supported range.', { numTables });
    }
    if (reserved !== 0) fail('WOFF2_RESERVED_NONZERO', 'WOFF2 reserved field must be zero.', { reserved });
    if (totalSfntSize < 12) {
        fail('WOFF2_SFNT_SIZE_INVALID', 'WOFF2 totalSfntSize is invalid.', { totalSfntSize });
    }
    if (totalCompressedSize < 1 || totalCompressedSize > bytes.byteLength - WOFF2_HEADER_BYTES) {
        fail('WOFF2_COMPRESSED_SIZE_INVALID', 'WOFF2 compressed data size is invalid.', {
            totalCompressedSize,
            byteLength: bytes.byteLength,
        });
    }
    validateOptionalBlock(bytes, 'METADATA', metaOffset, metaLength, metaOrigLength);
    validateOptionalBlock(bytes, 'PRIVATE', privOffset, privLength);

    return Object.freeze({
        signature: 'wOF2',
        flavor,
        byteLength: bytes.byteLength,
        numTables,
        totalSfntSize,
        totalCompressedSize,
        majorVersion,
        minorVersion,
        hasMetadata: metaOffset !== 0,
        hasPrivateData: privOffset !== 0,
    });
}

/** Verify exact WOFF2 bytes against one human-reviewed production registry entry. */
export async function verifyDsfProductionFontAsset(input = {}) {
    const validation = validateDsfProductionFontRegistry(input.registry);
    if (!validation.valid) {
        fail('FONT_REGISTRY_INVALID', 'Production font registry is invalid.', { issues: validation.issues });
    }
    const fontId = String(input.fontId || '').trim();
    const entry = input.registry.fonts?.[fontId];
    if (!entry) fail('FONT_NOT_CERTIFIED', 'Font ID is not present in the production registry.', { fontId });
    const bytes = await copyFontBytes(input.bytes);
    const woff2 = await inspectDsfWoff2Bytes(bytes);
    if (bytes.byteLength !== entry.asset.byteLength) {
        fail('FONT_ASSET_BYTE_LENGTH_MISMATCH', 'Actual WOFF2 byte length does not match the production registry.', {
            fontId,
            expected: entry.asset.byteLength,
            actual: bytes.byteLength,
        });
    }
    const sha256 = await sha256DsfBytes(bytes, { cryptoRef: input.cryptoRef || globalThis.crypto });
    if (sha256 !== entry.declaration.sha256.toLowerCase()) {
        fail('FONT_ASSET_SHA256_MISMATCH', 'Actual WOFF2 SHA-256 does not match the production registry.', {
            fontId,
            expected: entry.declaration.sha256.toLowerCase(),
            actual: sha256,
        });
    }
    if (typeof Blob === 'undefined') {
        fail('FONT_ASSET_BLOB_UNAVAILABLE', 'Immutable Blob is unavailable in this runtime.');
    }
    const blob = new Blob([bytes], { type: 'font/woff2' });
    return Object.freeze({
        schemaVersion: DSF_FONT_ASSET_EVIDENCE_VERSION,
        status: 'verified',
        fontId,
        family: entry.declaration.family,
        version: entry.declaration.version,
        href: entry.declaration.href,
        sha256,
        byteLength: bytes.byteLength,
        mimeType: 'font/woff2',
        format: 'woff2',
        woff2,
        blob,
    });
}
