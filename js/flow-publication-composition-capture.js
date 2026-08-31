/**
 * Browser-only certified Flow composition capture for DSF publication.
 *
 * A session loads the exact registry font, paginates with hyphenation disabled,
 * then captures DOM Range line/column geometry and semantic grapheme ranges.
 * It does not persist data or connect to Press, release assembly, Viewer, or storage.
 */

import { resolveDsfProductionFont } from './dsf-font-registry.js';
import {
    assertValidFlowDocument,
    isFlowTextBlock,
} from './flow-document.js';
import {
    FLOW_DOM_RENDERER_VERSION,
    createFlowDomPageMeasurer,
    renderFlowGeneratedPage,
    resolveFlowDomTypography,
} from './flow-dom-measurer.js';
import {
    createCanonicalFlowPageBox,
    paginateFlowDocument,
} from './flow-pagination.js';
import {
    FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION,
    resolveFlowPublicationTypography,
} from './flow-publication-projection.js';
import { segmentGraphemes } from './grapheme.js';

export const FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION = 1;
export const FLOW_PUBLICATION_COMPOSITION_HYPHENATION = 'none';

const RECT_EPSILON_PX = 0.5;
const LINE_AXIS_EPSILON_PX = 1;
const GEOMETRY_DECIMALS = 3;

export class FlowPublicationCompositionCaptureError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowPublicationCompositionCaptureError';
        this.code = code;
        this.context = context;
        if (context.cause) this.cause = context.cause;
    }
}

function fail(code, message, context) {
    throw new FlowPublicationCompositionCaptureError(code, message, context);
}

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function exactString(value, path) {
    if (typeof value !== 'string' || !value || value !== value.trim()) {
        fail('FLOW_PUBLICATION_CAPTURE_INPUT_INVALID', `${path} must be a non-empty trimmed string.`, {
            path,
            value,
        });
    }
    return value;
}

function normalizeFontWeight(value, path) {
    const weight = Number(value);
    if (!Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) {
        fail('FLOW_PUBLICATION_CAPTURE_TYPOGRAPHY_INVALID', `${path} is not a supported font weight.`, {
            path,
            value,
        });
    }
    return weight;
}

function primaryFontFamily(value) {
    return String(value || '')
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, '');
}

function quoteFontFamily(value) {
    return `"${String(value || '').replace(/["\\]/g, '')}"`;
}

function samePageBox(left, right) {
    return left?.width === right?.width
        && left?.height === right?.height
        && left?.padding?.top === right?.padding?.top
        && left?.padding?.right === right?.padding?.right
        && left?.padding?.bottom === right?.padding?.bottom
        && left?.padding?.left === right?.padding?.left
        && left?.contentBox?.x === right?.contentBox?.x
        && left?.contentBox?.y === right?.contentBox?.y
        && left?.contentBox?.width === right?.contentBox?.width
        && left?.contentBox?.height === right?.contentBox?.height;
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    return Object.freeze(value);
}

function roundGeometry(value) {
    const factor = 10 ** GEOMETRY_DECIMALS;
    return Math.round(value * factor) / factor;
}

function finiteRect(rect, path) {
    const x = Number(rect?.x);
    const y = Number(rect?.y);
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
        fail('FLOW_PUBLICATION_CAPTURE_RECT_INVALID', `${path} is not a finite DOM rectangle.`, {
            path,
            rect,
        });
    }
    return { x, y, width, height };
}

