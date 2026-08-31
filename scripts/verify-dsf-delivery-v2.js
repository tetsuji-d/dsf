import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DSF_DELIVERY_LAYOUT_MODEL,
    DSF_DELIVERY_SCHEMA_VERSION,
    DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    DsfDeliveryValidationError,
    assertValidDsfDeliveryBundle,
    assertValidDsfDeliveryIndex,
    assertValidDsfLanguageManifest,
    getDsfDeliveryV2Versions,
    mapDsfLanguagePage,
    normalizeDsfDeliveryBundle,
    normalizeDsfDeliveryIndex,
    normalizeDsfLanguageManifest,
    validateDsfDeliveryBundle,
    validateDsfDeliveryIndex,
    validateDsfLanguageManifest,
} from '../js/dsf-delivery-v2.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function clone(value) {
    return structuredClone(value);
}

function fixedAnchor(blockId) {
    return { kind: 'fixed', blockId };
}

function flowAnchor(blockProgress, overrides = {}) {
    return {
        kind: 'flow',
        flowGroupId: 'flow_story',
        sectionId: 'section_1',
        firstBlockId: 'paragraph_1',
        blockProgress,
        ...overrides,
    };
}

function imagePage(id, anchor) {
    return {
        id,
        renderKind: 'image',
        sourceAnchor: anchor,
        image: {
            href: `../assets/images/${id}.webp`,
            width: 1080,
            height: 1920,
            mimeType: 'image/webp',
        },
    };
}

function fixedTextPage(id, anchor, text = '冬の金沢は静かだった。') {
    return {
        id,
        renderKind: 'fixedText',
        sourceAnchor: anchor,
        pageLabel: id,
        background: { color: '#fffdf8' },
        lines: [
            {
                x: 20,
                y: 24,
                width: 320,
                height: 28,
                writingMode: 'horizontal-tb',
                textOrientation: 'mixed',
                styleRef: 'body',
                runs: [{
                    text,
                    source: { blockId: 'paragraph_1', startGrapheme: 0, endGrapheme: 12 },
                }],
            },
            {
                x: 324,
                y: 56,
                width: 16,
                height: 560,
                writingMode: 'vertical-rl',
                textOrientation: 'upright',
                styleRef: 'body',
                runs: [{ text: '縦書き', styleRef: 'emphasis' }],
            },
        ],
    };
}

const index = {
    schemaVersion: DSF_DELIVERY_SCHEMA_VERSION,
    layoutModel: DSF_DELIVERY_LAYOUT_MODEL,
    canonicalPage: { width: 360, height: 640, aspectRatio: '9:16' },
    defaultLang: 'ja',
    fonts: {
        mincho: {
            family: 'DSF Mincho JA',
            version: '1',
            source: 'registry',
            href: 'https://fonts.example/mincho-v1.woff2',
            sha256: HASH_A,
        },
    },
    languages: {
        ja: { href: 'content/ja.json', pageCount: 4, sha256: HASH_A, pageDirection: 'rtl' },
        en: { href: 'content/en.json', pageCount: 5, sha256: HASH_B, pageDirection: 'ltr' },
    },
};

const styles = {
    body: {
        fontRef: 'mincho',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        lineHeight: 1.8,
        letterSpacing: 0,
        color: '#1f2937',
        textDecoration: 'none',
        textAlign: 'start',
    },
    emphasis: {
        fontRef: 'mincho',
        fontSize: 16,
        fontWeight: 'bold',
        lineHeight: 1.8,
        letterSpacing: 0,
        color: '#1f2937',
    },
};

const jaManifest = {
    schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    language: 'ja',
    styles,
    pages: [
        imagePage('cover-ja', fixedAnchor('cover')),
        fixedTextPage('story-ja-1', flowAnchor(0)),
        fixedTextPage('story-ja-2', flowAnchor(0.7)),
        imagePage('after-ja', fixedAnchor('afterword')),
    ],
};

const enManifest = {
    schemaVersion: DSF_LANGUAGE_MANIFEST_SCHEMA_VERSION,
    language: 'en',
    styles,
    pages: [
        imagePage('cover-en', fixedAnchor('cover')),
        fixedTextPage('story-en-1', flowAnchor(0.05), 'Kanazawa was quiet in winter.'),
        fixedTextPage('story-en-2', flowAnchor(0.45), 'Snow fell beyond the window.'),
        fixedTextPage('story-en-3', flowAnchor(0.9), 'He reached for his coat.'),
        imagePage('after-en', fixedAnchor('afterword')),
    ],
};

