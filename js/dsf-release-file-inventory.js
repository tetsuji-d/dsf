/**
 * Complete local file inventory for an uncompressed DSF delivery v2 release.
 *
 * This module binds 9A-4A canonical JSON to 9A-4B sealed WebP Blobs and adds
 * meta.json plus an archive manifest. It returns immutable in-memory files; it
 * does not create ZIP bytes, download, upload, or touch Press, Viewer, state,
 * Firebase, Firestore, or R2.
 */

import {
    DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
    serializeDsfReleaseJson,
} from './dsf-release-assembly.js';
import {
    DSF_RELEASE_BYTE_SEALING_VERSION,
    inspectDsfWebPBytes,
} from './dsf-release-byte-sealing.js';
import { inspectDsfWoff2Bytes } from './dsf-font-asset-verification.js';
import {
    DSF_DELIVERY_SCHEMA_VERSION,
    assertValidDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import {
    CANONICAL_PAGE_HEIGHT,
    CANONICAL_PAGE_WIDTH,
    META_PRESENTATION_ASPECT_RATIO,
} from './page-geometry.js';
import { deepClone } from './utils.js';

export const DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION = 1;
export const DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION = 1;
export const DSF_ARCHIVE_MANIFEST_FORMAT = 'dsf-archive-manifest-1';
export const DSF_CONTENT_MIMETYPE = 'application/vnd.dsf.content+zip';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const META_INPUT_KEYS = new Set([
    'projectId',
    'workId',
    'releaseId',
    'title',
    'author',
    'labelName',
    'rating',
    'license',
    'localizedMeta',
    'created',
    'modified',
    'generator',
    'spread',
]);
const LOCALIZED_META_KEYS = new Set(['title', 'author', 'description', 'linerNotes', 'copyright']);
const SEALED_ASSET_KEYS = new Set(['language', 'blockId', 'pageIndex', 'sealed']);
const PORTABLE_FONT_ASSET_KEYS = new Set(['path', 'fontIds', 'sha256', 'byteLength', 'mimeType', 'blob']);
const SPREAD_VALUES = new Set(['none', 'auto']);
const JSON_MIME_TYPE = 'application/json';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
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
    throw new DsfReleaseFileInventoryError([createIssue(code, path, message, details)]);
}

function exactString(value, maximumLength = 512, allowEmpty = false) {
    return typeof value === 'string'
        && (allowEmpty || !!value)
        && value === value.trim()
        && value.length <= maximumLength;
}

function validIsoDate(value) {
    if (typeof value !== 'string' || !value.endsWith('Z')) return false;
    const time = Date.parse(value);
    return Number.isFinite(time);
}

function validArchivePath(value) {
    return typeof value === 'string'
        && !!value
        && value === value.trim()
        && !value.startsWith('/')
        && !value.includes('\\')
        && !value.includes('//')
        && !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function toUtf8(value) {
    return new TextEncoder().encode(value);
}

function makeTextBlob(text, mimeType) {
    if (typeof Blob === 'undefined') {
        throwIssue('RELEASE_INVENTORY_BLOB_UNAVAILABLE', '', 'Blob is unavailable in this runtime.');
    }
    return new Blob([toUtf8(text)], { type: mimeType });
}

async function hashExactBytes(hashBytes, bytes, path) {
    let sha256;
    try {
        sha256 = await hashBytes(bytes);
    } catch (error) {
        throwIssue('RELEASE_INVENTORY_HASH_FAILED', path, 'SHA-256 calculation failed.', {
            cause: error?.message || String(error),
        });
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
        throwIssue('RELEASE_INVENTORY_HASH_INVALID', path, 'SHA-256 function returned an unsupported digest.');
    }
    return sha256.toLowerCase();
}

function validateExactKeys(value, allowedKeys, path, issues) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            issues.push(createIssue(
                'RELEASE_INVENTORY_PROPERTY_UNSUPPORTED',
                path ? `${path}.${key}` : key,
                'File inventory input contains an unsupported property.',
            ));
        }
    }
}

