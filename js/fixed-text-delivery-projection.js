/**
 * Pure projection from an already composed Fixed text page to DSF delivery v2.
 *
 * This boundary does not compose text, measure fonts, mutate authoring data, or
 * publish assets. Unsupported authoring features return an explicit request to
 * keep using the existing WebP path.
 */

import {
    DSF_DELIVERY_LAYOUT_MODEL,
    DSF_DELIVERY_SCHEMA_VERSION,
    DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    validateDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import { LAYOUT_VERSION } from './layout.js';
import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';

export const FIXED_TEXT_PROJECTION_VERSION = 1;

const STYLE_ID = 'body';
const EMPTY_SHA256 = '0'.repeat(64);
const RUBY_PATTERN = /[\{｛][^|｜{}｛｝]+[|｜][^|｜{}｛｝]*[\}｝]/;
const TCY_PATTERN = /(?:[0-9]{2,4}|[\uFF10-\uFF19]{2,4})/;
const TEXT_ALIGN_VALUES = new Set(['start', 'center', 'end']);
const WRITING_MODES = new Set(['horizontal-tb', 'vertical-rl']);

const VERTICAL_GLYPH_MAP = Object.freeze({
    'ー': '︱', '―': '︱', '—': '︱', '–': '︲', '…': '︙', '‥': '︰',
    '、': '︑', '。': '︒', '，': '︐', '：': '︓', '；': '︔',
    '！': '︕', '？': '︖', '（': '︵', '）': '︶', '｛': '︷', '｝': '︸',
    '〔': '︹', '〕': '︺', '【': '︻', '】': '︼', '《': '︽', '》': '︾',
    '〈': '︿', '〉': '﹀', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄',
    '［': '﹇', '］': '﹈',
});

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finitePositive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function imageFallback(code, message, input, details = {}) {
    return {
        ok: false,
        projectionVersion: FIXED_TEXT_PROJECTION_VERSION,
        renderKind: 'image',
        fallback: {
            code,
            message,
            blockId: typeof input?.block?.id === 'string' ? input.block.id : null,
            language: typeof input?.language === 'string' ? input.language : null,
            details,
        },
    };
}

function normalizePrimaryFontFamily(fontFamily) {
    return String(fontFamily || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

function toVerticalGlyphText(text) {
    return Array.from(String(text || ''), (character) => VERTICAL_GLYPH_MAP[character] || character).join('');
}

function getRawText(content, language) {
    if (isRecord(content?.texts) && typeof content.texts[language] === 'string') {
        return content.texts[language];
    }
    return typeof content?.text === 'string' ? content.text : '';
}

function hasUnsupportedOverlay(content) {
    return (Array.isArray(content?.bubbles) && content.bubbles.length > 0)
        || (Array.isArray(content?.graphicObjects) && content.graphicObjects.length > 0)
        || (Array.isArray(content?.layers) && content.layers.length > 0)
        || (Array.isArray(content?.interactions) && content.interactions.length > 0);
}

function validateCompositionShape(composition) {
    if (!isRecord(composition)) return 'Composition is missing.';
    if (composition.version !== LAYOUT_VERSION) return `Layout version must be ${LAYOUT_VERSION}.`;
    if (!WRITING_MODES.has(composition.writingMode)) return 'Writing mode is unsupported.';
    if (!isRecord(composition.frame)) return 'Composition frame is missing.';
    const { x, y, w, h } = composition.frame;
    if (![x, y].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
        return 'Composition frame origin is invalid.';
    }
    if (!finitePositive(w) || !finitePositive(h)) return 'Composition frame size is invalid.';
    if (x + w > CANONICAL_PAGE_WIDTH || y + h > CANONICAL_PAGE_HEIGHT) {
        return 'Composition frame exceeds the canonical page.';
    }
    if (!isRecord(composition.font) || !finitePositive(composition.font.size)) {
        return 'Composition font is invalid.';
    }
    if (!isRecord(composition.rules) || !Number.isInteger(composition.rules.maxLines) || composition.rules.maxLines < 1) {
        return 'Composition line rules are invalid.';
    }
    if (composition.writingMode === 'vertical-rl'
        && (!Number.isInteger(composition.rules.charsPerLine) || composition.rules.charsPerLine < 1)) {
        return 'Vertical composition character rules are invalid.';
    }
    if (!Array.isArray(composition.lines)
        || composition.lines.some((line) => typeof line !== 'string')
        || composition.lines.length > composition.rules.maxLines) {
        return 'Composition lines are invalid.';
    }
    return '';
}

function buildHorizontalLines(composition) {
    const { x, y, w, h } = composition.frame;
    const lineHeightPx = h / composition.rules.maxLines;
    return composition.lines.map((text, index) => ({
        x,
        y: y + index * lineHeightPx,
        width: w,
        height: lineHeightPx,
        writingMode: 'horizontal-tb',
        textOrientation: 'mixed',
        styleRef: STYLE_ID,
        runs: [{ text }],
    }));
}

function getVerticalBlockOffset(textAlign, frameWidth, usedColumns, columnWidth) {
    const groupWidth = Math.min(frameWidth, usedColumns * columnWidth);
    if (textAlign === 'center') return Math.max(0, (frameWidth - groupWidth) / 2);
    if (textAlign === 'end') return 0;
    return Math.max(0, frameWidth - groupWidth);
}

function buildVerticalLines(composition, textAlign) {
    const { x, y, w, h } = composition.frame;
    const columnWidth = Math.floor(w / composition.rules.maxLines);
    const usedColumns = composition.lines.length;
    const blockOffset = getVerticalBlockOffset(textAlign, w, usedColumns, columnWidth);
    const groupWidth = usedColumns * columnWidth;
    return composition.lines.map((text, index) => ({
        x: x + blockOffset + groupWidth - ((index + 1) * columnWidth),
        y,
        width: columnWidth,
        height: h,
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        styleRef: STYLE_ID,
        runs: [{ text: toVerticalGlyphText(text) }],
    }));
}

function buildStyle(composition, content) {
    const fontSize = composition.font.size;
    if (composition.writingMode === 'vertical-rl') {
        const columnWidth = Math.floor(composition.frame.w / composition.rules.maxLines);
        return {
            fontSize,
            lineHeight: columnWidth / fontSize,
            letterSpacing: (composition.frame.h / composition.rules.charsPerLine) - fontSize,
            color: content.textColor || '#000000',
        };
    }
    return {
        fontSize,
        lineHeight: (composition.frame.h / composition.rules.maxLines) / fontSize,
        letterSpacing: Number(composition.font.letterSpacing) || 0,
        color: content.textColor || '#000000',
    };
}

function validateProjectedFragment({ language, writingMode, fontId, fontDeclaration, manifest }) {
    const bundle = {
        index: {
            schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
            layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
            canonicalPage: {
                width: CANONICAL_PAGE_WIDTH,
                height: CANONICAL_PAGE_HEIGHT,
                aspectRatio: '9:16',
            },
            defaultLang: language,
            fonts: { [fontId]: fontDeclaration },
            languages: {
                [language]: {
                    href: 'manifests/projection.json',
                    pageCount: 1,
                    sha256: EMPTY_SHA256,
                    pageDirection: writingMode === 'vertical-rl' ? 'rtl' : 'ltr',
                },
            },
        },
        manifests: { [language]: manifest },
    };
    return validateDsfDeliveryBundle(bundle);
}

/**
 * Project one canonical Fixed text block and a certified composition snapshot.
 *
 * `certifiedFont` is an explicit release registration:
 * `{ id, declaration: { family, version, source, href, sha256 } }`.
 * `compositionEvidence` binds the snapshot to the exact source and certified
 * font: `{ sourceText, layoutVersion, fontId, fontSha256 }`.
 */
export function projectFixedTextBlockToDsfV2(input = {}) {
    const {
        block,
        language,
        pageId,
        pageLabel,
        composition,
        compositionEvidence,
        certifiedFont,
    } = input;
    if (!isRecord(block) || block.kind !== 'page' || block.content?.pageKind !== 'text') {
        return imageFallback('NOT_FIXED_TEXT_PAGE', 'Only Fixed text page blocks can use fixedText delivery.', input);
    }
    if (typeof block.id !== 'string' || !block.id.trim()) {
        return imageFallback('FIXED_BLOCK_ID_INVALID', 'The Fixed page block requires a stable ID.', input);
    }
    if (typeof language !== 'string' || !language.trim()) {
        return imageFallback('FIXED_TEXT_LANGUAGE_INVALID', 'An exact authoring language key is required.', input);
    }
    if (typeof pageId !== 'string' || !pageId.trim()) {
        return imageFallback('DELIVERY_PAGE_ID_INVALID', 'A stable delivery page ID is required.', input);
    }

    const content = block.content;
    const rawText = getRawText(content, language);
    if (RUBY_PATTERN.test(rawText)) {
        return imageFallback('RUBY_UNSUPPORTED', 'Ruby is not representable by the initial fixedText schema.', input);
    }
    if (hasUnsupportedOverlay(content)) {
        return imageFallback('FIXED_TEXT_OVERLAY_UNSUPPORTED', 'Text overlays, graphic layers, or interactions require WebP flattening.', input);
    }
    const normalizedRawText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!isRecord(compositionEvidence)
        || typeof compositionEvidence.sourceText !== 'string'
        || compositionEvidence.sourceText.replace(/\r\n/g, '\n').replace(/\r/g, '\n') !== normalizedRawText) {
        return imageFallback(
            'FIXED_TEXT_COMPOSITION_SOURCE_UNVERIFIED',
            'The composition snapshot must identify the exact source text it was created from.',
            input,
        );
    }

    const compositionIssue = validateCompositionShape(composition);
    if (compositionIssue) {
        return imageFallback('FIXED_TEXT_COMPOSITION_INVALID', compositionIssue, input);
    }
    if (composition.overflow || String(composition.overflowText || '')) {
        return imageFallback('FIXED_TEXT_OVERFLOW', 'A Fixed text page with undisplayed overflow cannot be projected.', input);
    }
    const textAlign = TEXT_ALIGN_VALUES.has(content.textAlign) ? content.textAlign : 'start';
    if (composition.writingMode === 'horizontal-tb' && textAlign !== 'start') {
        return imageFallback(
            'HORIZONTAL_ALIGNMENT_METRICS_REQUIRED',
            'Centered or end-aligned horizontal text requires measured block metrics before fixedText projection.',
            input,
            { textAlign },
        );
    }
    if (composition.writingMode === 'vertical-rl' && composition.lines.some((line) => TCY_PATTERN.test(line))) {
        return imageFallback('TATE_CHU_YOKO_UNSUPPORTED', 'Vertical text containing tate-chu-yoko requires WebP flattening.', input);
    }

    const fontId = certifiedFont?.id;
    const fontDeclaration = certifiedFont?.declaration;
    if (typeof fontId !== 'string' || !fontId || !isRecord(fontDeclaration)) {
        return imageFallback('FONT_NOT_CERTIFIED', 'An explicit DSF certified font registration is required.', input);
    }
    if (compositionEvidence.layoutVersion !== composition.version
        || compositionEvidence.fontId !== fontId
        || compositionEvidence.fontSha256 !== fontDeclaration.sha256) {
        return imageFallback(
            'FIXED_TEXT_COMPOSITION_FONT_UNVERIFIED',
            'The composition snapshot is not bound to the certified release font.',
            input,
            {
                compositionFontId: compositionEvidence.fontId || null,
                certifiedFontId: fontId,
            },
        );
    }
    const composedFamily = normalizePrimaryFontFamily(composition.font.family);
    if (!composedFamily || fontDeclaration.family !== composedFamily) {
        return imageFallback(
            'FONT_COMPOSITION_MISMATCH',
            'The certified font family does not match the font used by composition.',
            input,
            { composedFamily, certifiedFamily: fontDeclaration.family || null },
        );
    }

    const computedStyle = buildStyle(composition, content);
    const style = {
        fontRef: fontId,
        fontSize: computedStyle.fontSize,
        fontWeight: 400,
        fontStyle: 'normal',
        lineHeight: computedStyle.lineHeight,
        letterSpacing: computedStyle.letterSpacing,
        color: computedStyle.color,
        textDecoration: 'none',
        textAlign: 'start',
    };
    const lines = composition.writingMode === 'vertical-rl'
        ? buildVerticalLines(composition, textAlign)
        : buildHorizontalLines(composition);
    const page = {
        id: pageId,
        renderKind: 'fixedText',
        sourceAnchor: { kind: 'fixed', blockId: block.id },
        ...(typeof pageLabel === 'string' ? { pageLabel } : {}),
        background: { color: content.backgroundColor || '#ffffff' },
        lines,
    };
    const manifest = {
        schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
        language,
        styles: { [STYLE_ID]: style },
        pages: [page],
    };
    const validation = validateProjectedFragment({
        language,
        writingMode: composition.writingMode,
        fontId,
        fontDeclaration,
        manifest,
    });
    if (!validation.valid) {
        return imageFallback(
            'FIXED_TEXT_PROJECTION_INVALID',
            'The projected page did not satisfy the DSF delivery v2 contract.',
            input,
            { issues: validation.issues },
        );
    }

    return {
        ok: true,
        projectionVersion: FIXED_TEXT_PROJECTION_VERSION,
        renderKind: 'fixedText',
        font: { id: fontId, declaration: { ...fontDeclaration } },
        manifest,
    };
}
