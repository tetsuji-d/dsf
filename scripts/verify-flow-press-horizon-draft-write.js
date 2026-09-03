import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    DSF_HORIZON_RELEASE_CONTRACT_VERSION,
    DSF_HORIZON_RELEASE_SEAL_KIND,
} from '../js/dsf-horizon-release-contract.js';
import {
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND,
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION,
} from '../js/flow-press-horizon-release-upload.js';
import {
    FLOW_PRESS_HORIZON_DRAFT_WRITE_KIND,
    FLOW_PRESS_HORIZON_DRAFT_WRITE_VERSION,
    FlowPressHorizonDraftWriteError,
    assertCompatibleFlowPressHorizonRelease,
    createFlowPressHorizonDraftWrite,
} from '../js/flow-press-horizon-draft-write.js';
import { createProjectSummaryForPatch } from '../js/project-summary.js';

const identity = { uid: 'owner-1', workId: 'work-1', releaseId: 'release-1' };
const releaseMetadata = {
    dsfSchemaVersion: 2,
    dsfContentUrl: 'https://media.example.test/users/owner-1/dsf/work-1/release-1/content.json',
    dsfContentHash: 'a'.repeat(64),
    dsfLangs: ['ja'],
    dsfPageCounts: { ja: 2 },
    dsfTotalBytes: 2048,
};
const upload = {
    executionVersion: FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION,
    executionKind: FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND,
    readyForMetadataWrite: true,
    identity: { ...identity },
    receipts: [],
    seal: {
        contractVersion: DSF_HORIZON_RELEASE_CONTRACT_VERSION,
        contractKind: DSF_HORIZON_RELEASE_SEAL_KIND,
        readyForMetadataWrite: true,
        identity: { ...identity },
        releaseMetadata: { ...releaseMetadata },
        publicLocator: {
            ...releaseMetadata,
            defaultLang: 'ja',
            pageCount: 2,
        },
        summary: {},
    },
    summary: { fileCount: 2, totalBytes: 2048 },
};
const publication = {
    listedFrom: new Date('2026-09-02T00:00:00.000Z'),
    listedUntil: new Date('2026-09-16T00:00:00.000Z'),
    publicFrom: null,
    publicUntil: null,
    expiredAt: null,
    expireReason: null,
};

const draft = createFlowPressHorizonDraftWrite({
    upload,
    projectId: 'project-1',
    project: {
        title: 'Flow test',
        labelName: 'DSF',
        rating: 'all',
        license: 'all-rights-reserved',
        meta: { ja: { title: 'Flow test' } },
        languages: ['ja', 'en-us'],
        defaultLang: 'ja',
    },
    publication,
    bookConfig: {
        bookMode: 'simple',
        book: { mode: 'simple', covers: { c1: { pageIndex: 0 }, c4: { pageIndex: 1 } } },
    },
    renderStamp: 123456,
});

assert.equal(draft.writeVersion, FLOW_PRESS_HORIZON_DRAFT_WRITE_VERSION);
assert.equal(draft.writeKind, FLOW_PRESS_HORIZON_DRAFT_WRITE_KIND);
assert.equal(draft.readyForFirestoreWrite, true);
assert.deepEqual(draft.identity, identity);
assert.equal(draft.projectPatch.dsfSchemaVersion, 2);
assert.equal(draft.projectPatch.dsfContentUrl, releaseMetadata.dsfContentUrl);
assert.deepEqual(draft.projectPatch.dsfPages, [], 'v2 project draft must clear stale v1 pages');
assert.equal(draft.projectPatch.dsfStatus, 'draft');
assert.equal(draft.projectPatch.visibility, 'private');
assert.equal(draft.projectPatch.dsfResolution, '360x640');
assert.equal(draft.releaseDocument.defaultLang, 'ja');
assert.equal(draft.releaseDocument.pageCount, 2);
assert.deepEqual(draft.publicIndexDocumentIds, ['work-1', 'project-1']);
assert.deepEqual(draft.workPatch.languages, ['ja', 'en-us']);
assert.equal(Object.isFrozen(draft), true);
assert.equal(Object.isFrozen(draft.projectPatch), true);
const dashboardSummary = createProjectSummaryForPatch({
    version: 6,
    projectId: 'project-1',
    workId: 'work-1',
    projectName: 'Flow project',
    languages: ['ja', 'en-us'],
}, draft.projectPatch, { projectId: 'project-1' });
assert.equal(dashboardSummary.hasPublishedDsf, true, 'v2 page counts must make the owner dashboard release-visible');
assert.equal(dashboardSummary.dsfPageCount, 2);
assert.equal(dashboardSummary.releaseId, 'release-1');

