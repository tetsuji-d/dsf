import {createAuthoringService} from './private-authoring/service.js';
import {resolveSpaceWorkAccess} from './publishing-space-directory.js';
import {check,segment} from './private-authoring/common.js';
// Server construction only. No public route or rollout flag activates this adapter.
// Scope resolves from canonical binding; actor identity is never replaced at Auth checks.
export function createSharedAuthoringService({db,bucket,assertLiveIdentity,spaceId,workId,now=Date.now,assets=null,assertEditLock=null}){
    segment(spaceId);segment(workId);
    return createAuthoringService({db,bucket,assertLiveIdentity,now,
        validateSnapshot:assets?assets.validateProject:null,
        resolveAccess:async(tx,identity,projectId,action)=>{
            const scope=await resolveSpaceWorkAccess(tx,{actorUid:identity.uid,spaceId,workId,action});
            check(scope.projectId===projectId,'WORK_FORBIDDEN',403);
            if(action==='editWork'&&assertEditLock)await assertEditLock(tx,identity);
            return scope;
        }
    });
}
