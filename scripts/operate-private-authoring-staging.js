// Staging-only operator for the single explicitly approved Unit F fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createGoogleClient } from '../server/private-authoring/google-auth.js';
import { createFirestoreStore } from '../server/private-authoring/firestore.js';
import { createAuthoringMaintenance } from '../server/private-authoring/maintenance.js';
import { createMaintenanceBackupStore } from '../server/private-authoring/maintenance-common.js';
import { createAuthoringBucket } from '../server/private-authoring/r2.js';
import { createPublicProjectProjection, prepareProjectForSave } from '../js/project-persistence.js';
import { createProjectSummary } from '../js/project-summary.js';
export const projectId = 'vmnn-26345-stg';
export const scope = Object.freeze({ uid: 'authoring_unit_f_20260920', projectId: 'unit_f_private_authoring_20260920', generationId: 'unit_f_generation_1' });
export const workId = 'unit_f_work_20260920';
export const root = `users/${scope.uid}/projects/${scope.projectId}`;
export const keyFile = new URL('../secrets/authoring-staging.service-account.json', import.meta.url);
const require = createRequire(import.meta.url);
export async function operator() {
    const auth = require('firebase-tools/lib/auth'), account = auth.getGlobalDefaultAccount();
    assert(account, 'Firebase CLI login required');
    const tokens = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: tokens.access_token, expires_in: 1800 }) } }, `unit-f-operator-${Date.now()}`);
    const dataApp = initializeApp({ projectId, credential: cert(JSON.parse(readCredential())) }, `unit-f-data-${Date.now()}`);
    const db = getFirestore(dataApp);
    return { app, db, auth: getAuth(app), close: async () => { await deleteApp(dataApp); await deleteApp(app); } };
}
export function readCredential() {
    const value = fs.readFileSync(keyFile, 'utf8'); const data = JSON.parse(value);
    assert.equal(data.project_id, projectId); assert.equal(data.client_email, `dsf-authoring-staging@${projectId}.iam.gserviceaccount.com`);
    return value;
}
export async function customToken() {
    const app = initializeApp({ projectId, credential: cert(JSON.parse(readCredential())) }, `unit-f-token-${Date.now()}`);
    try { return await getAuth(app).createCustomToken(scope.uid); } finally { await deleteApp(app); }
}
export function fixtureProject() {
    const text = '非公開R2の実接続を確認する検証用原稿です。\r\n改行・空白・日本語 😀 を保持します。\nこれは公開テスト用の文章です。';
    return prepareProjectForSave({ version: 6, projectId: scope.projectId, workId, projectName: 'Unit F 接続検証（テスト作品）', title: 'Unit F 接続検証',
        languages: ['ja'], defaultLang: 'ja', languageConfigs: { ja: { pageDirection: 'rtl' } }, bookMode: 'simple',
        book: { mode: 'simple', covers: { c1: { pageIndex: 0 }, c4: { pageIndex: 0 } } }, rating: 'all', license: 'all-rights-reserved', textPaperPreset: 'white',
        meta: { ja: { title: 'Unit F 接続検証', author: 'DSF接続検証', description: 'ステージング専用のテスト作品' } },
        blocks: [{ id: 'unit_f_page', kind: 'page', content: { pageKind: 'text', text, texts: { ja: text } } }],
        futurePrivate: { sentinel: 'UNIT_F_PRIVATE_DO_NOT_PUBLISH', '10': 'ten', '2': 'two' } });
}
async function seed(op) {
    const targets = [`users/${scope.uid}`, root, `${root}/authoring/current`, `users/${scope.uid}/works/${workId}`, `users/${scope.uid}/project_summaries/${scope.projectId}`];
    assert((await op.db.getAll(...targets.map(p => op.db.doc(p)))).every(s => !s.exists), 'Fixture already exists; will not overwrite');
    try { await op.auth.getUser(scope.uid); throw Error('Fixture auth user already exists; will not overwrite'); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    await op.auth.createUser({ uid: scope.uid, displayName: 'DSF Unit F 検証' });
    const source = fixtureProject(), project = { ...createPublicProjectProjection(source), ownerUid: scope.uid, dsfStatus: 'draft', visibility: 'private', lastUpdated: new Date() };
    const account = { uid: scope.uid, authProvider: 'google', displayName: 'DSF Unit F 検証', email: '', photoURL: '', handle: null,
        publicProfile: { displayName: 'DSF Unit F 検証', handle: null, bio: '', avatarUrl: '', backgroundUrl: '', updatedAt: null },
        roles: { reader: true, creator: true, admin: false, operator: false, moderator: false },
        plan: { tier: 'free', effectiveTier: 'free', status: 'active', provider: 'none', trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, canceledAt: null, updatedAt: null },
        entitlements: { canCreateProject: true, canUsePremiumPaper: false, canPublishPrivately: false, canUseAdvancedAnalytics: false, canManageLabel: false, canUseUnlimitedListing: false, canSchedulePublicExpiry: false },
        status: { disabled: false, moderationHold: false }, storage: { authoringRoot: `users/${scope.uid}/dsp/`, publishRoot: `users/${scope.uid}/dsf/`, initialized: true },
        unitFVerification: '2026-09-20', createdAt: new Date() };
    await op.db.runTransaction(async tx => {
        const refs = targets.map(p => op.db.doc(p)), rows = await tx.getAll(...refs); assert(rows.every(s => !s.exists));
        [account, project, { ...source, lastUpdated: new Date() }, { ownerUid: scope.uid, projectId: scope.projectId, title: source.title, projectName: source.projectName, createdAt: new Date() }, createProjectSummary(project)].forEach((v, i) => tx.create(refs[i], v));
    });
    console.log(JSON.stringify({ created: true, firebaseProject: projectId, scope, workId }));
}
export async function maintenance(op) {
    const { getPlatformProxy } = await import('../secrets/authoring-tooling/node_modules/wrangler/wrangler-dist/cli.js');
    const proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../secrets/authoring-remote.toml', import.meta.url)), persist: false, remoteBindings: true });
    const google = createGoogleClient({ projectId, serviceAccountJson: readCredential() });
    const authorize = async candidate => { assert.deepEqual(candidate, scope); const account = await op.db.doc(`users/${scope.uid}`).get(); assert.equal(account.data()?.unitFVerification, '2026-09-20'); };
    return { api: createAuthoringMaintenance({ db: createFirestoreStore(google), bucket: createAuthoringBucket(proxy.env.AUTHORING_BUCKET),
        backups: createMaintenanceBackupStore(proxy.env.AUTHORING_BUCKET), authorize }), dispose: () => proxy.dispose() };
}
async function main(mode) {
    assert(['seed', 'inspect', 'migrate', 'rollback', 'status'].includes(mode), 'Use seed|inspect|migrate|rollback|status');
    const op = await operator(); let m;
    try {
        if (mode === 'seed') return await seed(op);
        if (mode === 'status') {
            const docs = await op.db.getAll(...[root, `${root}/authoringControl/current`, `${root}/authoringHeads/current`, `${root}/authoring/current`].map(p => op.db.doc(p)));
            console.log(JSON.stringify({ scope, backend: docs[0].data()?.authoringBackend || 'firestore', status: docs[1].data()?.status || 'legacy', revision: docs[2].data()?.revision, legacyChildExists: docs[3].exists })); return;
        }
        m = await maintenance(op);
        const plan = mode === 'rollback' ? await m.api.inspectRollback(scope, 'unit_f_rollback_1') : await m.api.inspectMigration(scope);
        console.log(JSON.stringify(plan));
        if (mode === 'migrate') console.log(JSON.stringify(await m.api.migrate(scope, plan.planHash)));
        if (mode === 'rollback') console.log(JSON.stringify(await m.api.rollback(scope, 'unit_f_rollback_1', plan.planHash)));
    } finally { await m?.dispose(); await op.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv[2]).then(() => process.exit(0)).catch(e => { console.error(e.code || e.message); process.exit(1); });
