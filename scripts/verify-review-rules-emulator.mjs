import assert from 'node:assert/strict';
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { createReviewClient } from '../js/review-client.js';
const address = process.env.FIRESTORE_EMULATOR_HOST, projectId = process.env.GCLOUD_PROJECT;
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(address || ''), 'local emulator only');
assert(projectId?.startsWith('demo-'), 'demo project only');
const [host, port] = address.split(':');
const root = adminApp({ projectId }), admin = getFirestore(root), clients = [];
sdk.setLogLevel('silent');
function client(uid, claims = {}) {
    const app = initializeApp({ projectId, apiKey: 'demo', appId: uid || 'anon' }, uid || 'anon');
    const db = sdk.initializeFirestore(app, {});
    sdk.connectFirestoreEmulator(db, host, +port, uid ? { mockUserToken: { sub: uid, ...claims } } : undefined);
    clients.push({ app, db }); return db;
}
let checks = 0;
async function allowed(label, fn) { await fn(); checks++; console.log('PASS', label); }
async function denied(label, fn) { await assert.rejects(fn, e => e.code === 'permission-denied'); checks++; console.log('PASS deny', label); }
const now = Date.now(), date = offset => new Date(now + offset);
const publication = { listedFrom: date(-60000), listedUntil: date(3600000), publicFrom: date(-60000), publicUntil: null, expiredAt: null, expireReason: null };
const work = { workId: 'work', projectId: 'project', releaseId: 'release', authorUid: 'author', dsfStatus: 'public', publication };
const payload = (id, patch = {}) => ({ reviewId: id, workId: 'work', projectId: 'project', releaseId: 'release', authorUid: 'author', readerUid: 'reader', readerName: 'Reader', goodCount: 0, badCount: 0, body: 'review', status: 'published', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp(), ...patch });
const reviewPath = 'reviews/work/items/review';
const review = { ...payload('review'), createdAt: date(-60000), updatedAt: date(-60000) };
try {
    const anon = client(), reader = client('reader'), voter = client('voter'), second = client('second'), staff = client('staff', { moderator: true });
    for (const uid of ['reader', 'voter', 'second', 'staff']) await admin.doc(`users/${uid}`).set({ status: { disabled: false, moderationHold: false } });
    await admin.doc('public_projects/work').set(work);
    await admin.doc(reviewPath).set(review);
    const ref = (db, path = reviewPath) => sdk.doc(db, path);
    const list = db => sdk.getDocsFromServer(sdk.query(sdk.collection(db, 'reviews/work/items'), sdk.where('status', '==', 'published'), sdk.limit(20)));
    await allowed('anonymous public review read and list', async () => { await sdk.getDocFromServer(ref(anon)); await list(anon); });
    for (const [label, change] of [
        ['unlisted', { dsfStatus: 'unlisted' }],
        ['private', { dsfStatus: 'private' }], ['draft', { dsfStatus: 'draft' }],
        ['scheduled', { publication: { ...publication, publicFrom: date(60000) } }],
        ['listing scheduled', { publication: { ...publication, listedFrom: date(60000) } }],
        ['listing expired', { publication: { ...publication, listedUntil: date(-1) } }],
        ['public expired', { publication: { ...publication, publicUntil: date(-1) } }],
        ['revoked', { publication: { ...publication, expiredAt: date(-1), expireReason: 'public' } }],
        ['missing publication', { publication: {} }]
    ]) {
        await admin.doc('public_projects/work').set({ ...work, ...change });
        if (label === 'unlisted') await allowed(label, () => list(anon));
        else {
            await denied(label + ' direct', () => sdk.getDocFromServer(ref(anon)));
            await denied(label + ' list', () => list(anon));
            await denied(label + ' post', () => sdk.setDoc(ref(reader, 'reviews/work/items/new'), payload('new')));
        }
    }
    await admin.doc('public_projects/work').delete();
    await denied('deleted work', () => sdk.getDocFromServer(ref(anon)));
    await allowed('own review after withdrawal', () => sdk.getDocFromServer(ref(reader)));
    await allowed('staff after withdrawal', () => sdk.getDocFromServer(ref(staff)));
    await admin.doc('public_projects/work').set(work);
    await admin.doc(reviewPath).update({ status: 'hidden' });
    await denied('hidden public review', () => sdk.getDocFromServer(ref(anon)));
    await allowed('hidden own review', () => sdk.getDocFromServer(ref(reader)));
    await allowed('staff moderation', () => sdk.updateDoc(ref(staff), { status: 'published', updatedAt: sdk.serverTimestamp() }));
    await denied('staff field injection', () => sdk.updateDoc(ref(staff), { secret: 'extra', updatedAt: sdk.serverTimestamp() }));
    await denied('staff field deletion', () => sdk.updateDoc(ref(staff), { body: sdk.deleteField(), updatedAt: sdk.serverTimestamp() }));
    await denied('anonymous post', () => sdk.setDoc(ref(anon, 'reviews/work/items/new'), payload('new')));
    for (const patch of [{ workId: 'fake' }, { projectId: 'fake' }, { releaseId: 'old' }, { authorUid: 'fake' }, { readerUid: 'voter' }, { goodCount: 2 }, { extra: true }, { body: '' }]) {
        await denied('forged post ' + JSON.stringify(patch), () => sdk.setDoc(ref(reader, 'reviews/work/items/new'), payload('new', patch)));
    }
    await denied('nonexistent work post', () => sdk.setDoc(ref(reader, 'reviews/missing/items/new'), payload('new', { workId: 'missing' })));
    for (const status of [{ disabled: true, moderationHold: false }, { disabled: false, moderationHold: true }]) {
        await admin.doc('users/reader').update({ status });
        await denied('blocked account post ' + JSON.stringify(status), () => sdk.setDoc(ref(reader, 'reviews/work/items/new'), payload('new')));
    }
    await admin.doc('users/reader').update({ status: { disabled: false, moderationHold: false } });
    const readerService = createReviewClient(reader, sdk), voteService = createReviewClient(voter, sdk);
    const context = { ...work, uid: 'reader' };
    await allowed('real client submit and load', async () => {
        const id = await readerService.submit(context, { body: 'client review', readerName: 'Reader' });
        const rows = await readerService.load(context); assert(rows.some(r => r.reviewId === id));
    });
    const votePath = reviewPath + '/reactions/voter';
    const vote = { workId: 'work', reviewId: 'review', uid: 'voter', reaction: 'good', createdAt: sdk.serverTimestamp(), updatedAt: sdk.serverTimestamp() };
    await denied('aggregate alone', () => sdk.updateDoc(ref(voter), { goodCount: 1, updatedAt: sdk.serverTimestamp() }));
    await denied('vote alone', () => sdk.setDoc(ref(voter, votePath), vote));
    async function batchVote(countPatch, votePatch = {}, uid = 'voter') {
        const batch = sdk.writeBatch(voter);
        batch.update(ref(voter), { ...countPatch, updatedAt: sdk.serverTimestamp() });
        batch.set(ref(voter, reviewPath + '/reactions/' + uid), { ...vote, ...votePatch });
        await batch.commit();
    }
    await denied('forged +2', () => batchVote({ goodCount: 2, badCount: 0 }));
    await denied('unrelated field addition', () => batchVote({ goodCount: 1, badCount: 0, extra: 'forged' }));
    await denied('unrelated field removal', () => batchVote({ goodCount: 1, badCount: 0, body: sdk.deleteField() }));
    await denied('another user vote', () => batchVote({ goodCount: 1, badCount: 0 }, { uid: 'second' }, 'second'));
    await denied('negative counter', () => batchVote({ goodCount: 1, badCount: -1 }));
    const vc = { ...work, uid: 'voter' };
    for (const [requested, good, bad, active] of [['good',1,0,'good'], ['bad',0,1,'bad'], ['bad',0,0,''], ['good',1,0,'good'], ['good',0,0,'']]) {
        await allowed('atomic vote ' + requested + ' -> ' + active, async () => {
            const result = await voteService.react(vc, 'review', requested);
            assert.deepEqual(result, { goodCount: good, badCount: bad, userReaction: active });
            const record = (await admin.doc(reviewPath).get()).data(); assert.equal(record.goodCount, good); assert.equal(record.badCount, bad);
        });
    }
    await voteService.react(vc, 'review', 'good');
    await denied('vote delete alone', () => sdk.deleteDoc(ref(voter, votePath)));
    await denied('vote switch alone', () => sdk.updateDoc(ref(voter, votePath), { reaction: 'bad', updatedAt: sdk.serverTimestamp() }));
    await denied('staff vote deletion without counts', () => sdk.deleteDoc(ref(staff, votePath)));
    await denied('other user vote read', () => sdk.getDocFromServer(ref(second, votePath)));
    await allowed('own vote read', () => sdk.getDocFromServer(ref(voter, votePath)));
    await admin.doc(reviewPath).update({ status: 'hidden' });
    await denied('hidden vote atomic', () => batchVote({ goodCount: 0, badCount: 1 }, { reaction: 'bad' }));
    await admin.doc(reviewPath).update({ status: 'published' });
    await admin.doc('public_projects/work').update({ dsfStatus: 'private' });
    await denied('withdrawn vote atomic', () => batchVote({ goodCount: 0, badCount: 1 }, { reaction: 'bad' }));
    await assert.rejects(() => voteService.load(vc), e => e.code === 'review-unavailable'); checks++;
    await admin.doc('public_projects/work').set({ ...work, releaseId: 'new-release' });
    await assert.rejects(() => readerService.submit(context, { body: 'old edition' }), e => e.code === 'review-edition-changed'); checks++;
    await allowed('old review remains readable on new edition', () => list(anon));
    await allowed('old review reactions on new edition', () => voteService.react(vc, 'review', 'good'));
    await admin.doc('public_projects/work').set(work);
    const secondService = createReviewClient(second, sdk);
    await allowed('concurrent independent voters', async () => {
        await Promise.all([voteService.react(vc, 'review', 'good'), secondService.react({ ...work, uid: 'second' }, 'review', 'good')]);
        assert.equal((await admin.doc(reviewPath).get()).data().goodCount, 2);
    });
    await admin.doc(reviewPath).update({ goodCount: 0 });
    await assert.rejects(() => voteService.react(vc, 'review', 'good'), /need repair/); checks++;
    await admin.doc(reviewPath).set(review);
    await admin.doc(votePath).delete();
    await admin.doc('users/voter').update({ status: { disabled: true, moderationHold: false } });
    await denied('disabled atomic vote', () => batchVote({ goodCount: 1, badCount: 0 }));
    await admin.doc('users/voter').update({ status: { disabled: false, moderationHold: true } });
    await denied('moderation hold atomic vote', () => batchVote({ goodCount: 1, badCount: 0 }));
    await admin.doc('users/voter').update({ status: { disabled: false, moderationHold: false } });
    const legacy = { ...review }; delete legacy.goodCount; delete legacy.badCount;
    await admin.doc(reviewPath).set(legacy);
    await allowed('legacy review missing counters can receive first vote', () => voteService.react(vc, 'review', 'good'));
    await denied('no vote transition', () => sdk.updateDoc(ref(voter), { updatedAt: sdk.serverTimestamp() }));
    await admin.doc('public_projects/work').set({ ...work, releaseId: null });
    await allowed('legacy null release post', () => readerService.submit({ ...context, releaseId: '' }, { body: 'legacy release', readerName: 'Reader' }));
    await admin.doc('public_projects/work').set(work);
    for(let i=0;i<22;i++) await admin.doc('reviews/work/items/a-'+String(i).padStart(2,'0')).set({ ...review, reviewId:'a-'+String(i).padStart(2,'0') });
    await admin.doc('reviews/work/items/zz-posted').set({ ...review, reviewId:'zz-posted', body:'new post outside first batch' });
    await allowed('new post outside first batch rechecked from server', async()=>{
        const loaded = await readerService.load(context,{postedReviewId:'zz-posted'});
        assert(loaded.some(row=>row.reviewId==='zz-posted'));
    });
    await admin.doc('reviews/work/items/zz-posted').update({status:'hidden'});
    await allowed('hidden new post is not restored from cache', async()=>{
        const loaded = await readerService.load(context,{postedReviewId:'zz-posted'});
        assert(!loaded.some(row=>row.reviewId==='zz-posted'));
    });
    await allowed('review owner deletion retained', () => sdk.deleteDoc(ref(reader)));
    console.log(`Review rules and production client: ${checks} checks passed.`);
} finally {
    await Promise.all(clients.map(async ({ app, db }) => { await sdk.terminate(db); await deleteApp(app); }));
    await admin.terminate(); await deleteAdminApp(root);
}
