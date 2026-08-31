import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

import JSZip from 'jszip';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release } from '../js/dsf-release-assembly.js';
import {
    createDsfWebCryptoSha256,
    sealDsfWebPAsset,
} from '../js/dsf-release-byte-sealing.js';
import { createDsfPortableReleasePlan } from '../js/dsf-portable-release.js';
import { createDsfReleaseFileInventory } from '../js/dsf-release-file-inventory.js';
import { createDsfReleaseZipPackage } from '../js/dsf-release-zip-package.js';
import {
    DSF_LOCAL_VIEWER_PACKAGE_KIND,
    DSF_LOCAL_VIEWER_PACKAGE_VERSION,
    DsfLocalViewerPackageError,
    loadDsfLocalViewerPackage,
} from '../js/dsf-local-viewer-package.js';

const REAL_ONE_PIXEL_VP8_BASE64 = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const realVp8 = new Uint8Array(Buffer.from(REAL_ONE_PIXEL_VP8_BASE64, 'base64'));
const hashBytes = createDsfWebCryptoSha256({ cryptoRef: webcrypto });

function createStructuralWoff2(length = 64) {
    const bytes = new Uint8Array(length);
    bytes.set([0x77, 0x4f, 0x46, 0x32], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, 0x00010000, false);
    view.setUint32(8, length, false);
    view.setUint16(12, 1, false);
    view.setUint16(14, 0, false);
    view.setUint32(16, 64, false);
    view.setUint32(20, Math.min(8, length - 48), false);
    view.setUint16(24, 1, false);
    view.setUint16(26, 0, false);
    for (let index = 48; index < length; index += 1) bytes[index] = index & 0xff;
    return bytes;
}

function createRegistry(bytes, sha256) {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-ja-variable-v1': {
                declaration: {
                    family: 'Synthetic JA Variable',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-variable-v1.woff2',
                    sha256,
                },
                asset: {
                    format: 'woff2',
                    mimeType: 'font/woff2',
                    byteLength: bytes.byteLength,
                    immutable: true,
                },
                license: {
                    spdxId: 'OFL-1.1',
                    licenseHref: 'https://unit-test-fonts.dsf-format.org/licenses/ofl-1.1',
                    rightsHolder: 'Synthetic test fixture only',
                    reviewedAt: '2026-08-25',
                    reviewedBy: 'Automated test fixture',
                    allowsWebDistribution: true,
                    allowsPortableEmbedding: true,
                },
                capabilities: {
                    languages: ['ja'],
                    writingModes: ['horizontal-tb', 'vertical-rl'],
                    fontWeights: [400, 700],
                    fontStyles: ['normal'],
                },
            },
        },
    };
}

class FakeFontFace {
    constructor(family, source, descriptors) {
        this.family = family;
        this.source = source;
        this.descriptors = descriptors;
        this.loaded = false;
    }

    async load() {
        this.loaded = true;
        return this;
    }
}

class FakeFontFaceSet {
    constructor() {
        this.faces = [];
        this.loads = [];
    }

    add(face) {
        this.faces.push(face);
    }

    delete(face) {
        const previousLength = this.faces.length;
        this.faces = this.faces.filter((candidate) => candidate !== face);
        return this.faces.length !== previousLength;
    }

    async load(descriptor, sample) {
        this.loads.push({ descriptor, sample });
        return [...this.faces];
    }

    check() {
        return this.faces.length > 0;
    }
}

