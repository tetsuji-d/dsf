import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DsfDeliveryValidationError } from '../js/dsf-delivery-v2.js';
import {
    FIXED_TEXT_WHITE_SPACE_MODE,
    FIXED_TEXT_TAB_SIZE,
    applyFixedTextWhiteSpaceStyle,
    renderFixedTextRunText,
} from '../js/fixed-text-whitespace.js';
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

class FakeText {
    constructor(data, ownerDocument) {
        this.nodeType = 3;
        this.data = data;
        this.ownerDocument = ownerDocument;
    }

    get textContent() { return this.data; }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName).toUpperCase();
        this.nodeType = 1;
        this.ownerDocument = ownerDocument;
        this.childNodes = [];
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

    get children() { return this.childNodes.filter((node) => node.nodeType === 1); }

    get firstChild() { return this.childNodes[0] || null; }

    get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }

    set textContent(text) {
        this.childNodes = [];
        if (text) this.append(new FakeText(String(text), this.ownerDocument));
    }

    append(...children) {
        for (const child of children) {
            child.parentNode = this;
            this.childNodes.push(child);
        }
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
        const element = new FakeElement(tagName, this);
        this.created.push(element);
        return element;
    }

    createTextNode(text) { return new FakeText(text, this); }
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
assert.equal(Object.hasOwn(horizontal.children[0].style, 'whiteSpace'), false, 'legacy styles must not opt in implicitly');
assert.equal(Object.hasOwn(horizontal.children[0].style, 'tabSize'), false);

assert.equal(FIXED_TEXT_WHITE_SPACE_MODE, 'preserve-v1');
assert.equal(FIXED_TEXT_TAB_SIZE, 8);
const sharedRun = documentRef.createElement('span');
const sharedSource = '  A\t😀\r\n \nB\rC　\u00a0 <script>x</script>  ';
applyFixedTextWhiteSpaceStyle(sharedRun, undefined);
assert.deepEqual(sharedRun.style, {}, 'omitted mode must not mutate styles');
const legacyRanges = renderFixedTextRunText(sharedRun, sharedSource, undefined);
assert.equal(sharedRun.textContent, sharedSource);
assert.equal(sharedRun.children.length, 0);
assert.equal(legacyRanges.length, 1);
assert.equal(legacyRanges[0].node, sharedRun.firstChild);
assert.equal(legacyRanges[0].end, sharedSource.length);
assert.equal(legacyRanges[0].lineBreak, false);
applyFixedTextWhiteSpaceStyle(sharedRun, FIXED_TEXT_WHITE_SPACE_MODE);
assert.deepEqual(sharedRun.style, { whiteSpace: 'pre', tabSize: '8', textWrap: 'nowrap', direction: 'ltr' });
const mapped = renderFixedTextRunText(sharedRun, sharedSource, FIXED_TEXT_WHITE_SPACE_MODE);
assert.equal(sharedRun.textContent, sharedSource, 'spaces, TAB, CR/LF, surrogate pairs and literal markup stay unchanged');
assert.equal(mapped.map((part) => part.node.data).join(''), sharedSource);
let nextOffset = 0;
for (const part of mapped) {
    assert.equal(part.start, nextOffset);
    assert.equal(part.node.nodeType, 3);
    assert.equal(part.node.data, sharedSource.slice(part.start, part.end));
    if (part.lineBreak) {
        assert.match(part.node.data, /^[\r\n]+$/);
        assert.equal(part.node.parentNode.tagName, 'SPAN');
        assert.equal(part.node.parentNode.style.display, 'none');
    } else {
        assert.equal(part.node.parentNode, sharedRun);
    }
    nextOffset = part.end;
}
assert.equal(nextOffset, sharedSource.length, 'mapping offsets use UTF-16 and cover the complete original run');
assert.equal(sharedRun.children.length, 3, 'only CR/LF groups create hidden spans');
assert.equal(documentRef.created.some((element) => element.tagName === 'SCRIPT'), false);
const simple = ' 文字\t😀  ';
const simpleRanges = renderFixedTextRunText(sharedRun, simple, FIXED_TEXT_WHITE_SPACE_MODE);
assert.equal(sharedRun.children.length, 0, 'a run without line breaks stays a single Text node');
assert.equal(sharedRun.childNodes.length, 1);
assert.equal(simpleRanges[0].node.data, simple);
assert.deepEqual(renderFixedTextRunText(sharedRun, '', FIXED_TEXT_WHITE_SPACE_MODE), []);
assert.equal(sharedRun.childNodes.length, 0);
for (const mode of [null, '', 'pre', 'preserve-v2']) {
    sharedRun.textContent = 'unchanged';
    const styleBefore = JSON.stringify(sharedRun.style);
    assert.throws(() => applyFixedTextWhiteSpaceStyle(sharedRun, mode),
        (error) => error.code === 'UNSUPPORTED_FIXED_TEXT_WHITE_SPACE_MODE');
    assert.throws(() => renderFixedTextRunText(sharedRun, 'replacement', mode),
        (error) => error.code === 'UNSUPPORTED_FIXED_TEXT_WHITE_SPACE_MODE');
    assert.equal(sharedRun.textContent, 'unchanged');
    assert.equal(JSON.stringify(sharedRun.style), styleBefore);
}

