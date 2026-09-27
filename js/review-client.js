import { toDate } from './publication.js';

// Match the review rules, including explicit publication revocation.
export function reviewWorkIsPublic(work, now = Date.now()) {
    const p = work?.publication;
    const start = toDate(p?.publicFrom)?.getTime();
    const end = toDate(p?.listedUntil)?.getTime();
    const listed = toDate(p?.listedFrom)?.getTime();
    const until = p?.publicUntil == null ? Infinity : toDate(p.publicUntil)?.getTime();
    return !!work && ['public', 'unlisted'].includes(work.dsfStatus)
        && Number.isFinite(start) && start <= now && Number.isFinite(end) && now < end
        && (p.listedFrom == null || (Number.isFinite(listed) && listed <= now))
        && now < until && p.expiredAt == null && p.expireReason == null;
}

export function reviewReactionCounts(review, previous, next) {
    const count = key => review[key] == null ? 0 : review[key];
    const good = count('goodCount'), bad = count('badCount');
    if (![good, bad].every(n => Number.isSafeInteger(n) && n >= 0)
        || !['', 'good', 'bad'].includes(previous) || !['', 'good', 'bad'].includes(next)) {
        throw new Error('Invalid review reaction data');
    }
    const goodCount = good - Number(previous === 'good') + Number(next === 'good');
    const badCount = bad - Number(previous === 'bad') + Number(next === 'bad');
    if (goodCount < 0 || badCount < 0) throw new Error('Review counts need repair');
    return { goodCount, badCount };
}

// The injected SDK keeps the same production path available to local emulator tests.
export function createReviewClient(db, sdk) {
    const { doc, collection, query, where, limit, getDocFromServer, getDocsFromServer,
        runTransaction, serverTimestamp, increment } = sdk;
    const workRef = context => doc(db, 'public_projects', context.workId);
    function assertWork(snap, context, posting = false) {
        const work = snap.exists() ? snap.data() : null;
        if (!reviewWorkIsPublic(work) || work.workId !== context.workId) {
            throw Object.assign(new Error('This work is no longer public.'), { code: 'review-unavailable' });
        }
        if (posting && ['authorUid', 'projectId', 'releaseId'].some(key => (work[key] || '') !== (context[key] || ''))) {
            throw Object.assign(new Error('The published edition changed. Reload before posting.'), { code: 'review-edition-changed' });
        }
        return work;
    }
    return {
        async load(context, { postedReviewId = '' } = {}) {
            assertWork(await getDocFromServer(workRef(context)), context);
            const snap = await getDocsFromServer(query(collection(db, 'reviews', context.workId, 'items'),
                where('status', '==', 'published'), limit(20)));
            const entries = [...snap.docs];
            if (postedReviewId && !entries.some(entry => entry.id === postedReviewId)) {
                const posted = await getDocFromServer(doc(db, 'reviews', context.workId, 'items', postedReviewId));
                if (posted.exists() && posted.data().status === 'published') entries.push(posted);
            }
            const reviews = await Promise.all(entries.map(async entry => {
                let userReaction = '';
                if (context.uid) {
                    const reaction = await getDocFromServer(doc(entry.ref, 'reactions', context.uid));
                    userReaction = reaction.exists() ? reaction.data().reaction : '';
                }
                return { ...entry.data(), reviewId: entry.id, userReaction };
            }));
            // Do not retain a previous successful list after revocation during loading.
            assertWork(await getDocFromServer(workRef(context)), context);
            return reviews;
        },
        async submit(context, { body, readerName }) {
            body = String(body || '').trim();
            if (!context.uid || !body || body.length > 2000) throw new Error('Invalid review');
            const ref = doc(collection(db, 'reviews', context.workId, 'items'));
            await runTransaction(db, async tx => {
                assertWork(await tx.get(workRef(context)), context, true);
                tx.set(ref, { reviewId: ref.id, workId: context.workId,
                    releaseId: context.releaseId || '', projectId: context.projectId || '',
                    authorUid: context.authorUid || '', readerUid: context.uid,
                    readerName: String(readerName || '').slice(0, 80), body, status: 'published',
                    goodCount: 0, badCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            });
            return ref.id;
        },
        async react(context, reviewId, requested) {
            if (!context.uid || !['good', 'bad'].includes(requested)) throw new Error('Invalid reaction');
            const ref = doc(db, 'reviews', context.workId, 'items', reviewId);
            const reactionRef = doc(ref, 'reactions', context.uid);
            return runTransaction(db, async tx => {
                assertWork(await tx.get(workRef(context)), context);
                const review = await tx.get(ref), vote = await tx.get(reactionRef);
                if (!review.exists() || review.data().status !== 'published') throw new Error('Review unavailable');
                const previous = vote.exists() ? vote.data().reaction : '';
                const next = previous === requested ? '' : requested;
                const counts = reviewReactionCounts(review.data(), previous, next);
                // Increment transforms remain valid when another reader votes concurrently.
                tx.update(ref, {
                    goodCount: increment(Number(next === 'good') - Number(previous === 'good')),
                    badCount: increment(Number(next === 'bad') - Number(previous === 'bad')),
                    updatedAt: serverTimestamp()
                });
                if (!next) tx.delete(reactionRef);
                else if (vote.exists()) tx.update(reactionRef, { reaction: next, updatedAt: serverTimestamp() });
                else tx.set(reactionRef, { workId: context.workId, reviewId, uid: context.uid,
                    reaction: next, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
                return { ...counts, userReaction: next };
            });
        }
    };
}
