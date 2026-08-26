import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DsfDeliveryValidationError } from '../js/dsf-delivery-v2.js';
import {
    DsfViewerFixedTextError,
    createDsfFixedTextPageElement,
    createDsfViewerPageContentElement,
    getDsfViewerPageRenderKind,
    prepareDsfViewerFixedTextContext,
} from '../js/viewer-fixed-text.js';
import {
    DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
    createDsfDeliveryV2ViewerFixture,
} from '../js/fixtures/dsf-delivery-v2-viewer-fixture.js';

class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.attributes = new Map();
        this.className = '';
        this.textContent = '';
        this.src = '';
        this.alt = '';
        this.loading = '';
        this.draggable = true;
    }

    append(...children) {
        this.children.push(...children);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }
}

class FakeDocument {
    constructor() {
        this.created = [];
    }

    createElement(tagName) {
        const element = new FakeElement(tagName);
        this.created.push(element);
        return element;
    }
}

class FakeFontFaceSet {
    constructor({ available = true, reject = false } = {}) {
        this.available = available;
        this.reject = reject;
        this.loads = [];
    }

    async load(descriptor, sample) {
        this.loads.push({ descriptor, sample });
        if (this.reject) throw new Error('network unavailable');
        return this.available ? [{}] : [];
    }

    check() {
        return this.available;
    }
}

function clone(value) {
    return structuredClone(value);
}

const bundle = createDsfDeliveryV2ViewerFixture();
const bundleBefore = JSON.stringify(bundle);
const fontFaceSet = new FakeFontFaceSet();
const context = await prepareDsfViewerFixedTextContext({
    bundle,
    language: 'ja',
    certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
    fontFaceSet,
});

assert.equal(JSON.stringify(bundle), bundleBefore, 'Viewer preparation cannot mutate the fixture bundle');
assert.equal(Object.isFrozen(context), true);
assert.equal(Object.isFrozen(context.index), true);
assert.equal(Object.isFrozen(context.manifest), true);
assert.deepEqual(context.certifiedFontRefs, ['fixture-noto-serif-jp']);
assert.equal(fontFaceSet.loads.length, 1);
assert.match(fontFaceSet.loads[0].descriptor, /Noto Serif JP/);

const documentRef = new FakeDocument();
const horizontalPage = context.manifest.pages.find((page) => page.id === 'fixture-horizontal');
const horizontal = createDsfFixedTextPageElement({ documentRef, page: horizontalPage, context });
assert.equal(horizontal.className, 'viewer-fixed-text-page');
assert.equal(horizontal.style.width, '360px');
assert.equal(horizontal.style.height, '640px');
assert.equal(horizontal.style.backgroundColor, '#fffaf0');
assert.equal(horizontal.dataset.wrapping, 'forbidden');
assert.equal(horizontal.getAttribute('lang'), 'ja');
assert.equal(horizontal.children.length, horizontalPage.lines.length);
assert.equal(horizontal.children[0].style.left, '28px');
assert.equal(horizontal.children[0].style.top, '42px');
assert.equal(horizontal.children[0].style.fontFamily, '"Noto Serif JP"');
assert.equal(horizontal.children[0].children[0].textContent, '第一章　冬の金沢');

const verticalPage = context.manifest.pages.find((page) => page.id === 'fixture-vertical');
const vertical = createDsfFixedTextPageElement({ documentRef, page: verticalPage, context });
assert.equal(vertical.children[0].style.writingMode, 'vertical-rl');
assert.equal(vertical.children[0].style.textOrientation, 'mixed');
assert.equal(vertical.children.at(-1).style.textOrientation, 'upright');

const literalPage = context.manifest.pages.find((page) => page.id === 'fixture-literal-text');
const literal = createDsfFixedTextPageElement({ documentRef, page: literalPage, context });
const literalRun = literal.children[2].children[0];
assert.equal(literalRun.textContent, '<script>alert("実行されない")</script>');
assert.equal(literalRun.children.length, 0, 'DSF strings must never create child elements');
assert.equal(documentRef.created.some((element) => element.tagName === 'SCRIPT'), false);

assert.equal(getDsfViewerPageRenderKind({}), 'legacyImage');
assert.equal(getDsfViewerPageRenderKind({ deliveryV2: { renderKind: 'image' } }), 'image');
assert.equal(getDsfViewerPageRenderKind({ deliveryV2: { renderKind: 'fixedText' } }), 'fixedText');
assert.equal(getDsfViewerPageRenderKind({ deliveryV2: { renderKind: 'html' } }), 'unsupported');

