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

export async function encodeCanvasToWebP(canvas, quality = 0.82, label = 'Canvas') {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) {
        throw new Error(`${label}のWebP変換に失敗しました（canvas.toBlob が null を返しました）。`);
    }
    if (blob.type !== 'image/webp' || !(await isWebPBlob(blob))) {
        throw new Error(`${label}のWebP変換に失敗しました。${WEBP_UNSUPPORTED_MESSAGE}`);
    }
    return blob;
}
