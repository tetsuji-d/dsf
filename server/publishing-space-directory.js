import {check,segment} from './private-authoring/common.js';
import {canAccessPublishingSpace,validSpaceMember} from '../js/publishing-space-access.js';
export const SPACE_DIRECTORY_ROOTS=['handles','publishing_spaces','publishing_labels','publishing_work_scopes','publishing_space_catalogues'];
const live=(a,uid)=>a?.uid===uid&&a.status?.disabled===false&&a.status?.moderationHold!==true;
export async function readSpacePrincipal(tx,actorUid,spaceId){
    segment(actorUid);segment(spaceId);
    const [actor,stored,member]=await tx.getMany(['users/'+actorUid,'publishing_spaces/'+spaceId,'users/'+actorUid+'/spaceMemberships/'+spaceId]);
    check(live(actor,actorUid),'ACCOUNT_UNAVAILABLE',403);
    check(stored&&typeof stored.ownerUid==='string'&&stored.status!=='deleted','SPACE_FORBIDDEN',403);
    const space={...stored,id:spaceId};segment(space.ownerUid);
    const [owner]=await tx.getMany(['users/'+space.ownerUid]);check(live(owner,space.ownerUid),'SPACE_FORBIDDEN',403);
    check(actorUid===space.ownerUid||(member?.uid===actorUid&&validSpaceMember(member,spaceId)),'SPACE_FORBIDDEN',403);
    return {actorUid,actor,space,member,owner};
}
async function readBoundWork(tx,space,workId){
    segment(workId);
    const [binding]=await tx.getMany(['publishing_work_scopes/'+workId]);
    check(binding?.spaceId===space.id&&binding.ownerUid===space.ownerUid&&binding.workId===workId,'WORK_FORBIDDEN',403);
    segment(binding.projectId);if(binding.labelId!==null)segment(binding.labelId);
    const prefix='users/'+space.ownerUid;
    const [catalogue,root,work,label]=await tx.getMany([prefix+'/publishing/catalogue',prefix+'/projects/'+binding.projectId,prefix+'/works/'+workId,
        ...(binding.labelId?['publishing_labels/'+binding.labelId]:[])]);
    check(catalogue?.spaceIds?.includes(space.id)&&Object.hasOwn(catalogue.assignments||{},binding.projectId)
        &&catalogue.assignments[binding.projectId]===space.id,'WORK_FORBIDDEN',403);
    check(root?.ownerUid===space.ownerUid&&root.projectId===binding.projectId&&root.workId===workId
        &&work?.ownerUid===space.ownerUid&&work.projectId===binding.projectId,'WORK_FORBIDDEN',403);
    check(!binding.labelId||label?.spaceId===space.id&&label.status!=='deleted','WORK_FORBIDDEN',403);
    return {binding,root,resource:{id:workId,spaceId:space.id,labelId:binding.labelId}};
}
export async function resolveSpaceWorkAccess(tx,{actorUid,spaceId,workId,action}){
    check(['readWork','editWork'].includes(action),'ACTION_FORBIDDEN',403);
    const context=await readSpacePrincipal(tx,actorUid,spaceId),item=await readBoundWork(tx,context.space,workId);
    check(canAccessPublishingSpace(context,action,item.resource),'WORK_FORBIDDEN',403);
    if(action==='editWork')check(context.actor.entitlements?.canCreateProject===true&&context.owner.entitlements?.canCreateProject===true,'EDIT_FORBIDDEN',403);
    return {ownerUid:context.space.ownerUid,projectId:item.binding.projectId,workId,spaceId,
        canEdit:canAccessPublishingSpace(context,'editWork',item.resource)&&context.actor.entitlements?.canCreateProject===true&&context.owner.entitlements?.canCreateProject===true};
}
// Used at both invitation creation and acceptance. Names come from canonical records.
export async function validateSpaceInvitationTargets(tx,space,grants){
    segment(space.ownerUid);
    const [owner]=await tx.getMany(['users/'+space.ownerUid]);
    check(space.status!=='deleted'&&live(owner,space.ownerUid),'SPACE_FORBIDDEN',403);
    const labels=[];
    for(const grant of grants){
        if(grant.scope==='space'){labels.push(space.name);continue;}
        segment(grant.targetId);
        if(grant.scope==='label'){
            const [label]=await tx.getMany(['publishing_labels/'+grant.targetId]);
            check(label?.spaceId===space.id&&label.status!=='deleted','INVALID_TARGET',400);labels.push(label.name);
        }else if(grant.scope==='work'){
            const item=await readBoundWork(tx,space,grant.targetId);labels.push(item.root.title||item.root.projectName||grant.targetId);
        }else check(false,'INVALID_TARGET',400);
    }
    return labels;
}
export function createSpaceDirectoryService({db,assertLiveIdentity,now=Date.now}){
    return {
        async listMembers(identity,{spaceId,afterUid=null}) {
            segment(spaceId);if(afterUid!==null)segment(afterUid);
            const authorize=async tx=>{const c=await readSpacePrincipal(tx,identity.uid,spaceId);
                check(canAccessPublishingSpace(c,'manageMembers'),'SPACE_FORBIDDEN',403);return c;};
            await assertLiveIdentity(identity);await db.transaction(authorize);
            check(typeof db.listMemberPaths==='function','MEMBERS_UNAVAILABLE',503);
            const paths=await db.listMemberPaths(spaceId,afterUid);
            check(Array.isArray(paths)&&paths.length<=21&&new Set(paths).size===paths.length,'MEMBERS_UNAVAILABLE',503);
            const ids=paths.map(path=>{const parts=path.split('/');check(parts.length===4&&parts[0]==='users'&&parts[2]==='spaceMemberships'&&parts[3]===spaceId,'MEMBERS_UNAVAILABLE',503);segment(parts[1]);return parts[1];});
            await assertLiveIdentity(identity);
            return db.transaction(async tx=>{
                const c=await authorize(tx),selected=ids.slice(0,20),records=await tx.getMany(paths.slice(0,20));
                const users=await tx.getMany(selected.map(uid=>'users/'+uid));
                const items=[];
                records.forEach((m,i)=>{const uid=selected[i],a=users[i];if(uid===c.space.ownerUid||!m||m.status!=='active')return;
                    check(m.uid===uid&&validSpaceMember(m,spaceId),'MEMBERS_UNAVAILABLE',503);
                    items.push({uid,displayName:a?.publicProfile?.displayName||a?.displayName||uid,role:m.role,grants:m.grants,
                        available:live(a,uid),joinedAt:m.joinedAt??null});});
                return {space:{id:spaceId,name:c.space.name},owner:{uid:c.space.ownerUid,displayName:c.owner.publicProfile?.displayName||c.owner.displayName||c.space.ownerUid,role:'owner',grants:[]},
                    items,nextCursor:ids.length>20?selected.at(-1):null};
            });
        },
        async resolveRecipient(identity,{spaceId,handle}){
            await assertLiveIdentity(identity);
            check(typeof handle==='string'&&/^@?[a-z0-9_]{4,20}$/.test(handle),'INVALID_HANDLE',400);
            const normalized=handle.replace(/^@/,'');
            return db.transaction(async tx=>{
                const context=await readSpacePrincipal(tx,identity.uid,spaceId);
                check(canAccessPublishingSpace(context,'manageMembers'),'SPACE_FORBIDDEN',403);
                const usagePath='users/'+identity.uid+'/invitationLookup/current';
                const [binding,usage]=await tx.getMany(['handles/'+normalized,usagePath]);
                const minute=Math.floor(now()/60000),count=usage?.minute===minute?usage.count:0;
                check(Number.isSafeInteger(count)&&count>=0&&count<20,'LOOKUP_RATE_LIMIT',429);
                let result=null;
                if(binding?.handle===normalized&&typeof binding.uid==='string'){
                    segment(binding.uid);const [user]=await tx.getMany(['users/'+binding.uid]);
                    if(live(user,binding.uid)&&user.publicProfile?.handle===normalized){
                        result={uid:binding.uid,handle:normalized,displayName:user.publicProfile.displayName||normalized};
                    }
                }
                // Both hits and misses consume lookup budget. Never return account email/Google profile.
                tx.set(usagePath,{minute,count:count+1});return {recipient:result};
            });
        },
        async listWorks(identity,{spaceId,afterId=null,forInvitation=false}){
            await assertLiveIdentity(identity);
            return db.transaction(async tx=>{
                const context=await readSpacePrincipal(tx,identity.uid,spaceId);
                const [stored]=await tx.getMany(['publishing_space_catalogues/'+spaceId]);
                check(stored?.schemaVersion===1&&Array.isArray(stored.workIds)&&stored.workIds.length<=2000
                    &&new Set(stored.workIds).size===stored.workIds.length,'SPACE_CATALOGUE_UNAVAILABLE',503);
                const allowed=[];
                for(const id of stored.workIds){
                    segment(id);const [binding]=await tx.getMany(['publishing_work_scopes/'+id]);
                    if(!binding||binding.spaceId!==spaceId)continue;
                    const resource={id,spaceId,labelId:binding.labelId};
                    if(!canAccessPublishingSpace(context,'readWork',resource))continue;
                    // Reconcile legacy assignment/root/work for every result before pagination.
                    // Stale entries are omitted, never interpreted as access to their old space.
                    let item;try{item=await readBoundWork(tx,context.space,id);}catch(e){if(e.code==='WORK_FORBIDDEN')continue;throw e;}
                    allowed.push({workId:id,projectId:item.binding.projectId,title:item.root.title||item.root.projectName||id,
                        labelId:item.binding.labelId,canEdit:canAccessPublishingSpace(context,'editWork',resource)
                            &&context.actor.entitlements?.canCreateProject===true&&context.owner.entitlements?.canCreateProject===true});
                }
                if(forInvitation){
                    check(canAccessPublishingSpace(context,'manageMembers'),'SPACE_FORBIDDEN',403);
                    const labelIds=[...new Set(allowed.map(w=>w.labelId).filter(Boolean))];
                    const labels=await tx.getMany(labelIds.map(id=>'publishing_labels/'+id));
                    return {targets:[{scope:'space',name:context.space.name},
                        ...labels.flatMap((label,i)=>label?.spaceId===spaceId&&label.status!=='deleted'?[{scope:'label',targetId:labelIds[i],name:label.name}]:[]),
                        ...allowed.map(w=>({scope:'work',targetId:w.workId,name:w.title}))]};
                }
                const offset=afterId===null?0:allowed.findIndex(w=>w.workId===afterId)+1;
                check(afterId===null||offset>0,'CURSOR_INVALID',400);
                const items=allowed.slice(offset,offset+20);
                return {space:{id:spaceId,name:context.space.name},items,total:allowed.length,nextCursor:offset+20<allowed.length?items.at(-1).workId:null};
            });
        }
    };
}
