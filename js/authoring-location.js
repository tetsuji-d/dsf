// Local drafts reuse existing nullable identities; the file formats are unchanged.
const cloudKeys = ['ownerUid','ownerEmail','generationId','revision','publication','publishedAt','publicUrl','sharedScope','spaceId','labelId','lastUpdated','createdAt','updatedAt'];
export function clearCloudMetadata(project) {
    for (const key of Object.keys(project)) {
        if (/^(authoring|dsf)/.test(key) || cloudKeys.includes(key)) delete project[key];
    }
    project.visibility = 'private';
    project.dsfStatus = 'draft';
    project.dsfPages = [];
}
export function detachLocalProject(source, workId) {
    const copy = structuredClone(source);
    clearCloudMetadata(copy);
    delete copy.uid;
    delete copy.user;
    Object.assign(copy, {projectId:null, workId, releaseId:null, localProjectId:null});
    return copy;
}
export function useLocalAuthoringAssets({projectId,uid}, online=true) {
    return !projectId || !uid || !online;
}
