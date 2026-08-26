/**
 * Deterministic in-memory ZIP packaging for a validated 9A-4C DSF inventory.
 *
 * This module never downloads, uploads, or connects to Press, Viewer, state,
 * Firebase, Firestore, or R2. A package is returned only after the generated
 * ZIP has been reopened and every entry has been matched to the inventory.
 */

import JSZip from 'jszip';

import { serializeDsfReleaseJson } from './dsf-release-assembly.js';
import {
    DSF_ARCHIVE_MANIFEST_FORMAT,
    DSF_CONTENT_MIMETYPE,
    DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION,
} from './dsf-release-file-inventory.js';

export const DSF_RELEASE_ZIP_PACKAGE_SCHEMA_VERSION = 1;
export const DSF_RELEASE_ZIP_PACKAGE_FORMAT = 'dsf-release-zip-1';
export const DSF_RELEASE_ZIP_ROUND_TRIP_FORMAT = 'dsf-release-zip-round-trip-1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP_FIXED_DATE = new Date('1980-01-01T00:00:00.000Z');
const ZIP_FIXED_DOS_DATE = 0x0021;
const ZIP_FIXED_DOS_TIME = 0x0000;
const MAX_ZIP_FILE_COUNT = 65_535;
const MAX_UNCOMPRESSED_BYTES = 0x7fffffff;
const ROOT_INPUT_KEYS = new Set(['inventory', 'hashBytes']);
const INVENTORY_KEYS = new Set([
    'schemaVersion',
    'meta',
    'archiveManifest',
    'files',
    'releaseMetadata',
    'integrity',
    'summary',
]);
const FILE_KEYS = new Set([
    'path',
    'role',
    'mimeType',
    'byteLength',
    'sha256',
    'blob',
    'language',
    'blockId',
    'pageIndex',
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
    throw new DsfReleaseZipPackageError([createIssue(code, path, message, details)]);
}

function validateExactKeys(value, allowedKeys, path, issues) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            issues.push(createIssue(
                'RELEASE_ZIP_PROPERTY_UNSUPPORTED',
                path ? `${path}.${key}` : key,
                'ZIP package input contains an unsupported property.',
            ));
        }
    }
}

function assertExactKeys(value, allowedKeys, path = '') {
    const issues = [];
    validateExactKeys(value, allowedKeys, path, issues);
    if (issues.length) throw new DsfReleaseZipPackageError(issues);
}

function validArchivePath(value) {
    return typeof value === 'string'
        && !!value
        && value === value.trim()
        && value === value.normalize('NFC')
        && !value.startsWith('/')
        && !value.endsWith('/')
        && !value.includes('\\')
        && !value.includes('//')
        && !value.includes(':')
        && !/[\u0000-\u001f\u007f]/u.test(value)
        && !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function validByteLength(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNCOMPRESSED_BYTES;
}

function expectedCompressionForFile(file, index) {
    return index === 0 || file?.role === 'font'
        ? ZIP_COMPRESSION_STORE
        : ZIP_COMPRESSION_DEFLATE;
}

async function toOwnedBytes(input, path = 'zipBytes') {
    let bytes;
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        bytes = new Uint8Array(await input.arrayBuffer());
    } else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input.slice(0));
    } else if (ArrayBuffer.isView(input)) {
        bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
    } else {
        throwIssue('RELEASE_ZIP_BYTES_INVALID', path, 'ZIP bytes must be a Blob, ArrayBuffer, or typed array.');
    }
    if (!bytes.byteLength) {
        throwIssue('RELEASE_ZIP_BYTES_INVALID', path, 'ZIP bytes cannot be empty.');
    }
    return bytes;
}

async function hashExactBytes(hashBytes, bytes, path) {
    let sha256;
    try {
        sha256 = await hashBytes(bytes);
    } catch (error) {
        throwIssue('RELEASE_ZIP_HASH_FAILED', path, 'SHA-256 calculation failed.', {
            cause: error?.message || String(error),
        });
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
        throwIssue('RELEASE_ZIP_HASH_INVALID', path, 'SHA-256 function returned an unsupported digest.');
    }
    return sha256.toLowerCase();
}

