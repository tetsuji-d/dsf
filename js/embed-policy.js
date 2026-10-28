import {normalizeEmbedDisplay} from './embed-layout.js';
export function normalizeEmbedPolicy(value = { mode: 'off', allowedOrigins: [] }) {
    if (!value || !['off', 'any', 'allowlist'].includes(value.mode) || !Array.isArray(value.allowedOrigins) || value.allowedOrigins.length > 20) throw new Error('EMBED_POLICY_INVALID');
    const origins = value.allowedOrigins.map(input => {
        if (typeof input !== 'string' || input.length > 253 || /[\s\\]/u.test(input)) throw new Error('EMBED_DOMAIN_INVALID');
        let url;
        try { url = new URL(input.includes('://') ? input : `https://${input}`); } catch { throw new Error('EMBED_DOMAIN_INVALID'); }
        if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
            || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(url.hostname)) throw new Error('EMBED_DOMAIN_INVALID');
        return url.origin;
    });
    const allowedOrigins = [...new Set(origins)].sort();
    if (value.mode === 'allowlist' && !allowedOrigins.length) throw new Error('EMBED_DOMAIN_REQUIRED');
    return { version: 1, mode: value.mode, allowedOrigins: value.mode === 'allowlist' ? allowedOrigins : [] };
}
export function embedAncestors(policy) {
    const value = normalizeEmbedPolicy(policy);
    return value.mode === 'off' ? "'none'" : value.mode === 'any' ? 'https:' : value.allowedOrigins.join(' ');
}
export function embedCode(id, title, origin, options = {}) {
    if (!/^e_[a-f0-9]{64}$/.test(id)) throw new Error('EDITION_ID_INVALID');
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const base = new URL(origin).origin;
    const {layout,bookEdges,view,startPage}=normalizeEmbedDisplay(options);
    const query = new URLSearchParams({layout, bookEdges: bookEdges ? '1' : '0',view,page:String(startPage)});
    return `<style>.dsf-horizon-embed{width:100%;max-width:720px;margin-inline:auto;container-type:inline-size}.dsf-horizon-embed>iframe{display:block;width:100%;height:min(640px,177.778cqw,80svh);border:0}@container(min-width:640px){.dsf-horizon-embed>iframe[data-layout="auto"],.dsf-horizon-embed>iframe[data-layout="spread"]{height:min(640px,88.889cqw,80svh)}}</style><div class="dsf-horizon-embed"><iframe src="${base}/embed/${id}?${esc(query)}" data-layout="${layout}" title="${esc(title || 'DSF Reader')}" width="100%" height="640" loading="lazy" allow="fullscreen" allowfullscreen style="width:100%;border:0;background:transparent"></iframe></div>`;
}
