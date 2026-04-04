/**
 * Cloudflare Pages Function: GET /asset-proxy?url=<encoded-url>
 *
 * Fetches public image assets server-side and returns them from the same origin
 * as the Pages app. This avoids browser-side CORS failures when the editor
 * needs to re-fetch public assets for rendering/export.
 */

const ALLOWED_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'media.dsf.ink',
    'media-staging.dsf.ink',
]);

export async function onRequestGet({ request }) {
    try {
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
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}

function jsonError(message, status) {
    return Response.json(
        { error: message },
        {
            status,
            headers: {
                'Access-Control-Allow-Origin': '*',
            },
        }
    );
}
