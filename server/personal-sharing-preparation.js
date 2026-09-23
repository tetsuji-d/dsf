import {check,segment} from './private-authoring/common.js';
import {readContext} from './private-authoring/service.js';
import {assertPersonalMutation} from './private-authoring/shared-boundary.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
import {createAuthoringMaintenance} from './private-authoring/maintenance.js';
import {createMaintenanceBackupStore,digestValue} from './private-authoring/maintenance-common.js';
import {createOwnerAssets} from './private-authoring/owner-assets.js';
import {inspectSharedImages} from './shared-image-preflight.js';
import {migrateSharedImages} from './shared-image-migration.js';
import {mapSharedImageSlots,privateImageHash} from '../js/shared-authoring-assets.js';
// Owner-only My space adapter. No rollback, arbitrary paths, public writes or membership changes.
export function createPersonalSharingPreparation({db,privateBucket,publicBucket,publicBaseUrl,assertLiveIdentity,now=Date.now}) {
    async function guard(tx,actor,projectId) {
        const uid=segment(actor.uid);segment(projectId);
        const [account,root,catalogue]=await tx.getMany(['users/'+uid,'users/'+uid+'/projects/'+projectId,'users/'+uid+'/publishing/catalogue']);
        check(account?.uid===uid&&account.status?.disabled===false&&account.status?.moderationHold!==true,'ACCOUNT_UNAVAILABLE',403);
        check(root?.ownerUid===uid&&root.projectId===projectId,'WORK_FORBIDDEN',403);
        check(!catalogue?.assignments?.[projectId],'PERSONAL_WORK_REQUIRED',409);
        await assertPersonalMutation(tx,uid,projectId,root);
        return root;
    }
    return async(actor,cmd)=>{
        const projectId=segment(cmd.projectId);await assertLiveIdentity(actor);
        if(['prepare-source','migrate-source'].includes(cmd.kind)) {
            check(typeof cmd.generationId==='string'&&/^personal_[a-f0-9-]{36}$/.test(cmd.generationId),'INVALID_GENERATION',400);
            const scope={uid:actor.uid,projectId,generationId:cmd.generationId};
            // Every maintenance transaction rechecks ownership/space/lock BEFORE its own reads/writes.
            const guarded={transaction:fn=>db.transaction(async tx=>{await guard(tx,actor,projectId);return fn(tx);})};
            const maintenance=createAuthoringMaintenance({db:guarded,bucket:createAuthoringBucket(privateBucket),backups:createMaintenanceBackupStore(privateBucket),now,
                authorize:async(s,kind)=>{check(kind==='migrate'&&s.uid===actor.uid&&s.projectId===projectId,'WORK_FORBIDDEN',403);await assertLiveIdentity(actor);await db.transaction(tx=>guard(tx,actor,projectId));}});
            if(cmd.kind==='prepare-source') {
                const p=await maintenance.inspectMigration(scope);
                return {generationId:scope.generationId,planHash:p.planHash,sourceBytes:p.sourceBytes,backupBytes:p.backupBytes};
            }
            check(cmd.confirm===true,'CONFIRMATION_REQUIRED',400);
            return maintenance.migrate(scope,cmd.planHash);
        }
        check(['prepare-images','migrate-images'].includes(cmd.kind),'INVALID_COMMAND',400);
        const inspect=async tx=>{await guard(tx,actor,projectId);return readContext(tx,actor,projectId);};
        const first=await db.transaction(inspect),scope={ownerUid:actor.uid,projectId,workId:segment(first.root.workId),spaceId:'personal'};
        const stamp=c=>digestValue({scope,head:c.head,control:c.control});
        const confirmationToken=await stamp(first);
        const inspectCurrent=async tx=>{const c=await inspect(tx);check(await stamp(c)===confirmationToken,'SOURCE_CHANGED',409);return c;};
        const assertCurrent=async()=>{await assertLiveIdentity(actor);await db.transaction(inspectCurrent);};
        const {revision,...descriptor}=first.head;
        const {project}=await createAuthoringBucket(privateBucket).read(descriptor,first.scope);
        const assets=createOwnerAssets({db,bucket:privateBucket,assertLiveIdentity,projectId,now});
        const inspectValidated=async tx=>{const c=await inspectCurrent(tx);await assets.validateReferences(tx,actor,project);return c;};
        const publicOnly=await mapSharedImageSlots(project,ref=>privateImageHash(ref)?'':ref);
        // Image bytes are checked independently; revalidate access and the head at transaction boundaries.
        // Per-image Firestore transactions exhaust the edge request budget on ordinary multi-image books.
        const images=await inspectSharedImages({project:publicOnly,ownerUid:actor.uid,publicBaseUrl,publicBucket});
        if(cmd.kind==='prepare-images'||!images.uniqueImages){await assertLiveIdentity(actor);await db.transaction(inspectValidated);}
        if(!images.uniqueImages)return {ready:true,changed:false,images};
        if(cmd.kind==='prepare-images')return {ready:images.copyable,confirmationToken,imagePlanHash:images.imagePlanHash,images};
        check(cmd.confirm===true&&cmd.confirmationToken===confirmationToken,'SOURCE_CHANGED',409);
        return migrateSharedImages({db,privateBucket,publicBucket,publicBaseUrl,identity:actor,scope,project,images,
            command:{...cmd,copyImages:true},inspectCurrent:inspectValidated,assertCurrent,assertLiveIdentity,writeBinding:()=>{},now,preservePrivate:true,checkpointEachImage:false});
    };
}
