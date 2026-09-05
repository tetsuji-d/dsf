import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DsfDeliveryValidationError } from '../js/dsf-delivery-v2.js';
import {
    DSF_FIXED_TEXT_THUMBNAIL_HEIGHT,
    DSF_FIXED_TEXT_THUMBNAIL_WIDTH,
    DsfFixedTextThumbnailError,
    createDsfFixedTextThumbnailDrawPlan,
    drawDsfFixedTextThumbnailPlan,
    renderDsfFixedTextThumbnailWebP,
} from '../js/dsf-fixed-text-thumbnail-renderer.js';
import { createDsfDeliveryV2ViewerFixture } from '../js/fixtures/dsf-delivery-v2-viewer-fixture.js';

function clone(value) {
    return structuredClone(value);
}

class FakeContext {
    constructor(canvas = null) {
        this.canvas = canvas;
        this.calls = [];
        this.fillStyle = '';
        this.strokeStyle = '';
        this.lineWidth = 1;
        this.font = '';
        this.textAlign = '';
        this.textBaseline = '';
        this.fontKerning = 'auto';
        this.letterSpacing = '0px';
    }

    save() { this.calls.push(['save']); }
    restore() { this.calls.push(['restore']); }
    scale(...args) { this.calls.push(['scale', ...args]); }
    fillRect(...args) { this.calls.push(['fillRect', this.fillStyle, ...args]); }
    drawImage(...args) { this.calls.push(['drawImage', ...args]); }
    beginPath() { this.calls.push(['beginPath']); }
    rect(...args) { this.calls.push(['rect', ...args]); }
    clip() { this.calls.push(['clip']); }
    translate(...args) { this.calls.push(['translate', ...args]); }
    rotate(...args) { this.calls.push(['rotate', ...args]); }
    moveTo(...args) { this.calls.push(['moveTo', ...args]); }
    lineTo(...args) { this.calls.push(['lineTo', ...args]); }
    stroke() { this.calls.push(['stroke']); }
    fillText(...args) { this.calls.push(['fillText', this.font, this.fillStyle, ...args]); }
    measureText(text) {
        const graphemeCount = [...text].length;
        const spacing = Number.parseFloat(this.letterSpacing) || 0;
        return { width: (graphemeCount * 8) + (Math.max(0, graphemeCount - 1) * spacing) };
    }
}

class FakeCanvas {
    constructor() {
        this.width = 0;
        this.height = 0;
        this.context = new FakeContext(this);
    }

    getContext(kind) {
        return kind === '2d' ? this.context : null;
    }
}

class FakeFontFaceSet {
    constructor({ available = true } = {}) {
        this.available = available;
        this.loads = [];
    }

    async load(descriptor, sample) {
        this.loads.push({ descriptor, sample });
        return this.available ? [{}] : [];
    }

    check() { return this.available; }
}

const bundle = createDsfDeliveryV2ViewerFixture();
const before = JSON.stringify(bundle);
const manifest = bundle.manifests.ja;
const horizontalPage = manifest.pages.find((page) => page.id === 'fixture-horizontal');
const horizontalPlan = createDsfFixedTextThumbnailDrawPlan({
    index: bundle.index,
    manifest,
    page: horizontalPage,
});

assert.equal(JSON.stringify(bundle), before, 'thumbnail planning cannot mutate DSF delivery data');
assert.equal(Object.isFrozen(horizontalPlan), true);
assert.equal(Object.isFrozen(horizontalPlan.lines[0].runs[0].style), true);
assert.equal(horizontalPlan.width, DSF_FIXED_TEXT_THUMBNAIL_WIDTH);
assert.equal(horizontalPlan.height, DSF_FIXED_TEXT_THUMBNAIL_HEIGHT);
assert.equal(horizontalPlan.sourceWidth, 360);
assert.equal(horizontalPlan.sourceHeight, 640);
assert.equal(horizontalPlan.scale, 2);
assert.equal(horizontalPlan.background.color, '#fffaf0');
assert.equal(horizontalPlan.lines[0].writingMode, 'horizontal-tb');
assert.equal(horizontalPlan.lines[0].runs[0].style.fontFamily, 'Noto Serif JP');
assert.equal(horizontalPlan.lines[4].runs[0].style.styleRef, 'emphasis', 'run styles override line styles');
assert.equal(horizontalPlan.fonts.some((font) => font.fontWeight === 700), true);