function unionRects(rects) {
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function sameVisualLine(left, right, writingMode) {
    const vertical = writingMode === 'vertical-rl';
    const leftStart = vertical ? left.x : left.y;
    const rightStart = vertical ? right.x : right.y;
    const leftSize = vertical ? left.width : left.height;
    const rightSize = vertical ? right.width : right.height;
    const overlap = Math.min(leftStart + leftSize, rightStart + rightSize)
        - Math.max(leftStart, rightStart);
    return Math.abs(leftStart - rightStart) <= LINE_AXIS_EPSILON_PX
        || overlap >= Math.min(leftSize, rightSize) / 2;
}

function createLineGroup(blockId, items, rects, writingMode) {
    if (rects.length < 1) {
        fail('FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED', 'A semantic source range has no measurable DOM line.', {
            blockId,
            startGrapheme: items[0]?.startGrapheme,
            endGrapheme: items.at(-1)?.endGrapheme,
        });
    }
    const geometry = unionRects(rects);
    if (geometry.width <= 0 || geometry.height <= 0) {
        fail('FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED', 'Measured DOM line has no two-dimensional bounds.', {
            blockId,
            geometry,
        });
    }
    return {
        x: roundGeometry(geometry.x),
        y: roundGeometry(geometry.y),
        width: roundGeometry(geometry.width),
        height: roundGeometry(geometry.height),
        writingMode,
        textOrientation: 'mixed',
        runs: [{
            text: items.map((item) => item.text).join(''),
            source: {
                blockId,
                startGrapheme: items[0].startGrapheme,
                endGrapheme: items.at(-1).endGrapheme,
            },
        }],
    };
}

/**
 * Pure grouping helper. Input rectangles are page-relative Range measurements.
 * Zero-rect graphemes such as a newline stay attached to the adjacent source run.
 */
export function groupFlowPublicationGraphemeRects(items, options = {}) {
    const writingMode = String(options.writingMode || 'horizontal-tb');
    if (!['horizontal-tb', 'vertical-rl'].includes(writingMode)) {
        fail('FLOW_PUBLICATION_CAPTURE_WRITING_MODE_INVALID', 'Capture grouping requires a supported writing mode.', {
            writingMode,
        });
    }
    const blockId = exactString(options.blockId, 'blockId');
    if (!Array.isArray(items) || items.length < 1) {
        fail('FLOW_PUBLICATION_CAPTURE_SOURCE_INVALID', 'Capture grouping requires at least one grapheme.', {
            blockId,
        });
    }

    let expectedStart = Number(items[0]?.startGrapheme);
    const normalized = items.map((item, index) => {
        const startGrapheme = Number(item?.startGrapheme);
        const endGrapheme = Number(item?.endGrapheme);
        if (typeof item?.text !== 'string'
            || !Number.isInteger(startGrapheme)
            || !Number.isInteger(endGrapheme)
            || startGrapheme !== expectedStart
            || endGrapheme !== startGrapheme + 1) {
            fail('FLOW_PUBLICATION_CAPTURE_SOURCE_INVALID', 'Measured graphemes must be consecutive one-grapheme source ranges.', {
                blockId,
                index,
                item,
                expectedStart,
            });
        }
        expectedStart = endGrapheme;
        const rects = Array.isArray(item.rects)
            ? item.rects.map((rect, rectIndex) => finiteRect(rect, `items[${index}].rects[${rectIndex}]`))
            : [];
        const measurableRects = rects.filter((rect) => rect.width > 0 || rect.height > 0);
        const axisRects = measurableRects.filter((rect) => (
            writingMode === 'vertical-rl' ? rect.width > 0 : rect.height > 0
        ));
        if (axisRects.length > 1) {
            const first = axisRects[0];
            if (axisRects.some((rect) => !sameVisualLine(first, rect, writingMode))) {
                fail('FLOW_PUBLICATION_CAPTURE_GRAPHEME_SPLIT', 'One grapheme spans multiple visual lines or columns.', {
                    blockId,
                    index,
                });
            }
        }
        return {
            text: item.text,
            startGrapheme,
            endGrapheme,
            rects: measurableRects,
            anchorRect: axisRects.length > 0 ? unionRects(axisRects) : null,
        };
    });

    const groups = [];
    let pending = [];
    let current = null;
    for (const item of normalized) {
        if (!item.anchorRect) {
            if (current) current.items.push(item);
            else pending.push(item);
            continue;
        }
        if (!current || !sameVisualLine(current.anchorRect, item.anchorRect, writingMode)) {
            if (current) groups.push(current);
            current = {
                anchorRect: item.anchorRect,
                items: [...pending, item],
                rects: [...pending.flatMap((entry) => entry.rects), ...item.rects],
            };
            pending = [];
        } else {
            current.items.push(item);
            current.rects.push(...item.rects);
            current.anchorRect = unionRects([current.anchorRect, item.anchorRect]);
        }
    }
    if (current) groups.push(current);
    if (pending.length > 0) {
        if (groups.length < 1) {
            fail('FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED', 'The source range produced no measurable DOM rectangle.', {
                blockId,
            });
        }
        const last = groups.at(-1);
        last.items.push(...pending);
        last.rects.push(...pending.flatMap((entry) => entry.rects));
    }
    return groups.map((group) => createLineGroup(blockId, group.items, group.rects, writingMode));
}

function resolveCaptureContext(options) {
    const ownerDocument = options.ownerDocument || globalThis.document;
    if (!ownerDocument?.body || typeof ownerDocument.createRange !== 'function' || !ownerDocument.fonts) {
        fail('FLOW_PUBLICATION_CAPTURE_DOM_REQUIRED', 'A browser document with Range and FontFaceSet APIs is required.');
    }
    const flowGroup = options.flowGroup;
    if (!isRecord(flowGroup) || flowGroup.kind !== 'flow' || !isRecord(flowGroup.flow)) {
        fail('FLOW_PUBLICATION_CAPTURE_GROUP_INVALID', 'A Project v6 Flow Group is required.');
    }
    const document = flowGroup.flow.document;
    try {
        assertValidFlowDocument(document);
    } catch (cause) {
        fail('FLOW_PUBLICATION_CAPTURE_DOCUMENT_INVALID', cause.message, {
            cause,
            issues: cause?.issues || [],
        });
    }
    const language = exactString(options.language, 'language');
    for (const section of document.sections) {
        for (const block of section.blocks) {
            if (isFlowTextBlock(block) && (!hasOwn(block.texts, language) || typeof block.texts[language] !== 'string')) {
                fail('FLOW_PUBLICATION_CAPTURE_LANGUAGE_INCOMPLETE', 'Every Flow text block requires the exact capture language.', {
                    blockId: block.id,
                    language,
                });
            }
        }
    }
    const revision = Number(options.revision);
    if (!Number.isInteger(revision) || revision < 0) {
        fail('FLOW_PUBLICATION_CAPTURE_REVISION_INVALID', 'Capture revision must be a non-negative integer.', {
            revision: options.revision,
        });
    }
    const profile = flowGroup.flow.layout?.typographyByLanguage?.[language];
    if (!isRecord(profile)) {
        fail('FLOW_PUBLICATION_CAPTURE_TYPOGRAPHY_MISSING', 'Flow publication typography is missing.', {
            language,
        });
    }
    const writingMode = String(profile.writingMode || 'horizontal-tb');
    const fontId = exactString(options.fontId, 'fontId');
    const pageBox = createCanonicalFlowPageBox({ padding: flowGroup.flow.layout?.padding });
    let authorTypography;
    const typographyOptions = { languageConfigs: options.languageConfigs };
    try {
        authorTypography = resolveFlowDomTypography(language, profile, writingMode, typographyOptions);
    } catch (cause) {
        fail('FLOW_PUBLICATION_CAPTURE_TYPOGRAPHY_INVALID', cause.message, { cause });
    }
    const bodyWeight = normalizeFontWeight(authorTypography.fontWeight, 'typography.fontWeight');
    const requiredWeights = new Set([bodyWeight]);
    if (document.sections.some((section) => section.blocks.some((block) => block.type === 'heading'))) {
        requiredWeights.add(700);
    }
    let resolvedFont = null;
    for (const fontWeight of requiredWeights) {
        const resolution = resolveDsfProductionFont(options.fontRegistry, fontId, {
            language,
            writingMode,
            fontWeight,
            fontStyle: 'normal',
        });
        if (!resolution.ok) {
            fail(resolution.code || 'FONT_NOT_CERTIFIED', 'Flow publication font is not certified for capture.', {
                fontId,
                language,
                writingMode,
                fontWeight,
                issues: resolution.issues || [],
            });
        }
        resolvedFont = resolution.font;
    }
    const certifiedFamily = resolvedFont.declaration.family;
    if (primaryFontFamily(authorTypography.fontFamily) !== certifiedFamily) {
        fail('FLOW_PUBLICATION_CAPTURE_FONT_FAMILY_MISMATCH', 'Certified font family does not match Flow typography.', {
            authorFontFamily: authorTypography.fontFamily,
            certifiedFamily,
        });
    }
    const typography = resolveFlowPublicationTypography(
        language,
        profile,
        writingMode,
        certifiedFamily,
        typographyOptions,
    );
    const runtimeFontFamily = options.runtimeFontFamily === undefined
        ? certifiedFamily
        : exactString(options.runtimeFontFamily, 'runtimeFontFamily');
    const measurementTypography = runtimeFontFamily === certifiedFamily
        ? typography
        : { ...typography, fontFamily: quoteFontFamily(runtimeFontFamily) };
    return {
        ownerDocument,
        flowGroup,
        document,
        language,
        revision,
        writingMode,
        pageBox,
        typography,
        measurementTypography,
        fontId,
        font: resolvedFont,
        runtimeFontFamily,
        requiredWeights: [...requiredWeights],
    };
}

async function nextPaint(ownerDocument) {
    const requestFrame = ownerDocument.defaultView?.requestAnimationFrame?.bind(ownerDocument.defaultView);
    if (!requestFrame) return;
    await new Promise((resolve) => requestFrame(() => requestFrame(resolve)));
}

async function loadCertifiedFonts(context) {
    const { ownerDocument, measurementTypography, requiredWeights } = context;
    const family = quoteFontFamily(context.runtimeFontFamily);
    const probeText = '永Ag雪、。()123';
    try {
        await ownerDocument.fonts.ready;
        for (const weight of requiredWeights) {
            const descriptor = `${weight} ${measurementTypography.fontSize}px ${family}`;
            const loaded = await ownerDocument.fonts.load(descriptor, probeText);
            if (!Array.from(loaded || []).length || !ownerDocument.fonts.check(descriptor, probeText)) {
                fail('FLOW_PUBLICATION_CAPTURE_FONT_UNAVAILABLE', 'The certified publication font is unavailable in this browser.', {
                    fontId: context.fontId,
                    family: context.runtimeFontFamily,
                    weight,
                });
            }
        }
        await ownerDocument.fonts.ready;
        await nextPaint(ownerDocument);
    } catch (cause) {
        if (cause instanceof FlowPublicationCompositionCaptureError) throw cause;
        fail('FLOW_PUBLICATION_CAPTURE_FONT_UNAVAILABLE', 'The certified publication font could not be loaded.', {
            fontId: context.fontId,
            family: context.runtimeFontFamily,
            cause,
        });
    }
}

function createCaptureSurface(context) {
    const { ownerDocument, pageBox } = context;
    const host = ownerDocument.createElement('div');
    const pageElement = ownerDocument.createElement('div');
    host.className = 'flow-publication-composition-capture-host';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: `${pageBox.width}px`,
        height: `${pageBox.height}px`,
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
        contain: 'strict',
    });
    host.appendChild(pageElement);
    ownerDocument.body.appendChild(host);
    return { host, pageElement };
}

