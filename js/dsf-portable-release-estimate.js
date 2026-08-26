/** Pure payload-size estimate for a portable DSF before font bytes are loaded. */

import { assertValidDsfDeliveryBundle } from './dsf-delivery-v2.js';
import { validateDsfProductionFontRegistry } from './dsf-font-registry.js';
import {
    DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION,
    serializeDsfReleaseJson,
} from './dsf-release-assembly.js';
import { deepClone } from './utils.js';

export const DSF_PORTABLE_RELEASE_ESTIMATE_VERSION = 1;

const MAX_RELEASE_BYTES = 10 * 1024 * 1024 * 1024;
const INPUT_KEYS = new Set(['assembly', 'fontRegistry']);

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

function canonicalizeJson(value) {
    if (Array.isArray(value)) return value.map(canonicalizeJson);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]));
}

function equalJson(left, right) {
    return JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right));
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}) {
    throw new DsfPortableReleaseEstimateError([createIssue(code, path, message, details)]);
}

function validateInput(input) {
    if (!isRecord(input)) {
        fail('PORTABLE_ESTIMATE_INPUT_INVALID', '', 'Portable release estimate requires an input object.');
    }
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) {
            fail('PORTABLE_ESTIMATE_PROPERTY_UNSUPPORTED', key, 'Portable release estimate contains an unsupported property.');
        }
    }
    const assembly = input.assembly;
    if (!isRecord(assembly)
        || assembly.schemaVersion !== DSF_RELEASE_ASSEMBLY_SCHEMA_VERSION
        || !isRecord(assembly.bundle)
        || !isRecord(assembly.files?.index)
        || !isRecord(assembly.releaseMetadata)
        || !isRecord(assembly.summary)) {
        fail('PORTABLE_ESTIMATE_ASSEMBLY_INVALID', 'assembly', 'A complete DSF v2 release assembly is required.');
    }
    try {
        assertValidDsfDeliveryBundle(assembly.bundle);
    } catch (error) {
        fail('PORTABLE_ESTIMATE_BUNDLE_INVALID', 'assembly.bundle', 'Source delivery bundle is invalid.', {
            validationIssues: deepClone(error?.issues || []),
        });
    }
    const registryValidation = validateDsfProductionFontRegistry(input.fontRegistry);
    if (!registryValidation.valid) {
        fail('PORTABLE_ESTIMATE_FONT_REGISTRY_INVALID', 'fontRegistry', 'Production font registry is invalid.', {
            validationIssues: deepClone(registryValidation.issues),
        });
    }
    if (!Number.isSafeInteger(assembly.files.index.byteLength)
        || assembly.files.index.byteLength < 1
        || !Number.isSafeInteger(assembly.releaseMetadata.dsfTotalBytes)
        || assembly.releaseMetadata.dsfTotalBytes < assembly.files.index.byteLength) {
        fail('PORTABLE_ESTIMATE_SOURCE_SIZE_INVALID', 'assembly.releaseMetadata.dsfTotalBytes', 'Source release byte metadata is invalid.');
    }
    const sourceIndexJson = serializeDsfReleaseJson(assembly.bundle.index);
    const sourceIndexByteLength = new TextEncoder().encode(sourceIndexJson).byteLength;
    const sourcePayloadBytes = sourceIndexByteLength
        + Object.values(assembly.files.manifests || {}).reduce((sum, file) => sum + Number(file?.byteLength || 0), 0)
        + (assembly.files.assets || []).reduce((sum, file) => sum + Number(file?.byteLength || 0), 0);
    if (assembly.files.index.json !== sourceIndexJson
        || assembly.files.index.byteLength !== sourceIndexByteLength
        || assembly.releaseMetadata.dsfTotalBytes !== sourcePayloadBytes
        || assembly.summary.totalBytes !== sourcePayloadBytes) {
        fail(
            'PORTABLE_ESTIMATE_ASSEMBLY_SIZE_MISMATCH',
            'assembly',
            'Source release assembly bytes are internally inconsistent.',
        );
    }
}

