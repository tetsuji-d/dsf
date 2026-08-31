import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    composeText,
    getTextPageTypographyDefaults,
} from '../js/layout.js';
import {
    FlowDomMeasurementError,
    FLOW_DOM_RENDERER_VERSION,
    renderFlowFragments,
    renderFlowGeneratedPage,
    resolveFlowDomTypography,
} from '../js/flow-dom-measurer.js';
import { createCanonicalFlowPageBox } from '../js/flow-pagination.js';
import { createFlowPreviewDocument } from '../js/flow-preview-model.js';

// This script verifies shared typography inputs, not browser layout capacity.
// The 33 x 12 reference below exercises the existing fixed-page composer only;
// Flow's real glyph wrapping and pagination must also be checked in a browser.
const fixedVertical = composeText('あ'.repeat(396), 'ja', 'vertical-rl', 'gothic');
assert.deepEqual(fixedVertical.frame, { x: 20, y: 20, w: 320, h: 600 });
assert.equal(fixedVertical.font.size, 16);
assert.equal(fixedVertical.rules.charsPerLine, 33);
assert.equal(fixedVertical.rules.maxLines, 12);
assert.deepEqual(fixedVertical.lines.map((line) => Array.from(line).length), Array(12).fill(33));
assert.equal(fixedVertical.overflow, false);
assert.equal(composeText('あ'.repeat(397), 'ja', 'vertical-rl').overflowText, 'あ');

const pageBox = createCanonicalFlowPageBox();
assert.equal(pageBox.width, 360);
assert.equal(pageBox.height, 640);
assert.deepEqual(pageBox.contentBox, {
    x: fixedVertical.frame.x,
    y: fixedVertical.frame.y,
    width: fixedVertical.frame.w,
    height: fixedVertical.frame.h,
});

const verticalDefaults = getTextPageTypographyDefaults('ja', 'vertical-rl');
const columnPitch = Math.floor(fixedVertical.frame.w / fixedVertical.rules.maxLines);
const characterPitch = fixedVertical.frame.h / fixedVertical.rules.charsPerLine;
assert.equal(columnPitch, 26);
assert.equal(verticalDefaults.fontFamily, fixedVertical.font.family);
assert.equal(verticalDefaults.fontSize, fixedVertical.font.size);
assert.equal(verticalDefaults.lineHeight, Number((columnPitch / fixedVertical.font.size).toFixed(3)));
assert.equal(verticalDefaults.lineHeight, 1.625);
assert.equal(verticalDefaults.letterSpacing, Number((characterPitch - fixedVertical.font.size).toFixed(3)));
assert.equal(verticalDefaults.letterSpacing, 2.182);
assert.equal(verticalDefaults.paragraphSpacing, 0);
// Do not accidentally use layout.js's nominal 1.8 / 0 values: the existing
// text-page renderer overrides those to the 26px column / 33-character pitch.
assert.notEqual(verticalDefaults.lineHeight, fixedVertical.font.lineHeight);
assert.notEqual(verticalDefaults.letterSpacing, fixedVertical.font.letterSpacing);

for (const fontPreset of ['gothic', 'mincho', 'ui']) {
    const expected = getTextPageTypographyDefaults('ja', 'vertical-rl', fontPreset);
    const fixed = composeText('本文', 'ja', 'vertical-rl', fontPreset);
    const actual = resolveFlowDomTypography('ja', {}, 'vertical-rl', {
        languageConfigs: { ja: { fontPreset } },
    });
    assert.equal(expected.fontFamily, fixed.font.family, `${fontPreset}: fixed font family`);
    for (const [key, value] of Object.entries(expected)) {
        assert.equal(actual[key], value, `${fontPreset}: shared ${key}`);
    }
    assert.equal(actual.writingMode, 'vertical-rl');
    assert.equal(actual.fontWeight, '400');
}
assert.match(verticalDefaults.fontFamily, /^'Noto Sans JP'/);
assert.match(getTextPageTypographyDefaults('ja', 'vertical-rl', 'mincho').fontFamily, /^'Noto Serif JP'/);

