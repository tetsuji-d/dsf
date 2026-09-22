// Pure policy over trusted server records. UI use is only a preview, never authorization.
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\/\\%\u0000-\u001f]/u.test(value);
const actions = new Set(['readWork','editWork','createWork','publishWork','moveWork','manageSpace','manageMembers','manageAdmins','billing','deleteSpace','transferOwnership']);
const ownerOnly = new Set(['manageAdmins','billing','deleteSpace','transferOwnership']);
const workActions = new Set(['readWork','editWork','publishWork','moveWork']);
export function validSpaceGrant(grant) {
    if (!grant || !['editor','viewer'].includes(grant.role)) return false;
    if (grant.scope === 'space') return grant.targetId === undefined || grant.targetId === null;
    return ['label','work'].includes(grant.scope) && id(grant.targetId);
}
export function validSpaceMember(member, spaceId) {
    return !!member && member.spaceId === spaceId && id(member.uid) && member.status === 'active'
        && (member.role === 'admin' ? Array.isArray(member.grants) && member.grants.length === 0
            : member.role === 'member' && Array.isArray(member.grants) && member.grants.length > 0
            && member.grants.length <= 100 && member.grants.every(validSpaceGrant));
}
function principal(context) {
    const {actorUid, space, member} = context || {};
    if (!id(actorUid) || !space || !id(space.id) || !id(space.ownerUid)) return null;
    if (space.ownerUid === actorUid) return 'owner';
    if (!validSpaceMember(member, space.id) || member.uid !== actorUid) return null;
    return member.role;
}
export function canAccessPublishingSpace(context, action, resource = null) {
    if (!actions.has(action)) return false;
    const role = principal(context);
    if (!role) return false;
    if (workActions.has(action) && (!resource || resource.spaceId !== context.space.id || !id(resource.id))) return false;
    if (action === 'createWork' && (!resource || resource.spaceId !== context.space.id || (resource.labelId != null && !id(resource.labelId)))) return false;
    if (role === 'owner') return true;
    if (ownerOnly.has(action)) return false;
    if (role === 'admin') return true;
    if (!['readWork','editWork','createWork'].includes(action)) return false;
    return context.member.grants.some(grant => {
        if (action !== 'readWork' && grant.role !== 'editor') return false;
        if (grant.scope === 'space') return true;
        if (grant.scope === 'label') return id(resource.labelId) && grant.targetId === resource.labelId;
        // A single-work editor cannot create another work by reusing the work ID.
        return action !== 'createWork' && grant.targetId === resource.id;
    });
}
export function visibleSpaceWorks(context, works) {
    return works.filter(work => canAccessPublishingSpace(context, 'readWork', work));
}
export function canManageSpaceMember(context, currentMember, nextMember) {
    const role = principal(context);
    if (!['owner','admin'].includes(role)) return false;
    const target = nextMember || currentMember;
    if (!target || target.uid === context.space.ownerUid || target.uid === context.actorUid || !id(target.uid)) return false;
    if (currentMember && (!['admin','member'].includes(currentMember.role) || currentMember.spaceId !== context.space.id || currentMember.uid !== target.uid)) return false;
    if (nextMember && !validSpaceMember(nextMember, context.space.id)) return false;
    // Only the owner may appoint, demote or remove an administrator.
    if (role === 'admin' && (currentMember?.role === 'admin' || nextMember?.role === 'admin')) return false;
    return true;
}
export function describeAccessChange(before, after, works) {
    const changes = [];
    for (const work of works) {
        const level = context => canAccessPublishingSpace(context,'editWork',work) ? 'editor' : canAccessPublishingSpace(context,'readWork',work) ? 'viewer' : 'none';
        const from = level(before), to = level(after);
        if (from !== to) changes.push({workId:work.id,from,to});
    }
    return changes;
}
