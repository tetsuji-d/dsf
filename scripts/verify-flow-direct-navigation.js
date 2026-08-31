import assert from 'node:assert/strict';
import {
    measureFlowDirectNavigationStops,
    resolveFlowDirectNavigation,
} from '../js/flow-direct-navigation.js';
import { segmentGraphemes } from '../js/grapheme.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const point = (blockId, offset, affinity = 'forward', blockType = 'paragraph') => ({
    sectionId: 'chapter-1', blockId, blockType, languageKey: 'ja',
    utf16Offset: offset, graphemeOffset: offset, affinity,
});
function stop(blockId, offset, cross, inline, options = {}) {
    const { pageIndex = 0, affinity = 'forward', blockType = 'paragraph', vertical = true, breadth = 22 } = options;
    return { pageIndex, sourcePoint: point(blockId, offset, affinity, blockType),
        rect: vertical ? rect(cross - breadth / 2, inline, breadth, 0) : rect(inline, cross - breadth / 2, 0, breadth) };
}
function fixture(vertical = true) {
    const offsetCross = vertical ? (index) => 320 - 26 * index : (index) => 30 + 30 * index;
    const extra = { vertical };
    return [
        ...[0, 1, 2].map((offset) => stop('body', offset, offsetCross(0), 20 + 18 * offset, extra)),
        stop('body', 3, offsetCross(0), 74, { ...extra, affinity: 'backward' }),
        ...[3, 4, 5, 6].map((offset) => stop('body', offset, offsetCross(1), 20 + 18 * (offset - 3), extra)),
        ...[0, 1, 2].map((offset) => stop('heading', offset, offsetCross(2), 20 + 27 * offset,
            { ...extra, blockType: 'heading', breadth: 30 })),
        ...[0, 1, 2, 3].map((offset) => stop('next-page', offset, offsetCross(0), 20 + 18 * offset,
            { ...extra, pageIndex: 1 })),
    ];
}

for (const vertical of [true, false]) {
    const stops = fixture(vertical);
    const writingMode = vertical ? 'vertical-rl' : 'horizontal-tb';
    const inlineNext = vertical ? 'ArrowDown' : 'ArrowRight';
    const inlinePrevious = vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextLine = vertical ? 'ArrowLeft' : 'ArrowDown';
    const previousLine = vertical ? 'ArrowRight' : 'ArrowUp';
    const navigate = (sourcePoint, key, options = {}) => resolveFlowDirectNavigation({
        stops, sourcePoint, key, writingMode, pageIndex: 0, ...options,
    });
    let result = navigate(point('body', 1), nextLine);
    assert.equal(result.sourcePoint.utf16Offset, 4);
    assert.equal(result.preferredInlinePosition, 38);
    result = navigate(result.sourcePoint, nextLine, { preferredInlinePosition: result.preferredInlinePosition });
    assert.equal(result.sourcePoint.blockId, 'heading');
    assert.equal(result.sourcePoint.utf16Offset, 1);
    assert.equal(result.preferredInlinePosition, 38, 'shorter lines/headings must not reset desired inline position');
    result = navigate(result.sourcePoint, previousLine, { preferredInlinePosition: result.preferredInlinePosition });
    assert.equal(result.sourcePoint.blockId, 'body');
    assert.equal(result.sourcePoint.utf16Offset, 4);
    assert.equal(result.preferredInlinePosition, 38);

    result = navigate(point('body', 2), inlineNext);
    assert.equal(result.sourcePoint.utf16Offset, 3);
    assert.equal(result.sourcePoint.affinity, 'forward', 'forward character motion chooses next-line visual side');
    assert.equal(result.preferredInlinePosition, null);
    result = navigate(point('body', 4), inlinePrevious);
    assert.equal(result.sourcePoint.utf16Offset, 3);
    assert.equal(result.sourcePoint.affinity, 'backward', 'backward character motion chooses previous-line visual side');
    result = navigate(point('body', 3), inlinePrevious);
    assert.equal(result.sourcePoint.utf16Offset, 2, 'same source offset at a soft wrap must not consume an extra key');
    result = navigate(point('body', 6), inlineNext);
    assert.equal(result.sourcePoint.blockId, 'heading');
    assert.equal(result.sourcePoint.utf16Offset, 0, 'arrows can cross semantic paragraph/heading boundaries');

    result = navigate(point('body', 4), 'Home');
    assert.equal(result.sourcePoint.utf16Offset, 3);
    assert.equal(result.sourcePoint.affinity, 'forward');
    result = navigate(point('body', 1), 'End');
    assert.equal(result.sourcePoint.utf16Offset, 3);
    assert.equal(result.sourcePoint.affinity, 'backward');
    result = navigate(point('body', 4), 'End');
    assert.equal(result.sourcePoint.utf16Offset, 6);

    result = navigate(point('heading', 2, 'forward', 'heading'), nextLine);
    assert.equal(result.pageIndex, 1);
    assert.equal(result.sourcePoint.blockId, 'next-page');
    assert.equal(result.sourcePoint.utf16Offset, 3);
    result = navigate(point('next-page', 0), previousLine, { pageIndex: 1 });
    assert.equal(result.pageIndex, 0);
    assert.equal(result.sourcePoint.blockId, 'heading');
    assert.equal(result.sourcePoint.utf16Offset, 0);
    result = navigate(point('body', 0), previousLine);
    assert.equal(result.edge, 'start');
    assert.equal(result.moved, false);
    result = navigate(point('next-page', 3), nextLine, { pageIndex: 1 });
    assert.equal(result.edge, 'end');
    assert.equal(result.moved, false);
    result = navigate(point('body', 0), inlinePrevious);
    assert.equal(result.edge, 'start');
    result = navigate(point('next-page', 3), inlineNext, { pageIndex: 1 });
    assert.equal(result.edge, 'end');
    assert.ok(Object.isFrozen(result));
}

