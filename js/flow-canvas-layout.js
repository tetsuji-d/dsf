/**
 * Runtime-only geometry for the editor's horizontally scrollable Flow canvas.
 * Logical pages stay canonical; viewport width never changes text composition.
 * The scroll container is always LTR. RTL reading order is represented by page
 * positions, avoiding browser-dependent RTL scrollLeft conventions.
 */
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from './page-geometry.js';

const PAGE_GAP = 24;
const SIDE_INSET = 24;
const VERTICAL_INSET = 24;
const LABEL_HEIGHT = 24;
const SCROLLBAR_ALLOWANCE = 16;
const MAX_OVERSCAN = 4;

function positive(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function pageIndexWithin(layout, value) {
    if (!layout || layout.pageCount < 1) return null;
    if (value === null || value === undefined || value === '') return null;
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= layout.pageCount) return null;
    return index;
}

function clampedScrollLeft(layout, value) {
    const scrollLeft = Number(value);
    return clamp(Number.isFinite(scrollLeft) ? scrollLeft : 0, 0, layout.maxScrollLeft);
}

/**
 * Fit one readable page to the viewport height, or its width on narrow screens.
 * Wider screens reveal more pages rather than shrinking the whole manuscript.
 * An optional explicit scale supports the editor's existing zoom controls.
 */
export function calculateFlowCanvasLayout(options = {}) {
    const labelHeight = Math.max(LABEL_HEIGHT, Number(options.labelHeight) || LABEL_HEIGHT);
    const viewportWidth = positive(options.viewportWidth, CANONICAL_PAGE_WIDTH);
    const viewportHeight = positive(options.viewportHeight, CANONICAL_PAGE_HEIGHT);
    const rawPageCount = Number(options.pageCount);
    const pageCount = Number.isSafeInteger(rawPageCount) && rawPageCount >= 0 ? rawPageCount : 0;
    const writingMode = options.writingMode === 'vertical-rl' ? 'vertical-rl' : 'horizontal-tb';
    const direction = options.direction === 'rtl' || options.direction === 'ltr'
        ? options.direction : writingMode === 'vertical-rl' ? 'rtl' : 'ltr';
    const availableHeight = Math.max(1, viewportHeight - VERTICAL_INSET * 2 - labelHeight - SCROLLBAR_ALLOWANCE);
    const availableWidth = Math.max(1, viewportWidth - SIDE_INSET * 2);
    const fittedScale = Math.min(availableHeight / CANONICAL_PAGE_HEIGHT, availableWidth / CANONICAL_PAGE_WIDTH);
    const scale = clamp(positive(options.scale, fittedScale), 0.1, 5);
    const pageWidth = CANONICAL_PAGE_WIDTH * scale;
    const pageHeight = CANONICAL_PAGE_HEIGHT * scale;
    const stride = pageWidth + PAGE_GAP;
    const joins = new Set(options.joinedPageIndices || []);
    const pageOffsets = [];
    let pagesWidth = 0;
    for (let index = 0; index < pageCount; index += 1) {
        if (index) pagesWidth += joins.has(index) ? 0 : PAGE_GAP;
        pageOffsets.push(pagesWidth);
        pagesWidth += pageWidth;
    }
    const trackWidth = Math.max(viewportWidth, pagesWidth + SIDE_INSET * 2);
    const trackHeight = Math.max(
        viewportHeight - SCROLLBAR_ALLOWANCE,
        VERTICAL_INSET * 2 + pageHeight + labelHeight,
    );
    const pageTop = Math.max(VERTICAL_INSET, (trackHeight - pageHeight - labelHeight) / 2);
    const visibleCount = pageCount === 0 ? 0
        : Math.min(pageCount, Math.max(1, Math.floor((availableWidth + PAGE_GAP) / stride)));
    return Object.freeze({
        viewportWidth, viewportHeight, pageCount, writingMode, direction, scale,
        pageWidth, pageHeight, gap: PAGE_GAP, stride, trackWidth, trackHeight,
        pageOffsets: Object.freeze(pageOffsets), pagesWidth,
        pageTop, startInset: (trackWidth - pagesWidth) / 2, sideInset: SIDE_INSET,
        labelHeight, visibleCount,
        maxScrollLeft: Math.max(0, trackWidth - viewportWidth),
    });
}

