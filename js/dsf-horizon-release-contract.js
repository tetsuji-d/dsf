/**
 * Pure Horizon delivery v2 publication contract.
 *
 * This module turns an already verified DSF v2 release assembly into an
 * immutable R2 upload plan, then seals Firestore/public Viewer locators only
 * after every uploaded object is acknowledged with the exact planned URL,
 * MIME type, byte length, SHA-256, and cache policy. It performs no fetch,
 * upload, Firebase, Firestore, DOM, or Viewer state mutation.
 */

import {
    DSF_DELIVERY_SCHEMA_VERSION,
    assertValidDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import {
    DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
    serializeDsfReleaseJson,
} from './dsf-release-assembly.js';
import { sha256DsfBytes } from './dsf-release-byte-sealing.js';
import {
    DSF_PRODUCTION_FONT_REGISTRY,
    validateDsfProductionFontRegistry,
} from './dsf-font-registry.js';
import { deepClone } from './utils.js';

export const DSF_HORIZON_RELEASE_CONTRACT_VERSION = 1;
export const DSF_HORIZON_RELEASE_PLAN_KIND = 'horizon-v2-release-plan';
export const DSF_HORIZON_RELEASE_SEAL_KIND = 'horizon-v2-release-seal';
export const DSF_HORIZON_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const MAX_RELEASE_FILES = 20_000;
const MAX_RELEASE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_PAGE_COUNT = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const JSON_MIME_TYPE = 'application/json';
const WEBP_MIME_TYPE = 'image/webp';
const V2_LOCATOR_FIELDS = Object.freeze([
    'dsfContentUrl',
    'dsfContentHash',
    'dsfLangs',
    'dsfPageCounts',
    'dsfTotalBytes',
]);
const PLAN_INPUT_KEYS = new Set([
    'assembly',
    'uid',
    'workId',
    'releaseId',
    'publicBaseUrl',
    'fontRegistry',
    'hashBytes',
    'cryptoRef',
]);
const SEAL_INPUT_KEYS = new Set(['plan', 'receipts']);
const RECEIPT_KEYS = new Set([
    'storagePath',
    'publicUrl',
    'mimeType',
    'byteLength',
    'sha256',
    'cacheControl',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}) {
    throw new DsfHorizonReleaseContractError([createIssue(code, path, message, details)]);
}

function assertExactKeys(value, allowedKeys, path, code) {
    if (!isRecord(value)) fail(code, path, 'Expected an object.');
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) fail(code, path ? `${path}.${key}` : key, 'Unsupported property.');
    }
}

function assertSafeId(value, path) {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        fail('HORIZON_RELEASE_ID_INVALID', path, 'Horizon release identity must be a safe immutable path segment.');
    }
}

function assertHexSha256(value, path) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        fail('HORIZON_RELEASE_HASH_INVALID', path, 'Horizon release hashes must use lowercase 64-character SHA-256 hex.');
    }
}

function assertPositiveSafeInteger(value, path, maximum, code = 'HORIZON_RELEASE_SIZE_INVALID') {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        fail(code, path, 'Value is outside the supported positive integer range.');
    }
}

function validRelativePath(value) {
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

function parsePublicBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        fail('HORIZON_RELEASE_BASE_URL_INVALID', 'publicBaseUrl', 'Horizon public base URL cannot be parsed.');
    }
    if (url.protocol !== 'https:'
        || url.username
        || url.password
        || url.search
        || url.hash
        || url.pathname !== '/') {
        fail('HORIZON_RELEASE_BASE_URL_INVALID', 'publicBaseUrl', 'Horizon public base URL must be an HTTPS origin without credentials or path state.');
    }
    return url;
}

function createPublicUrl(baseUrl, storagePath) {
    return new URL(storagePath, baseUrl).href;
}

