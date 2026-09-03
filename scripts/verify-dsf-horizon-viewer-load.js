import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createDsfPressPreflight } from '../js/dsf-press-preflight.js';
import { assembleDsfV2Release, serializeDsfReleaseJson } from '../js/dsf-release-assembly.js';
import {
    DSF_HORIZON_VIEWER_SESSION_KIND,
    DsfHorizonViewerLoadError,
    isDsfHorizonV2MetadataDeclared,
    loadDsfHorizonViewerRelease,
} from '../js/dsf-horizon-viewer-load.js';

const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();
const clone = (value) => structuredClone(value);

const registry = {
    schemaVersion: 1,
    registryKind: 'production',
    fonts: {
        'synthetic-global-sans-v1': {
            declaration: {
                family: 'Synthetic Global Sans',
                version: '1.0.0-test',
                source: 'registry',
                href: 'https://unit-test-fonts.dsf-format.org/synthetic-global-sans-v1.woff2',
                sha256: 'a'.repeat(64),
            },
            asset: {
                format: 'woff2', mimeType: 'font/woff2', byteLength: 123456, immutable: true,
            },
            license: {
                spdxId: 'OFL-1.1',
                licenseHref: 'https://unit-test-fonts.dsf-format.org/OFL.txt',
                rightsHolder: 'Synthetic fixture',
                reviewedAt: '2026-09-02',
                reviewedBy: 'Automated test',
                allowsWebDistribution: true,
                allowsPortableEmbedding: true,
            },
            capabilities: {
                languages: ['ja'],
                writingModes: ['horizontal-tb'],
                fontWeights: [400],
                fontStyles: ['normal'],
            },
        },
    },
};

const graphicBlock = { id: 'cover', kind: 'page', content: { pageKind: 'image', layers: [] } };
const textBlock = {
    id: 'story',
    kind: 'page',
    content: {
        pageKind: 'text',
        texts: { ja: '冬の金沢は静かだった。' },
        textAlign: 'start',
        backgroundColor: '#fffdf8',
        textColor: '#1f1b16',
        bubbles: [],
        interactions: [],
    },
};
const compositionSnapshots = {
    story: {
        composition: {
            version: 2,
            writingMode: 'horizontal-tb',
            frame: { x: 20, y: 20, w: 320, h: 600 },
            font: { family: "'Synthetic Global Sans',sans-serif", size: 16, lineHeight: 1.8, letterSpacing: 0 },
            rules: { maxLines: 20, charsPerLine: 32 },
            lines: ['冬の金沢は静かだった。'],
            overflow: false,
            overflowText: '',
        },
        evidence: {
            sourceText: '冬の金沢は静かだった。',
            layoutVersion: 2,
            fontId: 'synthetic-global-sans-v1',
            fontSha256: 'a'.repeat(64),
        },
    },
};
const preflight = createDsfPressPreflight({
    blocks: [graphicBlock, textBlock],
    language: 'ja',
    compositionSnapshots,
    fontRegistry: registry,
});
const assembly = await assembleDsfV2Release({
    defaultLang: 'ja',
    hashBytes: sha256,
    languages: [{
        language: 'ja',
        pageDirection: 'rtl',
        preflight,
        imageAssets: {
            cover: {
                pageId: 'cover-ja',
                pageLabel: '1',
                sha256: 'b'.repeat(64),
                byteLength: 42000,
                width: 1080,
                height: 1920,
                mimeType: 'image/webp',
            },
        },
    }],
});

const origin = 'https://media-test.dsf.ink';
const uid = 'reader_owner_1';
const workId = 'work_public_v2';
const releaseId = 'release_public_v2_1';
const releaseRoot = `${origin}/users/${uid}/dsf/${workId}/${releaseId}/`;
const contentUrl = `${releaseRoot}content.json`;
const locator = {
    dsfSchemaVersion: 2,
    dsfContentUrl: contentUrl,
    dsfContentHash: assembly.files.index.sha256,
    dsfLangs: ['ja'],
    dsfPageCounts: { ja: 2 },
    dsfTotalBytes: assembly.releaseMetadata.dsfTotalBytes,
    defaultLang: 'ja',
    pageCount: 2,
};
const publicMetadata = {
    ...locator,
    authorUid: uid,
    workId,
    releaseId,
    projectId: 'project_public_v2',
    title: '公開DSF v2',
    dsfStatus: 'public',
};
const releaseMetadata = { ...locator, authorUid: uid, workId, releaseId };

