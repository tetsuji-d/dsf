import {privateImageHash,mapSharedImageSlots} from '../../js/shared-authoring-assets.js';
import {createSharedAssets} from '../shared-assets.js';
import {readContext} from './service.js';
import {assertPersonalMutation} from './shared-boundary.js';
// Independent of invitation rollout: disabling sharing must not strand the owner's images.
export function createOwnerAssets({db,bucket,assertLiveIdentity,projectId,now=Date.now}) {
    const assets=createSharedAssets({db,bucket,assertLiveIdentity,spaceId:'personal',workId:projectId,now,
        resolveAccess:async(tx,actor)=>{
            const c=await readContext(tx,actor,projectId);
            await assertPersonalMutation(tx,actor.uid,projectId,c.root);
            return {ownerUid:actor.uid,projectId,workId:c.root.workId};
        }});
    return {...assets,async validateReferences(tx,actor,project,write=false){
        let hasPrivate=false;
        const selected=await mapSharedImageSlots(project,ref=>{if(privateImageHash(ref)){hasPrivate=true;return ref;}return '';});
        if(hasPrivate)await assets.validateProject(tx,actor,selected,write);
    }};
}
