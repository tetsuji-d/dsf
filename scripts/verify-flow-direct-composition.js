import assert from 'node:assert/strict';
import {
    alignFlowDirectCompositionElement,
    resolveFlowDirectCompositionTranslation,
} from '../js/flow-direct-composition.js';

const rect = (left, top, width, height) => ({ left, top, width, height });
const vertical = {
    writingMode: 'vertical-rl',
    caretRect: rect(100, 200, 22, 0),
    compositionRect: rect(103, 201, 22, 18),
};
assert.deepEqual(resolveFlowDirectCompositionTranslation(vertical), { leftDelta: -3, topDelta: -1 });
assert.deepEqual(resolveFlowDirectCompositionTranslation({
    ...vertical, scaleX: 2, scaleY: 1.5,
}), { leftDelta: -6, topDelta: -1.5 }, 'scale conversion must use both page axes');
assert.deepEqual(resolveFlowDirectCompositionTranslation({
    ...vertical, compositionRect: rect(102, 200, 18, 18),
}), { leftDelta: 0, topDelta: 0 }, 'different glyph widths must preserve the column center');

const horizontal = {
    writingMode: 'horizontal-tb',
    caretRect: rect(100, 200, 0, 22),
    compositionRect: rect(101, 204, 16, 22),
};
assert.deepEqual(resolveFlowDirectCompositionTranslation(horizontal), { leftDelta: -1, topDelta: -4 });
assert.deepEqual(resolveFlowDirectCompositionTranslation({
    ...horizontal, compositionRect: rect(100, 202, 16, 18),
}), { leftDelta: 0, topDelta: 0 }, 'different glyph heights must preserve the line center');
assert.ok(Object.isFrozen(resolveFlowDirectCompositionTranslation(vertical)));
for (const bad of [
    {}, { ...vertical, writingMode: 'sideways-lr' },
    { ...vertical, caretRect: null },
    { ...vertical, compositionRect: rect(NaN, 0, 22, 18) },
    { ...vertical, caretRect: rect(0, 0, -1, 0) },
    { ...vertical, compositionRect: rect(0, 0, 0, 18) },
    { ...horizontal, caretRect: rect(0, 0, 0, 0) },
    { ...vertical, scaleX: 0 }, { ...vertical, scaleY: -1 },
    { ...vertical, scaleX: Infinity },
]) assert.equal(resolveFlowDirectCompositionTranslation(bad), null);

function createFixture(text = 'おはよう') {
    const measuredOffsets = [];
    const textNode = { nodeType: 3, textContent: text };
    const style = { left: '100px', top: '200px' };
    const compositionElement = { firstChild: textNode, style };
    const range = {
        setStart(node, offset) { assert.equal(node, textNode); measuredOffsets.push(['start', offset]); },
        setEnd(node, offset) { assert.equal(node, textNode); measuredOffsets.push(['end', offset]); },
        getClientRects() {
            return [rect(
                50 + (Number.parseFloat(style.left) - 100) / 2 + 1.5,
                100 + (Number.parseFloat(style.top) - 200) / 2 + 0.5,
                11, 9,
            )];
        },
    };
    const pageElement = {
        ownerDocument: { createRange: () => range },
        offsetWidth: 360,
        offsetHeight: 640,
        getBoundingClientRect: () => rect(0, 0, 180, 320),
        contains: (element) => element === compositionElement,
    };
    return {
        pageElement, compositionElement, measuredOffsets, range,
        caretRect: rect(50, 100, 11, 0), writingMode: 'vertical-rl', languageKey: 'ja',
    };
}

const fixture = createFixture();
assert.deepEqual(alignFlowDirectCompositionElement(fixture), {
    leftDelta: -3, topDelta: -1, left: 97, top: 199,
});
assert.deepEqual(fixture.measuredOffsets, [['start', 0], ['end', 1]]);
assert.deepEqual(fixture.compositionElement.style, { left: '97px', top: '199px' });
assert.deepEqual(alignFlowDirectCompositionElement(fixture), {
    leftDelta: 0, topDelta: 0, left: 97, top: 199,
}, 'measured alignment must be idempotent, not accumulate a hard-coded offset');

const emojiFixture = createFixture('👨‍👩‍👧‍👦は家族');
alignFlowDirectCompositionElement(emojiFixture);
assert.equal(emojiFixture.measuredOffsets[1][1], '👨‍👩‍👧‍👦'.length,
    'measurement must include the complete first grapheme');
for (const mutate of [
    (item) => { item.compositionElement.firstChild.textContent = ''; },
    (item) => { item.pageElement.contains = () => false; },
    (item) => { item.pageElement.offsetWidth = 0; },
    (item) => { item.pageElement.getBoundingClientRect = () => rect(0, 0, 0, 0); },
    (item) => { item.range.getClientRects = () => []; },
    (item) => { item.range.setStart = () => { throw new Error('detached'); }; },
]) {
    const invalid = createFixture();
    mutate(invalid);
    assert.equal(alignFlowDirectCompositionElement(invalid), null);
    assert.deepEqual(invalid.compositionElement.style, { left: '100px', top: '200px' },
        'missing measurements must preserve the caller position');
}
assert.equal(alignFlowDirectCompositionElement(), null);
console.log('Flow direct composition geometry verification passed.');
