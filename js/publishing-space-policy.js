// Catalogue is server-owned. Membership is not stored in DSP/DSF or authoring source.
export const isPublishedStatus = status => status === 'public' || status === 'unlisted';
export function publicationNeedsSpace(project, purpose = 'publication') {
    return purpose === 'draft' || !isPublishedStatus(project?.dsfStatus);
}
export function assignedPublishingSpace(catalogue, projectId) {
    const id = Object.hasOwn(catalogue?.assignments || {}, projectId) ? catalogue.assignments[projectId] : null;
    return catalogue?.schemaVersion === 1 && typeof id === 'string'
        && catalogue.spaceIds?.includes(id) ? id : null;
}
