import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveWorksDsfRelease } from '../js/works-dsf-release.js';
import { createWorksPublicationTransition } from '../js/works-publication-transition.js';

const identity = { uid: 'owner-1', workId: 'work-1', releaseId: 'release-1' };
const v2Project = {
    workId: identity.workId,
    releaseId: identity.releaseId,
    dsfSchemaVersion: 2,
    dsfContentUrl: `https://media-staging.dsf.ink/users/${identity.uid}/dsf/${identity.workId}/${identity.releaseId}/content.json`,
    dsfContentHash: 'a'.repeat(64),
    dsfLangs: ['ja', 'en-us'],
    dsfPageCounts: { ja: 120, 'en-us': 98 },
    dsfTotalBytes: 4096,
    defaultLang: 'ja',
    pageCount: 999,
    dsfPages: [],
};
const v2 = resolveWorksDsfRelease(v2Project, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
});
assert.equal(v2.releaseKind, 'horizon-v2');
assert.equal(v2.pageCount, 120, 'authoring pageCount must not replace the v2 default-language count');
assert.equal(v2.deliveryFields.pageCount, 120);
assert.equal(v2.deliveryFields.dsfPageCount, 120);
assert.deepEqual(v2.deliveryFields.dsfPages, []);
assert.equal(v2.deliveryFields.dsfContentHash, 'a'.repeat(64));
assert.equal(Object.isFrozen(v2), true);

const translatedOnly = resolveWorksDsfRelease({
    ...v2Project,
    dsfLangs: ['en-us'],
    dsfPageCounts: { 'en-us': 98 },
    defaultLang: 'ja',
}, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
});
assert.equal(translatedOnly.defaultLang, 'en-us');
assert.equal(translatedOnly.pageCount, 98);

const v1Pages = [{ pageNum: 1, urls: { ja: 'https://media.example.test/page-1.webp' } }];
const v1 = resolveWorksDsfRelease({
    dsfPages: v1Pages,
    dsfLangs: ['ja'],
    defaultLang: 'ja',
}, identity);
assert.equal(v1.releaseKind, 'webp-v1');
assert.equal(v1.pageCount, 1);
assert.deepEqual(v1.deliveryFields.dsfPages, v1Pages);

const publication = {
    listedFrom: new Date('2026-09-03T00:00:00.000Z'),
    listedUntil: new Date('2026-09-17T00:00:00.000Z'),
    publicFrom: new Date('2026-09-03T00:00:00.000Z'),
    publicUntil: null,
    expiredAt: null,
    expireReason: null,
    planSnapshot: {
        tier: 'free',
        status: 'active',
        cancelAtPeriodEnd: false,
        evaluatedAt: new Date('2026-09-03T00:00:00.000Z'),
    },
};
const v2Work = {
    workId: identity.workId,
    projectId: 'project-1',
    ownerUid: identity.uid,
    latestProjectId: 'project-1',
    latestReleaseId: identity.releaseId,
    title: 'Flow title',
    languages: ['ja', 'en-us'],
    defaultLang: 'ja',
};
const v2Release = {
    ...v2Project,
    projectId: 'project-1',
    releaseId: identity.releaseId,
    workId: identity.workId,
    pageCount: 120,
};
const transitionInput = {
    uid: identity.uid,
    projectId: 'project-1',
    project: { ...v2Project, projectId: 'project-1', title: 'Flow project' },
    work: v2Work,
    release: v2Release,
    status: 'public',
    publication,
    account: { publicProfile: { displayName: 'Owner', handle: 'owner' } },
    fallbackAuthorName: 'Fallback owner',
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
    publicIndexes: {},
};
const publicTransition = createWorksPublicationTransition(transitionInput);
assert.equal(publicTransition.releaseKind, 'horizon-v2');
assert.equal(publicTransition.identityMode, 'canonical-release');
assert.equal(publicTransition.projectPatch.dsfStatus, 'public');
assert.equal(publicTransition.projectPatch.visibility, 'public');
assert.equal(publicTransition.publicIndex.documentId, identity.workId);
assert.equal(publicTransition.publicIndex.payload.dsfContentHash, v2Project.dsfContentHash);
assert.equal(publicTransition.publicIndex.payload.defaultLang, 'ja');
assert.equal(publicTransition.publicIndex.payload.pageCount, 120);
assert.deepEqual(publicTransition.publicIndex.payload.dsfPages, []);
assert.equal(Object.isFrozen(publicTransition), true);
assert.deepEqual(
    createWorksPublicationTransition(transitionInput),
    publicTransition,
    'repeating the same validated transition must be deterministic',
);
const unlistedTransition = createWorksPublicationTransition({ ...transitionInput, status: 'unlisted' });
assert.equal(unlistedTransition.projectPatch.visibility, 'unlisted');
assert.equal(unlistedTransition.publicIndex.payload.dsfStatus, 'unlisted');

assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    work: { ...v2Work, latestReleaseId: 'release-stale' },
}), /Work does not point/i, 'stale Work identity must fail before writes are staged');
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    release: { ...v2Release, dsfContentHash: 'b'.repeat(64) },
}), /disagree/i, 'Project and Release locator mismatches must fail closed');
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    release: { ...v2Release, defaultLang: 'fr' },
}), /default language/i, 'the canonical Release default language must be published');
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    release: { ...v2Release, pageCount: 119 },
}), /page count/i, 'the canonical Release default-language count must not be stale');
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    allowedContentOrigins: ['https://attacker.invalid'],
}), /location|URL|origin/i, 'the canonical Release URL must be revalidated at publication time');
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    publicIndexes: { [identity.workId]: { authorUid: 'another-owner' } },
}), /another owner/i, 'a colliding public index must never be overwritten');

const privateTransition = createWorksPublicationTransition({
    ...transitionInput,
    status: 'private',
    publicIndexes: {
        [identity.workId]: { authorUid: identity.uid },
        'project-1': { authorUid: identity.uid },
    },
});
assert.equal(privateTransition.publicIndex, null);
assert.equal(privateTransition.projectPatch.visibility, 'private');
assert.deepEqual(privateTransition.deleteDocumentIds, [identity.workId, 'project-1']);
const draftTransition = createWorksPublicationTransition({
    ...transitionInput,
    status: 'draft',
    publicIndexes: { [identity.workId]: { authorUid: identity.uid } },
});
assert.equal(draftTransition.projectPatch.dsfStatus, 'draft');
assert.equal(draftTransition.publicIndex, null);
assert.deepEqual(draftTransition.deleteDocumentIds, [identity.workId]);

const v1Project = {
    projectId: 'project-v1',
    workId: 'work-v1',
    releaseId: 'release-v1',
    dsfPages: v1Pages,
    dsfLangs: ['ja'],
    defaultLang: 'ja',
};
const v1Transition = createWorksPublicationTransition({
    ...transitionInput,
    projectId: 'project-v1',
    project: v1Project,
    work: {
        workId: 'work-v1',
        projectId: 'project-v1',
        latestProjectId: 'project-v1',
        latestReleaseId: 'release-v1',
        ownerUid: identity.uid,
        title: 'v1 title',
    },
    release: { ...v1Project },
    publicIndexes: {},
});
assert.equal(v1Transition.releaseKind, 'webp-v1');
assert.equal(v1Transition.identityMode, 'canonical-release');
assert.deepEqual(v1Transition.publicIndex.payload.dsfPages, v1Pages);
assert.equal(v1Transition.publicIndex.payload.dsfSchemaVersion, 1);

const reorderedV1Pages = [{
    urls: { ja: 'https://media.example.test/page-1.webp' },
    pageNum: 1,
}];
const reorderedV1Transition = createWorksPublicationTransition({
    ...transitionInput,
    projectId: 'project-v1',
    project: v1Project,
    work: {
        workId: 'work-v1',
        projectId: 'project-v1',
        latestProjectId: 'project-v1',
        latestReleaseId: 'release-v1',
        ownerUid: identity.uid,
        title: 'v1 title',
    },
    release: { ...v1Project, dsfPages: reorderedV1Pages },
    publicIndexes: {},
});
assert.deepEqual(
    reorderedV1Transition.publicIndex.payload.dsfPages,
    reorderedV1Pages,
    'Firestore map key ordering must not make identical v1 pages fail publication',
);
assert.throws(() => createWorksPublicationTransition({
    ...transitionInput,
    projectId: 'project-v1',
    project: v1Project,
    work: {
        workId: 'work-v1',
        projectId: 'project-v1',
        latestProjectId: 'project-v1',
        latestReleaseId: 'release-v1',
        ownerUid: identity.uid,
        title: 'v1 title',
    },
    release: {
        ...v1Project,
        dsfPages: [{ pageNum: 1, urls: { ja: 'https://media.example.test/changed.webp' } }],
    },
    publicIndexes: {},
}), /disagree on dsfPages/i, 'a real v1 page URL mismatch must still fail closed');

const legacyV1Transition = createWorksPublicationTransition({
    ...transitionInput,
    projectId: 'legacy-project',
    project: { dsfPages: v1Pages, dsfLangs: ['ja'], defaultLang: 'ja' },
    work: null,
    release: null,
    publicIndexes: {},
});
assert.equal(legacyV1Transition.releaseKind, 'webp-v1');
assert.equal(legacyV1Transition.identityMode, 'legacy-project-v1');
assert.equal(legacyV1Transition.workId, 'legacy-project');

assert.throws(() => resolveWorksDsfRelease({
    ...v2Project,
    dsfContentHash: undefined,
}, {
    ...identity,
    allowedContentOrigins: ['https://media-staging.dsf.ink'],
}), /hash|metadata|locator/i, 'partial v2 metadata must not fall back to v1');

assert.throws(() => resolveWorksDsfRelease(v2Project, {
    ...identity,
    allowedContentOrigins: ['https://attacker.invalid'],
}), /location|URL|origin/i, 'v2 content URL must remain inside the configured release origin');

