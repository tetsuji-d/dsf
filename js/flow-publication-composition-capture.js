import {composeFlowWithAnchoredObjects} from './flow-wrap-composition.js';
import {getFlowPublicationAnnotationGlyphs} from './flow-publication-annotations.js';
import {getFlowFragmentDomPosition} from './flow-source-mapping.js';
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
import {
    FIXED_TEXT_WHITE_SPACE_MODE,
    FIXED_TEXT_TAB_SIZE,
    applyFixedTextWhiteSpaceStyle,
    renderFixedTextRunText,
} from './fixed-text-whitespace.js';

export const FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION = 1;
export const FLOW_PUBLICATION_COMPOSITION_HYPHENATION = 'none';

const RECT_EPSILON_PX = 0.5;
const LINE_AXIS_EPSILON_PX = 1;
const GEOMETRY_DECIMALS = 3;
const NEWLINE_PATTERN = /^[\r\n]+$/;

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
    const emptyVisualLine = items.every((item) => NEWLINE_PATTERN.test(item.text))
        && (writingMode === 'vertical-rl' ? geometry.width > 0 : geometry.height > 0);
    if ((geometry.width <= 0 || geometry.height <= 0) && !emptyVisualLine) {
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

function itemRect(item) {
    const rects = Array.isArray(item?.rects)
        ? item.rects.map((rect, index) => finiteRect(rect, `grapheme.rects[${index}]`))
            .filter((rect) => rect.width > 0 || rect.height > 0)
        : [];
    return rects.length > 0 ? unionRects(rects) : null;
}

function zeroAdvanceNewline(item, rect, writingMode) {
    if (!NEWLINE_PATTERN.test(String(item?.text || ''))) return false;
    return !rect || (writingMode === 'vertical-rl' ? rect.height : rect.width) <= RECT_EPSILON_PX;
}

function isHangingWhitespace(items, index) {
    // pre-wrap allows end-of-line whitespace to hang beyond the body box.
    // They retain their advance and must still match the probe exactly, but
    // clipping their inkless overflow does not clip a visible glyph.
    return /^[ \t\u00a0\u3000]+$/.test(items[index]?.text || '')
        && items.slice(index).every((item) => /^[ \t\u00a0\u3000\r\n]+$/.test(item.text));
}

function closeGeometry(left, right) {
    return Math.abs(left - right) <= RECT_EPSILON_PX;
}

/**
 * Resolve the Viewer line/column box which places its measured glyph ranges on
 * top of the original Flow glyph ranges. Newline ranges without inline advance
 * are semantic separators and do not provide a placement anchor.
 *
 * This helper is pure so the geometry contract can be checked without a DOM.
 */
export function resolveFlowPublicationLineBox(input = {}) {
    const writingMode = String(input.writingMode || 'horizontal-tb');
    if (!['horizontal-tb', 'vertical-rl'].includes(writingMode)) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_INVALID', 'A supported line-box writing mode is required.', {
            writingMode,
        });
    }
    const width = Number(input.width);
    const height = Number(input.height);
    if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_INVALID', 'The measured Viewer line box must have a positive finite size.', {
            width: input.width,
            height: input.height,
        });
    }
    const sourceItems = input.sourceItems;
    const probeItems = input.probeItems;
    if (!Array.isArray(sourceItems)
        || !Array.isArray(probeItems)
        || sourceItems.length < 1
        || sourceItems.length !== probeItems.length) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH', 'Source and Viewer probe graphemes must be complete and equal in count.', {
            sourceCount: Array.isArray(sourceItems) ? sourceItems.length : null,
            probeCount: Array.isArray(probeItems) ? probeItems.length : null,
        });
    }

    const pairs = sourceItems.map((sourceItem, index) => {
        const probeItem = probeItems[index];
        if (typeof sourceItem?.text !== 'string'
            || !Number.isInteger(sourceItem.startGrapheme)
            || sourceItem.startGrapheme < 0
            || sourceItem.endGrapheme !== sourceItem.startGrapheme + 1
            || (index > 0 && sourceItem.startGrapheme !== sourceItems[index - 1].endGrapheme)
            || probeItem?.text !== sourceItem.text
            || probeItem?.startGrapheme !== sourceItem.startGrapheme
            || probeItem?.endGrapheme !== sourceItem.endGrapheme) {
            fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH', 'Viewer probe graphemes do not match the Flow source range.', {
                index,
                sourceItem,
                probeItem,
            });
        }
        const sourceRect = itemRect(sourceItem);
        const probeRect = itemRect(probeItem);
        const ignore = zeroAdvanceNewline(sourceItem, sourceRect, writingMode);
        if (!ignore && (!sourceRect || !probeRect)) {
            fail('FLOW_PUBLICATION_CAPTURE_GLYPH_UNMEASURED', 'A visible source grapheme has no corresponding Viewer range.', {
                index,
                text: sourceItem.text,
                startGrapheme: sourceItem.startGrapheme,
                sourceRect,
                probeRect,
            });
        }
        return { sourceItem, sourceRect, probeRect, ignore };
    });

    const anchor = pairs.find((pair) => !pair.ignore);
    if (!anchor) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_UNMEASURED', 'A line box requires at least one measurable non-newline grapheme.');
    }
    const x = anchor.sourceRect.x - anchor.probeRect.x;
    const y = anchor.sourceRect.y - anchor.probeRect.y;

    for (const [index, pair] of pairs.entries()) {
        if (pair.ignore) continue;
        const { sourceRect, probeRect, sourceItem } = pair;
        const expected = {
            x: x + probeRect.x,
            y: y + probeRect.y,
            width: probeRect.width,
            height: probeRect.height,
        };
        if (!closeGeometry(sourceRect.x, expected.x)
            || !closeGeometry(sourceRect.y, expected.y)
            || !closeGeometry(sourceRect.width, expected.width)
            || !closeGeometry(sourceRect.height, expected.height)) {
            fail('FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH', 'Viewer line-box composition does not reproduce every Flow glyph range.', {
                index,
                text: sourceItem.text,
                startGrapheme: sourceItem.startGrapheme,
                sourceRect,
                expected,
            });
        }
        const horizontalOverflow = probeRect.x < -RECT_EPSILON_PX
            || probeRect.x + probeRect.width > width + RECT_EPSILON_PX;
        const verticalOverflow = probeRect.y < -RECT_EPSILON_PX
            || probeRect.y + probeRect.height > height + RECT_EPSILON_PX;
        const crossOverflow = writingMode === 'vertical-rl' ? horizontalOverflow : verticalOverflow;
        const inlineOverflow = writingMode === 'vertical-rl' ? verticalOverflow : horizontalOverflow;
        if (crossOverflow || (inlineOverflow && !isHangingWhitespace(sourceItems, index))) {
            fail('FLOW_PUBLICATION_CAPTURE_GLYPH_OUTSIDE_LINEBOX', 'A Viewer glyph range exceeds its fixed line box.', {
                index,
                text: sourceItem.text,
                startGrapheme: sourceItem.startGrapheme,
                probeRect,
                lineBox: { width, height },
            });
        }
    }

    return {
        x: roundGeometry(x),
        y: roundGeometry(y),
        width: roundGeometry(width),
        height: roundGeometry(height),
    };
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
    // Background tabs may never receive an animation frame. Fonts are awaited
    // separately and the subsequent geometry reads synchronously flush layout.
    await new Promise(resolve => {
        const view=ownerDocument.defaultView;let first,second,settled=false;
        const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);if(first)view?.cancelAnimationFrame?.(first);if(second)view?.cancelAnimationFrame?.(second);resolve();};
        const timer=setTimeout(finish,100);
        first=requestFrame(()=>{second=requestFrame(finish);});
    });
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
    const lineBoxProbe = ownerDocument.createElement('div');
    const lineBoxProbeRun = ownerDocument.createElement('span');
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
    // Share the opt-in whitespace DOM with Viewer, without loading its runtime.
    Object.assign(lineBoxProbe.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        display: 'block',
        boxSizing: 'border-box',
        margin: '0px',
        border: '0px',
        padding: '0px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        wordBreak: 'normal',
        overflowWrap: 'normal',
        textWrap: 'nowrap',
        textOrientation: 'mixed',
        fontStyle: 'normal',
        fontFeatureSettings: 'normal',
        fontSynthesis: 'none',
        textRendering: 'optimizeLegibility',
        textDecoration: 'none',
        hyphens: 'manual',
    });
    lineBoxProbeRun.style.whiteSpace = 'inherit';
    applyFixedTextWhiteSpaceStyle(lineBoxProbe, FIXED_TEXT_WHITE_SPACE_MODE);
    lineBoxProbe.appendChild(lineBoxProbeRun);
    host.appendChild(lineBoxProbe);
    ownerDocument.body.appendChild(host);
    return { host, pageElement, lineBoxProbe, lineBoxProbeRun };
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