function resolveReleaseResourcePath(manifestPath, href, path) {
    if (typeof href !== 'string' || !href || href.includes('\\') || href.includes(':') || href.startsWith('/')) {
        fail('HORIZON_RELEASE_RESOURCE_HREF_INVALID', path, 'Release resources must use archive-relative paths.');
    }
    let resolved;
    try {
        const root = 'https://dsf-release.invalid/root/';
        const manifestUrl = new URL(manifestPath, root);
        const resourceUrl = new URL(href, manifestUrl);
        if (resourceUrl.origin !== 'https://dsf-release.invalid'
            || !resourceUrl.pathname.startsWith('/root/')
            || resourceUrl.search
            || resourceUrl.hash) {
            throw new Error('external');
        }
        resolved = decodeURIComponent(resourceUrl.pathname.slice('/root/'.length));
    } catch {
        fail('HORIZON_RELEASE_RESOURCE_HREF_INVALID', path, 'Release resource path cannot be resolved safely.');
    }
    if (!validRelativePath(resolved)) {
        fail('HORIZON_RELEASE_RESOURCE_HREF_INVALID', path, 'Release resource path is unsafe.');
    }
    return resolved;
}

function assertAssemblyMetadata(assembly) {
    if (assembly.schemaVersion !== DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION
        || !isRecord(assembly.files)
        || !isRecord(assembly.files.index)
        || !isRecord(assembly.files.manifests)
        || !Array.isArray(assembly.files.assets)
        || !isRecord(assembly.releaseMetadata)
        || !isRecord(assembly.summary)) {
        fail('HORIZON_RELEASE_ASSEMBLY_INVALID', 'assembly', 'A complete DSF v2 release assembly is required.');
    }
    try {
        assertValidDsfDeliveryBundle(assembly.bundle);
    } catch (error) {
        fail('HORIZON_RELEASE_BUNDLE_INVALID', 'assembly.bundle', 'Release bundle failed DSF delivery v2 validation.', {
            validationIssues: deepClone(error?.issues || []),
        });
    }
    if (assembly.bundle.index.schemaVersion !== DSF_DELIVERY_SCHEMA_VERSION
        || assembly.releaseMetadata.dsfSchemaVersion !== DSF_DELIVERY_SCHEMA_VERSION) {
        fail('HORIZON_RELEASE_SCHEMA_UNSUPPORTED', 'assembly.releaseMetadata.dsfSchemaVersion', 'Horizon plan requires DSF delivery schema v2.');
    }
}

function assertHorizonFonts(index, fontRegistry) {
    const validation = validateDsfProductionFontRegistry(fontRegistry);
    if (!validation.valid) {
        fail('HORIZON_RELEASE_FONT_REGISTRY_INVALID', 'fontRegistry', 'Active production font registry is invalid.', {
            validationIssues: validation.issues,
        });
    }
    for (const [fontId, declaration] of Object.entries(index.fonts || {})) {
        const registryEntry = fontRegistry.fonts?.[fontId];
        if (!registryEntry
            || declaration.source !== 'registry'
            || registryEntry.license?.allowsWebDistribution !== true
            || serializeDsfReleaseJson(declaration) !== serializeDsfReleaseJson(registryEntry.declaration)) {
            fail('HORIZON_RELEASE_FONT_CERTIFICATE_MISMATCH', `assembly.bundle.index.fonts.${fontId}`, 'Horizon font must exactly match an active web-distribution certificate.');
        }
    }
}

async function assertCanonicalJsonFile({ file, expectedPath, expectedValue, hashBytes, path }) {
    if (!isRecord(file)
        || file.path !== expectedPath
        || file.json !== serializeDsfReleaseJson(expectedValue)) {
        fail('HORIZON_RELEASE_JSON_FILE_MISMATCH', path, 'Release JSON file does not match its canonical bundle value.');
    }
    const bytes = new TextEncoder().encode(file.json);
    if (file.byteLength !== bytes.byteLength) {
        fail('HORIZON_RELEASE_JSON_SIZE_MISMATCH', `${path}.byteLength`, 'Release JSON byte length is stale.');
    }
    assertHexSha256(file.sha256, `${path}.sha256`);
    const actualSha256 = await hashBytes(bytes);
    if (actualSha256 !== file.sha256) {
        fail('HORIZON_RELEASE_JSON_HASH_MISMATCH', `${path}.sha256`, 'Release JSON SHA-256 does not match its exact UTF-8 bytes.');
    }
}

