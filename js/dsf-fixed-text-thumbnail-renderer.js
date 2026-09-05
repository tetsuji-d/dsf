import {
    DsfDeliveryValidationError,
    validateDsfDeliveryIndex,
    validateDsfLanguageManifest,
} from './dsf-delivery-v2.js';
import { encodeCanvasToWebP } from './canvas-encoding.js';
import { verticalGlyphText } from './text-press-html.js';

export const DSF_FIXED_TEXT_THUMBNAIL_PLAN_VERSION = 1;
export const DSF_FIXED_TEXT_THUMBNAIL_WIDTH = 720;
export const DSF_FIXED_TEXT_THUMBNAIL_HEIGHT = 1280;
export const DSF_FIXED_TEXT_THUMBNAIL_QUALITY = 0.86;

const CANONICAL_WIDTH = 360;
const CANONICAL_HEIGHT = 640;
const OUTPUT_SCALE = 2;
const TAB_SIZE = 8;

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((child) => deepFreeze(child, seen));
    return Object.freeze(value);
}

function structurallyEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (typeof left !== typeof right || !left || !right || typeof left !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]));
}

function quoteFontFamily(family) {
    return `"${String(family).replace(/["\\]/g, '')}"`;
}

function normalizeFontWeight(fontWeight) {
    if (fontWeight === 'normal') return 400;
    if (fontWeight === 'bold') return 700;
    if (Number.isInteger(fontWeight) && fontWeight >= 100 && fontWeight <= 900) return fontWeight;
    fail('THUMBNAIL_FONT_WEIGHT_INVALID', 'The fixed-text font weight is unsupported.', { fontWeight });
}

function fail(code, message, details = {}) {
    throw new DsfFixedTextThumbnailError(code, message, details);
}

function assertValidInputs(index, manifest) {
    const indexValidation = validateDsfDeliveryIndex(index);
    if (!indexValidation.valid) throw new DsfDeliveryValidationError(indexValidation.issues);
    const descriptor = index.languages?.[manifest?.language];
    if (!descriptor) {
        fail('THUMBNAIL_LANGUAGE_NOT_DECLARED', 'The selected language manifest is not declared by the DSF index.', {
            language: manifest?.language,
        });
    }
    const manifestValidation = validateDsfLanguageManifest(manifest, {
        expectedLanguage: manifest.language,
        expectedPageCount: descriptor.pageCount,
        fontIds: new Set(Object.keys(index.fonts || {})),
        pageWidth: index.canonicalPage.width,
        pageHeight: index.canonicalPage.height,
    });
    if (!manifestValidation.valid) throw new DsfDeliveryValidationError(manifestValidation.issues);
}

function resolvePersistedPage(manifest, page) {
    if (!isRecord(page) || typeof page.id !== 'string') {
        fail('THUMBNAIL_PAGE_INVALID', 'A selected DSF fixedText page is required.');
    }
    const persistedPage = manifest.pages.find((candidate) => candidate.id === page.id);
    if (!persistedPage || persistedPage.renderKind !== 'fixedText') {
        fail('THUMBNAIL_FIXED_TEXT_PAGE_REQUIRED', 'The selected page must be a validated fixedText page.', {
            pageId: page.id,
        });
    }
    if (!structurallyEqual(page, persistedPage)) {
        fail('THUMBNAIL_PAGE_NOT_VALIDATED', 'The selected page differs from its validated manifest entry.', {
            pageId: page.id,
        });
    }
    return persistedPage;
}

