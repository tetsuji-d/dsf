import assert from 'node:assert/strict';

import {
    createFixedTextPressPreviewBundle,
    getFixedTextPressPreviewFallbackMessage,
    prepareFixedTextPressPreview,
} from '../js/fixed-text-press-preview.js';
import { validateDsfDeliveryBundle } from '../js/dsf-delivery-v2.js';
import { getFixedTextPressPreviewFontFixture } from '../js/fixtures/fixed-text-press-preview-fixture.js';

function createBlock(text = '冬の金沢は静かだった。', overrides = {}) {
    return {
        id: 'fixed_press_text_1',
        kind: 'page',
        content: {
            pageKind: 'text',
            texts: { ja: text },
            textAlign: 'start',
            backgroundColor: '#f7f1df',
            textColor: '#1f1b16',
            bubbles: [],
            interactions: [],
            ...overrides,
        },
    };
}

function createSection(block) {
    return {
        type: 'text',
        texts: { ...block.content.texts },
        textAlign: block.content.textAlign,
        backgroundColor: block.content.backgroundColor,
        textColor: block.content.textColor,
        bubbles: [],
    };
}

function createComposition(overrides = {}) {
    return {
        version: 2,
        writingMode: 'horizontal-tb',
        frame: { x: 20, y: 20, w: 320, h: 600 },
        font: {
            family: "'Noto Sans JP','Hiragino Sans',sans-serif",
            size: 16,
            lineHeight: 1.8,
            letterSpacing: 0,
        },
        rules: { maxLines: 20, charsPerLine: 32 },
        lines: ['冬の金沢は静かだった。'],
        overflow: false,
        overflowText: '',
        ...overrides,
    };
}

function createFontFaceSet({ available = true } = {}) {
    return {
        ready: Promise.resolve(),
        loadCalls: [],
        async load(descriptor, sample) {
            this.loadCalls.push([descriptor, sample]);
            return available ? [{}] : [];
        },
        check() {
            return available;
        },
    };
}

assert.equal(getFixedTextPressPreviewFontFixture("'Noto Sans JP',sans-serif").id, 'fixture-press-noto-sans-jp');
assert.equal(getFixedTextPressPreviewFontFixture("'Noto Serif',serif").id, 'fixture-press-noto-serif');
assert.equal(getFixedTextPressPreviewFontFixture("'Yu Gothic UI',sans-serif"), null);

const block = createBlock();
const section = createSection(block);
const fontFaceSet = createFontFaceSet();
let composeCount = 0;
const success = await prepareFixedTextPressPreview({
    block,
    section,
    language: 'ja',
    pageId: 'press-preview:fixed_press_text_1:ja',
    pageLabel: '1',
    languageConfigs: { ja: { writingMode: 'horizontal-tb', pageDirection: 'ltr' } },
    documentRef: { fonts: fontFaceSet },
    composePreview(currentSection, language) {
        composeCount += 1;
        return {
            raw: currentSection.texts[language],
            composed: createComposition(),
        };
    },
});
assert.equal(success.ok, true);
assert.equal(success.renderKind, 'fixedText');
assert.equal(composeCount, 2, 'composition must run again after the fixture font is ready');
assert.equal(fontFaceSet.loadCalls.length, 2, 'preview preparation and Viewer context must both gate the font');
assert.equal(success.page.sourceAnchor.blockId, block.id);
assert.equal(success.page.pageLabel, '1');
assert.equal(success.page.lines[0].runs[0].text, '冬の金沢は静かだった。');
assert.equal(Object.isFrozen(success.context), true);
assert.equal(validateDsfDeliveryBundle(success.bundle).valid, true);

const rebuiltBundle = createFixedTextPressPreviewBundle({ projection: success, pageDirection: 'rtl' });
assert.equal(rebuiltBundle.index.languages.ja.pageDirection, 'rtl');
assert.equal(validateDsfDeliveryBundle(rebuiltBundle).valid, true);

const unavailableFont = await prepareFixedTextPressPreview({
    block,
    section,
    language: 'ja',
    pageId: 'press-preview:font-unavailable:ja',
    documentRef: { fonts: createFontFaceSet({ available: false }) },
    composePreview() {
        return { raw: section.texts.ja, composed: createComposition() };
    },
});
assert.equal(unavailableFont.ok, false);
assert.equal(unavailableFont.fallback.code, 'FIXED_TEXT_PREVIEW_FONT_UNAVAILABLE');

const unsupportedFont = await prepareFixedTextPressPreview({
    block,
    section,
    language: 'ja',
    pageId: 'press-preview:unsupported-font:ja',
    documentRef: { fonts: createFontFaceSet() },
    composePreview() {
        return {
            raw: section.texts.ja,
            composed: createComposition({
                font: { family: "'Yu Gothic UI',sans-serif", size: 16, lineHeight: 1.8, letterSpacing: 0 },
            }),
        };
    },
});
assert.equal(unsupportedFont.ok, false);
assert.equal(unsupportedFont.fallback.code, 'FONT_NOT_CERTIFIED');

const rubyBlock = createBlock('今日は{漢字|かんじ}。');
const rubySection = createSection(rubyBlock);
const ruby = await prepareFixedTextPressPreview({
    block: rubyBlock,
    section: rubySection,
    language: 'ja',
    pageId: 'press-preview:ruby:ja',
    documentRef: { fonts: createFontFaceSet() },
    composePreview() {
        return {
            raw: rubySection.texts.ja,
            composed: createComposition({ lines: ['今日は漢字。'] }),
        };
    },
});
assert.equal(ruby.ok, false);
assert.equal(ruby.fallback.code, 'RUBY_UNSUPPORTED');
assert.match(getFixedTextPressPreviewFallbackMessage(ruby), /ルビ/);

const centeredBlock = createBlock('Centered', { textAlign: 'center' });
const centered = await prepareFixedTextPressPreview({
    block: centeredBlock,
    section: createSection(centeredBlock),
    language: 'ja',
    pageId: 'press-preview:centered:ja',
    documentRef: { fonts: createFontFaceSet() },
    composePreview() {
        return { raw: 'Centered', composed: createComposition({ lines: ['Centered'] }) };
    },
});
assert.equal(centered.ok, false);
assert.equal(centered.fallback.code, 'HORIZONTAL_ALIGNMENT_METRICS_REQUIRED');
assert.match(getFixedTextPressPreviewFallbackMessage(centered), /中央／末尾揃え/);

console.log('fixed text Press preview verification passed');
