import {createFirestoreStore} from './firestore.js';
import {AuthoringApiError,check,segment} from './common.js';
import {resolveSpaceWorkAccess} from '../publishing-space-directory.js';

export function createOwnerAuthoringStore(google){
    return createFirestoreStore(google,{additionalRootCollections:['publishing_work_scopes','publishing_spaces','publishing_labels']});
}

// A canonical shared-work binding is the boundary, not a currently live lease.
// Legacy owner-only space assignments alone do not activate shared authoring.
export async function readOwnerSharedScope(tx,uid,projectId,root) {
    segment(uid);segment(projectId);
    const lockPath=`users/${uid}/projects/${projectId}/authoringLocks/current`;
    const workId=root?.workId;
    if(workId)segment(workId);
    const [lock,binding]=await tx.getMany([lockPath,...(workId?['publishing_work_scopes/'+workId]:[])]);
    if(!lock&&!binding)return null;
    check(binding?.ownerUid===uid&&binding.projectId===projectId&&binding.workId===workId,
        'SHARED_SCOPE_UNAVAILABLE',409);
    const scope=await resolveSpaceWorkAccess(tx,{actorUid:uid,spaceId:binding.spaceId,workId,action:'readWork'});
    return {spaceId:scope.spaceId,workId:scope.workId,projectId:scope.projectId};
}
export function requirePersonalScope(sharedScope) {
    if(!sharedScope)return;
    const error=new AuthoringApiError('SHARED_AUTHORING_REQUIRED',409);
    error.sharedScope=sharedScope;throw error;
}
export async function assertPersonalMutation(tx,uid,projectId,root) {
    requirePersonalScope(await readOwnerSharedScope(tx,uid,projectId,root));
}