// Empty text needs no Canvas measurement, so this stays a genuinely pure
// reference to the existing horizontal preset rather than a fake DOM test.
const fixedHorizontal = composeText('', 'en', 'horizontal-tb', 'gothic');
const horizontalDefaults = getTextPageTypographyDefaults('en', 'horizontal-tb');
assert.equal(fixedHorizontal.writingMode, 'horizontal-tb');
assert.equal(fixedHorizontal.rules.maxLines, 20);
assert.deepEqual(fixedHorizontal.frame, fixedVertical.frame);
assert.equal(horizontalDefaults.fontFamily, fixedHorizontal.font.family);
assert.equal(horizontalDefaults.fontSize, 16);
assert.equal(horizontalDefaults.lineHeight, fixedHorizontal.frame.h / fixedHorizontal.rules.maxLines / 16);
assert.equal(horizontalDefaults.lineHeight, 1.875);
assert.equal(horizontalDefaults.letterSpacing, 0);
assert.equal(horizontalDefaults.paragraphSpacing, 0);
for (const languageKey of ['en', 'en-US', 'en-GB', 'fr', 'de']) {
    const typography = resolveFlowDomTypography(languageKey, {}, 'horizontal-tb');
    assert.equal(typography.fontFamily, horizontalDefaults.fontFamily, languageKey);
    assert.equal(typography.lineHeight, 1.875, languageKey);
    assert.equal(typography.letterSpacing, 0, languageKey);
    assert.equal(typography.paragraphSpacing, 0, languageKey);
}

// Flow already supports explicit Japanese horizontal layout. Sharing the
// baseline must not inherit the fixed composer's legacy Japanese-only mode.
const japaneseHorizontal = getTextPageTypographyDefaults('ja', 'horizontal-tb', 'mincho');
assert.equal(japaneseHorizontal.lineHeight, 1.875);
assert.equal(japaneseHorizontal.letterSpacing, 0);
assert.match(japaneseHorizontal.fontFamily, /^'Noto Serif JP'/);
const japaneseHorizontalFlow = resolveFlowDomTypography('ja', {}, 'horizontal-tb', {
    languageConfigs: { ja: { fontPreset: 'mincho' } },
});
assert.equal(japaneseHorizontalFlow.writingMode, 'horizontal-tb');
for (const [key, value] of Object.entries(japaneseHorizontal)) {
    assert.equal(japaneseHorizontalFlow[key], value, `Japanese horizontal ${key}`);
}
assert.equal(resolveFlowDomTypography('ja').writingMode, 'horizontal-tb');

// Keep the pre-existing CJK-vs-Latin font routing when the shared text-page
// preset is selected. Each persisted language key still owns its settings.
for (const languageKey of ['ja', 'zh-Hans', 'zh-Hant', 'ko']) {
    for (const fontPreset of ['gothic', 'mincho']) {
        const typography = resolveFlowDomTypography(languageKey, {}, 'horizontal-tb', {
            languageConfigs: { [languageKey]: { fontPreset } },
        });
        const expected = getTextPageTypographyDefaults('ja', 'horizontal-tb', fontPreset);
        assert.equal(typography.fontFamily, expected.fontFamily, `${languageKey}/${fontPreset}`);
        assert.equal(typography.lineBreak, 'strict', languageKey);
    }
}
const languageConfigs = {
    ja: { fontPreset: 'mincho' },
    'en-US': { fontPreset: 'gothic' },
    'en-GB': { fontPreset: 'mincho' },
};
assert.match(resolveFlowDomTypography('en-US', {}, 'horizontal-tb', { languageConfigs }).fontFamily, /^'Noto Sans',/);
assert.match(resolveFlowDomTypography('en-GB', {}, 'horizontal-tb', { languageConfigs }).fontFamily, /^'Noto Serif',/);
assert.equal(
    resolveFlowDomTypography('ja', {}, 'vertical-rl', { languageConfigs: { ja: { fontPreset: 'unknown' } } }).fontFamily,
    verticalDefaults.fontFamily,
);

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

