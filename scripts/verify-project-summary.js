import assert from 'node:assert/strict';
import {
    PROJECT_SUMMARY_MAX_BYTES,
    PROJECT_SUMMARY_SCHEMA_VERSION,
    assertProjectSummary,
    createProjectSummary,
    createProjectSummaryForPatch,
    measureProjectSummaryBytes,
} from '../js/project-summary.js';

const now = new Date('2026-09-02T12:00:00.000Z');
const source = {
    version: 6,
    projectId: 'project_1',
    workId: 'work_1',
    projectName: 'Long novel',
    title: 'A fixed-layout story',
    languages: ['JA', 'en', 'ja'],
    listThumbnail: 'https://media.dsf.ink/thumb.webp',
    pageCount: 128,
    projectBytes: 2_000_000,
    lastUpdated: now,
    releaseId: 'release_1',
    dsfStatus: 'public',
    visibility: 'public',
    dsfPublishedAt: now,
    dsfPageCounts: { ja: 128, en: 121 },
    dsfLangs: ['ja', 'en'],
    dsfTotalBytes: 8_000_000,
    dsfResolution: '1080x1920',
    dsfQuality: 0.86,
    publication: {
        listedFrom: now,
        listedUntil: now,
        publicFrom: now,
        publicUntil: null,
        planSnapshot: { tier: 'pro', internal: 'must-not-copy' },
    },
    blocks: [{ kind: 'flow', flow: { document: { sections: ['semantic source'] } } }],
    sections: new Array(128).fill({ text: 'authoring source' }),
    pages: new Array(128).fill({ content: 'fixed authoring page' }),
    dsfPages: new Array(128).fill('https://media.dsf.ink/page.webp'),
    meta: { ja: { description: 'private authoring metadata' } },
    authoringRef: 'authoring/current',
};

const summary = createProjectSummary(source);

assert.equal(summary.schemaVersion, PROJECT_SUMMARY_SCHEMA_VERSION);
assert.equal(summary.projectId, 'project_1');
assert.equal(summary.hasPublishedDsf, true);
assert.equal(summary.dsfPageCount, 128);
assert.deepEqual(summary.languages, ['ja', 'en']);
assert.equal(summary.publication.planSnapshot, undefined);
for (const field of ['blocks', 'sections', 'pages', 'dsfPages', 'meta', 'authoringRef']) {
    assert.equal(Object.hasOwn(summary, field), false, `${field} must not enter the summary`);
}
assert.ok(measureProjectSummaryBytes(summary) < PROJECT_SUMMARY_MAX_BYTES);
assert.equal(assertProjectSummary(summary), summary);

const legacySummary = createProjectSummary({
    version: 5,
    projectId: 'legacy',
    dsfPages: ['one.webp', 'two.webp'],
    listThumbnail: 'blob:unsafe-local-preview',
});
assert.equal(legacySummary.hasPublishedDsf, true);
assert.equal(legacySummary.dsfPageCount, 2);
assert.equal(legacySummary.listThumbnail, '');

const canonicalUrlSummary = createProjectSummary({
    version: 6,
    projectId: 'canonical_url',
    listThumbnail: 'HTTPS://media.dsf.ink/thumb.webp',
});
assert.equal(canonicalUrlSummary.listThumbnail, 'https://media.dsf.ink/thumb.webp');

const patchedSummary = createProjectSummaryForPatch({
    version: 6,
    projectId: 'patched',
    title: 'Preserved title',
    listThumbnail: 'https://media.dsf.ink/preserved.webp',
    lastUpdated: now,
    dsfPageCount: 42,
}, {
    dsfStatus: 'public',
    visibility: 'public',
});
assert.equal(patchedSummary.title, 'Preserved title');
assert.equal(patchedSummary.listThumbnail, 'https://media.dsf.ink/preserved.webp');
assert.equal(patchedSummary.dsfPageCount, 42);
assert.equal(patchedSummary.hasPublishedDsf, true);
assert.equal(patchedSummary.dsfStatus, 'public');

const normalizedLegacyFields = createProjectSummary({
    version: 5,
    projectId: 'legacy_fields',
    dsfStatus: 'published',
    visibility: 'draft',
    dsfQuality: 150,
});
assert.equal(normalizedLegacyFields.dsfStatus, 'draft');
assert.equal(normalizedLegacyFields.visibility, 'private');
assert.equal(normalizedLegacyFields.dsfQuality, 100);

assert.throws(
    () => assertProjectSummary({ ...summary, blocks: [] }),
    /must not contain blocks/
);
assert.throws(
    () => assertProjectSummary({ ...summary, title: 'x'.repeat(PROJECT_SUMMARY_MAX_BYTES) }),
    /exceeds 32768 bytes/
);
assert.throws(
    () => createProjectSummary({ title: 'missing id' }),
    /requires projectId/
);

console.log('Project summary contract verification passed.');