function collectReferencedImages(assembly) {
    const references = new Map();
    for (const [language, manifest] of Object.entries(assembly.bundle.manifests)) {
        const manifestPath = assembly.files.manifests[language]?.path;
        manifest.pages.forEach((page, pageIndex) => {
            const background=page.renderKind==='fixedText' && !!page.background?.imageHref;
            if(page.renderKind!=='image' && !background)return;
            const path=`assembly.bundle.manifests.${language}.pages[${pageIndex}].${background?'background.imageHref':'image.href'}`;
            const relativePath=resolveReleaseResourcePath(manifestPath,background?page.background.imageHref:page.image.href,path);
            if(background && !assembly.files.assets.some(asset=>asset.path===relativePath && asset.purpose==='fixedTextBackground')) {
                fail('HORIZON_RELEASE_FIXED_TEXT_BACKGROUND_UNPLANNED',path,'Background requires an explicit sealed asset plan.');
            }
            if (references.has(relativePath)) {
                fail('HORIZON_RELEASE_IMAGE_PATH_DUPLICATE', path, 'A Horizon image path cannot be shared by multiple delivery pages.');
            }
            references.set(relativePath, {
                language,
                pageIndex,
                width: background ? null : page.image.width,
                height: background ? null : page.image.height,
                blockId: background ? page.sourceAnchor?.flowGroupId : page.sourceAnchor?.blockId,
                purpose: background ? 'fixedTextBackground' : undefined,
            });
        });
    }
    return references;
}

function assertAssets(assembly) {
    const references = collectReferencedImages(assembly);
    const assets = new Map();
    for (const [assetIndex, asset] of assembly.files.assets.entries()) {
        const path = `assembly.files.assets[${assetIndex}]`;
        if (!isRecord(asset)
            || !validRelativePath(asset.path)
            || !/^assets\/images\/.+\.webp$/.test(asset.path)
            || asset.mimeType !== WEBP_MIME_TYPE) {
            fail('HORIZON_RELEASE_IMAGE_ASSET_INVALID', path, 'Horizon image asset descriptor is invalid.');
        }
        if (assets.has(asset.path)) {
            fail('HORIZON_RELEASE_IMAGE_PATH_DUPLICATE', `${path}.path`, 'Horizon image asset path is duplicated.');
        }
        assertHexSha256(asset.sha256, `${path}.sha256`);
        assertPositiveSafeInteger(asset.byteLength, `${path}.byteLength`, 128 * 1024 * 1024);
        const reference = references.get(asset.path);
        if (!reference
            || asset.language !== reference.language
            || asset.pageIndex !== reference.pageIndex
            || asset.blockId !== reference.blockId
            || asset.purpose !== reference.purpose
            || (reference.purpose==='fixedTextBackground'
                ? (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width<1 || asset.height<1
                    || asset.width*640!==asset.height*360)
                : (asset.width !== reference.width || asset.height !== reference.height))) {
            fail('HORIZON_RELEASE_IMAGE_ASSET_MISMATCH', path, 'Horizon image asset does not exactly match its delivery page.');
        }
        assets.set(asset.path, asset);
    }
    if (assets.size !== references.size) {
        fail('HORIZON_RELEASE_IMAGE_FILE_SET_MISMATCH', 'assembly.files.assets', 'Every image page must have exactly one sealed Horizon asset descriptor.');
    }
}

function createFileDescriptor({ role, relativePath, mimeType, byteLength, sha256, rootPath, baseUrl, language, pageIndex, json }) {
    const storagePath = `${rootPath}/${relativePath}`;
    return {
        role,
        relativePath,
        storagePath,
        publicUrl: createPublicUrl(baseUrl, storagePath),
        mimeType,
        byteLength,
        sha256,
        cacheControl: DSF_HORIZON_IMMUTABLE_CACHE_CONTROL,
        ...(language ? { language } : {}),
        ...(Number.isInteger(pageIndex) ? { pageIndex } : {}),
        ...(typeof json === 'string' ? { json } : {}),
    };
}