const runtimeFontFamily = 'DSFFont_fixture_noto_serif_jp';
const runtimeFontPlan = createDsfFixedTextThumbnailDrawPlan({
    index: bundle.index,
    manifest,
    page: horizontalPage,
    fontFamiliesByRef: { 'fixture-noto-serif-jp': runtimeFontFamily },
});
assert.equal(runtimeFontPlan.lines[0].style.fontFamily, runtimeFontFamily);
assert.equal(runtimeFontPlan.lines.every((line) => line.runs.every(
    (run) => run.style.fontFamily === runtimeFontFamily,
)), true, 'runtime font family overrides apply to line and run styles');
assert.equal(runtimeFontPlan.fonts.every((font) => font.fontFamily === runtimeFontFamily), true,
    'font loading uses the runtime family registered for the certified fontRef');
assert.equal(bundle.index.fonts['fixture-noto-serif-jp'].family, 'Noto Serif JP',
    'runtime aliases cannot mutate the certified delivery declaration');
assert.throws(
    () => createDsfFixedTextThumbnailDrawPlan({
        index: bundle.index,
        manifest,
        page: horizontalPage,
        fontFamiliesByRef: { 'fixture-noto-serif-jp': '   ' },
    }),
    (error) => error instanceof DsfFixedTextThumbnailError
        && error.code === 'THUMBNAIL_FONT_FAMILY_OVERRIDE_INVALID',
);

const keywordWeightBundle = clone(bundle);
keywordWeightBundle.manifests.ja.styles.body.fontWeight = 'normal';
keywordWeightBundle.manifests.ja.styles.heading.fontWeight = 'bold';
keywordWeightBundle.manifests.ja.styles.emphasis.fontWeight = 'bold';
const keywordWeightManifest = keywordWeightBundle.manifests.ja;
const keywordWeightPlan = createDsfFixedTextThumbnailDrawPlan({
    index: keywordWeightBundle.index,
    manifest: keywordWeightManifest,
    page: keywordWeightManifest.pages.find((page) => page.id === 'fixture-horizontal'),
});
assert.equal(keywordWeightPlan.lines[0].style.fontWeight, 700, 'bold normalizes to numeric 700');
assert.equal(keywordWeightPlan.lines[1].style.fontWeight, 400, 'normal normalizes to numeric 400');
assert.equal(keywordWeightPlan.fonts.every((font) => Number.isInteger(font.fontWeight)), true,
    'font descriptors contain normalized numeric weights only');

const horizontalContext = new FakeContext();
drawDsfFixedTextThumbnailPlan({ context: horizontalContext, plan: horizontalPlan });
assert.deepEqual(horizontalContext.calls.find((call) => call[0] === 'scale'), ['scale', 2, 2]);
assert.deepEqual(horizontalContext.calls.find((call) => call[0] === 'fillRect'), [
    'fillRect', '#fffaf0', 0, 0, 360, 640,
]);
assert.equal(horizontalContext.calls.some((call) => call[0] === 'rect'
    && call.slice(1).join(',') === '28,42,304,40'), true, 'captured line geometry is used without reflow');
assert.equal(horizontalContext.calls.filter((call) => call[0] === 'fillText')
    .map((call) => call[3]).join('').includes('第一章'), true);
assert.equal(horizontalContext.calls.some((call) => call[0] === 'fillText'
    && call[3] === horizontalPlan.lines[0].runs[0].text), true,
    'horizontal text is drawn as a complete run so kerning and ligatures are preserved');
