import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION,
    FLOW_PUBLICATION_COMPOSITION_HYPHENATION,
    FlowPublicationCompositionCaptureError,
    groupFlowPublicationGraphemeRects,
    resolveFlowPublicationLineBox,
} from '../js/flow-publication-composition-capture.js';
import {
    FLOW_DOM_RENDERER_VERSION,
    resolveFlowDomHyphenation,
} from '../js/flow-dom-measurer.js';

const item = (text, startGrapheme, rects) => ({
    text,
    startGrapheme,
    endGrapheme: startGrapheme + 1,
    rects,
});

assert.equal(FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION, 1);
assert.equal(FLOW_PUBLICATION_COMPOSITION_HYPHENATION, 'none');
assert.equal(FLOW_DOM_RENDERER_VERSION, 14);
assert.equal(resolveFlowDomHyphenation(undefined, 'horizontal-tb'), 'auto');
assert.equal(resolveFlowDomHyphenation(undefined, 'vertical-rl'), 'none');
assert.equal(resolveFlowDomHyphenation('none', 'horizontal-tb'), 'none');
assert.throws(
    () => resolveFlowDomHyphenation('manual', 'horizontal-tb'),
    (error) => error?.code === 'INVALID_HYPHENATION',
);

const horizontal = groupFlowPublicationGraphemeRects([
    item('冬', 10, [{ x: 20, y: 30, width: 16, height: 20 }]),
    item('。', 11, [{ x: 36, y: 30, width: 16, height: 20 }]),
    item('\n', 12, [{ x: 52, y: 30, width: 0, height: 20 }]),
    item('雪', 13, [{ x: 20, y: 59, width: 16, height: 20 }]),
], { blockId: 'paragraph-horizontal', writingMode: 'horizontal-tb' });

assert.equal(horizontal.length, 2);
assert.equal(horizontal[0].runs[0].text, '冬。\n');
assert.deepEqual(horizontal[0].runs[0].source, {
    blockId: 'paragraph-horizontal',
    startGrapheme: 10,
    endGrapheme: 13,
});
assert.deepEqual(
    { x: horizontal[0].x, y: horizontal[0].y, width: horizontal[0].width, height: horizontal[0].height },
    { x: 20, y: 30, width: 32, height: 20 },
);
assert.equal(horizontal[1].runs[0].text, '雪');
assert.equal(horizontal[1].runs[0].source.startGrapheme, 13);
assert.equal(horizontal[1].runs[0].source.endGrapheme, 14);

const vertical = groupFlowPublicationGraphemeRects([
    item('縦', 0, [{ x: 310, y: 20, width: 20, height: 16 }]),
    item('書', 1, [{ x: 310, y: 36, width: 20, height: 16 }]),
    item('き', 2, [{ x: 281, y: 20, width: 20, height: 16 }]),
], { blockId: 'paragraph-vertical', writingMode: 'vertical-rl' });

assert.equal(vertical.length, 2);
assert.equal(vertical[0].runs[0].text, '縦書');
assert.deepEqual(
    { x: vertical[0].x, y: vertical[0].y, width: vertical[0].width, height: vertical[0].height },
    { x: 310, y: 20, width: 20, height: 32 },
);
assert.equal(vertical[1].runs[0].text, 'き');

const leadingZeroRect = groupFlowPublicationGraphemeRects([
    item('\n', 0, []),
    item('次', 1, [{ x: 20, y: 48, width: 16, height: 20 }]),
], { blockId: 'paragraph-leading-break', writingMode: 'horizontal-tb' });
assert.equal(leadingZeroRect.length, 1);
assert.equal(leadingZeroRect[0].runs[0].text, '\n次');
assert.equal(leadingZeroRect[0].runs[0].source.startGrapheme, 0);
assert.equal(leadingZeroRect[0].runs[0].source.endGrapheme, 2);