function pageRelativeRect(rect, pageRect) {
    return {
        x: rect.left - pageRect.left,
        y: rect.top - pageRect.top,
        width: rect.width,
        height: rect.height,
    };
}

function normalizeCapturedGeometry(line, contentBox, context = {}) {
    const raw = finiteRect(line, 'capturedLine');
    const rawRight = raw.x + raw.width;
    const rawBottom = raw.y + raw.height;
    const contentRight = contentBox.x + contentBox.width;
    const contentBottom = contentBox.y + contentBox.height;
    if (raw.x < contentBox.x - RECT_EPSILON_PX
        || raw.y < contentBox.y - RECT_EPSILON_PX
        || rawRight > contentRight + RECT_EPSILON_PX
        || rawBottom > contentBottom + RECT_EPSILON_PX) {
        fail('FLOW_PUBLICATION_CAPTURE_LINE_OUTSIDE_CONTENT_BOX', 'Measured line exceeds the author-defined content box.', {
            ...context,
            line: raw,
            contentBox,
        });
    }
    const x = Math.max(contentBox.x, raw.x);
    const y = Math.max(contentBox.y, raw.y);
    const right = Math.min(contentRight, rawRight);
    const bottom = Math.min(contentBottom, rawBottom);
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0) {
        fail('FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED', 'Measured line has no usable bounds.', {
            ...context,
            line: raw,
        });
    }
    return {
        ...line,
        x: roundGeometry(x),
        y: roundGeometry(y),
        width: roundGeometry(width),
        height: roundGeometry(height),
    };
}

