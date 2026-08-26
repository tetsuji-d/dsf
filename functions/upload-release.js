/**
 * Cloudflare Pages Function: POST /upload-release
 *
 * Accepts one already-planned DSF delivery v2 release file and returns an
 * exact receipt only after the immutable R2 object is verified. This endpoint
 * is intentionally separate from the authoring image /upload route.
 *
 * multipart/form-data fields:
 *   file       — content.json, language manifest JSON, or sealed page WebP
 *   path       — immutable Horizon release storage path
 *   mimeType   — application/json or image/webp
 *   byteLength — planned positive byte length
 *   sha256     — planned lowercase SHA-256 hex
 */

import { verifyFirebaseToken } from './upload.js';

export const DSF_RELEASE_UPLOAD_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const JSON_MIME_TYPE = 'application/json';
const WEBP_MIME_TYPE = 'image/webp';
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_WEBP_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CONTENT_PATH_PATTERN = /^content\.json$/;
const LANGUAGE_MANIFEST_PATH_PATTERN = /^content\/language-\d{4}\.json$/;
const IMAGE_PATH_PATTERN = /^assets\/images\/language-\d{4}\/page-\d{5}\.webp$/;

const ERROR_MESSAGES = Object.freeze({
    AUTH_REQUIRED: 'Authentication is required.',
    AUTH_INVALID: 'Authentication failed.',
    CONFIG_R2_MISSING: 'Release storage is not configured.',
    CONFIG_PUBLIC_URL_INVALID: 'Release public URL is not configured safely.',
    REQUEST_FORM_INVALID: 'Release upload form data is invalid.',
    REQUEST_FIELD_MISSING: 'Release upload fields are incomplete.',
    PATH_INVALID: 'Release upload path is not allowed.',
    PATH_FORBIDDEN: 'Release upload path does not belong to the authenticated user.',
    MIME_INVALID: 'Release upload MIME type does not match its path.',
    SIZE_INVALID: 'Release upload byte length is invalid.',
    HASH_INVALID: 'Release upload SHA-256 is invalid.',
    HASH_MISMATCH: 'Release upload bytes do not match the planned SHA-256.',
    WEBP_INVALID: 'Release WebP bytes are invalid.',
    JSON_INVALID: 'Release JSON bytes are invalid.',
    IMMUTABLE_COLLISION: 'An immutable release object already exists with different bytes or metadata.',
    STORAGE_WRITE_FAILED: 'Release storage did not confirm the uploaded object.',
    INTERNAL_ERROR: 'Internal server error.',
});

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonError(code, status) {
    return Response.json(
        { code, error: ERROR_MESSAGES[code] || ERROR_MESSAGES.INTERNAL_ERROR },
        { status, headers: corsHeaders() },
    );
}

function parsePublicBaseUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:'
        || url.username
        || url.password
        || url.search
        || url.hash
        || url.pathname !== '/') {
        return null;
    }
    return url;
}

function parseReleasePath(value) {
    if (typeof value !== 'string'
        || value !== value.trim()
        || value !== value.normalize('NFC')
        || value.includes('\\')
        || value.includes('//')
        || /[\u0000-\u001f\u007f]/u.test(value)) {
        return null;
    }
    const segments = value.split('/');
    if (segments.length < 6 || segments[0] !== 'users' || segments[2] !== 'dsf') return null;
    const [uid, workId, releaseId] = [segments[1], segments[3], segments[4]];
    if (![uid, workId, releaseId].every((segment) => SAFE_ID_PATTERN.test(segment))) return null;
    const relativePath = segments.slice(5).join('/');
    let mimeType = null;
    if (CONTENT_PATH_PATTERN.test(relativePath) || LANGUAGE_MANIFEST_PATH_PATTERN.test(relativePath)) {
        mimeType = JSON_MIME_TYPE;
    } else if (IMAGE_PATH_PATTERN.test(relativePath)) {
        mimeType = WEBP_MIME_TYPE;
    }
    if (!mimeType) return null;
    return { uid, workId, releaseId, relativePath, mimeType };
}

function parseDeclaredByteLength(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function isWebPArrayBuffer(buffer) {
    const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 12));
    if (bytes.length < 12) return false;
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function isJsonObjectArrayBuffer(buffer) {
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        const value = JSON.parse(text);
        return !!value && typeof value === 'object' && !Array.isArray(value);
    } catch {
        return false;
    }
}

