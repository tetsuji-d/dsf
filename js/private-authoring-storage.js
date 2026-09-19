/** Private R2 authoring contract, Unit A. No storage, network, or application state I/O. */
import { prepareProjectForSave } from './project-persistence.js';

export const PRIVATE_AUTHORING_STORAGE_VERSION = 1;
export const PRIVATE_AUTHORING_MAX_BYTES = 16 * 1024 * 1024;
export const PRIVATE_AUTHORING_HEAD_MAX_BYTES = 16 * 1024;
export const PRIVATE_AUTHORING_MAX_DEPTH = 64;
export const PRIVATE_AUTHORING_MAX_NODES = 250_000;

// Only root operational fields are omitted; identically named authoring extensions
// inside the document remain intact. Runtime/authentication input is rejected.
const OPERATIONAL_KEYS = new Set([
    'lastUpdated', 'updatedAt', 'createdAt', 'dsfPublishedAt', 'publication',
    'authoringBackend', 'authoringStorageVersion', 'authoringRef', 'authoringSchemaVersion',
    'generationId', 'revision', 'revisionId', 'objectKey', 'sha256', 'byteLength',
    'storageVersion', 'projectSchemaVersion', 'baseRevision', 'committedAt', 'leaseExpiresAt',
]);
const RUNTIME_KEYS = new Set([
    'generatedPages', 'flowGeneratedPages', 'fragments', 'pagination', 'paginationCache',
    'auth', 'currentUser', 'idToken', 'accessToken', 'refreshToken',
]);
const DESCRIPTOR_KEYS = [
    'storageVersion', 'projectSchemaVersion', 'generationId', 'revisionId',
    'objectKey', 'sha256', 'byteLength',
];
const encoder = new TextEncoder();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class PrivateAuthoringError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'PrivateAuthoringError';
        this.code = code;
    }
}
function requireValue(condition, code, message) {
    if (!condition) throw new PrivateAuthoringError(code, message);
}
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) freeze(entry);
        Object.freeze(value);
    }
    return value;
}

/** Bounded, deterministic JSON. Key order is lexical; array order and text are exact. */
function stableJson(input, maxBytes = PRIVATE_AUTHORING_MAX_BYTES) {
    let byteLength = 0;
    let nodes = 0;
    const ancestors = new WeakSet();
    const add = (text) => {
        byteLength += encoder.encode(text).byteLength;
        requireValue(byteLength <= maxBytes, 'AUTHORING_TOO_LARGE', 'Authoring JSON exceeds the byte limit.');
        return text;
    };
    const visit = (value, depth) => {
        requireValue(++nodes <= PRIVATE_AUTHORING_MAX_NODES && depth <= PRIVATE_AUTHORING_MAX_DEPTH,
            'AUTHORING_COMPLEXITY_LIMIT', 'Authoring JSON exceeds the depth or node limit.');
        if (value === null || typeof value === 'boolean' || typeof value === 'string') {
            // Avoid making an escaped copy of a single obviously oversized string.
            requireValue(typeof value !== 'string' || value.length <= maxBytes,
                'AUTHORING_TOO_LARGE', 'Authoring string exceeds the byte limit.');
            return add(JSON.stringify(value));
        }
        if (typeof value === 'number') {
            requireValue(Number.isFinite(value), 'AUTHORING_NOT_JSON_SAFE', 'Numbers must be finite.');
            return add(JSON.stringify(value));
        }
        requireValue(Array.isArray(value) || record(value), 'AUTHORING_NOT_JSON_SAFE', 'Only plain JSON is accepted.');
        requireValue(!ancestors.has(value), 'AUTHORING_NOT_JSON_SAFE', 'Circular JSON is not accepted.');
        ancestors.add(value);
        const properties = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(properties);
        requireValue(keys.every((key) => typeof key === 'string'
            && (Array.isArray(value) && key === 'length'
                || properties[key].enumerable && own(properties[key], 'value'))),
        'AUTHORING_NOT_JSON_SAFE', 'Accessors, symbols and hidden data are not accepted.');
        let result;
        if (Array.isArray(value)) {
            requireValue(value.length <= PRIVATE_AUTHORING_MAX_NODES
                && keys.length === value.length + 1
                && Array.from({ length: value.length }, (_, index) => own(properties, String(index))).every(Boolean),
            'AUTHORING_NOT_JSON_SAFE', 'Sparse arrays and array extensions are not accepted.');
            const parts = [add('[')];
            for (let index = 0; index < value.length; index += 1) {
                if (index) parts.push(add(','));
                parts.push(visit(properties[index].value, depth + 1));
            }
            parts.push(add(']'));
            result = parts.join('');
        } else {
            const parts = [add('{')];
            keys.sort().forEach((key, index) => {
                requireValue(!['__proto__', 'constructor', 'prototype'].includes(key),
                    'AUTHORING_NOT_JSON_SAFE', 'Prototype-sensitive keys are not accepted.');
                requireValue(key.length <= maxBytes, 'AUTHORING_TOO_LARGE', 'JSON key exceeds the byte limit.');
                if (index) parts.push(add(','));
                parts.push(add(JSON.stringify(key)), add(':'), visit(properties[key].value, depth + 1));
            });
            parts.push(add('}'));
            result = parts.join('');
        }
        ancestors.delete(value);
        return result;
    };
    return { json: visit(input, 0), byteLength };
}

