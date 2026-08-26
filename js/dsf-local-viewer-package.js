/**
 * Fail-closed local loader for portable DSF delivery v2 ZIP files.
 *
 * This path is intentionally separate from Horizon/public release loading.
 * It verifies the complete archive, embedded production-certified WOFF2 bytes,
 * and WebP payloads before creating any Viewer runtime objects.
 */

import JSZip from 'jszip';

import {
    assertValidDsfDeliveryBundle,
    normalizeDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import {
    DSF_ARCHIVE_MANIFEST_FORMAT,
    DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION,
    DSF_CONTENT_MIMETYPE,
} from './dsf-release-file-inventory.js';
import {
    inspectDsfWebPBytes,
    sha256DsfBytes,
} from './dsf-release-byte-sealing.js';
import { verifyDsfProductionFontAsset } from './dsf-font-asset-verification.js';
import {
    DSF_PRODUCTION_FONT_REGISTRY,
    validateDsfProductionFontRegistry,
} from './dsf-font-registry.js';
import { serializeDsfReleaseJson } from './dsf-release-assembly.js';
import { prepareDsfViewerFixedTextContext } from './viewer-fixed-text.js';

export const DSF_LOCAL_VIEWER_PACKAGE_VERSION = 1;
export const DSF_LOCAL_VIEWER_PACKAGE_KIND = 'portable-v2-local-file';

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_ARCHIVE_PAYLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_FONT_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JSON_MIME_TYPE = 'application/json';
const ARCHIVE_MANIFEST_KEYS = new Set([
    'schemaVersion',
    'format',
    'rootContent',
    'self',
    'files',
    'fileCount',
    'payloadByteLength',
]);
const ARCHIVE_SELF_KEYS = new Set(['path', 'integrity']);
const ARCHIVE_FILE_KEYS = new Set(['path', 'mimeType', 'byteLength', 'sha256']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}) {
    throw new DsfLocalViewerPackageError([createIssue(code, path, message, details)]);
}

function assertExactKeys(value, allowedKeys, path) {
    if (!isRecord(value)) fail('LOCAL_DSF_OBJECT_INVALID', path, 'Expected an object.');
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            fail('LOCAL_DSF_PROPERTY_UNSUPPORTED', path ? `${path}.${key}` : key, 'Unsupported archive property.');
        }
    }
}

function validArchivePath(path) {
    return typeof path === 'string'
        && !!path
        && path === path.trim()
        && path === path.normalize('NFC')
        && !path.startsWith('/')
        && !path.endsWith('/')
        && !path.includes('\\')
        && !path.includes('//')
        && !path.includes(':')
        && !/[\u0000-\u001f\u007f]/u.test(path)
        && !path.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function expectedMimeType(path) {
    if (path === 'mimetype') return 'text/plain';
    if (path.endsWith('.json')) return JSON_MIME_TYPE;
    if (/^fonts\/[a-f0-9]{64}\.woff2$/.test(path)) return 'font/woff2';
    if (/^assets\/images\/.+\.webp$/.test(path)) return 'image/webp';
    return '';
}

function maximumBytesForPath(path) {
    if (path === 'mimetype') return 128;
    if (path.endsWith('.json')) return MAX_JSON_BYTES;
    if (path.endsWith('.woff2')) return MAX_FONT_BYTES;
    if (path.endsWith('.webp')) return MAX_IMAGE_BYTES;
    return 0;
}

function getDeclaredUncompressedSize(entry) {
    const value = entry?._data?.uncompressedSize;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function readEntryBytes(entry, path, maximumBytes) {
    if (!entry || entry.dir) fail('LOCAL_DSF_ENTRY_MISSING', path, 'Required archive entry is missing.');
    const declaredSize = getDeclaredUncompressedSize(entry);
    if (declaredSize !== null && declaredSize > maximumBytes) {
        fail('LOCAL_DSF_ENTRY_LIMIT_EXCEEDED', path, 'Archive entry exceeds the local Viewer size limit.', {
            byteLength: declaredSize,
            maximumBytes,
        });
    }
    let bytes;
    try {
        bytes = await entry.async('uint8array');
    } catch (error) {
        fail('LOCAL_DSF_ENTRY_READ_FAILED', path, 'Archive entry could not be decompressed.', {
            cause: error?.message || String(error),
        });
    }
    if (bytes.byteLength > maximumBytes) {
        fail('LOCAL_DSF_ENTRY_LIMIT_EXCEEDED', path, 'Archive entry exceeds the local Viewer size limit.', {
            byteLength: bytes.byteLength,
            maximumBytes,
        });
    }
    return bytes;
}

function decodeUtf8(bytes, path) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        fail('LOCAL_DSF_UTF8_INVALID', path, 'Archive text is not valid UTF-8.', {
            cause: error?.message || String(error),
        });
    }
}

