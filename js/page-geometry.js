/**
 * Canonical logical page geometry (9:16) — single source of truth.
 * Editor, Viewer stage, and Press rasterization use this frame for coordinates.
 * Physical WebP export: use integer scale k from this base (default min k = 3 → 1080×1920).
 * @see docs/implementation-plan-9-16-layout.md
 */

export const CANONICAL_PAGE_WIDTH = 360;
export const CANONICAL_PAGE_HEIGHT = 640;
export const CANONICAL_PAGE_ASPECT = CANONICAL_PAGE_WIDTH / CANONICAL_PAGE_HEIGHT;

/** Minimum integer scale logical → physical pixels (product default). */
export const CANONICAL_PAGE_EXPORT_SCALE_MIN = 3;

export const MIN_EXPORT_PAGE_WIDTH = CANONICAL_PAGE_WIDTH * CANONICAL_PAGE_EXPORT_SCALE_MIN;
export const MIN_EXPORT_PAGE_HEIGHT = CANONICAL_PAGE_HEIGHT * CANONICAL_PAGE_EXPORT_SCALE_MIN;

/**
 * `meta.json` → `presentation.aspectRatio` の正規表記（ZIP 仕様・エディター・ビューワーで共通）。
 * 論理ピクセル比は CANONICAL_PAGE_WIDTH : CANONICAL_PAGE_HEIGHT（= 9:16）。
 */
export const META_PRESENTATION_ASPECT_RATIO = '9:16';

/**
 * Press / WebP 出力の整数倍スケールプリセット。
 * `tier: 'preview'` はサイズ見積もり・ローカル検証向け。クラウド発行は {@link clampPressPublishResolutionKey} で `publish` のみに昇格。
 */
export const PRESS_RESOLUTION_PRESETS = [
    { key: '360x640', scale: 1, tier: 'preview' },
    { key: '720x1280', scale: 2, tier: 'preview' },
    { key: '1080x1920', scale: 3, tier: 'publish' },
    { key: '1440x2560', scale: 4, tier: 'publish' },
    { key: '2160x3840', scale: 6, tier: 'publish' }
];

/**
 * @param {string} raw `<select>` の value など
 * @returns {string} 正規化された preset key（不明時は 1080x1920）
 */
export function resolvePressResolutionKey(raw) {
    const k = String(raw || '').toLowerCase().replace(/×/g, 'x').trim();
    if (PRESS_RESOLUTION_PRESETS.some((p) => p.key === k)) return k;
    const m = k.match(/^(\d+)x(\d+)$/);
    if (m) {
        const w = Number(m[1]);
        const h = Number(m[2]);
        const sw = w / CANONICAL_PAGE_WIDTH;
        const sh = h / CANONICAL_PAGE_HEIGHT;
        if (sw === sh && Number.isInteger(sw) && sw > 0) {
            const hit = PRESS_RESOLUTION_PRESETS.find((p) => p.scale === sw);
            if (hit) return hit.key;
        }
    }
    return '1080x1920';
}

/**
 * @param {string} key {@link resolvePressResolutionKey}
 */
export function getPressResolutionDims(key) {
    const resolved = resolvePressResolutionKey(key);
    const preset = PRESS_RESOLUTION_PRESETS.find((p) => p.key === resolved)
        || PRESS_RESOLUTION_PRESETS.find((p) => p.scale === CANONICAL_PAGE_EXPORT_SCALE_MIN);
    return {
        key: preset.key,
        width: CANONICAL_PAGE_WIDTH * preset.scale,
        height: CANONICAL_PAGE_HEIGHT * preset.scale,
        scale: preset.scale,
        tier: preset.tier
    };
}

/** クラウド発行など「配信」経路: 最低 k={@link CANONICAL_PAGE_EXPORT_SCALE_MIN} に切り上げ */
export function clampPressPublishResolutionKey(raw) {
    const d = getPressResolutionDims(raw);
    if (d.scale >= CANONICAL_PAGE_EXPORT_SCALE_MIN) return d.key;
    return `${MIN_EXPORT_PAGE_WIDTH}x${MIN_EXPORT_PAGE_HEIGHT}`;
}
