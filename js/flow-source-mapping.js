/**
 * Runtime-only mapping between generated Flow DOM carets and semantic source.
 *
 * Project data remains authoritative. Generated page DOM only exposes the
 * pagination fragment identity needed to return a click to one grapheme-safe
 * source caret; it is never treated as editable or persisted content.
 */

import { segmentGraphemes } from './grapheme.js';

export const FLOW_SOURCE_MAPPING_VERSION = 1;
const LINE_BREAK_GRAPHEME = /^(?:\r\n|[\r\n\u2028\u2029])$/u;

export class FlowSourceMappingError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowSourceMappingError';
        this.code = code;
        this.context = context;
    }
}

function requireFragment(fragment) {
    if (!fragment || typeof fragment !== 'object') {
        throw new FlowSourceMappingError('FRAGMENT_REQUIRED', 'A Flow pagination fragment is required.');
    }
    const range = fragment.sourceRange;
    const start = Number(range?.start);
    const end = Number(range?.end);
    const startGrapheme = Number(range?.startGrapheme);
    const endGrapheme = Number(range?.endGrapheme);
    const text = String(fragment.text ?? '');
    if (
        !String(fragment.sectionId || '')
        || !String(fragment.blockId || '')
        || !String(fragment.languageKey || '')
        || !Number.isInteger(start)
        || !Number.isInteger(end)
        || !Number.isInteger(startGrapheme)
        || !Number.isInteger(endGrapheme)
        || start < 0
        || end < start
        || startGrapheme < 0
        || endGrapheme < startGrapheme
        || end - start !== text.length
    ) {
        throw new FlowSourceMappingError(
            'FRAGMENT_SOURCE_INVALID',
            'Flow fragment source identity and ranges must be complete and exact.',
            { fragment },
        );
    }
    return { fragment, range, text, start, end, startGrapheme, endGrapheme };
}

function requireDomOffset(value, maximum) {
    const offset = Number(value);
    if (!Number.isInteger(offset) || offset < 0 || offset > maximum) {
        throw new FlowSourceMappingError(
            'DOM_OFFSET_INVALID',
            'DOM caret offset is outside the rendered fragment.',
            { offset: value, maximum },
        );
    }
    return offset;
}

function getGraphemeBoundaries(text, languageKey) {
    const segments = segmentGraphemes(text, languageKey);
    return {
        segments,
        offsets: [0, ...segments.map((segment) => segment.end)],
    };
}

function snapDomOffsetToBoundary(text, domOffset, languageKey, affinity = 'nearest') {
    const { segments, offsets } = getGraphemeBoundaries(text, languageKey);
    const exactIndex = offsets.indexOf(domOffset);
    if (exactIndex >= 0) {
        return { domOffset, localGraphemeOffset: exactIndex, segments };
    }

    let nextIndex = offsets.findIndex((offset) => offset > domOffset);
    if (nextIndex < 0) nextIndex = offsets.length - 1;
    const previousIndex = Math.max(0, nextIndex - 1);
    let selectedIndex;
    if (affinity === 'backward') selectedIndex = previousIndex;
    else if (affinity === 'forward') selectedIndex = nextIndex;
    else {
        const previousDistance = domOffset - offsets[previousIndex];
        const nextDistance = offsets[nextIndex] - domOffset;
        selectedIndex = previousDistance < nextDistance ? previousIndex : nextIndex;
    }
    return {
        domOffset: offsets[selectedIndex],
        localGraphemeOffset: selectedIndex,
        segments,
    };
}

/** Convert a UTF-16 textarea offset to a grapheme-safe offset in the same text. */
export function mapFlowTextUtf16OffsetToGrapheme(text, utf16Offset, languageKey, affinity = 'nearest') {
    const value = String(text ?? '');
    const offset = requireDomOffset(utf16Offset, value.length);
    const snapped = snapDomOffsetToBoundary(value, offset, String(languageKey || 'und'), affinity);
    return Object.freeze({
        utf16Offset: snapped.domOffset,
        graphemeOffset: snapped.localGraphemeOffset,
    });
}