function parseJsonText(text, path, canonical = true) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        fail('LOCAL_DSF_JSON_INVALID', path, 'Archive JSON could not be parsed.', {
            cause: error?.message || String(error),
        });
    }
    if (!isRecord(value)) fail('LOCAL_DSF_JSON_INVALID', path, 'Archive JSON root must be an object.');
    if (canonical && serializeDsfReleaseJson(value) !== text) {
        fail('LOCAL_DSF_JSON_NON_CANONICAL', path, 'Portable DSF JSON must match the canonical release bytes.');
    }
    return value;
}

function parseJsonBytes(bytes, path, canonical = true) {
    return parseJsonText(decodeUtf8(bytes, path), path, canonical);
}

async function readContentIndexForDetection(zip) {
    const entry = zip.file('content.json');
    if (!entry) return null;
    const bytes = await readEntryBytes(entry, 'content.json', MAX_JSON_BYTES);
    let parsed;
    try {
        parsed = JSON.parse(decodeUtf8(bytes, 'content.json'));
    } catch {
        return null;
    }
    return isRecord(parsed) ? parsed : null;
}

function validateArchiveEntries(zip) {
    const entries = Object.entries(zip.files);
    if (entries.length < 5 || entries.length > MAX_ARCHIVE_ENTRIES) {
        fail('LOCAL_DSF_ENTRY_COUNT_INVALID', '', 'Portable DSF archive entry count is invalid.', {
            entryCount: entries.length,
        });
    }
    const seenPortablePaths = new Set();
    for (const [path, entry] of entries) {
        if (entry.dir) fail('LOCAL_DSF_DIRECTORY_ENTRY_UNSUPPORTED', path, 'Portable DSF cannot contain directory entries.');
        if (!validArchivePath(path)) fail('LOCAL_DSF_PATH_INVALID', path, 'Archive contains an unsafe path.');
        if (entry.unsafeOriginalName && entry.unsafeOriginalName !== path) {
            fail('LOCAL_DSF_PATH_SANITIZED', path, 'Archive path required ZIP sanitization and is rejected.');
        }
        const portablePath = path.toLowerCase();
        if (seenPortablePaths.has(portablePath)) {
            fail('LOCAL_DSF_PATH_COLLISION', path, 'Archive paths collide on case-insensitive filesystems.');
        }
        seenPortablePaths.add(portablePath);
    }
}

