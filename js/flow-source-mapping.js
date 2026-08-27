/**
 * Runtime-only mapping between generated Flow DOM carets and semantic source.
 *
 * Project data remains authoritative. Generated page DOM only exposes the
 * pagination fragment identity needed to return a click to one grapheme-safe
 * source caret; it is never treated as editable or persisted content.
 */

import { segmentGraphemes } from './grapheme.js';

export const FLOW_SOURCE_MAPPING_VERSION = 1;

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
    return mapFlowDomPositionToSource(pageElement, page, node, offset, options);
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