function validateLocalizedMeta(localizedMeta, languages, issues) {
    if (!isRecord(localizedMeta)) {
        issues.push(createIssue('RELEASE_META_LOCALIZED_INVALID', 'metadata.localizedMeta', 'localizedMeta must be an exact-key language map.'));
        return;
    }
    const languageSet = new Set(languages);
    for (const [language, entry] of Object.entries(localizedMeta)) {
        const path = `metadata.localizedMeta.${language}`;
        if (!languageSet.has(language)) {
            issues.push(createIssue('RELEASE_META_LANGUAGE_UNEXPECTED', path, 'Localized metadata language is not in the release.'));
        }
        if (!isRecord(entry)) {
            issues.push(createIssue('RELEASE_META_LOCALIZED_ENTRY_INVALID', path, 'Localized metadata entry must be an object.'));
            continue;
        }
        validateExactKeys(entry, LOCALIZED_META_KEYS, path, issues);
        for (const [key, value] of Object.entries(entry)) {
            const limit = key === 'description' || key === 'linerNotes' ? 100_000 : 2_048;
            if (typeof value !== 'string' || value.length > limit) {
                issues.push(createIssue('RELEASE_META_LOCALIZED_VALUE_INVALID', `${path}.${key}`, 'Localized metadata value is invalid.'));
            }
        }
    }
}

function validateMetadataInput(metadata, assembly, issues) {
    if (!isRecord(metadata)) {
        issues.push(createIssue('RELEASE_METADATA_INVALID', 'metadata', 'Release metadata input must be an object.'));
        return;
    }
    validateExactKeys(metadata, META_INPUT_KEYS, 'metadata', issues);
    if (metadata.projectId !== undefined && !exactString(metadata.projectId, 256, true)) {
        issues.push(createIssue('RELEASE_META_ID_INVALID', 'metadata.projectId', 'projectId is invalid.'));
    }
    for (const key of ['workId', 'releaseId']) {
        if (!exactString(metadata[key], 256)) {
            issues.push(createIssue('RELEASE_META_ID_INVALID', `metadata.${key}`, `${key} must be a stable non-empty ID.`));
        }
    }
    for (const key of ['title', 'author']) {
        if (!exactString(metadata[key], 2_048)) {
            issues.push(createIssue('RELEASE_META_TEXT_INVALID', `metadata.${key}`, `${key} must be a non-empty trimmed string.`));
        }
    }
    if (metadata.labelName !== undefined && !exactString(metadata.labelName, 2_048, true)) {
        issues.push(createIssue('RELEASE_META_TEXT_INVALID', 'metadata.labelName', 'labelName is invalid.'));
    }
    for (const key of ['rating', 'license']) {
        if (metadata[key] !== undefined && !exactString(metadata[key], 256)) {
            issues.push(createIssue('RELEASE_META_TEXT_INVALID', `metadata.${key}`, `${key} is invalid.`));
        }
    }
    if (metadata.generator !== undefined && !exactString(metadata.generator, 256)) {
        issues.push(createIssue('RELEASE_META_TEXT_INVALID', 'metadata.generator', 'generator is invalid.'));
    }
    if (metadata.spread !== undefined && !SPREAD_VALUES.has(metadata.spread)) {
        issues.push(createIssue('RELEASE_META_SPREAD_INVALID', 'metadata.spread', 'spread must be none or auto.'));
    }
    if (!validIsoDate(metadata.created)) {
        issues.push(createIssue('RELEASE_META_DATE_INVALID', 'metadata.created', 'created must be an ISO date ending in Z.'));
    }
    if (!validIsoDate(metadata.modified)) {
        issues.push(createIssue('RELEASE_META_DATE_INVALID', 'metadata.modified', 'modified must be an ISO date ending in Z.'));
    }
    if (validIsoDate(metadata.created) && validIsoDate(metadata.modified)
        && Date.parse(metadata.modified) < Date.parse(metadata.created)) {
        issues.push(createIssue('RELEASE_META_DATE_ORDER_INVALID', 'metadata.modified', 'modified cannot precede created.'));
    }
    validateLocalizedMeta(metadata.localizedMeta ?? {}, assembly.releaseMetadata?.dsfLangs || [], issues);
}

