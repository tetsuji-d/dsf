import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    FlowSourceMappingError,
    findFlowSourcePointInPages,
    mapFlowFragmentDomOffsetToSource,
    mapFlowSourcePointToFragmentDomOffset,
    resolveFlowCaretAffinityFromClientPoint,
    resolveFlowCaretClientGeometry,
} from '../js/flow-source-mapping.js';

const firstText = 'A👩‍💻';
const secondText = 'か\u3099B';
const fragment = (overrides) => Object.freeze({
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    blockType: 'paragraph',
    languageKey: 'ja',
    isBlockStart: false,
    isBlockEnd: false,
    ...overrides,
});
const first = fragment({
    text: firstText,
    isBlockStart: true,
    sourceRange: Object.freeze({
        start: 0,
        end: firstText.length,
        startGrapheme: 0,
        endGrapheme: 2,
    }),
});
const second = fragment({
    text: secondText,
    isBlockEnd: true,
    sourceRange: Object.freeze({
        start: firstText.length,
        end: firstText.length + secondText.length,
        startGrapheme: 2,
        endGrapheme: 4,
    }),
});

assert.deepEqual(mapFlowFragmentDomOffsetToSource(first, 1), {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    blockType: 'paragraph',
    languageKey: 'ja',
    graphemeOffset: 1,
    utf16Offset: 1,
    affinity: 'nearest',
});
assert.equal(
    mapFlowFragmentDomOffsetToSource(first, 3, { affinity: 'forward' }).graphemeOffset,
    2,
    'a DOM offset inside an emoji ZWJ sequence must snap to a grapheme boundary',
);
assert.deepEqual(mapFlowFragmentDomOffsetToSource(second, 2), {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    blockType: 'paragraph',
    languageKey: 'ja',
    graphemeOffset: 3,
    utf16Offset: firstText.length + 2,
    affinity: 'nearest',
});

assert.deepEqual(mapFlowSourcePointToFragmentDomOffset(second, {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    languageKey: 'ja',
    graphemeOffset: 3,
    utf16Offset: firstText.length + 2,
}), {
    domOffset: 2,
    utf16Offset: firstText.length + 2,
    graphemeOffset: 3,
});
assert.equal(mapFlowSourcePointToFragmentDomOffset(second, {
    sectionId: 'section_mapping',
    blockId: 'other',
    languageKey: 'ja',
    graphemeOffset: 3,
}), null);
assert.throws(() => mapFlowSourcePointToFragmentDomOffset(second, {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    languageKey: 'ja',
    graphemeOffset: 3,
    utf16Offset: 7,
}), (error) => error instanceof FlowSourceMappingError && error.code === 'SOURCE_OFFSET_MISMATCH');

const pages = [
    { fragments: [first] },
    { fragments: [second] },
];
assert.deepEqual(findFlowSourcePointInPages(pages, {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    languageKey: 'ja',
    graphemeOffset: 2,
    utf16Offset: firstText.length,
}), {
    pageIndex: 1,
    fragmentIndex: 0,
    domOffset: 0,
    utf16Offset: firstText.length,
    graphemeOffset: 2,
});
assert.equal(findFlowSourcePointInPages(pages, {
    sectionId: 'section_mapping',
    blockId: 'paragraph_mapping',
    languageKey: 'ja',
    graphemeOffset: 2,
    utf16Offset: firstText.length,
    affinity: 'backward',
}).pageIndex, 0);

assert.throws(() => mapFlowFragmentDomOffsetToSource({
    ...first,
    sourceRange: { start: 0, end: firstText.length },
}, 0), (error) => error instanceof FlowSourceMappingError && error.code === 'FRAGMENT_SOURCE_INVALID');
assert.throws(() => mapFlowFragmentDomOffsetToSource({
    ...first,
    sourceRange: { ...first.sourceRange, endGrapheme: 3 },
}, 0), (error) => error instanceof FlowSourceMappingError && error.code === 'FRAGMENT_GRAPHEME_RANGE_INVALID');

const horizontalCaret = resolveFlowCaretClientGeometry({
    writingMode: 'horizontal-tb',
    nextRect: { left: 20, top: 30, right: 36, bottom: 58, width: 16, height: 28 },
});
assert.deepEqual(horizontalCaret, {
    left: 20,
    top: 30,
    right: 20,
    bottom: 58,
    width: 0,
    height: 28,
    writingMode: 'horizontal-tb',
    caretOrientation: 'vertical',
    basis: 'next',
});

const verticalCaret = resolveFlowCaretClientGeometry({
    writingMode: 'vertical-rl',
    nextRect: { left: 280, top: 48, right: 308, bottom: 66, width: 28, height: 18 },
});
assert.deepEqual(verticalCaret, {
    left: 280,
    top: 48,
    right: 308,
    bottom: 48,
    width: 28,
    height: 0,
    writingMode: 'vertical-rl',
    caretOrientation: 'horizontal',
    basis: 'next',
});