function assertMetadataMatchesAssembly(assembly) {
    const languages = Object.keys(assembly.bundle.index.languages);
    const pageCounts = Object.fromEntries(languages.map((language) => [
        language,
        assembly.bundle.manifests[language].pages.length,
    ]));
    const expectedTotal = assembly.files.index.byteLength
        + Object.values(assembly.files.manifests).reduce((sum, file) => sum + file.byteLength, 0)
        + assembly.files.assets.reduce((sum, file) => sum + file.byteLength, 0);
    if (assembly.files.index.sha256 !== assembly.releaseMetadata.dsfContentHash
        || serializeDsfReleaseJson(assembly.releaseMetadata.dsfLangs) !== serializeDsfReleaseJson(languages)
        || serializeDsfReleaseJson(assembly.releaseMetadata.dsfPageCounts) !== serializeDsfReleaseJson(pageCounts)
        || assembly.releaseMetadata.dsfTotalBytes !== expectedTotal
        || assembly.summary.totalBytes !== expectedTotal) {
        fail('HORIZON_RELEASE_METADATA_MISMATCH', 'assembly.releaseMetadata', 'Release metadata is not an exact projection of the assembled files.');
    }
    assertPositiveSafeInteger(expectedTotal, 'assembly.releaseMetadata.dsfTotalBytes', MAX_RELEASE_BYTES);
    return { languages, pageCounts, expectedTotal };
}

export class DsfHorizonReleaseContractError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Horizon DSF v2 release contract failed.');
        this.name = 'DsfHorizonReleaseContractError';
        this.code = 'DSF_HORIZON_RELEASE_CONTRACT_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Create an immutable upload plan. No release/public locator is publishable
 * until sealDsfHorizonReleasePlan verifies an exact receipt for every file.
 */
export async function createDsfHorizonReleasePlan(input = {}) {
    assertExactKeys(input, PLAN_INPUT_KEYS, '', 'HORIZON_RELEASE_INPUT_INVALID');
    const assembly = input.assembly;
    if (!isRecord(assembly)) fail('HORIZON_RELEASE_ASSEMBLY_INVALID', 'assembly', 'A DSF release assembly is required.');
    assertSafeId(input.uid, 'uid');
    assertSafeId(input.workId, 'workId');
    assertSafeId(input.releaseId, 'releaseId');
    const baseUrl = parsePublicBaseUrl(input.publicBaseUrl);
    const fontRegistry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const hashBytes = input.hashBytes || (async (bytes) => sha256DsfBytes(bytes, { cryptoRef: input.cryptoRef || globalThis.crypto }));
    if (typeof hashBytes !== 'function') fail('HORIZON_RELEASE_HASHER_INVALID', 'hashBytes', 'hashBytes must be a function.');

    assertAssemblyMetadata(assembly);
    assertHorizonFonts(assembly.bundle.index, fontRegistry);
    await assertCanonicalJsonFile({
        file: assembly.files.index,
        expectedPath: 'content.json',
        expectedValue: assembly.bundle.index,
        hashBytes,
        path: 'assembly.files.index',
    });
    for (const [language, descriptor] of Object.entries(assembly.bundle.index.languages)) {
        await assertCanonicalJsonFile({
            file: assembly.files.manifests[language],
            expectedPath: descriptor.href,
            expectedValue: assembly.bundle.manifests[language],
            hashBytes,
            path: `assembly.files.manifests.${language}`,
        });
        if (assembly.files.manifests[language].sha256 !== descriptor.sha256) {
            fail('HORIZON_RELEASE_LANGUAGE_HASH_MISMATCH', `assembly.bundle.index.languages.${language}.sha256`, 'Language manifest hash is stale.');
        }
    }
    assertAssets(assembly);
    const metadata = assertMetadataMatchesAssembly(assembly);
    const rootPath = `users/${input.uid}/dsf/${input.workId}/${input.releaseId}`;
    const files = [
        createFileDescriptor({
            role: 'content-index',
            relativePath: assembly.files.index.path,
            mimeType: JSON_MIME_TYPE,
            byteLength: assembly.files.index.byteLength,
            sha256: assembly.files.index.sha256,
            json: assembly.files.index.json,
            rootPath,
            baseUrl,
        }),
        ...metadata.languages.map((language) => {
            const file = assembly.files.manifests[language];
            return createFileDescriptor({
                role: 'language-manifest',
                relativePath: file.path,
                mimeType: JSON_MIME_TYPE,
                byteLength: file.byteLength,
                sha256: file.sha256,
                json: file.json,
                language,
                rootPath,
                baseUrl,
            });
        }),
        ...assembly.files.assets.map((asset) => createFileDescriptor({
            role: 'image',
            relativePath: asset.path,
            mimeType: WEBP_MIME_TYPE,
            byteLength: asset.byteLength,
            sha256: asset.sha256,
            language: asset.language,
            pageIndex: asset.pageIndex,
            rootPath,
            baseUrl,
        })),
    ];
    if (files.length < 2 || files.length > MAX_RELEASE_FILES) {
        fail('HORIZON_RELEASE_FILE_COUNT_INVALID', 'files', 'Horizon release file count is outside the supported range.');
    }
    const storagePaths = new Set();
    for (const [index, file] of files.entries()) {
        const portablePath = file.storagePath.toLowerCase();
        if (storagePaths.has(portablePath)) {
            fail('HORIZON_RELEASE_FILE_PATH_COLLISION', `files[${index}].storagePath`, 'Horizon release file paths collide.');
        }
        storagePaths.add(portablePath);
    }

    return deepFreeze({
        contractVersion: DSF_HORIZON_RELEASE_CONTRACT_VERSION,
        contractKind: DSF_HORIZON_RELEASE_PLAN_KIND,
        readyForUpload: true,
        readyForMetadataWrite: false,
        identity: { uid: input.uid, workId: input.workId, releaseId: input.releaseId },
        publicOrigin: baseUrl.origin,
        releaseRootPath: rootPath,
        files,
        candidate: {
            dsfSchemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
            dsfContentUrl: files[0].publicUrl,
            dsfContentHash: assembly.files.index.sha256,
            dsfLangs: metadata.languages,
            dsfPageCounts: metadata.pageCounts,
            dsfTotalBytes: metadata.expectedTotal,
            defaultLang: assembly.bundle.index.defaultLang,
            pageCount: metadata.pageCounts[assembly.bundle.index.defaultLang],
        },
        summary: {
            fileCount: files.length,
            jsonFileCount: 1 + metadata.languages.length,
            imageFileCount: assembly.files.assets.length,
            externalFontCount: Object.keys(assembly.bundle.index.fonts).length,
            totalBytes: metadata.expectedTotal,
        },
    });
}