for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const vertical = writingMode === 'vertical-rl';
    const rect = vertical ? { x: 310, y: 20, width: 22, height: 0 }
        : { x: 20, y: 30, width: 0, height: 22 };
    const input = [item('\n', 3, [rect])];
    const before = JSON.stringify(input);
    const blank = groupFlowPublicationGraphemeRects(input, { blockId: 'blank-line', writingMode });
    assert.equal(blank.length, 1);
    assert.equal(blank[0].runs[0].text, '\n');
    assert.deepEqual(blank[0].runs[0].source, { blockId: 'blank-line', startGrapheme: 3, endGrapheme: 4 });
    assert.equal(vertical ? blank[0].height : blank[0].width, 0, 'LF-only inline advance may be zero');
    assert.equal(vertical ? blank[0].width : blank[0].height, 22, 'LF-only lines still require measured cross-axis metrics');
    assert.equal(JSON.stringify(input), before);
    assert.throws(() => groupFlowPublicationGraphemeRects([item('A', 3, [rect])],
        { blockId: 'not-blank', writingMode }), error => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED');
    const missingCross = vertical ? { ...rect, width: 0, height: 22 } : { ...rect, width: 22, height: 0 };
    assert.throws(() => groupFlowPublicationGraphemeRects([item('\n', 3, [missingCross])],
        { blockId: 'blank-without-font-metrics', writingMode }), error => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED');
}

assert.throws(
    () => groupFlowPublicationGraphemeRects([
        item('\n', 0, []),
    ], { blockId: 'paragraph-unmeasured', writingMode: 'horizontal-tb' }),
    (error) => error instanceof FlowPublicationCompositionCaptureError
        && error.code === 'FLOW_PUBLICATION_CAPTURE_LINE_UNMEASURED',
);
assert.throws(
    () => groupFlowPublicationGraphemeRects([
        item('A', 1, [{ x: 20, y: 20, width: 10, height: 18 }]),
        item('B', 3, [{ x: 30, y: 20, width: 10, height: 18 }]),
    ], { blockId: 'paragraph-gap', writingMode: 'horizontal-tb' }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_SOURCE_INVALID',
);
assert.throws(
    () => groupFlowPublicationGraphemeRects([
        item('A', 0, [
            { x: 20, y: 20, width: 10, height: 18 },
            { x: 20, y: 50, width: 10, height: 18 },
        ]),
    ], { blockId: 'paragraph-split', writingMode: 'horizontal-tb' }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GRAPHEME_SPLIT',
);

// Source glyph bounds are not CSS line-box bounds. The same visible glyph can
// start below/right of the line box because of its real font metrics/leading.
const horizontalLineBox = {
    writingMode: 'horizontal-tb', width: 320, height: 30,
    sourceItems: [
        item('冬', 10, [{ x: 20, y: 22.75, width: 16, height: 22 }]),
        item('…', 11, [{ x: 36, y: 22.75, width: 16, height: 22 }]),
        item('\n', 12, [{ x: 52, y: 22.75, width: 0, height: 22 }]),
    ],
    probeItems: [
        item('冬', 10, [{ x: 0, y: 2.75, width: 16, height: 22 }]),
        item('…', 11, [{ x: 16, y: 2.75, width: 16, height: 22 }]),
        item('\n', 12, []),
    ],
};
const horizontalBefore = JSON.stringify(horizontalLineBox);
assert.deepEqual(resolveFlowPublicationLineBox(horizontalLineBox), { x: 20, y: 20, width: 320, height: 30 });
assert.equal(JSON.stringify(horizontalLineBox), horizontalBefore, 'line-box correction never changes source/probe text or ranges');

const verticalLineBox = {
    writingMode: 'vertical-rl', width: 26.667, height: 600,
    sourceItems: [
        item('前', 0, [{ x: 312.9, y: 20, width: 24.8, height: 18 }]),
        item('…', 1, [{ x: 312.9, y: 38, width: 24.8, height: 18 }]),
        item('\n', 2, [{ x: 312.9, y: 56, width: 24.8, height: 0 }]),
    ],
    probeItems: [
        item('前', 0, [{ x: 0.9, y: 0, width: 24.8, height: 18 }]),
        item('…', 1, [{ x: 0.9, y: 18, width: 24.8, height: 18 }]),
        item('\n', 2, []),
    ],
};
assert.deepEqual(resolveFlowPublicationLineBox(verticalLineBox), { x: 312, y: 20, width: 26.667, height: 600 });

// A heading/mixed-script line uses its own measured metrics, not a body offset.
assert.deepEqual(resolveFlowPublicationLineBox({
    writingMode: 'horizontal-tb', width: 320, height: 40,
    sourceItems: [
        item('見', 0, [{ x: 42, y: 53, width: 24, height: 34 }]),
        item('A', 1, [{ x: 66, y: 55, width: 15, height: 30 }]),
    ],
    probeItems: [
        item('見', 0, [{ x: 22, y: 3, width: 24, height: 34 }]),
        item('A', 1, [{ x: 46, y: 5, width: 15, height: 30 }]),
    ],
}), { x: 20, y: 50, width: 320, height: 40 });

const leadingBreakLine = structuredClone(horizontalLineBox);
leadingBreakLine.sourceItems.unshift(item('\n', 9, []));
leadingBreakLine.probeItems.unshift(item('\n', 9, []));
assert.deepEqual(resolveFlowPublicationLineBox(leadingBreakLine), { x: 20, y: 20, width: 320, height: 30 });

const shiftedLaterGlyph = structuredClone(horizontalLineBox);
shiftedLaterGlyph.probeItems[1].rects[0].x += 1;
assert.throws(() => resolveFlowPublicationLineBox(shiftedLaterGlyph),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH' && error.context.startGrapheme === 11,
    'matching the first glyph is not enough: later spacing/justification differences must fail');

const differentGlyphSize = structuredClone(horizontalLineBox);
differentGlyphSize.probeItems[0].rects[0].width -= 1;
assert.throws(() => resolveFlowPublicationLineBox(differentGlyphSize),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH');

const collapsedSpace = structuredClone(horizontalLineBox);
collapsedSpace.sourceItems[0].text = ' ';
collapsedSpace.probeItems[0].text = ' ';
collapsedSpace.probeItems[0].rects = [];
assert.throws(() => resolveFlowPublicationLineBox(collapsedSpace),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_UNMEASURED',
    'whitespace cannot be replaced or silently lost to make the measurement pass');

const trailingSpace = structuredClone(horizontalLineBox);
trailingSpace.sourceItems[2] = item(' ', 12, [{ x: 52, y: 22.75, width: 4, height: 22 }]);
trailingSpace.probeItems[2] = item(' ', 12, [{ x: 32, y: 2.75, width: 0, height: 22 }]);
assert.throws(() => resolveFlowPublicationLineBox(trailingSpace),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH',
    'preserve-v1 must measure trailing spaces too, never accept a collapsed advance');
assert.equal(trailingSpace.sourceItems[2].text, ' ', 'line-end source spaces must remain unchanged');

// Inkless trailing whitespace can hang past the inline end, but its full
// measured advance must still match. The cross-axis must never be clipped.
for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const vertical = writingMode === 'vertical-rl';
    const rect = (inline, extent, cross = 2, breadth = 22) => vertical
        ? { x: cross, y: inline, width: breadth, height: extent }
        : { x: inline, y: cross, width: extent, height: breadth };
    const shifted = value => ({ ...value, x: value.x + 20, y: value.y + 20 });
    for (const space of [' ', '\t', '\u00a0', '\u3000']) {
        const probeItems = [item('雪', 0, [rect(0, 16)]), item(space, 1, [rect(16, 40)]),
            item(' ', 2, [rect(56, 8)]), item('\n', 3, [])];
        const sourceItems = probeItems.map(entry => ({ ...entry, rects: entry.rects.map(shifted) }));
        const input = { writingMode, width: vertical ? 30 : 32, height: vertical ? 32 : 30, sourceItems, probeItems };
        const before = JSON.stringify(input);
        assert.deepEqual(resolveFlowPublicationLineBox(input),
            { x: 20, y: 20, width: input.width, height: input.height });
        assert.equal(JSON.stringify(input), before, 'hanging whitespace and LF retain exact source offsets');

        const collapsed = structuredClone(input);
        collapsed.probeItems[1].rects[0][vertical ? 'height' : 'width'] = 0;
        assert.throws(() => resolveFlowPublicationLineBox(collapsed),
            error => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH',
            'hanging whitespace is not permission to collapse its advance');

        const middle = structuredClone(input);
        middle.sourceItems[3] = item('朝', 3, [shifted(rect(64, 16))]);
        middle.probeItems[3] = item('朝', 3, [rect(64, 16)]);
        assert.throws(() => resolveFlowPublicationLineBox(middle),
            error => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_OUTSIDE_LINEBOX' && error.context.startGrapheme === 1,
            'whitespace before another visible glyph cannot overflow the inline box');

        const crossOverflow = structuredClone(input);
        crossOverflow.probeItems[1].rects = [rect(16, 40, 2, 35)];
        crossOverflow.sourceItems[1].rects = crossOverflow.probeItems[1].rects.map(shifted);
        assert.throws(() => resolveFlowPublicationLineBox(crossOverflow),
            error => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_OUTSIDE_LINEBOX',
            'even matching hanging whitespace may not exceed cross-axis bounds');
    }
}
const middleSpace = structuredClone(trailingSpace);
middleSpace.sourceItems.push(item('朝', 13, [{ x: 56, y: 22.75, width: 16, height: 22 }]));
middleSpace.probeItems.push(item('朝', 13, [{ x: 32, y: 2.75, width: 16, height: 22 }]));
assert.throws(() => resolveFlowPublicationLineBox(middleSpace),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_MISMATCH',
    'collapsed spaces before another visible glyph must still block publication');

assert.throws(() => resolveFlowPublicationLineBox({ ...horizontalLineBox, width: 25 }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_GLYPH_OUTSIDE_LINEBOX');
assert.throws(() => resolveFlowPublicationLineBox({ ...horizontalLineBox, height: 0 }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINEBOX_INVALID');
assert.throws(() => resolveFlowPublicationLineBox({ ...horizontalLineBox, writingMode: 'vertical-lr' }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINEBOX_INVALID');
assert.throws(() => resolveFlowPublicationLineBox({ ...horizontalLineBox, probeItems: [] }),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH');

const changedText = structuredClone(horizontalLineBox);
changedText.probeItems[1].text = '︙';
assert.throws(() => resolveFlowPublicationLineBox(changedText),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINEBOX_SOURCE_MISMATCH');
const invalidRange = structuredClone(horizontalLineBox);
invalidRange.probeItems[1].rects[0].x = Number.NaN;
assert.throws(() => resolveFlowPublicationLineBox(invalidRange),
    (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_RECT_INVALID');
assert.throws(() => resolveFlowPublicationLineBox({
    writingMode: 'horizontal-tb', width: 320, height: 30,
    sourceItems: [item('\n', 0, [])], probeItems: [item('\n', 0, [])],
}), (error) => error?.code === 'FLOW_PUBLICATION_CAPTURE_LINEBOX_UNMEASURED');

const captureSource = readFileSync(
    new URL('../js/flow-publication-composition-capture.js', import.meta.url),
    'utf8',
);
assert.match(captureSource, /createFlowDomPageMeasurer\(\{[\s\S]*hyphenation:\s*FLOW_PUBLICATION_COMPOSITION_HYPHENATION/);
assert.match(captureSource, /primaryFontFamily\(authorTypography\.fontFamily\)/);
assert.match(captureSource, /typographyOptions = \{ languageConfigs: options\.languageConfigs \}/);
assert.match(captureSource, /resolveFlowDomTypography\(language, profile, writingMode, typographyOptions\)/,
    'capture font certification must resolve inherited project typography');
assert.match(captureSource, /resolveFlowPublicationTypography\([\s\S]*?certifiedFamily,\s*typographyOptions,/,
    'snapshot typography must use the same inherited font as capture');
assert.match(captureSource, /runtimeFontFamily/);
assert.match(captureSource, /typography:\s*context\.measurementTypography/);
assert.match(captureSource, /typography:\s*context\.typography,[\s\S]*evidence:/, 'runtime alias cannot leak into publication snapshot');
assert.match(captureSource, /renderFlowGeneratedPage\([\s\S]*hyphenation:\s*FLOW_PUBLICATION_COMPOSITION_HYPHENATION/);
assert.match(captureSource, /range\.getClientRects\(\)/, 'capture must use browser Range geometry');
assert.match(captureSource, /lineHeight = Number\.parseFloat\(computed\?\.lineHeight\)/,
    'line-box correction uses the actual Heading/Paragraph computed line height');
assert.match(captureSource, /lineHeight: element\.style\.lineHeight \|\| computed\.lineHeight/,
    'probe text retains the same unitless line height as the Viewer; pixel conversion is only for box dimensions');
assert.match(captureSource, /applyFixedTextWhiteSpaceStyle\(lineBoxProbe, FIXED_TEXT_WHITE_SPACE_MODE\)/,
    'probe shares the opt-in Viewer whitespace contract');
assert.match(captureSource, /renderFixedTextRunText\(surface.lineBoxProbeRun, text, FIXED_TEXT_WHITE_SPACE_MODE\)/,
    'probe shares the lossless Viewer text DOM');
assert.match(captureSource, /computed.tabSize !== String\(FIXED_TEXT_TAB_SIZE\)/,
    'unsupported source TAB stops must fail closed');
assert.match(captureSource, /ownedPaginations\.has\(pagination\)/, 'capture must reject pagination from another layout session');
assert.match(captureSource, /evidence:\s*\{[\s\S]*fontSha256:[\s\S]*hyphenation:/);
assert.doesNotMatch(captureSource, /from ['"]\.\/press\.js['"]/);
assert.doesNotMatch(captureSource, /from ['"]\.\/dsf-release-assembly\.js['"]/);
assert.doesNotMatch(captureSource, /from ['"]\.\/viewer-fixed-text\.js['"]/);
assert.doesNotMatch(captureSource, /firebase|Firestore|R2|localStorage|indexedDB/);

const fixtureSource = readFileSync(
    new URL('../js/fixtures/flow-publication-capture-fixture.js', import.meta.url),
    'utf8',
);
const viteSource = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
assert.match(fixtureSource, /if \(!import\.meta\.env\.DEV\)/, 'browser fixture must be development-only');
assert.match(fixtureSource, /session\.paginate\(/, 'fixture pagination must come from the certified session');
assert.match(fixtureSource, /session\.capture\(pagination\)/, 'fixture must capture that exact pagination');
assert.match(fixtureSource, /projectFlowPaginationToDsfV2\(/, 'fixture must immediately exercise 9A-5A');
assert.doesNotMatch(viteSource, /flow-publication-capture\.html/, 'capture fixture cannot be a build entry');

console.log('Flow publication composition capture contract verified.');