function validateRootInput(input) {
    const issues = [];
    if (!isRecord(input)) {
        throw new DsfReleaseZipPackageError([
            createIssue('RELEASE_ZIP_INPUT_INVALID', '', 'ZIP package input must be an object.'),
        ]);
    }
    validateExactKeys(input, ROOT_INPUT_KEYS, '', issues);
    if (typeof input.hashBytes !== 'function') {
        issues.push(createIssue('RELEASE_ZIP_HASH_MISSING', 'hashBytes', 'ZIP packaging requires a SHA-256 byte function.'));
    }
    const inventory = input.inventory;
    if (!isRecord(inventory) || inventory.schemaVersion !== DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION) {
        issues.push(createIssue('RELEASE_ZIP_INVENTORY_INVALID', 'inventory', 'A 9A-4C release file inventory is required.'));
    } else {
        validateExactKeys(inventory, INVENTORY_KEYS, 'inventory', issues);
        if (!Array.isArray(inventory.files) || inventory.files.length < 4) {
            issues.push(createIssue('RELEASE_ZIP_FILES_INVALID', 'inventory.files', 'Inventory files are incomplete.'));
        } else if (inventory.files.length > MAX_ZIP_FILE_COUNT) {
            issues.push(createIssue('RELEASE_ZIP_FILE_LIMIT_EXCEEDED', 'inventory.files', 'Inventory exceeds the ZIP32 entry limit.'));
        }
    }
    if (issues.length) throw new DsfReleaseZipPackageError(issues);
}

