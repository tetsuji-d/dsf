/**
 * Convert one immutable Horizon release assembly into a self-contained DSF
 * download plan. The online assembly keeps shared registry URLs; the portable
 * assembly rewrites every used font to a content-addressed archive path and
 * carries the exact verified WOFF2 Blob required by the ZIP inventory.
 *
 * This module is pure apart from hashing and font-byte verification supplied
 * by the caller. It never downloads, uploads, or mutates the source assembly.
 */

import {
    DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
    serializeDsfReleaseJson,
} from './dsf-release-assembly.js';
import {
    assertValidDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import {
    validateDsfProductionFontRegistry,
} from './dsf-font-registry.js';
import {
    verifyDsfProductionFontAsset,
} from './dsf-font-asset-verification.js';
import { deepClone } from './utils.js';

export const DSF_PORTABLE_RELEASE_PLAN_SCHEMA_VERSION = 1;
export const DSF_PORTABLE_RELEASE_PLAN_FORMAT = 'dsf-portable-release-plan-1';

const INPUT_KEYS = new Set(['assembly', 'fontRegistry', 'fontAssets', 'hashBytes', 'cryptoRef']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

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

function fail(code, path, message, details = {}) {
    throw new DsfPortableReleaseError([createIssue(code, path, message, details)]);
}

function validateExactKeys(value, allowedKeys, path, issues) {
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            issues.push(createIssue(
                'PORTABLE_RELEASE_PROPERTY_UNSUPPORTED',
                path ? `${path}.${key}` : key,
                'Portable release input contains an unsupported property.',
            ));
        }
    }
}

function equalJson(left, right) {
    return serializeDsfReleaseJson(left) === serializeDsfReleaseJson(right);
}

async function hashExactBytes(hashBytes, bytes, path) {
    let sha256;
    try {
        sha256 = await hashBytes(bytes);
    } catch (error) {
        fail('PORTABLE_RELEASE_HASH_FAILED', path, 'SHA-256 calculation failed.', {
            cause: error?.message || String(error),
        });
    }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
        fail('PORTABLE_RELEASE_HASH_INVALID', path, 'SHA-256 function must return 64 hexadecimal characters.');
    }
    return sha256.toLowerCase();
}

function validateInput(input) {
    const issues = [];
    if (!isRecord(input)) {
        throw new DsfPortableReleaseError([
            createIssue('PORTABLE_RELEASE_INPUT_INVALID', '', 'Portable release input must be an object.'),
        ]);
    }
    validateExactKeys(input, INPUT_KEYS, '', issues);
    if (!isRecord(input.assembly)
        || input.assembly.schemaVersion !== DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION
        || !isRecord(input.assembly.bundle)
        || !isRecord(input.assembly.files?.index)
        || !isRecord(input.assembly.releaseMetadata)
        || !isRecord(input.assembly.summary)) {
        issues.push(createIssue('PORTABLE_RELEASE_ASSEMBLY_INVALID', 'assembly', 'A complete 9A-4A release assembly is required.'));
    } else {
        try {
            assertValidDsfDeliveryBundle(input.assembly.bundle);
        } catch (error) {
            issues.push(createIssue('PORTABLE_RELEASE_BUNDLE_INVALID', 'assembly.bundle', 'Source delivery bundle is invalid.', {
                validationIssues: deepClone(error?.issues || []),
            }));
        }
    }
    const registryValidation = validateDsfProductionFontRegistry(input.fontRegistry);
    if (!registryValidation.valid) {
        issues.push(createIssue('PORTABLE_RELEASE_FONT_REGISTRY_INVALID', 'fontRegistry', 'Production font registry is invalid.', {
            validationIssues: deepClone(registryValidation.issues),
        }));
    }
    if (!isRecord(input.fontAssets)) {
        issues.push(createIssue('PORTABLE_RELEASE_FONT_ASSETS_INVALID', 'fontAssets', 'fontAssets must be an exact font-ID map.'));
    }
    if (typeof input.hashBytes !== 'function') {
        issues.push(createIssue('PORTABLE_RELEASE_HASH_MISSING', 'hashBytes', 'Portable release planning requires a SHA-256 byte function.'));
    }
    if (issues.length) throw new DsfPortableReleaseError(issues);
}

function portableFontPath(sha256) {
    return `fonts/${sha256.toLowerCase()}.woff2`;
}

export class DsfPortableReleaseError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Invalid portable DSF release.');
        this.name = 'DsfPortableReleaseError';
        this.code = 'DSF_PORTABLE_RELEASE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Create the download-specific assembly and exact embedded font file plan.
 * All fonts declared by fixed-text pages are mandatory and deduplicated by
 * their verified SHA-256. Extra or externally referenced fonts fail closed.
 */