function prepareSnapshot(input, { allowOperationalFields }) {
    requireValue(record(input), 'INVALID_AUTHORING_PROJECT', 'Expected a Project v6 envelope.');
    const entries = [];
    for (const key of Reflect.ownKeys(input)) {
        requireValue(typeof key === 'string', 'AUTHORING_NOT_JSON_SAFE', 'Symbol keys are not accepted.');
        requireValue(!RUNTIME_KEYS.has(key), 'AUTHORING_RUNTIME_DATA', 'Runtime data cannot be stored as authoring.');
        if (OPERATIONAL_KEYS.has(key) && allowOperationalFields) continue;
        requireValue(!OPERATIONAL_KEYS.has(key), 'AUTHORING_OPERATIONAL_DATA', 'Stored JSON contains operational data.');
        const property = Object.getOwnPropertyDescriptor(input, key);
        requireValue(property.enumerable && own(property, 'value'), 'AUTHORING_NOT_JSON_SAFE', 'Expected JSON data properties.');
        entries.push([key, property.value]);
    }
    // Bound and detach before the existing normalizer clones/traverses the envelope.
    const detached = JSON.parse(stableJson(Object.fromEntries(entries)).json);
    requireValue(detached.version === 6, 'UNSUPPORTED_AUTHORING_PROJECT', 'Private authoring requires explicit Project v6.');
    assertSegment(detached.projectId);
    const prepared = prepareProjectForSave(detached);
    return stableJson(prepared);
}
async function sha256(bytes) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** json is the immutable source of upload bytes; never reserialize project for upload. */
export async function createPrivateAuthoringSnapshot(project) {
    const { json, byteLength } = prepareSnapshot(project, { allowOperationalFields: true });
    const hash = await sha256(encoder.encode(json));
    return freeze({
        storageVersion: PRIVATE_AUTHORING_STORAGE_VERSION, projectSchemaVersion: 6,
        json, byteLength, sha256: hash, project: JSON.parse(json),
    });
}

function assertSegment(value) {
    requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
        'INVALID_AUTHORING_ID', 'Storage IDs must be safe, non-empty path segments.');
}
function assertScope(scope) {
    requireValue(record(scope), 'INVALID_AUTHORING_SCOPE', 'A trusted owner/project/generation scope is required.');
    for (const key of ['uid', 'projectId', 'generationId']) assertSegment(scope[key]);
}
/** scope must come from authenticated server context in the future adapter. */
export function privateAuthoringObjectKey(scope, revisionId) {
    assertScope(scope);
    assertSegment(revisionId);
    return `users/${scope.uid}/projects/${scope.projectId}/generations/${scope.generationId}/revisions/${revisionId}.json`;
}
function assertDigestFields(value) {
    requireValue(value.storageVersion === PRIVATE_AUTHORING_STORAGE_VERSION && value.projectSchemaVersion === 6,
        'UNSUPPORTED_AUTHORING_STORAGE', 'Unsupported authoring storage or project version.');
    requireValue(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256),
        'INVALID_AUTHORING_HASH', 'Expected lowercase SHA-256 hex.');
    requireValue(Number.isSafeInteger(value.byteLength) && value.byteLength > 0
        && value.byteLength <= PRIVATE_AUTHORING_MAX_BYTES, 'INVALID_AUTHORING_SIZE', 'Invalid authoring byte length.');
}
function assertRevision(value, minimum = 0) {
    requireValue(Number.isSafeInteger(value) && value >= minimum,
        'INVALID_AUTHORING_REVISION', 'Revision must be a nonnegative safe integer.');
}
function assertDescriptor(value, scope, head) {
    assertScope(scope);
    stableJson(value, PRIVATE_AUTHORING_HEAD_MAX_BYTES);
    const keys = head ? [...DESCRIPTOR_KEYS, 'revision'] : DESCRIPTOR_KEYS;
    requireValue(record(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key)),
        'INVALID_AUTHORING_DESCRIPTOR', 'Unexpected or missing descriptor fields.');
    assertDigestFields(value);
    requireValue(value.generationId === scope.generationId, 'AUTHORING_GENERATION_CONFLICT', 'Authoring generation changed.');
    requireValue(value.objectKey === privateAuthoringObjectKey(scope, value.revisionId),
        'AUTHORING_SCOPE_MISMATCH', 'Descriptor path does not match the trusted scope.');
    if (head) assertRevision(value.revision, 1);
    return value;
}
export function assertPrivateAuthoringDescriptor(descriptor, scope) {
    return assertDescriptor(descriptor, scope, false);
}
export function assertPrivateAuthoringHead(head, scope) {
    return assertDescriptor(head, scope, true);
}
export function createPrivateAuthoringDescriptor(snapshot, scope, revisionId) {
    requireValue(record(snapshot), 'INVALID_AUTHORING_DESCRIPTOR', 'Snapshot digest is required.');
    assertDigestFields(snapshot);
    const descriptor = {
        storageVersion: snapshot.storageVersion, projectSchemaVersion: snapshot.projectSchemaVersion,
        generationId: scope?.generationId, revisionId,
        objectKey: privateAuthoringObjectKey(scope, revisionId),
        sha256: snapshot.sha256, byteLength: snapshot.byteLength,
    };
    assertPrivateAuthoringDescriptor(descriptor, scope);
    requireValue(snapshot.project?.projectId === scope.projectId, 'AUTHORING_SCOPE_MISMATCH', 'Project ID differs from the storage scope.');
    return freeze(descriptor);
}