function captureViewerLineBox(element, line, sourceItems, context, surface) {
    const computed = context.ownerDocument.defaultView?.getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed?.lineHeight);
    const elementRect = element.getBoundingClientRect();
    const vertical = context.writingMode === 'vertical-rl';
    const width = vertical ? lineHeight : elementRect.width;
    const height = vertical ? elementRect.height : lineHeight;
    if (!computed || !Number.isFinite(lineHeight) || lineHeight <= 0) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_INVALID', 'Flow fragment has no measurable computed line height.', {
            blockId: line.runs[0].source.blockId,
            lineHeight: computed?.lineHeight,
        });
    }
    if (computed.tabSize !== String(FIXED_TEXT_TAB_SIZE)) {
        fail('FLOW_PUBLICATION_CAPTURE_TAB_SIZE_UNSUPPORTED', 'Flow TAB stops must match the fixed whitespace contract.', {
            blockId: line.runs[0].source.blockId,
            tabSize: computed.tabSize,
        });
    }
    if (computed.direction !== 'ltr') {
        fail('FLOW_PUBLICATION_CAPTURE_DIRECTION_UNSUPPORTED', 'preserve-v1 requires LTR inline progression.', {
            blockId: line.runs[0].source.blockId,
            direction: computed.direction,
        });
    }

    const probe = surface.lineBoxProbe;
    Object.assign(probe.style, {
        width: `${width}px`,
        height: `${height}px`,
        writingMode: context.writingMode,
        direction: computed.direction,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        // Keep the original unitless value, as the delivery style does. Its
        // computed pixel value above is only used for the physical box size.
        lineHeight: element.style.lineHeight || computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        // Author alignment is captured in x/y. Fixed delivery uses start so
        // hanging whitespace cannot realign an already-positioned line.
        textAlign: 'start',
    });
    probe.lang = context.language;
    const text = line.runs.map((run) => run.text).join('');
    const parts = renderFixedTextRunText(surface.lineBoxProbeRun, text, FIXED_TEXT_WHITE_SPACE_MODE);
    if (surface.lineBoxProbeRun.textContent !== text) {
        fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH', 'Viewer probe did not retain the exact source text.');
    }
    const probeRect = probe.getBoundingClientRect();
    if (sourceItems.every((item) => NEWLINE_PATTERN.test(item.text))) {
        // A blank visual line has no ink but still owns its LF source range.
        // Measure the same zero-width placeholder used by empty Flow paragraphs
        // to obtain this font's leading, then restore the original probe text.
        probe.style.textAlign = computed.textAlign;
        const [marker] = renderFixedTextRunText(surface.lineBoxProbeRun, '\u200b', FIXED_TEXT_WHITE_SPACE_MODE);
        const range = context.ownerDocument.createRange();
        range.setStart(marker.node, 0);
        range.setEnd(marker.node, 1);
        const markerRect = pageRelativeRect(range.getBoundingClientRect(), probeRect);
        range.detach?.();
        renderFixedTextRunText(surface.lineBoxProbeRun, text, FIXED_TEXT_WHITE_SPACE_MODE);
        probe.style.textAlign = 'start';
        const sourceRect = sourceItems.map(itemRect).find(Boolean);
        if (!sourceRect || (vertical ? markerRect.width <= 0 : markerRect.height <= 0)) {
            fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_UNMEASURED', 'Blank line has no measured font metrics.');
        }
        return normalizeCapturedGeometry({
            ...line,
            x: sourceRect.x - markerRect.x,
            y: sourceRect.y - markerRect.y,
            width: probeRect.width,
            height: probeRect.height,
        }, context.pageBox.contentBox, { blockId: line.runs[0].source.blockId });
    }
    const startGrapheme = line.runs[0].source.startGrapheme;
    const probeItems = segmentGraphemes(text, context.language).map((segment, localIndex) => {
        const part = parts.find((entry) => entry.start <= segment.index && entry.end >= segment.end);
        if (!part) fail('FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH', 'Viewer probe lost a semantic text range.');
        const range = context.ownerDocument.createRange();
        range.setStart(part.node, segment.index - part.start);
        range.setEnd(part.node, segment.end - part.start);
        const rects = Array.from(range.getClientRects(), (rect) => pageRelativeRect(rect, probeRect));
        range.detach?.();
        return {
            text: segment.segment,
            startGrapheme: startGrapheme + localIndex,
            endGrapheme: startGrapheme + localIndex + 1,
            rects,
        };
    });
    const geometryInput = {
        writingMode: context.writingMode,
        // Use the actual CSS box dimensions, including browser subpixel rounding.
        width: probeRect.width,
        height: probeRect.height,
        sourceItems,
        probeItems,
    };
    let geometry = resolveFlowPublicationLineBox(geometryInput);
    // Keep the fixed box inside the body. With start + pre/nowrap, reducing
    // only its inline extent cannot reflow/re-align any of the measured text.
    const contentBox = context.pageBox.contentBox;
    const availableInline = vertical
        ? contentBox.y + contentBox.height - geometry.y
        : contentBox.x + contentBox.width - geometry.x;
    const inlineSize = vertical ? geometry.height : geometry.width;
    if (availableInline < inlineSize) {
        geometry = resolveFlowPublicationLineBox({
            ...geometryInput,
            ...(vertical ? { height: availableInline } : { width: availableInline }),
        });
    }
    return normalizeCapturedGeometry(
        { ...line, ...geometry },
        context.pageBox.contentBox,
        { blockId: line.runs[0].source.blockId },
    );
}