function validateFileDescriptors(inventory) {
    const issues = [];
    const seenExact = new Map();
    const seenPortable = new Map();
    let fontPhaseStarted = false;
    let imagePhaseStarted = false;
    let totalBytes = 0;
    inventory.files.forEach((file, index) => {
        const path = `inventory.files[${index}]`;
        if (!isRecord(file)) {
            issues.push(createIssue('RELEASE_ZIP_FILE_INVALID', path, 'Inventory file must be an object.'));
            return;
        }
        validateExactKeys(file, FILE_KEYS, path, issues);
        if (!validArchivePath(file.path)) {
            issues.push(createIssue('RELEASE_ZIP_PATH_INVALID', `${path}.path`, 'Inventory contains an unsafe ZIP path.'));
        } else {
            if (seenExact.has(file.path)) {
                issues.push(createIssue('RELEASE_ZIP_PATH_DUPLICATE', `${path}.path`, 'Inventory path is duplicated.', {
                    firstPath: seenExact.get(file.path),
                }));
            } else {
                seenExact.set(file.path, `${path}.path`);
            }
            const portablePath = file.path.toLowerCase();
            if (seenPortable.has(portablePath)) {
                issues.push(createIssue('RELEASE_ZIP_PORTABLE_PATH_COLLISION', `${path}.path`, 'Inventory paths collide on case-insensitive filesystems.', {
                    firstPath: seenPortable.get(portablePath),
                }));
            } else {
                seenPortable.set(portablePath, `${path}.path`);
            }
        }
        if (typeof file.role !== 'string' || !file.role) {
            issues.push(createIssue('RELEASE_ZIP_FILE_ROLE_INVALID', `${path}.role`, 'Inventory file role is invalid.'));
        }
        if (typeof file.mimeType !== 'string' || !file.mimeType) {
            issues.push(createIssue('RELEASE_ZIP_FILE_MIME_INVALID', `${path}.mimeType`, 'Inventory file MIME type is invalid.'));
        }
        if (!validByteLength(file.byteLength)) {
            issues.push(createIssue('RELEASE_ZIP_FILE_SIZE_INVALID', `${path}.byteLength`, 'Inventory file byteLength is invalid.'));
        } else {
            totalBytes += file.byteLength;
        }
        if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256) || file.sha256 !== file.sha256.toLowerCase()) {
            issues.push(createIssue('RELEASE_ZIP_FILE_HASH_INVALID', `${path}.sha256`, 'Inventory file SHA-256 is invalid.'));
        }
        if (!(typeof Blob !== 'undefined' && file.blob instanceof Blob)) {
            issues.push(createIssue('RELEASE_ZIP_FILE_BLOB_INVALID', `${path}.blob`, 'Inventory file requires an immutable Blob.'));
        } else if (file.blob.type !== file.mimeType) {
            issues.push(createIssue('RELEASE_ZIP_FILE_BLOB_MIME_MISMATCH', `${path}.blob`, 'Inventory Blob MIME type does not match its descriptor.'));
        }
        if (index >= 4) {
            if (file.role === 'language-manifest') {
                if (fontPhaseStarted
                    || imagePhaseStarted
                    || file.mimeType !== 'application/json'
                    || !file.path?.startsWith('content/')
                    || !file.path?.endsWith('.json')) {
                    issues.push(createIssue('RELEASE_ZIP_CONTENT_ORDER_INVALID', path, 'Language manifests must precede font and image assets and use content/*.json.'));
                }
            } else if (file.role === 'font') {
                fontPhaseStarted = true;
                if (imagePhaseStarted
                    || file.mimeType !== 'font/woff2'
                    || !file.path?.startsWith('fonts/')
                    || !file.path?.endsWith('.woff2')) {
                    issues.push(createIssue('RELEASE_ZIP_FONT_DESCRIPTOR_INVALID', path, 'Font assets must precede image assets and use fonts/*.woff2.'));
                }
            } else if (file.role === 'image') {
                imagePhaseStarted = true;
                if (file.mimeType !== 'image/webp'
                    || !file.path?.startsWith('assets/images/')
                    || !file.path?.endsWith('.webp')
                    || typeof file.language !== 'string'
                    || !file.language
                    || typeof file.blockId !== 'string'
                    || !file.blockId
                    || !Number.isInteger(file.pageIndex)
                    || file.pageIndex < 0) {
                    issues.push(createIssue('RELEASE_ZIP_IMAGE_DESCRIPTOR_INVALID', path, 'Image inventory descriptor is invalid.'));
                }
            } else {
                issues.push(createIssue('RELEASE_ZIP_FILE_ROLE_UNSUPPORTED', `${path}.role`, 'Inventory contains an unsupported release file role.'));
            }
        }
    });
    const expectedRoots = [
        ['mimetype', 'mimetype', 'text/plain'],
        ['manifest.json', 'archive-manifest', 'application/json'],
        ['meta.json', 'metadata', 'application/json'],
        ['content.json', 'content-index', 'application/json'],
    ];
    expectedRoots.forEach(([expectedPath, expectedRole, expectedMimeType], index) => {
        const file = inventory.files[index];
        if (file?.path !== expectedPath || file?.role !== expectedRole || file?.mimeType !== expectedMimeType) {
            issues.push(createIssue('RELEASE_ZIP_ROOT_ORDER_INVALID', `inventory.files[${index}]`, 'Required DSF root file order or descriptor is invalid.'));
        }
    });
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        issues.push(createIssue('RELEASE_ZIP_SIZE_LIMIT_EXCEEDED', 'inventory.files', 'Inventory exceeds the local ZIP packaging byte limit.'));
    }
    if (issues.length) throw new DsfReleaseZipPackageError(issues);
}

async function validateInventoryBytes(inventory, hashBytes) {
    const verified = [];
    for (const [index, file] of inventory.files.entries()) {
        const path = `inventory.files[${index}]`;
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        if (bytes.byteLength !== file.byteLength || file.blob.size !== file.byteLength) {
            throwIssue('RELEASE_ZIP_INVENTORY_SIZE_MISMATCH', `${path}.blob`, 'Inventory Blob size does not match its descriptor.');
        }
        const sha256 = await hashExactBytes(hashBytes, bytes, `${path}.blob`);
        if (sha256 !== file.sha256.toLowerCase()) {
            throwIssue('RELEASE_ZIP_INVENTORY_HASH_MISMATCH', `${path}.blob`, 'Inventory Blob SHA-256 does not match its descriptor.');
        }
        verified.push({ file, bytes, sha256 });
    }
    return verified;
}

