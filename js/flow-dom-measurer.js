/**
 * Browser DOM measurement and rendering adapter for Flow Layout.
 *
 * Commit 3 deliberately supports horizontal-tb only. The same fragment
 * renderer is used for measurement and visible preview pages so pagination
 * boundaries cannot drift because of duplicate markup.
 */

import { normalizeFlowPageBox } from './flow-pagination.js';
import { getFlowTypographyProfile } from './flow-typography.js';

export const FLOW_DOM_SUPPORTED_WRITING_MODE = 'horizontal-tb';

const DEFAULT_FONT_FAMILIES = Object.freeze({
    cjk: "'Noto Sans JP','Noto Sans CJK JP','Hiragino Sans','Yu Gothic UI',sans-serif",
    latin: "'Noto Sans',Arial,'Helvetica Neue','Segoe UI',sans-serif",
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

export function assertFlowDomWritingMode(writingMode) {
    const mode = String(writingMode || FLOW_DOM_SUPPORTED_WRITING_MODE);
    if (mode !== FLOW_DOM_SUPPORTED_WRITING_MODE) {
        throw new FlowDomMeasurementError(
            'UNSUPPORTED_WRITING_MODE',
            `DOM Flow preview currently supports only ${FLOW_DOM_SUPPORTED_WRITING_MODE}.`,
            { writingMode: mode },
        );
    }
    return mode;
}

export function resolveFlowDomTypography(languageKey = 'ja', overrides = {}) {
    const profile = getFlowTypographyProfile(languageKey, FLOW_DOM_SUPPORTED_WRITING_MODE);
    const cjk = ['jpan', 'hans', 'hant', 'kore'].includes(profile.script);
    const textAlign = String(overrides.textAlign || 'start');
    if (!['start', 'center', 'end', 'justify'].includes(textAlign)) {
        throw new FlowDomMeasurementError('INVALID_TYPOGRAPHY', 'textAlign is unsupported.', {
            path: 'textAlign',
            value: overrides.textAlign,
        });
    }
    return Object.freeze({
        fontFamily: String(overrides.fontFamily || (cjk ? DEFAULT_FONT_FAMILIES.cjk : DEFAULT_FONT_FAMILIES.latin)),
        fontSize: requireFiniteNumber(overrides.fontSize, 16, 'fontSize', { positive: true }),
        fontWeight: String(overrides.fontWeight ?? '400'),
        lineHeight: requireFiniteNumber(overrides.lineHeight, 1.8, 'lineHeight', { positive: true }),
        letterSpacing: requireFiniteNumber(overrides.letterSpacing, 0, 'letterSpacing'),
        textAlign,
        paragraphSpacing: requireFiniteNumber(overrides.paragraphSpacing, 12, 'paragraphSpacing', { minimum: 0 }),
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

function setContentStyles(contentElement, pageBox, typography, languageKey, writingMode) {
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
        hyphens: 'auto',
        textRendering: 'optimizeLegibility',
    });
    contentElement.lang = String(languageKey || 'ja');
}

function createFragmentElement(ownerDocument, fragment, typography) {
    const element = ownerDocument.createElement(fragment.blockType === 'heading' ? 'h2' : 'p');
    element.className = `flow-dom-block flow-dom-block--${fragment.blockType}`;
    element.dataset.flowBlockId = fragment.blockId;
    element.dataset.flowBlockType = fragment.blockType;
    element.dataset.sourceStart = String(fragment.sourceRange.start);
    element.dataset.sourceEnd = String(fragment.sourceRange.end);
    element.dataset.blockStart = String(fragment.isBlockStart);
    element.dataset.blockEnd = String(fragment.isBlockEnd);
    const isHeading = fragment.blockType === 'heading';
    const headingLevel = Math.max(1, Math.min(6, Number(fragment.headingLevel) || 1));
    const fontScale = isHeading ? HEADING_SCALES[headingLevel] : 1;
    const spacing = isHeading ? typography.headingSpacing : typography.paragraphSpacing;
    Object.assign(element.style, {
        display: 'block',
        margin: '0',
        border: '0',
        padding: '0',
        paddingBlockEnd: fragment.isBlockEnd ? `${spacing}px` : '0px',
        minHeight: `${typography.fontSize * typography.lineHeight}px`,
        font: 'inherit',
        fontFamily: 'inherit',
        fontSize: `${typography.fontSize * fontScale}px`,
        fontWeight: isHeading ? '700' : typography.fontWeight,
        lineHeight: isHeading ? String(Math.max(1.35, typography.lineHeight - 0.15)) : String(typography.lineHeight),
        letterSpacing: 'inherit',
        textAlign: 'inherit',
        color: 'inherit',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'normal',
        lineBreak: typography.lineBreak,
        hyphens: 'auto',
    });
    if (fragment.text) {
        element.textContent = fragment.text;
    } else {
        element.textContent = '\u200B';
        element.dataset.emptyFragment = 'true';
    }
    return element;
}

/** Render fragments into an existing content box. */
export function renderFlowFragments(contentElement, options = {}) {
    if (!contentElement?.ownerDocument) {
        throw new FlowDomMeasurementError('DOM_REQUIRED', 'A DOM content element is required.');
    }
    const writingMode = assertFlowDomWritingMode(options.writingMode);
    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || 'ja');
    const typography = resolveFlowDomTypography(languageKey, options.typography);
    const fragments = Array.isArray(options.fragments) ? options.fragments : [];

    contentElement.replaceChildren();
    contentElement.className = 'flow-dom-content';
    setContentStyles(contentElement, pageBox, typography, languageKey, writingMode);
    for (const fragment of fragments) {
        contentElement.appendChild(createFragmentElement(contentElement.ownerDocument, fragment, typography));
    }
    return { pageBox, typography };
}

/** Render one generated page using the same DOM path as measurement. */
export function renderFlowGeneratedPage(pageElement, options = {}) {
    if (!pageElement?.ownerDocument) {
        throw new FlowDomMeasurementError('DOM_REQUIRED', 'A DOM page element is required.');
    }
    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || 'ja');
    const typography = resolveFlowDomTypography(languageKey, options.typography);
    setPageStyles(pageElement, pageBox, typography);
    pageElement.replaceChildren();
    const contentElement = pageElement.ownerDocument.createElement('div');
    pageElement.appendChild(contentElement);
    renderFlowFragments(contentElement, {
        fragments: options.page?.fragments,
        pageBox,
        languageKey,
        writingMode: options.writingMode,
        typography,
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
    const typography = resolveFlowDomTypography(languageKey, options.typography);
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
        const pageBox = normalizeFlowPageBox(context.pageBox);
        const writingMode = assertFlowDomWritingMode(context.writingMode);
        setPageStyles(pageElement, pageBox, typography);
        Object.assign(host.style, {
            width: `${pageBox.width}px`,
            height: `${pageBox.height}px`,
        });
        renderFlowFragments(contentElement, {
            fragments: context.fragments,
            pageBox,
            languageKey: context.languageKey || languageKey,
            writingMode,
            typography,
        });
        const scrollWidth = contentElement.scrollWidth;
        const scrollHeight = contentElement.scrollHeight;
        const clientWidth = contentElement.clientWidth;
        const clientHeight = contentElement.clientHeight;
        return {
            fits: scrollWidth <= clientWidth && scrollHeight <= clientHeight,
            scrollWidth,
            scrollHeight,
            clientWidth,
            clientHeight,
        };
    };

    return Object.freeze({
        measurePage,
        typography,
        element: host,
        dispose() {
            host.remove();
        },
    });
}

/** Wait for the browser's selected font metrics before the first pagination. */
export async function waitForFlowFonts(ownerDocument, typography) {
    const fonts = ownerDocument?.fonts;
    if (!fonts) return;
    const resolved = resolveFlowDomTypography('ja', typography);
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
