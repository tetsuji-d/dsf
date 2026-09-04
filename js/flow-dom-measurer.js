/**
 * Browser DOM measurement and rendering adapter for Flow Layout.
 *
 * The same fragment renderer is used for measurement and visible preview
 * pages in horizontal-tb and vertical-rl so pagination boundaries cannot
 * drift because of duplicate markup.
 */

import { normalizeFlowPageBox } from './flow-pagination.js';
import { getFontPresetFromConfigs, getTextPageTypographyDefaults } from './layout.js';
import {
    getFlowTypographyProfile,
    isFlowWritingModeSupported,
} from './flow-typography.js';

export const FLOW_DOM_SUPPORTED_WRITING_MODE = 'horizontal-tb';
export const FLOW_DOM_SUPPORTED_WRITING_MODES = Object.freeze(['horizontal-tb', 'vertical-rl']);
export const FLOW_DOM_RENDERER_VERSION = 8;
export const FLOW_DOM_HYPHENATION_MODES = Object.freeze(['auto', 'none']);

const DEFAULT_MEASUREMENT_CACHE_SIZE = 2048;
const FLOW_DOM_BOUNDS_EPSILON_PX = 0.5;

// The first portable DSF font registry intentionally certifies the JP Noto
// families for both Japanese and the currently supported Latin languages.
// Keep legacy fixed-text defaults untouched, but make an implicit Flow Latin
// preset resolve to the exact certified family name. Press capture and Viewer
// rendering then use the same verified bytes; Editor keeps the same primary
// family request while its runtime font availability is handled separately.
// Explicit author fontFamily values still win and fail closed when uncertified.
const FLOW_PORTABLE_LATIN_FONT_FAMILIES = Object.freeze({
    gothic: "'Noto Sans JP',Arial,'Helvetica Neue','Segoe UI',sans-serif",
    mincho: "'Noto Serif JP',Georgia,'Times New Roman',serif",
});

const HEADING_SCALES = Object.freeze({
    1: 1.5,
    2: 1.35,
    3: 1.25,
    4: 1.16,
    5: 1.1,
    6: 1.05,
});

export class FlowDomMeasurementError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowDomMeasurementError';
        this.code = code;
        this.context = context;
    }
}

function requireFiniteNumber(value, fallback, path, options = {}) {
    const number = value === undefined ? fallback : Number(value);
    const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(number) || number < minimum || (options.positive && number <= 0)) {
        throw new FlowDomMeasurementError('INVALID_TYPOGRAPHY', `${path} has an invalid value.`, {
            path,
            value,
        });
    }
    return number;
}

export function assertFlowDomWritingMode(writingMode, languageKey = 'ja') {
    const mode = String(writingMode || FLOW_DOM_SUPPORTED_WRITING_MODE);
    if (
        !FLOW_DOM_SUPPORTED_WRITING_MODES.includes(mode)
        || !isFlowWritingModeSupported(languageKey, mode)
    ) {
        throw new FlowDomMeasurementError(
            'UNSUPPORTED_WRITING_MODE',
            `DOM Flow preview does not support ${mode} for ${languageKey}.`,
            { writingMode: mode, languageKey },
        );
    }
    return mode;
}

export function resolveFlowDomHyphenation(value, writingMode = FLOW_DOM_SUPPORTED_WRITING_MODE) {
    const fallback = writingMode === 'vertical-rl' ? 'none' : 'auto';
    const hyphenation = String(value || fallback);
    if (!FLOW_DOM_HYPHENATION_MODES.includes(hyphenation)) {
        throw new FlowDomMeasurementError('INVALID_HYPHENATION', 'Flow DOM hyphenation mode is unsupported.', {
            value,
            writingMode,
        });
    }
    return hyphenation;
}