function validateArchiveManifest(manifest) {
    assertExactKeys(manifest, ARCHIVE_MANIFEST_KEYS, 'manifest.json');
    if (manifest.schemaVersion !== DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION
        || manifest.format !== DSF_ARCHIVE_MANIFEST_FORMAT
        || manifest.rootContent !== 'content.json') {
        fail('LOCAL_DSF_MANIFEST_VERSION_UNSUPPORTED', 'manifest.json', 'Unsupported DSF archive manifest contract.');
    }
    assertExactKeys(manifest.self, ARCHIVE_SELF_KEYS, 'manifest.json.self');
    if (manifest.self.path !== 'manifest.json' || manifest.self.integrity !== 'external-inventory') {
        fail('LOCAL_DSF_MANIFEST_SELF_INVALID', 'manifest.json.self', 'Archive manifest self descriptor is invalid.');
    }
    if (!Array.isArray(manifest.files)
        || manifest.files.length < 4
        || manifest.files.length > MAX_ARCHIVE_ENTRIES - 1
        || manifest.fileCount !== manifest.files.length) {
        fail('LOCAL_DSF_MANIFEST_FILES_INVALID', 'manifest.json.files', 'Archive manifest file list is invalid.');
    }
    const descriptors = new Map();
    let payloadByteLength = 0;
    for (const [index, descriptor] of manifest.files.entries()) {
        const path = `manifest.json.files[${index}]`;
        assertExactKeys(descriptor, ARCHIVE_FILE_KEYS, path);
        if (!validArchivePath(descriptor.path) || descriptor.path === 'manifest.json') {
            fail('LOCAL_DSF_MANIFEST_PATH_INVALID', `${path}.path`, 'Archive manifest contains an invalid payload path.');
        }
        if (descriptors.has(descriptor.path) || [...descriptors.keys()].some((key) => key.toLowerCase() === descriptor.path.toLowerCase())) {
            fail('LOCAL_DSF_MANIFEST_PATH_DUPLICATE', `${path}.path`, 'Archive manifest path is duplicated.');
        }
        const mimeType = expectedMimeType(descriptor.path);
        if (!mimeType || descriptor.mimeType !== mimeType) {
            fail('LOCAL_DSF_MANIFEST_MIME_INVALID', `${path}.mimeType`, 'Archive payload MIME type is unsupported.');
        }
        const maximumBytes = maximumBytesForPath(descriptor.path);
        if (!Number.isSafeInteger(descriptor.byteLength)
            || descriptor.byteLength < 1
            || descriptor.byteLength > maximumBytes) {
            fail('LOCAL_DSF_MANIFEST_SIZE_INVALID', `${path}.byteLength`, 'Archive payload size is invalid.');
        }
        if (typeof descriptor.sha256 !== 'string' || !SHA256_PATTERN.test(descriptor.sha256)) {
            fail('LOCAL_DSF_MANIFEST_HASH_INVALID', `${path}.sha256`, 'Archive payload SHA-256 is invalid.');
        }
        payloadByteLength += descriptor.byteLength;
        if (!Number.isSafeInteger(payloadByteLength) || payloadByteLength > MAX_ARCHIVE_PAYLOAD_BYTES) {
            fail('LOCAL_DSF_PAYLOAD_LIMIT_EXCEEDED', 'manifest.json.payloadByteLength', 'Archive payload exceeds the local Viewer limit.');
        }
        descriptors.set(descriptor.path, descriptor);
    }
    if (manifest.payloadByteLength !== payloadByteLength) {
        fail('LOCAL_DSF_MANIFEST_TOTAL_MISMATCH', 'manifest.json.payloadByteLength', 'Archive payload byte total does not match its files.');
    }
    for (const requiredPath of ['mimetype', 'meta.json', 'content.json']) {
        if (!descriptors.has(requiredPath)) fail('LOCAL_DSF_REQUIRED_FILE_MISSING', requiredPath, 'Portable DSF required file is missing.');
    }
    return descriptors;
}

async function readAndVerifyPayloadFiles(zip, descriptors, hashBytes) {
    const actualPaths = Object.keys(zip.files);
    const expectedPaths = new Set(['manifest.json', ...descriptors.keys()]);
    if (actualPaths.length !== expectedPaths.size || actualPaths.some((path) => !expectedPaths.has(path))) {
        fail('LOCAL_DSF_ARCHIVE_FILE_SET_MISMATCH', '', 'ZIP entries do not exactly match manifest.json.');
    }
    const bytesByPath = new Map();
    for (const [path, descriptor] of descriptors) {
        const bytes = await readEntryBytes(zip.file(path), path, maximumBytesForPath(path));
        if (bytes.byteLength !== descriptor.byteLength) {
            fail('LOCAL_DSF_ENTRY_SIZE_MISMATCH', path, 'Archive payload size does not match manifest.json.');
        }
        const sha256 = await hashBytes(bytes);
        if (sha256 !== descriptor.sha256) {
            fail('LOCAL_DSF_ENTRY_HASH_MISMATCH', path, 'Archive payload SHA-256 does not match manifest.json.');
        }
        bytesByPath.set(path, bytes);
    }
    return bytesByPath;
}

function validateMimetype(bytes) {
    if (decodeUtf8(bytes, 'mimetype') !== DSF_CONTENT_MIMETYPE) {
        fail('LOCAL_DSF_MIMETYPE_INVALID', 'mimetype', 'Archive mimetype is not a DSF content package.');
    }
}