const bundle = { index, manifests: { ja: jaManifest, en: enManifest } };
const before = JSON.stringify(bundle);

assert.deepEqual(getDsfDeliveryV2Versions(), {
    delivery: 2,
    languageManifest: 1,
    layoutModel: 'fixed-page-hybrid-1',
});
assert.equal(validateDsfDeliveryIndex(index).valid, true);
assert.equal(validateDsfLanguageManifest(jaManifest, {
    expectedLanguage: 'ja',
    expectedPageCount: 4,
    fontIds: new Set(['mincho']),
}).valid, true);
assert.equal(validateDsfDeliveryBundle(bundle).valid, true);
assert.equal(assertValidDsfDeliveryIndex(index), index);
assert.equal(assertValidDsfLanguageManifest(jaManifest), jaManifest);
assert.equal(assertValidDsfDeliveryBundle(bundle), bundle);
assert.equal(JSON.stringify(bundle), before, 'validation must not mutate persisted data');

const normalizedIndex = normalizeDsfDeliveryIndex(index);
const normalizedManifest = normalizeDsfLanguageManifest(jaManifest);
const normalizedBundle = normalizeDsfDeliveryBundle(bundle);
assert.deepEqual(normalizedBundle, bundle);
assert.notEqual(normalizedIndex, index);
assert.notEqual(normalizedManifest, jaManifest);
assert.notEqual(normalizedBundle.index, bundle.index);
normalizedBundle.index.defaultLang = 'en';
assert.equal(bundle.index.defaultLang, 'ja', 'normalization must deep clone the source');
assert.deepEqual(JSON.parse(JSON.stringify(normalizeDsfDeliveryBundle(bundle))), bundle, 'bundle must survive a JSON round trip');
assert.throws(() => normalizeDsfDeliveryIndex(null), TypeError);
assert.throws(() => normalizeDsfLanguageManifest([]), TypeError);

function assertInvalidBundle(mutate, code, path) {
    const invalid = clone(bundle);
    mutate(invalid);
    const result = validateDsfDeliveryBundle(invalid);
    assert.equal(result.valid, false, `${code} should invalidate the bundle`);
    assert.ok(result.issues.some((issue) => issue.code === code && (!path || issue.path === path)),
        `expected ${code}${path ? ` at ${path}` : ''}; got ${JSON.stringify(result.issues)}`);
    return invalid;
}

// Whitespace preservation is an opt-in style extension. Legacy manifests must
// not acquire a mode through either validation or normalization.
for (const style of Object.values(normalizeDsfLanguageManifest(jaManifest).styles)) {
    assert.equal(Object.hasOwn(style, 'whiteSpaceMode'), false);
}
const preserved = clone(bundle);
preserved.manifests.ja.styles.preserved = { ...preserved.manifests.ja.styles.body, whiteSpaceMode: 'preserve-v1' };
const preservedPage = preserved.manifests.ja.pages[1];
preservedPage.lines.forEach(line => { line.styleRef = 'preserved'; });
preservedPage.lines[0].runs[0].text = '  雪\t  朝\u3000\u00a0\n ';
// The second line's explicit emphasis style has no mode: it inherits preserve.
assert.equal(Object.hasOwn(preserved.manifests.ja.styles.emphasis, 'whiteSpaceMode'), false);
const preservedBefore = JSON.stringify(preserved);
assert.equal(validateDsfDeliveryBundle(preserved).valid, true);
assert.equal(assertValidDsfDeliveryBundle(preserved), preserved);
assert.equal(JSON.stringify(preserved), preservedBefore, 'validation must preserve spaces, TAB, LF and source offsets exactly');
assert.deepEqual(normalizeDsfDeliveryBundle(preserved), preserved);
assert.deepEqual(JSON.parse(JSON.stringify(normalizeDsfDeliveryBundle(preserved))), preserved);
assert.equal(preserved.index.schemaVersion, 2);
assert.equal(preserved.manifests.ja.schemaVersion, 1);
assert.equal(Object.hasOwn(preserved.manifests.ja.styles.body, 'whiteSpaceMode'), false,
    'legacy and preserving lines must coexist in one manifest');