// Capture exact parent/annotation glyphs using the same fixedText probe as delivery.
function captureAnnotationGlyph(node,start,end,text,context,surface,pageRect){
 const computed=context.ownerDocument.defaultView.getComputedStyle(node.parentElement);
 const probe=surface.lineBoxProbe,run=surface.lineBoxProbeRun;
 const fontSize=Number.parseFloat(computed.fontSize),vertical=context.writingMode==='vertical-rl';
 Object.assign(probe.style,{width:(vertical?fontSize*1.2:360)+'px',height:(vertical?640:fontSize*1.2)+'px',
  writingMode:context.writingMode,direction:'ltr',fontFamily:computed.fontFamily,fontSize:computed.fontSize,
  fontWeight:computed.fontWeight,lineHeight:'1.2',letterSpacing:computed.letterSpacing,textAlign:'start'});
 probe.lang=context.language;
 const parts=renderFixedTextRunText(run,text,FIXED_TEXT_WHITE_SPACE_MODE);
 const range=context.ownerDocument.createRange();range.setStart(node,start);range.setEnd(node,end);
 const source=pageRelativeRect(range.getBoundingClientRect(),pageRect);
 if(/^\s+$/u.test(text)){
  // Whitespace has no ink. Preserve its source text and measured anchor even
  // when the existing Viewer whitespace renderer uses a zero-size marker.
  range.detach?.();const box=context.pageBox.contentBox;
  const x=Math.min(Math.max(source.x,box.x),box.x+box.width-.001);
  const y=Math.min(Math.max(source.y,box.y),box.y+box.height-.001);
  const width=Math.max(.001,Math.min(source.width,box.x+box.width-x));
  const height=Math.max(.001,Math.min(source.height,box.y+box.height-y));
  return normalizeCapturedGeometry({x,y,width,height},box);
 }
 const part=parts[0];range.setStart(part.node,0);range.setEnd(part.node,part.node.length);
 const measured=pageRelativeRect(range.getBoundingClientRect(),probe.getBoundingClientRect());range.detach?.();
 if(!closeGeometry(source.width,measured.width) || !closeGeometry(source.height,measured.height)){
  fail('FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH','Annotation glyph cannot be reproduced as fixed text.',{source,measured,text,fontSize:computed.fontSize,parent:node.parentElement.tagName});
 }
 const x=source.x-measured.x,y=source.y-measured.y,content={x:0,y:0,width:context.pageBox.width,height:context.pageBox.height};
 const geometry=normalizeCapturedGeometry({x,y,width:vertical?probe.getBoundingClientRect().width:Math.min(360,content.x+content.width-x),
  height:vertical?Math.min(640,content.y+content.height-y):probe.getBoundingClientRect().height},content);
 geometry.width=Math.min(geometry.width,roundGeometry(content.x+content.width-geometry.x));
 geometry.height=Math.min(geometry.height,roundGeometry(content.y+content.height-geometry.y));
 return geometry;
}
function captureFragmentAnnotations(element,fragment,context,pageRect,surface){
 return getFlowPublicationAnnotationGlyphs(fragment).map(expected=>{
  let node;
  if(expected.type==='ruby'){
   const ruby=Array.from(element.querySelectorAll('ruby')).find(e=>e.dataset.annotationId===expected.annotationId);
   node=Array.from(ruby?.querySelectorAll('[data-reading-index]') || []).find(e=>Number(e.dataset.readingIndex)===expected.index)?.firstChild;
  }else{
   node=Array.from(element.querySelectorAll('[data-emphasis-id]')).find(e=>e.dataset.emphasisId===expected.annotationId
    && Number(e.dataset.baseOffset)+fragment.sourceRange.start===expected.index)?.firstChild;
  }
  if(!node || node.textContent!==expected.text)fail('FLOW_PUBLICATION_CAPTURE_ANNOTATION_MISMATCH','Rendered annotation does not match source.');
  return {...expected,...captureAnnotationGlyph(node,0,node.length,expected.text,context,surface,pageRect)};
 });
}