function assertFragmentGraphemeCount(normalized, segments) {
    const expected = normalized.endGrapheme - normalized.startGrapheme;
    if (segments.length !== expected) {
        throw new FlowSourceMappingError(
            'FRAGMENT_GRAPHEME_RANGE_INVALID',
            'Rendered text grapheme count does not match its semantic source range.',
            { fragment: normalized.fragment, expected, actual: segments.length },
        );
    }
}

/** Convert one rendered-fragment DOM caret into an exact semantic source point. */
export function mapFlowFragmentDomOffsetToSource(fragment, domOffset, options = {}) {
    const normalized = requireFragment(fragment);
    const offset = requireDomOffset(domOffset, normalized.text.length);
    const snapped = snapDomOffsetToBoundary(
        normalized.text,
        offset,
        normalized.fragment.languageKey,
        options.affinity,
    );
    assertFragmentGraphemeCount(normalized, snapped.segments);
    const graphemeOffset = normalized.startGrapheme + snapped.localGraphemeOffset;
    return Object.freeze({
        sectionId: normalized.fragment.sectionId,
        blockId: normalized.fragment.blockId,
        blockType: normalized.fragment.blockType,
        languageKey: normalized.fragment.languageKey,
        graphemeOffset,
        utf16Offset: normalized.start + snapped.domOffset,
        affinity: String(options.affinity || 'nearest'),
    });
}

/** Convert a semantic source point back into a caret inside one fragment. */
export function mapFlowSourcePointToFragmentDomOffset(fragment, sourcePoint) {
    const normalized = requireFragment(fragment);
    if (
        String(sourcePoint?.sectionId || '') !== normalized.fragment.sectionId
        || String(sourcePoint?.blockId || '') !== normalized.fragment.blockId
        || String(sourcePoint?.languageKey || '') !== normalized.fragment.languageKey
    ) return null;

    const graphemeOffset = Number(sourcePoint?.graphemeOffset);
    if (
        !Number.isInteger(graphemeOffset)
        || graphemeOffset < normalized.startGrapheme
        || graphemeOffset > normalized.endGrapheme
    ) return null;

    const { segments } = getGraphemeBoundaries(normalized.text, normalized.fragment.languageKey);
    assertFragmentGraphemeCount(normalized, segments);
    const localGraphemeOffset = graphemeOffset - normalized.startGrapheme;
    if (localGraphemeOffset > segments.length) {
        throw new FlowSourceMappingError(
            'FRAGMENT_GRAPHEME_RANGE_INVALID',
            'Semantic grapheme range does not match rendered fragment text.',
            { fragment },
        );
    }
    const domOffset = localGraphemeOffset === segments.length
        ? normalized.text.length
        : segments[localGraphemeOffset].index;
    const utf16Offset = normalized.start + domOffset;
    if (
        sourcePoint?.utf16Offset !== undefined
        && Number(sourcePoint.utf16Offset) !== utf16Offset
    ) {
        throw new FlowSourceMappingError(
            'SOURCE_OFFSET_MISMATCH',
            'Semantic grapheme and UTF-16 offsets do not identify the same caret.',
            { sourcePoint, expectedUtf16Offset: utf16Offset },
        );
    }
    return Object.freeze({ domOffset, utf16Offset, graphemeOffset });
}

function getPageFragments(page) {
    return Array.isArray(page?.fragments) ? page.fragments : [];
}

/** Find which generated page/fragment contains a semantic source point. */
export function findFlowSourcePointInPages(pages, sourcePoint) {
    const candidates = [];
    for (let pageIndex = 0; pageIndex < (Array.isArray(pages) ? pages.length : 0); pageIndex += 1) {
        const page = pages[pageIndex]?.page || pages[pageIndex];
        const fragments = getPageFragments(page);
        for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex += 1) {
            const position = mapFlowSourcePointToFragmentDomOffset(fragments[fragmentIndex], sourcePoint);
            if (position) candidates.push({ pageIndex, fragmentIndex, position });
        }
    }
    if (!candidates.length) return null;
    const affinity = String(sourcePoint?.affinity || 'nearest');
    const selected = affinity === 'backward' ? candidates[0] : candidates[candidates.length - 1];
    return Object.freeze({
        pageIndex: selected.pageIndex,
        fragmentIndex: selected.fragmentIndex,
        ...selected.position,
    });
}

