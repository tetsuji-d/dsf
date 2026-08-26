/**
 * 9A-6C-C-C-1C-A dry-run handoff from Press release planning to Horizon.
 *
 * Revalidates the verified assembly and every sealed WebP Blob, creates the
 * immutable Horizon plan, and binds image plan files to exact runtime Blobs.
 * It performs no fetch, token acquisition, upload, Firestore write, Press UI
 * mutation, Viewer mutation, or persistence.
 */

import { DSF_PRODUCTION_FONT_REGISTRY } from './dsf-font-registry.js';
import { createDsfHorizonReleasePlan } from './dsf-horizon-release-contract.js';
import {
    DSF_RELEASE_BYTE_SEALING_VERSION,
    createDsfWebCryptoSha256,
    inspectDsfWebPBytes,
} from './dsf-release-byte-sealing.js';
import { serializeDsfReleaseJson } from './dsf-release-assembly.js';
import { FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION } from './flow-press-local-release-planning.js';

export const FLOW_PRESS_HORIZON_HANDOFF_VERSION = 1;
export const FLOW_PRESS_HORIZON_HANDOFF_KIND = 'flow-press-horizon-dry-run';

const INPUT_KEYS = new Set([
    'planning',
    'sealedAssets',
    'uid',
    'workId',
    'releaseId',
    'publicBaseUrl',
    'fontRegistry',
    'hashBytes',
    'cryptoRef',
    'signal',
]);
const SEALED_ASSET_KEYS = new Set(['language', 'blockId', 'pageIndex', 'sealed']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_PLAN_MATCH_KEYS = Object.freeze([
    'relativePath',
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
    throw new FlowPressHorizonReleaseHandoffError([createIssue(code, path, message, details)]);
}

function hasExactKeys(value, keys) {
    return isRecord(value)
        && Object.keys(value).length === keys.size
        && Object.keys(value).every((key) => keys.has(key));
}

function exactKey(value) {
    return typeof value === 'string'
        && !!value
        && value === value.trim()
        && value.length <= 256;
}

function assetKey(language, blockId, pageIndex) {
    return `${language}\u0000${blockId}\u0000${pageIndex}`;
}

function throwIfAborted(signal, path = 'signal') {
    if (!signal?.aborted) return;
    fail('FLOW_HORIZON_HANDOFF_ABORTED', path, 'Flow Horizon release handoff was cancelled.');
}

function validateInput(input) {
    if (!isRecord(input)) {
        fail('FLOW_HORIZON_HANDOFF_INPUT_INVALID', '', 'Flow Horizon release handoff requires an input object.');
    }
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) {
            fail('FLOW_HORIZON_HANDOFF_PROPERTY_UNSUPPORTED', key, 'Flow Horizon handoff input contains an unsupported property.');
        }
    }
    if (!isRecord(input.planning)
        || input.planning.planningVersion !== FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION
        || input.planning.planningKind !== 'local-only'
        || input.planning.ready !== true
        || !isRecord(input.planning.assembly)) {
        fail('FLOW_HORIZON_HANDOFF_PLANNING_NOT_READY', 'planning', 'A successful Press local release planning result is required.');
    }
    if (!Array.isArray(input.sealedAssets)) {
        fail('FLOW_HORIZON_HANDOFF_SEALED_ASSETS_INVALID', 'sealedAssets', 'sealedAssets must be an explicit array.');
    }
    for (const key of ['uid', 'workId', 'releaseId', 'publicBaseUrl']) {
        if (typeof input[key] !== 'string' || !input[key]) {
            fail('FLOW_HORIZON_HANDOFF_IDENTITY_INVALID', key, 'Horizon release identity and public base URL are required.');
        }
    }
    if (input.hashBytes !== undefined && typeof input.hashBytes !== 'function') {
        fail('FLOW_HORIZON_HANDOFF_HASHER_INVALID', 'hashBytes', 'hashBytes must be a function when supplied.');
    }
    if (input.signal !== undefined
        && (!isRecord(input.signal) || typeof input.signal.aborted !== 'boolean')) {
        fail('FLOW_HORIZON_HANDOFF_SIGNAL_INVALID', 'signal', 'signal must be an AbortSignal when supplied.');
    }
}

function compareDescriptor(descriptor, plannedAsset, path) {
    if (!isRecord(descriptor)) {
        fail('FLOW_HORIZON_HANDOFF_DESCRIPTOR_INVALID', path, 'Sealed WebP descriptor is invalid.');
    }
    for (const key of ['sha256', 'byteLength', 'width', 'height', 'mimeType']) {
        if (descriptor[key] !== plannedAsset[key]) {
            fail(
                'FLOW_HORIZON_HANDOFF_DESCRIPTOR_MISMATCH',
                `${path}.${key}`,
                'Sealed WebP descriptor does not match the verified assembly.',
                { language: plannedAsset.language, blockId: plannedAsset.blockId, pageIndex: plannedAsset.pageIndex },
            );
        }
    }
}

