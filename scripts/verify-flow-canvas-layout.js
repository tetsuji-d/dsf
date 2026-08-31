import assert from 'node:assert/strict';
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from '../js/page-geometry.js';
import {
    calculateFlowCanvasLayout,
    calculateFlowCanvasWindow,
    getFlowCanvasPagePosition,
    getFlowCanvasPageScrollLeft,
} from '../js/flow-canvas-layout.js';

const create = (options = {}) => calculateFlowCanvasLayout({
    viewportWidth: 1280, viewportHeight: 800, pageCount: 100,
    writingMode: 'vertical-rl', ...options,
});
const vertical = create();
assert.equal(vertical.direction, 'rtl');
assert.equal(vertical.pageWidth / vertical.scale, CANONICAL_PAGE_WIDTH);
assert.equal(vertical.pageHeight / vertical.scale, CANONICAL_PAGE_HEIGHT);
assert.equal(vertical.pageWidth / vertical.pageHeight, 9 / 16);
assert.equal(vertical.visibleCount, 2);
assert.ok(vertical.pageHeight + vertical.pageTop + vertical.labelHeight < vertical.viewportHeight);
assert.equal(vertical.trackWidth, vertical.pageCount * vertical.pageWidth
    + (vertical.pageCount - 1) * vertical.gap + vertical.sideInset * 2);

// Width reveals more full-size pages. Never fit a 100-page strip to its width.
const wider = create({ viewportWidth: 1800 });
assert.equal(wider.scale, vertical.scale);
assert.equal(wider.visibleCount, 4);
assert.equal(create({ pageCount: 1 }).scale, vertical.scale);
assert.equal(create({ pageCount: 3000 }).scale, vertical.scale);
const narrow = create({ viewportWidth: 360 });
assert.equal(narrow.visibleCount, 1);
assert.ok(narrow.pageWidth <= narrow.viewportWidth - narrow.sideInset * 2);
const short = create({ viewportHeight: 420 });
assert.ok(short.scale < vertical.scale);
assert.ok(short.pageHeight + short.pageTop + short.labelHeight < short.viewportHeight);

// Numeric physical LTR positions encode RTL order and avoid negative scrollLeft.
const first = getFlowCanvasPagePosition(vertical, 0);
const last = getFlowCanvasPagePosition(vertical, 99);
assert.equal(last.left, vertical.sideInset);
assert.equal(first.left + first.width, vertical.trackWidth - vertical.sideInset);
assert.ok(getFlowCanvasPagePosition(vertical, 1).left < first.left);
assert.equal(getFlowCanvasPageScrollLeft(vertical, 0), vertical.maxScrollLeft);
assert.equal(getFlowCanvasPageScrollLeft(vertical, 99), 0);
const horizontal = create({ writingMode: 'horizontal-tb' });
assert.equal(horizontal.direction, 'ltr');
assert.equal(getFlowCanvasPagePosition(horizontal, 0).left, horizontal.sideInset);
assert.ok(getFlowCanvasPagePosition(horizontal, 1).left > getFlowCanvasPagePosition(horizontal, 0).left);
assert.equal(getFlowCanvasPageScrollLeft(horizontal, 0), 0);
assert.equal(getFlowCanvasPageScrollLeft(horizontal, 99), horizontal.maxScrollLeft);
assert.equal(create({ writingMode: 'horizontal-tb', direction: 'rtl' }).direction, 'rtl');

// A short manuscript is centered without changing logical size or scale.
const single = create({ pageCount: 1 });
const singlePage = getFlowCanvasPagePosition(single, 0);
assert.equal(single.trackWidth, single.viewportWidth);
assert.equal(singlePage.left, (single.viewportWidth - single.pageWidth) / 2);
assert.equal(single.maxScrollLeft, 0);
assert.equal(getFlowCanvasPageScrollLeft(single, 0, { align: 'center' }), 0);
assert.deepEqual(calculateFlowCanvasWindow(single).pageIndices, [0]);

for (const layout of [vertical, horizontal, narrow, wider]) {
    const frozenBefore = JSON.stringify(layout);
    for (const pageIndex of [0, 1, 49, 50, 98, 99]) {
        const scrollLeft = getFlowCanvasPageScrollLeft(layout, pageIndex);
        const window = calculateFlowCanvasWindow(layout, { scrollLeft });
        assert.ok(window.pageIndices.includes(pageIndex), `page ${pageIndex} must be mounted`);
        assert.ok(window.visiblePageIndices.includes(pageIndex), `page ${pageIndex} must be visible`);
        assert.ok(window.pageIndices.length <= layout.visibleCount + 4,
            'only visible pages, partial edge pages, and one-page overscan are mounted');
        assert.ok(window.pageIndices.length < 10, '100-page manuscript must not mount all pages');
        assert.deepEqual(window.pageIndices, [...window.pageIndices].sort((a, b) => a - b));
        assert.equal(new Set(window.pageIndices).size, window.pageIndices.length);
        assert.equal(window.slots.length, window.pageIndices.length);
        for (const slot of window.slots) {
            assert.deepEqual(slot, getFlowCanvasPagePosition(layout, slot.pageIndex));
            assert.ok(slot.left >= 0);
            assert.ok(slot.left + slot.width <= layout.trackWidth);
        }
        assert.equal(getFlowCanvasPageScrollLeft(layout, pageIndex, { align: 'nearest', scrollLeft }), scrollLeft);
    }
    assert.equal(JSON.stringify(layout), frozenBefore, 'geometry helpers cannot mutate layout input');
}