const verticalAfterCaret = resolveFlowCaretClientGeometry({
    writingMode: 'vertical-rl',
    affinity: 'backward',
    previousRect: { left: 280, top: 48, right: 308, bottom: 66, width: 28, height: 18 },
});
assert.equal(verticalAfterCaret.top, 66);
assert.equal(verticalAfterCaret.bottom, 66);
assert.equal(verticalAfterCaret.basis, 'previous');

const verticalEmptyCaret = resolveFlowCaretClientGeometry({
    writingMode: 'vertical-rl',
    fragmentRect: { left: 250, top: 20, right: 279, bottom: 620, width: 29, height: 600 },
});
assert.equal(verticalEmptyCaret.left, 250);
assert.equal(verticalEmptyCaret.right, 279);
assert.equal(verticalEmptyCaret.top, 20);
assert.equal(verticalEmptyCaret.height, 0);
assert.equal(verticalEmptyCaret.basis, 'fragment');

const wrappedVerticalCollapsed = { left: 280, top: 640, right: 308, bottom: 640, width: 28, height: 0 };
const wrappedVerticalPrevious = { left: 280, top: 620, right: 308, bottom: 640, width: 28, height: 20 };
const wrappedVerticalNext = { left: 250, top: 20, right: 278, bottom: 40, width: 28, height: 20 };
const wrappedVerticalForward = resolveFlowCaretClientGeometry({
    writingMode: 'vertical-rl',
    affinity: 'forward',
    collapsedRect: wrappedVerticalCollapsed,
    previousRect: wrappedVerticalPrevious,
    nextRect: wrappedVerticalNext,
});
assert.equal(wrappedVerticalForward.top, 20);
assert.equal(wrappedVerticalForward.basis, 'next');
const wrappedVerticalBackward = resolveFlowCaretClientGeometry({
    writingMode: 'vertical-rl',
    affinity: 'backward',
    collapsedRect: wrappedVerticalCollapsed,
    previousRect: wrappedVerticalPrevious,
    nextRect: wrappedVerticalNext,
});
assert.equal(wrappedVerticalBackward.top, 640);
assert.equal(wrappedVerticalBackward.basis, 'previous');

const wrappedHorizontalForward = resolveFlowCaretClientGeometry({
    writingMode: 'horizontal-tb',
    affinity: 'forward',
    collapsedRect: { left: 420, top: 30, right: 420, bottom: 58, width: 0, height: 28 },
    previousRect: { left: 404, top: 30, right: 420, bottom: 58, width: 16, height: 28 },
    nextRect: { left: 20, top: 62, right: 36, bottom: 90, width: 16, height: 28 },
});
assert.equal(wrappedHorizontalForward.left, 20);
assert.equal(wrappedHorizontalForward.basis, 'next');

assert.equal(resolveFlowCaretAffinityFromClientPoint({
    clientX: 264,
    clientY: 23,
    backwardRect: wrappedVerticalCollapsed,
    forwardRect: wrappedVerticalForward,
}), 'forward');
assert.equal(resolveFlowCaretAffinityFromClientPoint({
    clientX: 294,
    clientY: 638,
    backwardRect: wrappedVerticalBackward,
    forwardRect: wrappedVerticalForward,
}), 'backward');
assert.equal(resolveFlowCaretAffinityFromClientPoint({
    clientX: 100,
    clientY: 100,
    backwardRect: { left: 100, top: 80, right: 100, bottom: 120, width: 0, height: 40 },
    forwardRect: { left: 100, top: 80, right: 100, bottom: 120, width: 0, height: 40 },
}), 'nearest');

assert.throws(
    () => resolveFlowCaretClientGeometry({ writingMode: 'sideways-rl' }),
    (error) => error instanceof FlowSourceMappingError && error.code === 'CARET_WRITING_MODE_INVALID',
);

const domRendererSource = await readFile(new URL('../js/flow-dom-measurer.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(domRendererSource, /dataset\.flowFragmentIndex = String\(fragmentIndex\)/);
assert.match(domRendererSource, /dataset\.sourceStartGrapheme/);
assert.match(domRendererSource, /dataset\.sourceEndGrapheme/);
assert.match(appSource, /mapFlowClientPointToSource\(/);
assert.match(appSource, /page\.writingMode === 'vertical-rl'/);
assert.match(appSource, /proxy\.dataset\.flowWritingMode = session\.writingMode/);
assert.match(appSource, /\{ writingMode: page\.writingMode \}/);
assert.match(appSource, /page\.isSourceFallback\) return/);
assert.match(appSource, /selectFlowSource\(activeBlock\.id, sourcePoint\)/);
assert.match(appSource, /input\.setSelectionRange\(utf16Offset, utf16Offset, 'none'\)/);
assert.doesNotMatch(appSource, /renderFlowDirectCaretPreview/);
assert.doesNotMatch(appSource, /geometry-only/);

console.log('Flow source mapping verification passed.');
