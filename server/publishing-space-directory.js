import {check,segment} from './private-authoring/common.js';
import {canAccessPublishingSpace,validSpaceMember,canManageSpaceMember} from '../js/publishing-space-access.js';
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
async function memberToken(member){
    const value=[member.uid,member.spaceId,member.role,member.status,member.grants.map(g=>[g.role,g.scope,g.targetId??null]),member.joinedAt??null,member.invitationId??null];
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createSpaceDirectoryService({db,assertLiveIdentity,now=Date.now,allowedSpaceId=null,sharedEditingEnabled=true}){
    return {
        async listJoinedSpaces(identity,{afterSpaceId=null}={}){
            segment(identity.uid);if(afterSpaceId!==null)segment(afterSpaceId);
            await assertLiveIdentity(identity);
            const authorize=async tx=>{const [actor]=await tx.getMany(['users/'+identity.uid]);check(live(actor,identity.uid),'ACCOUNT_UNAVAILABLE',403);};
            await db.transaction(authorize);
            check(typeof db.listMembershipPaths==='function','SPACES_UNAVAILABLE',503);
            const paths=await db.listMembershipPaths(identity.uid,afterSpaceId);
            check(Array.isArray(paths)&&paths.length<=21&&new Set(paths).size===paths.length,'SPACES_UNAVAILABLE',503);
            const prefix='users/'+identity.uid+'/spaceMemberships/';
            const ids=paths.map(path=>{check(path.startsWith(prefix),'SPACES_UNAVAILABLE',503);const id=path.slice(prefix.length);segment(id);return id;});
            check(ids.every((id,i)=>(i===0||id>ids[i-1])&&(!afterSpaceId||id>afterSpaceId)),'SPACES_UNAVAILABLE',503);
            await assertLiveIdentity(identity);
            return db.transaction(async tx=>{
                await authorize(tx);const items=[];
                for(const spaceId of ids.slice(0,20)){
                    if(allowedSpaceId&&spaceId!==allowedSpaceId)continue;
                    let c;try{c=await readSpacePrincipal(tx,identity.uid,spaceId);}catch(e){if(e.code==='SPACE_FORBIDDEN')continue;throw e;}
                    if(c.space.ownerUid===identity.uid||!validSpaceMember(c.member,spaceId))continue;
                    items.push({id:spaceId,name:c.space.name,role:c.member.role,
                        canManageMembers:canAccessPublishingSpace(c,'manageMembers'),
                        access:c.member.role==='admin'?'editor':c.member.grants.some(g=>g.role==='editor')?'editor':'viewer'});
                }
                return {uid:identity.uid,items,nextCursor:ids.length>20?ids[19]:null};
            });
        },
        async memberAccess(identity,command){
            const {spaceId,memberUid,kind}=command;segment(spaceId);segment(memberUid);
            await assertLiveIdentity(identity);
            return db.transaction(async tx=>{
                const context=await readSpacePrincipal(tx,identity.uid,spaceId);
                const path=`users/${memberUid}/spaceMemberships/${spaceId}`;
                const [current,person]=await tx.getMany([path,'users/'+memberUid]);
                check(current&&canManageSpaceMember(context,current,current),'MEMBER_FORBIDDEN',403);
                check(current.role==='member','MEMBER_SCOPE_MANAGED',409);
                const token=await memberToken(current);
                const result=member=>({member:{uid:memberUid,displayName:person?.publicProfile?.displayName||person?.displayName||memberUid,role:member.role,grants:member.grants},memberToken:token});
                if(kind==='getMemberAccess')return result(current);
                check(kind==='setMemberAccess','INVALID_COMMAND',400);
                check(context.actor.entitlements?.canCreateProject===true,'EDIT_FORBIDDEN',403);
                check(typeof command.expectedToken==='string'&&/^[a-f0-9]{64}$/.test(command.expectedToken),'INVALID_TOKEN',400);
                check(typeof command.requestId==='string'&&/^[a-z0-9-]{16,64}$/.test(command.requestId),'INVALID_ID',400);
                check(Array.isArray(command.grants),'INVALID_GRANTS',400);
                const grants=command.grants.map(g=>({role:g?.role,scope:g?.scope,...(g?.scope==='space'?{}:{targetId:g?.targetId})}));
                const next={...current,grants};check(validSpaceMember(next,spaceId)&&canManageSpaceMember(context,current,next),'GRANT_FORBIDDEN',403);
                const auditPath=`users/${context.space.ownerUid}/memberAccessChanges/${command.requestId}`;
                const [audit]=await tx.getMany([auditPath]);
                const signature=JSON.stringify([identity.uid,spaceId,memberUid,command.expectedToken,grants]);
                if(audit){check(audit.signature===signature&&audit.afterToken===token,'MEMBER_CONFLICT',409);return result(current);}
                check(token===command.expectedToken,'MEMBER_CONFLICT',409);
                await validateSpaceInvitationTargets(tx,context.space,grants);
                const afterToken=await memberToken(next);
                tx.set(path,next);tx.set(auditPath,{actorUid:identity.uid,memberUid,spaceId,at:now(),before:current.grants,after:grants,afterToken,signature});
                return {...result(next),memberToken:afterToken};
            });
        },
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
                        available:live(a,uid),canChangeScope:m.role==='member'&&canManageSpaceMember(c,m,m),joinedAt:m.joinedAt??null});});
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
                const [catalogue]=await tx.getMany(['publishing_space_catalogues/'+spaceId]);
                // No shared registration yet is an empty directory, not an invitation failure.
                // A malformed existing catalogue must still fail closed.
                const stored=catalogue??{schemaVersion:1,workIds:[]};
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
                return {space:{id:spaceId,name:context.space.name},items,canOpen:sharedEditingEnabled,total:allowed.length,nextCursor:offset+20<allowed.length?items.at(-1).workId:null};
            });
        }
    };
}
