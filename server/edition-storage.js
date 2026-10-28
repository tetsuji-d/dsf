// Only the paths emitted by Press v1 and the v2 release planner are managed here.
export function parseEditionStoragePath(path) {
    if (typeof path !== 'string') return null;
    const match = /^users\/([A-Za-z0-9_-]+)\/dsf\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/(?:([A-Za-z][A-Za-z0-9-]*)\/page_\d+\.webp|(content\.json|content\/language-\d{4}\.json|assets\/images\/language-\d{4}\/page-\d{5}\.webp))$/.exec(path);
    return match ? { uid: match[1], workId: match[2], releaseId: match[3], v2: !!match[5] } : null;
}
export function editionStorageTombstone(uid, workId, releaseId) {
    if (![uid, workId, releaseId].every(value => /^[A-Za-z0-9_-]+$/.test(value))) throw new Error('EDITION_STORAGE_ID_INVALID');
    return `edition-tombstones/${uid}/${workId}/${releaseId}`;
}