export function resolveFlowDomTypography(
    languageKey = 'ja',
    overrides = {},
    writingMode = FLOW_DOM_SUPPORTED_WRITING_MODE,
    options = {},
) {
    const mode = assertFlowDomWritingMode(writingMode, languageKey);
    const profile = getFlowTypographyProfile(languageKey, mode);
    const cjk = ['jpan', 'hans', 'hant', 'kore'].includes(profile.script);
    const fontPreset = getFontPresetFromConfigs(languageKey, options.languageConfigs);
    // Keep Flow's CJK font routing while sharing the text-page font presets and
    // body grid. Project settings are runtime inputs, not copied into source.
    const defaults = getTextPageTypographyDefaults(cjk ? 'ja' : languageKey, mode, fontPreset);
    const defaultFontFamily = cjk
        ? defaults.fontFamily
        : (FLOW_PORTABLE_LATIN_FONT_FAMILIES[fontPreset] || defaults.fontFamily);
    const textAlign = String(overrides.textAlign || 'start');
    if (!['start', 'center', 'end', 'justify'].includes(textAlign)) {
        throw new FlowDomMeasurementError('INVALID_TYPOGRAPHY', 'textAlign is unsupported.', {
            path: 'textAlign',
            value: overrides.textAlign,
        });
    }
    return Object.freeze({
        writingMode: mode,
        fontFamily: String(overrides.fontFamily || defaultFontFamily),
        fontSize: requireFiniteNumber(overrides.fontSize, defaults.fontSize, 'fontSize', { positive: true }),
        fontWeight: String(overrides.fontWeight ?? '400'),
        lineHeight: requireFiniteNumber(overrides.lineHeight, defaults.lineHeight, 'lineHeight', { positive: true }),
        letterSpacing: requireFiniteNumber(overrides.letterSpacing, defaults.letterSpacing, 'letterSpacing'),
        textAlign,
        paragraphSpacing: requireFiniteNumber(overrides.paragraphSpacing, defaults.paragraphSpacing, 'paragraphSpacing', { minimum: 0 }),
        headingSpacing: requireFiniteNumber(overrides.headingSpacing, 18, 'headingSpacing', { minimum: 0 }),
        textColor: String(overrides.textColor || '#1f1b16'),
        paperColor: String(overrides.paperColor || '#f7f1df'),
        lineBreak: profile.rules.kinsokuProfileId === 'none' ? 'auto' : 'strict',
    });
}

function setPageStyles(pageElement, pageBox, typography) {
    Object.assign(pageElement.style, {
        position: 'relative',
        width: `${pageBox.width}px`,
        height: `${pageBox.height}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: typography.paperColor,
    });
}

function setContentStyles(contentElement, pageBox, typography, languageKey, writingMode, hyphenation) {
    const { contentBox } = pageBox;
    Object.assign(contentElement.style, {
        position: 'absolute',
        left: `${contentBox.x}px`,
        top: `${contentBox.y}px`,
        width: `${contentBox.width}px`,
        height: `${contentBox.height}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flow-root',
        writingMode,
        textOrientation: writingMode === 'vertical-rl' ? 'mixed' : '',
        direction: writingMode === 'vertical-rl' ? 'ltr' : '',
        // Let CSS Writing Modes select vertical features per character. Forcing
        // `vert` also substitutes sideways characters such as U+2026 before
        // the browser rotates them, turning a vertical ellipsis horizontal.
        // `normal` keeps automatic vertical punctuation, as in fixedText Viewer.
        fontFeatureSettings: 'normal',
        fontFamily: typography.fontFamily,
        fontSize: `${typography.fontSize}px`,
        fontWeight: typography.fontWeight,
        lineHeight: String(typography.lineHeight),
        letterSpacing: `${typography.letterSpacing}px`,
        textAlign: typography.textAlign,
        color: typography.textColor,
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
        lineBreak: typography.lineBreak,
        hyphens: hyphenation,
        textRendering: 'optimizeLegibility',
    });
    contentElement.lang = String(languageKey || 'ja');
}

