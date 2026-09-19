import { AuthoringApiError, check, fetchJson, parseJson, segment } from './common.js';

const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const encode = (value) => new TextEncoder().encode(value);
function base64url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function decode(value) {
    check(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'AUTH_INVALID', 401);
    try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
    catch { throw new AuthoringApiError('AUTH_INVALID', 401); }
}

/** One verifier per runtime; public keys follow the provider's cache lifetime. */
export function createIdTokenVerifier({ projectId, fetcher = fetch, now = Date.now }) {
    let keys = null;
    let expiresAt = 0;
    let refreshedAt = -Infinity;
    let loading;
    async function refresh() {
        if (!loading) loading = (async () => {
            const result = await fetchJson(fetcher, KEYS_URL);
            check(Array.isArray(result.data.keys), 'AUTH_KEYS_UNAVAILABLE');
            keys = result.data.keys;
            const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(result.headers.get('cache-control') || '');
            const age = Number(result.headers.get('age') || 0);
            const seconds = Math.max(0, Math.min(3600, Number(maxAge?.[1] || 0) - (Number.isFinite(age) ? age : 0)));
            refreshedAt = now();
            expiresAt = now() + seconds * 1000;
        })().finally(() => { loading = null; });
        await loading;
    }
    return async (token) => {
        check(typeof token === 'string' && token.length <= 16384, 'AUTH_INVALID', 401);
        const parts = token.split('.');
        check(parts.length === 3, 'AUTH_INVALID', 401);
        let header, claims;
        try { header = parseJson(decode(parts[0])); claims = parseJson(decode(parts[1])); }
        catch { throw new AuthoringApiError('AUTH_INVALID', 401); }
        const time = Math.floor(now() / 1000);
        check(header?.alg === 'RS256' && typeof header.kid === 'string' && header.kid.length <= 128
            && !header.crit && !header.jku && !header.jwk, 'AUTH_INVALID', 401);
        check(claims?.aud === projectId && claims.iss === `https://securetoken.google.com/${projectId}`
            && Number.isSafeInteger(claims.exp) && claims.exp > time
            && Number.isSafeInteger(claims.iat) && claims.iat <= time && claims.iat >= 0
            && Number.isSafeInteger(claims.auth_time) && claims.auth_time <= claims.iat && claims.auth_time >= 0
            && claims.exp > claims.iat && !claims.firebase?.tenant,
        'AUTH_INVALID', 401);
        try { segment(claims.sub); } catch { throw new AuthoringApiError('AUTH_INVALID', 401); }
        if (!keys || now() >= expiresAt) await refresh();
        let key = keys.find(item => item.kid === header.kid && item.alg === 'RS256' && item.kty === 'RSA' && (!item.use || item.use === 'sig'));
        if (!key && now() - refreshedAt >= 60_000) {
            await refresh();
            key = keys.find(item => item.kid === header.kid && item.alg === 'RS256' && item.kty === 'RSA' && (!item.use || item.use === 'sig'));
        }
        check(key, 'AUTH_INVALID', 401);
        let valid = false;
        try {
            const imported = await crypto.subtle.importKey('jwk', key, algorithm, false, ['verify']);
            valid = await crypto.subtle.verify(algorithm, imported, decode(parts[2]), encode(`${parts[0]}.${parts[1]}`));
        } catch { /* fail closed without logging the token */ }
        check(valid, 'AUTH_INVALID', 401);
        return Object.freeze({ uid: claims.sub, authTime: claims.auth_time, expiresAt: claims.exp });
    };
}

/** Secrets stay server-side; all Google endpoints and OAuth scopes are fixed. */
export function createGoogleClient({ projectId, serviceAccountJson, fetcher = fetch, now = Date.now }) {
    check(typeof projectId === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId), 'CONFIG_FIREBASE_PROJECT');
    let credential;
    try { credential = JSON.parse(serviceAccountJson); } catch { throw new AuthoringApiError('CONFIG_SERVICE_ACCOUNT'); }
    check(credential?.project_id === projectId && credential.type === 'service_account'
        && typeof credential.client_email === 'string' && credential.client_email.endsWith('.iam.gserviceaccount.com')
        && typeof credential.private_key === 'string', 'CONFIG_SERVICE_ACCOUNT');
    let accessToken;
    let expiresAt = 0;
    let loading;
    let signingKey;
    async function getAccessToken() {
        if (accessToken && now() < expiresAt) return accessToken;
        if (!loading) loading = (async () => {
            if (!signingKey) {
                try {
                    const pem = credential.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
                    signingKey = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), algorithm, false, ['sign']);
                } catch { throw new AuthoringApiError('CONFIG_SERVICE_ACCOUNT'); }
            }
            const time = Math.floor(now() / 1000);
            const header = base64url(encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
            const claims = base64url(encode(JSON.stringify({
                iss: credential.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
                aud: TOKEN_URL, iat: time, exp: time + 3600,
            })));
            const unsigned = `${header}.${claims}`;
            const signature = await crypto.subtle.sign(algorithm, signingKey, encode(unsigned));
            const { data } = await fetchJson(fetcher, TOKEN_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }).toString(),
            });
            check(typeof data.access_token === 'string' && data.access_token.length > 0
                && Number.isFinite(data.expires_in) && data.expires_in > 60, 'OAUTH_INVALID_RESPONSE');
            accessToken = data.access_token;
            expiresAt = now() + Math.min(3540, data.expires_in - 60) * 1000;
        })().finally(() => { loading = null; });
        await loading;
        return accessToken;
    }
    async function post(url, body) {
        const token = await getAccessToken();
        return (await fetchJson(fetcher, url, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).data;
    }
    return {
        projectId, post,
        async assertLiveIdentity(identity) {
            segment(identity.uid);
            check(identity.expiresAt > Math.floor(now() / 1000), 'AUTH_EXPIRED', 401);
            const result = await post(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, { localId: [identity.uid] });
            const account = result.users?.find(user => user.localId === identity.uid);
            check(account && account.disabled !== true, 'AUTH_DISABLED', 403);
            const validSince = Number(account.validSince ?? 0);
            check(Number.isFinite(validSince) && validSince >= 0 && identity.authTime >= validSince, 'AUTH_REVOKED', 401);
        },
    };
}
