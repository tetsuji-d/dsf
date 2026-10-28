import { editionIdFor, editionUrl } from './edition-policy.js';
import { isPublicationActive } from './publication.js';

const visible = (record, now) => record?.moderationRejected !== true && ['public', 'unlisted'].includes(record?.dsfStatus) && isPublicationActive(record.publication || {}, record.dsfStatus, now);
export async function resolvePublicEdition(id, read, now = new Date()) {
    if (!/^e_[a-f0-9]{64}$/.test(id || '')) throw new Error('EDITION_ID_INVALID');
    const record = await read(id);
    if (!record) return { available: false, successorUrl: null };
    if (await editionIdFor(record.authorUid, record.workId, record.releaseId) !== id) throw new Error('EDITION_IDENTITY_INVALID');
    if (visible(record, now)) return { available: true, record, successorUrl: null };
    let successorUrl = null;
    if (!record.moderationRejected && record.dsfStatus !== 'rejected' && /^e_[a-f0-9]{64}$/.test(record.successorEditionId || '') && record.successorEditionId !== id) {
        const successor = await read(record.successorEditionId);
        if (visible(successor, now) && successor.authorUid === record.authorUid && successor.workId === record.workId
            && await editionIdFor(successor.authorUid, successor.workId, successor.releaseId) === record.successorEditionId) {
            successorUrl = editionUrl(record.successorEditionId);
        }
    }
    return { available: false, successorUrl };
}
