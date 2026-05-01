/**
 * Same-origin GET proxy for viewer dev morph: avoids browser CORS on fetch() to R2/media.
 * Allowlisted hostnames only.
 */
const ALLOWED_HOSTS = new Set([
    'media-staging.dsf.link',
    'media-staging.dsf.ink',
    'media.dsf.ink',
    'media.dsf.link',
    'firebasestorage.googleapis.com'
]);

export async function onRequestGet(context) {
    const requestUrl = new URL(context.request.url);
    const raw = requestUrl.searchParams.get('u');
    if (!raw) {
        return new Response('Missing u', { status: 400 });
    }
    let target;
    try {
        target = new URL(raw);
    } catch {
        return new Response('Invalid URL', { status: 400 });
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        return new Response('Bad protocol', { status: 400 });
    }
    if (!ALLOWED_HOSTS.has(target.hostname)) {
        return new Response('Host not allowed', { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*' }
    });

    const headers = new Headers();
    const ct = upstream.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    headers.set('Cache-Control', upstream.headers.get('Cache-Control') || 'public, max-age=300');

    return new Response(upstream.body, {
        status: upstream.status,
        headers
    });
}
