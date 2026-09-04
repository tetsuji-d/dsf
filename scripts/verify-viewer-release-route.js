import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    assertRequestedViewerReleaseIsCurrent,
    buildPublicViewerUrl,
    normalizeRequestedViewerReleaseId,
} from '../js/viewer-release-route.js';

assert.equal(
    buildPublicViewerUrl('https://staging.dsf-studio.pages.dev', 'work_1'),
    'https://staging.dsf-studio.pages.dev/viewer?work=work_1',
    'An omitted Release ID must preserve the legacy public Viewer URL.',
);
assert.equal(
    buildPublicViewerUrl('https://staging.dsf-studio.pages.dev', 'work_1', 'release-1'),
    'https://staging.dsf-studio.pages.dev/viewer?work=work_1&r=release-1',
    'A public Viewer URL must carry an explicit current Release lock.',
);
assert.equal(
    buildPublicViewerUrl('https://staging.dsf-studio.pages.dev', '20290901FLOWテスト'),
    'https://staging.dsf-studio.pages.dev/viewer?work=20290901FLOW%E3%83%86%E3%82%B9%E3%83%88',
    'Legacy v1 Firestore document IDs may contain safely encoded Unicode.',
);
for (const invalidOrigin of ['javascript:alert(1)', 'file:///tmp/dsf', 'https://user:pass@example.com']) {
    assert.throws(
        () => buildPublicViewerUrl(invalidOrigin, 'work_1', 'release-1'),
        (error) => error?.code === 'VIEWER_ORIGIN_INVALID',
        `Unsafe Viewer origin must fail: ${invalidOrigin}`,
    );
}
for (const invalidWorkId of ['', ' work_1', 'work/1', '../work_1', '.', '..', '__reserved__', `work_${'x'.repeat(1500)}`]) {
    assert.throws(
        () => buildPublicViewerUrl('https://example.com', invalidWorkId, 'release-1'),
        (error) => error?.code === 'VIEWER_WORK_ID_INVALID',
        `Unsafe Work ID must fail: ${JSON.stringify(invalidWorkId)}`,
    );
}
assert.throws(
    () => buildPublicViewerUrl('https://example.com', 'work_1', '../release-1'),
    (error) => error?.code === 'VIEWER_RELEASE_ID_INVALID',
    'Unsafe Release ID must fail while building a public Viewer URL.',
);

assert.equal(normalizeRequestedViewerReleaseId(null), '');
assert.equal(normalizeRequestedViewerReleaseId('rel_2026-09-05'), 'rel_2026-09-05');
assert.equal(assertRequestedViewerReleaseIsCurrent('', ''), '',
    'Unversioned legacy v1 URLs must remain valid without a Release ID.');
assert.equal(
    assertRequestedViewerReleaseIsCurrent('release-1', 'release-1'),
    'release-1',
    'A release lock must accept the exact currently published Release.',
);

for (const invalid of [' release-1', 'release-1 ', 'release/1', '../release-1', 'release%2F1', '\nrelease-1']) {
    assert.throws(
        () => normalizeRequestedViewerReleaseId(invalid),
        (error) => error?.code === 'VIEWER_RELEASE_ID_INVALID',
        `Unsafe requested Release ID must fail: ${JSON.stringify(invalid)}`,
    );
}
assert.throws(
    () => assertRequestedViewerReleaseIsCurrent('release-1', ''),
    (error) => error?.code === 'VIEWER_RELEASE_UNAVAILABLE',
    'A locked URL must not fall back when the public index has no Release ID.',
);
assert.throws(
    () => assertRequestedViewerReleaseIsCurrent('release-1', 'release-2'),
    (error) => error?.code === 'VIEWER_RELEASE_NOT_CURRENT',
    'A locked URL must not silently show another currently published Release.',
);
assert.throws(
    () => assertRequestedViewerReleaseIsCurrent('release-1', 'unsafe/release'),
    (error) => error?.code === 'VIEWER_RELEASE_ID_INVALID',
    'A malformed public index Release ID must fail closed for a locked URL.',
);

const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
assert.match(appSource, /import \{ buildPublicViewerUrl \} from '\.\/viewer-release-route\.js';/,
    'Studio public share/copy actions must use the safe Viewer URL builder.');
assert.match(appSource, /data-release-id="\$\{escapeStudioHtml\(work\.releaseId \|\| ''\)\}"/,
    'Home Work cards must carry their currently published Release ID.');
assert.equal((appSource.match(/buildPublicViewerUrl\(/g) || []).length, 3,
    'Home copy, editor share, and Works copy must all use release-aware Viewer URLs.');
assert.match(worksSource, /data-release-id="\$\{_esc\(p\.releaseId \|\| ''\)\}"/,
    'Works rows must carry the Release ID used by their public Viewer link.');
assert.match(viewerSource, /const requestedReleaseId = params\.get\('r'\) \|\| '';/,
    'Viewer bootstrap must parse the release lock.');
assert.match(viewerSource, /sharedProjectRef = \{ workId, requestedReleaseId \};/,
    'Viewer bootstrap must carry the release lock with the public Work route.');
assert.match(
    viewerSource,
    /loadWorkFromPublicIndex\(sharedProjectRef\.workId, sharedProjectRef\.requestedReleaseId\)/,
    'Viewer retries must retain the same release lock.',
);

const loaderStart = viewerSource.indexOf('async function loadWorkFromPublicIndex');
const loaderEnd = viewerSource.indexOf('async function loadHorizonProjection', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'Public Viewer loader must be inspectable.');
const loaderSource = viewerSource.slice(loaderStart, loaderEnd);
const publicationGate = loaderSource.indexOf('isPublicationActive(');
const releaseGate = loaderSource.indexOf('assertRequestedViewerReleaseIsCurrent(');
const v2Branch = loaderSource.indexOf('isDsfHorizonV2MetadataDeclared(');
const v1Branch = loaderSource.indexOf('Array.isArray(indexData.dsfPages)');
assert.ok(publicationGate >= 0 && releaseGate > publicationGate,
    'Publication availability must be checked before resolving a release lock.');
assert.ok(releaseGate < v2Branch && releaseGate < v1Branch,
    'The release lock must fail before either v2 or v1 delivery can load.');

console.log('Viewer release-locked public URL verification passed.');