function captureFragmentLines(element, fragment, context, pageRect, surface) {
    const expectedCount = fragment.sourceRange.endGrapheme - fragment.sourceRange.startGrapheme;
    if (fragment.text === '') {
        if (expectedCount !== 0) {
            fail('FLOW_PUBLICATION_CAPTURE_SOURCE_MISMATCH', 'Empty fragment has a non-empty semantic range.', {
                blockId: fragment.blockId,
            });
        }
        return [captureEmptyFragmentLine(element, fragment, context, pageRect)];
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
        const position=getFlowFragmentDomPosition(element,fragment,segment.index);
        if(!position?.node || position.node.data.slice(position.offset,position.offset+segment.segment.length)!==segment.segment)fail('FLOW_PUBLICATION_CAPTURE_DOM_SOURCE_MISMATCH','Rendered body differs from source.');
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, position.offset+segment.segment.length);
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
    return lines.map((line) => {
        const range = line.runs[0].source;
        const start = range.startGrapheme - fragment.sourceRange.startGrapheme;
        const end = range.endGrapheme - fragment.sourceRange.startGrapheme;
        return captureViewerLineBox(element, line, items.slice(start, end), context, surface);
    });
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
    const decorations=Array.from(contentElement.querySelectorAll('[data-annotation-text]'));
    decorations.forEach(node=>{node.style.display='none';});
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
    decorations.forEach(node=>{node.style.display='';});
    const elements = Array.from(contentElement.querySelectorAll('.flow-dom-block'));
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
        surface,
    ));
    return {
        index: page.index,
        manualBreakBefore: cloneManualBreak(page.manualBreakBefore),
        lines,
        ...(page.anchoredObject ? {wrapLayout: structuredClone({object:page.anchoredObject,regions:page.wrapRegions})} : {}),
        ...(page.fragments.some(f=>f.annotations?.length)?{annotations:elements.flatMap((element,index)=>captureFragmentAnnotations(element,page.fragments[index],context,pageRect,surface))}:{}),
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
            const paginate = context.flowGroup.flow.layout.anchoredObjects?.length
                ? (_document, opts) => composeFlowWithAnchoredObjects(context.flowGroup, {...opts, ownerDocument:context.ownerDocument, typography:context.measurementTypography})
                : paginateFlowDocument;
            const pagination = paginate(context.document, {
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