function createFragmentElement(ownerDocument, fragment, fragmentIndex, typography, hyphenation) {
    const element = ownerDocument.createElement(fragment.blockType === 'heading' ? 'h2' : 'p');
    element.className = `flow-dom-block flow-dom-block--${fragment.blockType}`;
    element.dataset.flowFragmentIndex = String(fragmentIndex);
    element.dataset.flowSectionId = fragment.sectionId;
    element.dataset.flowBlockId = fragment.blockId;
    element.dataset.flowBlockType = fragment.blockType;
    element.dataset.flowLanguageKey = fragment.languageKey;
    element.dataset.sourceStart = String(fragment.sourceRange.start);
    element.dataset.sourceEnd = String(fragment.sourceRange.end);
    element.dataset.sourceStartGrapheme = String(fragment.sourceRange.startGrapheme);
    element.dataset.sourceEndGrapheme = String(fragment.sourceRange.endGrapheme);
    element.dataset.blockStart = String(fragment.isBlockStart);
    element.dataset.blockEnd = String(fragment.isBlockEnd);
    const isHeading = fragment.blockType === 'heading';
    const headingLevel = Math.max(1, Math.min(6, Number(fragment.headingLevel) || 1));
    const fontScale = isHeading ? HEADING_SCALES[headingLevel] : 1;
    const spacing = isHeading ? typography.headingSpacing : typography.paragraphSpacing;
    const fontSize = typography.fontSize * fontScale;
    const lineHeight = isHeading ? Math.max(1.35, typography.lineHeight - 0.15) : typography.lineHeight;
    Object.assign(element.style, {
        display: 'block',
        margin: '0',
        border: '0',
        padding: '0',
        paddingBlockEnd: fragment.isBlockEnd ? `${spacing}px` : '0px',
        minBlockSize: `${fontSize * lineHeight}px`,
        font: 'inherit',
        fontFamily: 'inherit',
        fontSize: `${fontSize}px`,
        fontWeight: isHeading ? '700' : typography.fontWeight,
        lineHeight: String(lineHeight),
        letterSpacing: 'inherit',
        textAlign: 'inherit',
        color: 'inherit',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
        lineBreak: typography.lineBreak,
        hyphens: hyphenation,
    });
    if (fragment.text) {
        element.textContent = fragment.text;
    } else {
        element.textContent = '\u200B';
        element.dataset.emptyFragment = 'true';
    }
    return element;
}

function normalizeCacheSize(value) {
    const size = value === undefined ? DEFAULT_MEASUREMENT_CACHE_SIZE : Number(value);
    if (!Number.isInteger(size) || size < 0) {
        throw new FlowDomMeasurementError('INVALID_CACHE_SIZE', 'Measurement cache size must be a non-negative integer.', {
            value,
        });
    }
    return size;
}

function createMeasurementCacheKey(context, pageBox, writingMode, languageKey, typography, hyphenation, epoch) {
    return JSON.stringify([
        FLOW_DOM_RENDERER_VERSION,
        epoch,
        pageBox.width,
        pageBox.height,
        pageBox.padding.top,
        pageBox.padding.right,
        pageBox.padding.bottom,
        pageBox.padding.left,
        writingMode,
        languageKey,
        typography.fontFamily,
        typography.fontSize,
        typography.fontWeight,
        typography.lineHeight,
        typography.letterSpacing,
        typography.textAlign,
        typography.paragraphSpacing,
        typography.headingSpacing,
        typography.textColor,
        typography.paperColor,
        typography.lineBreak,
        hyphenation,
        (Array.isArray(context.fragments) ? context.fragments : []).map((fragment) => [
            fragment.blockType,
            fragment.headingLevel ?? null,
            fragment.text,
            fragment.isBlockStart === true,
            fragment.isBlockEnd === true,
        ]),
    ]);
}

