import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateAuthoringRetentionReport as report } from '../server/private-authoring/retention.js';
import { createPrivateAuthoringSnapshot, createPrivateAuthoringDescriptor } from '../js/private-authoring-storage.js';
const DAY = 86_400_000, nowMs = Date.UTC(2026, 8, 20, 12);
const scope = { uid: 'owner', projectId: 'project', generationId: 'generation' };
const snapshot = await createPrivateAuthoringSnapshot({ version: 6, projectId: 'project', blocks: [], future: { value: 'PRIVATE_SOURCE_SENTINEL' } });
const desc = id => createPrivateAuthoringDescriptor(snapshot, scope, id);
function fixture() {
    const input = { scope, nowMs, complete: { objects: true, revisions: true, actions: true, migrations: true, rollbacks: true },
        control: { generationId: scope.generationId, status: 'active' }, objects: [], revisions: [], actions: [], migrations: [], rollbacks: [] };
    for (let n = 1; n <= 40; n++) {
        const descriptor = desc(`r_${n}`), at = nowMs - (41 - n) * DAY;
        const head = { ...descriptor, revision: n };
        input.objects.push({ key: descriptor.objectKey, size: descriptor.byteLength, uploadedAtMs: at });
        input.revisions.push({ id: descriptor.revisionId, data: { storageVersion: 1, generationId: scope.generationId,
            baseRevision: n - 1, descriptor, state: 'committed', result: 'commit', committedHead: head,
            createdAtMs: at, completedAtMs: at + 100, leaseExpiresAtMs: at + 120000 } });
        input.head = head;
    }
    input.control.previousHead = input.revisions.at(-2).data.committedHead;
    return input;
}
const row = (result, id) => result.objects.find(value => value.key === desc(id).objectKey);
await test('UTC daily history, current revision and grace keep required copies and expose old candidates without mutation', () => {
    const input = fixture(), before = structuredClone(input), result = report(input);
    assert.deepEqual(result.warnings, []); assert.equal(row(result, 'r_1').decision, 'candidate');
    assert.equal(row(result, 'r_11').decision, 'candidate'); assert.equal(row(result, 'r_12').decision, 'keep');
    assert(row(result, 'r_38').reasons.includes('last-three-revisions'));
    assert(row(result, 'r_40').reasons.includes('current-head')); assert.deepEqual(input, before);
    assert.equal(result.policy.automaticDeletion, false); assert.equal(result.totals.candidateCount, 11);
});
await test('daily snapshot selects last actual commit and handles UTC midnight boundaries', () => {
    const input = fixture(), old = input.revisions[15], next = input.revisions[16];
    next.data.createdAtMs = old.data.createdAtMs + 1000; next.data.completedAtMs = old.data.completedAtMs + 1000; next.data.leaseExpiresAtMs = next.data.createdAtMs + 120000;
    const result = report(input); assert.equal(row(result, 'r_16').decision, 'candidate'); assert.equal(row(result, 'r_17').decision, 'keep');
    const boundary = Math.floor(nowMs / DAY) * DAY - 29 * DAY;
    old.data.createdAtMs = boundary - 101; old.data.completedAtMs = boundary - 1; old.data.leaseExpiresAtMs = boundary + 1000;
    assert.equal(row(report(input), 'r_16').decision, 'candidate');
    input.revisions[11].data.createdAtMs = boundary - 200; input.revisions[11].data.completedAtMs = boundary - 100; input.revisions[11].data.leaseExpiresAtMs = boundary + 1000;
    old.data.completedAtMs = boundary; assert.equal(row(report(input), 'r_16').decision, 'keep');
});
await test('live pending saves, retry grace, pending restore and maintenance references cannot be candidates', () => {
    const input = fixture();
    for (const [id, age, expiry] of [['live', 4 * DAY, nowMs + 60000], ['retry', 3 * DAY, nowMs - DAY], ['orphan', 4 * DAY, nowMs - 3 * DAY]]) {
        const descriptor = desc(id);
        input.objects.push({ key: descriptor.objectKey, size: descriptor.byteLength, uploadedAtMs: nowMs - age });
        input.revisions.push({ id, data: { storageVersion: 1, generationId: scope.generationId, baseRevision: 40,
            descriptor, state: 'pending', createdAtMs: nowMs - age, leaseExpiresAtMs: expiry } });
    }
    input.actions.push({ id: 'restore', data: { result: null, restoreHead: input.revisions[0].data.committedHead } });
    const backup = `users/owner/projects/project/migrations/generation/migrate-generation.json`;
    input.objects.push({ key: backup, size: 200, uploadedAtMs: nowMs - 50 * DAY });
    input.migrations.push({ id: 'generation', data: { state: 'pending', generationId: scope.generationId, createdAtMs: nowMs - 50 * DAY,
        backup: { objectKey: backup }, sourceDescriptor: desc('r_2') } });
    const result = report(input); assert.deepEqual(result.warnings, []);
    for (const id of ['live', 'retry', 'r_1', 'r_2']) assert.equal(row(result, id).decision, 'keep');
    assert.equal(row(result, 'orphan').decision, 'candidate'); assert.equal(result.objects.at(-1).decision, 'keep');
});
await test('incomplete, foreign, missing, duplicate, future and inconsistent inventories block all candidates', () => {
    const mutations = [i => { i.complete.actions = false; }, i => { i.objects.push({ ...i.objects[0], key: 'foreign/key' }); },
        i => i.objects.pop(), i => i.objects.push(i.objects[0]), i => { i.objects[0].uploadedAtMs = nowMs + 1; },
        i => { i.revisions[0].data.generationId = 'foreign'; }, i => { i.revisions[0].data.committedHead.sha256 = 'f'.repeat(64); },
        i => i.revisions.pop(), i => { i.actions.push({ data: {} }); }, i => { i.control.generationId = 'other'; }];
    for (const mutate of mutations) { const input = fixture(); mutate(input); const result = report(input);
        assert(result.warnings.length); assert.equal(result.totals.candidateCount, 0); assert(result.objects.every(o => o.decision === 'blocked')); }
});
await test('rolled-back projects and deleted tombstones require a separate cleanup transition', () => {
    for (const status of ['rolledBack', 'deleted']) {
        const input = fixture(); input.control.status = status; input.control.deletedAtMs = nowMs - 10 * DAY;
        const result = report(input); assert.deepEqual(result.warnings, []); assert.equal(result.totals.candidateCount, 0);
    }
});
await test('CLI is offline, does not echo manuscript input and refuses to overwrite files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsf-retention-')), source = join(directory, 'input.json'), output = join(directory, 'report.json');
    try {
        writeFileSync(source, JSON.stringify({ ...fixture(), manuscript: 'PRIVATE_SOURCE_SENTINEL' }));
        const args = ['scripts/inspect-private-authoring.js', 'retention', source];
        const text = execFileSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
        assert(!text.includes('PRIVATE_SOURCE_SENTINEL')); assert(JSON.parse(text).readOnly);
        execFileSync(process.execPath, [...args, output], { stdio: 'pipe', windowsHide: true }); const before = readFileSync(output, 'utf8');
        assert.throws(() => execFileSync(process.execPath, [...args, output], { stdio: 'pipe', windowsHide: true }), e => e.status === 1);
        assert.equal(readFileSync(output, 'utf8'), before);
        writeFileSync(source, 'PRIVATE_SOURCE_SENTINEL');
        assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe', windowsHide: true }), e => e.status === 1 && !e.stderr.toString().includes('PRIVATE_SOURCE_SENTINEL'));
    } finally { for (const file of [source, output]) { try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } } rmdirSync(directory); }
});
