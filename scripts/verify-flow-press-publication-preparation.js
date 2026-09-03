import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DSF_PRODUCTION_FONT_REGISTRY,
    resolveDsfProductionFontByFamily,
    validateDsfProductionFontRegistry,
} from '../js/dsf-font-registry.js';
import {
    getFlowPressPublicationPreparationIssueMessage,
    prepareFlowPressPublication,
} from '../js/flow-press-publication-preparation.js';

function createSyntheticRegistry() {
    return {
        schemaVersion: 1,
        registryKind: 'production',
        fonts: {
            'synthetic-ja-sans-v1': {
                declaration: {
                    family: 'Synthetic JA Sans',
                    version: '1.0.0-test',
                    source: 'registry',
                    href: 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-sans-v1.woff2',
                    sha256: 'a'.repeat(64),
                },
                asset: {
                    format: 'woff2',
                    mimeType: 'font/woff2',
                    byteLength: 123456,
                    immutable: true,
                },
                license: {
                    spdxId: 'OFL-1.1',
                    licenseHref: 'https://unit-test-fonts.dsf-format.org/licenses/ofl-1.1',
                    rightsHolder: 'Synthetic test fixture only',
                    reviewedAt: '2026-08-23',
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

const syntheticRegistry = createSyntheticRegistry();
assert.equal(validateDsfProductionFontRegistry(syntheticRegistry).valid, true);
assert.equal(
    resolveDsfProductionFontByFamily(
        syntheticRegistry,
        "'Synthetic JA Sans',sans-serif",
        { language: 'ja', writingMode: 'vertical-rl', fontWeight: 700 },
    ).font.id,
    'synthetic-ja-sans-v1',
);
assert.equal(
    resolveDsfProductionFontByFamily(syntheticRegistry, 'Uncertified Font', { language: 'ja' }).code,
    'FONT_NOT_CERTIFIED',
);
const ambiguousRegistry = structuredClone(syntheticRegistry);
ambiguousRegistry.fonts['synthetic-ja-sans-v2'] = structuredClone(
    ambiguousRegistry.fonts['synthetic-ja-sans-v1'],
);
ambiguousRegistry.fonts['synthetic-ja-sans-v2'].declaration.version = '2.0.0-test';
ambiguousRegistry.fonts['synthetic-ja-sans-v2'].declaration.href = 'https://unit-test-fonts.dsf-format.org/assets/synthetic-ja-sans-v2.woff2';
ambiguousRegistry.fonts['synthetic-ja-sans-v2'].declaration.sha256 = 'b'.repeat(64);
assert.equal(
    resolveDsfProductionFontByFamily(ambiguousRegistry, 'Synthetic JA Sans', { language: 'ja' }).code,
    'FONT_FAMILY_AMBIGUOUS',
);

const flow = {
    id: 'flow-a',
    kind: 'flow',
    flow: { layout: { typographyByLanguage: { ja: { writingMode: 'vertical-rl' } } } },
};
const project = { version: 6, defaultLang: 'ja', languages: ['ja'], blocks: [flow] };
const emptyRegistry = { schemaVersion: 1, registryKind: 'production', fonts: {} };
let captureCount = 0;
const blocked = await prepareFlowPressPublication({
    project,
    revision: 7,
    documentRef: {},
    fontRegistry: emptyRegistry,
    dependencies: {
        deriveTranslationStatus() {
            return { isSourceLanguage: true, requiresSourceFallback: false };
        },
        resolveTypography() {
            return { fontFamily: "'Noto Sans JP',sans-serif", fontWeight: 400 };
        },
        async createCaptureSession() {
            captureCount += 1;
            throw new Error('empty production registry must stop before capture');
        },
        createPreflight() {
            return {
                publishable: false,
                issues: [{ code: 'FLOW_PUBLICATION_PROJECTION_MISSING' }],
                summary: { flowPageCount: 0, deliveryPageCount: 0 },
            };
        },
    },
});
assert.equal(blocked.ok, false);
assert.equal(blocked.preparationKind, 'production');
assert.equal(blocked.productionFontCount, 0);
assert.equal(blocked.languages[0].preparationIssues[0].code, 'FONT_NOT_CERTIFIED');
assert.equal(captureCount, 0);
assert.match(
    getFlowPressPublicationPreparationIssueMessage(blocked.languages[0].preparationIssues[0]),
    /まだ認定されていません/,
);

const captureCalls = [];
const disposed = [];
const leaseDisposed = [];
const ready = await prepareFlowPressPublication({
    project,
    revision: 8,
    documentRef: {},
    fontRegistry: syntheticRegistry,
    dependencies: {
        deriveTranslationStatus() {
            return { isSourceLanguage: true, requiresSourceFallback: false };
        },
        resolveTypography() {
            return { fontFamily: "'Synthetic JA Sans',sans-serif", fontWeight: 400 };
        },
        async prepareProductionFont(context) {
            assert.equal(context.fontResolution.fontId, 'synthetic-ja-sans-v1');
            return {
                runtimeFontFamily: 'DSF Verified synthetic-ja-sans-v1 aaaaaaaaaaaa',
                evidence: { sha256: 'a'.repeat(64) },
                dispose() {
                    leaseDisposed.push(context.fontResolution.fontId);
                },
            };
        },
        async createCaptureSession(options) {
            captureCalls.push({
                fontId: options.fontId,
                language: options.language,
                revision: options.revision,
                runtimeFontFamily: options.runtimeFontFamily,
            });
            return {
                paginate() {
                    return { pages: [{}, {}] };
                },
                capture() {
                    return { status: 'complete' };
                },
                dispose() {
                    disposed.push(options.fontId);
                },
            };
        },
        projectFlow(options) {
            return {
                ok: true,
                summary: { pageCount: options.pagination.pages.length, lineCount: 4 },
                manifest: { pages: options.pagination.pages },
            };
        },
        createPreflight(input) {
            const projection = input.flowPublicationProjections['flow-a'];
            return {
                publishable: !!projection,
                issues: [],
                summary: { flowPageCount: projection.summary.pageCount, deliveryPageCount: projection.summary.pageCount },
            };
        },
    },
});
assert.equal(ready.ok, true);
assert.equal(ready.productionFontCount, 1);
assert.equal(ready.languages[0].state, 'ready');
assert.equal(ready.languages[0].groupResults[0].fontId, 'synthetic-ja-sans-v1');
assert.equal(ready.languages[0].groupResults[0].fontAssetSha256, 'a'.repeat(64));
assert.deepEqual(captureCalls, [{
    fontId: 'synthetic-ja-sans-v1',
    language: 'ja',
    revision: 8,
    runtimeFontFamily: 'DSF Verified synthetic-ja-sans-v1 aaaaaaaaaaaa',
}]);
assert.deepEqual(disposed, ['synthetic-ja-sans-v1']);
assert.deepEqual(leaseDisposed, ['synthetic-ja-sans-v1']);

for (const explicitFamily of [undefined, "'Noto Sans JP',sans-serif"]) {
    const inheritedProject = structuredClone(project);
    inheritedProject.languageConfigs = { ja: { fontPreset: 'mincho' } };
    if (explicitFamily !== undefined) {
        inheritedProject.blocks[0].flow.layout.typographyByLanguage.ja.fontFamily = explicitFamily;
    }
    const inheritedBefore = structuredClone(inheritedProject);
    const expectedFamily = explicitFamily ? 'Noto Sans JP' : 'Noto Serif JP';
    const expectedFontId = explicitFamily ? 'noto-sans-jp-2.004-h2' : 'noto-serif-jp-2.003-h1';
    const inherited = await prepareFlowPressPublication({
        project: inheritedProject,
        revision: 9,
        documentRef: {},
        dependencies: {
            deriveTranslationStatus() {
                return { isSourceLanguage: true, requiresSourceFallback: false };
            },
            async prepareProductionFont(context) {
                assert.equal(context.fontResolution.fontId, expectedFontId);
                assert.ok(context.typography.fontFamily.includes(expectedFamily));
                return { runtimeFontFamily: `Verified ${expectedFamily}`, dispose() {} };
            },
            async createCaptureSession(options) {
                assert.equal(options.fontId, expectedFontId);
                assert.deepEqual(options.languageConfigs, inheritedBefore.languageConfigs,
                    'production capture must receive project typography settings');
                return {
                    paginate() { return { pages: [{}] }; },
                    capture() { return { status: 'complete' }; },
                    dispose() {},
                };
            },
            projectFlow(options) {
                assert.equal(options.fontId, expectedFontId);
                assert.deepEqual(options.languageConfigs, inheritedBefore.languageConfigs,
                    'production projection must certify against the same project settings');
                return { ok: true, summary: { pageCount: 1, lineCount: 1 }, manifest: { pages: [{}] } };
            },
            createPreflight() {
                return { publishable: true, issues: [], summary: { flowPageCount: 1, deliveryPageCount: 1 } };
            },
        },
    });
    assert.equal(inherited.ok, true);
    assert.equal(inherited.languages[0].groupResults[0].fontId, expectedFontId,
        'project font inheritance must preserve an explicit Flow font override');
    assert.deepEqual(inheritedProject, inheritedBefore, 'production preparation cannot persist resolved defaults');
}

assert.deepEqual(Object.keys(DSF_PRODUCTION_FONT_REGISTRY.fonts), [
    'noto-sans-jp-2.004-h2',
    'noto-serif-jp-2.003-h1',
]);

const productionSource = readFileSync(new URL('../js/flow-press-publication-preparation.js', import.meta.url), 'utf8');
const sharedSource = readFileSync(new URL('../js/flow-press-preflight-preparation.js', import.meta.url), 'utf8');
for (const source of [productionSource, sharedSource]) {
    for (const forbidden of ['./firebase', './export', './dsf-release-assembly', 'uploadPressPage', 'setDoc(', 'fetch(']) {
        assert.equal(source.includes(forbidden), false, `9A-6B preparation cannot depend on ${forbidden}`);
    }
}
assert.equal(productionSource.includes('./fixtures/'), false, 'production preparation cannot import development fixtures');

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-publication-preparation\.js'\)/);
assert.match(pressSource, /summary\.dataset\.testid = 'press-flow-production-preparation-summary'/);
assert.match(pressSource, /_pressFlowProductionPreparationResult\.ok \? 'ready' : 'blocked'/);
assert.match(pressSource, /void _requestPressFlowProductionPreparation\(\);[\s\S]*if \(import\.meta\.env\.DEV\)/);
assert.match(pressSource, /const flowPortableReady = hasFlow && _isPressFlowPortableDownloadReady\(\)/);
assert.match(pressSource, /isPortableDownload[\s\S]*btn\.disabled = !flowPortableReady/);
assert.match(pressSource, /if \(hasFlowGroups\(state\)\)[\s\S]*await uploadFlowHorizonReleaseFiles\(\)/);
assert.match(pressSource, /if \(hasFlow && isHorizonPublish\)[\s\S]*btn\.disabled = !flowHorizonReady \|\| working \|\| saved/);
assert.match(exportSource, /if \(hasFlowGroups\(state\)\)[\s\S]*getFlowPortableDsfDownloadArtifact/);
assert.match(exportSource, /saveAs\(currentArtifact\.blob, currentArtifact\.filename\)/);

console.log('Flow Press production preparation gate verification passed.');