function validateAssemblyShape(assembly, issues) {
    if (!isRecord(assembly) || assembly.schemaVersion !== DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION) {
        issues.push(createIssue('RELEASE_ASSEMBLY_INVALID', 'assembly', 'A 9A-4A release assembly is required.'));
        return;
    }
    try {
        assertValidDsfDeliveryBundle(assembly.bundle);
    } catch (error) {
        issues.push(createIssue('RELEASE_ASSEMBLY_BUNDLE_INVALID', 'assembly.bundle', 'Release assembly bundle is invalid.', {
            validationIssues: deepClone(error?.issues || []),
        }));
    }
    if (!isRecord(assembly.files?.index)
        || !isRecord(assembly.files?.manifests)
        || !Array.isArray(assembly.files?.assets)) {
        issues.push(createIssue('RELEASE_ASSEMBLY_FILES_INVALID', 'assembly.files', 'Release assembly file plan is incomplete.'));
    }
    if (!isRecord(assembly.releaseMetadata)
        || !Array.isArray(assembly.releaseMetadata.dsfLangs)
        || !isRecord(assembly.releaseMetadata.dsfPageCounts)) {
        issues.push(createIssue('RELEASE_ASSEMBLY_METADATA_INVALID', 'assembly.releaseMetadata', 'Release assembly metadata draft is invalid.'));
        return;
    }
    const bundleLanguages = isRecord(assembly.bundle?.index?.languages)
        ? Object.keys(assembly.bundle.index.languages)
        : [];
    const plannedManifestLanguages = isRecord(assembly.files?.manifests)
        ? Object.keys(assembly.files.manifests)
        : [];
    if (assembly.releaseMetadata.dsfSchemaVersion !== DSF_DELIVERY_SCHEMA_VERSION
        || assembly.releaseMetadata.dsfLangs.length !== bundleLanguages.length
        || assembly.releaseMetadata.dsfLangs.some((language, index) => language !== bundleLanguages[index])) {
        issues.push(createIssue('RELEASE_ASSEMBLY_METADATA_MISMATCH', 'assembly.releaseMetadata.dsfLangs', 'Release language metadata does not match the content index.'));
    }
    if (plannedManifestLanguages.length !== bundleLanguages.length
        || plannedManifestLanguages.some((language, index) => language !== bundleLanguages[index])) {
        issues.push(createIssue('RELEASE_ASSEMBLY_FILES_MISMATCH', 'assembly.files.manifests', 'Language file plan does not exactly match the content index.'));
    }
    for (const language of bundleLanguages) {
        if (assembly.releaseMetadata.dsfPageCounts[language] !== assembly.bundle?.manifests?.[language]?.pages?.length) {
            issues.push(createIssue('RELEASE_ASSEMBLY_METADATA_MISMATCH', `assembly.releaseMetadata.dsfPageCounts.${language}`, 'Release page count metadata does not match its manifest.'));
        }
    }
    if (Object.keys(assembly.releaseMetadata.dsfPageCounts).length !== bundleLanguages.length) {
        issues.push(createIssue('RELEASE_ASSEMBLY_METADATA_MISMATCH', 'assembly.releaseMetadata.dsfPageCounts', 'Release page count metadata contains unexpected languages.'));
    }

    const assetPlanByKey = new Map();
    for (const [assetIndex, asset] of (assembly.files?.assets || []).entries()) {
        const path = `assembly.files.assets[${assetIndex}]`;
        if (!isRecord(asset)) {
            issues.push(createIssue('RELEASE_ASSEMBLY_ASSET_INVALID', path, 'Release asset plan entry must be an object.'));
            continue;
        }
        const key = assetKey(asset.language, asset.blockId, asset.pageIndex);
        if (assetPlanByKey.has(key)) {
            issues.push(createIssue('RELEASE_ASSEMBLY_ASSET_DUPLICATE', path, 'Release asset plan entry is duplicated.', {
                firstPath: assetPlanByKey.get(key).path,
            }));
        } else {
            assetPlanByKey.set(key, { asset, path });
        }
        const page = assembly.bundle?.manifests?.[asset.language]?.pages?.[asset.pageIndex];
        if (page?.renderKind !== 'image'
            || page.sourceAnchor?.kind !== 'fixed'
            || page.sourceAnchor.blockId !== asset.blockId
            || page.image?.href !== `../${asset.path}`
            || page.image?.width !== asset.width
            || page.image?.height !== asset.height
            || page.image?.mimeType !== asset.mimeType) {
            issues.push(createIssue('RELEASE_ASSEMBLY_ASSET_PAGE_MISMATCH', path, 'Release asset plan does not match its image page.'));
        }
    }
    for (const language of bundleLanguages) {
        for (const [pageIndex, page] of (assembly.bundle?.manifests?.[language]?.pages || []).entries()) {
            if (page?.renderKind !== 'image') continue;
            const key = assetKey(language, page.sourceAnchor?.blockId, pageIndex);
            if (!assetPlanByKey.has(key)) {
                issues.push(createIssue('RELEASE_ASSEMBLY_ASSET_MISSING', `assembly.bundle.manifests.${language}.pages[${pageIndex}]`, 'Image page is missing from the release asset plan.'));
            }
        }
    }
}