async function sha256Hex(buffer, cryptoRef) {
    const digest = await cryptoRef.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function objectMatchesPlan(object, plan) {
    if (!object || object.size !== plan.byteLength) return false;
    const httpMetadata = object.httpMetadata || {};
    const customMetadata = object.customMetadata || {};
    return httpMetadata.contentType === plan.mimeType
        && httpMetadata.cacheControl === DSF_RELEASE_UPLOAD_CACHE_CONTROL
        && customMetadata.dsfSha256 === plan.sha256
        && customMetadata.dsfByteLength === String(plan.byteLength)
        && customMetadata.dsfSchemaVersion === '2';
}

function createReceipt(plan, publicBaseUrl) {
    return Object.freeze({
        storagePath: plan.storagePath,
        publicUrl: new URL(plan.storagePath, publicBaseUrl).href,
        mimeType: plan.mimeType,
        byteLength: plan.byteLength,
        sha256: plan.sha256,
        cacheControl: DSF_RELEASE_UPLOAD_CACHE_CONTROL,
    });
}

async function verifyStoredOrCollision(bucket, plan) {
    const stored = await bucket.head(plan.storagePath);
    return objectMatchesPlan(stored, plan) ? stored : null;
}

/**
 * Testable request handler. Production uses the imported Firebase verifier;
 * unit tests inject authentication and an in-memory R2 bucket.
 */
export async function handleDsfReleaseUpload({
    request,
    env,
    verifyToken = verifyFirebaseToken,
    cryptoRef = globalThis.crypto,
}) {
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ') || !authHeader.slice(7)) {
            return jsonError('AUTH_REQUIRED', 401);
        }
        const projectId = env?.FIREBASE_PROJECT_ID || 'vmnn-26345';
        const uid = await verifyToken(authHeader.slice(7), projectId);
        if (!uid) return jsonError('AUTH_INVALID', 401);

        if (!env?.R2_BUCKET || typeof env.R2_BUCKET.head !== 'function' || typeof env.R2_BUCKET.put !== 'function') {
            console.error('[upload-release] R2_BUCKET binding is not configured');
            return jsonError('CONFIG_R2_MISSING', 500);
        }
        const publicBaseUrl = parsePublicBaseUrl(env.R2_PUBLIC_URL);
        if (!publicBaseUrl) {
            console.error('[upload-release] R2_PUBLIC_URL must be an HTTPS origin');
            return jsonError('CONFIG_PUBLIC_URL_INVALID', 500);
        }

        let formData;
        try {
            formData = await request.formData();
        } catch {
            return jsonError('REQUEST_FORM_INVALID', 400);
        }
        const file = formData.get('file');
        const storagePath = formData.get('path');
        const declaredMimeType = formData.get('mimeType');
        const declaredByteLength = parseDeclaredByteLength(formData.get('byteLength'));
        const declaredSha256 = formData.get('sha256');
        if (!file
            || typeof file.arrayBuffer !== 'function'
            || typeof storagePath !== 'string'
            || typeof declaredMimeType !== 'string'
            || declaredByteLength === null
            || typeof declaredSha256 !== 'string') {
            return jsonError('REQUEST_FIELD_MISSING', 400);
        }

        const parsedPath = parseReleasePath(storagePath);
        if (!parsedPath) return jsonError('PATH_INVALID', 400);
        if (parsedPath.uid !== uid) return jsonError('PATH_FORBIDDEN', 403);
        if (declaredMimeType !== parsedPath.mimeType || file.type !== parsedPath.mimeType) {
            return jsonError('MIME_INVALID', 415);
        }
        const maximumBytes = parsedPath.mimeType === JSON_MIME_TYPE ? MAX_JSON_BYTES : MAX_WEBP_BYTES;
        if (declaredByteLength > maximumBytes || file.size !== declaredByteLength) {
            return jsonError('SIZE_INVALID', 413);
        }
        if (!SHA256_PATTERN.test(declaredSha256)) {
            return jsonError('HASH_INVALID', 400);
        }

        const buffer = await file.arrayBuffer();
        if (buffer.byteLength !== declaredByteLength) return jsonError('SIZE_INVALID', 413);
        const actualSha256 = await sha256Hex(buffer, cryptoRef);
        if (actualSha256 !== declaredSha256) return jsonError('HASH_MISMATCH', 422);
        if (parsedPath.mimeType === WEBP_MIME_TYPE && !isWebPArrayBuffer(buffer)) {
            return jsonError('WEBP_INVALID', 415);
        }
        if (parsedPath.mimeType === JSON_MIME_TYPE && !isJsonObjectArrayBuffer(buffer)) {
            return jsonError('JSON_INVALID', 415);
        }

        const plan = Object.freeze({
            storagePath,
            mimeType: parsedPath.mimeType,
            byteLength: declaredByteLength,
            sha256: declaredSha256,
        });
        const existing = await env.R2_BUCKET.head(storagePath);
        if (existing) {
            if (!objectMatchesPlan(existing, plan)) return jsonError('IMMUTABLE_COLLISION', 409);
            return Response.json(
                { receipt: createReceipt(plan, publicBaseUrl), reused: true },
                { headers: corsHeaders() },
            );
        }

        const stored = await env.R2_BUCKET.put(storagePath, buffer, {
            onlyIf: new Headers({ 'If-None-Match': '*' }),
            httpMetadata: {
                contentType: plan.mimeType,
                cacheControl: DSF_RELEASE_UPLOAD_CACHE_CONTROL,
            },
            customMetadata: {
                dsfSha256: plan.sha256,
                dsfByteLength: String(plan.byteLength),
                dsfSchemaVersion: '2',
            },
            sha256: plan.sha256,
        });

        if (!stored) {
            const racedObject = await verifyStoredOrCollision(env.R2_BUCKET, plan);
            if (!racedObject) return jsonError('IMMUTABLE_COLLISION', 409);
            return Response.json(
                { receipt: createReceipt(plan, publicBaseUrl), reused: true },
                { headers: corsHeaders() },
            );
        }
        if (!objectMatchesPlan(stored, plan)) {
            const confirmed = await verifyStoredOrCollision(env.R2_BUCKET, plan);
            if (!confirmed) return jsonError('STORAGE_WRITE_FAILED', 502);
        }

        return Response.json(
            { receipt: createReceipt(plan, publicBaseUrl), reused: false },
            { headers: corsHeaders() },
        );
    } catch (error) {
        console.error('[upload-release] Unexpected error:', error?.message, error?.stack);
        return jsonError('INTERNAL_ERROR', 500);
    }
}

export async function onRequestPost(context) {
    return handleDsfReleaseUpload(context);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}