assert.equal(Object.hasOwn(preservedPage.lines[0], 'whiteSpaceMode'), false,
    'the extension belongs to styles, not line fields');

const explicitPreservedRun = clone(preserved);
explicitPreservedRun.manifests.ja.styles.preservedEmphasis = {
    ...explicitPreservedRun.manifests.ja.styles.emphasis, whiteSpaceMode: 'preserve-v1',
};
explicitPreservedRun.manifests.ja.pages[1].lines[1].runs[0].styleRef = 'preservedEmphasis';
assert.equal(validateDsfDeliveryBundle(explicitPreservedRun).valid, true,
    'an explicit matching run mode is valid');

for (const mode of ['normal', 'nowrap', 'pre', 'preserve-v2', 'PRESERVE-V1', '', null, undefined, 1, true, {}, []]) {
    assertInvalidBundle(value => { value.manifests.ja.styles.body.whiteSpaceMode = mode; },
        'invalid_text_style', 'manifests.ja.styles.body.whiteSpaceMode');
}
assertInvalidBundle(value => { value.manifests.ja.styles.emphasis.whiteSpaceMode = 'preserve-v1'; },
    'incompatible_white_space_mode', 'manifests.ja.pages[1].lines[1].runs[0].styleRef');
assertInvalidBundle(value => {
    value.manifests.ja.styles.body.whiteSpace = 'pre';
}, 'unsupported_text_style_property', 'manifests.ja.styles.body.whiteSpace');

// Invalid style-map entries and unresolved references must remain validation
// issues, never exceptions from the new run/line compatibility lookup.
for (const invalidStyle of [null, false, 7, 'preserve-v1', []]) {
    assertInvalidBundle(value => { value.manifests.ja.styles.emphasis = invalidStyle; }, 'invalid_text_style');
}
assertInvalidBundle(value => {
    value.manifests.ja.styles.emphasis.whiteSpaceMode = 'preserve-v1';
    value.manifests.ja.pages[1].lines[1].styleRef = 'missing';
}, 'unknown_style_ref', 'manifests.ja.pages[1].lines[1].styleRef');
assertInvalidBundle(value => {
    value.manifests.ja.styles.body.whiteSpaceMode = 'preserve-v1';
    value.manifests.ja.pages[1].lines[1].runs[0].styleRef = 'missing';
}, 'unknown_style_ref', 'manifests.ja.pages[1].lines[1].runs[0].styleRef');

assertInvalidBundle((value) => { value.index.schemaVersion = 3; }, 'unsupported_delivery_schema_version', 'index.schemaVersion');
assertInvalidBundle((value) => { value.index.layoutModel = 'responsive'; }, 'unsupported_layout_model', 'index.layoutModel');
assertInvalidBundle((value) => { value.index.canonicalPage.width = 375; }, 'unsupported_canonical_page', 'index.canonicalPage.width');
assertInvalidBundle((value) => { value.index.defaultLang = 'fr'; }, 'missing_default_language', 'index.defaultLang');
assertInvalidBundle((value) => { value.index.languages.ja.href = 'javascript:alert(1)'; }, 'unsafe_resource_href', 'index.languages.ja.href');
assertInvalidBundle((value) => { value.index.fonts.mincho.href = 'http://fonts.example/mincho.woff2'; }, 'unsafe_resource_href', 'index.fonts.mincho.href');
assertInvalidBundle((value) => { value.index.fonts.mincho.sha256 = 'bad'; }, 'invalid_sha256', 'index.fonts.mincho.sha256');
assertInvalidBundle((value) => { value.index.languages.ja.pageCount = 3; }, 'page_count_mismatch', 'manifests.ja.pages');
assertInvalidBundle((value) => { delete value.manifests.en; }, 'missing_language_manifest', 'manifests.en');
assertInvalidBundle((value) => { value.manifests.fr = clone(value.manifests.en); }, 'unexpected_language_manifest', 'manifests.fr');
assertInvalidBundle((value) => { value.manifests.ja.language = 'JA'; }, 'language_manifest_mismatch', 'manifests.ja.language');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].id = 'cover-ja'; }, 'duplicate_delivery_page_id', 'manifests.ja.pages[1].id');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].renderKind = 'html'; }, 'unsupported_render_kind', 'manifests.ja.pages[1].renderKind');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].width = 500; }, 'invalid_text_line', 'manifests.ja.pages[1].lines[0].width');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].x = 350; }, 'text_line_out_of_bounds', 'manifests.ja.pages[1].lines[0]');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].writingMode = 'sideways-lr'; }, 'unsupported_writing_mode');
assertInvalidBundle((value) => { value.manifests.ja.styles.body.backgroundImage = 'url(x)'; }, 'unsupported_text_style_property');
assertInvalidBundle((value) => { value.manifests.ja.styles.body.fontRef = 'missing'; }, 'unknown_font_ref');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].styleRef = 'missing'; }, 'unknown_style_ref');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].runs[0].innerHTML = '<img onerror=alert(1)>'; }, 'forbidden_executable_content');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].sourceAnchor.blockProgress = 1.1; }, 'invalid_source_anchor');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].lines[0].runs[0].source.endGrapheme = -1; }, 'invalid_text_source_range');
assertInvalidBundle((value) => { value.manifests.ja.pages[0].image.mimeType = 'image/png'; }, 'unsupported_image_mime_type');
assertInvalidBundle((value) => { value.manifests.ja.pages[0].image.href = 'data:image/webp;base64,AA=='; }, 'unsafe_resource_href');
assertInvalidBundle((value) => { value.manifests.ja.pages[0].lines = []; }, 'ambiguous_page_payload');
assertInvalidBundle((value) => { value.manifests.ja.pages[1].image = clone(value.manifests.ja.pages[0].image); }, 'ambiguous_page_payload');

