import assert from 'node:assert/strict';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc, writeBatch, terminate, setLogLevel } from 'firebase/firestore';
import { createFirestoreStore, decodeFirestoreValue } from '../server/private-authoring/firestore.js';
import { createAuthoringMaintenance } from '../server/private-authoring/maintenance.js';
import { createMaintenanceBackupStore } from '../server/private-authoring/maintenance-common.js';
import { maintenanceFixture, scope as maintenanceScope } from './fixtures/private-authoring-maintenance-fixture.js';
import { createProjectSummary } from '../js/project-summary.js';
const address = process.env.FIRESTORE_EMULATOR_HOST;
assert(address && /^(127\.0\.0\.1|localhost):\d+$/.test(address), 'local emulator required');
const projectId = process.env.GCLOUD_PROJECT;
assert(projectId?.startsWith('demo-'), 'demo project only');
const [host, port] = address.split(':');
setLogLevel('silent');
const adminApp = initializeAdminApp({ projectId }, 'authoring-rules');
const admin = getFirestore(adminApp), clients = [];
function client(name, uid, claims = {}) {
    const app = initializeApp({ projectId, apiKey: 'demo', appId: name }, name), db = initializeFirestore(app, {});
    connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, ...claims } } : undefined);
    clients.push({ app, db }); return db;
}
let checks = 0;
async function denied(action) { await assert.rejects(action, e => e.code === 'permission-denied'); checks++; }
const root = 'users/owner/projects/migrated';
try {
    const owner = client('owner', 'owner'), other = client('other', 'other'), anon = client('anon');
    await admin.doc('users/owner').set({ uid: 'owner', status: { disabled: false, moderationHold: false } });
    const migrated = { version: 6, projectId: 'migrated', ownerUid: 'owner', workId: 'work',
        authoringBackend: 'r2-private', authoringStorageVersion: 1, authoringRef: 'authoringHeads/current', dsfStatus: 'private' };
    await admin.doc(root).set(migrated);
    await admin.doc(`${root}/authoringControl/current`).set({ status: 'active' });
    await admin.doc(`${root}/authoring/current`).set({ version: 6, projectId: 'migrated', blocks: [] });
    const summary = createProjectSummary({ ...migrated, projectName: 'private' });
    await admin.doc('users/owner/project_summaries/migrated').set(summary);
    await admin.doc('users/owner/works/work').set({ projectId: 'migrated', ownerUid: 'owner' });
    await admin.doc('users/owner/works/work/releases/r').set({ title: 'release' });
    await admin.doc('public_projects/work').set({ authorUid: 'owner', projectId: 'migrated', workId: 'work' });
    const staff = client('staff', 'staff', { admin: true });
    await denied(() => setDoc(doc(staff, 'public_projects/work'), { title: 'unsafe resync' }, { merge: true }));
    await deleteDoc(doc(staff, 'public_projects/work')); checks++;
    await denied(() => setDoc(doc(staff, 'public_projects/work'), { authorUid: 'owner', projectId: 'migrated', workId: 'work' }));
    await admin.doc('public_projects/work').set({ authorUid: 'owner', projectId: 'migrated', workId: 'work' });
    assert((await getDoc(doc(owner, root))).exists()); checks++;
    await denied(() => getDoc(doc(other, root))); await denied(() => getDoc(doc(anon, root)));
    await denied(() => setDoc(doc(owner, root), { title: 'old client' }, { merge: true }));
    await denied(() => setDoc(doc(owner, root), { version: 5, projectId: 'migrated', blocks: [] }));
    await denied(() => deleteDoc(doc(owner, root)));
    await denied(() => getDoc(doc(owner, `${root}/authoring/current`)));
    await denied(() => setDoc(doc(owner, `${root}/authoring/current`), { version: 6, projectId: 'migrated', blocks: [] }));
    await denied(() => deleteDoc(doc(owner, `${root}/authoring/current`)));
    await denied(async () => { const b = writeBatch(owner); b.delete(doc(owner, `${root}/authoring/current`)); b.delete(doc(owner, root)); await b.commit(); });
    for (const path of [`${root}/authoringControl/current`, `${root}/authoringHeads/current`, `${root}/authoringRevisions/request`, `${root}/authoringActions/action`, `${root}/authoringMigrations/generation`, `${root}/authoringRollbacks/rollback`, 'users/owner/authoringUsage/current']) {
        await admin.doc(path).set({ sentinel: true });
        for (const db of [owner, other, anon]) {
            await denied(() => getDoc(doc(db, path))); await denied(() => setDoc(doc(db, path), { forged: true }));
        }
        await denied(() => deleteDoc(doc(owner, path)));
    }
    await denied(() => setDoc(doc(owner, 'users/owner/project_summaries/migrated'), summary));
    await denied(() => deleteDoc(doc(owner, 'users/owner/project_summaries/migrated')));
    for (const path of ['users/owner/works/work', 'users/owner/works/work/releases/r', 'public_projects/work']) {
        await denied(() => setDoc(doc(owner, path), { projectId: 'legacy' }, { merge: true }));
        await denied(() => deleteDoc(doc(owner, path)));
    }
    await denied(() => setDoc(doc(owner, 'users/owner/works/forged'), { projectId: 'migrated' }));
    await denied(() => setDoc(doc(owner, 'users/owner/projects/forged'), { version: 5, authoringBackend: 'r2-private' }));
    // Root markers protect the source even if control is missing or incomplete.
    await admin.doc(`${root}/authoringControl/current`).delete();
    await denied(() => setDoc(doc(owner, root), { version: 5, projectId: 'migrated' }));
    await denied(() => deleteDoc(doc(owner, root)));
    await admin.doc(`${root}/authoringControl/current`).set({ status: 'deleted' });
    // A missing root with a retained control document remains protected.
    await admin.doc(root).delete();
    await denied(() => setDoc(doc(owner, root), { version: 5, projectId: 'migrated' }));
    // Legacy v5 and atomic v6 saving/deletion retain their existing contract.
    const legacy = 'users/owner/projects/legacy';
    await setDoc(doc(owner, legacy), { version: 5, projectId: 'legacy', blocks: [] }); checks++;
    const batch = writeBatch(owner);
    batch.set(doc(owner, `${legacy}/authoring/current`), { version: 6, projectId: 'legacy', blocks: [] });
    batch.set(doc(owner, legacy), { version: 6, projectId: 'legacy', authoringRef: 'authoring/current', authoringSchemaVersion: 6 });
    await batch.commit(); checks++;
    await denied(() => getDoc(doc(other, `${legacy}/authoring/current`)));
    const deletion = writeBatch(owner); deletion.delete(doc(owner, legacy)); deletion.delete(doc(owner, `${legacy}/authoring/current`)); await deletion.commit(); checks++;
    // Real emulator REST transactions exercise typed exports and atomic migration/rollback.
    const f = maintenanceFixture(), target = maintenanceScope, r = `users/${target.uid}/projects/${target.projectId}`;
    for (const [path, raw] of f.docs) await admin.doc(path).set(decodeFirestoreValue({ mapValue: { fields: raw.fields } }));
    const realStore = createFirestoreStore({ projectId, post: async (url, body) => {
        assert(url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`));
        const response = await fetch(url.replace('https://firestore.googleapis.com', `http://${address}`), {
            method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value;
    } });
    const maintenance = createAuthoringMaintenance({ db: realStore, bucket: f.bucket, backups: createMaintenanceBackupStore(f.rawBucket),
        authorize: async candidate => assert.deepEqual(candidate, target), now: f.time });
    const own = client('maintenance-owner', target.uid);
    const plan = await maintenance.inspectMigration(target);
    await maintenance.migrate(target, plan.planHash); checks++;
    assert(!(await admin.doc(`${r}/authoring/current`).get()).exists); checks++;
    await denied(() => getDoc(doc(own, `${r}/authoring/current`)));
    const rollback = await maintenance.inspectRollback(target, 'restore');
    await maintenance.rollback(target, 'restore', rollback.planHash); checks++;
    const restored = (await getDoc(doc(own, `${r}/authoring/current`))).data();
    assert.deepEqual(restored.futurePrivate, f.source.futurePrivate); checks++;
    await denied(() => getDoc(doc(other, `${r}/authoring/current`)));
    const rootData = (await getDoc(doc(own, r))).data();
    const save = writeBatch(own);
    save.set(doc(own, `${r}/authoring/current`), { ...restored, title: 'edit after rollback' });
    save.set(doc(own, r), { ...rootData, title: 'edit after rollback' }); await save.commit(); checks++;
    await setDoc(doc(own, `users/${target.uid}/works/work_1`), { title: 'after rollback' }, { merge: true }); checks++;
    await setDoc(doc(own, `users/${target.uid}/project_summaries/${target.projectId}`), createProjectSummary({ ...rootData, title: 'after rollback' })); checks++;
    const { authoringRollbackGeneration, ...withoutMarker } = rootData;
    await denied(() => setDoc(doc(own, r), withoutMarker));
    await denied(() => setDoc(doc(own, r), { ...rootData, authoringRollbackGeneration: 'forged' }));
    await denied(() => setDoc(doc(own, `${r}/authoringControl/current`), { status: 'rolledBack', generationId: 'forged' }));
    await denied(() => setDoc(doc(own, r), { ...rootData, authoringBackend: 'r2-private' }));
    const remove = writeBatch(own); remove.delete(doc(own, `${r}/authoring/current`)); remove.delete(doc(own, r)); await remove.commit(); checks++;
    await denied(() => setDoc(doc(own, r), rootData));
    console.log(`Private authoring Rules: ${checks} emulator checks passed`);
} finally {
    await Promise.all(clients.map(async ({ app, db }) => { await terminate(db); await deleteApp(app); }));
    await deleteAdminApp(adminApp);
}
