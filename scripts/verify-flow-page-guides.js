import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    FLOW_PAGE_GUIDE_MODE_OFF,
    FLOW_PAGE_GUIDE_MODE_RULED,
    normalizeFlowPageGuideMode,
    resolveFlowPageRuleGuide,
} from '../js/flow-page-guides.js';

assert.equal(normalizeFlowPageGuideMode('ruled'), FLOW_PAGE_GUIDE_MODE_RULED);
for (const value of ['off', 'grid', '', null, undefined, 1]) {
    assert.equal(normalizeFlowPageGuideMode(value), FLOW_PAGE_GUIDE_MODE_OFF);
}

const verticalInput = {
    mode: 'ruled', languageKey: 'ja', writingMode: 'vertical-rl',
    typography: { fontSize: 16, lineHeight: 1.625, letterSpacing: 2.182 },
};
const verticalBefore = JSON.stringify(verticalInput);
const vertical = resolveFlowPageRuleGuide(verticalInput);
assert.deepEqual(vertical, {
    mode: 'ruled', writingMode: 'vertical-rl', axis: 'vertical', linePitch: 26,
});
assert.equal(JSON.stringify(verticalInput), verticalBefore, 'guide resolution cannot mutate typography input');
assert.ok(Object.isFrozen(vertical));

const horizontal = resolveFlowPageRuleGuide({
    mode: 'ruled', languageKey: 'ja', writingMode: 'horizontal-tb',
    typography: { fontSize: 16, lineHeight: 1.875, letterSpacing: 0 },
});
assert.deepEqual(horizontal, {
    mode: 'ruled', writingMode: 'horizontal-tb', axis: 'horizontal', linePitch: 30,
});
assert.ok(Object.isFrozen(horizontal));

const custom = resolveFlowPageRuleGuide({
    mode: 'ruled', languageKey: 'en', writingMode: 'horizontal-tb',
    typography: { fontSize: 17, lineHeight: 1.4 },
});
assert.equal(custom.linePitch, 23.8);
const off = resolveFlowPageRuleGuide({ mode: 'future-mode', writingMode: 'vertical-rl' });
assert.deepEqual(off, {
    mode: 'off', writingMode: 'vertical-rl', axis: 'vertical', linePitch: null,
});
assert.throws(() => resolveFlowPageRuleGuide({ mode: 'ruled', writingMode: 'sideways-lr' }),
    { code: 'UNSUPPORTED_WRITING_MODE' });

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const canvas = await readFile(new URL('../js/flow-canvas-view.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../studio.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/studio.css', import.meta.url), 'utf8');
const press = await readFile(new URL('../js/press.js', import.meta.url), 'utf8');
const viewer = await readFile(new URL('../js/viewer.js', import.meta.url), 'utf8');

assert.match(html, /id="flow-direct-guide-mode"[\s\S]*value="off"[\s\S]*value="ruled"/);
assert.match(app, /let _flowPageGuideMode = 'off'/);
assert.match(app, /_flowCanvasView\?\.setGuideMode\(active \? _flowPageGuideMode : 'off'\)/);
assert.match(app, /_flowPageGuideMode = normalizeFlowPageGuideMode\(event\.target\.value\)/);
const guideHandler = app.match(/function handleFlowPageGuideModeChange\(event\) \{[\s\S]*?\n\}/)?.[0] || '';
for (const forbidden of ['dispatch(', 'pushState(', 'triggerAutoSave(', 'scheduleFlowAuthoringReflow(']) {
    assert.ok(!guideHandler.includes(forbidden), `display-only guide handler cannot call ${forbidden}`);
}

assert.match(canvas, /const contentElement = renderFlowGeneratedPage/);
assert.match(canvas, /entry = \{ slot, pageElement, contentElement, page, pageIndex: index \}/);
assert.match(canvas, /mounted\.forEach\(applyPageGuide\)/);
assert.match(canvas, /resize, ensurePage, setGuideMode/);
assert.match(css, /> \.flow-dom-content\[data-flow-page-guide="ruled"\]/);
assert.match(css, /data-flow-page-guide-axis="horizontal"/);
assert.match(css, /data-flow-page-guide-axis="vertical"/);
assert.match(css, /to bottom/);
assert.match(css, /to left/);
assert.ok(!press.includes('flow-page-guide'), 'Press must not receive editor guide state');
assert.ok(!viewer.includes('flow-page-guide'), 'Viewer must not receive editor guide state');

console.log('Flow editor-only ruled page guide verification passed.');