export function getFlowCanvasPagePosition(layout, pageIndex) {
    const index = pageIndexWithin(layout, pageIndex);
    if (index === null) return null;
    const offset = layout.direction === 'rtl'
        ? layout.pagesWidth - layout.pageWidth - layout.pageOffsets[index] : layout.pageOffsets[index];
    return Object.freeze({
        pageIndex: index,
        left: layout.startInset + offset,
        top: layout.pageTop,
        width: layout.pageWidth,
        height: layout.pageHeight,
    });
}

/**
 * Compute only visible slots plus a small overscan. A pinned edit page is kept
 * independently of the contiguous window so scrolling cannot evict its IME.
 */
export function calculateFlowCanvasWindow(layout, options = {}) {
    const scrollLeft = clampedScrollLeft(layout, options.scrollLeft);
    const rawOverscan = Number(options.overscan ?? 1);
    const overscan = clamp(Number.isFinite(rawOverscan) ? Math.floor(rawOverscan) : 1, 0, MAX_OVERSCAN);
    if (layout.pageCount === 0) {
        return Object.freeze({
            pageIndices: Object.freeze([]), visiblePageIndices: Object.freeze([]), slots: Object.freeze([]),
            scrollLeft, maxScrollLeft: layout.maxScrollLeft,
        });
    }
    const indexForPhysical = (physical) => layout.direction === 'rtl' ? layout.pageCount - 1 - physical : physical;
    const lowerBound = (predicate) => {
        let low = 0, high = layout.pageCount;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (predicate(getFlowCanvasPagePosition(layout, indexForPhysical(mid)))) high = mid;
            else low = mid + 1;
        }
        return low;
    };
    const firstPhysical = clamp(lowerBound(p => p.left + p.width > scrollLeft), 0, layout.pageCount - 1);
    const lastPhysical = clamp(lowerBound(p => p.left >= scrollLeft + layout.viewportWidth) - 1,
        firstPhysical, layout.pageCount - 1);
    const visiblePageIndices = [];
    for (let physical = firstPhysical; physical <= lastPhysical; physical += 1) {
        visiblePageIndices.push(indexForPhysical(physical));
    }
    const pageIndices = [];
    for (let physical = Math.max(0, firstPhysical - overscan);
        physical <= Math.min(layout.pageCount - 1, lastPhysical + overscan); physical += 1) {
        pageIndices.push(indexForPhysical(physical));
    }
    const pinned = pageIndexWithin(layout, options.pinnedPageIndex);
    if (pinned !== null && !pageIndices.includes(pinned)) pageIndices.push(pinned);
    pageIndices.sort((a, b) => a - b);
    visiblePageIndices.sort((a, b) => a - b);
    return Object.freeze({
        pageIndices: Object.freeze(pageIndices),
        visiblePageIndices: Object.freeze(visiblePageIndices),
        slots: Object.freeze(pageIndices.map((index) => getFlowCanvasPagePosition(layout, index))),
        scrollLeft, maxScrollLeft: layout.maxScrollLeft,
    });
}

/** Scroll to a semantic page index using physical, non-negative coordinates. */
export function getFlowCanvasPageScrollLeft(layout, pageIndex, options = {}) {
    const current = clampedScrollLeft(layout, options.scrollLeft);
    const position = getFlowCanvasPagePosition(layout, pageIndex);
    if (!position) return current;
    const startAligned = layout.direction === 'rtl'
        ? position.left + position.width + layout.sideInset - layout.viewportWidth
        : position.left - layout.sideInset;
    if (options.align === 'center') {
        return clampedScrollLeft(layout, position.left + position.width / 2 - layout.viewportWidth / 2);
    }
    if (options.align === 'nearest') {
        const visibleLeft = current + layout.sideInset;
        const visibleRight = current + layout.viewportWidth - layout.sideInset;
        const right = position.left + position.width;
        if (position.left >= visibleLeft && right <= visibleRight) return current;
        // A zoomed page can be wider than the viewport. Do not oscillate between
        // its edges when it already spans the viewport; preserve the edit view.
        if (position.left <= visibleLeft && right >= visibleRight) return current;
        return clampedScrollLeft(layout, position.left < visibleLeft
            ? position.left - layout.sideInset
            : right + layout.sideInset - layout.viewportWidth);
    }
    return clampedScrollLeft(layout, startAligned);
}
