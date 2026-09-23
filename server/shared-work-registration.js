import {migrateSharedImages} from './shared-image-migration.js';
import {inspectSharedImages} from './shared-image-preflight.js';
import {isPrivateAuthoringId} from '../js/private-authoring-ids.js';
import {check} from './private-authoring/common.js';
import {readContext} from './private-authoring/service.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
import {readSpacePrincipal} from './publishing-space-directory.js';
import {sha256DsfBytes} from '../js/dsf-release-byte-sealing.js';

// Initial opt-in only. Does not move works, grant memberships, or publish.
export function createSharedWorkRegistration({db,privateBucket,publicBucket,publicBaseUrl,assertLiveIdentity,now=Date.now}) {
    const bucket=createAuthoringBucket(privateBucket);
    async function inspect(tx,identity,scope) {
        const {spaceId,workId,ownerUid,projectId}=scope;
        check(identity.uid===ownerUid,'OWNER_REQUIRED',403);
        const principal=await readSpacePrincipal(tx,identity.uid,spaceId);
        check(principal.space.ownerUid===ownerUid&&principal.actor.entitlements?.canCreateProject===true,'OWNER_REQUIRED',403);
        const source=await readContext(tx,identity,projectId);
        check(source.root.workId===workId&&source.head,'WORK_FORBIDDEN',403);
        const bindingPath='publishing_work_scopes/'+workId,indexPath='publishing_space_catalogues/'+spaceId;
        const [catalogue,work,binding,index,lock]=await tx.getMany([
            'users/'+ownerUid+'/publishing/catalogue','users/'+ownerUid+'/works/'+workId,
            bindingPath,indexPath,source.p.root+'/authoringLocks/current']);
        check(catalogue?.schemaVersion===1&&Number.isSafeInteger(catalogue.revision)&&catalogue.revision>=0
            &&catalogue.spaceIds?.includes(spaceId)&&catalogue.assignments?.[projectId]===spaceId,'SPACE_ASSIGNMENT_REQUIRED',409);
        check(work?.ownerUid===ownerUid&&work.projectId===projectId,'WORK_FORBIDDEN',403);
        check(!binding||(binding.spaceId===spaceId&&binding.ownerUid===ownerUid&&binding.projectId===projectId&&binding.workId===workId),'SHARED_SCOPE_CONFLICT',409);
        check(!lock||binding,'SHARED_SCOPE_UNAVAILABLE',409);
        check(!index||(index.schemaVersion===1&&Array.isArray(index.workIds)&&index.workIds.length<=2000
            &&index.workIds.every(isPrivateAuthoringId)&&new Set(index.workIds).size===index.workIds.length),'SPACE_CATALOGUE_UNAVAILABLE',503);
        check(!binding||index?.workIds.includes(workId),'SPACE_CATALOGUE_UNAVAILABLE',503);
        check(binding||!index?.workIds.includes(workId),'SHARED_SCOPE_CONFLICT',409);
        check(binding||(index?.workIds.length||0)<2000,'SPACE_CATALOGUE_FULL',409);
        return {source,binding,index,bindingPath,indexPath,catalogue,spaceName:principal.space.name};
    }
    const token=async(c,scope)=>sha256DsfBytes(new TextEncoder().encode(JSON.stringify({scope,
        head:c.source.head,catalogueRevision:c.catalogue.revision,mutationRevision:c.source.control.mutationRevision||0})));
    async function run(identity,scope,command=null) {
        check(identity.uid===scope.ownerUid,'OWNER_REQUIRED',403);
        await assertLiveIdentity(identity);
        const first=await db.transaction(tx=>inspect(tx,identity,scope));
        const url='/studio?room=editor&sharedSpace='+encodeURIComponent(scope.spaceId)+'&sharedWork='+encodeURIComponent(scope.workId);
        if(first.binding)return {registered:true,changed:false,editorUrl:url};
        const confirmationToken=await token(first,scope);
        if(command)check(command.kind==='register'&&command.confirmationToken===confirmationToken,'SHARED_PREPARATION_CHANGED',409);
        const {revision,...descriptor}=first.source.head;
        const {project}=await bucket.read(descriptor,first.source.scope);
        check(project.workId===scope.workId&&project.projectId===scope.projectId,'WORK_FORBIDDEN',403);
        const inspectCurrent=async tx=>{
            const current=await inspect(tx,identity,scope);
            check(!current.binding&&await token(current,scope)===confirmationToken,'SHARED_PREPARATION_CHANGED',409);
            return current;
        };
        const assertCurrent=async()=>{await assertLiveIdentity(identity);await db.transaction(inspectCurrent);};
        const writeBinding=(tx,current)=>{
            tx.set(current.bindingPath,{spaceId:scope.spaceId,ownerUid:scope.ownerUid,projectId:scope.projectId,
                workId:scope.workId,labelId:null,createdBy:identity.uid,createdAt:now()});
            tx.set(current.indexPath,{...current.index,schemaVersion:1,workIds:[...(current.index?.workIds||[]),scope.workId]});
        };
        const images=await inspectSharedImages({project,ownerUid:scope.ownerUid,publicBucket,publicBaseUrl,assertCurrent});
        if(command&&images.uniqueImages>0){
            const result=await migrateSharedImages({db,privateBucket,publicBucket,publicBaseUrl,identity,scope,project,images,command,
                inspectCurrent,assertCurrent,assertLiveIdentity,writeBinding,now});
            return {...result,editorUrl:url};
        }
        const hasImages=images.uniqueImages>0;
        await assertLiveIdentity(identity);
        return db.transaction(async tx=>{
            const current=await inspect(tx,identity,scope);
            check(await token(current,scope)===confirmationToken,'SHARED_PREPARATION_CHANGED',409);
            if(current.binding)return {registered:true,changed:false,editorUrl:url};
            const result={registered:false,ready:!hasImages||images.copyable,spaceName:current.spaceName,
                title:current.source.root.title||current.source.root.projectName||scope.workId,
                images,issues:hasImages?['IMAGE_MIGRATION_REQUIRED']:[],confirmationToken,
                restrictions:['SHARED_PUBLISHING_UNAVAILABLE','SHARED_EXPORT_UNAVAILABLE'],editorUrl:url};
            if(!command)return result;
            check(!hasImages,'IMAGE_MIGRATION_REQUIRED',409);
            writeBinding(tx,current);
            return {...result,registered:true,changed:true};
        });
    }
    return {prepare:(identity,scope)=>run(identity,scope),register:(identity,scope,command)=>run(identity,scope,command)};
}