function captureEmptyFragmentLine(element, fragment, context, pageRect) {
    const geometry = normalizeCapturedGeometry({
        ...pageRelativeRect(element.getBoundingClientRect(), pageRect),
        writingMode: context.writingMode,
        textOrientation: 'mixed',
        runs: [{
            text: '',
            source: {
                blockId: fragment.blockId,
                startGrapheme: fragment.sourceRange.startGrapheme,
                endGrapheme: fragment.sourceRange.endGrapheme,
            },
        }],
    }, context.pageBox.contentBox, { blockId: fragment.blockId });
    return geometry;
}

function captureFragmentLines(element, fragment, context, pageRect) {
    const expectedCount = fragment.sourceRange.endGrapheme - fragment.sourceRange.startGrapheme;
    if (fragment.text === '') {
        if (expectedCount !== 0) {
            fail('FLOW_PUBLICATION_CAPTURE_SOURCE_MISMATCH', 'Empty fragment has a non-empty semantic range.', {
                blockId: fragment.blockId,
            });
        }
        return [captureEmptyFragmentLine(element, fragment, context, pageRect)];
    }
    const textNode = element.firstChild;
    if (!textNode || textNode.nodeType !== 3 || textNode.data !== fragment.text) {
        fail('FLOW_PUBLICATION_CAPTURE_DOM_SOURCE_MISMATCH', 'Rendered Flow text does not match its pagination fragment.', {
            blockId: fragment.blockId,
        });
    }
    const segments = segmentGraphemes(fragment.text, context.language);
    if (segments.length !== expectedCount) {
        fail('FLOW_PUBLICATION_CAPTURE_SOURCE_MISMATCH', 'Rendered fragment grapheme count does not match pagination.', {
            blockId: fragment.blockId,
            expectedCount,
            actualCount: segments.length,
        });
    }
    const items = segments.map((segment, localIndex) => {
        const range = context.ownerDocument.createRange();
        range.setStart(textNode, segment.index);
        range.setEnd(textNode, segment.end);
        const rects = Array.from(range.getClientRects(), (rect) => pageRelativeRect(rect, pageRect));
        range.detach?.();
        return {
            text: segment.segment,
            startGrapheme: fragment.sourceRange.startGrapheme + localIndex,
            endGrapheme: fragment.sourceRange.startGrapheme + localIndex + 1,
            rects,
        };
    });
    const lines = groupFlowPublicationGraphemeRects(items, {
        blockId: fragment.blockId,
        writingMode: context.writingMode,
    });
    return lines.map((line) => normalizeCapturedGeometry(
        line,
        context.pageBox.contentBox,
        { blockId: fragment.blockId },
    ));
}