const fontBytes = createStructuralWoff2();
const fontSha256 = createHash('sha256').update(fontBytes).digest('hex');
const registry = createRegistry(fontBytes, fontSha256);
const text = '冬の金沢は静かだった。';
const textBlock = {
    id: 'fixed_text_story',
    kind: 'page',
    content: {
        pageKind: 'text',
        texts: { ja: text },
        textAlign: 'start',
        backgroundColor: '#fffdf8',
        textColor: '#1f1b16',
        bubbles: [],
        interactions: [],
    },
};
const graphicBlock = { id: 'graphic_afterword', kind: 'page', content: { pageKind: 'image' } };
const snapshot = {
    composition: {
        version: 2,
        writingMode: 'horizontal-tb',
        frame: { x: 20, y: 20, w: 320, h: 600 },
        font: {
            family: "'Synthetic JA Variable',sans-serif",
            size: 16,
            lineHeight: 1.8,
            letterSpacing: 0,
        },
        rules: { maxLines: 20, charsPerLine: 32 },
        lines: [text],
        overflow: false,
        overflowText: '',
    },
    evidence: {
        sourceText: text,
        layoutVersion: 2,
        fontId: 'synthetic-ja-variable-v1',
        fontSha256,
    },
};
const preflight = createDsfPressPreflight({
    blocks: [textBlock, graphicBlock],
    language: 'ja',
    compositionSnapshots: { [textBlock.id]: snapshot },
    fontRegistry: registry,
});
const sealedImage = await sealDsfWebPAsset({
    bytes: realVp8,
    expectedWidth: 1,
    expectedHeight: 1,
    pageId: 'graphic-afterword-ja',
    pageLabel: '2',
}, { cryptoRef: webcrypto });
const horizonAssembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes,
    languages: [{
        language: 'ja',
        pageDirection: 'rtl',
        preflight,
        imageAssets: { [graphicBlock.id]: sealedImage.descriptor },
    }],
});
const portablePlan = await createDsfPortableReleasePlan({
    assembly: horizonAssembly,
    fontRegistry: registry,
    fontAssets: { 'synthetic-ja-variable-v1': fontBytes },
    hashBytes,
    cryptoRef: webcrypto,
});
const inventory = await createDsfReleaseFileInventory({
    assembly: portablePlan.assembly,
    sealedAssets: [{
        language: 'ja',
        blockId: graphicBlock.id,
        pageIndex: 1,
        sealed: sealedImage,
    }],
    portableFontAssets: portablePlan.fontAssets,
    metadata: {
        workId: 'work_local_viewer',
        releaseId: 'release_local_viewer_1',
        title: 'ローカルViewer確認',
        author: 'DSF Author',
        localizedMeta: { ja: { title: 'ローカルViewer確認', author: '著作者' } },
        created: '2026-08-25T00:00:00.000Z',
        modified: '2026-08-25T01:00:00.000Z',
        spread: 'none',
    },
    hashBytes,
});
const zipPackage = await createDsfReleaseZipPackage({ inventory, hashBytes });

const fontFaceSet = new FakeFontFaceSet();
const createdUrls = [];
const revokedUrls = [];
const urlRef = {
    createObjectURL(blob) {
        const url = `blob:local-viewer-${createdUrls.length + 1}`;
        createdUrls.push({ url, blob });
        return url;
    },
    revokeObjectURL(url) {
        revokedUrls.push(url);
    },
};
const session = await loadDsfLocalViewerPackage({
    file: zipPackage.blob,
    fontRegistry: registry,
    fontFaceSet,
    FontFaceCtor: FakeFontFace,
    urlRef,
    cryptoRef: webcrypto,
});

assert.equal(session.packageVersion, DSF_LOCAL_VIEWER_PACKAGE_VERSION);
assert.equal(session.packageKind, DSF_LOCAL_VIEWER_PACKAGE_KIND);
assert.equal(session.archive.byteLength, zipPackage.blob.size);
assert.equal(session.archive.sha256, zipPackage.sha256);
assert.equal(session.archive.entryCount, inventory.files.length);
assert.equal(session.project.title, 'ローカルViewer確認');
assert.equal(session.project.defaultLang, 'ja');
assert.equal(session.project.dsfTotalBytes, zipPackage.blob.size);
assert.deepEqual(session.project.pages.map((page) => page.deliveryV2.renderKind), ['fixedText', 'image']);
assert.deepEqual([...session.contextsByLanguage.keys()], ['ja']);
assert.deepEqual([...session.pagesByLanguage.keys()], ['ja']);
assert.equal(session.contextsByLanguage.get('ja').manifest.pages.length, 2);
assert.equal(fontFaceSet.faces.length, 1);
assert.equal(fontFaceSet.faces[0].loaded, true);
assert.match(fontFaceSet.faces[0].family, /^DSF Portable synthetic-ja-variable-v1 /);
assert.equal(createdUrls.length, 1);
assert.equal(session.assetUrls.get('../assets/images/language-0001/page-00002.webp'), createdUrls[0].url);

