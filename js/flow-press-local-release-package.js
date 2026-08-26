/** 9A-6C-B exact local-only portable DSF package verification. */

import { verifyDsfProductionFontAsset } from './dsf-font-asset-verification.js';
import { DSF_PRODUCTION_FONT_REGISTRY, validateDsfProductionFontRegistry } from './dsf-font-registry.js';
import { createDsfPortableReleasePlan } from './dsf-portable-release.js';
import { createDsfWebCryptoSha256 } from './dsf-release-byte-sealing.js';
import { createDsfReleaseFileInventory } from './dsf-release-file-inventory.js';
import { createDsfReleaseZipPackage } from './dsf-release-zip-package.js';
import { FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION } from './flow-press-local-release-planning.js';

export const FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION = 1;

const INPUT_KEYS = new Set([
    'planning',
    'sealedAssets',
    'metadata',
    'fontRegistry',
    'fetchImpl',
    'hashBytes',
    'cryptoRef',
    'signal',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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
    throw new FlowPressLocalReleasePackageError([createIssue(code, path, message, details)]);
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Flow local release package verification was cancelled.');
    error.name = 'AbortError';
    error.code = 'FLOW_LOCAL_RELEASE_PACKAGE_ABORTED';
    throw error;
}

function validateInput(input) {
    if (!isRecord(input)) {
        fail('FLOW_LOCAL_PACKAGE_INPUT_INVALID', '', 'Local Flow package verification requires an input object.');
    }
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) {
            fail('FLOW_LOCAL_PACKAGE_PROPERTY_UNSUPPORTED', key, 'Local Flow package input contains an unsupported property.');
        }
    }
    if (!isRecord(input.planning)
        || input.planning.planningVersion !== FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION
        || input.planning.planningKind !== 'local-only'
        || input.planning.ready !== true
        || !isRecord(input.planning.assembly)) {
        fail('FLOW_LOCAL_PACKAGE_PLANNING_NOT_READY', 'planning', 'A successful 9A-6C-A local release planning result is required.');
    }
    if (!Array.isArray(input.sealedAssets)) {
        fail('FLOW_LOCAL_PACKAGE_SEALED_ASSETS_INVALID', 'sealedAssets', 'sealedAssets must be an explicit array.');
    }
    if (!isRecord(input.metadata)) {
        fail('FLOW_LOCAL_PACKAGE_METADATA_INVALID', 'metadata', 'Local package metadata is required.');
    }
    const registryValidation = validateDsfProductionFontRegistry(input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY);
    if (!registryValidation.valid) {
        fail('FLOW_LOCAL_PACKAGE_FONT_REGISTRY_INVALID', 'fontRegistry', 'Production font registry is invalid.', {
            validationIssues: registryValidation.issues,
        });
    }
    const fetchImpl = input.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        fail('FLOW_LOCAL_PACKAGE_FONT_FETCH_UNAVAILABLE', 'fetchImpl', 'Fetch is unavailable for portable font verification.');
    }
    if (input.hashBytes !== undefined && typeof input.hashBytes !== 'function') {
        fail('FLOW_LOCAL_PACKAGE_HASH_INVALID', 'hashBytes', 'hashBytes must be a function when supplied.');
    }
}