const noFonts = clone(bundle);
noFonts.index.fonts = {};
const noFontsResult = validateDsfDeliveryBundle(noFonts);
assert.equal(noFontsResult.valid, false);
assert.ok(noFontsResult.issues.some((issue) => issue.code === 'unknown_font_ref'), 'fixed text requires an index-declared font');

const invalidForAssert = assertInvalidBundle((value) => {
    value.manifests.ja.pages[1].lines[0].runs[0].text = 'x'.repeat(8_193);
}, 'invalid_text_run');
assert.throws(
    () => assertValidDsfDeliveryBundle(invalidForAssert),
    (error) => error instanceof DsfDeliveryValidationError
        && error.code === 'DSF_DELIVERY_V2_INVALID'
        && error.issues.length > 0,
);

assert.deepEqual(mapDsfLanguagePage(jaManifest, enManifest, 0), {
    pageIndex: 0,
    strategy: 'fixed-anchor',
    sourceAnchor: fixedAnchor('cover'),
});
assert.deepEqual(mapDsfLanguagePage(jaManifest, enManifest, 2), {
    pageIndex: 3,
    strategy: 'flow-block-progress',
    sourceAnchor: flowAnchor(0.7),
});
assert.equal(mapDsfLanguagePage(jaManifest, enManifest, 3).pageIndex, 4);

const noMatchingAnchorTarget = clone(enManifest);
noMatchingAnchorTarget.pages.forEach((page) => {
    page.sourceAnchor = fixedAnchor(`unmatched-${page.id}`);
});
assert.deepEqual(mapDsfLanguagePage(jaManifest, noMatchingAnchorTarget, 2), {
    pageIndex: 3,
    strategy: 'reading-progress',
    sourceAnchor: flowAnchor(0.7),
});
assert.throws(() => mapDsfLanguagePage(jaManifest, enManifest, -1), RangeError);
assert.throws(() => mapDsfLanguagePage({}, enManifest, 0), TypeError);
assert.deepEqual(mapDsfLanguagePage(jaManifest, { pages: [] }, 0), {
    pageIndex: -1,
    strategy: 'empty-target',
    sourceAnchor: null,
});

const moduleSource = readFileSync(new URL('../js/dsf-delivery-v2.js', import.meta.url), 'utf8');
for (const forbiddenDependency of [
    './viewer',
    './press',
    './state',
    './firebase',
    'document.',
    'window.',
    'localStorage',
]) {
    assert.equal(moduleSource.includes(forbiddenDependency), false, `pure delivery model cannot depend on ${forbiddenDependency}`);
}

console.log('DSF delivery v2 verification passed.');
