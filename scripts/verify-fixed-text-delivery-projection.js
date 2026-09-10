import assert from 'node:assert/strict';

import {
    FIXED_TEXT_PROJECTION_VERSION,
    projectFixedTextBlockToDsfV2,
} from '../js/fixed-text-delivery-projection.js';
import { validateDsfLanguageManifest } from '../js/dsf-delivery-v2.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const certifiedSans = Object.freeze({
    id: 'dsf-noto-sans-ja-v1',
    declaration: Object.freeze({
        family: 'Noto Sans JP',
        version: '1.0.0',
        source: 'registry',
        href: 'https://assets.example.test/fonts/noto-sans-jp-v1.woff2',
        sha256: '1'.repeat(64),
    }),
});

function createBlock(overrides = {}) {
    return {
        id: 'fixed_text_1',
        kind: 'page',
        content: {
            pageKind: 'text',
            text: 'Fallback text',
            texts: { ja: '冬の金沢は静かだった。' },
            textAlign: 'start',
            backgroundColor: '#f7f1df',
            textColor: '#1f1b16',
            bubbles: [],
            interactions: [],
            ...overrides,
        },
    };
}

function createHorizontalComposition(overrides = {}) {
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
        lines: ['冬の金沢は', '静かだった。'],
        overflow: false,
        overflowText: '',
        ...overrides,
    };
}

function createVerticalComposition(overrides = {}) {
    return {
        version: 2,
        writingMode: 'vertical-rl',
        frame: { x: 20, y: 20, w: 320, h: 600 },
        font: {
            family: "'Noto Sans JP','Hiragino Sans',sans-serif",
            size: 16,
            lineHeight: 1.8,
            letterSpacing: 0,
        },
        rules: { maxLines: 12, charsPerLine: 33 },
        lines: ['冬の金沢は', '静かだった。'],
        overflow: false,
        overflowText: '',
        ...overrides,
    };
}

function project(overrides = {}) {
    const block = overrides.block || createBlock();
    const certifiedFont = overrides.certifiedFont === undefined ? certifiedSans : overrides.certifiedFont;
    return projectFixedTextBlockToDsfV2({
        block,
        language: 'ja',
        pageId: 'fixed-text-ja-0001',
        compositionEvidence: {
            sourceText: block.content?.texts?.ja ?? block.content?.text ?? '',
            layoutVersion: 2,
            fontId: certifiedFont?.id,
            fontSha256: certifiedFont?.declaration?.sha256,
        },
        composition: createHorizontalComposition(),
        certifiedFont,
        ...overrides,
    });
}

const horizontalBlock = createBlock({
    texts: { ja: '冬の金沢は静かだった。' },
});
const horizontalComposition = createHorizontalComposition();
const horizontalInput = {
    block: horizontalBlock,
    language: 'ja',
    pageId: 'fixed-text-ja-0001',
    pageLabel: '1',
    compositionEvidence: {
        sourceText: horizontalBlock.content.texts.ja,
        layoutVersion: 2,
        fontId: certifiedSans.id,
        fontSha256: certifiedSans.declaration.sha256,
    },
    composition: horizontalComposition,
    certifiedFont: certifiedSans,
};
const horizontalInputBefore = clone(horizontalInput);
const horizontal = projectFixedTextBlockToDsfV2(horizontalInput);
assert.equal(horizontal.ok, true);
assert.equal(horizontal.projectionVersion, FIXED_TEXT_PROJECTION_VERSION);
assert.equal(horizontal.renderKind, 'fixedText');
assert.deepEqual(horizontalInput, horizontalInputBefore, 'projection must not mutate authoring or composition input');
assert.equal(horizontal.font.id, certifiedSans.id);
assert.notEqual(horizontal.font.declaration, certifiedSans.declaration, 'font declaration must be copied');
assert.equal(horizontal.manifest.language, 'ja');
assert.equal(horizontal.manifest.pages[0].sourceAnchor.blockId, horizontalBlock.id);
assert.equal(horizontal.manifest.pages[0].pageLabel, '1');
assert.equal(horizontal.manifest.pages[0].background.color, '#f7f1df');
assert.deepEqual(horizontal.manifest.pages[0].lines[0], {
    x: 20,
    y: 20,
    width: 320,
    height: 30,
    writingMode: 'horizontal-tb',
    textOrientation: 'mixed',
    styleRef: 'body',
    runs: [{ text: '冬の金沢は' }],
});
assert.equal(horizontal.manifest.pages[0].lines[1].y, 50);
assert.equal(horizontal.manifest.styles.body.fontRef, certifiedSans.id);
assert.equal(horizontal.manifest.styles.body.lineHeight, 1.875);
assert.equal(horizontal.manifest.styles.body.textAlign, 'start');
assert.equal(validateDsfLanguageManifest(horizontal.manifest, {
    expectedLanguage: 'ja',
    expectedPageCount: 1,
    fontIds: new Set([certifiedSans.id]),
}).valid, true);

const verticalBlock = createBlock({
    texts: { ja: '冬の金沢は静かだった。' },
    textAlign: 'start',
});
const vertical = project({
    block: verticalBlock,
    compositionEvidence: {
        sourceText: verticalBlock.content.texts.ja,
        layoutVersion: 2,
        fontId: certifiedSans.id,
        fontSha256: certifiedSans.declaration.sha256,
    },
    composition: createVerticalComposition(),
});
assert.equal(vertical.ok, true);
assert.deepEqual(vertical.manifest.pages[0].lines.map((line) => line.x), [314, 288]);
assert.equal(vertical.manifest.pages[0].lines[0].width, 26);
assert.equal(vertical.manifest.pages[0].lines[0].height, 600);
assert.equal(vertical.manifest.pages[0].lines[1].runs[0].text, '静かだった︒');
assert.equal(vertical.manifest.styles.body.lineHeight, 26 / 16);
assert.equal(vertical.manifest.styles.body.letterSpacing, (600 / 33) - 16);

