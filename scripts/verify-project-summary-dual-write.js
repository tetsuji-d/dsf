import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
const firebaseSource = read('js/firebase.js');
const projectsSource = read('js/projects.js');
const pressSource = read('js/press.js');
const worksSource = read('js/works.js');
const persistenceSource = read('js/project-summary-firestore.js');

assert.match(persistenceSource, /'project_summaries', projectId/);
assert.match(persistenceSource, /batch\.set\(projectSummaryDocRef\(db, uid, projectId\), summary\)/);
assert.match(persistenceSource, /batch\.delete\(projectSummaryDocRef\(db, uid, projectId\)\)/);

assert.match(firebaseSource, /batch\.set\(rootRef, rootProjection, \{ merge: true \}\);[\s\S]*stageProjectSummaryWrite\([\s\S]*batch\.set\(doc\(db, "users", saveIdentity\.uid, "works", saveIdentity\.workId\)[\s\S]*await batch\.commit\(\);/,
    'autosave must commit Project, Dashboard summary, and Work title metadata atomically');
assert.doesNotMatch(firebaseSource, /if \(saveIdentity\.workId\) \{\s*await setDoc\(/,
    'autosave must not update the Work replica after the Project batch');

const pressV1BatchStart = pressSource.indexOf('const projectBatch = writeBatch(db);');
const pressV1BatchEnd = pressSource.indexOf(
    "dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'publication'",
    pressV1BatchStart,
);
assert.notEqual(pressV1BatchStart, -1, 'v1 Press must create a Firestore writeBatch');
assert.notEqual(pressV1BatchEnd, -1, 'v1 Press batch boundary must end before local publication dispatch');
const pressV1BatchSource = pressSource.slice(pressV1BatchStart, pressV1BatchEnd);
const pressV1CommitIndex = pressV1BatchSource.indexOf('await projectBatch.commit();');
assert.notEqual(pressV1CommitIndex, -1, 'v1 Press must commit its publication batch');
assert.equal(
    (pressV1BatchSource.match(/await projectBatch\.commit\(\);/g) || []).length,
    1,
    'v1 Press publication writes must have exactly one batch commit',
);

const pressV1AtomicWrites = [
    ['Project root', /projectBatch\.set\(projectRef, projectPatch, \{ merge: true \}\)/],
    ['project summary', /stageProjectSummaryWrite\(\s*projectBatch,/],
    ['Work snapshot', /projectBatch\.set\(\s*doc\(db, 'users', uid, 'works', workId\),/],
    ['Release snapshot', /projectBatch\.set\(\s*doc\(db, 'users', uid, 'works', workId, 'releases', releaseId\),/],
    ['workId public index delete', /projectBatch\.delete\(publicWorkIndexRef\)/],
    ['legacy projectId public index delete', /projectBatch\.delete\(publicProjectIndexRef\)/],
];
for (const [label, pattern] of pressV1AtomicWrites) {
    const match = pressV1BatchSource.match(pattern);
    assert.ok(match, `v1 Press batch must stage ${label}`);
    assert.ok(match.index < pressV1CommitIndex, `v1 Press must stage ${label} before commit`);
}
assert.doesNotMatch(
    pressV1BatchSource,
    /await\s+(?:setDoc|deleteDoc)\(/,
    'v1 Press Work, Release, and public index writes must not escape the shared batch',
);
assert.match(
    pressSource.slice(0, pressV1BatchStart),
    /getDoc\(publicWorkIndexRef\)[\s\S]*publicIndexSnap\.data\(\)\?\.authorUid !== uid/,
    'v1 Press must read and owner-check an existing public index before staging its delete',
);

assert.match(projectsSource, /batch\.delete\(projectRef\);[\s\S]*stageProjectSummaryDelete\([\s\S]*await batch\.commit\(\);/);
assert.match(
    worksSource,
    /await deleteCloudProject\(pid, ownerUid\);[\s\S]*if \(state\.uid !== ownerUid\) return;/,
    'Works project and summary deletion must stay bound to the owner that rendered the row',
);

assert.match(projectsSource, /state\.uid !== expectedUid[\s\S]*preparePrivateProjectAction[\s\S]*runPrivateProjectAction\(privateContext, 'delete'\)/, 'Shared deletion adapter must preserve owner binding and migrated API routing');

const worksSummaryWrites = worksSource.match(/stageProjectSummaryWrite\(/g) || [];
assert.equal(worksSummaryWrites.length, 1, 'Works publication paths must share one summary write boundary');
assert.match(
    worksSource,
    /runTransaction\(db,[\s\S]*transaction\.update\(projectRef, plan\.projectPatch\);[\s\S]*stageProjectSummaryWrite\(transaction,[\s\S]*transaction\.set\([\s\S]*public_projects/,
    'Works Project, summary, and public index writes must share one Firestore transaction',
);
const worksPublicationTransitions = worksSource.match(/await _commitWorksPublicationTransition\(/g) || [];
assert.equal(worksPublicationTransitions.length, 3, 'status, schedule, and reconcile must use the shared publication transaction');
assert.doesNotMatch(worksSource, /await setDoc\([^;]*public_projects/,
    'public index writes must not escape the shared Works publication transaction');
assert.doesNotMatch(worksSource, /updateDoc\(/, 'Works root updates must not escape the atomic batch');

console.log('Project summary dual-write wiring verification passed.');