/** Render fragments into an existing content box. */
export function renderFlowFragments(contentElement, options = {}) {
    if (!contentElement?.ownerDocument) {
        throw new FlowDomMeasurementError('DOM_REQUIRED', 'A DOM content element is required.');
    }
    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || 'ja');
    const writingMode = assertFlowDomWritingMode(options.writingMode, languageKey);
    const hyphenation = resolveFlowDomHyphenation(options.hyphenation, writingMode);
    const typography = resolveFlowDomTypography(languageKey, options.typography, writingMode);
    const fragments = Array.isArray(options.fragments) ? options.fragments : [];

    contentElement.replaceChildren();
    contentElement.className = 'flow-dom-content';
    setContentStyles(contentElement, pageBox, typography, languageKey, writingMode, hyphenation);
    fragments.forEach((fragment, fragmentIndex) => {
        contentElement.appendChild(createFragmentElement(
            contentElement.ownerDocument,
            fragment,
            fragmentIndex,
            typography,
            hyphenation,
        ));
    });
    return { pageBox, typography, hyphenation };
}

/** Render one generated page using the same DOM path as measurement. */
export function renderFlowGeneratedPage(pageElement, options = {}) {
    if (!pageElement?.ownerDocument) {
        throw new FlowDomMeasurementError('DOM_REQUIRED', 'A DOM page element is required.');
    }
    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || 'ja');
    const writingMode = assertFlowDomWritingMode(options.writingMode, languageKey);
    const hyphenation = resolveFlowDomHyphenation(options.hyphenation, writingMode);
    const typography = resolveFlowDomTypography(languageKey, options.typography, writingMode);
    setPageStyles(pageElement, pageBox, typography);
    pageElement.replaceChildren();
    const contentElement = pageElement.ownerDocument.createElement('div');
    pageElement.appendChild(contentElement);
    renderFlowFragments(contentElement, {
        fragments: options.page?.fragments,
        pageBox,
        languageKey,
        writingMode,
        typography,
        hyphenation,
    });
    return contentElement;
}