function normalizeStyle(styleRef, manifest, index, fontFamiliesByRef) {
    const style = manifest.styles[styleRef];
    if (!isRecord(style)) {
        fail('THUMBNAIL_STYLE_MISSING', `Fixed-text style "${styleRef}" is missing.`, { styleRef });
    }
    const font = index.fonts[style.fontRef];
    if (!isRecord(font) || typeof font.family !== 'string' || !font.family.trim()) {
        fail('THUMBNAIL_FONT_MISSING', `Certified font "${style.fontRef}" is missing.`, {
            styleRef,
            fontRef: style.fontRef,
        });
    }
    return {
        styleRef,
        fontRef: style.fontRef,
        fontFamily: fontFamiliesByRef?.[style.fontRef] || font.family,
        fontSize: style.fontSize,
        fontWeight: normalizeFontWeight(style.fontWeight),
        fontStyle: style.fontStyle || 'normal',
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
        textDecoration: style.textDecoration || 'none',
        textAlign: style.textAlign || 'start',
        whiteSpaceMode: style.whiteSpaceMode,
    };
}

function visibleText(text, whiteSpaceMode) {
    if (whiteSpaceMode === 'preserve-v1') return text.replace(/[\r\n]+/g, '');
    return text.replace(/\s+/gu, ' ');
}

function normalizeLine(line, manifest, index, fontFamiliesByRef) {
    const lineStyle = normalizeStyle(line.styleRef, manifest, index, fontFamiliesByRef);
    return {
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        writingMode: line.writingMode,
        textOrientation: line.textOrientation,
        style: lineStyle,
        runs: line.runs.map((run) => {
            const style = run.styleRef
                ? normalizeStyle(run.styleRef, manifest, index, fontFamiliesByRef)
                : lineStyle;
            return {
                text: visibleText(run.text, lineStyle.whiteSpaceMode),
                style,
            };
        }),
    };
}

function assertPlan(plan) {
    if (
        !isRecord(plan)
        || plan.planVersion !== DSF_FIXED_TEXT_THUMBNAIL_PLAN_VERSION
        || plan.width !== DSF_FIXED_TEXT_THUMBNAIL_WIDTH
        || plan.height !== DSF_FIXED_TEXT_THUMBNAIL_HEIGHT
        || plan.sourceWidth !== CANONICAL_WIDTH
        || plan.sourceHeight !== CANONICAL_HEIGHT
        || plan.scale !== OUTPUT_SCALE
        || !Object.isFrozen(plan)
        || !Array.isArray(plan.lines)
    ) {
        fail('THUMBNAIL_DRAW_PLAN_INVALID', 'A frozen DSF fixed-text thumbnail draw plan is required.');
    }
}