function indexSealedAssets(sealedAssets, plannedAssets) {
    const plannedByKey = new Map(plannedAssets.map((asset) => [
        assetKey(asset.language, asset.blockId, asset.pageIndex),
        asset,
    ]));
    const sealedByKey = new Map();
    sealedAssets.forEach((binding, index) => {
        const path = `sealedAssets[${index}]`;
        if (!hasExactKeys(binding, SEALED_ASSET_KEYS)
            || !exactKey(binding.language)
            || !exactKey(binding.blockId)
            || !Number.isInteger(binding.pageIndex)
            || binding.pageIndex < 0) {
            fail('FLOW_HORIZON_HANDOFF_SEALED_ASSET_INVALID', path, 'Sealed WebP binding is invalid.');
        }
        const key = assetKey(binding.language, binding.blockId, binding.pageIndex);
        if (sealedByKey.has(key)) {
            fail('FLOW_HORIZON_HANDOFF_SEALED_ASSET_DUPLICATE', path, 'Sealed WebP binding is duplicated.');
        }
        const plannedAsset = plannedByKey.get(key);
        if (!plannedAsset) {
            fail('FLOW_HORIZON_HANDOFF_SEALED_ASSET_UNEXPECTED', path, 'Sealed WebP binding is absent from the verified assembly.');
        }
        const sealed = binding.sealed;
        if (!isRecord(sealed)
            || sealed.sealingVersion !== DSF_RELEASE_BYTE_SEALING_VERSION
            || !isRecord(sealed.descriptor)
            || !isRecord(sealed.inspection)
            || !(typeof Blob !== 'undefined' && sealed.blob instanceof Blob)) {
            fail('FLOW_HORIZON_HANDOFF_SEAL_INVALID', `${path}.sealed`, 'A complete sealed WebP asset is required.');
        }
        compareDescriptor(sealed.descriptor, plannedAsset, `${path}.sealed.descriptor`);
        if (sealed.blob.type !== 'image/webp' || sealed.blob.size !== plannedAsset.byteLength) {
            fail('FLOW_HORIZON_HANDOFF_BLOB_MISMATCH', `${path}.sealed.blob`, 'Sealed WebP Blob MIME or byte length changed.');
        }
        sealedByKey.set(key, { binding, plannedAsset, path });
    });
    for (const plannedAsset of plannedAssets) {
        const key = assetKey(plannedAsset.language, plannedAsset.blockId, plannedAsset.pageIndex);
        if (!sealedByKey.has(key)) {
            fail('FLOW_HORIZON_HANDOFF_SEALED_ASSET_MISSING', 'sealedAssets', 'Verified assembly image has no sealed WebP Blob.', {
                language: plannedAsset.language,
                blockId: plannedAsset.blockId,
                pageIndex: plannedAsset.pageIndex,
            });
        }
    }
    return sealedByKey;
}

async function verifySealedBinding(entry, hashBytes, signal) {
    throwIfAborted(signal, `${entry.path}.sealed.blob`);
    const { binding, plannedAsset, path } = entry;
    const bytes = new Uint8Array(await binding.sealed.blob.arrayBuffer());
    throwIfAborted(signal, `${path}.sealed.blob`);

    let inspection;
    try {
        inspection = await inspectDsfWebPBytes(bytes);
    } catch (cause) {
        fail('FLOW_HORIZON_HANDOFF_WEBP_INVALID', `${path}.sealed.blob`, 'Sealed WebP bytes are structurally invalid.', {
            causeCode: cause?.code || null,
        });
    }
    if (inspection.width !== plannedAsset.width
        || inspection.height !== plannedAsset.height
        || inspection.byteLength !== plannedAsset.byteLength
        || serializeDsfReleaseJson(inspection) !== serializeDsfReleaseJson(binding.sealed.inspection)) {
        fail('FLOW_HORIZON_HANDOFF_INSPECTION_MISMATCH', `${path}.sealed.inspection`, 'Sealed WebP inspection does not match exact bytes and assembly dimensions.');
    }

    let sha256;
    try {
        sha256 = await hashBytes(bytes);
    } catch (cause) {
        if (signal?.aborted || cause?.name === 'AbortError') throwIfAborted({ aborted: true }, `${path}.sealed.blob`);
        fail('FLOW_HORIZON_HANDOFF_HASH_FAILED', `${path}.sealed.blob`, 'Sealed WebP SHA-256 could not be calculated.', {
            cause: cause?.message || String(cause),
        });
    }
    if (!SHA256_PATTERN.test(sha256) || sha256 !== plannedAsset.sha256) {
        fail('FLOW_HORIZON_HANDOFF_HASH_MISMATCH', `${path}.sealed.blob`, 'Sealed WebP bytes do not match the verified assembly SHA-256.');
    }
    return binding.sealed.blob;
}

export class FlowPressHorizonReleaseHandoffError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Flow Press Horizon release handoff failed.');
        this.name = 'FlowPressHorizonReleaseHandoffError';
        this.code = 'DSF_FLOW_PRESS_HORIZON_HANDOFF_INVALID';
        this.issues = deepFreeze(Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : []);
    }
}

/**
 * Build an upload-ready, network-idle handoff from current Press runtime data.
 */