function assetKey(language, blockId, pageIndex) {
    return `${language}\u0000${blockId}\u0000${pageIndex}`;
}

function validateSealedAssetInputs(sealedAssets, assembly, issues) {
    if (!Array.isArray(sealedAssets)) {
        issues.push(createIssue('RELEASE_SEALED_ASSETS_INVALID', 'sealedAssets', 'sealedAssets must be an array.'));
        return;
    }
    const expectedAssets = Array.isArray(assembly.files?.assets) ? assembly.files.assets : [];
    const expectedByKey = new Map(expectedAssets.map((asset) => [
        assetKey(asset.language, asset.blockId, asset.pageIndex),
        asset,
    ]));
    const seenKeys = new Map();
    sealedAssets.forEach((entry, index) => {
        const path = `sealedAssets[${index}]`;
        if (!isRecord(entry)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_INVALID', path, 'Sealed asset binding must be an object.'));
            return;
        }
        validateExactKeys(entry, SEALED_ASSET_KEYS, path, issues);
        if (!exactString(entry.language, 256) || !exactString(entry.blockId, 256)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_KEY_INVALID', path, 'Sealed asset language and blockId must be exact non-empty keys.'));
        }
        if (!Number.isInteger(entry.pageIndex) || entry.pageIndex < 0) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_KEY_INVALID', `${path}.pageIndex`, 'Sealed asset pageIndex must be a non-negative integer.'));
        }
        const key = assetKey(entry.language, entry.blockId, entry.pageIndex);
        if (seenKeys.has(key)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_DUPLICATE', path, 'Sealed asset binding is duplicated.', {
                firstPath: seenKeys.get(key),
            }));
        } else {
            seenKeys.set(key, path);
        }
        if (!expectedByKey.has(key)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_UNEXPECTED', path, 'Sealed asset does not match the release asset plan.'));
        }
        if (!isRecord(entry.sealed)
            || entry.sealed.sealingVersion !== DSF_RELEASE_BYTE_SEALING_VERSION
            || !isRecord(entry.sealed.descriptor)
            || !isRecord(entry.sealed.inspection)
            || !(typeof Blob !== 'undefined' && entry.sealed.blob instanceof Blob)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_INVALID', `${path}.sealed`, 'A complete 9A-4B sealed asset is required.'));
        }
    });
    for (const [key, asset] of expectedByKey.entries()) {
        if (!seenKeys.has(key)) {
            issues.push(createIssue('RELEASE_SEALED_ASSET_MISSING', 'sealedAssets', 'Release asset plan is missing its sealed Blob.', {
                language: asset.language,
                blockId: asset.blockId,
                pageIndex: asset.pageIndex,
            }));
        }
    }
}