function validateMeta(meta, index) {
    const languages = Object.keys(index.languages || {});
    if (meta.schemaVersion !== 2 || meta.format !== 'dsf') {
        fail('LOCAL_DSF_META_VERSION_UNSUPPORTED', 'meta.json', 'Portable Viewer requires DSF delivery schema v2 metadata.');
    }
    if (!Array.isArray(meta.languages)
        || meta.languages.length !== languages.length
        || meta.languages.some((language, indexValue) => language !== languages[indexValue])
        || meta.defaultLang !== index.defaultLang) {
        fail('LOCAL_DSF_META_LANGUAGE_MISMATCH', 'meta.json.languages', 'Metadata languages do not match content.json.');
    }
    const presentation = meta.presentation;
    if (!isRecord(presentation)
        || presentation.aspectRatio !== '9:16'
        || presentation.canonicalLogicalWidth !== 360
        || presentation.canonicalLogicalHeight !== 640
        || !['none', 'auto'].includes(presentation.spread)) {
        fail('LOCAL_DSF_META_PRESENTATION_INVALID', 'meta.json.presentation', 'Metadata presentation does not match the canonical DSF page.');
    }
}

function resolveArchiveResourcePath(basePath, href, path) {
    if (typeof href !== 'string' || !href || href.includes('\\') || href.includes(':') || href.startsWith('/')) {
        fail('LOCAL_DSF_RESOURCE_HREF_INVALID', path, 'Portable resource href must be archive-relative.');
    }
    let resolved;
    try {
        const base = new URL(basePath, 'https://dsf-archive.invalid/');
        const url = new URL(href, base);
        if (url.origin !== 'https://dsf-archive.invalid' || url.search || url.hash) throw new Error('external');
        resolved = decodeURIComponent(url.pathname.slice(1));
    } catch {
        fail('LOCAL_DSF_RESOURCE_HREF_INVALID', path, 'Portable resource href cannot be resolved safely.');
    }
    if (!validArchivePath(resolved)) fail('LOCAL_DSF_RESOURCE_HREF_INVALID', path, 'Portable resource path is unsafe.');
    return resolved;
}

function validatePortableFontDeclaration(fontId, declaration, registry) {
    const entry = registry.fonts?.[fontId];
    const source = entry?.declaration;
    if (!entry
        || declaration?.source !== 'embedded'
        || declaration.family !== source?.family
        || declaration.version !== source?.version
        || declaration.sha256 !== source?.sha256
        || declaration.href !== `fonts/${declaration.sha256}.woff2`
        || entry.license?.allowsPortableEmbedding !== true) {
        fail('LOCAL_DSF_FONT_CERTIFICATE_MISMATCH', `content.json.fonts.${fontId}`, 'Embedded font does not match the active production certificate.');
    }
    return entry;
}

function collectFontUsage(bundle, fontId) {
    const usages = new Map();
    for (const manifest of Object.values(bundle.manifests)) {
        for (const style of Object.values(manifest.styles || {})) {
            if (style?.fontRef !== fontId) continue;
            const weight = Number(style.fontWeight) || 400;
            const fontStyle = style.fontStyle || 'normal';
            usages.set(`${fontStyle}:${weight}`, { weight, fontStyle });
        }
    }
    return [...usages.values()];
}