function assertCanonicalJsonFile(file, value, path) {
    return file.blob.text().then((text) => {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throwIssue('RELEASE_ZIP_JSON_INVALID', path, 'Inventory JSON Blob is invalid.', {
                cause: error?.message || String(error),
            });
        }
        if (text !== serializeDsfReleaseJson(parsed) || text !== serializeDsfReleaseJson(value)) {
            throwIssue('RELEASE_ZIP_JSON_MISMATCH', path, 'Inventory JSON Blob is not the canonical inventory value.');
        }
    });
}

async function validateInventoryContract(inventory, hashBytes) {
    validateFileDescriptors(inventory);
    const verified = await validateInventoryBytes(inventory, hashBytes);
    const mimetypeText = await inventory.files[0].blob.text();
    if (mimetypeText !== DSF_CONTENT_MIMETYPE) {
        throwIssue('RELEASE_ZIP_MIMETYPE_INVALID', 'inventory.files[0].blob', 'DSF mimetype must be exact and contain no newline.');
    }
    if (!isRecord(inventory.archiveManifest) || inventory.archiveManifest.format !== DSF_ARCHIVE_MANIFEST_FORMAT) {
        throwIssue('RELEASE_ZIP_ARCHIVE_MANIFEST_INVALID', 'inventory.archiveManifest', 'Archive manifest is missing or unsupported.');
    }
    await assertCanonicalJsonFile(inventory.files[1], inventory.archiveManifest, 'inventory.files[1].blob');
    await assertCanonicalJsonFile(inventory.files[2], inventory.meta, 'inventory.files[2].blob');

    const payloadFiles = inventory.files.filter((file) => file.path !== 'manifest.json');
    const expectedManifestFiles = payloadFiles.map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        byteLength: file.byteLength,
        sha256: file.sha256.toLowerCase(),
    }));
    if (serializeDsfReleaseJson(inventory.archiveManifest.files) !== serializeDsfReleaseJson(expectedManifestFiles)
        || inventory.archiveManifest.self?.path !== 'manifest.json'
        || inventory.archiveManifest.self?.integrity !== 'external-inventory'
        || inventory.archiveManifest.fileCount !== payloadFiles.length
        || inventory.archiveManifest.payloadByteLength !== payloadFiles.reduce((sum, file) => sum + file.byteLength, 0)) {
        throwIssue('RELEASE_ZIP_ARCHIVE_MANIFEST_MISMATCH', 'inventory.archiveManifest', 'Archive manifest does not exactly match inventory payload files.');
    }
    if (inventory.archiveManifest.files.some((file) => file.path === 'manifest.json')) {
        throwIssue('RELEASE_ZIP_ARCHIVE_MANIFEST_RECURSIVE', 'inventory.archiveManifest.files', 'Archive manifest cannot contain its own hash.');
    }
    const manifestFile = inventory.files[1];
    const contentFile = inventory.files[3];
    if (inventory.integrity?.archiveManifestSha256 !== manifestFile.sha256
        || inventory.integrity?.contentSha256 !== contentFile.sha256) {
        throwIssue('RELEASE_ZIP_INTEGRITY_MISMATCH', 'inventory.integrity', 'Inventory integrity summary is stale.');
    }
    const totalBytes = inventory.files.reduce((sum, file) => sum + file.byteLength, 0);
    if (inventory.summary?.fileCount !== inventory.files.length
        || inventory.summary?.totalBytes !== totalBytes
        || inventory.releaseMetadata?.dsfTotalBytes !== totalBytes) {
        throwIssue('RELEASE_ZIP_SUMMARY_MISMATCH', 'inventory.summary', 'Inventory byte or file summary is stale.');
    }
    return verified;
}

