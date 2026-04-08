/**
 * Cloudflare Pages Function: GET /asset-proxy?url=<encoded-url>
 *
 * Fetches public image assets server-side and returns them from the same origin
 * as the Pages app. This avoids browser-side CORS failures when the editor
 * needs to re-fetch public assets for rendering/export.
 *
 * Required env vars (same as upload.js):
 *   FIREBASE_PROJECT_ID — Firebase project ID for ID token verification
 */

const ALLOWED_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'media.dsf.ink',
    'media-staging.dsf.ink',
]);

export async function onRequestGet({ request, env }) {
    try {
        // 1. Firebase Auth ID token 検証
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return jsonError('Unauthorized', 401);
        }
        const projectId = env.FIREBASE_PROJECT_ID || 'vmnn-26345';
        const uid = await verifyFirebaseToken(authHeader.slice(7), projectId);
        if (!uid) return jsonError('Unauthorized', 401);

        // 2. URL 検証
        const requestUrl = new URL(request.url);
        const rawTarget = requestUrl.searchParams.get('url');
        if (!rawTarget) return jsonError('Missing url parameter', 400);

        const target = new URL(rawTarget);
        if (!['https:', 'http:'].includes(target.protocol)) {
            return jsonError('Unsupported protocol', 400);
        }
        if (!ALLOWED_HOSTS.has(target.hostname)) {
            return jsonError('Host not allowed', 403);
        }

        // 3. アップストリームフェッチ
        const upstream = await fetch(target.toString(), {
            redirect: 'follow',
            cf: {
                cacheTtl: 3600,
                cacheEverything: true,
            },
        });
        if (!upstream.ok) {
            return jsonError(`Upstream fetch failed (${upstream.status})`, upstream.status);
        }

        const headers = new Headers();
        const contentType = upstream.headers.get('content-type');
        if (contentType) headers.set('Content-Type', contentType);
        headers.set('Cache-Control', upstream.headers.get('Cache-Control') || 'public, max-age=3600');
        headers.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, {
            status: upstream.status,
            headers,
        });
    } catch (e) {
        console.error('[asset-proxy] Unexpected error:', e.message, e.stack);
        return jsonError('Internal server error', 500);
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}

function jsonError(message, status) {
    return Response.json(
        { error: message },
        { status, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
}

// ── Firebase ID token verification (same as upload.js) ───────────────────────

let _jwkCache = null;
let _jwkCacheExpiry = 0;

async function getFirebasePublicKeys() {
    if (_jwkCache && Date.now() < _jwkCacheExpiry) return _jwkCache;
    const res = await fetch(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
    );
    if (!res.ok) throw new Error('Failed to fetch Firebase public keys');
    const { keys } = await res.json();
    _jwkCache = keys;
    _jwkCacheExpiry = Date.now() + 3_600_000;
    return keys;
}

async function verifyFirebaseToken(token, projectId) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [h, p, s] = parts;

        const header  = JSON.parse(b64Decode(h));
        const payload = JSON.parse(b64Decode(p));

        const now = Math.floor(Date.now() / 1000);
        if (payload.aud !== projectId)                                     return null;
        if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
        if (payload.exp < now)                                             return null;
        if (payload.iat > now + 300)                                       return null;
        if (!payload.sub)                                                  return null;

        const keys = await getFirebasePublicKeys();
        const jwk = keys.find(k => k.kid === header.kid && k.alg === 'RS256');
        if (!jwk) return null;

        const cryptoKey = await crypto.subtle.importKey(
            'jwk', jwk,
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false, ['verify']
        );
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            b64UrlDecode(s),
            new TextEncoder().encode(`${h}.${p}`)
        );
        return valid ? payload.sub : null;
    } catch (e) {
        console.error('[asset-proxy] Token verification error:', e.message);
        return null;
    }
}

function b64Decode(str) {
    return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64UrlDecode(str) {
    const bin = b64Decode(str);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
