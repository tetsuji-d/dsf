import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    FlowSourceMappingError,
    findFlowSourcePointInPages,
    mapFlowFragmentDomOffsetToSource,
    mapFlowSourcePointToFragmentDomOffset,
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

const domRendererSource = await readFile(new URL('../js/flow-dom-measurer.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(domRendererSource, /dataset\.flowFragmentIndex = String\(fragmentIndex\)/);
assert.match(domRendererSource, /dataset\.sourceStartGrapheme/);
assert.match(domRendererSource, /dataset\.sourceEndGrapheme/);
assert.match(appSource, /mapFlowClientPointToSource\(/);
assert.match(appSource, /page\.isSourceFallback\) return/);
assert.match(appSource, /selectFlowSource\(activeBlock\.id, sourcePoint\)/);
assert.match(appSource, /input\.setSelectionRange\(utf16Offset, utf16Offset, 'none'\)/);

console.log('Flow source mapping verification passed.');
