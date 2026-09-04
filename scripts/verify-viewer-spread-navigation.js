import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    getViewerFallbackSpreadPageIndices,
    getViewerPageNavigationTarget,
} from '../js/viewer-navigation.js';

const target = (currentIndex, delta, options = {}) => getViewerPageNavigationTarget({
    currentIndex,
    totalPages: options.totalPages ?? 8,
    delta,
    spreadMode: options.spreadMode ?? true,
    pageDirection: options.pageDirection ?? 'ltr',
});

function collectForwardSequence(start, options = {}) {
    const result = [start];
    let current = start;
    for (let guard = 0; guard < 20; guard += 1) {
        const next = target(current, 1, options);
        if (next === current) return result;
        result.push(next);
        current = next;
    }
    throw new Error('Viewer spread navigation did not settle at the final unit.');
}

function collectBackwardSequence(start, options = {}) {
    const result = [start];
    let current = start;
    for (let guard = 0; guard < 20; guard += 1) {
        const previous = target(current, -1, options);
        if (previous === current) return result;
        result.push(previous);
        current = previous;
    }
    throw new Error('Viewer spread navigation did not settle at the first unit.');
}

function assertNonOverlappingPages(anchors, totalPages, pageDirection) {
    const visited = [];
    for (const currentIndex of anchors) {
        visited.push(...getViewerFallbackSpreadPageIndices({ currentIndex, totalPages, pageDirection }));
    }
    assert.equal(new Set(visited).size, visited.length, `${pageDirection} spread units must not repeat pages`);
    assert.deepEqual([...visited].sort((a, b) => a - b), Array.from({ length: totalPages }, (_, index) => index));
}

const ltrEven = collectForwardSequence(0, { totalPages: 8, pageDirection: 'ltr' });
const ltrOdd = collectForwardSequence(0, { totalPages: 7, pageDirection: 'ltr' });
const rtlEven = collectForwardSequence(0, { totalPages: 8, pageDirection: 'rtl' });
const rtlOdd = collectForwardSequence(0, { totalPages: 7, pageDirection: 'rtl' });

assert.deepEqual(ltrEven, [0, 1, 3, 5, 7]);
assert.deepEqual(ltrOdd, [0, 1, 3, 5]);
assert.deepEqual(rtlEven, [0, 2, 4, 6, 7]);
assert.deepEqual(rtlOdd, [0, 2, 4, 6]);
assert.deepEqual(collectBackwardSequence(7, { totalPages: 8, pageDirection: 'ltr' }), [...ltrEven].reverse());
assert.deepEqual(collectBackwardSequence(5, { totalPages: 7, pageDirection: 'ltr' }), [...ltrOdd].reverse());
assert.deepEqual(collectBackwardSequence(7, { totalPages: 8, pageDirection: 'rtl' }), [...rtlEven].reverse());
assert.deepEqual(collectBackwardSequence(6, { totalPages: 7, pageDirection: 'rtl' }), [...rtlOdd].reverse());
assertNonOverlappingPages(ltrEven, 8, 'ltr');
assertNonOverlappingPages(ltrOdd, 7, 'ltr');
assertNonOverlappingPages(rtlEven, 8, 'rtl');
assertNonOverlappingPages(rtlOdd, 7, 'rtl');

assert.equal(target(7, 1, { totalPages: 8, pageDirection: 'ltr' }), 7,
    'the final visible LTR spread must not reopen its terminal page alone');
assert.equal(target(7, -1, { totalPages: 8, pageDirection: 'ltr' }), 5,
    'an even-length LTR terminal page returns to the previous complete spread');
assert.equal(target(7, 1, { totalPages: 8, pageDirection: 'rtl' }), 7,
    'the final visible RTL spread must remain at its terminal unit');
assert.equal(target(7, -1, { totalPages: 8, pageDirection: 'rtl' }), 6,
    'an even-length RTL terminal page returns to the previous complete spread');
assert.equal(target(0, -1, { totalPages: 8, pageDirection: 'ltr' }), 0);
assert.equal(target(0, -1, { totalPages: 8, pageDirection: 'rtl' }), 0);

