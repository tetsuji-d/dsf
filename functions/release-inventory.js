/**
 * Cloudflare Pages Function: GET /release-inventory
 *
 * Returns one read-only, cursor-paginated R2 listing page for the authenticated
 * owner's DSF namespace. The UID is always derived from the Firebase ID token;
 * callers cannot select another owner's prefix.
 */

import { verifyFirebaseToken } from './upload.js';

export const DSF_RELEASE_INVENTORY_VERSION = 1;
export const DSF_RELEASE_INVENTORY_KIND = 'owner-dsf-release-storage-page';
export const DSF_RELEASE_INVENTORY_DEFAULT_LIMIT = 250;
export const DSF_RELEASE_INVENTORY_MAX_LIMIT = 1000;

const MAX_CURSOR_LENGTH = 4096;
const MAX_STORAGE_PATH_LENGTH = 4096;
const SAFE_OWNER_UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_QUERY_KEYS = new Set(['cursor', 'limit']);
const ALLOWED_HTTP_METADATA_KEYS = new Set(['contentType', 'cacheControl']);
const ALLOWED_CUSTOM_METADATA_KEYS = new Set([
    'dsfSha256',
    'dsfByteLength',
    'dsfSchemaVersion',
]);

const ERROR_MESSAGES = Object.freeze({
    AUTH_REQUIRED: 'Authentication is required.',
    AUTH_INVALID: 'Authentication failed.',
    CONFIG_R2_MISSING: 'Release storage is not configured.',
    REQUEST_QUERY_INVALID: 'Release inventory query is invalid.',
    STORAGE_LIST_FAILED: 'Release storage inventory could not be listed.',
    STORAGE_LIST_INVALID: 'Release storage returned an invalid inventory page.',
    INTERNAL_ERROR: 'Internal server error.',
});

function responseHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store',
    };
}

function jsonError(code, status) {
    return Response.json(
        { code, error: ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR },
        { status, headers: responseHeaders() },
    );
}

function parseLimit(value) {
    if (value === null) return DSF_RELEASE_INVENTORY_DEFAULT_LIMIT;
    if (!/^[1-9]\d{0,3}$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= DSF_RELEASE_INVENTORY_MAX_LIMIT
        ? parsed
        : null;
}

function parseCursor(value) {
    if (value === null) return null;
    if (value.length < 1
        || value.length > MAX_CURSOR_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(value)) {
        return undefined;
    }
    return value;
}

function parseQuery(request) {
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return null;
    }
    for (const key of url.searchParams.keys()) {
        if (!ALLOWED_QUERY_KEYS.has(key)) return null;
    }
    if (url.searchParams.getAll('cursor').length > 1
        || url.searchParams.getAll('limit').length > 1) {
        return null;
    }
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const limit = parseLimit(url.searchParams.get('limit'));
    if (cursor === undefined || limit === null) return null;
    return { cursor, limit };
}

function selectMetadata(source, allowedKeys) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    return Object.fromEntries(
        Object.entries(source)
            .filter(([key, value]) => allowedKeys.has(key) && typeof value === 'string')
            .map(([key, value]) => [key, value]),
    );
}

function toUploadedAt(value) {
    if (value === undefined || value === null) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeListedObject(object, prefix) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return null;
    const storagePath = object.key;
    if (typeof storagePath !== 'string'
        || !storagePath.startsWith(prefix)
        || storagePath.length > MAX_STORAGE_PATH_LENGTH
        || /[\u0000-\u001f\u007f]/u.test(storagePath)
        || !Number.isSafeInteger(object.size)
        || object.size < 0) {
        return null;
    }
    return {
        storagePath,
        byteLength: object.size,
        uploadedAt: toUploadedAt(object.uploaded),
        httpMetadata: selectMetadata(object.httpMetadata, ALLOWED_HTTP_METADATA_KEYS),
        customMetadata: selectMetadata(object.customMetadata, ALLOWED_CUSTOM_METADATA_KEYS),
    };
}

/**
 * Testable read-only request handler. Production uses the shared Firebase token
 * verifier; tests inject authentication and an in-memory list-only R2 bucket.
 */
export async function handleDsfReleaseInventory({
    request,
    env,
    verifyToken = verifyFirebaseToken,
}) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ') || !authHeader.slice(7)) {
            return jsonError('AUTH_REQUIRED', 401);
        }
        const projectId = env?.FIREBASE_PROJECT_ID || 'vmnn-26345';
        const uid = await verifyToken(authHeader.slice(7), projectId);
        if (typeof uid !== 'string' || !SAFE_OWNER_UID_PATTERN.test(uid)) {
            return jsonError('AUTH_INVALID', 401);
        }

        const query = parseQuery(request);
        if (!query) return jsonError('REQUEST_QUERY_INVALID', 400);
        if (!env?.R2_BUCKET || typeof env.R2_BUCKET.list !== 'function') {
            console.error('[release-inventory] R2_BUCKET list binding is not configured');
            return jsonError('CONFIG_R2_MISSING', 500);
        }

        const prefix = `users/${uid}/dsf/`;
        let listed;
        try {
            listed = await env.R2_BUCKET.list({
                prefix,
                limit: query.limit,
                ...(query.cursor ? { cursor: query.cursor } : {}),
                include: ['httpMetadata', 'customMetadata'],
            });
        } catch (error) {
            console.error('[release-inventory] R2 list failed:', error?.message || error);
            return jsonError('STORAGE_LIST_FAILED', 502);
        }

        if (!listed || !Array.isArray(listed.objects) || typeof listed.truncated !== 'boolean') {
            return jsonError('STORAGE_LIST_INVALID', 502);
        }
        const cursor = listed.truncated ? listed.cursor : null;
        if (listed.truncated && (typeof cursor !== 'string' || !cursor)) {
            return jsonError('STORAGE_LIST_INVALID', 502);
        }
        const objects = listed.objects.map((object) => normalizeListedObject(object, prefix));
        // R2 list(prefix) must never yield malformed or out-of-prefix entries.
        // Failing the whole page keeps the caller from treating a filtered,
        // incomplete inventory as a complete source of missing-file evidence.
        if (objects.some((object) => object === null)) {
            return jsonError('STORAGE_LIST_INVALID', 502);
        }

        return Response.json({
            inventoryVersion: DSF_RELEASE_INVENTORY_VERSION,
            inventoryKind: DSF_RELEASE_INVENTORY_KIND,
            prefix,
            objects,
            scannedObjectCount: listed.objects.length,
            truncated: listed.truncated,
            cursor,
        }, { headers: responseHeaders() });
    } catch (error) {
        console.error('[release-inventory] Unexpected error:', error?.message, error?.stack);
        return jsonError('INTERNAL_ERROR', 500);
    }
}

export async function onRequestGet(context) {
    return handleDsfReleaseInventory(context);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: responseHeaders() });
}
