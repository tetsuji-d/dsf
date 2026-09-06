import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    getFlowPressPreflightPreviewIssueMessage,
    prepareFlowPressPreflightPreview,
} from '../js/flow-press-preflight-preview.js';
import {
    FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY,
    resolveFlowPressPreflightFixtureFont,
} from '../js/fixtures/flow-press-preflight-fixture.js';
import { validateDsfProductionFontRegistry } from '../js/dsf-font-registry.js';

assert.equal(validateDsfProductionFontRegistry(FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY).valid, true);
assert.equal(resolveFlowPressPreflightFixtureFont("'Noto Sans JP',sans-serif", 'ja', 'vertical-rl')?.fontId, 'fixture-flow-press-noto-sans-jp');
assert.equal(resolveFlowPressPreflightFixtureFont("'Noto Sans',sans-serif", 'en', 'horizontal-tb')?.fontId, 'fixture-flow-press-noto-sans');
assert.equal(resolveFlowPressPreflightFixtureFont("'Noto Sans',sans-serif", 'ja', 'horizontal-tb'), null);

const flowA = { id: 'flow-a', kind: 'flow', flow: { layout: { typographyByLanguage: { ja: {}, en: {} } } } };
const flowB = { id: 'flow-b', kind: 'flow', flow: { layout: { typographyByLanguage: { ja: {}, en: {} } } } };
const fixed = { id: 'fixed-a', kind: 'page', content: { pageKind: 'graphic' } };
const project = {
    version: 6,
    defaultLang: 'ja',
    languages: ['ja', 'en'],
    languageConfigs: { ja: { fontPreset: 'mincho' }, en: { fontPreset: 'gothic' } },
    blocks: [fixed, flowA, flowB],
};
const projectBefore = structuredClone(project);
const disposed = [];
const captureCalls = [];
const preflightCalls = [];

const result = await prepareFlowPressPreflightPreview({
    project,
    languages: ['ja', 'en'],
    revision: 42,
    documentRef: {},
    dependencies: {
        deriveTranslationStatus(group, language) {
            return {
                isSourceLanguage: language === 'ja',
                requiresSourceFallback: language === 'en' && group.id === 'flow-b',
            };
        },
        resolveTypography(language, profile, writingMode, options) {
            assert.deepEqual(options.languageConfigs, projectBefore.languageConfigs);
            assert.notEqual(options.languageConfigs, project.languageConfigs,
                'preparation must capture settings before asynchronous font work');
            return { fontFamily: language === 'ja' ? "'Noto Sans JP',sans-serif" : "'Noto Sans',sans-serif" };
        },
        resolveFixtureFont(fontFamily, language) {
            return { fontId: `fixture-${language}-${fontFamily.includes(' JP') ? 'jp' : 'latin'}` };
        },
        async createCaptureSession(options) {
            assert.deepEqual(options.languageConfigs, projectBefore.languageConfigs,
                'capture must use the same project font settings as font resolution');
            captureCalls.push({ groupId: options.flowGroup.id, language: options.language, revision: options.revision });
            return {
                paginate() {
                    return { pages: options.flowGroup.id === 'flow-a' ? [{}, {}] : [{}] };
                },
                capture() {
                    return { status: 'complete' };
                },
                dispose() {
                    disposed.push(`${options.language}:${options.flowGroup.id}`);
                },
            };
        },
        projectFlow(options) {
            assert.deepEqual(options.languageConfigs, projectBefore.languageConfigs,
                'strict publication projection must use the capture font settings');
            const pageCount = options.pagination.pages.length;
            return {
                ok: true,
                summary: { pageCount, lineCount: pageCount * 3 },
                manifest: { pages: options.pagination.pages },
            };
        },
        createPreflight(input) {
            preflightCalls.push(input);
            const projectionCount = Object.keys(input.flowPublicationProjections).length;
            const publishable = projectionCount === 2;
            return {
                publishable,
                issues: publishable ? [] : [{ code: 'FLOW_PUBLICATION_PROJECTION_MISSING' }],
                summary: {
                    flowPageCount: Object.values(input.flowPublicationProjections)
                        .reduce((sum, projection) => sum + projection.summary.pageCount, 0),
                    deliveryPageCount: 1 + Object.values(input.flowPublicationProjections)
                        .reduce((sum, projection) => sum + projection.summary.pageCount, 0),
                    imagePageCount: 1,
                    fixedTextPageCount: Object.values(input.flowPublicationProjections)
                        .reduce((sum, projection) => sum + projection.summary.pageCount, 0),
                },
            };
        },
    },
});

