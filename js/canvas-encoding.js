const WEBP_SIGNATURE_BYTES = Object.freeze({
    riff: [0x52, 0x49, 0x46, 0x46],
    webp: [0x57, 0x45, 0x42, 0x50]
});

export const WEBP_UNSUPPORTED_MESSAGE =
    'この端末またはブラウザではWebPエンコードが利用できません。PC版Chrome/EdgeなどWebP対応ブラウザで発行してください。';

export async function isWebPBlob(blob) {
    if (!(blob instanceof Blob)) return false;
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (header.length < 12) return false;
    return WEBP_SIGNATURE_BYTES.riff.every((byte, idx) => header[idx] === byte)
        && WEBP_SIGNATURE_BYTES.webp.every((byte, idx) => header[idx + 8] === byte);
}

/**
 * canvas.toBlob('image/webp') は iOS Safari 等で null になるか PNG にフォールバックする。
 * その場合は libwebp WASM で ImageData から WebP を生成する。
 *
 * lossless: 二値画像など色数が極端に少ないとき、ロッシー q=100 よりロスレスの方が小さくなることが多い。
 */
async function encodeCanvasToWebPWithWasm(canvas, quality, label, lossless) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error(`${label}のWebP変換に失敗しました（2D コンテキストを取得できません）。`);
    }
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) {
        throw new Error(`${label}のWebP変換に失敗しました（キャンバスサイズが無効です）。`);
    }
    const imageData = ctx.getImageData(0, 0, w, h);
    const { encode } = await import('@jsquash/webp');
    const wasmOpts = lossless
        ? { lossless: 1, exact: 1 }
        : { quality: Math.min(100, Math.max(1, Math.round(Number(quality) * 100))) };
    const buffer = await encode(imageData, wasmOpts);
    const blob = new Blob([buffer], { type: 'image/webp' });
    if (!(await isWebPBlob(blob))) {
        throw new Error(`${label}のWebP変換に失敗しました（WASM 出力の検証に失敗）。`);
    }
    return blob;
}

async function tryNativeCanvasWebP(canvas, quality) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) return null;
    if (blob.type !== 'image/webp' || !(await isWebPBlob(blob))) return null;
    return blob;
}

/**
 * @param {number} quality - 0〜1（ロッシー）。opts.lossless のときは WASM 側で無視される。
 * @param {{ lossless?: boolean }} [opts] - lossless: true のときネイティブを試さず WebP ロスレス（WASM）のみ。
 */
export async function encodeCanvasToWebP(canvas, quality = 0.82, label = 'Canvas', opts = {}) {
    const lossless = !!(opts && opts.lossless);
    if (!lossless) {
        const native = await tryNativeCanvasWebP(canvas, quality);
        if (native) return native;
    }
    try {
        return await encodeCanvasToWebPWithWasm(canvas, quality, label, lossless);
    } catch (e) {
        const msg = e && typeof e.message === 'string' ? e.message : String(e);
        const detail = lossless
            ? `ロスレス WebP（WASM）に失敗: ${msg}`
            : `ネイティブ非対応のため WASM にフォールバックしましたが失敗: ${msg}`;
        throw new Error(`${label}のWebP変換に失敗しました（${detail}）。`);
    }
}
