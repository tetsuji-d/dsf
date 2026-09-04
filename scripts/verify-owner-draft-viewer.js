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
assert.match(
    worksSource,
    /const label = p\.dsfStatus === 'draft'\s*\?\s*t\('works_draft_preview'\)\s*:\s*t\('works_private_preview'\);/,
);
assert.match(worksSource, /t\('works_open_owner_preview', \{ label \}\)/);
assert.match(i18nSource, /works_draft_preview:\s*'下書きプレビュー'/);
assert.match(i18nSource, /works_draft_preview:\s*'Draft preview'/);
assert.match(i18nSource, /works_private_preview:\s*'非公開プレビュー'/);
assert.match(i18nSource, /works_private_preview:\s*'Private preview'/);
assert.match(i18nSource, /works_open_owner_preview:\s*'所有者として\{label\}を開く'/);
assert.match(i18nSource, /works_open_owner_preview:\s*'Open \{label\} as owner'/);
assert.match(worksSource, /p\.dsfStatus === 'draft' \|\| p\.dsfStatus === 'private'/);
assert.match(viewerSource, /params\.get\('draft'\)/);
assert.match(viewerSource, /source: 'owner-draft'/);
assert.match(viewerSource, /users', uid, 'works', identity\.workId, 'releases', identity\.releaseId/);

console.log('Owner-only draft Viewer route checks passed.');
