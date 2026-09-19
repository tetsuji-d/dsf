import { check, readBounded } from './common.js';
import { loadDsfHorizonReleaseBundle } from '../../js/dsf-horizon-viewer-load.js';
import { isManagedPublicationThumbnailUrl } from '../../js/project-listing-thumbnail.js';

/** Reads only the bound public bucket. Caller URLs never become network fetches. */
export function createReleaseVerifier(bucket, publicBaseUrl) {
    function key(url, prefix) {
        const base = new URL(publicBaseUrl), parsed = new URL(url);
        check(base.protocol === 'https:' && parsed.origin === base.origin && !parsed.search && !parsed.hash
            && !parsed.username && !parsed.password && parsed.pathname.startsWith(`/${prefix}`)
            && !/%|\\/.test(parsed.pathname), 'RELEASE_ASSET_SCOPE', 422);
        return parsed.pathname.slice(1);
    }
    async function head(url, prefix) {
        check(bucket?.head, 'CONFIG_PUBLIC_BUCKET');
        const object = await bucket.head(key(url, prefix));
        check(object && Number.isSafeInteger(object.size) && object.size > 0, 'RELEASE_ASSET_MISSING', 422);
        return object;
    }
    return async ({ uid, workId, releaseId, payload, metadata }) => {
        check(isManagedPublicationThumbnailUrl(payload.thumbnail, { ownerUid: uid, r2PublicBaseUrl: publicBaseUrl }), 'RELEASE_THUMBNAIL_INVALID', 422);
        const thumbnail = await head(payload.thumbnail, `users/${uid}/dsf/publication-thumbnails/`);
        check(thumbnail.httpMetadata?.contentType === 'image/webp', 'RELEASE_THUMBNAIL_INVALID', 422);
        const prefix = `users/${uid}/dsf/${workId}/${releaseId}/`;
        if (!payload.upload) {
            let bytes = 0, count = 0;
            check(Array.isArray(payload.dsfPages) && payload.dsfPages.length > 0 && payload.dsfPages.length <= 500, 'RELEASE_PAGES_INVALID', 422);
            for (const page of payload.dsfPages) {
                check(page.workId === workId && page.releaseId === releaseId && page.urls && Object.keys(page.urls).length > 0 && Object.keys(page.urls).length <= 16, 'RELEASE_IDENTITY_INVALID', 422);
                for (const url of Object.values(page.urls)) {
                    check(++count <= 512, 'RELEASE_TOO_MANY_FILES', 422);
                    const object = await head(url, prefix);
                    check(object.httpMetadata?.contentType === 'image/webp', 'RELEASE_ASSET_INVALID', 422); bytes += object.size;
                }
            }
            return bytes;
        }
        const receipts = payload.upload.receipts;
        check(Array.isArray(receipts) && receipts.length > 0 && receipts.length <= 512, 'RELEASE_RECEIPTS_INVALID', 422);
        const files = new Map(); let bytes = 0;
        for (const receipt of receipts) {
            check(receipt?.storagePath?.startsWith(prefix) && receipt.publicUrl === `${new URL(publicBaseUrl).origin}/${receipt.storagePath}`
                && !files.has(receipt.publicUrl), 'RELEASE_RECEIPTS_INVALID', 422);
            const object = await head(receipt.publicUrl, prefix);
            check(object.size === receipt.byteLength && object.customMetadata?.dsfSha256 === receipt.sha256
                && object.customMetadata?.dsfSchemaVersion === '2' && object.httpMetadata?.contentType === receipt.mimeType,
            'RELEASE_RECEIPT_MISMATCH', 422);
            files.set(receipt.publicUrl, receipt); bytes += object.size;
        }
        check(bytes === metadata.dsfTotalBytes, 'RELEASE_SIZE_MISMATCH', 422);
        let jsonBytes = 0;
        const bundle = await loadDsfHorizonReleaseBundle({ uid, workId, releaseId,
            publicMetadata: { ...metadata, defaultLang: payload.upload.seal.publicLocator.defaultLang },
            allowedContentOrigins: [new URL(publicBaseUrl).origin],
            fetchImpl: async url => {
                check(files.has(url), 'RELEASE_RECEIPT_MISSING', 422);
                const object = await bucket.get(key(url, prefix));
                check(object && object.size <= 4 * 1024 * 1024, 'RELEASE_JSON_TOO_LARGE', 422);
                jsonBytes += object.size; check(jsonBytes <= 8 * 1024 * 1024, 'RELEASE_JSON_TOO_LARGE', 422);
                const data = await readBounded(object.body, object.size);
                return new Response(data, { headers: { 'Content-Type': 'application/json' } });
            },
        });
        const urls = new Set([...bundle.files.map(file => file.url), ...bundle.assetUrls.values()]);
        check(urls.size === files.size && [...urls].every(url => files.has(url)), 'RELEASE_RECEIPT_SET_MISMATCH', 422);
        return bytes;
    };
}