/** Create one reusable off-screen measurement page. */
export function createFlowDomPageMeasurer(options = {}) {
    const ownerDocument = options.ownerDocument || globalThis.document;
    if (!ownerDocument?.body) {
        throw new FlowDomMeasurementError('DOM_REQUIRED', 'A document with body is required.');
    }
    const languageKey = String(options.languageKey || 'ja');
    const writingMode = assertFlowDomWritingMode(options.writingMode, languageKey);
    const hyphenation = resolveFlowDomHyphenation(options.hyphenation, writingMode);
    const typography = resolveFlowDomTypography(languageKey, options.typography, writingMode);
    const maxCacheEntries = normalizeCacheSize(options.maxCacheEntries);
    const measurementCache = new Map();
    let layoutEpoch = 0;
    let totalCalls = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const host = ownerDocument.createElement('div');
    const pageElement = ownerDocument.createElement('div');
    const contentElement = ownerDocument.createElement('div');
    host.className = 'flow-dom-measure-host';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
        contain: 'strict',
    });
    pageElement.appendChild(contentElement);
    host.appendChild(pageElement);
    ownerDocument.body.appendChild(host);

    const measurePage = (context = {}) => {
        totalCalls += 1;
        const pageBox = normalizeFlowPageBox(context.pageBox);
        const resolvedLanguageKey = String(context.languageKey || languageKey);
        const resolvedWritingMode = assertFlowDomWritingMode(context.writingMode, resolvedLanguageKey);
        if (resolvedLanguageKey !== languageKey) {
            throw new FlowDomMeasurementError(
                'MEASURER_LANGUAGE_MISMATCH',
                'Flow DOM measurer language is fixed for one runtime.',
                {
                    expectedLanguageKey: languageKey,
                    actualLanguageKey: resolvedLanguageKey,
                },
            );
        }
        if (resolvedWritingMode !== writingMode) {
            throw new FlowDomMeasurementError(
                'WRITING_MODE_MISMATCH',
                'Flow DOM measurer writing mode is fixed for one runtime.',
                {
                    expectedWritingMode: writingMode,
                    actualWritingMode: resolvedWritingMode,
                },
            );
        }
        const cacheKey = createMeasurementCacheKey(
            context,
            pageBox,
            resolvedWritingMode,
            resolvedLanguageKey,
            typography,
            hyphenation,
            layoutEpoch,
        );
        if (maxCacheEntries > 0 && measurementCache.has(cacheKey)) {
            const cached = measurementCache.get(cacheKey);
            measurementCache.delete(cacheKey);
            measurementCache.set(cacheKey, cached);
            cacheHits += 1;
            return cached;
        }
        cacheMisses += 1;
        setPageStyles(pageElement, pageBox, typography);
        Object.assign(host.style, {
            width: `${pageBox.width}px`,
            height: `${pageBox.height}px`,
        });
        renderFlowFragments(contentElement, {
            fragments: context.fragments,
            pageBox,
            languageKey: resolvedLanguageKey,
            writingMode: resolvedWritingMode,
            typography,
            hyphenation,
        });
        const scrollWidth = contentElement.scrollWidth;
        const scrollHeight = contentElement.scrollHeight;
        const clientWidth = contentElement.clientWidth;
        const clientHeight = contentElement.clientHeight;
        const contentRect = contentElement.getBoundingClientRect();
        const boundsOverflow = Array.from(contentElement.children).some((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.left < contentRect.left - FLOW_DOM_BOUNDS_EPSILON_PX
                || childRect.right > contentRect.right + FLOW_DOM_BOUNDS_EPSILON_PX
                || childRect.top < contentRect.top - FLOW_DOM_BOUNDS_EPSILON_PX
                || childRect.bottom > contentRect.bottom + FLOW_DOM_BOUNDS_EPSILON_PX;
        });
        const result = Object.freeze({
            fits: scrollWidth <= clientWidth
                && scrollHeight <= clientHeight
                && !boundsOverflow,
            scrollWidth,
            scrollHeight,
            clientWidth,
            clientHeight,
            boundsOverflow,
        });
        if (maxCacheEntries > 0) {
            measurementCache.set(cacheKey, result);
            while (measurementCache.size > maxCacheEntries) {
                measurementCache.delete(measurementCache.keys().next().value);
            }
        }
        return result;
    };

    return Object.freeze({
        measurePage,
        typography,
        writingMode,
        hyphenation,
        element: host,
        invalidate() {
            layoutEpoch += 1;
            measurementCache.clear();
            return layoutEpoch;
        },
        getLayoutKey() {
            return JSON.stringify([
                FLOW_DOM_RENDERER_VERSION,
                layoutEpoch,
                languageKey,
                writingMode,
                typography,
                hyphenation,
            ]);
        },
        getMetrics() {
            return Object.freeze({
                totalCalls,
                cacheHits,
                cacheMisses,
                cacheSize: measurementCache.size,
                layoutEpoch,
            });
        },
        resetMetrics() {
            totalCalls = 0;
            cacheHits = 0;
            cacheMisses = 0;
        },
        dispose() {
            measurementCache.clear();
            host.remove();
        },
    });
}

/** Wait for the browser's selected font metrics before the first pagination. */
export async function waitForFlowFonts(
    ownerDocument,
    typography,
    writingMode = FLOW_DOM_SUPPORTED_WRITING_MODE,
    languageKey = 'ja',
) {
    const fonts = ownerDocument?.fonts;
    if (!fonts) return;
    const resolved = resolveFlowDomTypography(languageKey, typography, writingMode);
    try {
        await fonts.ready;
        await Promise.all([
            fonts.load(`${resolved.fontWeight} ${resolved.fontSize}px ${resolved.fontFamily}`),
            fonts.load(`700 ${resolved.fontSize * HEADING_SCALES[1]}px ${resolved.fontFamily}`),
        ]);
    } catch (_) {
        // The fallback font stack is still measurable when a web font fails.
    }
}