/** Integrity + schema checks before returning any project. Missing data never falls back. */
export async function readPrivateAuthoringSnapshot(bytes, descriptor, scope) {
    assertPrivateAuthoringDescriptor(descriptor, scope);
    // Capture both arguments before yielding; callers cannot change the expected digest mid-read.
    const expected = { ...descriptor };
    const expectedProjectId = scope.projectId;
    requireValue(bytes instanceof Uint8Array, 'AUTHORING_BYTES_REQUIRED', 'Expected the stored UTF-8 bytes.');
    requireValue(bytes.byteLength === expected.byteLength, 'AUTHORING_SIZE_MISMATCH', 'Stored byte length differs.');
    const captured = new Uint8Array(bytes);
    requireValue(await sha256(captured) === expected.sha256, 'AUTHORING_HASH_MISMATCH', 'Stored SHA-256 differs.');
    let json;
    let parsed;
    try {
        json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured);
        parsed = JSON.parse(json);
    } catch {
        throw new PrivateAuthoringError('AUTHORING_INVALID_JSON', 'Stored authoring is not valid UTF-8 JSON.');
    }
    requireValue(parsed?.projectId === expectedProjectId, 'AUTHORING_SCOPE_MISMATCH', 'Stored project ID differs from the storage scope.');
    const prepared = prepareSnapshot(parsed, { allowOperationalFields: false });
    requireValue(prepared.json === json, 'AUTHORING_NONCANONICAL_JSON', 'Stored JSON differs from the canonical snapshot.');
    return freeze(JSON.parse(json));
}

/**
 * Pure compare-and-swap decision, NOT a storage transaction or authorization check.
 * Re-read the head and status inside the future Firestore transaction; adapters must
 * also enforce leases and a durable request ledger (including retries of older heads).
 */
export function planPrivateAuthoringCommit({ scope, projectStatus, baseRevision, candidate, currentHead = null }) {
    assertPrivateAuthoringDescriptor(candidate, scope);
    assertRevision(baseRevision);
    requireValue(projectStatus === 'active', 'AUTHORING_NOT_ACTIVE', 'Only an active project can accept saves.');
    if (currentHead !== null) assertPrivateAuthoringHead(currentHead, scope);
    const revision = currentHead?.revision ?? 0;
    if (currentHead?.revisionId === candidate.revisionId) {
        requireValue(DESCRIPTOR_KEYS.every((key) => currentHead[key] === candidate[key])
            && baseRevision === revision - 1, 'AUTHORING_REQUEST_REUSED', 'Revision ID was reused for a different request.');
        return freeze({ action: 'replay', head: { ...currentHead } });
    }
    requireValue(baseRevision === revision, 'AUTHORING_REVISION_CONFLICT', 'Authoring has changed since this save began.');
    if (currentHead?.sha256 === candidate.sha256 && currentHead.byteLength === candidate.byteLength) {
        return freeze({ action: 'unchanged', head: { ...currentHead } });
    }
    assertRevision(revision + 1, 1);
    return freeze({ action: 'commit', head: { ...candidate, revision: revision + 1 } });
}