// Shared source offsets at page boundaries retain the page/affinity of motion.
const paged = [
    stop('long', 0, 320, 20), stop('long', 1, 320, 38),
    stop('long', 2, 320, 56, { affinity: 'backward' }),
    stop('long', 2, 320, 20, { pageIndex: 1 }),
    stop('long', 3, 320, 38, { pageIndex: 1 }),
];
let result = resolveFlowDirectNavigation({ stops: paged, sourcePoint: point('long', 1), pageIndex: 0,
    writingMode: 'vertical-rl', key: 'ArrowDown' });
assert.equal(result.pageIndex, 1);
assert.equal(result.sourcePoint.utf16Offset, 2);
result = resolveFlowDirectNavigation({ stops: paged, sourcePoint: point('long', 3), pageIndex: 1,
    writingMode: 'vertical-rl', key: 'ArrowUp' });
assert.equal(result.pageIndex, 0);
assert.equal(result.sourcePoint.affinity, 'backward');

// Pinned editing DOM and a distant scrolling window must never bridge unmounted pages.
for (const vertical of [true, false]) {
    const writingMode = vertical ? 'vertical-rl' : 'horizontal-tb';
    const near = [stop('near', 0, 320, 20, { vertical }), stop('near', 1, 320, 38, { vertical })];
    const far = [stop('far', 0, 320, 20, { vertical, pageIndex: 90 }),
        stop('far', 1, 320, 38, { vertical, pageIndex: 90 })];
    for (const key of vertical ? ['ArrowDown', 'ArrowLeft'] : ['ArrowRight', 'ArrowDown']) {
        const pending = resolveFlowDirectNavigation({ stops: [...near, ...far], sourcePoint: point('near', 1),
            pageIndex: 0, key, writingMode });
        assert.equal(pending.moved, false);
        assert.equal(pending.edge, 'end');
        assert.equal(pending.pageIndex, 0);
    }
    for (const key of vertical ? ['ArrowUp', 'ArrowRight'] : ['ArrowLeft', 'ArrowUp']) {
        const pending = resolveFlowDirectNavigation({ stops: [...near, ...far], sourcePoint: point('far', 0),
            pageIndex: 90, key, writingMode });
        assert.equal(pending.moved, false);
        assert.equal(pending.edge, 'start');
        assert.equal(pending.pageIndex, 90);
    }
    const mountedNeighbor = [stop('neighbor', 0, 320, 20, { vertical, pageIndex: 1 }),
        stop('neighbor', 1, 320, 38, { vertical, pageIndex: 1 })];
    const resumed = resolveFlowDirectNavigation({ stops: [...near, ...mountedNeighbor, ...far], sourcePoint: point('near', 1),
        pageIndex: 0, key: vertical ? 'ArrowLeft' : 'ArrowDown', writingMode });
    assert.equal(resumed.moved, true);
    assert.equal(resumed.edge, null);
    assert.equal(resumed.pageIndex, 1, 'mounting the actual adjacent page must resume navigation');
}
assert.equal(resolveFlowDirectNavigation({}), null);
assert.equal(resolveFlowDirectNavigation({ stops: paged, sourcePoint: point('long', 1), key: 'a', writingMode: 'vertical-rl' }), null);
assert.equal(resolveFlowDirectNavigation({ stops: paged, sourcePoint: point('missing', 0), key: 'Home', writingMode: 'vertical-rl' }), null);
assert.deepEqual(measureFlowDirectNavigationStops([], { writingMode: 'vertical-rl' }), []);

