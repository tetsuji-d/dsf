import { readerStore, readEditionAccess } from '../../server/reader-access.js';
import { embedAncestors } from '../../js/embed-policy.js';
export async function onRequest({ request, env, params }) {
    const headers = { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'CDN-Cache-Control':'no-store',
        'Content-Security-Policy':"frame-ancestors 'none'", 'X-Robots-Tag':'noindex', 'X-Content-Type-Options':'nosniff' };
    try {
        if (!['GET','HEAD'].includes(request.method)) return new Response('',{status:405,headers});
        const access = await readerStore(env).transaction(tx => readEditionAccess(tx,params.editionId));
        if (access.policy.mode === 'off') return new Response('埋め込みは許可されていません / Embedding is disabled.',{status:403,headers});
        headers['Content-Security-Policy'] = `frame-ancestors ${embedAncestors(access.policy)}`;
        const asset = await env.ASSETS.fetch(new URL('/viewer.html',request.url));
        if (!asset.ok) throw new Error('SHELL_UNAVAILABLE');
        let html = await asset.text();
        // Permission is on this response, never on an unprotected static alias.
        html = html.replace(/<script\b[^>]*src="\/platform-update-entry\.js[^>]*><\/script>/g,'');
        html = html.replace(/<script\b[^>]*src="https:\/\/accounts\.google\.com[^>]*><\/script>/g,'');
        return new Response(request.method === 'HEAD' ? null : html,{headers});
    } catch (error) { return new Response('現在この版を表示できません / Edition unavailable.',{status:error.status || 503,headers}); }
}
