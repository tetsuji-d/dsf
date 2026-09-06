import assert from 'node:assert/strict';
import { findEditorCanvasFlowPageIndex, getEditorCanvasSpreadJoins } from '../js/editor-canvas-projection.js';
import { calculateFlowCanvasLayout, getFlowCanvasPagePosition, calculateFlowCanvasWindow } from '../js/flow-canvas-layout.js';

// Same local page/block IDs in separate Flow Groups must never select each other's surfaces.
const pages = [
    { kind: 'fixed', section: { type: 'text' } },
    { kind: 'flow', groupId: 'a', flowPageIndex: 0 },
    { kind: 'flow', groupId: 'a', flowPageIndex: 1 },
    { kind: 'fixed', section: { spreadImage: { groupId: 'spread' } } },
    { kind: 'fixed', section: { spreadImage: { groupId: 'spread' } } },
    { kind: 'flow', groupId: 'b', flowPageIndex: 0 },
];
const original = JSON.stringify(pages);
assert.equal(findEditorCanvasFlowPageIndex(pages, 'b', 0), 5);
assert.equal(findEditorCanvasFlowPageIndex(pages, 'a', 1), 2);
assert.equal(findEditorCanvasFlowPageIndex(pages, 'b', 1), -1);
assert.deepEqual(getEditorCanvasSpreadJoins(pages), [4]);
assert.deepEqual(getEditorCanvasSpreadJoins([pages[3], pages[1], pages[4]]), []);
for (const direction of ['rtl', 'ltr']) {
    const layout = calculateFlowCanvasLayout({ pageCount: pages.length, viewportWidth: 460, viewportHeight: 800,
        direction, joinedPageIndices: getEditorCanvasSpreadJoins(pages) });
    const a = getFlowCanvasPagePosition(layout, 3), b = getFlowCanvasPagePosition(layout, 4);
    assert.ok(Math.abs(Math.abs(a.left - b.left) - a.width) < 0.001, 'spread must have no interior gap');
    for (let scrollLeft = 0; scrollLeft <= layout.maxScrollLeft; scrollLeft += 13) {
        const window = calculateFlowCanvasWindow(layout, { scrollLeft, overscan: 0, pinnedPageIndex: 0 });
        const expected = pages.map((_, i) => i).filter(i => {
            const p = getFlowCanvasPagePosition(layout, i);
            return p.left + p.width > scrollLeft && p.left < scrollLeft + layout.viewportWidth;
        });
        assert.deepEqual(window.visiblePageIndices, expected, 'virtual window must include both joined halves');
        assert.ok(window.pageIndices.includes(0), 'active page remains mounted');
        assert.ok(window.pageIndices.length <= 4, 'scroll cannot mount the entire manuscript');
    }
}
assert.equal(JSON.stringify(pages), original);
console.log('Mixed canvas mapping, joined spread geometry, virtual window and immutability passed.');