assert.equal(horizontalContext.calls.some((call) => call[0] === 'fillText'
    && call[1].includes('700') && call[2] === '#7c2d12'), true, 'run color and weight are applied');

const verticalBundle = clone(bundle);
const verticalManifest = verticalBundle.manifests.ja;
const verticalPage = verticalManifest.pages.find((page) => page.id === 'fixture-vertical');
verticalPage.lines[0].runs[0].text = 'A…。「ー」縦';
verticalPage.lines[0].runs[0].source.endGrapheme = 7;
const verticalPlan = createDsfFixedTextThumbnailDrawPlan({
    index: verticalBundle.index,
    manifest: verticalManifest,
    page: verticalPage,
});
assert.equal(verticalPlan.lines[0].writingMode, 'vertical-rl');
const verticalContext = new FakeContext();
drawDsfFixedTextThumbnailPlan({ context: verticalContext, plan: verticalPlan });
assert.equal(verticalContext.calls.some((call) => call[0] === 'rotate' && call[1] === Math.PI / 2), true,
    'mixed narrow Latin text rotates within vertical-rl');
assert.equal(verticalContext.calls.some((call) => call[0] === 'fillText' && call[3] === '縦'), true,
    'upright CJK text is drawn in vertical-rl');
const verticalDrawnText = verticalContext.calls
    .filter((call) => call[0] === 'fillText')
    .map((call) => call[3]);
assert.equal(verticalDrawnText.includes('︙'), true, 'three-dot leader uses its vertical glyph');
assert.equal(verticalDrawnText.includes('︒'), true, 'Japanese full stop uses its vertical glyph');
assert.equal(verticalDrawnText.includes('﹁'), true, 'opening corner bracket uses its vertical glyph');
assert.equal(verticalDrawnText.includes('︱'), true, 'prolonged sound mark uses its vertical glyph');
assert.equal(verticalDrawnText.includes('﹂'), true, 'closing corner bracket uses its vertical glyph');

const imageBackgroundBundle = clone(bundle);
const imageBackgroundManifest = imageBackgroundBundle.manifests.ja;
const imageBackgroundPage = imageBackgroundManifest.pages.find((page) => page.id === 'fixture-horizontal');
imageBackgroundPage.background.imageHref = 'assets/fixed-text-background.webp';
const imageBackgroundPlan = createDsfFixedTextThumbnailDrawPlan({
    index: imageBackgroundBundle.index,
    manifest: imageBackgroundManifest,
    page: imageBackgroundPage,
});
assert.throws(
    () => drawDsfFixedTextThumbnailPlan({ context: new FakeContext(), plan: imageBackgroundPlan }),
    (error) => error instanceof DsfFixedTextThumbnailError
        && error.code === 'THUMBNAIL_BACKGROUND_IMAGE_REQUIRED',
);
const imageContext = new FakeContext();
drawDsfFixedTextThumbnailPlan({
    context: imageContext,
    plan: imageBackgroundPlan,
    backgroundImage: { naturalWidth: 1600, naturalHeight: 900 },
});
const imageCall = imageContext.calls.find((call) => call[0] === 'drawImage');
assert.equal(imageCall.length, 10);
assert.equal(imageCall[2] > 0, true, 'object-fit cover crops a landscape background from its center');
assert.deepEqual(imageCall.slice(-4), [0, 0, 360, 640]);