function findFragmentElement(pageElement, node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const fragmentElement = element?.closest?.('.flow-dom-block[data-flow-fragment-index]');
    return fragmentElement && pageElement?.contains?.(fragmentElement) ? fragmentElement : null;
}

function getFragmentTextNode(fragmentElement, fragment) {
    const textNode = fragmentElement?.firstChild;
    if (!textNode || textNode.nodeType !== 3) {
        throw new FlowSourceMappingError(
            'FRAGMENT_DOM_INVALID',
            'Generated Flow fragment must contain one direct text node.',
        );
    }
    const expected = fragment.text === '' ? '\u200B' : fragment.text;
    if (textNode.data !== expected) {
        throw new FlowSourceMappingError(
            'FRAGMENT_DOM_SOURCE_MISMATCH',
            'Generated Flow DOM text no longer matches pagination source.',
            { expected, actual: textNode.data },
        );
    }
    return textNode;
}

/** Map an existing DOM Selection-compatible position back to semantic source. */
export function mapFlowDomPositionToSource(pageElement, page, node, offset, options = {}) {
    const fragmentElement = findFragmentElement(pageElement, node);
    if (!fragmentElement) return null;
    const fragmentIndex = Number(fragmentElement.dataset.flowFragmentIndex);
    const fragment = getPageFragments(page)[fragmentIndex];
    if (!fragment) {
        throw new FlowSourceMappingError(
            'FRAGMENT_DOM_INDEX_INVALID',
            'Generated Flow DOM points to an unknown pagination fragment.',
            { fragmentIndex },
        );
    }
    const textNode = getFragmentTextNode(fragmentElement, fragment);
    let domOffset;
    if (fragment.text === '') domOffset = 0;
    else if (node === textNode) domOffset = Number(offset);
    else if (node === fragmentElement) domOffset = Number(offset) <= 0 ? 0 : fragment.text.length;
    else return null;
    return mapFlowFragmentDomOffsetToSource(fragment, domOffset, options);
}

/** Use the browser caret hit-test to map a page click to semantic source. */
export function mapFlowClientPointToSource(pageElement, page, clientX, clientY, options = {}) {
    const ownerDocument = pageElement?.ownerDocument;
    if (!ownerDocument) return null;
    let node = null;
    let offset = 0;
    if (typeof ownerDocument.caretPositionFromPoint === 'function') {
        const position = ownerDocument.caretPositionFromPoint(clientX, clientY);
        node = position?.offsetNode || null;
        offset = position?.offset || 0;
    } else if (typeof ownerDocument.caretRangeFromPoint === 'function') {
        const range = ownerDocument.caretRangeFromPoint(clientX, clientY);
        node = range?.startContainer || null;
        offset = range?.startOffset || 0;
    }
    if (!node || !pageElement.contains(node)) return null;
    const sourcePoint = mapFlowDomPositionToSource(pageElement, page, node, offset, options);
    const writingMode = options.writingMode;
    if (
        !sourcePoint
        || !writingMode
        || options.affinity === 'forward'
        || options.affinity === 'backward'
    ) return sourcePoint;

    const backwardPoint = Object.freeze({ ...sourcePoint, affinity: 'backward' });
    const forwardPoint = Object.freeze({ ...sourcePoint, affinity: 'forward' });
    const affinity = resolveFlowCaretAffinityFromClientPoint({
        clientX,
        clientY,
        backwardRect: getFlowSourcePointClientRect(
            pageElement,
            page,
            backwardPoint,
            { writingMode },
        ),
        forwardRect: getFlowSourcePointClientRect(
            pageElement,
            page,
            forwardPoint,
            { writingMode },
        ),
    });
    return Object.freeze({ ...sourcePoint, affinity });
}