// DOM adapter: real Range boundaries are injected as measured glyph rectangles.
// The adapter must preserve extended grapheme offsets and undo page CSS scale.
const text = 'あ👨‍👩‍👧‍👦か\u3099う';
const segments = segmentGraphemes(text, 'ja');
const node = { nodeType: 3, textContent: text };
const rangeReads = [];
const glyphRects = [rect(250, 110, 11, 9), rect(250, 119, 11, 9), rect(237, 110, 11, 9), rect(237, 119, 11, 9)];
const element = { firstChild: node, getBoundingClientRect: () => rect(237, 110, 26, 300) };
element.parentElement = { getBoundingClientRect: () => rect(110, 110, 160, 300) };
const ownerDocument = {
    defaultView: { getComputedStyle: () => ({ lineHeight: '26px', textAlign: 'start', direction: 'ltr' }) },
    createRange() {
        let start = 0;
        let end = 0;
        return {
            setStart(target, offset) { assert.equal(target, node); start = offset; },
            setEnd(target, offset) { assert.equal(target, node); end = offset; },
            collapse() { end = start; },
            getClientRects() {
                rangeReads.push([start, end]);
                const index = segments.findIndex((segment) => segment.index === start);
                const glyph = glyphRects[index >= 0 ? index : glyphRects.length - 1];
                return [start === end ? rect(glyph.left, glyph.top, glyph.width, 0) : glyph];
            },
        };
    },
};
const pageElement = {
    ownerDocument, offsetWidth: 360, offsetHeight: 640,
    getBoundingClientRect: () => rect(100, 100, 180, 320), querySelector: () => element,
};
const page = { fragments: [{ sectionId: 'chapter-1', blockId: 'unicode', blockType: 'paragraph', languageKey: 'ja', text,
    sourceRange: { start: 0, end: text.length, startGrapheme: 0, endGrapheme: segments.length } }] };
const measured = measureFlowDirectNavigationStops([{ pageElement, page, pageIndex: 5 }], { writingMode: 'vertical-rl' });
assert.equal(measured.length, 6, 'four graphemes produce five stops plus a second soft-wrap visual side');
assert.ok(Object.isFrozen(measured));
assert.equal(measured[0].pageIndex, 5);
assert.equal(measured[0].sourcePoint.blockType, 'paragraph');
assert.equal(measured[0].sourcePoint.languageKey, 'ja');
assert.equal(measured[0].sourcePoint.affinity, 'forward');
assert.equal(measured[measured.length - 1].sourcePoint.affinity, 'backward',
    'page fragment ends must keep backward affinity for existing source-page mapping');
assert.equal(measured[0].rect.left, 300);
assert.equal(measured[0].rect.width, 22);
assert.equal(measured[0].rect.top, 20);
assert.equal(rangeReads.filter(([start, end]) => start !== end).length, segments.length,
    'each glyph must be measured once, not by rescanning the paragraph at every caret');
result = resolveFlowDirectNavigation({ stops: measured, sourcePoint: measured[1].sourcePoint, pageIndex: 5,
    writingMode: 'vertical-rl', key: 'ArrowDown' });
assert.equal(result.sourcePoint.utf16Offset, segments[1].end);
assert.equal(result.sourcePoint.graphemeOffset, 2);
assert.equal(result.sourcePoint.affinity, 'forward');
result = resolveFlowDirectNavigation({ stops: measured, sourcePoint: measured[1].sourcePoint, pageIndex: 5,
    writingMode: 'vertical-rl', key: 'ArrowLeft' });
assert.equal(result.sourcePoint.graphemeOffset, 3);
assert.equal(result.preferredInlinePosition, 38);
node.textContent = 'stale DOM';
assert.deepEqual(measureFlowDirectNavigationStops([{ pageElement, page }], { writingMode: 'vertical-rl' }), []);
console.log('Flow direct visual navigation verification passed.');