export async function createFlowPressHorizonReleaseHandoff(input = {}) {
    validateInput(input);
    throwIfAborted(input.signal);
    const assembly = input.planning.assembly;
    const plannedAssets = Array.isArray(assembly.files?.assets) ? assembly.files.assets : [];
    const sealedByKey = indexSealedAssets(input.sealedAssets, plannedAssets);
    const hashBytes = input.hashBytes || createDsfWebCryptoSha256({ cryptoRef: input.cryptoRef || globalThis.crypto });

    let plan;
    try {
        plan = await createDsfHorizonReleasePlan({
            assembly,
            uid: input.uid,
            workId: input.workId,
            releaseId: input.releaseId,
            publicBaseUrl: input.publicBaseUrl,
            fontRegistry: input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY,
            hashBytes,
            ...(input.cryptoRef ? { cryptoRef: input.cryptoRef } : {}),
        });
    } catch (cause) {
        fail('FLOW_HORIZON_HANDOFF_PLAN_FAILED', 'planning.assembly', 'Verified Press assembly could not produce a Horizon release plan.', {
            causeCode: cause?.code || null,
            validationIssues: Array.isArray(cause?.issues) ? cause.issues.map((issue) => ({ ...issue })) : [],
        });
    }
    throwIfAborted(input.signal);

    const plannedAssetByPath = new Map(plannedAssets.map((asset) => [asset.path, asset]));
    const imageFiles = [];
    for (const [fileIndex, file] of plan.files.entries()) {
        if (file.mimeType !== 'image/webp') continue;
        const plannedAsset = plannedAssetByPath.get(file.relativePath);
        if (!plannedAsset) {
            fail('FLOW_HORIZON_HANDOFF_IMAGE_PLAN_MISMATCH', `plan.files[${fileIndex}]`, 'Horizon image plan is absent from the verified assembly.');
        }
        const entry = sealedByKey.get(assetKey(plannedAsset.language, plannedAsset.blockId, plannedAsset.pageIndex));
        const blob = await verifySealedBinding(entry, hashBytes, input.signal);
        for (const key of ['mimeType', 'byteLength', 'sha256']) {
            if (file[key] !== plannedAsset[key]) {
                fail('FLOW_HORIZON_HANDOFF_IMAGE_PLAN_MISMATCH', `plan.files[${fileIndex}].${key}`, 'Horizon plan image differs from the verified assembly.');
            }
        }
        imageFiles.push({
            relativePath: file.relativePath,
            storagePath: file.storagePath,
            publicUrl: file.publicUrl,
            mimeType: file.mimeType,
            byteLength: file.byteLength,
            sha256: file.sha256,
            cacheControl: file.cacheControl,
            language: plannedAsset.language,
            blockId: plannedAsset.blockId,
            pageIndex: plannedAsset.pageIndex,
            blob,
        });
    }
    if (imageFiles.length !== plannedAssets.length) {
        fail('FLOW_HORIZON_HANDOFF_IMAGE_FILE_SET_MISMATCH', 'imageFiles', 'Horizon plan and sealed WebP file sets differ.');
    }
    throwIfAborted(input.signal);

    return deepFreeze({
        handoffVersion: FLOW_PRESS_HORIZON_HANDOFF_VERSION,
        handoffKind: FLOW_PRESS_HORIZON_HANDOFF_KIND,
        ready: true,
        readyForUpload: true,
        readyForMetadataWrite: false,
        identity: { ...plan.identity },
        plan,
        imageFiles,
        summary: {
            fileCount: plan.summary.fileCount,
            jsonFileCount: plan.summary.jsonFileCount,
            imageFileCount: plan.summary.imageFileCount,
            totalBytes: plan.summary.totalBytes,
            boundImageBytes: imageFiles.reduce((sum, file) => sum + file.byteLength, 0),
        },
    });
}

/** Resolve only an exact image plan file from a validated dry-run handoff. */
export function resolveFlowPressHorizonImageBlob(handoff, file) {
    if (!isRecord(handoff)
        || handoff.handoffVersion !== FLOW_PRESS_HORIZON_HANDOFF_VERSION
        || handoff.handoffKind !== FLOW_PRESS_HORIZON_HANDOFF_KIND
        || handoff.ready !== true
        || handoff.readyForUpload !== true
        || handoff.readyForMetadataWrite !== false
        || !Array.isArray(handoff.imageFiles)
        || !isRecord(file)) {
        fail('FLOW_HORIZON_HANDOFF_RESOLVE_INPUT_INVALID', 'handoff', 'An upload-ready dry-run handoff and plan file are required.');
    }
    const binding = handoff.imageFiles.find((entry) => entry.storagePath === file.storagePath);
    if (!binding) {
        fail('FLOW_HORIZON_HANDOFF_IMAGE_NOT_FOUND', 'file.storagePath', 'Horizon plan image has no exact Blob binding.');
    }
    for (const key of IMAGE_PLAN_MATCH_KEYS) {
        if (binding[key] !== file[key]) {
            fail('FLOW_HORIZON_HANDOFF_IMAGE_FILE_MISMATCH', `file.${key}`, 'Requested Horizon image file differs from the dry-run handoff.');
        }
    }
    return binding.blob;
}