/** Resolve a semantic source point to a DOM Selection-compatible position. */
export function mapFlowSourcePointToDomPosition(pageElement, page, sourcePoint) {
    const fragments = getPageFragments(page);
    const candidates = [];
    fragments.forEach((fragment, fragmentIndex) => {
        const position = mapFlowSourcePointToFragmentDomOffset(fragment, sourcePoint);
        if (position) candidates.push({ fragmentIndex, position });
    });
    if (!candidates.length) return null;
    const selected = String(sourcePoint?.affinity || '') === 'backward'
        ? candidates[0]
        : candidates[candidates.length - 1];
    const fragmentElement = pageElement?.querySelector?.(
        `.flow-dom-block[data-flow-fragment-index="${selected.fragmentIndex}"]`,
    );
    if (!fragmentElement) return null;
    const textNode = getFragmentTextNode(fragmentElement, fragments[selected.fragmentIndex]);
    return Object.freeze({
        node: textNode,
        offset: fragments[selected.fragmentIndex].text === '' ? 0 : selected.position.domOffset,
        fragmentElement,
        fragmentIndex: selected.fragmentIndex,
    });
}

function snapshotRect(rect, overrides = {}) {
    return Object.freeze({
        left: Number(rect?.left || 0),
        top: Number(rect?.top || 0),
        right: Number(rect?.right || 0),
        bottom: Number(rect?.bottom || 0),
        width: Number(rect?.width || 0),
        height: Number(rect?.height || 0),
        ...overrides,
    });
}

function requireCaretWritingMode(value) {
    const writingMode = String(value || 'horizontal-tb');
    if (writingMode !== 'horizontal-tb' && writingMode !== 'vertical-rl') {
        throw new FlowSourceMappingError(
            'CARET_WRITING_MODE_INVALID',
            'Flow caret geometry requires horizontal-tb or vertical-rl.',
            { writingMode },
        );
    }
    return writingMode;
}

export function isFlowCaretMeasurementRect(rect, writingMode) {
    const mode = requireCaretWritingMode(writingMode);
    return mode === 'vertical-rl'
        ? Number(rect?.width) > 0
        : Number(rect?.height) > 0;
}

function resolveFlowVerticalEmptyLineTop(fragmentRect, textAlign, direction) {
    const alignment = String(textAlign || 'start').toLowerCase();
    const isRtl = String(direction || 'ltr').toLowerCase() === 'rtl';
    if (alignment.includes('center')) {
        return fragmentRect.top + (fragmentRect.height / 2);
    }
    if (alignment === 'end' || alignment === 'right') {
        return isRtl ? fragmentRect.top : fragmentRect.bottom;
    }
    if (alignment === 'start') {
        return isRtl ? fragmentRect.bottom : fragmentRect.top;
    }
    return fragmentRect.top;
}

/** Move the caret from a vertical line-break glyph to the next visible column start. */
export function advanceFlowVerticalLineBreakClientRect(options = {}) {
    const lineBreakRect = options.lineBreakRect ? snapshotRect(options.lineBreakRect) : null;
    const fragmentRect = options.fragmentRect ? snapshotRect(options.fragmentRect) : null;
    const contentRect = options.contentRect ? snapshotRect(options.contentRect) : null;
    const lineAdvance = Number(options.lineAdvance);
    if (
        !lineBreakRect
        || !fragmentRect
        || lineBreakRect.width <= 0
        || !Number.isFinite(lineAdvance)
        || lineAdvance <= 0
    ) return null;
    let left = lineBreakRect.left - lineAdvance;
    if (contentRect?.width > 0) {
        const maxLeft = Math.max(contentRect.left, contentRect.right - lineBreakRect.width);
        left = Math.min(Math.max(left, contentRect.left), maxLeft);
    }
    const top = resolveFlowVerticalEmptyLineTop(
        fragmentRect,
        options.textAlign,
        options.direction,
    );
    return snapshotRect({
        left,
        top,
        right: left + lineBreakRect.width,
        bottom: top,
        width: lineBreakRect.width,
        height: 0,
    });
}