const worksSource = readFileSync(new URL('../js/works.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(worksSource, /resolveWorksDsfRelease\(/);
assert.match(worksSource, /\.\.\.release\.deliveryFields/);
assert.doesNotMatch(worksSource, /v2PublishDisabled/,
    'v2 public status controls must be enabled only after the atomic transition is connected');
assert.match(worksSource, /runTransaction\(db/);
assert.match(worksSource, /createWorksPublicationTransition\(/);
for (const key of [
    'works_status_draft',
    'works_status_unlisted',
    'works_status_public',
    'works_status_private',
    'works_meta',
    'works_published_on',
    'works_draft_preview',
    'works_republish',
    'works_delete',
]) {
    assert.match(worksSource, new RegExp(`t\\('${key}'`), `Works UI must translate ${key}`);
}
assert.doesNotMatch(worksSource, /<option[^>]+value="draft"[^>]*>下書き<\/option>/,
    'Works status options must not embed Japanese labels');

const i18nSource = readFileSync(new URL('../js/i18n-studio.js', import.meta.url), 'utf8');
assert.match(i18nSource, /works_status_draft:\s+'Draft'/);
assert.match(i18nSource, /works_republish:\s+'Republish'/);
assert.match(i18nSource, /works_delete:\s+'Delete'/);
assert.match(
    appSource,
    /if \(currentRoom === 'works'\) \{\s*void refreshWorksRoomLanguage\(true\);\s*\}/,
    'Changing the Studio UI language must rerender Works rows from the language refresh path.',
);
assert.match(
    appSource,
    /if \(currentRoom === 'home'\) \{\s*renderHomeDashboard\(\)\.catch/,
    'A Works language switch must not refresh the hidden Home dashboard.',
);
const authListenerStart = appSource.indexOf('onAuthChanged((user) => {');
const authListenerEnd = appSource.indexOf('}, firebaseAuth);', authListenerStart);
assert.ok(authListenerStart >= 0 && authListenerEnd > authListenerStart,
    'Works auth bootstrap verification must inspect the Firebase auth listener.');
const authListenerSource = appSource.slice(authListenerStart, authListenerEnd);
assert.match(
    authListenerSource,
    /applyStudioAuthUser\(user\);\s*if \(getCurrentRoom\(\) === 'works'\) \{\s*void openWorksRoom\(true\);\s*\}/,
    'Restored or cleared Firebase auth must immediately rerender a directly opened Works room.',
);
const appliedAuthAt = authListenerSource.indexOf('applyStudioAuthUser(user);');
const worksRefreshAt = authListenerSource.indexOf("if (getCurrentRoom() === 'works')");
const userOnlyBranchAt = authListenerSource.indexOf('if (user)');
assert.ok(appliedAuthAt >= 0 && worksRefreshAt > appliedAuthAt && userOnlyBranchAt > worksRefreshAt,
    'Works must refresh after auth state is applied and before the signed-in-only branch so sign-out clears stale rows.');
assert.match(worksSource, /_worksViewCache\?\.uid === ownerUid/,
    'Works cache reuse must be restricted to the authenticated owner.');
assert.match(worksSource, /openWorksRoom\(roomMode, \{ useCache: true \}\)/,
    'The language refresh path must request an in-memory repaint.');
assert.match(worksSource, /title:\s+d\.title \|\| ''/,
    'The Works cache must retain the raw title so untitled fallback text can be retranslated.');
assert.match(worksSource, /projects\.splice\(projectIndex, 1\)/,
    'Deleting a work must also remove it from the language repaint cache.');
assert.match(worksSource, /_worksLoadGeneration === generation/,
    'Stale Works loads must not replace the current owner cache or UI.');
assert.match(worksSource, /_isWorksProjectPending\(ownerUid, project\.id\)/,
    'Language repaint must preserve disabled controls while a project mutation is pending.');
assert.match(worksSource, /_updateDsfStatus\(pid, newStatus, proj, row, ownerUid\)/,
    'Status mutations must remain bound to the owner that rendered the Works row.');
assert.match(worksSource, /_updatePublicationWindow\(pid, proj, row, ownerUid\)/,
    'Publication mutations must remain bound to the owner that rendered the Works row.');
const worksLanguageRefreshStart = worksSource.indexOf('export async function refreshWorksRoomLanguage');
const worksLanguageRefreshEnd = worksSource.indexOf('function _renderViewerAction');
assert.ok(worksLanguageRefreshStart >= 0 && worksLanguageRefreshEnd > worksLanguageRefreshStart,
    'The Works language refresh verification must inspect the actual refresh function.');
const worksLanguageRefreshSource = worksSource.slice(worksLanguageRefreshStart, worksLanguageRefreshEnd);
assert.doesNotMatch(worksLanguageRefreshSource, /getDocs\(|assertAccountCan(?:Edit|Publish)\(/,
    'Changing language must not directly fetch Works or account data.');
assert.match(worksSource, /p\.releaseKind === 'horizon-v2'/);
assert.match(worksSource, /t\('works_meta_v2'/);
assert.match(i18nSource, /works_meta_v2:\s+'\{pages\} pages · \{langs\} · DSF v2 \(fixed text \+ WebP\)\{size\}'/);

console.log('Works DSF v1/v2 release projection and publication transition verification passed.');