const imagePage = context.manifest.pages.find((page) => page.renderKind === 'image');
const imageElement = createDsfViewerPageContentElement({
    documentRef,
    page: { deliveryV2: imagePage },
    context,
    imageUrl: 'data:image/webp;base64,fixture',
    imageClassName: 'viewer-page-image test-spread',
});
assert.equal(imageElement.tagName, 'IMG');
assert.equal(imageElement.className, 'viewer-page-image test-spread');
assert.equal(imageElement.loading, 'eager');

const legacyImage = createDsfViewerPageContentElement({
    documentRef,
    page: {},
    context: null,
    imageUrl: 'legacy.webp',
});
assert.equal(legacyImage.src, 'legacy.webp');
assert.throws(
    () => createDsfViewerPageContentElement({
        documentRef,
        page: { deliveryV2: { renderKind: 'html' } },
        context,
        imageUrl: '',
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'UNSUPPORTED_VIEWER_RENDER_KIND',
);
assert.throws(
    () => createDsfFixedTextPageElement({ documentRef, page: { ...horizontalPage, id: 'not-validated' }, context }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'FIXED_TEXT_PAGE_NOT_VALIDATED',
);

const badSchema = clone(bundle);
badSchema.index.schemaVersion = 99;
await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle: badSchema,
        language: 'ja',
        certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
        fontFaceSet: new FakeFontFaceSet(),
    }),
    DsfDeliveryValidationError,
);

await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle,
        language: 'en',
        certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
        fontFaceSet: new FakeFontFaceSet(),
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'LANGUAGE_MANIFEST_MISSING',
);
await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle,
        language: 'ja',
        certifiedFonts: {},
        fontFaceSet: new FakeFontFaceSet(),
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'FONT_NOT_CERTIFIED',
);

const mismatchedCertificate = clone(DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES);
mismatchedCertificate['fixture-noto-serif-jp'].version = 'wrong';
await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle,
        language: 'ja',
        certifiedFonts: mismatchedCertificate,
        fontFaceSet: new FakeFontFaceSet(),
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'FONT_CERTIFICATE_MISMATCH',
);
await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle,
        language: 'ja',
        certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
        fontFaceSet: new FakeFontFaceSet({ available: false }),
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'CERTIFIED_FONT_UNAVAILABLE',
);
await assert.rejects(
    prepareDsfViewerFixedTextContext({
        bundle,
        language: 'ja',
        certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
        fontFaceSet: new FakeFontFaceSet({ reject: true }),
    }),
    (error) => error instanceof DsfViewerFixedTextError && error.code === 'CERTIFIED_FONT_LOAD_FAILED',
);

const rendererSource = readFileSync(new URL('../js/viewer-fixed-text.js', import.meta.url), 'utf8');
assert.equal(rendererSource.includes('.innerHTML'), false, 'fixed-text renderer cannot use innerHTML');
assert.equal(rendererSource.includes('insertAdjacentHTML'), false);
assert.equal(rendererSource.includes('eval('), false);
assert.equal(rendererSource.includes('./press'), false);
assert.equal(rendererSource.includes('./firebase'), false);
assert.match(rendererSource, /runElement\.textContent = run\.text/);

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewerSource, /if \(!import\.meta\.env\.DEV\)/, 'fixture must be development-only');
assert.match(viewerSource, /createDsfViewerPageContentElement/);
assert.match(viewerSource, /preserveDeliveryV2: source === 'local-fixture'/, 'v2 pages must remain fixture-only in 9A-2');
assert.equal(viewerSource.includes('dsfContentUrl'), false, '9A-2 cannot connect the public v2 loader');

const viewerHtml = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
assert.equal((viewerHtml.match(/page-slider-preview-fixed-text/g) || []).length, 3);

const viewerCss = readFileSync(new URL('../css/viewer.css', import.meta.url), 'utf8');
assert.match(viewerCss, /\.viewer-fixed-text-page[\s\S]*width: var\(--dsf-canonical-page-width, 360px\)/);
assert.match(viewerCss, /\.page-slider-preview-fixed-text > \.viewer-fixed-text-page[\s\S]*transform: scale\(0\.15\)/);
assert.match(viewerCss, /\.viewer-fixed-text-line[\s\S]*white-space: nowrap/);

console.log('Viewer fixed-text renderer verification passed.');
