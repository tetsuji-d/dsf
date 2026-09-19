import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProjectSummary } from '../js/project-summary.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');

function readFunctionBody(name, nextName) {
    const start = rules.indexOf(`function ${name}(`);
    const end = rules.indexOf(`function ${nextName}(`, start + 1);
    assert.notEqual(start, -1, `${name} must exist`);
    assert.notEqual(end, -1, `${nextName} must follow ${name}`);
    return rules.slice(start, end);
}

const shapeRule = readFunctionBody(
    'projectSummaryHasValidShape',
    'projectSummaryPublicationIsValid'
);
const allowlistMatch = shapeRule.match(/\.hasOnly\(\[([\s\S]*?)\]\)/);
assert.ok(allowlistMatch, 'project summary must have an explicit field allowlist');
const allowedFields = [...allowlistMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);

const projectedFields = Object.keys(createProjectSummary({
    version: 6,
    projectId: 'rules_contract',
}));
assert.deepEqual(
    [...allowedFields].sort(),
    [...projectedFields].sort(),
    'Firestore Rules allowlist must match the pure projection fields'
);

for (const forbidden of ['blocks', 'sections', 'pages', 'dsfPages', 'meta', 'authoringRef']) {
    assert.equal(allowedFields.includes(forbidden), false, `${forbidden} must be rejected by the allowlist`);
}

const valueRule = readFunctionBody(
    'projectSummaryHasValidValues',
    'projectSummaryWriteIsValid'
);
for (const requiredCheck of [
    'request.resource.data.schemaVersion == 1',
    'request.resource.data.projectId == pid',
    "request.resource.data.listThumbnail.matches('https://.*')",
    'projectSummaryPublicationIsValid()',
]) {
    assert.match(valueRule, new RegExp(requiredCheck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const summaryMatchStart = rules.indexOf('match /project_summaries/{pid}');
assert.notEqual(summaryMatchStart, -1, 'project summary path must be protected');
const summaryMatch = rules.slice(summaryMatchStart, rules.indexOf('// 読者向け', summaryMatchStart));
assert.match(summaryMatch, /allow read: if isOwner\(uid\);/);
assert.match(summaryMatch, /allow create, update: if accountCanEdit\(uid\)/);
assert.match(summaryMatch, /&& projectSummaryWriteIsValid\(pid\);/);
assert.match(summaryMatch, /allow delete: if accountCanEdit\(uid\) && !privateAuthoringProject\(uid, pid\);/);
assert.doesNotMatch(summaryMatch, /isStaff\(|public|unlisted/);

console.log('Project summary Firestore Rules contract verification passed.');
