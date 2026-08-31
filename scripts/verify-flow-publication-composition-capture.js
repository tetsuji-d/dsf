import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    FLOW_PUBLICATION_COMPOSITION_CAPTURE_VERSION,
    FLOW_PUBLICATION_COMPOSITION_HYPHENATION,
    FlowPublicationCompositionCaptureError,
    groupFlowPublicationGraphemeRects,
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
assert.equal(FLOW_DOM_RENDERER_VERSION, 5);
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