assert.equal(result.ok, false);
assert.equal(result.revision, 42);
assert.equal(result.languages[0].state, 'ready');
assert.equal(result.languages[0].preflight.summary.flowPageCount, 3);
assert.equal(result.languages[1].state, 'blocked');
assert.equal(result.languages[1].groupResults[1].issue.code, 'FLOW_PUBLICATION_TRANSLATION_NOT_READY');
assert.match(getFlowPressPreflightPreviewIssueMessage(result.languages[1].groupResults[1].issue), /原文へ代替せず停止/);
assert.deepEqual(captureCalls, [
    { groupId: 'flow-a', language: 'ja', revision: 42 },
    { groupId: 'flow-b', language: 'ja', revision: 42 },
    { groupId: 'flow-a', language: 'en', revision: 42 },
]);
assert.deepEqual(disposed, ['ja:flow-a', 'ja:flow-b', 'en:flow-a']);
assert.deepEqual(preflightCalls[0].flowPublicationRevisions, { 'flow-a': 42, 'flow-b': 42 });
assert.deepEqual(Object.keys(preflightCalls[1].flowPublicationProjections), ['flow-a']);
assert.deepEqual(project, projectBefore, 'font inheritance cannot rewrite source groups or project settings');

await assert.rejects(
    () => prepareFlowPressPreflightPreview({ project, revision: -1 }),
    /non-negative revision/,
);

const moduleSource = readFileSync(new URL('../js/flow-press-preflight-preview.js', import.meta.url), 'utf8');
for (const forbidden of ['./firebase', './export', './dsf-release-assembly', 'uploadPressPage', 'setDoc', 'fetch(']) {
    assert.equal(moduleSource.includes(forbidden), false, `9A-6A adapter cannot depend on ${forbidden}`);
}

const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
const signatureBody = pressSource.match(/function _createPressFlowPreflightPreviewSignature\(\) \{([\s\S]*?)\n\}/)?.[1];
assert.ok(signatureBody, 'Press Flow signature must remain inspectable');
const makePressSignature = new Function('state', '_getSelectedPressLangs', signatureBody);
const originalSignature = makePressSignature(project, () => ['ja']);
const changedFontProject = structuredClone(project);
changedFontProject.languageConfigs.ja.fontPreset = 'gothic';
assert.notEqual(makePressSignature(changedFontProject, () => ['ja']), originalSignature,
    'font setting changes must invalidate prepared Flow pages and portable ZIP readiness');
const studioCssSource = readFileSync(new URL('../css/studio.css', import.meta.url), 'utf8');
assert.match(pressSource, /import\.meta\.env\.DEV[\s\S]*import\('\.\/flow-press-preflight-preview\.js'\)/);
assert.match(pressSource, /summary\.dataset\.testid = 'press-flow-preflight-dev-summary'/);
assert.match(pressSource, /btn\.disabled = hasFlow/);
assert.match(pressSource, /if \(hasFlowGroups\(state\)\)[\s\S]*await uploadFlowHorizonReleaseFiles\(\)/);
assert.match(pressSource, /if \(hasFlow && isHorizonPublish\)[\s\S]*btn\.disabled = !flowHorizonReady \|\| working \|\| saved/,
    'Flow Horizon draft save must remain gated by verified handoff readiness');
assert.match(studioCssSource, /\.press-publish-btn:disabled\s*\{/);

console.log('Flow Press preflight local preview verification passed.');

assert.notEqual(makePressSignature({...project,book:{mode:'none'}},()=>['ja']),makePressSignature({...project,book:{mode:'full'}},()=>['ja']),'cover setting must invalidate publication readiness');
