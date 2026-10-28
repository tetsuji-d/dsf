import { readerStore, readEditionAccess, json } from '../../server/reader-access.js';
export async function onRequest({ request, env }) {
    if (request.method !== 'GET') return json({error:'METHOD_NOT_ALLOWED'},405);
    try {
        const id = new URL(request.url).searchParams.get('edition');
        const access = await readerStore(env).transaction(tx => readEditionAccess(tx,id));
        if (access.policy.mode === 'off') return json({error:'EMBED_DISABLED'},403);
        const { record:r } = access;
        return json({editionId:id,revision:access.revision,title:r.title || '',thumbnail:r.thumbnail || '',
            editionLabel:r.editionLabel || '',authorName:r.authorName || '',policy:access.policy,
            defaultLang:r.defaultLang || r.languages?.[0] || r.dsfLangs?.[0] || 'ja',
            languageConfigs:r.languageConfigs || {}, pageCount:r.pageCount || 0,
            dsfContentUrl:r.dsfSchemaVersion===2 ? r.dsfContentUrl : null,
            dsfContentHash:r.dsfSchemaVersion===2 ? r.dsfContentHash : null});
    } catch (error) { return json({error:error.code || 'EDITION_UNAVAILABLE'}, error.status || 503); }
}
