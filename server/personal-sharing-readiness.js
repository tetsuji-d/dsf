import {check,segment} from './private-authoring/common.js';
import {readContext} from './private-authoring/service.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
import {prepareFirestoreProjectIngress} from '../js/project-persistence.js';
import {createPrivateAuthoringSnapshot} from '../js/private-authoring-storage.js';
import {mapSharedImageSlots,privateImageHash} from '../js/shared-authoring-assets.js';
import {managedImageKey} from './shared-image-preflight.js';
// Read-only release preflight. Never calls an operator migration or writes source.
export function createPersonalSharingReadiness({db,privateBucket,publicBaseUrl,assertLiveIdentity}){
    return async(identity,projectId)=>{
        const uid=segment(identity.uid);segment(projectId);await assertLiveIdentity(identity);
        async function inspect(tx){
            const rootPath='users/'+uid+'/projects/'+projectId;
            const [actor,root,catalogue,legacy]=await tx.getMany(['users/'+uid,rootPath,'users/'+uid+'/publishing/catalogue',rootPath+'/authoring/current']);
            check(actor?.uid===uid&&actor.status?.disabled===false&&actor.status?.moderationHold!==true,'ACCOUNT_UNAVAILABLE',403);
            check(root?.ownerUid===uid&&root.projectId===projectId,'WORK_FORBIDDEN',403);
            const workId=segment(root.workId),[binding]=await tx.getMany(['publishing_work_scopes/'+workId]);
            check(!binding&&!catalogue?.assignments?.[projectId],'PERSONAL_WORK_REQUIRED',409);
            const source=root.authoringBackend==='r2-private'?await readContext(tx,identity,projectId):null;
            return {root,legacy,source,stamp:JSON.stringify({root,legacy,head:source?.head,control:source?.control,assignment:catalogue?.assignments?.[projectId]||null})};
        }
        const initial=await db.transaction(inspect);let project;
        if(initial.source){const {revision,...descriptor}=initial.source.head||{};check(revision,'WORK_NOT_READY',409);
            project=(await createAuthoringBucket(privateBucket).read(descriptor,initial.source.scope)).project;
        }else{
            check([5,6].includes(initial.root.version),'SOURCE_FORMAT_UNSUPPORTED',409);
            const source=initial.root.version===6?initial.legacy:initial.root;
            check(source?.projectId===projectId&&source.workId===initial.root.workId,'WORK_NOT_READY',409);
            project=(await createPrivateAuthoringSnapshot(prepareFirestoreProjectIngress(source))).project;
        }
        const refs=new Set();await mapSharedImageSlots(project,ref=>{refs.add(ref);check(refs.size<=1000,'TOO_MANY_IMAGES',422);return ref;});
        const images={total:refs.size,private:0,managed:0,unsupported:0};
        for(const ref of refs){if(privateImageHash(ref))images.private++;else if(managedImageKey(ref,uid,publicBaseUrl))images.managed++;else images.unsupported++;}
        await assertLiveIdentity(identity);await db.transaction(async tx=>{check((await inspect(tx)).stamp===initial.stamp,'SOURCE_CHANGED',409);});
        const blockers=[];
        if(!initial.source)blockers.push('SOURCE_MIGRATION_REQUIRED');
        if(images.managed)blockers.push('IMAGE_MIGRATION_REQUIRED');
        if(images.unsupported)blockers.push('UNSUPPORTED_IMAGE_REFERENCE');
        return {storage:initial.source?'private':'legacy',images,blockers,canAttemptSharing:blockers.length===0,
            sourceChanged:false,publicationChanged:false};
    };
}