const preserveBundle = clone(bundle);
const preserveManifest = preserveBundle.manifests.ja;
const preservePage = preserveManifest.pages.find((page) => page.id === 'fixture-horizontal');
const preserveLine = preservePage.lines[0];
preserveManifest.styles['inherited-whitespace-run'] = { ...preserveManifest.styles[preserveLine.styleRef] };
preserveManifest.styles[preserveLine.styleRef].whiteSpaceMode = FIXED_TEXT_WHITE_SPACE_MODE;
preserveLine.runs = [{ text: sharedSource, styleRef: 'inherited-whitespace-run' }];
const preserveBefore = JSON.stringify(preserveBundle);
const preserveContext = await prepareDsfViewerFixedTextContext({
    bundle: preserveBundle, language: 'ja',
    certifiedFonts: DSF_DELIVERY_V2_FIXTURE_FONT_CERTIFICATES,
    fontFaceSet: new FakeFontFaceSet(),
});
const preserveElement = createDsfFixedTextPageElement({ documentRef, page: preservePage, context: preserveContext });
assert.equal(preserveElement.children[0].style.whiteSpace, 'pre');
assert.equal(preserveElement.children[0].style.tabSize, '8');
assert.equal(preserveElement.children[0].style.textWrap, 'nowrap');
assert.equal(preserveElement.children[0].style.direction, 'ltr');
const preserveRun = preserveElement.children[0].children[0];
assert.equal(preserveRun.textContent, sharedSource);
assert.equal(preserveRun.children.length, 3);
assert.equal(Object.hasOwn(preserveRun.style, 'whiteSpace'), false, 'run style without mode inherits its fixed line mode');
assert.equal(JSON.stringify(preserveBundle), preserveBefore);

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
assert.match(rendererSource, /renderFixedTextRunText\(runElement, run\.text, lineStyle\.whiteSpaceMode, documentRef\)/);
const whitespaceSource = readFileSync(new URL('../js/fixed-text-whitespace.js', import.meta.url), 'utf8');
assert.match(whitespaceSource, /element\.textContent = text/);
assert.equal(whitespaceSource.includes('.innerHTML'), false);
assert.equal(whitespaceSource.includes('insertAdjacentHTML'), false);

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewerSource, /if \(!import\.meta\.env\.DEV\)/, 'fixture must be development-only');
assert.match(viewerSource, /createDsfViewerPageContentElement/);
assert.match(viewerSource, /preserveDeliveryV2: source === 'local-fixture' \|\| !!options\.fixedTextContext/,
    'validated local or public v2 pages must preserve their delivery projection');
assert.match(viewerSource, /await import\('\.\/dsf-horizon-viewer-load\.js'\)/,
    'public v2 validation must stay lazy so legacy Viewer startup does not load the remote contract');

const viewerHtml = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
assert.equal((viewerHtml.match(/page-slider-preview-fixed-text/g) || []).length, 3);

const viewerCss = readFileSync(new URL('../css/viewer.css', import.meta.url), 'utf8');
assert.match(viewerCss, /\.viewer-fixed-text-page[\s\S]*width: var\(--dsf-canonical-page-width, 360px\)/);
assert.match(viewerCss, /\.page-slider-preview-fixed-text > \.viewer-fixed-text-page[\s\S]*transform: scale\(0\.15\)/);
assert.match(viewerCss, /\.viewer-fixed-text-line[\s\S]*white-space: nowrap/);

console.log('Viewer fixed-text renderer verification passed.');
