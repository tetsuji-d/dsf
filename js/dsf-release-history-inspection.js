/** Bounded owner-requested reads composed from the existing release validators. */
import { loadDsfHorizonReleaseBundle } from './dsf-horizon-viewer-load.js';
import { createDsfReleaseStorageAudit } from './dsf-release-orphan-inventory.js';
import { inspectDsfWebPBytes, sha256DsfBytes } from './dsf-release-byte-sealing.js';
import { verifyDsfProductionFontAsset } from './dsf-font-asset-verification.js';
import { DSF_PRODUCTION_FONT_REGISTRY } from './dsf-font-registry.js';
import { resolveWorksDsfRelease } from './works-dsf-release.js';
import { releaseInspectionKey } from './works-release-history.js';

function stop(reason) { throw Object.assign(new Error('Release inspection stopped.'), { historyReason: reason }); }
const CACHE = 'public, max-age=31536000, immutable';
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 2000;

export async function inspectReleaseHistory(input) {
    const { uid, workId, releaseId, release, inventoryPages, signal } = input;
    const now = input.now;
    if (!Number.isFinite(now)) throw new TypeError('An explicit inspection time is required.');
    const key = releaseInspectionKey(input);
    let pageCounts = null;
    let kindsByLanguage = null;
    const result = (status, reason = null) => Object.freeze({ key, status, reason, checkedAt: now, pageCounts, kindsByLanguage });
    let consumed = 0;
    let requests = 0;
    let readFailure = null;
    const fetchImpl = input.fetchImpl || globalThis.fetch;
    const readResponse = async (url, options = {}) => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (++requests > MAX_FILES) stop('incomplete');
        const response = await fetchImpl(url, { ...options, method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
        if (!response.ok) stop('unavailable');
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_BYTES - consumed) stop('incomplete');
        // Bound bytes while streaming, including responses without Content-Length.
        const reader = response.body?.getReader();
        const chunks = [];
        let size = 0;
        if (reader) {
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done) break;
                    size += part.value.byteLength;
                    if (consumed + size > MAX_BYTES) { await reader.cancel(); stop('incomplete'); }
                    chunks.push(part.value);
                }
            } finally { reader.releaseLock(); }
        } else {
            const bytes = new Uint8Array(await response.arrayBuffer());
            size = bytes.byteLength;
            if (consumed + size > MAX_BYTES) stop('incomplete');
            chunks.push(bytes);
        }
        consumed += size;
        return new Response(new Blob(chunks), { status: 200, headers: response.headers });
    };
    const boundedFetch = async (url, options) => {
        try { return await readResponse(url, options); }
        catch (error) {
            if (error?.name !== 'AbortError') readFailure = error.historyReason || 'unavailable';
            throw error;
        }
    };
    try {
        const projection = resolveWorksDsfRelease(release, input);
        const audit = createDsfReleaseStorageAudit({ uid, inventoryPages, now,
            projects: input.project ? [{ ...input.project, projectId: input.projectId }] : [],
            works: input.work ? [input.work] : [], releases: [release],
            publicIndexes: input.publicIndex ? [input.publicIndex] : [],
        });
        if (!audit.complete) return result('incomplete', 'incomplete');
        const root = `users/${uid}/dsf/${workId}/${releaseId}/`;
        const objects = new Map(inventoryPages.flatMap(page => page.objects).filter(item => item.storagePath.startsWith(root)).map(item => [item.storagePath, item]));
        if (!objects.size) stop('missing');
        const group = audit.releaseGroups.find(item => item.workId === workId && item.releaseId === releaseId);
        if (group?.issueCodes.length) stop('mismatch');
        const files = new Map();
        const pathOf = url => {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.search || parsed.hash || parsed.username || parsed.password
                || !input.allowedContentOrigins.includes(parsed.origin) || !parsed.pathname.startsWith(`/${root}`)) stop('legacy_evidence');
            return parsed.pathname.slice(1);
        };
        const add = file => {
            const path = pathOf(file.url);
            const previous = files.get(path);
            if (previous && ['width', 'height', 'byteLength', 'sha256', 'mime'].some(field =>
                previous[field] !== undefined && file[field] !== undefined && previous[field] !== file[field])) stop('mismatch');
            files.set(path, { ...previous, ...file });
        };
        if (projection.schemaVersion === 2) {
            const loaded = await loadDsfHorizonReleaseBundle({ ...input, publicMetadata: release, releaseMetadata: release, fetchImpl: boundedFetch });
            loaded.files.forEach(file => add({ ...file, mime: 'application/json' }));
            pageCounts = {};
            kindsByLanguage = {};
            for (const [language, manifest] of Object.entries(loaded.bundle.manifests)) {
                pageCounts[language] = manifest.pages.length;
                kindsByLanguage[language] = { fixedText: 0, webp: 0 };
                for (const page of manifest.pages) {
                    kindsByLanguage[language][page.renderKind === 'fixedText' ? 'fixedText' : 'webp']++;
                    if (page.renderKind === 'image') add({ url: loaded.assetUrls.get(page.image.href), mime: 'image/webp', width: page.image.width, height: page.image.height });
                    if (page.background?.imageHref) add({ url: loaded.assetUrls.get(page.background.imageHref), mime: 'image/webp' });
                }
            }
            const registry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
            for (const [fontId, declaration] of Object.entries(loaded.bundle.index.fonts || {})) {
                const response = await boundedFetch(declaration.href);
                if (response.headers.get('content-type')?.split(';')[0] !== 'font/woff2') stop('mismatch');
                await verifyDsfProductionFontAsset({ registry, fontId, bytes: await response.arrayBuffer() });
            }
        } else {
            pageCounts = {};
            kindsByLanguage = {};
            if (!projection.languages.length) stop('legacy_evidence');
            for (const language of projection.languages) {
                pageCounts[language] = 0;
                for (const page of release.dsfPages) {
                    const url = typeof page === 'string' ? page : page.urls?.[language] || (!page.urls ? page.url : null);
                    const byteLength = page?.bytesByLang?.[language];
                    if (!url || !Number.isSafeInteger(byteLength) || byteLength < 1) stop('legacy_evidence');
                    add({ url, byteLength, mime: 'image/webp' });
                    pageCounts[language]++;
                }
                kindsByLanguage[language] = { fixedText: 0, webp: pageCounts[language] };
            }
        }
        if (!files.size) stop('missing');
        let total = 0;
        for (const [path, file] of files) {
            const stored = objects.get(path);
            if (!stored) stop('missing');
            if (stored.httpMetadata.contentType !== file.mime || (file.byteLength && stored.byteLength !== file.byteLength)) stop('mismatch');
            if (projection.schemaVersion === 2 && (stored.httpMetadata.cacheControl !== CACHE
                || stored.customMetadata.dsfSchemaVersion !== '2' || stored.customMetadata.dsfByteLength !== String(stored.byteLength)
                || !/^[a-f0-9]{64}$/.test(stored.customMetadata.dsfSha256 || '')
                || (file.sha256 && stored.customMetadata.dsfSha256 !== file.sha256))) stop('mismatch');
            total += stored.byteLength;
            if (file.mime === 'image/webp') {
                const response = await boundedFetch(file.url);
                if (response.headers.get('content-type')?.split(';')[0] !== 'image/webp') stop('mismatch');
                const bytes = await response.arrayBuffer();
                const shape = await inspectDsfWebPBytes(bytes);
                if (bytes.byteLength !== stored.byteLength || (file.width && (file.width !== shape.width || file.height !== shape.height))) stop('mismatch');
                if (projection.schemaVersion === 2 && await sha256DsfBytes(bytes) !== stored.customMetadata.dsfSha256) stop('mismatch');
            }
        }
        if (objects.size !== files.size || total !== release.dsfTotalBytes) stop('mismatch');
        return result('verified');
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const reason = readFailure || error.historyReason || (error instanceof TypeError ? 'unavailable' : 'mismatch');
        return result(['unavailable', 'incomplete', 'legacy_evidence'].includes(reason) ? 'incomplete' : 'inconsistent', reason);
    }
}
