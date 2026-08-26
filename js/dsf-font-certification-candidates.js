/**
 * Technically and remotely verified font certification evidence.
 *
 * This catalog is deliberately separate from DSF_PRODUCTION_FONT_REGISTRY.
 * Candidate bytes, provenance, capabilities, production CDN evidence, and the
 * Architect distribution review are recorded here. The active registry still
 * opts in explicitly through createDsfProductionFontEntryFromCandidate().
 */

export const DSF_FONT_CERTIFICATION_CANDIDATE_SCHEMA_VERSION = 1;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

const LATIN_DSF_LANGUAGE_KEYS = Object.freeze(['en', 'en-us', 'en-gb', 'fr', 'es', 'de', 'pt']);
const HORIZONTAL_AND_VERTICAL = Object.freeze(['horizontal-tb', 'vertical-rl']);
const NORMAL_STYLE = Object.freeze(['normal']);

export const DSF_FONT_CERTIFICATION_CANDIDATES = deepFreeze({
    schemaVersion: DSF_FONT_CERTIFICATION_CANDIDATE_SCHEMA_VERSION,
    candidates: {
        'noto-sans-jp-2.004-h2': {
            status: 'production-active',
            declaration: {
                family: 'Noto Sans JP',
                version: '2.004-H2',
                proposedHref: 'https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2',
            },
            source: {
                distributor: 'Google Fonts',
                repositoryHref: 'https://github.com/google/fonts',
                commit: '295d98a7a0c17c68f1341eaeea354e7960ea70d3',
                path: 'ofl/notosansjp/NotoSansJP[wght].ttf',
                upstreamRepositoryHref: 'https://github.com/notofonts/noto-cjk',
                upstreamCommit: '523d033d6cb47f4a80c58a35753646f5c3608a78',
                byteLength: 9589900,
                sha256: 'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f',
            },
            conversion: {
                format: 'woff2',
                fontToolsVersion: '4.59.0',
                brotliVersion: '1.1.0',
                subset: false,
                inspectedTableCount: 23,
                exactTableCount: 22,
                expectedHeadChanges: ['checkSumAdjustment', 'flags.bit11'],
            },
            asset: {
                fileName: 'noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2',
                format: 'woff2',
                mimeType: 'font/woff2',
                byteLength: 4350080,
                sha256: '6fd94964d1990baa2a392cea7a036683d2b80b9dfd590cb3918e8dab98d8e188',
            },
            license: {
                spdxId: 'OFL-1.1',
                licenseHref: 'https://openfontlicense.org/open-font-license-official-text/',
                rightsHolder: "Adobe (2014-2021), with Reserved Font Name 'Source'",
                allowsWebDistribution: true,
                allowsPortableEmbedding: true,
                reviewStatus: 'approved',
                reviewedAt: '2026-08-24',
                reviewedBy: 'DSF Architect',
                noticeHref: 'https://media.dsf.ink/fonts/licenses/noto-sans-jp-2.004-h2-ofl-1c05c68c34f97084.txt',
                noticeSha256: '1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9',
            },
            production: {
                status: 'verified',
                verifiedAt: '2026-08-24',
                href: 'https://media.dsf.ink/fonts/noto-sans-jp-2.004-h2-6fd94964d1990baa.woff2',
                mimeType: 'font/woff2',
                byteLength: 4350080,
                sha256: '6fd94964d1990baa2a392cea7a036683d2b80b9dfd590cb3918e8dab98d8e188',
                corsAllowOrigin: '*',
                cacheControl: 'public, max-age=31536000, immutable',
                chromiumAccepted: true,
                registryActivatedAt: '2026-08-24',
            },
            capabilities: {
                languages: ['ja', ...LATIN_DSF_LANGUAGE_KEYS],
                writingModes: HORIZONTAL_AND_VERTICAL,
                fontWeights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
                fontStyles: NORMAL_STYLE,
                glyphCount: 17936,
                unicodeCodepointCount: 16732,
                verticalFeatures: ['vert', 'vrt2'],
            },
        },
        'noto-serif-jp-2.003-h1': {
            status: 'production-active',
            declaration: {
                family: 'Noto Serif JP',
                version: '2.003-H1',
                proposedHref: 'https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2',
            },
            source: {
                distributor: 'Google Fonts',
                repositoryHref: 'https://github.com/google/fonts',
                commit: '8a7c74854f766ae441c7584925cc0ec626fc5aa6',
                path: 'ofl/notoserifjp/NotoSerifJP[wght].ttf',
                upstreamRepositoryHref: 'https://github.com/notofonts/noto-cjk',
                upstreamCommit: '985fa52c81c1d6692ccdd82bc3656e8fb932fd89',
                byteLength: 13574352,
                sha256: '2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc',
            },
            conversion: {
                format: 'woff2',
                fontToolsVersion: '4.59.0',
                brotliVersion: '1.1.0',
                subset: false,
                inspectedTableCount: 23,
                exactTableCount: 22,
                expectedHeadChanges: ['checkSumAdjustment', 'flags.bit11'],
            },
            asset: {
                fileName: 'noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2',
                format: 'woff2',
                mimeType: 'font/woff2',
                byteLength: 5965452,
                sha256: '075dddc7c1db881edb70818c6c1131085009f74086616fddb4ca805cc6b52888',
            },
            license: {
                spdxId: 'OFL-1.1',
                licenseHref: 'https://openfontlicense.org/open-font-license-official-text/',
                rightsHolder: 'Adobe (2017-2024); Noto is a trademark of Google Inc.',
                allowsWebDistribution: true,
                allowsPortableEmbedding: true,
                reviewStatus: 'approved',
                reviewedAt: '2026-08-24',
                reviewedBy: 'DSF Architect',
                noticeHref: 'https://media.dsf.ink/fonts/licenses/noto-serif-jp-2.003-h1-ofl-5e0da210fb04058a.txt',
                noticeSha256: '5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6',
            },
            production: {
                status: 'verified',
                verifiedAt: '2026-08-24',
                href: 'https://media.dsf.ink/fonts/noto-serif-jp-2.003-h1-075dddc7c1db881e.woff2',
                mimeType: 'font/woff2',
                byteLength: 5965452,
                sha256: '075dddc7c1db881edb70818c6c1131085009f74086616fddb4ca805cc6b52888',
                corsAllowOrigin: '*',
                cacheControl: 'public, max-age=31536000, immutable',
                chromiumAccepted: true,
                registryActivatedAt: '2026-08-24',
            },
            capabilities: {
                languages: ['ja', ...LATIN_DSF_LANGUAGE_KEYS],
                writingModes: HORIZONTAL_AND_VERTICAL,
                fontWeights: [200, 300, 400, 500, 600, 700, 800, 900],
                fontStyles: NORMAL_STYLE,
                glyphCount: 17923,
                unicodeCodepointCount: 16726,
                verticalFeatures: ['vert', 'vrt2'],
            },
        },
    },
});