function setTextStyle(context, style) {
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${quoteFontFamily(style.fontFamily)}`;
    context.fillStyle = style.color;
    context.textBaseline = 'top';
    context.textAlign = 'left';
    if ('fontKerning' in context) context.fontKerning = 'normal';
    if ('letterSpacing' in context) context.letterSpacing = `${style.letterSpacing}px`;
}

function segmentGraphemes(text) {
    if (!text) return [];
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
            .map((entry) => entry.segment);
    }
    return Array.from(text);
}

function isVerticalUprightGrapheme(grapheme, textOrientation) {
    if (textOrientation === 'upright') return true;
    if (!grapheme || /^\s+$/u.test(grapheme)) return true;
    return !/^[\u0000-\u024f\u1e00-\u1eff]+$/u.test(grapheme);
}

function measureHorizontalText(context, text, style) {
    setTextStyle(context, style);
    const measured = Math.max(0, context.measureText(text).width);
    if ('letterSpacing' in context || style.letterSpacing === 0) return measured;
    return Math.max(0, measured + (Math.max(0, segmentGraphemes(text).length - 1) * style.letterSpacing));
}

function horizontalTextParts(text) {
    return text.split(/(\t)/u).filter(Boolean);
}

function measureHorizontalPart(context, part, style, currentAdvance) {
    if (part !== '\t') return measureHorizontalText(context, part, style);
    const cell = Math.max(1, measureHorizontalText(context, ' ', style)) * TAB_SIZE;
    return cell - (currentAdvance % cell || 0);
}

function measureHorizontalRun(context, run, currentAdvance) {
    let advance = 0;
    for (const part of horizontalTextParts(run.text)) {
        advance += measureHorizontalPart(context, part, run.style, currentAdvance + advance);
    }
    return advance;
}

function measureHorizontalLine(context, line) {
    let advance = 0;
    for (const run of line.runs) {
        advance += measureHorizontalRun(context, run, advance);
    }
    return Math.max(0, advance);
}

function alignedStart(line, contentAdvance) {
    if (line.style.textAlign === 'center') return Math.max(0, (line.width - contentAdvance) / 2);
    if (line.style.textAlign === 'end') return Math.max(0, line.width - contentAdvance);
    return 0;
}

function drawHorizontalDecoration(context, style, x, y, advance) {
    if (style.textDecoration === 'none' || advance <= 0 || typeof context.stroke !== 'function') return;
    context.save();
    context.strokeStyle = style.color;
    context.lineWidth = Math.max(0.5, style.fontSize / 16);
    const offsets = [];
    if (style.textDecoration.includes('underline')) offsets.push(style.fontSize * 0.94);
    if (style.textDecoration.includes('line-through')) offsets.push(style.fontSize * 0.5);
    offsets.forEach((offset) => {
        context.beginPath();
        context.moveTo(x, y + offset);
        context.lineTo(x + advance, y + offset);
        context.stroke();
    });
    context.restore();
}

function drawHorizontalLine(context, line) {
    let cursor = line.x + alignedStart(line, measureHorizontalLine(context, line));
    for (const run of line.runs) {
        const runStart = cursor;
        for (const part of horizontalTextParts(run.text)) {
            const advance = measureHorizontalPart(context, part, run.style, cursor - line.x);
            if (part !== '\t') {
                setTextStyle(context, run.style);
                if ('letterSpacing' in context || run.style.letterSpacing === 0) {
                    if (!/^\s+$/u.test(part)) context.fillText(part, cursor, line.y);
                } else {
                    let fallbackCursor = cursor;
                    for (const grapheme of segmentGraphemes(part)) {
                        const graphemeAdvance = measureHorizontalText(context, grapheme, run.style)
                            + run.style.letterSpacing;
                        if (!/^\s+$/u.test(grapheme)) context.fillText(grapheme, fallbackCursor, line.y);
                        fallbackCursor += graphemeAdvance;
                    }
                }
            }
            cursor += advance;
        }
        drawHorizontalDecoration(context, run.style, runStart, line.y, cursor - runStart);
    }
}

function measureVerticalLine(line) {
    let advance = 0;
    for (const run of line.runs) {
        advance += segmentGraphemes(run.text).length * (run.style.fontSize + run.style.letterSpacing);
    }
    return Math.max(0, advance - (line.runs.at(-1)?.style.letterSpacing || 0));
}

function drawVerticalDecoration(context, style, centerX, startY, advance) {
    if (style.textDecoration === 'none' || advance <= 0 || typeof context.stroke !== 'function') return;
    context.save();
    context.strokeStyle = style.color;
    context.lineWidth = Math.max(0.5, style.fontSize / 16);
    const offsets = [];
    if (style.textDecoration.includes('underline')) offsets.push(style.fontSize * 0.58);
    if (style.textDecoration.includes('line-through')) offsets.push(0);
    offsets.forEach((offset) => {
        context.beginPath();
        context.moveTo(centerX + offset, startY);
        context.lineTo(centerX + offset, startY + advance);
        context.stroke();
    });
    context.restore();
}

function drawVerticalLine(context, line) {
    let cursor = line.y + alignedStart({ ...line, width: line.height }, measureVerticalLine(line));
    const centerX = line.x + (line.width / 2);
    for (const run of line.runs) {
        const runStart = cursor;
        for (const grapheme of segmentGraphemes(run.text)) {
            const advance = run.style.fontSize + run.style.letterSpacing;
            const centerY = cursor + (advance / 2);
            setTextStyle(context, run.style);
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            if (!/^\s+$/u.test(grapheme)) {
                if (isVerticalUprightGrapheme(grapheme, line.textOrientation)) {
                    context.fillText(verticalGlyphText(grapheme), centerX, centerY);
                } else {
                    context.save();
                    context.translate(centerX, centerY);
                    context.rotate(Math.PI / 2);
                    context.fillText(grapheme, 0, 0);
                    context.restore();
                }
            }
            cursor += advance;
        }
        drawVerticalDecoration(context, run.style, centerX, runStart, cursor - runStart);
    }
}

function drawCoverImage(context, image, width, height) {
    const imageWidth = Number(image?.naturalWidth || image?.width);
    const imageHeight = Number(image?.naturalHeight || image?.height);
    if (!(imageWidth > 0) || !(imageHeight > 0)) {
        fail('THUMBNAIL_BACKGROUND_IMAGE_INVALID', 'The fixed-text background image has invalid dimensions.');
    }
    const sourceAspect = imageWidth / imageHeight;
    const targetAspect = width / height;
    let sx = 0;
    let sy = 0;
    let sw = imageWidth;
    let sh = imageHeight;
    if (sourceAspect > targetAspect) {
        sw = imageHeight * targetAspect;
        sx = (imageWidth - sw) / 2;
    } else if (sourceAspect < targetAspect) {
        sh = imageWidth / targetAspect;
        sy = (imageHeight - sh) / 2;
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

async function defaultLoadImage(href) {
    if (typeof Image !== 'function') {
        fail('THUMBNAIL_IMAGE_API_UNAVAILABLE', 'The browser image API is unavailable.', { href });
    }
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new DsfFixedTextThumbnailError(
            'THUMBNAIL_BACKGROUND_IMAGE_LOAD_FAILED',
            'The fixed-text background image could not be loaded.',
            { href },
        ));
        image.src = href;
    });
}

async function loadPlanFonts(plan, fontFaceSet) {
    if (!fontFaceSet || typeof fontFaceSet.load !== 'function' || typeof fontFaceSet.check !== 'function') {
        fail('THUMBNAIL_FONT_API_UNAVAILABLE', 'The browser font loading API is unavailable.');
    }
    for (const font of plan.fonts) {
        const descriptor = `${font.fontStyle} ${font.fontWeight} ${font.fontSize}px ${quoteFontFamily(font.fontFamily)}`;
        let loaded;
        try {
            loaded = await fontFaceSet.load(descriptor, '永Ag');
        } catch (error) {
            fail('THUMBNAIL_FONT_LOAD_FAILED', `Certified font "${font.fontRef}" could not be loaded.`, {
                fontRef: font.fontRef,
                cause: error?.message || String(error),
            });
        }
        if (!Array.isArray(loaded) || loaded.length < 1 || !fontFaceSet.check(descriptor, '永Ag')) {
            fail('THUMBNAIL_FONT_UNAVAILABLE', `Certified font "${font.fontRef}" is unavailable.`, {
                fontRef: font.fontRef,
            });
        }
    }
}

export class DsfFixedTextThumbnailError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'DsfFixedTextThumbnailError';
        this.code = code;
        this.details = details;
    }
}

/** Build a frozen, canonical-coordinate draw plan from validated DSF v2 data. */
export function createDsfFixedTextThumbnailDrawPlan({ index, manifest, page, fontFamiliesByRef = {} } = {}) {
    assertValidInputs(index, manifest);
    const persistedPage = resolvePersistedPage(manifest, page);
    if (!isRecord(fontFamiliesByRef)
        || Object.values(fontFamiliesByRef).some((family) => typeof family !== 'string' || !family.trim())) {
        fail('THUMBNAIL_FONT_FAMILY_OVERRIDE_INVALID', 'Runtime font family overrides must be non-empty strings.');
    }
    const lines = persistedPage.lines.map((line) => normalizeLine(line, manifest, index, fontFamiliesByRef));
    const fonts = [...new Map(lines.flatMap((line) => line.runs.map(({ style }) => [
        `${style.fontRef}:${style.fontStyle}:${style.fontWeight}:${style.fontSize}`,
        {
            fontRef: style.fontRef,
            fontFamily: style.fontFamily,
            fontStyle: style.fontStyle,
            fontWeight: style.fontWeight,
            fontSize: style.fontSize,
        },
    ]))).values()];
    return deepFreeze({
        planVersion: DSF_FIXED_TEXT_THUMBNAIL_PLAN_VERSION,
        pageId: persistedPage.id,
        language: manifest.language,
        sourceWidth: CANONICAL_WIDTH,
        sourceHeight: CANONICAL_HEIGHT,
        width: DSF_FIXED_TEXT_THUMBNAIL_WIDTH,
        height: DSF_FIXED_TEXT_THUMBNAIL_HEIGHT,
        scale: OUTPUT_SCALE,
        background: {
            color: persistedPage.background?.color || '#ffffff',
            ...(persistedPage.background?.imageHref
                ? { imageHref: persistedPage.background.imageHref }
                : {}),
        },
        fonts,
        lines,
    });
}

/** Draw a prepared plan. Text is clipped to the exact captured line boxes. */
export function drawDsfFixedTextThumbnailPlan({ context, plan, backgroundImage = null } = {}) {
    assertPlan(plan);
    if (!context || typeof context.fillRect !== 'function' || typeof context.fillText !== 'function') {
        fail('THUMBNAIL_CANVAS_CONTEXT_INVALID', 'A Canvas 2D context is required.');
    }
    if (plan.background.imageHref && !backgroundImage) {
        fail('THUMBNAIL_BACKGROUND_IMAGE_REQUIRED', 'The draw plan requires its validated background image.');
    }
    context.save();
    context.scale(plan.scale, plan.scale);
    context.fillStyle = plan.background.color;
    context.fillRect(0, 0, plan.sourceWidth, plan.sourceHeight);
    if (backgroundImage) drawCoverImage(context, backgroundImage, plan.sourceWidth, plan.sourceHeight);
    for (const line of plan.lines) {
        context.save();
        context.beginPath();
        context.rect(line.x, line.y, line.width, line.height);
        context.clip();
        if (line.writingMode === 'horizontal-tb') drawHorizontalLine(context, line);
        else if (line.writingMode === 'vertical-rl') drawVerticalLine(context, line);
        else fail('THUMBNAIL_WRITING_MODE_UNSUPPORTED', 'The fixed-text writing mode is unsupported.');
        context.restore();
    }
    context.restore();
    return context.canvas || null;
}

/** Render a validated fixedText page to one 720x1280 WebP thumbnail. */
export async function renderDsfFixedTextThumbnailWebP({
    index,
    manifest,
    page,
    fontFamiliesByRef = {},
    documentRef = globalThis.document,
    createCanvas = () => documentRef?.createElement?.('canvas'),
    fontFaceSet = documentRef?.fonts,
    loadImage = defaultLoadImage,
    encodeWebP = (canvas) => encodeCanvasToWebP(
        canvas,
        DSF_FIXED_TEXT_THUMBNAIL_QUALITY,
        '固定テキスト表紙サムネイル',
    ),
} = {}) {
    const plan = createDsfFixedTextThumbnailDrawPlan({ index, manifest, page, fontFamiliesByRef });
    const canvas = createCanvas();
    if (!canvas || typeof canvas.getContext !== 'function') {
        fail('THUMBNAIL_CANVAS_UNAVAILABLE', 'A browser canvas is required.');
    }
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext('2d');
    if (!context) fail('THUMBNAIL_CANVAS_CONTEXT_UNAVAILABLE', 'Canvas 2D is unavailable.');
    await loadPlanFonts(plan, fontFaceSet);
    const backgroundImage = plan.background.imageHref
        ? await loadImage(plan.background.imageHref)
        : null;
    drawDsfFixedTextThumbnailPlan({ context, plan, backgroundImage });
    const webp = await encodeWebP(canvas, DSF_FIXED_TEXT_THUMBNAIL_QUALITY);
    if (!(webp instanceof Blob) || webp.type !== 'image/webp' || webp.size < 1) {
        fail('THUMBNAIL_WEBP_ENCODING_FAILED', 'The fixed-text thumbnail encoder did not return WebP.');
    }
    return webp;
}
