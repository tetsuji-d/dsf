import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    assertOwnerDraftReleaseMetadata,
    buildOwnerDraftViewerUrl,
    normalizeOwnerDraftProjectId,
    resolveOwnerDraftReleaseIdentity,
    resolveOwnerDraftWorkIdentity,
} from '../js/viewer-owner-preview.js';

const project = {
    workId: 'work-1',
    releaseId: 'release-1',
    authorUid: 'owner-1',
    dsfStatus: 'draft',
};
const workIdentity = resolveOwnerDraftWorkIdentity({
    uid: 'owner-1',
    projectId: 'project-1',
    project,
});
assert.deepEqual(workIdentity, { uid: 'owner-1', projectId: 'project-1', workId: 'work-1' });

const releaseIdentity = resolveOwnerDraftReleaseIdentity({
    ...workIdentity,
    releaseId: project.releaseId,
}, {
    workId: 'work-1',
    ownerUid: 'owner-1',
    latestReleaseId: 'release-1',
});
assert.deepEqual(releaseIdentity, {
    uid: 'owner-1',
    projectId: 'project-1',
    workId: 'work-1',
    releaseId: 'release-1',
});
assert.equal(assertOwnerDraftReleaseMetadata({
    projectId: 'project-1',
    workId: 'work-1',
    releaseId: 'release-1',
}, releaseIdentity), true);

assert.equal(
    buildOwnerDraftViewerUrl('https://staging.dsf-studio.pages.dev', 'project-1'),
    'https://staging.dsf-studio.pages.dev/viewer?draft=project-1',
);
assert.equal(normalizeOwnerDraftProjectId('project-1'), 'project-1');
assert.throws(() => normalizeOwnerDraftProjectId('../project-1'), /safe document ID/i);
assert.throws(() => resolveOwnerDraftWorkIdentity({
    uid: 'different-owner',
    projectId: 'project-1',
    project,
}), /signed-in owner/i);
assert.throws(() => assertOwnerDraftReleaseMetadata({
    projectId: 'project-1',
    workId: 'work-1',
    releaseId: 'release-2',
}, releaseIdentity), /does not match/i);
assert.throws(() => buildOwnerDraftViewerUrl('javascript:alert(1)', 'project-1'), /origin is invalid|HTTP or HTTPS/i);

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
const viewerSource = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
assert.match(appSource, /window\.openDraftViewer/);
const editionSource=readFileSync(new URL('../js/edition-reads.js',import.meta.url),'utf8');
assert.match(editionSource, /buildOwnerDraftViewerUrl\(location.origin, row.projectId, row.releaseId\)/);
assert.match(worksSource,/openEditionReads/);
assert.match(viewerSource, /params\.get\('draft'\)/);
assert.match(viewerSource, /source: 'owner-draft'/);
assert.match(viewerSource, /users', uid, 'works', identity\.workId, 'releases', identity\.releaseId/);

console.log('Owner-only draft Viewer route checks passed.');
const legacy = resolveOwnerDraftWorkIdentity({uid:'owner-1', projectId:'テスト01', project:{workId:'作品１'}});
assert.equal(new URL(buildOwnerDraftViewerUrl('https://example.com', legacy.projectId, 'rel_1')).searchParams.get('draft'), 'テスト01');
assertOwnerDraftReleaseMetadata({projectId:'テスト01', workId:'作品１', releaseId:'rel_1'}, {...legacy, releaseId:'rel_1'});
for (const id of ['../作品', '作品/1', '作品%2F1', '作品?1']) assert.throws(() => normalizeOwnerDraftProjectId(id));
