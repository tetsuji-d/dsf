import assert from 'node:assert/strict';
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import {
    connectFirestoreEmulator,
    deleteDoc,
    doc,
    getDoc,
    initializeFirestore,
    setDoc,
    terminate,
} from 'firebase/firestore';
import { createProjectSummary } from '../js/project-summary.js';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(emulatorAddress, 'Run this verifier through firebase emulators:exec --only firestore.');

const separator = emulatorAddress.lastIndexOf(':');
const host = emulatorAddress.slice(0, separator);
const port = Number(emulatorAddress.slice(separator + 1));
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'vmnn-26345-stg';
const ownerUid = 'summary-owner';
const otherUid = 'summary-other';
const disabledUid = 'summary-disabled';
const projectIdValue = 'summary-project';
const summaryPath = `users/${ownerUid}/project_summaries/${projectIdValue}`;

const clientApps = [];

function createClient(name, uid = null) {
    const app = initializeApp({
        apiKey: 'demo-api-key',
        appId: `demo-${name}`,
        projectId,
    }, `project-summary-${name}`);
    const firestore = initializeFirestore(app, {});
    const options = uid ? { mockUserToken: { sub: uid } } : undefined;
    connectFirestoreEmulator(firestore, host, port, options);
    clientApps.push({ app, firestore });
    return firestore;
}

async function assertDenied(action, message) {
    await assert.rejects(action, (error) => {
        assert.equal(error?.code, 'permission-denied', message);
        return true;
    });
}

const adminApp = initializeAdminApp({ projectId }, 'project-summary-rules-admin');
const adminDb = getAdminFirestore(adminApp);

try {
    await Promise.all([
        adminDb.doc(`users/${ownerUid}`).set({ status: { disabled: false, moderationHold: false } }),
        adminDb.doc(`users/${otherUid}`).set({ status: { disabled: false, moderationHold: false } }),
        adminDb.doc(`users/${disabledUid}`).set({ status: { disabled: true, moderationHold: false } }),
    ]);

    const ownerDb = createClient('owner', ownerUid);
    const otherDb = createClient('other', otherUid);
    const anonymousDb = createClient('anonymous');
    const disabledDb = createClient('disabled', disabledUid);
    const summary = createProjectSummary({
        version: 6,
        projectId: projectIdValue,
        projectName: 'Rules verification',
        lastUpdated: new Date('2026-09-02T00:00:00.000Z'),
        publication: {
            listedFrom: new Date('2026-09-02T00:00:00.000Z'),
            listedUntil: new Date('2026-09-16T00:00:00.000Z'),
            publicFrom: new Date('2026-09-02T00:00:00.000Z'),
            publicUntil: null,
            expiredAt: null,
            expireReason: null,
        },
    });

    await setDoc(doc(ownerDb, summaryPath), summary);
    assert.equal((await getDoc(doc(ownerDb, summaryPath))).exists(), true);

    await assertDenied(
        () => getDoc(doc(otherDb, summaryPath)),
        'another signed-in user must not read the summary'
    );
    await assertDenied(
        () => getDoc(doc(anonymousDb, summaryPath)),
        'an anonymous user must not read the summary'
    );
    await assertDenied(
        () => setDoc(doc(otherDb, summaryPath), summary),
        'another signed-in user must not write the summary'
    );
    await assertDenied(
        () => setDoc(
            doc(disabledDb, `users/${disabledUid}/project_summaries/disabled-project`),
            { ...summary, projectId: 'disabled-project' }
        ),
        'a disabled owner must not write the summary'
    );
    await assertDenied(
        () => setDoc(doc(ownerDb, summaryPath), { ...summary, blocks: [] }),
        'authoring fields must be rejected'
    );
    await assertDenied(
        () => setDoc(doc(ownerDb, summaryPath), { ...summary, projectId: 'wrong-project' }),
        'document id and projectId must match'
    );
    await assertDenied(
        () => setDoc(doc(ownerDb, summaryPath), { ...summary, listThumbnail: 'blob:local-preview' }),
        'non-HTTPS thumbnails must be rejected'
    );
    await assertDenied(
        () => setDoc(doc(ownerDb, summaryPath), {
            ...summary,
            publication: { ...summary.publication, planSnapshot: { tier: 'pro' } },
        }),
        'publication plan details must be rejected'
    );

    await deleteDoc(doc(ownerDb, summaryPath));
    assert.equal((await getDoc(doc(ownerDb, summaryPath))).exists(), false);

    console.log('Project summary Firestore Rules emulator verification passed.');
} finally {
    await Promise.all(clientApps.map(async ({ app, firestore }) => {
        await terminate(firestore).catch(() => {});
        await deleteApp(app).catch(() => {});
    }));
    await deleteAdminApp(adminApp).catch(() => {});
}