export async function createDsfPortableReleasePlan(input = {}) {
    validateInput(input);
    const sourceAssembly = input.assembly;
    const sourceFonts = sourceAssembly.bundle.index.fonts || {};
    const sourceFontIds = Object.keys(sourceFonts);
    const suppliedFontIds = Object.keys(input.fontAssets);
    for (const fontId of suppliedFontIds) {
        if (!hasOwn(sourceFonts, fontId)) {
            fail('PORTABLE_RELEASE_FONT_ASSET_UNEXPECTED', `fontAssets.${fontId}`, 'Font bytes are not referenced by this release.', { fontId });
        }
    }

    const portableAssembly = deepClone(sourceAssembly);
    const filesByPath = new Map();
    for (const fontId of sourceFontIds) {
        const declaration = sourceFonts[fontId];
        const registryEntry = input.fontRegistry.fonts?.[fontId];
        if (!registryEntry || !equalJson(declaration, registryEntry.declaration)) {
            fail('PORTABLE_RELEASE_FONT_CERTIFICATE_MISMATCH', `assembly.bundle.index.fonts.${fontId}`, 'Release font does not exactly match the production registry.', { fontId });
        }
        if (declaration.source !== 'registry') {
            fail('PORTABLE_RELEASE_SOURCE_NOT_HORIZON', `assembly.bundle.index.fonts.${fontId}.source`, 'Source assembly must use the Horizon registry font declaration.', { fontId });
        }
        if (registryEntry.license.allowsPortableEmbedding !== true) {
            fail('PORTABLE_RELEASE_FONT_EMBEDDING_FORBIDDEN', `fontRegistry.fonts.${fontId}.license.allowsPortableEmbedding`, 'Font license review does not permit portable embedding.', { fontId });
        }
        if (!hasOwn(input.fontAssets, fontId)) {
            fail('PORTABLE_RELEASE_FONT_ASSET_MISSING', `fontAssets.${fontId}`, 'Every referenced font must be embedded in the downloadable DSF.', { fontId });
        }

        let evidence;
        try {
            evidence = await verifyDsfProductionFontAsset({
                registry: input.fontRegistry,
                fontId,
                bytes: input.fontAssets[fontId],
                ...(input.cryptoRef ? { cryptoRef: input.cryptoRef } : {}),
            });
        } catch (error) {
            fail('PORTABLE_RELEASE_FONT_ASSET_INVALID', `fontAssets.${fontId}`, 'Portable font bytes failed production verification.', {
                fontId,
                causeCode: error?.code || null,
                cause: error?.message || String(error),
            });
        }
        const path = portableFontPath(evidence.sha256);
        portableAssembly.bundle.index.fonts[fontId] = {
            ...deepClone(declaration),
            source: 'embedded',
            href: path,
        };
        const existing = filesByPath.get(path);
        if (existing) {
            existing.fontIds.push(fontId);
        } else {
            filesByPath.set(path, {
                path,
                fontIds: [fontId],
                sha256: evidence.sha256,
                byteLength: evidence.byteLength,
                mimeType: 'font/woff2',
                blob: evidence.blob,
            });
        }
    }

    const fontAssets = [...filesByPath.values()];
    const indexJson = serializeDsfReleaseJson(portableAssembly.bundle.index);
    const indexBytes = new TextEncoder().encode(indexJson);
    const indexSha256 = await hashExactBytes(input.hashBytes, indexBytes, 'assembly.files.index');
    portableAssembly.files.index = {
        path: 'content.json',
        json: indexJson,
        byteLength: indexBytes.byteLength,
        sha256: indexSha256,
    };
    portableAssembly.files.fonts = fontAssets.map((asset) => ({
        path: asset.path,
        fontIds: [...asset.fontIds],
        sha256: asset.sha256,
        byteLength: asset.byteLength,
        mimeType: asset.mimeType,
    }));

    const previousIndexBytes = sourceAssembly.files.index.byteLength;
    const previousTotalBytes = sourceAssembly.releaseMetadata.dsfTotalBytes;
    const fontByteLength = fontAssets.reduce((sum, asset) => sum + asset.byteLength, 0);
    const totalBytes = previousTotalBytes - previousIndexBytes + indexBytes.byteLength + fontByteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
        fail('PORTABLE_RELEASE_SIZE_INVALID', 'assembly.releaseMetadata.dsfTotalBytes', 'Portable release size is invalid.');
    }
    portableAssembly.releaseMetadata.dsfContentHash = indexSha256;
    portableAssembly.releaseMetadata.dsfTotalBytes = totalBytes;
    portableAssembly.summary = {
        ...portableAssembly.summary,
        externalFontCount: 0,
        embeddedFontCount: sourceFontIds.length,
        fontFileCount: fontAssets.length,
        totalBytes,
    };

    try {
        assertValidDsfDeliveryBundle(portableAssembly.bundle);
    } catch (error) {
        fail('PORTABLE_RELEASE_BUNDLE_INVALID', 'assembly.bundle', 'Portable delivery bundle is invalid.', {
            validationIssues: deepClone(error?.issues || []),
        });
    }

    const result = {
        schemaVersion: DSF_PORTABLE_RELEASE_PLAN_SCHEMA_VERSION,
        format: DSF_PORTABLE_RELEASE_PLAN_FORMAT,
        assembly: portableAssembly,
        fontAssets,
        summary: {
            embeddedFontCount: sourceFontIds.length,
            fontFileCount: fontAssets.length,
            fontByteLength,
            totalBytes,
        },
    };
    return deepFreeze(result);
}