export class DsfPortableReleaseEstimateError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Portable DSF release size estimate failed.');
        this.name = 'DsfPortableReleaseEstimateError';
        this.code = 'DSF_PORTABLE_RELEASE_ESTIMATE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Calculate the exact payload-byte delta caused by embedded font declarations
 * and registry-certified WOFF2 lengths. No font is fetched and no ZIP is made.
 */
export function estimateDsfPortableReleaseSize(input = {}) {
    validateInput(input);
    const assembly = input.assembly;
    const sourceFonts = assembly.bundle.index.fonts || {};
    const portableFonts = {};
    const filesBySha256 = new Map();

    for (const [fontId, declaration] of Object.entries(sourceFonts)) {
        const registryEntry = input.fontRegistry.fonts?.[fontId];
        if (!registryEntry || !equalJson(declaration, registryEntry.declaration)) {
            fail(
                'PORTABLE_ESTIMATE_FONT_CERTIFICATE_MISMATCH',
                `assembly.bundle.index.fonts.${fontId}`,
                'Release font does not exactly match the production registry.',
                { fontId },
            );
        }
        if (declaration.source !== 'registry') {
            fail(
                'PORTABLE_ESTIMATE_SOURCE_NOT_HORIZON',
                `assembly.bundle.index.fonts.${fontId}.source`,
                'Source assembly must use the Horizon registry declaration.',
                { fontId },
            );
        }
        if (registryEntry.license.allowsPortableEmbedding !== true) {
            fail(
                'PORTABLE_ESTIMATE_FONT_EMBEDDING_FORBIDDEN',
                `fontRegistry.fonts.${fontId}.license.allowsPortableEmbedding`,
                'Font license review does not permit portable embedding.',
                { fontId },
            );
        }
        const { sha256 } = registryEntry.declaration;
        const { byteLength } = registryEntry.asset;
        const existing = filesBySha256.get(sha256);
        if (existing && existing.byteLength !== byteLength) {
            fail(
                'PORTABLE_ESTIMATE_FONT_HASH_CONFLICT',
                `fontRegistry.fonts.${fontId}.asset.byteLength`,
                'The same font hash cannot have conflicting byte lengths.',
                { fontId, sha256 },
            );
        }
        if (existing) existing.fontIds.push(fontId);
        else filesBySha256.set(sha256, { sha256, byteLength, fontIds: [fontId] });
        portableFonts[fontId] = {
            ...deepClone(declaration),
            source: 'embedded',
            href: `fonts/${sha256.toLowerCase()}.woff2`,
        };
    }

    const portableIndex = {
        ...deepClone(assembly.bundle.index),
        fonts: portableFonts,
    };
    const indexJson = serializeDsfReleaseJson(portableIndex);
    const indexByteLength = new TextEncoder().encode(indexJson).byteLength;
    const fontFiles = [...filesBySha256.values()];
    const fontByteLength = fontFiles.reduce((sum, file) => sum + file.byteLength, 0);
    const indexByteDelta = indexByteLength - assembly.files.index.byteLength;
    const totalBytes = assembly.releaseMetadata.dsfTotalBytes + indexByteDelta + fontByteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > MAX_RELEASE_BYTES) {
        fail('PORTABLE_ESTIMATE_TOTAL_SIZE_INVALID', 'summary.totalBytes', 'Portable release estimate exceeds the payload limit.');
    }

    return deepFreeze({
        estimateVersion: DSF_PORTABLE_RELEASE_ESTIMATE_VERSION,
        estimateKind: 'portable-payload',
        contentIndex: {
            json: indexJson,
            byteLength: indexByteLength,
        },
        fontFiles,
        summary: {
            embeddedFontCount: Object.keys(sourceFonts).length,
            fontFileCount: fontFiles.length,
            fontByteLength,
            indexByteDelta,
            sourceTotalBytes: assembly.releaseMetadata.dsfTotalBytes,
            additionalBytes: totalBytes - assembly.releaseMetadata.dsfTotalBytes,
            totalBytes,
        },
    });
}
