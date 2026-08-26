/** 9A-6C-C-A validated handoff from the local Flow package to file download. */

export const FLOW_PRESS_PORTABLE_DOWNLOAD_VERSION = 1;

const DSF_CONTENT_MIMETYPE = 'application/vnd.dsf.content+zip';
const DSF_RELEASE_ZIP_PACKAGE_FORMAT = 'dsf-release-zip-1';
const FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION = 1;
const INPUT_KEYS = new Set([
    'packageResult',
    'expectedSignature',
    'currentSignature',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(code, message) {
    const error = new Error(message);
    error.name = 'FlowPressPortableDownloadError';
    error.code = code;
    throw error;
}

function normalizeDownloadBaseName(title) {
    const raw = String(title || 'Untitled')
        .normalize('NFC')
        .replace(/\.dsf$/i, '')
        .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '_')
        .trim()
        .replace(/[. ]+$/u, '');
    const bounded = Array.from(raw || 'Untitled').slice(0, 120).join('') || 'Untitled';
    return WINDOWS_RESERVED_NAME_PATTERN.test(bounded) ? `${bounded}_` : bounded;
}

function validateInput(input) {
    if (!isRecord(input)) {
        fail('FLOW_PORTABLE_DOWNLOAD_INPUT_INVALID', 'Flow portable download requires an input object.');
    }
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) {
            fail('FLOW_PORTABLE_DOWNLOAD_PROPERTY_UNSUPPORTED', `Unsupported Flow portable download property: ${key}`);
        }
    }
    if (typeof input.expectedSignature !== 'string' || !input.expectedSignature
        || input.expectedSignature !== input.currentSignature) {
        fail('FLOW_PORTABLE_DOWNLOAD_STALE', 'The verified Flow package no longer matches the current Press settings.');
    }
}

/**
 * Return a frozen, download-ready view of a previously round-trip-verified
 * package. This function performs no browser download or other I/O.
 */
export function createFlowPressPortableDownloadArtifact(input = {}) {
    validateInput(input);
    const result = input.packageResult;
    const zipPackage = result?.zipPackage;
    const summary = result?.summary;
    if (!isRecord(result)
        || result.packageVersion !== FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION
        || result.packageKind !== 'portable-local-only'
        || result.ready !== true
        || summary?.roundTripVerified !== true
        || !isRecord(zipPackage)
        || zipPackage.format !== DSF_RELEASE_ZIP_PACKAGE_FORMAT
        || zipPackage.mimeType !== DSF_CONTENT_MIMETYPE
        || zipPackage.roundTrip?.sha256 !== zipPackage.sha256
        || zipPackage.roundTrip?.byteLength !== zipPackage.byteLength) {
        fail('FLOW_PORTABLE_DOWNLOAD_PACKAGE_UNVERIFIED', 'Flow package has not passed the required ZIP round-trip verification.');
    }
    if (!(typeof Blob !== 'undefined' && zipPackage.blob instanceof Blob)
        || zipPackage.blob.type !== DSF_CONTENT_MIMETYPE
        || zipPackage.blob.size !== zipPackage.byteLength
        || summary.zipByteLength !== zipPackage.byteLength
        || summary.zipSha256 !== zipPackage.sha256
        || !SHA256_PATTERN.test(zipPackage.sha256)) {
        fail('FLOW_PORTABLE_DOWNLOAD_BLOB_INVALID', 'Flow package Blob does not match its verified size, MIME type, and SHA-256.');
    }
    const title = result.inventory?.meta?.title;
    return Object.freeze({
        downloadVersion: FLOW_PRESS_PORTABLE_DOWNLOAD_VERSION,
        downloadKind: 'portable-local-file',
        filename: `${normalizeDownloadBaseName(title)}.dsf`,
        mimeType: DSF_CONTENT_MIMETYPE,
        byteLength: zipPackage.byteLength,
        sha256: zipPackage.sha256,
        blob: zipPackage.blob,
        packageSignature: input.expectedSignature,
    });
}