function normalizeCaretRect(rect, writingMode, edge, basis) {
    if (!rect) return null;
    const source = snapshotRect(rect);
    if (writingMode === 'vertical-rl') {
        if (source.width <= 0) return null;
        const top = edge === 'after' ? source.bottom : source.top;
        return snapshotRect({
            left: source.left,
            top,
            right: source.right,
            bottom: top,
            width: source.width,
            height: 0,
        }, {
            writingMode,
            caretOrientation: 'horizontal',
            basis,
        });
    }
    if (source.height <= 0) return null;
    const left = edge === 'after' ? source.right : source.left;
    return snapshotRect({
        left,
        top: source.top,
        right: left,
        bottom: source.bottom,
        width: 0,
        height: source.height,
    }, {
        writingMode,
        caretOrientation: 'vertical',
        basis,
    });
}

/**
 * Resolve one visual caret from browser Range measurements.
 *
 * The helper is pure so vertical/horizontal edge semantics can be verified
 * without treating generated page DOM as editable source.
 */
export function resolveFlowCaretClientGeometry(options = {}) {
    const writingMode = requireCaretWritingMode(options.writingMode);
    const affinity = String(options.affinity || 'nearest');
    const preferPrevious = affinity === 'backward';
    const adjacent = preferPrevious
        ? [
            [options.previousRect, 'after', 'previous'],
            [options.nextRect, 'before', 'next'],
        ]
        : [
            [options.nextRect, 'before', 'next'],
            [options.previousRect, 'after', 'previous'],
        ];
    const resolveAdjacent = () => {
        for (const [rect, edge, basis] of adjacent) {
            const resolved = normalizeCaretRect(rect, writingMode, edge, basis);
            if (resolved) return resolved;
        }
        return null;
    };

    if (affinity === 'forward' || affinity === 'backward') {
        const resolved = resolveAdjacent();
        if (resolved) return resolved;
    }

    const collapsedRect = options.collapsedRect ? snapshotRect(options.collapsedRect) : null;
    if (collapsedRect && isFlowCaretMeasurementRect(collapsedRect, writingMode)) {
        const collapsed = normalizeCaretRect(collapsedRect, writingMode, 'before', 'collapsed');
        if (collapsed) return collapsed;
    }

    const resolved = resolveAdjacent();
    if (resolved) return resolved;
    return normalizeCaretRect(options.fragmentRect, writingMode, 'before', 'fragment');
}

function squaredDistanceToRect(rect, clientX, clientY) {
    if (!rect) return Number.POSITIVE_INFINITY;
    const left = Math.min(Number(rect.left), Number(rect.right));
    const right = Math.max(Number(rect.left), Number(rect.right));
    const top = Math.min(Number(rect.top), Number(rect.bottom));
    const bottom = Math.max(Number(rect.top), Number(rect.bottom));
    const dx = clientX < left ? left - clientX : clientX > right ? clientX - right : 0;
    const dy = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0;
    return (dx * dx) + (dy * dy);
}

/** Preserve which visual side of a wrapped source offset the user clicked. */
export function resolveFlowCaretAffinityFromClientPoint(options = {}) {
    const clientX = Number(options.clientX);
    const clientY = Number(options.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        throw new FlowSourceMappingError(
            'CARET_CLIENT_POINT_INVALID',
            'Flow caret affinity requires a finite client point.',
            { clientX: options.clientX, clientY: options.clientY },
        );
    }
    const backwardDistance = squaredDistanceToRect(options.backwardRect, clientX, clientY);
    const forwardDistance = squaredDistanceToRect(options.forwardRect, clientX, clientY);
    if (!Number.isFinite(backwardDistance) && !Number.isFinite(forwardDistance)) return 'nearest';
    if (backwardDistance === forwardDistance) return 'nearest';
    return backwardDistance < forwardDistance ? 'backward' : 'forward';
}

