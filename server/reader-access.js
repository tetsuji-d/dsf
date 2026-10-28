import { createGoogleClient } from './private-authoring/google-auth.js';
import { createFirestoreStore } from './private-authoring/firestore.js';
import { check } from './private-authoring/common.js';
import { editionIdFor } from '../js/edition-policy.js';
import { isPublicationActive } from '../js/publication.js';
import { normalizeEmbedPolicy } from '../js/embed-policy.js';

const runtimes = new WeakMap();
export function readerStore(env) {
    let db = runtimes.get(env);
    if (!db) {
        const google = createGoogleClient({ projectId: env.FIREBASE_PROJECT_ID, serviceAccountJson: env.AUTHORING_GOOGLE_SERVICE_ACCOUNT });
        db = createFirestoreStore(google, { additionalRootCollections: ['public_editions', 'reader_view_sessions', 'reader_view_totals', 'reader_view_days', 'reader_rate_limits'] });
        runtimes.set(env, db);
    }
    return db;
}
export async function readEditionAccess(tx, id, now = Date.now()) {
    check(/^e_[a-f0-9]{64}$/.test(id || ''), 'EDITION_ID_INVALID', 400);
    const [record] = await tx.getMany([`public_editions/${id}`]);
    check(record && !record.moderationRejected && ['public','unlisted'].includes(record.dsfStatus)
        && isPublicationActive(record.publication || {}, record.dsfStatus, new Date(now)), 'EDITION_UNAVAILABLE', 404);
    check(await editionIdFor(record.authorUid, record.workId, record.releaseId) === id, 'EDITION_IDENTITY_INVALID', 409);
    const [state] = await tx.getMany([`users/${record.authorUid}/works/${record.workId}/edition_states/${record.releaseId}`]);
    const policy = normalizeEmbedPolicy(state?.embedPolicy);
    return { record, policy, revision: state?.revision || 0 };
}
export const json = (data, status = 200) => Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });
export async function hash(value) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2,'0')).join('');
}