assert.equal(target(2, 1, { totalPages: 8, pageDirection: 'ltr' }), 3,
    'a direct jump inside an LTR spread advances to the next unit');
assert.equal(target(2, -1, { totalPages: 8, pageDirection: 'ltr' }), 0,
    'a direct jump inside an LTR spread returns to the previous unit');
assert.equal(target(1, 1, { totalPages: 8, pageDirection: 'rtl' }), 4,
    'a direct jump inside an RTL spread advances to the next unit');
assert.equal(target(1, -1, { totalPages: 8, pageDirection: 'rtl' }), 0,
    'a direct jump inside an RTL spread returns to the cover');

assert.deepEqual(getViewerFallbackSpreadPageIndices({ currentIndex: 0, totalPages: 8, pageDirection: 'ltr' }), [0]);
assert.deepEqual(getViewerFallbackSpreadPageIndices({ currentIndex: 1, totalPages: 8, pageDirection: 'ltr' }), [1, 2]);
assert.deepEqual(getViewerFallbackSpreadPageIndices({ currentIndex: 0, totalPages: 8, pageDirection: 'rtl' }), [0]);
assert.deepEqual(getViewerFallbackSpreadPageIndices({ currentIndex: 1, totalPages: 8, pageDirection: 'rtl' }), [2, 1]);
assert.deepEqual(getViewerFallbackSpreadPageIndices({ currentIndex: 7, totalPages: 8, pageDirection: 'rtl' }), [7]);
assert.deepEqual(
    getViewerFallbackSpreadPageIndices({ currentIndex: 1, totalPages: 8, pageDirection: 'ltr' }),
    getViewerFallbackSpreadPageIndices({ currentIndex: 2, totalPages: 8, pageDirection: 'ltr' }),
    'both LTR members of a direct-jump spread must render the same unit',
);
assert.deepEqual(
    getViewerFallbackSpreadPageIndices({ currentIndex: 1, totalPages: 8, pageDirection: 'rtl' }),
    getViewerFallbackSpreadPageIndices({ currentIndex: 2, totalPages: 8, pageDirection: 'rtl' }),
    'both RTL members of a direct-jump spread must render the same unit',
);

assert.equal(target(2, 1, { spreadMode: false }), 3, 'single-page mode remains one page at a time');
assert.equal(target(2, -1, { spreadMode: false }), 1, 'single-page reverse navigation remains unchanged');
assert.equal(target(7, 1, { spreadMode: false }), 7, 'single-page mode still clamps at the end');

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewerSource, /function goNext\(\)[\s\S]*?if \(spreadMode && hasBookModel\(\)\)[\s\S]*?transitionToBookUnit\(bookSpreadIndex \+ 1\)/,
    'book-model navigation must remain on its existing unit path');
assert.match(viewerSource, /function goPrev\(\)[\s\S]*?if \(spreadMode && hasBookModel\(\)\)[\s\S]*?transitionToBookUnit\(bookSpreadIndex - 1\)/,
    'book-model reverse navigation must remain on its existing unit path');
assert.match(viewerSource, /function _hasFallbackSpreadSecondPage[\s\S]*?getViewerFallbackSpreadPageIndices/);
assert.match(viewerSource, /function renderSpreadPage\([^)]*\)[\s\S]*?getViewerFallbackSpreadPageIndices[\s\S]*?const leftIdx = pageIndices\[0\][\s\S]*?renderPageIntoDom\(leftPage, lang\)/,
    'fallback rendering must draw the physical first page selected by the shared unit helper');
assert.match(viewerSource, /function renderDisplayIndexIntoDom\([^)]*\) \{\s*if \(spreadMode && !hasBookModel\(\)\) \{\s*renderSpreadPage\(displayIndex, lang\);/,
    'animation completion and direct jumps must redraw the complete fallback spread unit');
assert.match(viewerSource, /if \(spreadMode && !hasBookModel\(\)\) \{[\s\S]*?clearTransitionLayers\(\);[\s\S]*?renderSpreadPage\(nextIndex, state\.activeLang\);[\s\S]*?return;/,
    'fallback spread transitions must replace the complete unit atomically');

console.log('Viewer fallback spread navigation boundary verification passed.');