const tamperedPage = clone(horizontalPage);
tamperedPage.lines[0].runs[0].text = 'tampered';
assert.throws(
    () => createDsfFixedTextThumbnailDrawPlan({ index: bundle.index, manifest, page: tamperedPage }),
    (error) => error instanceof DsfFixedTextThumbnailError && error.code === 'THUMBNAIL_PAGE_NOT_VALIDATED',
);
const imagePage = manifest.pages.find((page) => page.renderKind === 'image');
assert.throws(
    () => createDsfFixedTextThumbnailDrawPlan({ index: bundle.index, manifest, page: imagePage }),
    (error) => error instanceof DsfFixedTextThumbnailError
        && error.code === 'THUMBNAIL_FIXED_TEXT_PAGE_REQUIRED',
);
const badFont = clone(bundle);
badFont.index.fonts['fixture-noto-serif-jp'].family = '';
assert.throws(
    () => createDsfFixedTextThumbnailDrawPlan({
        index: badFont.index,
        manifest: badFont.manifests.ja,
        page: badFont.manifests.ja.pages.find((page) => page.id === 'fixture-horizontal'),
    }),
    DsfDeliveryValidationError,
);
const badStyle = clone(bundle);
badStyle.manifests.ja.pages[1].lines[0].styleRef = 'missing';
assert.throws(
    () => createDsfFixedTextThumbnailDrawPlan({
        index: badStyle.index,
        manifest: badStyle.manifests.ja,
        page: badStyle.manifests.ja.pages[1],
    }),
    DsfDeliveryValidationError,
);

const renderCanvas = new FakeCanvas();
const fontFaceSet = new FakeFontFaceSet();
let encodedCanvas = null;
const rendered = await renderDsfFixedTextThumbnailWebP({
    index: bundle.index,
    manifest,
    page: horizontalPage,
    fontFamiliesByRef: { 'fixture-noto-serif-jp': runtimeFontFamily },
    createCanvas: () => renderCanvas,
    fontFaceSet,
    encodeWebP: async (canvas) => {
        encodedCanvas = canvas;
        return new Blob(['webp'], { type: 'image/webp' });
    },
});
assert.equal(rendered.type, 'image/webp');
assert.equal(rendered.size, 4);
assert.equal(encodedCanvas, renderCanvas);
assert.equal(renderCanvas.width, 720);
assert.equal(renderCanvas.height, 1280);
assert.equal(fontFaceSet.loads.length, horizontalPlan.fonts.length);
assert.equal(fontFaceSet.loads.every((entry) => entry.descriptor.includes(runtimeFontFamily)), true,
    'the renderer waits for the runtime-registered family rather than the delivery display family');

await assert.rejects(
    renderDsfFixedTextThumbnailWebP({
        index: bundle.index,
        manifest,
        page: horizontalPage,
        createCanvas: () => new FakeCanvas(),
        fontFaceSet: new FakeFontFaceSet({ available: false }),
        encodeWebP: async () => new Blob(['webp'], { type: 'image/webp' }),
    }),
    (error) => error instanceof DsfFixedTextThumbnailError && error.code === 'THUMBNAIL_FONT_UNAVAILABLE',
);
await assert.rejects(
    renderDsfFixedTextThumbnailWebP({
        index: bundle.index,
        manifest,
        page: horizontalPage,
        createCanvas: () => new FakeCanvas(),
        fontFaceSet: new FakeFontFaceSet(),
        encodeWebP: async () => new Blob(['png'], { type: 'image/png' }),
    }),
    (error) => error instanceof DsfFixedTextThumbnailError && error.code === 'THUMBNAIL_WEBP_ENCODING_FAILED',
);

const source = readFileSync(new URL('../js/dsf-fixed-text-thumbnail-renderer.js', import.meta.url), 'utf8');
assert.equal(source.includes('.innerHTML'), false);
assert.equal(source.includes('insertAdjacentHTML'), false);
assert.equal(source.includes('eval('), false);
assert.equal(source.includes('./press'), false);
assert.equal(source.includes('./firebase'), false);
assert.match(source, /validateDsfDeliveryIndex/);
assert.match(source, /validateDsfLanguageManifest/);
assert.match(source, /context\.scale\(plan\.scale, plan\.scale\)/);

console.log('DSF fixed-text thumbnail renderer verification passed.');
