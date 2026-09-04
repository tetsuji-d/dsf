/** Pure source-resolution diagnostics for fixed-layout image publication. */

function positiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * Estimate whether object-fit:cover needs to enlarge source pixels.
 * `frameWidth` may be two pages wide for one shared spread image.
 */
export function assessPressImageSourceResolution(input = {}) {
    const sourceWidth = positiveNumber(input.sourceWidth);
    const sourceHeight = positiveNumber(input.sourceHeight);
    const frameWidth = positiveNumber(input.frameWidth);
    const frameHeight = positiveNumber(input.frameHeight);
    const scale = Math.max(0.1, positiveNumber(input.scale, 1));
    if (!sourceWidth || !sourceHeight || !frameWidth || !frameHeight) {
        return Object.freeze({ status: 'unknown', upscaleRatio: null });
    }

    const sourceAspect = sourceWidth / sourceHeight;
    const frameAspect = frameWidth / frameHeight;
    const drawnWidth = sourceAspect > frameAspect
        ? frameHeight * sourceAspect
        : frameWidth;
    const drawnHeight = sourceAspect > frameAspect
        ? frameHeight
        : frameWidth / sourceAspect;
    const upscaleRatio = Math.max(
        (drawnWidth * scale) / sourceWidth,
        (drawnHeight * scale) / sourceHeight,
    );
    const roundedRatio = Math.round(upscaleRatio * 1000) / 1000;
    return Object.freeze({
        status: upscaleRatio > 1.001 ? 'upscaled' : 'sufficient',
        upscaleRatio: roundedRatio,
    });
}