function validatePortableFontInputs(portableFontAssets, assembly, issues) {
    if (!Array.isArray(portableFontAssets)) {
        issues.push(createIssue('RELEASE_PORTABLE_FONT_ASSETS_INVALID', 'portableFontAssets', 'portableFontAssets must be an array.'));
        return;
    }
    const declarations = isRecord(assembly.bundle?.index?.fonts) ? assembly.bundle.index.fonts : {};
    const embeddedFontIds = Object.entries(declarations)
        .filter(([, declaration]) => declaration?.source === 'embedded')
        .map(([fontId]) => fontId);
    const externalFontIds = Object.entries(declarations)
        .filter(([, declaration]) => declaration?.source !== 'embedded')
        .map(([fontId]) => fontId);
    if (externalFontIds.length) {
        issues.push(createIssue(
            'RELEASE_PORTABLE_FONT_SOURCE_REQUIRED',
            'assembly.bundle.index.fonts',
            'A downloadable DSF cannot depend on registry or CDN fonts.',
            { fontIds: externalFontIds },
        ));
    }

    const seenPaths = new Map();
    const seenFontIds = new Map();
    portableFontAssets.forEach((asset, index) => {
        const path = `portableFontAssets[${index}]`;
        if (!isRecord(asset)) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_ASSET_INVALID', path, 'Portable font asset must be an object.'));
            return;
        }
        validateExactKeys(asset, PORTABLE_FONT_ASSET_KEYS, path, issues);
        if (!validArchivePath(asset.path)
            || !asset.path.startsWith('fonts/')
            || !asset.path.toLowerCase().endsWith('.woff2')) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_PATH_INVALID', `${path}.path`, 'Portable font path must be fonts/*.woff2.'));
        }
        if (seenPaths.has(asset.path)) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_PATH_DUPLICATE', `${path}.path`, 'Portable font path is duplicated.', {
                firstPath: seenPaths.get(asset.path),
            }));
        } else {
            seenPaths.set(asset.path, `${path}.path`);
        }
        if (!Array.isArray(asset.fontIds) || asset.fontIds.length < 1) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_IDS_INVALID', `${path}.fontIds`, 'Portable font asset must declare at least one font ID.'));
        } else {
            asset.fontIds.forEach((fontId, fontIndex) => {
                const fontPath = `${path}.fontIds[${fontIndex}]`;
                if (!exactString(fontId, 256)) {
                    issues.push(createIssue('RELEASE_PORTABLE_FONT_ID_INVALID', fontPath, 'Portable font ID is invalid.'));
                    return;
                }
                if (seenFontIds.has(fontId)) {
                    issues.push(createIssue('RELEASE_PORTABLE_FONT_ID_DUPLICATE', fontPath, 'Portable font ID is bound more than once.', {
                        firstPath: seenFontIds.get(fontId),
                    }));
                } else {
                    seenFontIds.set(fontId, fontPath);
                }
                const declaration = declarations[fontId];
                if (!declaration || declaration.source !== 'embedded') {
                    issues.push(createIssue('RELEASE_PORTABLE_FONT_UNEXPECTED', fontPath, 'Portable font is not declared as embedded by content.json.', { fontId }));
                } else if (declaration.href !== asset.path
                    || String(declaration.sha256 || '').toLowerCase() !== String(asset.sha256 || '').toLowerCase()) {
                    issues.push(createIssue('RELEASE_PORTABLE_FONT_DECLARATION_MISMATCH', fontPath, 'Portable font asset does not match its content.json declaration.', { fontId }));
                }
            });
        }
        if (asset.mimeType !== 'font/woff2'
            || !Number.isSafeInteger(asset.byteLength)
            || asset.byteLength < 48
            || typeof asset.sha256 !== 'string'
            || !SHA256_PATTERN.test(asset.sha256)
            || !(typeof Blob !== 'undefined' && asset.blob instanceof Blob)) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_ASSET_INVALID', path, 'Portable font descriptor or Blob is invalid.'));
        }
    });
    for (const fontId of embeddedFontIds) {
        if (!seenFontIds.has(fontId)) {
            issues.push(createIssue('RELEASE_PORTABLE_FONT_MISSING', 'portableFontAssets', 'Embedded font declaration is missing its exact WOFF2 Blob.', { fontId }));
        }
    }
}

function validateInventoryInput(input) {
    const issues = [];
    if (!isRecord(input)) {
        throw new DsfReleaseFileInventoryError([
            createIssue('RELEASE_INVENTORY_INPUT_INVALID', '', 'Release file inventory input must be an object.'),
        ]);
    }
    const allowedKeys = new Set(['assembly', 'sealedAssets', 'portableFontAssets', 'metadata', 'hashBytes']);
    validateExactKeys(input, allowedKeys, '', issues);
    if (typeof input.hashBytes !== 'function') {
        issues.push(createIssue('RELEASE_INVENTORY_HASH_MISSING', 'hashBytes', 'File inventory requires a SHA-256 byte function.'));
    }
    validateAssemblyShape(input.assembly, issues);
    validateMetadataInput(input.metadata, input.assembly || {}, issues);
    validateSealedAssetInputs(input.sealedAssets, input.assembly || {}, issues);
    validatePortableFontInputs(input.portableFontAssets ?? [], input.assembly || {}, issues);
    if (issues.length) throw new DsfReleaseFileInventoryError(issues);
}

function buildMeta(metadata, assembly) {
    const localizedMeta = deepClone(metadata.localizedMeta || {});
    const linerNotes = Object.fromEntries(Object.entries(localizedMeta)
        .filter(([, entry]) => typeof entry?.linerNotes === 'string' && entry.linerNotes)
        .map(([language, entry]) => [language, entry.linerNotes]));
    return {
        version: '1.0.0',
        schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
        format: 'dsf',
        projectId: metadata.projectId || '',
        workId: metadata.workId,
        releaseId: metadata.releaseId,
        title: metadata.title,
        author: metadata.author,
        labelName: metadata.labelName || '',
        rating: metadata.rating || 'all',
        license: metadata.license || 'all-rights-reserved',
        meta: localizedMeta,
        linerNotes,
        languages: [...assembly.releaseMetadata.dsfLangs],
        defaultLang: assembly.bundle.index.defaultLang,
        created: metadata.created,
        modified: metadata.modified,
        generator: metadata.generator || 'DSF Studio v1.2',
        presentation: {
            orientation: 'portrait',
            aspectRatio: META_PRESENTATION_ASPECT_RATIO,
            spread: metadata.spread || 'auto',
            canonicalLogicalWidth: CANONICAL_PAGE_WIDTH,
            canonicalLogicalHeight: CANONICAL_PAGE_HEIGHT,
        },
    };
}

async function createTextFile({ path, text, mimeType, hashBytes, role }) {
    if (!validArchivePath(path)) throwIssue('RELEASE_INVENTORY_PATH_INVALID', path, 'Archive path is invalid.');
    const bytes = toUtf8(text);
    const sha256 = await hashExactBytes(hashBytes, bytes, path);
    return {
        path,
        role,
        mimeType,
        byteLength: bytes.byteLength,
        sha256,
        blob: makeTextBlob(text, mimeType),
    };
}

async function verifyAssemblyJsonFile({ plannedFile, value, expectedPath, hashBytes, role }) {
    const json = serializeDsfReleaseJson(value);
    if (plannedFile.path !== expectedPath || plannedFile.json !== json) {
        throwIssue('RELEASE_ASSEMBLY_JSON_MISMATCH', plannedFile.path || expectedPath, 'Assembly JSON or path was changed after hashing.');
    }
    const file = await createTextFile({
        path: expectedPath,
        text: json,
        mimeType: JSON_MIME_TYPE,
        hashBytes,
        role,
    });
    if (plannedFile.byteLength !== file.byteLength
        || typeof plannedFile.sha256 !== 'string'
        || plannedFile.sha256.toLowerCase() !== file.sha256) {
        throwIssue('RELEASE_ASSEMBLY_JSON_HASH_MISMATCH', expectedPath, 'Assembly JSON byteLength or hash does not match exact bytes.');
    }
    return file;
}

function compareAssetDescriptor(actual, expected, path) {
    for (const key of ['sha256', 'byteLength', 'width', 'height', 'mimeType']) {
        const actualValue = key === 'sha256' ? String(actual?.[key] || '').toLowerCase() : actual?.[key];
        const expectedValue = key === 'sha256' ? String(expected?.[key] || '').toLowerCase() : expected?.[key];
        if (actualValue !== expectedValue) {
            throwIssue('RELEASE_SEALED_ASSET_DESCRIPTOR_MISMATCH', `${path}.${key}`, 'Sealed descriptor does not match the release asset plan.');
        }
    }
}

async function verifySealedAsset(binding, plannedAsset, hashBytes, path) {
    const sealed = binding.sealed;
    compareAssetDescriptor(sealed.descriptor, plannedAsset, `${path}.sealed.descriptor`);
    if (sealed.blob.type !== 'image/webp' || sealed.blob.size !== plannedAsset.byteLength) {
        throwIssue('RELEASE_SEALED_ASSET_BLOB_MISMATCH', `${path}.sealed.blob`, 'Sealed Blob does not match the release asset plan.');
    }
    const bytes = new Uint8Array(await sealed.blob.arrayBuffer());
    const inspection = await inspectDsfWebPBytes(bytes);
    if (inspection.width !== plannedAsset.width
        || inspection.height !== plannedAsset.height
        || inspection.byteLength !== plannedAsset.byteLength) {
        throwIssue('RELEASE_SEALED_ASSET_INSPECTION_MISMATCH', `${path}.sealed.inspection`, 'Actual WebP bytes do not match the release asset plan.');
    }
    if (serializeDsfReleaseJson(inspection) !== serializeDsfReleaseJson(sealed.inspection)) {
        throwIssue('RELEASE_SEALED_ASSET_INSPECTION_MISMATCH', `${path}.sealed.inspection`, 'Stored WebP inspection does not match actual bytes.');
    }
    const sha256 = await hashExactBytes(hashBytes, bytes, plannedAsset.path);
    if (typeof plannedAsset.sha256 !== 'string' || sha256 !== plannedAsset.sha256.toLowerCase()) {
        throwIssue('RELEASE_SEALED_ASSET_HASH_MISMATCH', `${path}.sealed.blob`, 'Actual WebP bytes do not match the planned SHA-256.');
    }
    if (!validArchivePath(plannedAsset.path)) {
        throwIssue('RELEASE_INVENTORY_PATH_INVALID', plannedAsset.path, 'Planned asset path is invalid.');
    }
    return {
        path: plannedAsset.path,
        role: 'image',
        mimeType: 'image/webp',
        byteLength: bytes.byteLength,
        sha256,
        blob: sealed.blob,
        language: plannedAsset.language,
        blockId: plannedAsset.blockId,
        pageIndex: plannedAsset.pageIndex,
    };
}

async function verifyPortableFontAsset(asset, hashBytes, path) {
    if (asset.blob.type !== 'font/woff2' || asset.blob.size !== asset.byteLength) {
        throwIssue('RELEASE_PORTABLE_FONT_BLOB_MISMATCH', `${path}.blob`, 'Portable font Blob does not match its descriptor.');
    }
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    let inspection;
    try {
        inspection = await inspectDsfWoff2Bytes(bytes);
    } catch (error) {
        throwIssue('RELEASE_PORTABLE_FONT_WOFF2_INVALID', `${path}.blob`, 'Portable font is not a structurally valid WOFF2 file.', {
            causeCode: error?.code || null,
            cause: error?.message || String(error),
        });
    }
    if (inspection.byteLength !== asset.byteLength) {
        throwIssue('RELEASE_PORTABLE_FONT_BLOB_MISMATCH', `${path}.blob`, 'Portable font byte length changed after planning.');
    }
    const sha256 = await hashExactBytes(hashBytes, bytes, asset.path);
    if (sha256 !== asset.sha256.toLowerCase()) {
        throwIssue('RELEASE_PORTABLE_FONT_HASH_MISMATCH', `${path}.blob`, 'Portable font bytes do not match the planned SHA-256.');
    }
    return {
        path: asset.path,
        role: 'font',
        mimeType: 'font/woff2',
        byteLength: bytes.byteLength,
        sha256,
        blob: asset.blob,
    };
}

function validateUniqueFiles(files) {
    const seen = new Map();
    files.forEach((file, index) => {
        if (seen.has(file.path)) {
            throwIssue('RELEASE_INVENTORY_PATH_DUPLICATE', `files[${index}].path`, 'Archive file path is duplicated.', {
                firstPath: seen.get(file.path),
            });
        }
        seen.set(file.path, `files[${index}].path`);
    });
}

export class DsfReleaseFileInventoryError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid DSF release file inventory.');
        this.name = 'DsfReleaseFileInventoryError';
        this.code = 'DSF_RELEASE_FILE_INVENTORY_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/** Build every local release file as an immutable Blob without creating ZIP. */
export async function createDsfReleaseFileInventory(input = {}) {
    validateInventoryInput(input);
    const { assembly, metadata, hashBytes } = input;

    const mimetypeFile = await createTextFile({
        path: 'mimetype',
        text: DSF_CONTENT_MIMETYPE,
        mimeType: 'text/plain',
        hashBytes,
        role: 'mimetype',
    });
    const meta = buildMeta(metadata, assembly);
    const metaFile = await createTextFile({
        path: 'meta.json',
        text: serializeDsfReleaseJson(meta),
        mimeType: JSON_MIME_TYPE,
        hashBytes,
        role: 'metadata',
    });
    const contentFile = await verifyAssemblyJsonFile({
        plannedFile: assembly.files.index,
        value: assembly.bundle.index,
        expectedPath: 'content.json',
        hashBytes,
        role: 'content-index',
    });

    const manifestFiles = [];
    for (const language of assembly.releaseMetadata.dsfLangs) {
        const planned = assembly.files.manifests[language];
        const descriptor = assembly.bundle.index.languages[language];
        if (!isRecord(planned) || !isRecord(descriptor) || descriptor.href !== planned.path) {
            throwIssue('RELEASE_ASSEMBLY_LANGUAGE_FILE_MISSING', `assembly.files.manifests.${language}`, 'Language manifest file plan is missing or inconsistent.');
        }
        manifestFiles.push(await verifyAssemblyJsonFile({
            plannedFile: planned,
            value: assembly.bundle.manifests[language],
            expectedPath: descriptor.href,
            hashBytes,
            role: 'language-manifest',
        }));
    }

    const fontFiles = [];
    for (const [index, asset] of (input.portableFontAssets || []).entries()) {
        fontFiles.push(await verifyPortableFontAsset(asset, hashBytes, `portableFontAssets[${index}]`));
    }

    const bindingByKey = new Map(input.sealedAssets.map((binding, index) => [
        assetKey(binding.language, binding.blockId, binding.pageIndex),
        { binding, index },
    ]));
    const assetFiles = [];
    for (const plannedAsset of assembly.files.assets) {
        const matched = bindingByKey.get(assetKey(plannedAsset.language, plannedAsset.blockId, plannedAsset.pageIndex));
        assetFiles.push(await verifySealedAsset(
            matched.binding,
            plannedAsset,
            hashBytes,
            `sealedAssets[${matched.index}]`,
        ));
    }

    if (assembly.releaseMetadata.dsfContentHash !== contentFile.sha256) {
        throwIssue('RELEASE_ASSEMBLY_METADATA_MISMATCH', 'assembly.releaseMetadata.dsfContentHash', 'Release content hash metadata does not match content.json.');
    }
    const assemblyPayloadBytes = contentFile.byteLength
        + manifestFiles.reduce((sum, file) => sum + file.byteLength, 0)
        + fontFiles.reduce((sum, file) => sum + file.byteLength, 0)
        + assetFiles.reduce((sum, file) => sum + file.byteLength, 0);
    if (assembly.releaseMetadata.dsfTotalBytes !== assemblyPayloadBytes) {
        throwIssue('RELEASE_ASSEMBLY_METADATA_MISMATCH', 'assembly.releaseMetadata.dsfTotalBytes', 'Release byte metadata does not match the assembled content payload.');
    }

    const payloadFiles = [mimetypeFile, metaFile, contentFile, ...manifestFiles, ...fontFiles, ...assetFiles];
    validateUniqueFiles(payloadFiles);
    const archiveManifest = {
        schemaVersion: DSF_ARCHIVE_MANIFEST_SCHEMA_VERSION,
        format: DSF_ARCHIVE_MANIFEST_FORMAT,
        rootContent: 'content.json',
        self: {
            path: 'manifest.json',
            integrity: 'external-inventory',
        },
        files: payloadFiles.map((file) => ({
            path: file.path,
            mimeType: file.mimeType,
            byteLength: file.byteLength,
            sha256: file.sha256,
        })),
        fileCount: payloadFiles.length,
        payloadByteLength: payloadFiles.reduce((sum, file) => sum + file.byteLength, 0),
    };
    const archiveManifestFile = await createTextFile({
        path: 'manifest.json',
        text: serializeDsfReleaseJson(archiveManifest),
        mimeType: JSON_MIME_TYPE,
        hashBytes,
        role: 'archive-manifest',
    });
    const files = [mimetypeFile, archiveManifestFile, metaFile, contentFile, ...manifestFiles, ...fontFiles, ...assetFiles];
    validateUniqueFiles(files);
    const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0);
    const result = {
        schemaVersion: DSF_RELEASE_FILE_INVENTORY_SCHEMA_VERSION,
        meta,
        archiveManifest,
        files,
        releaseMetadata: {
            ...deepClone(assembly.releaseMetadata),
            dsfTotalBytes: totalBytes,
        },
        integrity: {
            archiveManifestSha256: archiveManifestFile.sha256,
            contentSha256: contentFile.sha256,
        },
        summary: {
            fileCount: files.length,
            payloadFileCount: payloadFiles.length,
            imageFileCount: assetFiles.length,
            fontFileCount: fontFiles.length,
            jsonFileCount: 3 + manifestFiles.length,
            totalBytes,
        },
    };
    return deepFreeze(result);
}
