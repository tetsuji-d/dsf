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

assert.match(firebaseSource, /batch\.set\(rootRef, rootProjection, \{ merge: true \}\);[\s\S]*stageProjectSummaryWrite\([\s\S]*await batch\.commit\(\);/);
assert.match(pressSource, /projectBatch\.set\(projectRef, projectPatch, \{ merge: true \}\);[\s\S]*stageProjectSummaryWrite\([\s\S]*await projectBatch\.commit\(\);/);

assert.match(projectsSource, /batch\.delete\(projectRef\);[\s\S]*stageProjectSummaryDelete\([\s\S]*await batch\.commit\(\);/);
assert.match(
    worksSource,
    /batch\.delete\(doc\(db, 'users', ownerUid, 'projects', pid\)\);[\s\S]*stageProjectSummaryDelete\(batch, db, ownerUid, pid\);[\s\S]*await batch\.commit\(\);/,
    'Works project and summary deletion must stay bound to the owner that rendered the row',
);

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