function firstRangeRect(range, predicate = (rect) => rect.width > 0 || rect.height > 0) {
    const clientRect = [...(range?.getClientRects?.() || [])].find(predicate);
    if (clientRect) return snapshotRect(clientRect);
    const boundingRect = range?.getBoundingClientRect?.();
    return boundingRect && predicate(boundingRect) ? snapshotRect(boundingRect) : null;
}

/** Measure a writing-mode-aware visual caret without mutating generated page DOM. */
export function getFlowSourcePointClientRect(pageElement, page, sourcePoint, options = {}) {
    const position = mapFlowSourcePointToDomPosition(pageElement, page, sourcePoint);
    const ownerDocument = pageElement?.ownerDocument;
    if (!position || !ownerDocument?.createRange) return null;
    const writingMode = requireCaretWritingMode(options.writingMode);
    const range = ownerDocument.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    const collapsedRect = firstRangeRect(
        range,
        (rect) => isFlowCaretMeasurementRect(rect, writingMode),
    );

    const fragment = getPageFragments(page)[position.fragmentIndex];
    const text = String(fragment?.text || '');
    const segments = segmentGraphemes(text, fragment?.languageKey || 'und');
    const next = segments.find((segment) => segment.index >= position.offset);
    const previous = [...segments].reverse().find((segment) => segment.end <= position.offset);
    let nextRect = null;
    let previousRect = null;
    if (next) {
        range.setStart(position.node, next.index);
        range.setEnd(position.node, next.end);
        nextRect = firstRangeRect(
            range,
            (rect) => isFlowCaretMeasurementRect(rect, writingMode),
        );
    }
    if (previous) {
        range.setStart(position.node, previous.index);
        range.setEnd(position.node, previous.end);
        previousRect = firstRangeRect(
            range,
            (rect) => isFlowCaretMeasurementRect(rect, writingMode),
        );
        if (
            writingMode === 'vertical-rl'
            && LINE_BREAK_GRAPHEME.test(previous.segment)
            && previousRect
        ) {
            const pageRect = pageElement.getBoundingClientRect?.();
            const pageScaleX = Number(pageElement.offsetWidth) > 0 && Number(pageRect?.width) > 0
                ? Number(pageRect.width) / Number(pageElement.offsetWidth)
                : 1;
            const view = ownerDocument.defaultView;
            const fragmentStyle = view?.getComputedStyle?.(position.fragmentElement);
            const lineHeight = Number.parseFloat(fragmentStyle?.lineHeight || '');
            const advanced = advanceFlowVerticalLineBreakClientRect({
                lineBreakRect: previousRect,
                fragmentRect: position.fragmentElement?.getBoundingClientRect?.(),
                contentRect: position.fragmentElement?.parentElement?.getBoundingClientRect?.(),
                lineAdvance: lineHeight * pageScaleX,
                textAlign: fragmentStyle?.textAlign,
                direction: fragmentStyle?.direction,
            });
            if (advanced) previousRect = advanced;
        }
    }
    return resolveFlowCaretClientGeometry({
        writingMode,
        affinity: sourcePoint?.affinity,
        collapsedRect,
        nextRect,
        previousRect,
        fragmentRect: position.fragmentElement?.getBoundingClientRect?.(),
    });
}

/** Measure visible selection rectangles when both endpoints exist on one page. */
export function getFlowSourceRangeClientRects(pageElement, page, startPoint, endPoint) {
    const start = mapFlowSourcePointToDomPosition(pageElement, page, startPoint);
    const end = mapFlowSourcePointToDomPosition(pageElement, page, endPoint);
    const ownerDocument = pageElement?.ownerDocument;
    if (!start || !end || !ownerDocument?.createRange) return [];
    const range = ownerDocument.createRange();
    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
    } catch (_) {
        return [];
    }
    return Object.freeze(
        [...range.getClientRects()]
            .filter((rect) => rect.width > 0 && rect.height > 0)
            .map((rect) => snapshotRect(rect)),
    );
}