assert.equal(assertCompatibleFlowPressHorizonRelease({ ...draft.releaseDocument }, draft), true);
assert.throws(
    () => assertCompatibleFlowPressHorizonRelease({
        ...draft.releaseDocument,
        dsfContentHash: 'b'.repeat(64),
    }, draft),
    (error) => error instanceof FlowPressHorizonDraftWriteError
        && error.issues[0].code === 'FLOW_HORIZON_DRAFT_RELEASE_COLLISION',
);

assert.throws(
    () => createFlowPressHorizonDraftWrite({
        upload: { ...upload, readyForMetadataWrite: false },
        projectId: 'project-1',
        project: {},
        publication,
        bookConfig: { bookMode: 'none', book: { mode: 'none', covers: {} } },
        renderStamp: 1,
    }),
    (error) => error instanceof FlowPressHorizonDraftWriteError
        && error.issues[0].code === 'FLOW_HORIZON_DRAFT_UPLOAD_NOT_SEALED',
);

assert.throws(
    () => createFlowPressHorizonDraftWrite({
        upload: {
            ...upload,
            seal: { ...upload.seal, identity: { ...identity, releaseId: 'other-release' } },
        },
        projectId: 'project-1',
        project: {},
        publication,
        bookConfig: { bookMode: 'none', book: { mode: 'none', covers: {} } },
        renderStamp: 1,
    }),
    (error) => error instanceof FlowPressHorizonDraftWriteError
        && error.issues[0].code === 'FLOW_HORIZON_DRAFT_IDENTITY_MISMATCH',
);

const moduleSource = readFileSync(new URL('../js/flow-press-horizon-draft-write.js', import.meta.url), 'utf8');
for (const forbidden of ['./firebase', './press', 'setDoc(', 'writeBatch(', 'deleteDoc(', 'serverTimestamp(', 'localStorage']) {
    assert.equal(moduleSource.includes(forbidden), false, `draft contract cannot depend on ${forbidden}`);
}
const pressSource = readFileSync(new URL('../js/press.js', import.meta.url), 'utf8');
assert.match(pressSource, /import\('\.\/flow-press-horizon-draft-write\.js'\)/);
assert.match(pressSource, /await runTransaction\(db, async \(transaction\) =>/);
assert.match(pressSource, /if \(publicSnap\.exists\(\)\) transaction\.delete\(publicRefs\[index\]\)/);
assert.match(pressSource, /FLOW_HORIZON_DRAFT_PUBLIC_INDEX_OWNER_MISMATCH/);
assert.match(pressSource, /assertCompatibleFlowPressHorizonRelease\(existingRelease, draft\)/);
assert.match(pressSource, /if \(hasFlow && isHorizonPublish\)[\s\S]*btn\.disabled = !flowHorizonReady \|\| working \|\| saved/,
    'Flow Horizon draft save must be enabled only after verified handoff readiness');
assert.match(pressSource, /confirm\(t\('press_flow_horizon_confirm'\)\)/,
    'Flow Horizon draft save requires an explicit in-app confirmation');
assert.match(pressSource, /const upload = await uploadFlowHorizonReleaseFiles\(\);[\s\S]*const draft = await writeFlowHorizonDraftMetadata\(account\)/,
    'immutable upload must finish before the owner-only draft transaction');
assert.match(pressSource, /window\.switchRoom\('works'\)/,
    'successful Flow draft save should move the owner to Works');

console.log('Flow Press Horizon owner-only draft metadata verification passed.');
