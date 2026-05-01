import { getIdToken } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from './firebase-core.js';

function buildAssetProxyUrl(sourceUrl) {
    return `/asset-proxy?url=${encodeURIComponent(sourceUrl)}`;
}

async function getAuthHeaders() {
    try {
        const user = auth.currentUser;
        if (!user) return {};
        const token = await getIdToken(user);
        return { Authorization: `Bearer ${token}` };
    } catch {
        return {};
    }
}

export function shouldEmbedAsset(url) {
    return typeof url === 'string' && (
        url.startsWith('http://')
        || url.startsWith('https://')
        || url.startsWith('blob:')
        || url.startsWith('data:')
    );
}

export function guessAssetExtension(url, fallback = 'webp') {
    if (typeof url !== 'string' || !url) return fallback;
    if (url.startsWith('blob:') || url.startsWith('data:')) return fallback;
    const base = url.split('?')[0].split('#')[0];
    const ext = base.split('.').pop();
    return ext && ext !== base ? ext : fallback;
}

export async function fetchAssetBlob(url, label = '画像') {
    const attempts = resolveAssetFetchUrls(url);
    let lastError = null;
    for (const resolvedUrl of attempts) {
        try {
            const headers = resolvedUrl.startsWith('/asset-proxy') ? await getAuthHeaders() : {};
            const response = await fetch(resolvedUrl, { headers });
            if (!response.ok) {
                throw new Error(`${label} の取得に失敗しました (${response.status})`);
            }
            return await response.blob();
        } catch (e) {
            lastError = e;
        }
    }

    console.error(`[DSF] Failed to fetch asset blob: ${url}`, lastError);
    throw new Error(
        `${label} を取得できませんでした。` +
        `公開画像の再取得経路で失敗しています。`
    );
}

function resolveAssetFetchUrls(url) {
    if (typeof url !== 'string' || !url) return [url];
    if (
        url.startsWith('blob:')
        || url.startsWith('data:')
        || url.startsWith('/')
        || url.startsWith('./')
        || url.startsWith('../')
    ) {
        return [url];
    }

    // Firebase Hosting には /asset-proxy がないため、公開URLはまず直接取得する。
    // Cloudflare Pages では CORS が閉じた公開メディアだけ proxy にフォールバックする。
    return [url, buildAssetProxyUrl(url)];
}

export async function loadImageForCanvas(url, label = '画像') {
    const blob = await fetchAssetBlob(url, label);
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();

    try {
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error(`${label} のロードに失敗しました`));
            img.src = objectUrl;
        });
        return {
            img,
            revoke() {
                URL.revokeObjectURL(objectUrl);
            },
        };
    } catch (e) {
        URL.revokeObjectURL(objectUrl);
        throw e;
    }
}