async function fetchVerifiedFontAssets({ assembly, registry, fetchImpl, cryptoRef, signal }) {
    const fontAssets = {};
    for (const fontId of Object.keys(assembly.bundle.index.fonts || {})) {
        throwIfAborted(signal);
        const entry = registry.fonts?.[fontId];
        if (!entry) {
            fail('FLOW_LOCAL_PACKAGE_FONT_NOT_CERTIFIED', `fontRegistry.fonts.${fontId}`, 'Release font is absent from the production registry.', { fontId });
        }
        let response;
        try {
            response = await fetchImpl(entry.declaration.href, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                cache: 'force-cache',
                redirect: 'error',
                signal,
            });
        } catch (cause) {
            if (cause?.name === 'AbortError') throw cause;
            fail('FLOW_LOCAL_PACKAGE_FONT_FETCH_FAILED', `fontAssets.${fontId}`, 'Production font asset request failed.', {
                fontId,
                cause: cause?.message || String(cause),
            });
        }
        if (!response?.ok || typeof response.arrayBuffer !== 'function') {
            fail('FLOW_LOCAL_PACKAGE_FONT_FETCH_FAILED', `fontAssets.${fontId}`, 'Production font response was not successful.', {
                fontId,
                status: response?.status,
            });
        }
        const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
        if (contentType && contentType !== 'font/woff2') {
            fail('FLOW_LOCAL_PACKAGE_FONT_MIME_MISMATCH', `fontAssets.${fontId}`, 'Production font response MIME type must be font/woff2.', {
                fontId,
                contentType,
            });
        }
        const contentLength = String(response.headers?.get?.('content-length') || '').trim();
        if (contentLength && Number(contentLength) !== entry.asset.byteLength) {
            fail('FLOW_LOCAL_PACKAGE_FONT_LENGTH_MISMATCH', `fontAssets.${fontId}`, 'Production font response length differs from the registry.', {
                fontId,
                expected: entry.asset.byteLength,
                actual: contentLength,
            });
        }
        const bytes = await response.arrayBuffer();
        throwIfAborted(signal);
        let evidence;
        try {
            evidence = await verifyDsfProductionFontAsset({
                registry,
                fontId,
                bytes,
                ...(cryptoRef ? { cryptoRef } : {}),
            });
        } catch (cause) {
            fail('FLOW_LOCAL_PACKAGE_FONT_VERIFICATION_FAILED', `fontAssets.${fontId}`, 'Production font bytes failed exact verification.', {
                fontId,
                causeCode: cause?.code || null,
                cause: cause?.message || String(cause),
            });
        }
        fontAssets[fontId] = evidence.blob;
    }
    return fontAssets;
}

export class FlowPressLocalReleasePackageError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Flow Press local package verification failed.');
        this.name = 'FlowPressLocalReleasePackageError';
        this.code = 'DSF_FLOW_PRESS_LOCAL_RELEASE_PACKAGE_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Fetch exact certified WOFF2 bytes, create the portable inventory and build a
 * deterministic in-memory DSF ZIP. Nothing is downloaded to disk or uploaded.
 */
export async function createFlowPressLocalReleasePackage(input = {}) {
    validateInput(input);
    const registry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const fetchImpl = input.fetchImpl || globalThis.fetch;
    const hashBytes = input.hashBytes || createDsfWebCryptoSha256({ cryptoRef: input.cryptoRef || globalThis.crypto });
    const fontAssets = await fetchVerifiedFontAssets({
        assembly: input.planning.assembly,
        registry,
        fetchImpl,
        cryptoRef: input.cryptoRef,
        signal: input.signal,
    });
    throwIfAborted(input.signal);
    const portablePlan = await createDsfPortableReleasePlan({
        assembly: input.planning.assembly,
        fontRegistry: registry,
        fontAssets,
        hashBytes,
        ...(input.cryptoRef ? { cryptoRef: input.cryptoRef } : {}),
    });
    throwIfAborted(input.signal);
    const inventory = await createDsfReleaseFileInventory({
        assembly: portablePlan.assembly,
        sealedAssets: input.sealedAssets,
        portableFontAssets: portablePlan.fontAssets,
        metadata: input.metadata,
        hashBytes,
    });
    throwIfAborted(input.signal);
    const zipPackage = await createDsfReleaseZipPackage({ inventory, hashBytes });
    throwIfAborted(input.signal);

    return deepFreeze({
        packageVersion: FLOW_PRESS_LOCAL_RELEASE_PACKAGE_VERSION,
        packageKind: 'portable-local-only',
        ready: true,
        portablePlan,
        inventory,
        zipPackage,
        summary: {
            entryCount: zipPackage.roundTrip.entryCount,
            imageFileCount: inventory.summary.imageFileCount,
            fontFileCount: inventory.summary.fontFileCount,
            inventoryByteLength: inventory.summary.totalBytes,
            portablePayloadBytes: portablePlan.summary.totalBytes,
            zipByteLength: zipPackage.byteLength,
            zipSha256: zipPackage.sha256,
            compressionRatio: zipPackage.byteLength / inventory.summary.totalBytes,
            roundTripVerified: true,
        },
    });
}
