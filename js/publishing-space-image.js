// Crop locally; only the resulting small WebP is sent to the server.
export async function prepareSpaceImage(file, slot) {
    if (!['icon','banner'].includes(slot) || !file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('INVALID_IMAGE');
    const bitmap = await createImageBitmap(file);
    try {
        if (bitmap.width * bitmap.height > 40_000_000) throw new Error('INVALID_IMAGE');
        const width = slot === 'icon' ? 256 : 1536, height = slot === 'icon' ? 256 : 512;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(width / bitmap.width, height / bitmap.height);
        ctx.drawImage(bitmap, (width - bitmap.width * scale) / 2, (height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
        const max = slot === 'icon' ? 65536 : 262144;
        for (const quality of [.86,.72,.55,.35]) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',quality));
            if (!blob || blob.type !== 'image/webp') throw new Error('INVALID_IMAGE');
            if (blob.size > max) continue;
            return await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        }
        throw new Error('INVALID_IMAGE');
    } finally { bitmap.close(); }
}