session.dispose();
session.dispose();
assert.equal(fontFaceSet.faces.length, 0);
assert.deepEqual(revokedUrls, [createdUrls[0].url]);

const tampered = await JSZip.loadAsync(new Uint8Array(await zipPackage.blob.arrayBuffer()));
const imagePath = inventory.files.find((file) => file.role === 'image').path;
const changedImage = new Uint8Array(realVp8);
changedImage[changedImage.length - 1] ^= 0x01;
tampered.file(imagePath, changedImage, { createFolders: false });
const tamperedBlob = await tampered.generateAsync({ type: 'blob' });
await assert.rejects(
    () => loadDsfLocalViewerPackage({
        file: tamperedBlob,
        fontRegistry: registry,
        fontFaceSet: new FakeFontFaceSet(),
        FontFaceCtor: FakeFontFace,
        urlRef,
        cryptoRef: webcrypto,
    }),
    (error) => error instanceof DsfLocalViewerPackageError
        && error.issues.some((issue) => issue.code === 'LOCAL_DSF_ENTRY_HASH_MISMATCH'),
    'tampered payload must fail before Viewer state changes',
);

const mismatchedRegistry = structuredClone(registry);
mismatchedRegistry.fonts['synthetic-ja-variable-v1'].declaration.family = 'Wrong Family';
await assert.rejects(
    () => loadDsfLocalViewerPackage({
        file: zipPackage.blob,
        fontRegistry: mismatchedRegistry,
        fontFaceSet: new FakeFontFaceSet(),
        FontFaceCtor: FakeFontFace,
        urlRef,
        cryptoRef: webcrypto,
    }),
    (error) => error instanceof DsfLocalViewerPackageError
        && error.issues.some((issue) => issue.code === 'LOCAL_DSF_FONT_CERTIFICATE_MISMATCH'),
    'portable fonts must remain anchored to the active production certificate',
);

const legacyZip = new JSZip();
legacyZip.file('meta.json', JSON.stringify({ title: 'Legacy' }));
legacyZip.file('content.json', JSON.stringify({ pages: [] }));
const legacyBlob = await legacyZip.generateAsync({ type: 'blob' });
assert.equal(await loadDsfLocalViewerPackage({ file: legacyBlob, cryptoRef: webcrypto }), null,
    'legacy DSF must remain on the existing parser path');

const moduleSource = readFileSync(new URL('../js/dsf-local-viewer-package.js', import.meta.url), 'utf8');
// Transport-only synthetic Flow projection: glyph geometry is covered by the
// real-font Browser fixture, not by this structurally valid synthetic font.
const preservedText = '  前  中\t後\u00a0次\u3000終  \n';
const flowBlock = { id: 'flow_spacing', kind: 'flow', flow: { document: { id: 'spacing_document' } } };
const spacingProjection = structuredClone(preflight.decisions[0].projection);
Object.assign(spacingProjection, {
    flowGroupId: flowBlock.id,
    documentId: flowBlock.flow.document.id,
    language: 'ja', revision: 0, writingMode: 'horizontal-tb',
    summary: { pageCount: 1 },
});
for (const style of Object.values(spacingProjection.manifest.styles)) {
    style.whiteSpaceMode = 'preserve-v1';
}
const spacingPage = spacingProjection.manifest.pages[0];
spacingPage.id = 'flow-spacing-ja';
spacingPage.sourceAnchor = {
    kind: 'flow', flowGroupId: flowBlock.id,
    firstBlockId: 'spacing_paragraph', blockProgress: 0,
};
spacingPage.lines[0].runs = [{
    text: preservedText,
    source: { blockId: 'spacing_paragraph', startGrapheme: 0, endGrapheme: [...preservedText].length },
}];
const spacingPreflight = createDsfPressPreflight({
    blocks: [textBlock, graphicBlock, flowBlock], language: 'ja',
    compositionSnapshots: { [textBlock.id]: snapshot },
    flowPublicationProjections: { [flowBlock.id]: spacingProjection },
    flowPublicationRevisions: { [flowBlock.id]: 0 }, fontRegistry: registry,
});
assert.equal(spacingPreflight.publishable, true, JSON.stringify(spacingPreflight.issues));
const spacingAssembly = await assembleDsfV2Release({
    defaultLang: 'ja', hashBytes,
    languages: [{ language: 'ja', pageDirection: 'rtl', preflight: spacingPreflight,
        imageAssets: { [graphicBlock.id]: sealedImage.descriptor } }],
});
const spacingPortable = await createDsfPortableReleasePlan({
    assembly: spacingAssembly, fontRegistry: registry,
    fontAssets: { 'synthetic-ja-variable-v1': fontBytes }, hashBytes, cryptoRef: webcrypto,
});
const spacingInventory = await createDsfReleaseFileInventory({
    assembly: spacingPortable.assembly,
    sealedAssets: [{ language: 'ja', blockId: graphicBlock.id, pageIndex: 1, sealed: sealedImage }],
    portableFontAssets: spacingPortable.fontAssets,
    metadata: { workId: 'work_spacing', releaseId: 'release_spacing', title: 'Whitespace roundtrip',
        author: 'DSF Author', created: '2026-08-25T00:00:00.000Z', modified: '2026-08-25T01:00:00.000Z', spread: 'none' },
    hashBytes,
});
const spacingZip = await createDsfReleaseZipPackage({ inventory: spacingInventory, hashBytes });
const spacingFonts = new FakeFontFaceSet();
const spacingSession = await loadDsfLocalViewerPackage({
    file: spacingZip.blob, fontRegistry: registry, fontFaceSet: spacingFonts,
    FontFaceCtor: FakeFontFace, urlRef, cryptoRef: webcrypto,
});
const roundtripManifest = spacingSession.contextsByLanguage.get('ja').manifest;
assert.deepEqual(spacingSession.project.pages.map((page) => page.deliveryV2.renderKind),
    ['fixedText', 'image', 'fixedText']);