function cloneManualBreak(value) {
    return value ? { sectionId: value.sectionId, blockId: value.blockId } : null;
}

function assertPaginationContext(pagination, context) {
    if (!isRecord(pagination)
        || pagination.documentId !== context.document.id
        || pagination.languageKey !== context.language
        || pagination.writingMode !== context.writingMode
        || !samePageBox(pagination.pageBox, context.pageBox)
        || !Array.isArray(pagination.pages)
        || pagination.pages.length < 1) {
        fail('FLOW_PUBLICATION_CAPTURE_PAGINATION_MISMATCH', 'Pagination does not belong to this publication capture session.');
    }
}

function capturePage(page, context, surface) {
    const contentElement = renderFlowGeneratedPage(surface.pageElement, {
        page,
        pageBox: context.pageBox,
        languageKey: context.language,
        writingMode: context.writingMode,
        typography: context.measurementTypography,
        hyphenation: FLOW_PUBLICATION_COMPOSITION_HYPHENATION,
    });
    if (contentElement.style.hyphens !== FLOW_PUBLICATION_COMPOSITION_HYPHENATION
        || Array.from(contentElement.children).some((child) => (
            child.style.hyphens !== FLOW_PUBLICATION_COMPOSITION_HYPHENATION
        ))) {
        fail('FLOW_PUBLICATION_CAPTURE_HYPHENATION_MISMATCH', 'Publication DOM did not retain no-hyphenation mode.', {
            pageIndex: page.index,
        });
    }
    const computedFamily = primaryFontFamily(
        context.ownerDocument.defaultView?.getComputedStyle(contentElement)?.fontFamily,
    );
    if (computedFamily !== context.runtimeFontFamily) {
        fail('FLOW_PUBLICATION_CAPTURE_FONT_MISMATCH', 'Measured DOM does not use the certified font family.', {
            pageIndex: page.index,
            expected: context.runtimeFontFamily,
            actual: computedFamily,
        });
    }
    const contentRect = contentElement.getBoundingClientRect();
    const boundsOverflow = Array.from(contentElement.children).some((child) => {
        const rect = child.getBoundingClientRect();
        return rect.left < contentRect.left - RECT_EPSILON_PX
            || rect.right > contentRect.right + RECT_EPSILON_PX
            || rect.top < contentRect.top - RECT_EPSILON_PX
            || rect.bottom > contentRect.bottom + RECT_EPSILON_PX;
    });
    if (contentElement.scrollWidth > contentElement.clientWidth
        || contentElement.scrollHeight > contentElement.clientHeight
        || boundsOverflow) {
        fail('FLOW_PUBLICATION_CAPTURE_PAGE_OVERFLOW', 'A paginated Flow page overflows in certified publication composition.', {
            pageIndex: page.index,
            scrollWidth: contentElement.scrollWidth,
            scrollHeight: contentElement.scrollHeight,
            clientWidth: contentElement.clientWidth,
            clientHeight: contentElement.clientHeight,
            boundsOverflow,
        });
    }
    const elements = Array.from(contentElement.children);
    if (elements.length !== page.fragments.length) {
        fail('FLOW_PUBLICATION_CAPTURE_DOM_SOURCE_MISMATCH', 'Rendered Flow block count differs from pagination.', {
            pageIndex: page.index,
        });
    }
    const pageRect = surface.pageElement.getBoundingClientRect();
    const lines = elements.flatMap((element, fragmentIndex) => captureFragmentLines(
        element,
        page.fragments[fragmentIndex],
        context,
        pageRect,
    ));
    return {
        index: page.index,
        manualBreakBefore: cloneManualBreak(page.manualBreakBefore),
        lines,
    };
}