function runtimeFontFamily(fontId, sha256) {
    const safeId = String(fontId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
    return `DSF Portable ${safeId} ${sha256.slice(0, 12)}`;
}

async function prepareEmbeddedFonts({
    bundle,
    bytesByPath,
    fontRegistry,
    fontFaceSet,
    FontFaceCtor,
    cryptoRef,
}) {
    const registryValidation = validateDsfProductionFontRegistry(fontRegistry);
    if (!registryValidation.valid) {
        fail('LOCAL_DSF_FONT_REGISTRY_INVALID', 'fontRegistry', 'Active production font registry is invalid.', {
            validationIssues: registryValidation.issues,
        });
    }
    const runtimeBundle = normalizeDsfDeliveryBundle(bundle);
    const runtimeCertificates = {};
    const faces = [];
    try {
        for (const [fontId, declaration] of Object.entries(bundle.index.fonts || {})) {
            const registryEntry = validatePortableFontDeclaration(fontId, declaration, fontRegistry);
            const bytes = bytesByPath.get(declaration.href);
            if (!bytes) fail('LOCAL_DSF_FONT_FILE_MISSING', declaration.href, 'Embedded font file is missing.');
            try {
                await verifyDsfProductionFontAsset({
                    registry: fontRegistry,
                    fontId,
                    bytes,
                    cryptoRef,
                });
            } catch (error) {
                fail('LOCAL_DSF_FONT_BYTES_INVALID', declaration.href, 'Embedded font bytes failed production verification.', {
                    causeCode: error?.code || null,
                    cause: error?.message || String(error),
                });
            }
            if (typeof FontFaceCtor !== 'function'
                || !fontFaceSet
                || typeof fontFaceSet.add !== 'function'
                || typeof fontFaceSet.delete !== 'function') {
                fail('LOCAL_DSF_FONT_API_UNAVAILABLE', declaration.href, 'The browser FontFace API is unavailable.');
            }
            const family = runtimeFontFamily(fontId, declaration.sha256);
            const usages = collectFontUsage(bundle, fontId);
            const faceDescriptors = usages.length ? usages : [{ weight: 400, fontStyle: 'normal' }];
            for (const usage of faceDescriptors) {
                let face;
                face = new FontFaceCtor(family, bytes.slice().buffer, {
                    weight: String(usage.weight),
                    style: usage.fontStyle,
                });
                await face.load();
                fontFaceSet.add(face);
                faces.push(face);
            }
            runtimeBundle.index.fonts[fontId] = {
                ...runtimeBundle.index.fonts[fontId],
                family,
            };
            runtimeCertificates[fontId] = { ...runtimeBundle.index.fonts[fontId] };
            if (!registryEntry.capabilities.fontWeights.every((weight) => Number.isInteger(weight))) {
                fail('LOCAL_DSF_FONT_CAPABILITY_INVALID', `fontRegistry.fonts.${fontId}.capabilities`, 'Font weight certificate is invalid.');
            }
        }
    } catch (error) {
        while (faces.length) {
            try { fontFaceSet?.delete?.(faces.pop()); } catch (_) { /* noop */ }
        }
        if (error instanceof DsfLocalViewerPackageError) throw error;
        fail('LOCAL_DSF_FONT_LOAD_FAILED', '', 'Embedded font could not be loaded by the browser.', {
            causeCode: error?.code || null,
            cause: error?.message || String(error),
        });
    }
    return { runtimeBundle, runtimeCertificates, faces };
}

async function verifyImages({ bundle, bytesByPath, descriptors, urlRef }) {
    if (!urlRef || typeof urlRef.createObjectURL !== 'function' || typeof urlRef.revokeObjectURL !== 'function') {
        fail('LOCAL_DSF_OBJECT_URL_API_UNAVAILABLE', '', 'Object URL API is unavailable.');
    }
    const paths = new Map();
    for (const [language, manifest] of Object.entries(bundle.manifests)) {
        const manifestPath = bundle.index.languages[language].href;
        for (const [pageIndex, page] of manifest.pages.entries()) {
            const resources = [];
            if (page.renderKind === 'image') {
                resources.push({ href: page.image.href, image: page.image, field: 'image.href' });
            }
            if (page.renderKind === 'fixedText' && page.background?.imageHref) {
                resources.push({ href: page.background.imageHref, image: null, field: 'background.imageHref' });
            }
            for (const resource of resources) {
                const fieldPath = `manifests.${language}.pages[${pageIndex}].${resource.field}`;
                const archivePath = resolveArchiveResourcePath(manifestPath, resource.href, fieldPath);
                const descriptor = descriptors.get(archivePath);
                const bytes = bytesByPath.get(archivePath);
                if (!descriptor || descriptor.mimeType !== 'image/webp' || !bytes) {
                    fail('LOCAL_DSF_IMAGE_FILE_MISSING', fieldPath, 'Referenced WebP is missing from the portable archive.');
                }
                let inspection;
                try {
                    inspection = await inspectDsfWebPBytes(bytes);
                } catch (error) {
                    fail('LOCAL_DSF_IMAGE_BYTES_INVALID', archivePath, 'Referenced image is not a supported static WebP.', {
                        causeCode: error?.code || null,
                        cause: error?.message || String(error),
                    });
                }
                if (resource.image
                    && (inspection.width !== resource.image.width || inspection.height !== resource.image.height)) {
                    fail('LOCAL_DSF_IMAGE_DIMENSION_MISMATCH', archivePath, 'WebP dimensions do not match the delivery page descriptor.');
                }
                const existing = paths.get(resource.href);
                if (existing && existing.archivePath !== archivePath) {
                    fail('LOCAL_DSF_RESOURCE_HREF_COLLISION', fieldPath, 'The same resource href resolves to different archive files.');
                }
                paths.set(resource.href, { archivePath });
            }
        }
    }
    const urlsByArchivePath = new Map();
    const assetUrls = new Map();
    try {
        for (const [href, value] of paths) {
            let url = urlsByArchivePath.get(value.archivePath);
            if (!url) {
                url = urlRef.createObjectURL(new Blob([bytesByPath.get(value.archivePath)], { type: 'image/webp' }));
                urlsByArchivePath.set(value.archivePath, url);
            }
            assetUrls.set(href, url);
            assetUrls.set(value.archivePath, url);
        }
    } catch (error) {
        for (const url of urlsByArchivePath.values()) {
            try { urlRef.revokeObjectURL(url); } catch (_) { /* noop */ }
        }
        fail('LOCAL_DSF_OBJECT_URL_FAILED', '', 'Portable image Object URL could not be created.', {
            cause: error?.message || String(error),
        });
    }
    return { assetUrls, objectUrls: [...urlsByArchivePath.values()] };
}

function createViewerPages(manifest) {
    return manifest.pages.map((deliveryPage) => ({
        id: deliveryPage.id,
        deliveryV2: deliveryPage,
        content: {
            backgrounds: deliveryPage.renderKind === 'image'
                ? { '__all': deliveryPage.image.href }
                : {},
            bubbles: {},
        },
    }));
}

function createProject(meta, index, pages, archiveByteLength) {
    const languages = Object.keys(index.languages);
    return {
        projectId: meta.projectId || 'local_portable_v2',
        workId: meta.workId || '',
        releaseId: meta.releaseId || '',
        title: meta.title || 'Untitled',
        labelName: meta.labelName || '',
        rating: meta.rating || 'all',
        license: meta.license || 'all-rights-reserved',
        meta: meta.meta || {},
        languages,
        defaultLang: index.defaultLang,
        languageConfigs: Object.fromEntries(languages.map((language) => [
            language,
            { pageDirection: index.languages[language].pageDirection },
        ])),
        pages,
        dsfResolution: `${index.canonicalPage.width}x${index.canonicalPage.height}`,
        dsfTotalBytes: archiveByteLength,
        bookMode: meta.presentation?.spread === 'none' ? 'none' : 'simple',
    };
}

export class DsfLocalViewerPackageError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Local portable DSF could not be opened.');
        this.name = 'DsfLocalViewerPackageError';
        this.code = 'DSF_LOCAL_VIEWER_PACKAGE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Return null for legacy DSF/DSP ZIPs so the existing reader can handle them.
 * Once content.json declares schemaVersion 2, every v2 invariant is mandatory.
 */
export async function loadDsfLocalViewerPackage(input = {}) {
    const file = input.file;
    if (!(typeof Blob !== 'undefined' && file instanceof Blob)) {
        throw new TypeError('A local DSF Blob is required.');
    }
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ARCHIVE_BYTES) {
        fail('LOCAL_DSF_ARCHIVE_SIZE_INVALID', 'file', 'Local DSF archive size is invalid.');
    }
    const cryptoRef = input.cryptoRef || globalThis.crypto;
    const hashBytes = async (bytes) => sha256DsfBytes(bytes, { cryptoRef });
    const archiveBytes = new Uint8Array(await file.arrayBuffer());
    let zip;
    try {
        zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true, createFolders: false });
    } catch (error) {
        fail('LOCAL_DSF_ZIP_INVALID', 'file', 'Local DSF ZIP could not be opened or failed CRC validation.', {
            cause: error?.message || String(error),
        });
    }
    const detectedIndex = await readContentIndexForDetection(zip);
    if (detectedIndex?.schemaVersion !== 2) return null;

    const fontFaceSet = input.fontFaceSet || globalThis.document?.fonts;
    const FontFaceCtor = input.FontFaceCtor || globalThis.FontFace;
    const fontRegistry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const urlRef = input.urlRef || globalThis.URL;
    const registeredFaces = [];
    const objectUrls = [];
    const disposeRuntime = () => {
        while (registeredFaces.length) {
            try { fontFaceSet?.delete?.(registeredFaces.pop()); } catch (_) { /* noop */ }
        }
        while (objectUrls.length) {
            try { urlRef?.revokeObjectURL?.(objectUrls.pop()); } catch (_) { /* noop */ }
        }
    };

    try {
        validateArchiveEntries(zip);
        const manifestBytes = await readEntryBytes(zip.file('manifest.json'), 'manifest.json', MAX_JSON_BYTES);
        const archiveManifest = parseJsonBytes(manifestBytes, 'manifest.json');
        const descriptors = validateArchiveManifest(archiveManifest);
        const bytesByPath = await readAndVerifyPayloadFiles(zip, descriptors, hashBytes);
        validateMimetype(bytesByPath.get('mimetype'));

        const meta = parseJsonBytes(bytesByPath.get('meta.json'), 'meta.json');
        const index = parseJsonBytes(bytesByPath.get('content.json'), 'content.json');
        const manifests = {};
        for (const [language, descriptor] of Object.entries(index.languages || {})) {
            if (!isRecord(descriptor) || !validArchivePath(descriptor.href)) {
                fail('LOCAL_DSF_LANGUAGE_DESCRIPTOR_INVALID', `content.json.languages.${language}`, 'Language descriptor is invalid.');
            }
            const archiveDescriptor = descriptors.get(descriptor.href);
            const bytes = bytesByPath.get(descriptor.href);
            if (!archiveDescriptor || archiveDescriptor.mimeType !== JSON_MIME_TYPE || !bytes) {
                fail('LOCAL_DSF_LANGUAGE_FILE_MISSING', descriptor.href, 'Language manifest file is missing.');
            }
            if (descriptor.sha256 !== archiveDescriptor.sha256) {
                fail('LOCAL_DSF_LANGUAGE_HASH_MISMATCH', descriptor.href, 'Language manifest hash does not match content.json.');
            }
            manifests[language] = parseJsonBytes(bytes, descriptor.href);
        }
        const sourceBundle = normalizeDsfDeliveryBundle({ index, manifests });
        assertValidDsfDeliveryBundle(sourceBundle);
        validateMeta(meta, sourceBundle.index);

        const fontRuntime = await prepareEmbeddedFonts({
            bundle: sourceBundle,
            bytesByPath,
            fontRegistry,
            fontFaceSet,
            FontFaceCtor,
            cryptoRef,
        });
        registeredFaces.push(...fontRuntime.faces);
        const imageRuntime = await verifyImages({
            bundle: sourceBundle,
            bytesByPath,
            descriptors,
            urlRef,
        });
        objectUrls.push(...imageRuntime.objectUrls);

        const contextsByLanguage = new Map();
        const pagesByLanguage = new Map();
        for (const language of Object.keys(fontRuntime.runtimeBundle.index.languages)) {
            const context = await prepareDsfViewerFixedTextContext({
                bundle: fontRuntime.runtimeBundle,
                language,
                certifiedFonts: fontRuntime.runtimeCertificates,
                fontFaceSet,
            });
            contextsByLanguage.set(language, context);
            pagesByLanguage.set(language, createViewerPages(context.manifest));
        }
        const defaultLang = fontRuntime.runtimeBundle.index.defaultLang;
        const project = createProject(meta, fontRuntime.runtimeBundle.index, pagesByLanguage.get(defaultLang), file.size);
        const archiveSha256 = await hashBytes(archiveBytes);
        let disposed = false;
        return {
            packageVersion: DSF_LOCAL_VIEWER_PACKAGE_VERSION,
            packageKind: DSF_LOCAL_VIEWER_PACKAGE_KIND,
            archive: Object.freeze({
                byteLength: file.size,
                sha256: archiveSha256,
                entryCount: Object.keys(zip.files).length,
            }),
            meta,
            index: sourceBundle.index,
            manifests: sourceBundle.manifests,
            project,
            contextsByLanguage,
            pagesByLanguage,
            assetUrls: imageRuntime.assetUrls,
            dispose() {
                if (disposed) return;
                disposed = true;
                disposeRuntime();
            },
        };
    } catch (error) {
        disposeRuntime();
        if (error instanceof DsfLocalViewerPackageError) throw error;
        fail('LOCAL_DSF_PREPARATION_FAILED', '', 'Portable DSF Viewer preparation failed.', {
            causeCode: error?.code || null,
            cause: error?.message || String(error),
            validationIssues: error?.issues || [],
        });
    }
}
