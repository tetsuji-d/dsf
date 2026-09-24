// Resolve the owner project's assignment, never the dashboard's selected space.
export async function loadBookSpinePublisher({projectId, uid, request, isCurrent = () => true}) {
    const check = value => { if (!isCurrent() || value?.uid !== uid) throw new Error('AUTH_CHANGED'); };
    if (!uid || !projectId) return {name: '', icon: ''};
    const catalogue = await request(); check(catalogue);
    const space = catalogue.spaces.find(item => item.id === catalogue.assignments[projectId]);
    if (!space) return {name: '', icon: ''};
    let icon = '';
    if (space.profile?.icon) {
        const image = await request({kind: 'readImage', spaceId: space.id, slot: 'icon'});
        check(image); icon = image.dataUrl;
    }
    return {name: space.name, icon};
}