function createJsonResponse(text, overrides = {}) {
    const bytes = encoder.encode(text);
    const headers = new Map([
        ['content-type', 'application/json; charset=utf-8'],
        ['content-length', String(bytes.byteLength)],
    ]);
    return {
        ok: overrides.ok ?? true,
        status: overrides.status ?? 200,
        headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
        arrayBuffer: async () => bytes.slice().buffer,
    };
}

function createFetch(overrides = new Map()) {
    const files = new Map([[contentUrl, assembly.files.index.json]]);
    for (const file of Object.values(assembly.files.manifests)) {
        files.set(new URL(file.path, contentUrl).href, file.json);
    }
    for (const [url, text] of overrides) files.set(url, text);
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        if (!files.has(url)) return createJsonResponse('{}', { ok: false, status: 404 });
        return createJsonResponse(files.get(url));
    };
    return { fetchImpl, calls };
}

function createRuntime() {
    const disposed = [];
    const fontFaceSet = {
        async load() { return [{}]; },
        check() { return true; },
    };
    const fontRuntimeLoader = async ({ fontId, fontStyle, fontWeights }) => ({
        runtimeFontFamily: `DSF Test ${fontId}`,
        fontStyle,
        fontWeights,
        dispose() { disposed.push(fontId); },
    });
    return { documentRef: { fonts: fontFaceSet }, fontRuntimeLoader, disposed };
}

const remote = createFetch();
const runtime = createRuntime();
const session = await loadDsfHorizonViewerRelease({
    uid,
    workId,
    releaseId,
    publicMetadata,
    allowedContentOrigins: [origin],
    fetchImpl: remote.fetchImpl,
    hashBytes: sha256,
    fontRegistry: registry,
    documentRef: runtime.documentRef,
    fontRuntimeLoader: runtime.fontRuntimeLoader,
});

assert.equal(session.sessionKind, DSF_HORIZON_VIEWER_SESSION_KIND);
assert.equal(remote.calls[0].url, contentUrl,
    'Anonymous public loading must start from the public index locator without reading the owner-only Release document.');
assert.equal(session.project.title, '公開DSF v2');
assert.equal(session.project.dsfSchemaVersion, 2);
assert.deepEqual(session.project.languages, ['ja']);
assert.equal(session.pagesByLanguage.get('ja').length, 2);
assert.equal(session.pagesByLanguage.get('ja')[0].deliveryV2.renderKind, 'image');
assert.equal(session.pagesByLanguage.get('ja')[1].deliveryV2.renderKind, 'fixedText');
assert.equal(session.contextsByLanguage.get('ja').certifiedFontRefs[0], 'synthetic-global-sans-v1');
const imageHref = session.pagesByLanguage.get('ja')[0].deliveryV2.image.href;
assert.equal(session.assetUrls.get(imageHref), new URL(imageHref, new URL(assembly.files.manifests.ja.path, contentUrl)).href);
assert.equal(remote.calls.length, 2, 'Only content.json and the selected release manifests are fetched by the JSON loader.');
for (const call of remote.calls) {
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
}
session.dispose();
session.dispose();
assert.deepEqual(runtime.disposed, ['synthetic-global-sans-v1']);

assert.equal(isDsfHorizonV2MetadataDeclared({ dsfPages: [], dsfLangs: ['ja'], dsfTotalBytes: 1 }), false,
    'Legacy v1 metadata must not be treated as partial v2 because it contains language/size fields.');
assert.equal(isDsfHorizonV2MetadataDeclared({ dsfContentHash: 'a'.repeat(64), dsfPages: [{}] }), true);

