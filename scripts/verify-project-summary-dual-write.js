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
assert.match(worksSource, /batch\.delete\(doc\(db, 'users', state\.uid, 'projects', pid\)\);[\s\S]*stageProjectSummaryDelete\([\s\S]*await batch\.commit\(\);/);

const worksSummaryWrites = worksSource.match(/stageProjectSummaryWrite\(/g) || [];
assert.equal(worksSummaryWrites.length, 3, 'all three Works root metadata updates must write summaries');
assert.doesNotMatch(worksSource, /updateDoc\(/, 'Works root updates must not escape the atomic batch');

console.log('Project summary dual-write wiring verification passed.');
