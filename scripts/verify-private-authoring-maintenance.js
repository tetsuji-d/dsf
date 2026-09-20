import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maintenanceFixture, scope, root, child, control, head } from './fixtures/private-authoring-maintenance-fixture.js';
import { createPrivateAuthoringSnapshot } from '../js/private-authoring-storage.js';
import { usageValue } from '../server/private-authoring/service.js';
import { MAINTENANCE_LEASE_MS, inspectMigrationBundle } from '../server/private-authoring/maintenance.js';
const matches = code => e => e.code === code;
async function migrate(f, target = scope) { const plan = await f.maintenance.inspectMigration(target); return f.maintenance.migrate(target, plan.planHash); }
async function save(f, project, id = 'edit_1') {
    const current = f.get(head); return f.service.save({ uid: scope.uid }, scope.projectId, { snapshot: await createPrivateAuthoringSnapshot(project),
        requestId: id, generationId: current.generationId, baseRevision: current.revision });
}
await test('dry run is read only, outputs no manuscript and migration preserves exact source and typed metadata', async () => {
    const f = maintenanceFixture(), original = structuredClone(f.docs.get(root));
    const plan = await f.maintenance.inspectMigration(scope);
    assert.equal(f.writeCount(), 0); assert.equal(f.rawBucket.puts, 0); assert(!JSON.stringify(plan).includes('PRIVATE_SOURCE_SENTINEL'));
    assert(plan.removesRootFields.includes('blocks')); assert(plan.removesRootFields.includes('unknownRoot'));
    const result = await f.maintenance.migrate(scope, plan.planHash); assert.equal(result.currentStatus, 'active');
    assert.equal(f.get(child), null); assert.equal(f.get(root).blocks, undefined); assert.equal(f.get(root).unknownRoot, undefined);
    assert.equal(f.get(root).releaseId, 'release_1'); assert.equal(f.get('public_projects/work_1').releaseId, 'release_1');
    assert.deepEqual(f.docs.get(root).fields.lastUpdated, original.fields.lastUpdated, 'preserve nanosecond timestamp');
    const current = f.get(head), { revision, ...descriptor } = current;
    const loaded = await f.bucket.read(descriptor, scope); assert.equal(loaded.project.futurePrivate.value, 'PRIVATE_SOURCE_SENTINEL');
    assert.equal((await createPrivateAuthoringSnapshot(f.source)).sha256, plan.sourceSha256);
    const backup = JSON.parse(new TextDecoder().decode(f.rawBucket.objects.get(`users/owner_1/projects/project_1/migrations/generation_1/migrate-generation_1.json`).bytes));
    assert.deepEqual(backup.documents.find(row => row.path === root).document, original);
    const puts = f.rawBucket.puts; assert((await f.maintenance.migrate(scope, plan.planHash)).replay); assert.equal(f.rawBucket.puts, puts);
});
await test('root/child edits including change-and-revert during upload stop the atomic cutover', async () => {
    for (const path of [root, child]) {
        const f = maintenanceFixture(), plan = await f.maintenance.inspectMigration(scope), previous = f.get(path);
        f.rawBucket.afterPut = async key => { if (key.includes('/revisions/')) { f.set(path, { ...previous, title: 'changed' }); f.set(path, previous); } };
        await assert.rejects(f.maintenance.migrate(scope, plan.planHash), matches('MAINTENANCE_SOURCE_CHANGED'));
        assert(f.get(child)); assert.equal(f.get(control), null); assert.equal(f.get(root).authoringBackend, undefined);
    }
});
await test('missing child, v5, foreign work, blob assets and absent plan all fail before copying', async () => {
    for (const mutate of [f => f.docs.delete(child), f => f.set(root, { ...f.get(root), version: 5 }),
        f => f.set('users/owner_1/works/work_1', { ownerUid: 'other', projectId: scope.projectId }),
        f => f.set(child, { ...f.get(child), publicationThumbnailUrl: 'blob:missing' })]) {
        const f = maintenanceFixture(); mutate(f); await assert.rejects(f.maintenance.inspectMigration(scope)); assert.equal(f.rawBucket.puts, 0);
    }
    const f = maintenanceFixture(); await assert.rejects(f.maintenance.migrate(scope, ''), matches('MAINTENANCE_PLAN_REQUIRED'));
    f.revoke(); await assert.rejects(f.maintenance.inspectMigration(scope), matches('MAINTENANCE_FORBIDDEN'));
});
await test('backup failure preserves the legacy project, retry reserves storage only once', async () => {
    const f = maintenanceFixture(), plan = await f.maintenance.inspectMigration(scope); f.rawBucket.failPut = true;
    await assert.rejects(f.maintenance.migrate(scope, plan.planHash)); const reserved = f.get('users/owner_1/authoringUsage/current').reservedBytes;
    assert(f.get(child)); assert.equal(f.get(head), null);
    f.rawBucket.failPut = false; await f.maintenance.migrate(scope, plan.planHash);
    assert.equal(f.get('users/owner_1/authoringUsage/current').reservedBytes, reserved);
});
await test('corrupt backup and lease expiration never remove the Firestore source', async () => {
    for (const kind of ['corrupt', 'expired']) {
        const f = maintenanceFixture(), plan = await f.maintenance.inspectMigration(scope);
        f.rawBucket.afterPut = async key => {
            if (kind === 'corrupt' && key.includes('/migrations/')) f.rawBucket.objects.get(key).bytes[0] ^= 1;
            if (kind === 'expired') f.advance(MAINTENANCE_LEASE_MS + 1);
        };
        await assert.rejects(f.maintenance.migrate(scope, plan.planHash)); assert(f.get(child)); assert.equal(f.get(control), null);
    }
});
await test('an ambiguous committed migration response is recovered without another R2 write', async () => {
    const f = maintenanceFixture(), plan = await f.maintenance.inspectMigration(scope); f.faults.loseReply = true;
    await assert.rejects(f.maintenance.migrate(scope, plan.planHash), matches('UPSTREAM_UNAVAILABLE'));
    const puts = f.rawBucket.puts; const result = await f.maintenance.migrate(scope, plan.planHash);
    assert.equal(result.replay, true); assert.equal(f.rawBucket.puts, puts); assert.equal(f.get(head).revision, 1);
});
await test('rollback uses the latest source, keeps current publication and tombstone, and permits a new migration generation', async () => {
    const f = maintenanceFixture(); await migrate(f);
    const latest = { ...f.source, title: '最新原稿' }; await save(f, latest);
    f.set(root, { ...f.get(root), releaseId: 'release_2' });
    f.set('users/owner_1/works/work_1/releases/release_2', { releaseId: 'release_2' });
    f.set('public_projects/work_1', { ...f.get('public_projects/work_1'), authoringBackend: 'r2-private', releaseId: 'release_2' });
    const plan = await f.maintenance.inspectRollback(scope, 'rollback_1');
    await f.maintenance.rollback(scope, 'rollback_1', plan.planHash);
    assert.equal(f.get(child).title, '最新原稿'); assert.equal(f.get(root).releaseId, 'release_2');
    assert.equal(f.get(root).authoringRef, 'authoring/current'); assert.equal(f.get(root).authoringRollbackGeneration, scope.generationId);
    assert.equal(f.get(control).status, 'rolledBack'); assert.equal(f.get('public_projects/work_1').authoringBackend, undefined);
    await assert.rejects(save(f, { ...latest, title: 'late write' }, 'late'), matches('PROJECT_NOT_MIGRATED'));
    const puts = f.rawBucket.puts; assert((await f.maintenance.rollback(scope, 'rollback_1', plan.planHash)).replay); assert.equal(f.rawBucket.puts, puts);
    await migrate(f, { ...scope, generationId: 'generation_2' });
    assert.equal(f.get(head).generationId, 'generation_2'); assert.equal(f.get(root).authoringRollbackGeneration, undefined);
});
await test('rollback refuses an oversized current manuscript instead of truncating it', async () => {
    const f = maintenanceFixture(); await migrate(f);
    const latest = structuredClone(f.source); latest.futurePrivate.value = '文'.repeat(400_000); await save(f, latest);
    const before = f.rawBucket.puts;
    await assert.rejects(f.maintenance.inspectRollback(scope, 'rollback_large'), matches('FIRESTORE_AUTHORING_TOO_LARGE'));
    assert.equal(f.get(control).status, 'active'); assert.equal(f.get(child), null); assert.equal(f.rawBucket.puts, before);
});
await test('saving or deleting during rollback backup cannot restore stale source or resurrect a project', async () => {
    for (const kind of ['save', 'delete']) {
        const f = maintenanceFixture(); await migrate(f); const plan = await f.maintenance.inspectRollback(scope, 'rollback_race');
        f.rawBucket.afterPut = async key => { if (!key.includes('rollback-')) return; f.rawBucket.afterPut = null;
            if (kind === 'save') await save(f, { ...f.source, title: 'Concurrent edit' }); else f.docs.delete(root);
        };
        await assert.rejects(f.maintenance.rollback(scope, 'rollback_race', plan.planHash)); assert.equal(f.get(child), null);
        if (kind === 'save') assert.equal(f.get(root).title, 'Concurrent edit'); else assert.equal(f.get(root), null);
    }
});
await test('offline migration inventory requires every related document, including explicit missing rows', async () => {
    const f = maintenanceFixture(), docPaths = [root, child, control, head, 'users/owner_1', 'users/owner_1/project_summaries/project_1',
        'users/owner_1/authoringUsage/current', `${root}/authoringMigrations/generation_1`, `${root}/authoringRevisions/initial`,
        'users/owner_1/works/work_1', 'public_projects/work_1', 'public_projects/project_1', 'users/owner_1/works/work_1/releases/release_1'];
    const input = { scope, documents: docPaths.map(path => ({ path, document: f.docs.get(path) || null })) };
    const report = await inspectMigrationBundle(input); assert.equal(report.planHash, (await f.maintenance.inspectMigration(scope)).planHash);
    input.documents.pop(); await assert.rejects(inspectMigrationBundle(input), matches('MAINTENANCE_INVENTORY_INCOMPLETE'));
});

await test('revoked authorization, corrupted source and quota exhaustion never activate a copied manuscript', async () => {
    for (const kind of ['revoked', 'corrupt-source', 'quota']) {
        const f = maintenanceFixture(), plan = await f.maintenance.inspectMigration(scope);
        if (kind === 'quota') f.set('users/owner_1/authoringUsage/current', { ...usageValue(null, f.time()), uploadedBytes: 256 * 1024 * 1024 });
        else f.rawBucket.afterPut = async key => { if (!key.includes('/revisions/')) return;
            if (kind === 'revoked') f.revoke(); else f.rawBucket.objects.get(key).bytes[0] ^= 1;
        };
        await assert.rejects(f.maintenance.migrate(scope, plan.planHash), kind === 'quota' ? matches('UPLOAD_QUOTA_EXCEEDED') : undefined);
        assert(f.get(child)); assert.equal(f.get(control), null);
        if (kind === 'quota') assert.equal(f.rawBucket.puts, 0);
    }
});
