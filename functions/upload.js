/**
 * Cloudflare Pages Function: POST /upload
 * Handles authenticated image uploads to Cloudflare R2 storage.
 *
 * Required bindings (configure in Cloudflare Pages dashboard or wrangler.toml):
 *   R2_BUCKET        — R2 bucket binding (Resource)
 *   R2_PUBLIC_URL    — Public base URL for the R2 bucket (Environment variable)
 *   FIREBASE_PROJECT_ID — Firebase project ID for ID token verification (Environment variable)
 *
 * Request:
 *   POST /upload
 *   Authorization: Bearer <firebase-id-token>
 *   Content-Type: multipart/form-data
 *   Body fields:
 *     file — image Blob
 *     path — storage path, e.g. "users/<uid>/dsf/1234567890_image.webp"
 *
 * Response (200):
 *   { url: "https://media.dsf.ink/users/<uid>/dsf/1234567890_image.webp" }
 *
 * Error response:
 *   { error: "<message>" }
 */

export async function onRequestPost({ request, env }) {
    try {
        // 1. Verify Firebase Auth ID token
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return jsonError('Unauthorized', 401);
        }
        const projectId = env.FIREBASE_PROJECT_ID || 'vmnn-26345';
        const uid = await verifyFirebaseToken(authHeader.slice(7), projectId);
        if (!uid) return jsonError('Unauthorized', 401);

        // 2. Parse multipart form data
        const formData = await request.formData();
        const file = formData.get('file');
        const path = formData.get('path');
        if (!file || !path) return jsonError('Missing file or path', 400);

        // Security: enforce that the path is under the authenticated user's directory
        if (!path.startsWith(`users/${uid}/`)) {
            return jsonError('Forbidden: path must be under users/<uid>/', 403);
        }

        // 3. Upload to R2
        const buffer = await file.arrayBuffer();
        await env.R2_BUCKET.put(path, buffer, {
            httpMetadata: { contentType: file.type || 'image/webp' },
        });

        // 4. Return the public URL
        const publicUrl = `${env.R2_PUBLIC_URL}/${path}`;
        return Response.json({ url: publicUrl }, { headers: corsHeaders() });

    } catch (e) {
        console.error('[upload] Unexpected error:', e.message);
        return jsonError('Internal server error', 500);
    }
}

// Handle CORS preflight
export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonError(msg, status) {
    return Response.json({ error: msg }, { status, headers: corsHeaders() });
}

// ── Firebase ID token verification via Web Crypto API ────────────────────────
// Uses the Google JWK endpoint (RS256). No external dependencies required.

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
    _jwkCacheExpiry = Date.now() + 3_600_000; // cache for 1 hour
    return keys;
}

/**
 * Verifies a Firebase ID token and returns the user UID, or null on failure.
 */
async function verifyFirebaseToken(token, projectId) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) { console.error('[upload] Bad JWT parts:', parts.length); return null; }
        const [h, p, s] = parts;

        const header  = JSON.parse(b64Decode(h));
        const payload = JSON.parse(b64Decode(p));

        // Validate standard JWT claims for Firebase
        const now = Math.floor(Date.now() / 1000);
        if (payload.aud !== projectId)                                    { console.error('[upload] aud mismatch:', payload.aud, '!=', projectId); return null; }
        if (payload.iss !== `https://securetoken.google.com/${projectId}`) { console.error('[upload] iss mismatch:', payload.iss); return null; }
        if (payload.exp < now)                                             { console.error('[upload] token expired'); return null; }
        if (payload.iat > now + 300)                                       { console.error('[upload] iat too far in future'); return null; }
        if (!payload.sub)                                                  { console.error('[upload] no sub'); return null; }

        // Find the matching JWK by key ID
        const keys = await getFirebasePublicKeys();
        const jwk = keys.find(k => k.kid === header.kid && k.alg === 'RS256');
        if (!jwk) { console.error('[upload] JWK not found for kid:', header.kid); return null; }

        // Import the public key and verify the RS256 signature
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
        if (!valid) { console.error('[upload] signature invalid'); return null; }
        return payload.sub;

    } catch (e) {
        console.error('[upload] Token verification error:', e.message);
        return null;
    }
}

function b64Decode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
}

function b64UrlDecode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const bin = atob(padded);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
}
