import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getViewerPageNavigationTarget } from '../js/viewer-navigation.js';

const target = (currentIndex, delta, options = {}) => getViewerPageNavigationTarget({
    currentIndex,
    totalPages: options.totalPages ?? 8,
    delta,
    spreadMode: options.spreadMode ?? true,
    hasVisibleSecondPage: options.hasVisibleSecondPage ?? true,
});

assert.equal(target(2, 1), 4, 'a visible two-page spread advances by two pages');
assert.equal(target(4, -1), 2, 'a visible two-page spread goes back by two pages');
assert.equal(target(0, 1, { hasVisibleSecondPage: false }), 1, 'a single cover advances by one page');
assert.equal(target(7, -1, { hasVisibleSecondPage: false }), 6, 'a single trailing page goes back by one page');
assert.equal(target(6, 1), 7, 'spread navigation clamps at the final page');
assert.equal(target(1, -1), 0, 'spread navigation clamps at the first page');
assert.equal(target(2, 1, { spreadMode: false }), 3, 'single-page mode remains one page at a time');

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewerSource, /function goNext\(\)[\s\S]*?getViewerPageNavigationTarget\(\{[\s\S]*?delta: 1/);
assert.match(viewerSource, /function goPrev\(\)[\s\S]*?getViewerPageNavigationTarget\(\{[\s\S]*?delta: -1/);
assert.match(viewerSource, /function _hasFallbackSpreadSecondPage[\s\S]*?getPageDirection\(\) === 'rtl'/);

console.log('Viewer fallback spread navigation verification passed.');
