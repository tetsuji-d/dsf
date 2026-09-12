import assert from 'node:assert/strict';

import {
    DSF_PRODUCTION_FONT_REGISTRY,
    DsfFontRegistryValidationError,
    assertValidDsfProductionFontRegistry,
    normalizeDsfProductionFontRegistry,
    resolveDsfProductionFont,
    resolveDsfProductionFontByFamily,
    validateDsfProductionFontRegistry,
} from '../js/dsf-font-registry.js';

function createSyntheticRegistry(overrides = {}) {
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
                    fontWeights: [400],
                    fontStyles: ['normal'],
                },
                ...overrides,
            },
        },
    };
}

assert.equal(validateDsfProductionFontRegistry(DSF_PRODUCTION_FONT_REGISTRY).valid, true);
assert.deepEqual(Object.keys(DSF_PRODUCTION_FONT_REGISTRY.fonts), [
    'noto-sans-jp-2.004-h2',
    'noto-serif-jp-2.003-h1',
]);
assert.equal(Object.isFrozen(DSF_PRODUCTION_FONT_REGISTRY), true);
assert.equal(Object.isFrozen(DSF_PRODUCTION_FONT_REGISTRY.fonts), true);
for (const entry of Object.values(DSF_PRODUCTION_FONT_REGISTRY.fonts)) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(entry.license.reviewedAt, '2026-08-24');
    assert.equal(entry.license.reviewedBy, 'DSF Architect');
    assert.equal(entry.license.allowsWebDistribution, true);
    assert.equal(entry.license.allowsPortableEmbedding, true);
}
assert.equal(resolveDsfProductionFontByFamily(
    DSF_PRODUCTION_FONT_REGISTRY,
    "'Noto Sans JP',sans-serif",
    { language: 'ja', writingMode: 'vertical-rl', fontWeight: 700 },
).font.id, 'noto-sans-jp-2.004-h2');
assert.equal(resolveDsfProductionFontByFamily(
    DSF_PRODUCTION_FONT_REGISTRY,
    "'Noto Serif JP',serif",
    { language: 'ja', writingMode: 'horizontal-tb', fontWeight: 400 },
).font.id, 'noto-serif-jp-2.003-h1');

const synthetic = createSyntheticRegistry();
assert.equal(validateDsfProductionFontRegistry(synthetic).valid, true);
assert.equal(assertValidDsfProductionFontRegistry(synthetic), synthetic);
const normalized = normalizeDsfProductionFontRegistry(synthetic);
assert.deepEqual(normalized, synthetic);
assert.notEqual(normalized, synthetic);
normalized.fonts['synthetic-ja-sans-v1'].declaration.family = 'Changed clone';
assert.equal(synthetic.fonts['synthetic-ja-sans-v1'].declaration.family, 'Synthetic JA Sans');

const resolved = resolveDsfProductionFont(synthetic, 'synthetic-ja-sans-v1', {
    language: 'ja',
    writingMode: 'vertical-rl',
    fontWeight: 400,
    fontStyle: 'normal',
});
assert.equal(resolved.ok, true);
assert.equal(resolved.font.id, 'synthetic-ja-sans-v1');
assert.notEqual(resolved.registryEntry, synthetic.fonts['synthetic-ja-sans-v1']);
assert.equal(resolveDsfProductionFontByFamily(
    synthetic,
    "'Synthetic JA Sans',sans-serif",
    { language: 'ja', writingMode: 'vertical-rl', fontWeight: 400 },
).font.id, 'synthetic-ja-sans-v1');
assert.equal(
    resolveDsfProductionFontByFamily(synthetic, 'Missing Family', { language: 'ja' }).code,
    'FONT_NOT_CERTIFIED',
);

const resolutionFailures = [
    ['missing font', 'missing-font', { language: 'ja' }, 'FONT_NOT_CERTIFIED'],
    ['language', 'synthetic-ja-sans-v1', { language: 'en' }, 'FONT_LANGUAGE_UNSUPPORTED'],
    ['writing mode', 'synthetic-ja-sans-v1', { language: 'ja', writingMode: 'horizontal-bt' }, 'FONT_WRITING_MODE_UNSUPPORTED'],
    ['weight', 'synthetic-ja-sans-v1', { language: 'ja', fontWeight: 700 }, 'FONT_WEIGHT_UNSUPPORTED'],
    ['style', 'synthetic-ja-sans-v1', { language: 'ja', fontStyle: 'italic' }, 'FONT_STYLE_UNSUPPORTED'],
];
for (const [label, fontId, requirements, expected] of resolutionFailures) {
    const result = resolveDsfProductionFont(synthetic, fontId, requirements);
    assert.equal(result.ok, false, label);
    assert.equal(result.code, expected, label);
}

function assertInvalid(mutator, expectedCode, label) {
    const registry = createSyntheticRegistry();
    mutator(registry.fonts['synthetic-ja-sans-v1'], registry);
    const result = validateDsfProductionFontRegistry(registry);
    assert.equal(result.valid, false, label);
    assert.equal(result.issues.some((issue) => issue.code === expectedCode), true, `${label}: ${expectedCode}`);
    assert.throws(
        () => assertValidDsfProductionFontRegistry(registry),
        (error) => error instanceof DsfFontRegistryValidationError && error.code === 'DSF_FONT_REGISTRY_INVALID',
    );
}

assertInvalid((entry) => { entry.declaration.href = 'http://cdn.example.org/font.woff2'; }, 'unsafe_font_registry_url', 'HTTP asset');
assertInvalid((entry) => { entry.declaration.href = 'https://cdn.example.org/font.css'; }, 'invalid_font_asset_url', 'CSS URL');
assertInvalid((entry) => { entry.declaration.href = 'https://cdn.example.org/font.woff2?v=1'; }, 'mutable_font_asset_url', 'query URL');
assertInvalid((entry) => { entry.declaration.href = 'https://localhost/font.woff2'; }, 'non_production_font_asset_url', 'local URL');
assertInvalid((entry) => { entry.declaration.sha256 = 'not-a-real-hash'; }, 'invalid_font_asset_sha256', 'asset hash');
assertInvalid((entry) => { entry.license.reviewedAt = '2026-02-30'; }, 'invalid_font_license_review_date', 'review date');
assertInvalid((entry) => { entry.license.allowsWebDistribution = false; }, 'font_web_distribution_not_approved', 'web right');
assertInvalid((entry) => { delete entry.license.allowsPortableEmbedding; }, 'invalid_font_portable_embedding_right', 'portable right');
assertInvalid((entry) => { entry.capabilities.writingModes = ['sideways-lr']; }, 'unsupported_font_writing_mode', 'writing capability');
assertInvalid((entry) => { entry.capabilities.fontWeights = [450]; }, 'invalid_font_weight_capability', 'weight capability');
assertInvalid((entry) => { entry.declaration.extra = true; }, 'unsupported_font_registry_property', 'unknown property');

console.log('DSF production font registry verification passed');

assert.equal(resolveDsfProductionFont(DSF_PRODUCTION_FONT_REGISTRY,'noto-sans-jp-2.004-h2',{language:'en-GB',writingMode:'horizontal-tb'}).ok,true);