const mismatchedRelease = clone(releaseMetadata);
mismatchedRelease.dsfContentHash = 'c'.repeat(64);
await assert.rejects(
    () => loadDsfHorizonViewerRelease({
        uid, workId, releaseId, publicMetadata, releaseMetadata: mismatchedRelease,
        allowedContentOrigins: [origin], fetchImpl: remote.fetchImpl, hashBytes: sha256,
        fontRegistry: registry, documentRef: createRuntime().documentRef,
        fontRuntimeLoader: createRuntime().fontRuntimeLoader,
    }),
    (error) => error instanceof DsfHorizonViewerLoadError
        && error.issues.some((issue) => issue.code === 'HORIZON_VIEWER_PUBLIC_RELEASE_MISMATCH'),
);

const corruptRemote = createFetch(new Map([[contentUrl, `${assembly.files.index.json} `]]));
await assert.rejects(
    () => loadDsfHorizonViewerRelease({
        uid, workId, releaseId, publicMetadata, releaseMetadata,
        allowedContentOrigins: [origin], fetchImpl: corruptRemote.fetchImpl, hashBytes: sha256,
        fontRegistry: registry, documentRef: createRuntime().documentRef,
        fontRuntimeLoader: createRuntime().fontRuntimeLoader,
    }),
    (error) => error instanceof DsfHorizonViewerLoadError
        && error.issues.some((issue) => issue.code === 'HORIZON_VIEWER_JSON_HASH_MISMATCH'),
);

const wrongCapabilityRegistry = clone(registry);
wrongCapabilityRegistry.fonts['synthetic-global-sans-v1'].capabilities.languages = ['en'];
await assert.rejects(
    () => loadDsfHorizonViewerRelease({
        uid, workId, releaseId, publicMetadata,
        allowedContentOrigins: [origin], fetchImpl: createFetch().fetchImpl, hashBytes: sha256,
        fontRegistry: wrongCapabilityRegistry, documentRef: createRuntime().documentRef,
        fontRuntimeLoader: createRuntime().fontRuntimeLoader,
    }),
    (error) => error instanceof DsfHorizonViewerLoadError
        && error.issues.some((issue) => issue.code === 'HORIZON_VIEWER_FONT_CAPABILITY_MISMATCH'),
);

const escapedIndex = clone(assembly.bundle.index);
escapedIndex.languages.ja.href = '../../outside.json';
const escapedIndexJson = serializeDsfReleaseJson(escapedIndex);
const escapedMetadata = {
    ...publicMetadata,
    dsfContentHash: await sha256(encoder.encode(escapedIndexJson)),
};
const escapedRelease = { ...releaseMetadata, dsfContentHash: escapedMetadata.dsfContentHash };
const escapedRemote = createFetch(new Map([[contentUrl, escapedIndexJson]]));
await assert.rejects(
    () => loadDsfHorizonViewerRelease({
        uid, workId, releaseId, publicMetadata: escapedMetadata, releaseMetadata: escapedRelease,
        allowedContentOrigins: [origin], fetchImpl: escapedRemote.fetchImpl, hashBytes: sha256,
        fontRegistry: registry, documentRef: createRuntime().documentRef,
        fontRuntimeLoader: createRuntime().fontRuntimeLoader,
    }),
    (error) => error instanceof DsfHorizonViewerLoadError
        && error.issues.some((issue) => issue.code === 'HORIZON_VIEWER_RESOURCE_URL_OUTSIDE_RELEASE'),
);

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(viewerSource, /isDsfHorizonV2MetadataDeclared\(indexData\)/);
assert.match(viewerSource, /loadHorizonProjection\(uid, workId, indexData\.releaseId/);
assert.match(viewerSource, /loadDsfHorizonViewerRelease\(\{/);
assert.match(viewerSource, /source === 'shared' && !hasDsfPages && !options\.fixedTextContext/);
assert.match(viewerSource, /if \(v2Declared\) throw e;/,
    'Declared v2 failures must not fall back to stale v1/project data.');

console.log('DSF Horizon public Viewer v2 loader verification passed.');