function validateReceipt(receipt, file, index) {
    const path = `receipts[${index}]`;
    assertExactKeys(receipt, RECEIPT_KEYS, path, 'HORIZON_RELEASE_RECEIPT_INVALID');
    for (const key of RECEIPT_KEYS) {
        if (receipt[key] !== file[key]) {
            fail('HORIZON_RELEASE_RECEIPT_MISMATCH', `${path}.${key}`, 'Upload receipt does not match the immutable Horizon file plan.', {
                storagePath: file.storagePath,
            });
        }
    }
}

/** Seal publishable metadata only after every upload receipt matches exactly. */
export function sealDsfHorizonReleasePlan(input = {}) {
    assertExactKeys(input, SEAL_INPUT_KEYS, '', 'HORIZON_RELEASE_SEAL_INPUT_INVALID');
    const plan = input.plan;
    if (!isRecord(plan)
        || plan.contractVersion !== DSF_HORIZON_RELEASE_CONTRACT_VERSION
        || plan.contractKind !== DSF_HORIZON_RELEASE_PLAN_KIND
        || plan.readyForUpload !== true
        || plan.readyForMetadataWrite !== false
        || !Array.isArray(plan.files)
        || !isRecord(plan.candidate)) {
        fail('HORIZON_RELEASE_PLAN_INVALID', 'plan', 'A verified Horizon release plan is required.');
    }
    if (!Array.isArray(input.receipts) || input.receipts.length !== plan.files.length) {
        fail('HORIZON_RELEASE_RECEIPT_SET_MISMATCH', 'receipts', 'Every planned Horizon file requires exactly one upload receipt.');
    }
    const receiptsByPath = new Map();
    input.receipts.forEach((receipt, index) => {
        if (!isRecord(receipt) || typeof receipt.storagePath !== 'string') {
            fail('HORIZON_RELEASE_RECEIPT_INVALID', `receipts[${index}]`, 'Upload receipt is invalid.');
        }
        if (receiptsByPath.has(receipt.storagePath)) {
            fail('HORIZON_RELEASE_RECEIPT_DUPLICATE', `receipts[${index}].storagePath`, 'Upload receipt path is duplicated.');
        }
        receiptsByPath.set(receipt.storagePath, receipt);
    });
    plan.files.forEach((file, index) => {
        const receipt = receiptsByPath.get(file.storagePath);
        if (!receipt) {
            fail('HORIZON_RELEASE_RECEIPT_MISSING', `receipts.${file.storagePath}`, 'Planned Horizon file has no upload receipt.');
        }
        validateReceipt(receipt, file, index);
    });
    const locator = deepClone(plan.candidate);
    return deepFreeze({
        contractVersion: DSF_HORIZON_RELEASE_CONTRACT_VERSION,
        contractKind: DSF_HORIZON_RELEASE_SEAL_KIND,
        readyForMetadataWrite: true,
        identity: deepClone(plan.identity),
        releaseMetadata: {
            dsfSchemaVersion: locator.dsfSchemaVersion,
            dsfContentUrl: locator.dsfContentUrl,
            dsfContentHash: locator.dsfContentHash,
            dsfLangs: locator.dsfLangs,
            dsfPageCounts: locator.dsfPageCounts,
            dsfTotalBytes: locator.dsfTotalBytes,
        },
        publicLocator: locator,
        summary: deepClone(plan.summary),
    });
}