const verticalCenteredBlock = createBlock({
    texts: { ja: '冬の金沢は静かだった。' },
    textAlign: 'center',
});
const verticalCentered = project({
    block: verticalCenteredBlock,
    compositionEvidence: {
        sourceText: verticalCenteredBlock.content.texts.ja,
        layoutVersion: 2,
        fontId: certifiedSans.id,
        fontSha256: certifiedSans.declaration.sha256,
    },
    composition: createVerticalComposition(),
});
assert.equal(verticalCentered.ok, true);
assert.deepEqual(verticalCentered.manifest.pages[0].lines.map((line) => line.x), [180, 154]);

const literalMarkupBlock = createBlock({ texts: { ja: '<script>alert(1)</script>' } });
const literalMarkup = project({
    block: literalMarkupBlock,
    compositionEvidence: {
        sourceText: literalMarkupBlock.content.texts.ja,
        layoutVersion: 2,
        fontId: certifiedSans.id,
        fontSha256: certifiedSans.declaration.sha256,
    },
    composition: createHorizontalComposition({ lines: ['<script>alert(1)</script>'] }),
});
assert.equal(literalMarkup.ok, true);
assert.equal(literalMarkup.manifest.pages[0].lines[0].runs[0].text, '<script>alert(1)</script>');

const fallbackCases = [
    {
        label: 'non text block',
        expected: 'NOT_FIXED_TEXT_PAGE',
        input: { block: { id: 'image', kind: 'page', content: { pageKind: 'image' } } },
    },
    {
        label: 'ruby',
        expected: 'RUBY_UNSUPPORTED',
        input: { block: createBlock({ texts: { ja: '今日は｛漢字｜かんじ｝。' } }) },
    },
    {
        label: 'graphic objects',
        expected: 'FIXED_TEXT_OVERLAY_UNSUPPORTED',
        input: { block: createBlock({ graphicObjects: [{ id: 'graphic_1', kind: 'shape' }] }) },
    },
    {
        label: 'overlay',
        expected: 'FIXED_TEXT_OVERLAY_UNSUPPORTED',
        input: { block: createBlock({ layers: [{ id: 'layer_1' }] }) },
    },
    {
        label: 'stale source',
        expected: 'FIXED_TEXT_COMPOSITION_SOURCE_UNVERIFIED',
        input: {
            compositionEvidence: {
                sourceText: '古い本文',
                layoutVersion: 2,
                fontId: certifiedSans.id,
                fontSha256: certifiedSans.declaration.sha256,
            },
        },
    },
    {
        label: 'unsupported layout version',
        expected: 'FIXED_TEXT_COMPOSITION_INVALID',
        input: { composition: createHorizontalComposition({ version: 99 }) },
    },
    {
        label: 'overflow',
        expected: 'FIXED_TEXT_OVERFLOW',
        input: { composition: createHorizontalComposition({ overflow: true, overflowText: '続き' }) },
    },
    {
        label: 'horizontal alignment',
        expected: 'HORIZONTAL_ALIGNMENT_METRICS_REQUIRED',
        input: { block: createBlock({ textAlign: 'center' }) },
    },
    {
        label: 'tate chu yoko',
        expected: 'TATE_CHU_YOKO_UNSUPPORTED',
        input: { composition: createVerticalComposition({ lines: ['2026年'] }) },
    },
    {
        label: 'missing certificate',
        expected: 'FONT_NOT_CERTIFIED',
        input: { certifiedFont: null },
    },
    {
        label: 'unverified composition font',
        expected: 'FIXED_TEXT_COMPOSITION_FONT_UNVERIFIED',
        input: {
            compositionEvidence: {
                sourceText: '冬の金沢は静かだった。',
                layoutVersion: 2,
                fontId: certifiedSans.id,
                fontSha256: '2'.repeat(64),
            },
        },
    },
    {
        label: 'certificate family mismatch',
        expected: 'FONT_COMPOSITION_MISMATCH',
        input: {
            certifiedFont: {
                ...certifiedSans,
                declaration: { ...certifiedSans.declaration, family: 'Different Font' },
            },
        },
    },
    {
        label: 'invalid certificate declaration',
        expected: 'FIXED_TEXT_PROJECTION_INVALID',
        input: {
            certifiedFont: {
                ...certifiedSans,
                declaration: { ...certifiedSans.declaration, href: 'http://unsafe.example.test/font.woff2' },
            },
        },
    },
    {
        label: 'invalid color',
        expected: 'FIXED_TEXT_PROJECTION_INVALID',
        input: { block: createBlock({ textColor: 'red' }) },
    },
];

for (const testCase of fallbackCases) {
    const baseBlock = testCase.input.block || createBlock();
    const result = project({
        block: baseBlock,
        ...testCase.input,
    });
    assert.equal(result.ok, false, `${testCase.label} must use the image path`);
    assert.equal(result.renderKind, 'image', `${testCase.label} must identify the existing image path`);
    assert.equal(result.fallback.code, testCase.expected, testCase.label);
}

console.log('fixed text delivery projection verification passed');
