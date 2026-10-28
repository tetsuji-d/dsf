import { isPrivateAuthoringId } from './private-authoring-ids.js';
import { isPublicationActive } from './publication.js';

export const EDITION_FOLDERS = Object.freeze(['public', 'unlisted', 'private', 'archived']);
export function editionFolder(state = {}, now = new Date()) {
    if (['archived', 'disposed'].includes(state.status)) return state.status;
    if (state.moderationRejected) return 'private';
    const status = state.status || state.dsfStatus || 'private';
    return ['public', 'unlisted'].includes(status) && isPublicationActive(state.publication || {}, status, now)
        ? status : 'private';
}
export async function editionIdFor(uid, workId, releaseId) {
    if (![uid, workId, releaseId].every(isPrivateAuthoringId)) throw new Error('EDITION_IDENTITY_INVALID');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([uid, workId, releaseId])));
    return 'e_' + [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function editionUrl(id, origin = globalThis.location?.origin || 'https://dsf.ink') {
    if (!/^e_[a-f0-9]{64}$/.test(id || '')) throw new Error('EDITION_ID_INVALID');
    const url = new URL('/viewer', origin); url.searchParams.set('edition', id); return url.href;
}
export function nextEditionStatus(current, action) {
    if (action === 'discard') {
        if (!['archived', 'disposed'].includes(current)) throw new Error('EDITION_ARCHIVE_REQUIRED');
        return 'disposed';
    }
    if (current === 'disposed') throw new Error('EDITION_DISPOSED');
    if (action === 'restore') {
        if (current !== 'archived') throw new Error('EDITION_ARCHIVE_REQUIRED');
        return 'private';
    }
    if (action === 'archive') return 'archived';
    if (action === 'successor' || action === 'label' || action === 'embed') return current;
    if (current === 'archived' || !['public', 'unlisted', 'private'].includes(action)) throw new Error('EDITION_TRANSITION_INVALID');
    return action;
}