assert.deepEqual(roundtripManifest.pages.slice(0, 2), session.contextsByLanguage.get('ja').manifest.pages,
    'adding whitespace-preserving Flow must not alter existing Fixed/image pages');
const roundtripLine = roundtripManifest.pages[2].lines[0];
assert.equal(roundtripManifest.styles[roundtripLine.styleRef].whiteSpaceMode, 'preserve-v1');
assert.equal(roundtripLine.runs.map((run) => run.text).join(''), preservedText,
    'ZIP and local Viewer must preserve leading/internal/trailing space, TAB, NBSP, fullwidth space and LF exactly');
assert.deepEqual(roundtripLine.runs[0].source, spacingPage.lines[0].runs[0].source);
assert.deepEqual(roundtripManifest.pages[2].sourceAnchor, spacingPage.sourceAnchor);
const legacyLine = roundtripManifest.pages[0].lines[0];
assert.equal(Object.hasOwn(roundtripManifest.styles[legacyLine.styleRef], 'whiteSpaceMode'), false,
    'legacy Fixed text must not silently opt into new whitespace semantics');
assert.equal(spacingInventory.files.some((file) => /\.(?:js|html)$/i.test(file.path)), false,
    'portable DSF is data/fonts/images; compatibility depends on the consuming Viewer');
spacingSession.dispose();
assert.equal(spacingFonts.faces.length, 0);

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
const viewerHtml = readFileSync(new URL('../viewer.html', import.meta.url), 'utf8');
for (const forbidden of ['firebase', 'firestore', 'public_projects', 'upload', 'saveAs(']) {
    assert.equal(moduleSource.toLowerCase().includes(forbidden.toLowerCase()), false,
        `local Viewer package loader cannot depend on ${forbidden}`);
}
assert.match(viewerSource, /import\('\.\/dsf-local-viewer-package\.js'\)/);
assert.match(viewerSource, /source: 'local-portable-v2'/);
assert.match(viewerSource, /mapDsfLanguagePage\(sourceManifest, targetManifest, getIndex\(\)\)/);
assert.match(viewerSource, /replaceViewerLocalPortableSession\(options\.localPortableSession \|\| null\)/);
assert.match(viewerHtml, /accept="\.dsf,\.dsp,\.zip,\.json,application\/vnd\.dsf\.content\+zip"/);

console.log('DSF portable v2 local Viewer package verification passed.');