/**
 * Create one font-bound local publication session.
 * Pagination returned by this session is the only pagination it will capture.
 */
export async function createFlowPublicationCompositionCaptureSession(options = {}) {
    const context = resolveCaptureContext(options);
    await loadCertifiedFonts(context);
    const measurer = createFlowDomPageMeasurer({
        ownerDocument: context.ownerDocument,
        languageKey: context.language,
        writingMode: context.writingMode,
        typography: context.measurementTypography,
        hyphenation: FLOW_PUBLICATION_COMPOSITION_HYPHENATION,
    });
    const surface = createCaptureSurface(context);
    const ownedPaginations = new WeakSet();
    let disposed = false;

    const assertActive = () => {
        if (disposed) {
            fail('FLOW_PUBLICATION_CAPTURE_SESSION_DISPOSED', 'The Flow publication capture session is disposed.');
        }
    };

    return Object.freeze({
        captureVersion: FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION,
        rendererVersion: FLOW_DOM_RENDERER_VERSION,
        flowGroupId: context.flowGroup.id,
        documentId: context.document.id,
        language: context.language,
        revision: context.revision,
        writingMode: context.writingMode,
        pageBox: context.pageBox,
        typography: context.typography,
        runtimeFontFamily: context.runtimeFontFamily,
        font: deepFreeze({
            id: context.fontId,
            declaration: { ...context.font.declaration },
        }),
        paginate(paginationOptions = {}) {
            assertActive();
            const pagination = paginateFlowDocument(context.document, {
                languageKey: context.language,
                writingMode: context.writingMode,
                pageBox: context.pageBox,
                measurePage: measurer.measurePage,
                ...(paginationOptions.maxPages === undefined
                    ? {}
                    : { maxPages: paginationOptions.maxPages }),
            });
            ownedPaginations.add(pagination);
            return pagination;
        },
        capture(pagination) {
            assertActive();
            if (!isRecord(pagination) || !ownedPaginations.has(pagination)) {
                fail('FLOW_PUBLICATION_CAPTURE_PAGINATION_UNTRUSTED', 'Capture accepts only pagination created by the same certified session.');
            }
            assertPaginationContext(pagination, context);
            const pages = pagination.pages.map((page) => capturePage(page, context, surface));
            return deepFreeze({
                schemaVersion: FLOW_PUBLICATION_SNAPSHOT_SCHEMA_VERSION,
                status: 'complete',
                revision: context.revision,
                rendererVersion: FLOW_DOM_RENDERER_VERSION,
                flowGroupId: context.flowGroup.id,
                documentId: context.document.id,
                languageKey: context.language,
                writingMode: context.writingMode,
                pageBox: context.pageBox,
                typography: context.typography,
                evidence: {
                    fontId: context.fontId,
                    fontSha256: context.font.declaration.sha256,
                    hyphenation: FLOW_PUBLICATION_COMPOSITION_HYPHENATION,
                },
                pages,
            });
        },
        getMetrics() {
            return measurer.getMetrics();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            measurer.dispose();
            surface.host.remove();
        },
    });
}