function inspectLocalHeaders(zipBytes, expectedFiles) {
    const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = [];
    let offset = 0;
    for (const [index, expected] of expectedFiles.entries()) {
        if (offset + 30 > zipBytes.byteLength || view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
            throwIssue('RELEASE_ZIP_LOCAL_HEADER_INVALID', `zip.entries[${index}]`, 'ZIP local file header is missing or out of order.');
        }
        const flags = view.getUint16(offset + 6, true);
        const compressionMethod = view.getUint16(offset + 8, true);
        const dosTime = view.getUint16(offset + 10, true);
        const dosDate = view.getUint16(offset + 12, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const uncompressedSize = view.getUint32(offset + 22, true);
        const fileNameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const dataStart = nameStart + fileNameLength + extraLength;
        const nextOffset = dataStart + compressedSize;
        if (nextOffset > zipBytes.byteLength) {
            throwIssue('RELEASE_ZIP_LOCAL_HEADER_INVALID', `zip.entries[${index}]`, 'ZIP local entry exceeds archive bytes.');
        }
        let path;
        try {
            path = decoder.decode(zipBytes.subarray(nameStart, nameStart + fileNameLength));
        } catch (error) {
            throwIssue('RELEASE_ZIP_ENTRY_NAME_INVALID', `zip.entries[${index}]`, 'ZIP entry name is not valid UTF-8.', {
                cause: error?.message || String(error),
            });
        }
        if (flags & 0x0001) {
            throwIssue('RELEASE_ZIP_ENCRYPTION_UNSUPPORTED', `zip.entries[${index}]`, 'Encrypted ZIP entries are not allowed.');
        }
        if (flags & 0x0008) {
            throwIssue('RELEASE_ZIP_STREAM_DESCRIPTOR_UNSUPPORTED', `zip.entries[${index}]`, 'ZIP data descriptors are not allowed in deterministic packages.');
        }
        const expectedCompression = expectedCompressionForFile(expected.file, index);
        if (path !== expected.file.path
            || compressionMethod !== expectedCompression
            || uncompressedSize !== expected.file.byteLength
            || dosTime !== ZIP_FIXED_DOS_TIME
            || dosDate !== ZIP_FIXED_DOS_DATE) {
            throwIssue('RELEASE_ZIP_LOCAL_ENTRY_MISMATCH', `zip.entries[${index}]`, 'ZIP local entry does not match the deterministic package contract.', {
                expectedPath: expected.file.path,
                actualPath: path,
                expectedCompression,
                actualCompression: compressionMethod,
            });
        }
        entries.push({
            path,
            compression: compressionMethod === ZIP_COMPRESSION_STORE ? 'STORE' : 'DEFLATE',
            compressedByteLength: compressedSize,
            byteLength: uncompressedSize,
            sha256: expected.sha256,
        });
        offset = nextOffset;
    }
    if (offset + 4 > zipBytes.byteLength || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throwIssue('RELEASE_ZIP_CENTRAL_DIRECTORY_INVALID', 'zip', 'ZIP contains unexpected local entries or a missing central directory.');
    }
    return entries;
}

async function verifyLoadedEntries(zipBytes, expectedFiles, hashBytes) {
    let zip;
    try {
        zip = await JSZip.loadAsync(zipBytes, { checkCRC32: true, createFolders: false });
    } catch (error) {
        throwIssue('RELEASE_ZIP_ROUND_TRIP_LOAD_FAILED', 'zipBytes', 'Generated ZIP could not be reopened with CRC validation.', {
            cause: error?.message || String(error),
        });
    }
    const allEntries = Object.values(zip.files);
    if (allEntries.some((entry) => entry.dir)) {
        throwIssue('RELEASE_ZIP_DIRECTORY_ENTRY_UNEXPECTED', 'zip.entries', 'DSF ZIP must not contain synthetic directory entries.');
    }
    if (allEntries.length !== expectedFiles.length
        || allEntries.some((entry, index) => entry.name !== expectedFiles[index].file.path)) {
        throwIssue('RELEASE_ZIP_ENTRY_ORDER_MISMATCH', 'zip.entries', 'Reopened ZIP entry order does not match inventory.');
    }
    for (const [index, entry] of allEntries.entries()) {
        const bytes = await entry.async('uint8array');
        const expected = expectedFiles[index];
        const sha256 = await hashExactBytes(hashBytes, bytes, `zip.entries[${index}]`);
        if (bytes.byteLength !== expected.file.byteLength || sha256 !== expected.sha256) {
            throwIssue('RELEASE_ZIP_ROUND_TRIP_MISMATCH', `zip.entries[${index}]`, 'Reopened ZIP entry bytes do not match inventory.', {
                path: entry.name,
            });
        }
    }
}

export class DsfReleaseZipPackageError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF release ZIP package.');
        this.name = 'DsfReleaseZipPackageError';
        this.code = 'DSF_RELEASE_ZIP_PACKAGE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/** Reopen ZIP bytes and verify every entry against a 9A-4C inventory. */
export async function verifyDsfReleaseZipRoundTrip(input = {}) {
    assertExactKeys(input, new Set(['inventory', 'zipBytes', 'hashBytes']));
    validateRootInput({ inventory: input.inventory, hashBytes: input.hashBytes });
    const expectedFiles = await validateInventoryContract(input.inventory, input.hashBytes);
    const zipBytes = await toOwnedBytes(input.zipBytes);
    const entries = inspectLocalHeaders(zipBytes, expectedFiles);
    await verifyLoadedEntries(zipBytes, expectedFiles, input.hashBytes);
    const sha256 = await hashExactBytes(input.hashBytes, zipBytes, 'zipBytes');
    return deepFreeze({
        format: DSF_RELEASE_ZIP_ROUND_TRIP_FORMAT,
        byteLength: zipBytes.byteLength,
        sha256,
        entryCount: entries.length,
        entries,
    });
}

/** Build deterministic ZIP bytes in memory and return them only after round-trip validation. */
export async function createDsfReleaseZipPackage(input = {}) {
    validateRootInput(input);
    const verifiedFiles = await validateInventoryContract(input.inventory, input.hashBytes);
    const zip = new JSZip();
    for (const [index, { file, bytes }] of verifiedFiles.entries()) {
        const compressionMethod = expectedCompressionForFile(file, index);
        zip.file(file.path, bytes, {
            binary: true,
            createFolders: false,
            date: ZIP_FIXED_DATE,
            compression: compressionMethod === ZIP_COMPRESSION_STORE ? 'STORE' : 'DEFLATE',
            ...(compressionMethod === ZIP_COMPRESSION_STORE ? {} : { compressionOptions: { level: 9 } }),
        });
    }
    let zipBytes;
    try {
        zipBytes = await zip.generateAsync({
            type: 'uint8array',
            streamFiles: false,
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
            platform: 'DOS',
            comment: '',
        });
    } catch (error) {
        throwIssue('RELEASE_ZIP_GENERATION_FAILED', 'inventory.files', 'JSZip failed to generate DSF bytes.', {
            cause: error?.message || String(error),
        });
    }
    if (zipBytes.byteLength > MAX_UNCOMPRESSED_BYTES) {
        throwIssue('RELEASE_ZIP_SIZE_LIMIT_EXCEEDED', 'zip', 'Generated ZIP exceeds the local ZIP packaging byte limit.');
    }
    const roundTrip = await verifyDsfReleaseZipRoundTrip({
        inventory: input.inventory,
        zipBytes,
        hashBytes: input.hashBytes,
    });
    if (typeof Blob === 'undefined') {
        throwIssue('RELEASE_ZIP_BLOB_UNAVAILABLE', 'zip', 'Immutable Blob is unavailable in this runtime.');
    }
    return deepFreeze({
        schemaVersion: DSF_RELEASE_ZIP_PACKAGE_SCHEMA_VERSION,
        format: DSF_RELEASE_ZIP_PACKAGE_FORMAT,
        mimeType: DSF_CONTENT_MIMETYPE,
        byteLength: roundTrip.byteLength,
        sha256: roundTrip.sha256,
        blob: new Blob([zipBytes], { type: DSF_CONTENT_MIMETYPE }),
        roundTrip,
    });
}