// Typography resolution is a runtime projection: author-specified values,
// semantic source, translations, and unknown metadata must remain untouched.
const source = createFlowPreviewDocument({
    heading: '第1章',
    body: '原稿本文\n\n続き\n[[PAGE_BREAK]]\n別ページ',
});
source.sections[0].blocks[1].texts.en = 'Translated source';
source.typography = {
    fontFamily: "'Author Selected Font',serif",
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 2.1,
    letterSpacing: -0.5,
    paragraphSpacing: 7,
    headingSpacing: 4,
    textAlign: 'center',
    textColor: '#112233',
    paperColor: '#ddeeff',
};
source.futureMetadata = { note: 'keep author data' };
const sourceBefore = JSON.stringify(source);
const configsBefore = JSON.stringify(languageConfigs);
deepFreeze(source);
deepFreeze(languageConfigs);
for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const typography = resolveFlowDomTypography('ja', source.typography, writingMode, { languageConfigs });
    for (const [key, value] of Object.entries(source.typography)) {
        assert.equal(typography[key], value, `explicit ${writingMode}/${key}`);
    }
    assert.equal(typography.writingMode, writingMode);
}
assert.equal(JSON.stringify(source), sourceBefore);
assert.equal(JSON.stringify(languageConfigs), configsBefore);
const explicitZeroSpacing = resolveFlowDomTypography('ja', {
    letterSpacing: 0,
    paragraphSpacing: 0,
}, 'vertical-rl');
assert.equal(explicitZeroSpacing.letterSpacing, 0);
assert.equal(explicitZeroSpacing.paragraphSpacing, 0);
assert.equal(explicitZeroSpacing.lineHeight, 1.625);

for (const overrides of [{ fontSize: 0 }, { lineHeight: 0 }, { paragraphSpacing: -1 }, { letterSpacing: NaN }]) {
    assert.throws(
        () => resolveFlowDomTypography('ja', overrides, 'vertical-rl', { languageConfigs }),
        (error) => error instanceof FlowDomMeasurementError && error.code === 'INVALID_TYPOGRAPHY',
    );
}

// Contract-only DOM: glyph rotation/ink centers still need the browser fixture.
// Exercise the actual shared renderer, including a reused vertical/horizontal
// content node. No character conversion or extra per-character spans is allowed:
// direct editing and Press source ranges must still point into the original text.
const ownerDocument = {
    createElement(tagName) {
        return {
            ownerDocument, tagName, style: {}, dataset: {}, children: [],
            replaceChildren() { this.children = []; },
            appendChild(child) { this.children.push(child); },
        };
    },
};
const punctuation = '前…後\n前……後\n前...後\n「あいう」ー、。！？';
const punctuationFragment = {
    sectionId: 'section-ellipsis', blockId: 'paragraph-ellipsis', blockType: 'paragraph',
    languageKey: 'ja', text: punctuation,
    sourceRange: { start: 0, end: punctuation.length, startGrapheme: 0, endGrapheme: [...punctuation].length },
    isBlockStart: true, isBlockEnd: true,
};
deepFreeze(punctuationFragment);
assert.equal(FLOW_DOM_RENDERER_VERSION, 8, 'invalidate pre-whitespace-contract measurement and publication evidence');
const reusedContent = ownerDocument.createElement('div');
reusedContent.style.fontFeatureSettings = '"vert" 1, "vkna" 1';
for (const mode of ['vertical-rl', 'horizontal-tb', 'vertical-rl']) {
    for (const fontPreset of ['gothic', 'mincho']) {
        for (const blockType of ['paragraph', 'heading']) {
            const typography = resolveFlowDomTypography('ja', {}, mode, {
                languageConfigs: { ja: { fontPreset } },
            });
            const fragments = [{ ...punctuationFragment, blockType, headingLevel: 1 }];
            const options = { fragments, pageBox, typography, writingMode: mode, languageKey: 'ja', hyphenation: 'none' };
            renderFlowFragments(reusedContent, options);
            const visibleContent = renderFlowGeneratedPage(ownerDocument.createElement('div'), {
                ...options, page: { fragments },
            });
            for (const content of [reusedContent, visibleContent]) {
                assert.equal(content.style.fontFeatureSettings, 'normal', 'browser controls vertical substitution per orientation');
                assert.equal(content.style.textOrientation, mode === 'vertical-rl' ? 'mixed' : '');
                assert.equal(content.style.writingMode, mode);
                assert.equal(content.children.length, 1);
                assert.equal(content.children[0].textContent, punctuation);
                assert.equal(content.children[0].dataset.sourceEnd, String(punctuation.length));
                assert.equal(content.children[0].style.fontWeight, blockType === 'heading' ? '700' : '400');
            }
        }
    }
}
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.equal((appSource.match(/fontFeatureSettings: sourceStyle\?\.fontFeatureSettings \|\| 'normal'/g) || []).length, 2,
    'IME proxy and visible composition must inherit the source feature settings with a normal fallback');

console.log('Flow/text-page typography defaults, language settings, and source preservation verification passed.');
