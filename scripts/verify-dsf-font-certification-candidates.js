import assert from 'node:assert/strict';

import {
    DSF_FONT_CERTIFICATION_CANDIDATES,
    DsfFontCandidateActivationError,
    createDsfProductionFontEntryFromCandidate,
    getDsfFontCertificationCandidate,
} from '../js/dsf-font-certification-candidates.js';
import {
    DSF_PRODUCTION_FONT_REGISTRY,
    validateDsfProductionFontRegistry,
} from '../js/dsf-font-registry.js';

const EXPECTED_IDS = [
    'noto-sans-jp-2.004-h2',
    'noto-serif-jp-2.003-h1',
];

assert.equal(DSF_FONT_CERTIFICATION_CANDIDATES.schemaVersion, 1);
assert.deepEqual(Object.keys(DSF_FONT_CERTIFICATION_CANDIDATES.candidates), EXPECTED_IDS);
assert.equal(Object.isFrozen(DSF_FONT_CERTIFICATION_CANDIDATES), true);
assert.deepEqual(Object.keys(DSF_PRODUCTION_FONT_REGISTRY.fonts), EXPECTED_IDS);

for (const candidateId of EXPECTED_IDS) {
    const candidate = getDsfFontCertificationCandidate(candidateId);
    assert.ok(candidate, candidateId);
    assert.equal(candidate.status, 'production-active', candidateId);
    assert.equal(candidate.asset.format, 'woff2', candidateId);
    assert.equal(candidate.asset.mimeType, 'font/woff2', candidateId);
    assert.match(candidate.asset.sha256, /^[a-f0-9]{64}$/, candidateId);
    assert.match(candidate.source.sha256, /^[a-f0-9]{64}$/, candidateId);
    assert.equal(candidate.asset.byteLength > 4_000_000, true, candidateId);
    assert.equal(candidate.source.byteLength > candidate.asset.byteLength, true, candidateId);
    assert.equal(candidate.declaration.proposedHref.endsWith(candidate.asset.fileName), true, candidateId);
    assert.equal(candidate.asset.fileName.includes(candidate.asset.sha256.slice(0, 16)), true, candidateId);
    assert.equal(candidate.conversion.subset, false, candidateId);
    assert.equal(candidate.conversion.inspectedTableCount, 23, candidateId);
    assert.equal(candidate.conversion.exactTableCount, 22, candidateId);
    assert.deepEqual(candidate.conversion.expectedHeadChanges, ['checkSumAdjustment', 'flags.bit11'], candidateId);
    assert.equal(candidate.capabilities.languages.includes('ja'), true, candidateId);
    assert.deepEqual(candidate.capabilities.writingModes, ['horizontal-tb', 'vertical-rl'], candidateId);
    assert.equal(candidate.capabilities.fontWeights.includes(400), true, candidateId);
    assert.equal(candidate.capabilities.fontWeights.includes(700), true, candidateId);
    assert.deepEqual(candidate.capabilities.verticalFeatures, ['vert', 'vrt2'], candidateId);
    assert.equal(candidate.license.reviewStatus, 'approved', candidateId);
    assert.equal(candidate.license.reviewedAt, '2026-08-24', candidateId);
    assert.equal(candidate.license.reviewedBy, 'DSF Architect', candidateId);
    assert.equal(candidate.license.noticeHref.startsWith('https://media.dsf.ink/fonts/licenses/'), true, candidateId);
    assert.match(candidate.license.noticeSha256, /^[a-f0-9]{64}$/, candidateId);
    assert.equal(candidate.production.status, 'verified', candidateId);
    assert.equal(candidate.production.href, candidate.declaration.proposedHref, candidateId);
    assert.equal(candidate.production.byteLength, candidate.asset.byteLength, candidateId);
    assert.equal(candidate.production.sha256, candidate.asset.sha256, candidateId);
    assert.equal(candidate.production.mimeType, candidate.asset.mimeType, candidateId);
    assert.equal(candidate.production.corsAllowOrigin, '*', candidateId);
    assert.equal(candidate.production.cacheControl, 'public, max-age=31536000, immutable', candidateId);
    assert.equal(candidate.production.chromiumAccepted, true, candidateId);
    assert.equal(candidate.production.registryActivatedAt, '2026-08-24', candidateId);
    assert.equal(Object.isFrozen(candidate), true, candidateId);
    assert.equal(Object.isFrozen(candidate.capabilities.fontWeights), true, candidateId);
}

assert.equal(getDsfFontCertificationCandidate('missing'), null);

assert.throws(
    () => createDsfProductionFontEntryFromCandidate('missing', {}),
    (error) => error instanceof DsfFontCandidateActivationError && error.code === 'FONT_CANDIDATE_NOT_FOUND',
);
assert.throws(
    () => createDsfProductionFontEntryFromCandidate(EXPECTED_IDS[0], { assetHref: 'https://media.dsf.ink/fonts/wrong.woff2' }),
    (error) => error instanceof DsfFontCandidateActivationError && error.code === 'FONT_CANDIDATE_ASSET_URL_UNCONFIRMED',
);

function completedReview(candidateId) {
    return {
        assetHref: getDsfFontCertificationCandidate(candidateId).declaration.proposedHref,
        assetBytesVerified: true,
        corsVerified: true,
        mimeTypeVerified: true,
        immutableCacheVerified: true,
        licenseReviewed: true,
        allowsWebDistribution: true,
        allowsPortableEmbedding: true,
        reviewedAt: getDsfFontCertificationCandidate(candidateId).license.reviewedAt,
        reviewedBy: getDsfFontCertificationCandidate(candidateId).license.reviewedBy,
    };
}

const incompleteReview = completedReview(EXPECTED_IDS[0]);
incompleteReview.corsVerified = false;
assert.throws(
    () => createDsfProductionFontEntryFromCandidate(EXPECTED_IDS[0], incompleteReview),
    (error) => (
        error instanceof DsfFontCandidateActivationError
        && error.code === 'FONT_CANDIDATE_REVIEW_INCOMPLETE'
        && error.context.field === 'corsVerified'
    ),
);

const projectedFonts = Object.fromEntries(EXPECTED_IDS.map((candidateId) => [
    candidateId,
    createDsfProductionFontEntryFromCandidate(candidateId, completedReview(candidateId)),
]));
const projectedRegistry = {
    schemaVersion: 1,
    registryKind: 'production',
    fonts: projectedFonts,
};
assert.deepEqual(validateDsfProductionFontRegistry(projectedRegistry), { valid: true, issues: [] });
assert.equal(Object.isFrozen(projectedFonts[EXPECTED_IDS[0]]), true);
assert.deepEqual(DSF_PRODUCTION_FONT_REGISTRY.fonts, projectedFonts);

console.log('DSF Noto JP font certification candidate verification passed');