function parseAllowedOrigins(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
        fail('HORIZON_PUBLIC_ORIGINS_INVALID', 'allowedContentOrigins', 'At least one allowed HTTPS content origin is required.');
    }
    const origins = new Set();
    value.forEach((entry, index) => {
        let url;
        try {
            url = new URL(entry);
        } catch {
            fail('HORIZON_PUBLIC_ORIGIN_INVALID', `allowedContentOrigins[${index}]`, 'Allowed content origin cannot be parsed.');
        }
        if (url.protocol !== 'https:' || url.origin !== entry || url.pathname !== '/' || url.search || url.hash) {
            fail('HORIZON_PUBLIC_ORIGIN_INVALID', `allowedContentOrigins[${index}]`, 'Allowed content origins must be exact HTTPS origins.');
        }
        origins.add(url.origin);
    });
    return origins;
}

function normalizePublicV2Locator(metadata, options) {
    if (!isRecord(metadata)) fail('HORIZON_PUBLIC_METADATA_INVALID', 'metadata', 'Public release metadata must be an object.');
    const uid = options.uid || metadata.authorUid || metadata.uid;
    const workId = options.workId || metadata.workId;
    const releaseId = options.releaseId || metadata.releaseId;
    assertSafeId(uid, 'metadata.authorUid');
    assertSafeId(workId, 'metadata.workId');
    assertSafeId(releaseId, 'metadata.releaseId');
    const allowedOrigins = parseAllowedOrigins(options.allowedContentOrigins);
    let contentUrl;
    try {
        contentUrl = new URL(metadata.dsfContentUrl);
    } catch {
        fail('HORIZON_PUBLIC_CONTENT_URL_INVALID', 'metadata.dsfContentUrl', 'Public DSF v2 content URL cannot be parsed.');
    }
    const expectedPath = `/users/${uid}/dsf/${workId}/${releaseId}/content.json`;
    if (contentUrl.protocol !== 'https:'
        || contentUrl.username
        || contentUrl.password
        || contentUrl.search
        || contentUrl.hash
        || contentUrl.pathname !== expectedPath
        || !allowedOrigins.has(contentUrl.origin)) {
        fail('HORIZON_PUBLIC_CONTENT_URL_INVALID', 'metadata.dsfContentUrl', 'Public DSF v2 content URL is outside the exact immutable release location.');
    }
    assertHexSha256(metadata.dsfContentHash, 'metadata.dsfContentHash');
    if (!Array.isArray(metadata.dsfLangs) || metadata.dsfLangs.length < 1 || metadata.dsfLangs.length > 32) {
        fail('HORIZON_PUBLIC_LANGUAGES_INVALID', 'metadata.dsfLangs', 'Public DSF v2 languages are invalid.');
    }
    const languages = [];
    const seenLanguages = new Set();
    metadata.dsfLangs.forEach((language, index) => {
        if (typeof language !== 'string'
            || !language
            || language !== language.trim()
            || language.length > 256
            || seenLanguages.has(language)) {
            fail('HORIZON_PUBLIC_LANGUAGE_INVALID', `metadata.dsfLangs[${index}]`, 'Public DSF v2 language keys must be unique exact strings.');
        }
        seenLanguages.add(language);
        languages.push(language);
    });
    if (!isRecord(metadata.dsfPageCounts)
        || Object.keys(metadata.dsfPageCounts).length !== languages.length
        || Object.keys(metadata.dsfPageCounts).some((language) => !seenLanguages.has(language))) {
        fail('HORIZON_PUBLIC_PAGE_COUNTS_INVALID', 'metadata.dsfPageCounts', 'Public DSF v2 page counts must exactly match its languages.');
    }
    const pageCounts = {};
    languages.forEach((language) => {
        assertPositiveSafeInteger(
            metadata.dsfPageCounts[language],
            `metadata.dsfPageCounts.${language}`,
            MAX_PAGE_COUNT,
            'HORIZON_PUBLIC_PAGE_COUNT_INVALID',
        );
        pageCounts[language] = metadata.dsfPageCounts[language];
    });
    const defaultLang = metadata.defaultLang;
    if (typeof defaultLang !== 'string' || !seenLanguages.has(defaultLang)) {
        fail('HORIZON_PUBLIC_DEFAULT_LANGUAGE_INVALID', 'metadata.defaultLang', 'Public DSF v2 default language must exist in dsfLangs.');
    }
    if (hasOwn(metadata, 'pageCount') && metadata.pageCount !== pageCounts[defaultLang]) {
        fail('HORIZON_PUBLIC_DEFAULT_PAGE_COUNT_MISMATCH', 'metadata.pageCount', 'Public default page count is stale.');
    }
    assertPositiveSafeInteger(metadata.dsfTotalBytes, 'metadata.dsfTotalBytes', MAX_RELEASE_BYTES, 'HORIZON_PUBLIC_TOTAL_BYTES_INVALID');
    return deepFreeze({
        transportKind: 'horizon-v2',
        schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
        contentUrl: contentUrl.href,
        contentHash: metadata.dsfContentHash,
        languages,
        pageCounts,
        defaultLang,
        totalBytes: metadata.dsfTotalBytes,
        identity: { uid, workId, releaseId },
    });
}