// The live input proxy survives scrolling away, without rendering every page
// between the edit page and the new viewport window.
const firstWindow = calculateFlowCanvasWindow(vertical, { scrollLeft: 0 });
assert.ok(!firstWindow.pageIndices.includes(0));
const pinned = calculateFlowCanvasWindow(vertical, { scrollLeft: 0, pinnedPageIndex: 0 });
assert.ok(pinned.pageIndices.includes(0));
assert.equal(pinned.pageIndices.length, firstWindow.pageIndices.length + 1);
assert.ok(pinned.pageIndices.length < 10);
assert.deepEqual(calculateFlowCanvasWindow(vertical, { scrollLeft: 0, pinnedPageIndex: null }), firstWindow);
assert.deepEqual(calculateFlowCanvasWindow(vertical, { scrollLeft: 0, pinnedPageIndex: -1 }), firstWindow);
assert.equal(calculateFlowCanvasWindow(vertical, { scrollLeft: -100 }).scrollLeft, 0);
assert.equal(calculateFlowCanvasWindow(vertical, { scrollLeft: Infinity }).scrollLeft, 0);
assert.equal(calculateFlowCanvasWindow(vertical, { scrollLeft: vertical.trackWidth }).scrollLeft, vertical.maxScrollLeft);
assert.ok(calculateFlowCanvasWindow(vertical, { overscan: 100 }).pageIndices.length < 15,
    'unbounded overscan cannot accidentally mount a complete manuscript');

const position = getFlowCanvasPagePosition(horizontal, 50);
const centered = getFlowCanvasPageScrollLeft(horizontal, 50, { align: 'center' });
assert.equal(centered, position.left + position.width / 2 - horizontal.viewportWidth / 2);
assert.equal(getFlowCanvasPageScrollLeft(horizontal, 50, { align: 'nearest', scrollLeft: centered }), centered);
const fromLeft = getFlowCanvasPageScrollLeft(horizontal, 50, { align: 'nearest', scrollLeft: 0 });
assert.equal(fromLeft, position.left + position.width + horizontal.sideInset - horizontal.viewportWidth);
const fromRight = getFlowCanvasPageScrollLeft(horizontal, 50, {
    align: 'nearest', scrollLeft: horizontal.maxScrollLeft,
});
assert.equal(fromRight, position.left - horizontal.sideInset);

// Explicit zoom changes display geometry only, and nearest does not oscillate
// between edges when a page is wider than the viewport.
const zoom = create({ scale: 4, viewportWidth: 600 });
assert.equal(zoom.scale, 4);
assert.equal(zoom.visibleCount, 1);
assert.equal(zoom.pageWidth, CANONICAL_PAGE_WIDTH * 4);
assert.equal(zoom.pageHeight, CANONICAL_PAGE_HEIGHT * 4);
assert.ok(zoom.trackHeight > zoom.viewportHeight);
const zoomScroll = getFlowCanvasPageScrollLeft(zoom, 20, { align: 'center' });
assert.equal(getFlowCanvasPageScrollLeft(zoom, 20, { align: 'nearest', scrollLeft: zoomScroll }), zoomScroll);
assert.equal(create({ scale: 100 }).scale, 5);
assert.equal(create({ scale: 0.001 }).scale, 0.1);

const empty = create({ pageCount: 0 });
assert.equal(empty.visibleCount, 0);
assert.deepEqual(calculateFlowCanvasWindow(empty).pageIndices, []);
assert.equal(getFlowCanvasPagePosition(empty, 0), null);
assert.equal(getFlowCanvasPageScrollLeft(empty, 0), 0);
for (const invalid of [-1, 100, 0.5, null, undefined, NaN, '']) {
    assert.equal(getFlowCanvasPagePosition(vertical, invalid), null);
}
for (const badOptions of [{}, { viewportWidth: 0, viewportHeight: NaN, pageCount: -1 },
    { viewportWidth: Infinity, viewportHeight: -2, pageCount: Infinity }]) {
    const layout = calculateFlowCanvasLayout(badOptions);
    for (const key of ['scale', 'pageWidth', 'pageHeight', 'trackWidth', 'trackHeight', 'maxScrollLeft']) {
        assert.ok(Number.isFinite(layout[key]), `${key} must remain finite before measurement`);
    }
}

console.log('Flow canvas geometry, reading order, bounded window and nearest scroll verification passed.');