export function getDsfFontCertificationCandidate(candidateId) {
    return DSF_FONT_CERTIFICATION_CANDIDATES.candidates[String(candidateId || '').trim()] || null;
}

export class DsfFontCandidateActivationError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'DsfFontCandidateActivationError';
        this.code = code;
        this.context = context;
    }
}

const REQUIRED_REMOTE_EVIDENCE = Object.freeze([
    'assetBytesVerified',
    'corsVerified',
    'mimeTypeVerified',
    'immutableCacheVerified',
    'licenseReviewed',
    'allowsWebDistribution',
    'allowsPortableEmbedding',
]);

/**
 * Project one reviewed candidate into the production registry entry shape.
 *
 * This helper does not activate the entry. DSF_PRODUCTION_FONT_REGISTRY must
 * still opt in explicitly after the returned entry passes its strict validator.
 */
export function createDsfProductionFontEntryFromCandidate(candidateId, review = {}) {
    const normalizedId = String(candidateId || '').trim();
    const candidate = getDsfFontCertificationCandidate(normalizedId);
    if (!candidate) {
        throw new DsfFontCandidateActivationError(
            'FONT_CANDIDATE_NOT_FOUND',
            'The requested font certification candidate does not exist.',
            { candidateId: normalizedId },
        );
    }
    if (review.assetHref !== candidate.declaration.proposedHref) {
        throw new DsfFontCandidateActivationError(
            'FONT_CANDIDATE_ASSET_URL_UNCONFIRMED',
            'The reviewed production asset URL must exactly match the candidate URL.',
            { candidateId: normalizedId, expected: candidate.declaration.proposedHref },
        );
    }
    for (const field of REQUIRED_REMOTE_EVIDENCE) {
        if (review[field] !== true) {
            throw new DsfFontCandidateActivationError(
                'FONT_CANDIDATE_REVIEW_INCOMPLETE',
                `Production activation requires explicit ${field} evidence.`,
                { candidateId: normalizedId, field },
            );
        }
    }
    const reviewedAt = String(review.reviewedAt || '').trim();
    const reviewedBy = String(review.reviewedBy || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt) || !reviewedBy) {
        throw new DsfFontCandidateActivationError(
            'FONT_CANDIDATE_REVIEW_IDENTITY_REQUIRED',
            'Production activation requires reviewedAt (YYYY-MM-DD) and reviewedBy.',
            { candidateId: normalizedId },
        );
    }
    return deepFreeze({
        declaration: {
            family: candidate.declaration.family,
            version: candidate.declaration.version,
            source: 'registry',
            href: candidate.declaration.proposedHref,
            sha256: candidate.asset.sha256,
        },
        asset: {
            format: candidate.asset.format,
            mimeType: candidate.asset.mimeType,
            byteLength: candidate.asset.byteLength,
            immutable: true,
        },
        license: {
            spdxId: candidate.license.spdxId,
            licenseHref: candidate.license.licenseHref,
            rightsHolder: candidate.license.rightsHolder,
            reviewedAt,
            reviewedBy,
            allowsWebDistribution: true,
            allowsPortableEmbedding: true,
        },
        capabilities: {
            languages: candidate.capabilities.languages,
            writingModes: candidate.capabilities.writingModes,
            fontWeights: candidate.capabilities.fontWeights,
            fontStyles: candidate.capabilities.fontStyles,
        },
    });
}