/**
 * Choose the public Viewer transport without silently falling back from a
 * declared or partially written v2 locator to stale v1 dsfPages.
 */
export function selectDsfPublicReleaseTransport(metadata, options = {}) {
    if (!isRecord(metadata)) fail('HORIZON_PUBLIC_METADATA_INVALID', 'metadata', 'Public release metadata must be an object.');
    const hasV2Locator = V2_LOCATOR_FIELDS.some((field) => hasOwn(metadata, field));
    if (metadata.dsfSchemaVersion === DSF_DELIVERY_SCHEMA_VERSION) {
        return normalizePublicV2Locator(metadata, options);
    }
    if (metadata.dsfSchemaVersion !== undefined && metadata.dsfSchemaVersion !== 1) {
        fail('HORIZON_PUBLIC_SCHEMA_UNSUPPORTED', 'metadata.dsfSchemaVersion', 'Public Viewer cannot open this DSF delivery schema.');
    }
    if (hasV2Locator) {
        fail('HORIZON_PUBLIC_V2_LOCATOR_PARTIAL', 'metadata', 'Partial DSF v2 metadata cannot fall back to v1 pages.');
    }
    if (!Array.isArray(metadata.dsfPages) || metadata.dsfPages.length < 1) {
        fail('HORIZON_PUBLIC_CONTENT_MISSING', 'metadata.dsfPages', 'Public release contains neither a valid v2 locator nor v1 pages.');
    }
    return deepFreeze({
        transportKind: 'webp-v1',
        schemaVersion: 1,
        pages: deepClone(metadata.dsfPages),
    });
}
