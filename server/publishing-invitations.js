import { check, segment, AuthoringApiError, parseJson, readBounded } from './private-authoring/common.js';
import { canManageSpaceMember, canAccessPublishingSpace, validSpaceMember } from '../js/publishing-space-access.js';

// Shared by the gated Pages endpoint and local fixtures.
// The transaction adapter is shared with private authoring; every write follows a read.
export const INVITATION_ROOTS = ['publishing_spaces', 'publishing_invitations', 'publishing_invitation_indexes', 'publishing_invitation_audit'];
const accountPath = uid => 'users/' + segment(uid);
const memberPath = (uid, spaceId) => accountPath(uid) + '/spaceMemberships/' + segment(spaceId);
const inboxPath = uid => accountPath(uid) + '/notificationState/inbox';
const noticePath = (uid, id) => accountPath(uid) + '/notifications/' + id;
const invitePath = id => 'publishing_invitations/' + id;
const isLive = (a, uid) => a?.uid === uid && a.status?.disabled === false && a.status?.moderationHold !== true;
const effective = (i, time) => i.status === 'pending' && i.expiresAt !== null && i.expiresAt <= time ? 'expired' : i.status;
const emptyIndex = () => ({schemaVersion:1, ids:[], unreadCount:0});
function indexOf(value) {
    const v = value || emptyIndex();
    check(v.schemaVersion === 1 && Array.isArray(v.ids) && v.ids.length <= 1000 && new Set(v.ids).size === v.ids.length
        && v.ids.every(id => /^inv_[a-z0-9-]{16,64}$/.test(id)) && Number.isSafeInteger(v.unreadCount) && v.unreadCount >= 0, 'INDEX_INVALID');
    return v;
}
function pageIds(index, cursor) {
    if (cursor == null) return index.ids.slice(0,20);
    check(index.ids.includes(cursor), 'CURSOR_INVALID',400);
    return index.ids.slice(index.ids.indexOf(cursor)+1,index.ids.indexOf(cursor)+21);
}
const publicInvite = (i, time) => ({id:i.id,spaceId:i.spaceId,spaceName:i.spaceName,inviterUid:i.inviterUid,
    inviterName:i.inviterName,recipientUid:i.recipientUid,recipientName:i.recipientName||i.recipientUid,role:i.role,grants:i.grants,scopeLabels:i.scopeLabels,
    createdAt:i.createdAt,expiresAt:i.expiresAt,status:effective(i,time)});
export function createPublishingInvitationsService({db,assertLiveIdentity,validateScopeTargets,now=Date.now,allowActivation=false}) {
    async function execute(identity, command) {
        segment(identity?.uid);
        await assertLiveIdentity(identity);
        const kind=command?.kind;
        check(['invite','inbox','outbox','read','accept','decline','cancel'].includes(kind),'INVALID_COMMAND',400);
        const time=now(), uid=identity.uid;
        return db.transaction(async tx => {
            const [account]=await tx.getMany([accountPath(uid)]);
            check(isLive(account,uid),'ACCOUNT_UNAVAILABLE',403);
            if (kind === 'inbox') {
                const [stored]=await tx.getMany([inboxPath(uid)]), index=indexOf(stored), ids=pageIds(index,command.cursor);
                const notices=await tx.getMany(ids.map(id=>noticePath(uid,id)));
                const invitations=await tx.getMany(ids.map(invitePath));
                check(notices.every((n,j)=>n?.recipientUid===uid && n.invitationId===ids[j]) && invitations.every(i=>i?.recipientUid===uid),'INDEX_INVALID');
                const nextCursor=ids.length && index.ids.indexOf(ids.at(-1))<index.ids.length-1 ? ids.at(-1):null;
                return {items:notices.map((n,j)=>({...n,invitation:publicInvite(invitations[j],time)})),unreadCount:index.unreadCount,nextCursor};
            }
            if (kind === 'invite' || kind === 'outbox') {
                const spaceId=segment(command.spaceId);
                const [storedSpace,member,storedOut]=await tx.getMany(['publishing_spaces/'+spaceId,memberPath(uid,spaceId),'publishing_invitation_indexes/'+spaceId]);
                const space=storedSpace && {...storedSpace,id:spaceId}, context={actorUid:uid,space,member};
                check(canAccessPublishingSpace(context,'manageMembers'),'SPACE_FORBIDDEN',403);
                const out=indexOf(storedOut);
                if (kind === 'outbox') {
                    const ids=pageIds(out,command.cursor), items=await tx.getMany(ids.map(invitePath));
                    check(items.every(i=>i?.spaceId===spaceId),'INDEX_INVALID');
                    const people=await tx.getMany(items.map(i=>accountPath(i.recipientUid)));
                    return {items:items.map((i,j)=>publicInvite({...i,recipientName:people[j]?.publicProfile?.displayName||people[j]?.displayName||i.recipientUid},time)),nextCursor:ids.length && out.ids.indexOf(ids.at(-1))<out.ids.length-1 ? ids.at(-1):null};
                }
                check(account.entitlements?.canCreateProject===true,'EDIT_FORBIDDEN',403);
                const recipientUid=segment(command.recipientUid), id=command.id;
                check(typeof id==='string' && /^inv_[a-z0-9-]{16,64}$/.test(id),'INVALID_ID',400);
                check(recipientUid!==uid && recipientUid!==space.ownerUid,'RECIPIENT_INVALID',400);
                const days=command.expiryDays;
                check(days===null || (Number.isInteger(days) && days>=1 && days<=30),'INVALID_EXPIRY',400);
                check(Array.isArray(command.grants),'INVALID_GRANTS',400);
                // Canonicalize fields; never retain client-supplied membership metadata.
                const grants=command.grants.map(g=>({role:g?.role,scope:g?.scope,...(g?.scope==='space'?{}:{targetId:g?.targetId})}));
                const next={uid:recipientUid,spaceId,status:'active',role:command.role,grants};
                check(validSpaceMember(next,spaceId),'INVALID_GRANTS',400);
                const slotPath=accountPath(recipientUid)+'/spaceInvites/'+spaceId;
                const usagePath=accountPath(uid)+'/invitationUsage/current';
                const auditPath='publishing_invitation_audit/'+id+'_created';
                const [recipient,current,existing,storedInbox,slot,usage,notice,audit]=await tx.getMany([
                    accountPath(recipientUid),memberPath(recipientUid,spaceId),invitePath(id),inboxPath(recipientUid),slotPath,usagePath,noticePath(recipientUid,id),auditPath]);
                check(isLive(recipient,recipientUid),'RECIPIENT_UNAVAILABLE',404);
                check(canManageSpaceMember(context,null,next),'GRANT_FORBIDDEN',403);
                const signature=JSON.stringify({spaceId,recipientUid,role:next.role,grants,days});
                if(existing){check(existing.inviterUid===uid && existing.signature===signature,'INVITATION_CONFLICT',409);return {invitation:publicInvite(existing,time)};}
                check(!current || current.status!=='active','ALREADY_MEMBER',409);
                const [previous]=slot?.invitationId ? await tx.getMany([invitePath(slot.invitationId)]) : [null];
                check(!previous || effective(previous,time)!=='pending','INVITATION_PENDING',409);
                check(typeof validateScopeTargets==='function','SHARING_NOT_READY',503);
                const scopeLabels=await validateScopeTargets(tx,space,grants);
                check(Array.isArray(scopeLabels) && scopeLabels.length===grants.length && scopeLabels.every(s=>typeof s==='string'&&s.length<=200),'INVALID_TARGET',400);
                const inbox=indexOf(storedInbox), day=Math.floor(time/86400000), count=usage?.day===day?usage.count:0;
                check(Number.isSafeInteger(count)&&count>=0&&count<30,'INVITE_RATE_LIMIT',429);
                check(out.ids.length<1000 && inbox.ids.length<1000,'INVITATION_STORAGE_LIMIT',409);
                check(!notice&&!audit,'INVITATION_CONFLICT',409);
                const invitation={schemaVersion:1,id,spaceId,spaceName:space.name,inviterUid:uid,
                    inviterName:account.publicProfile?.displayName || account.displayName || uid,recipientUid,role:next.role,grants,scopeLabels,
                    createdAt:time,expiresAt:days===null?null:time+days*86400000,status:'pending',signature};
                tx.set(invitePath(id),invitation);
                tx.set(noticePath(recipientUid,id),{schemaVersion:1,id,category:'invitation',type:'space.invited',recipientUid,invitationId:id,createdAt:time,readAt:null});
                tx.set(inboxPath(recipientUid),{...inbox,ids:[id,...inbox.ids],unreadCount:inbox.unreadCount+1});
                tx.set('publishing_invitation_indexes/'+spaceId,{...out,ids:[id,...out.ids]});
                tx.set(slotPath,{invitationId:id});
                tx.set(usagePath,{day,count:count+1});
                tx.set(auditPath,{invitationId:id,spaceId,actorUid:uid,recipientUid,action:'created',at:time});
                return {invitation:publicInvite(invitation,time)};
            }
            const id=command.id;
            check(typeof id==='string'&&/^inv_[a-z0-9-]{16,64}$/.test(id),'INVALID_ID',400);
            const [invitation]=await tx.getMany([invitePath(id)]);
            check(invitation,'INVITATION_NOT_FOUND',404);
            const recipient=invitation.recipientUid, spaceId=invitation.spaceId;
            if(kind!=='cancel') check(recipient===uid,'INVITATION_NOT_FOUND',404);
            const [notice,storedInbox]=await tx.getMany([noticePath(recipient,id),inboxPath(recipient)]);
            check(notice?.recipientUid===recipient && notice.invitationId===id,'NOTICE_INVALID');
            const inbox=indexOf(storedInbox);
            const markRead=()=>{if(notice.readAt===null){check(inbox.unreadCount>0,'INDEX_INVALID');tx.set(noticePath(recipient,id),{...notice,readAt:time});tx.set(inboxPath(recipient),{...inbox,unreadCount:inbox.unreadCount-1});}};
            if(kind==='read'){markRead();return {invitation:publicInvite(invitation,time),canAccept:allowActivation===true};}
            const [rawSpace,inviterAccount,inviterMember,actorMember,current]=await tx.getMany([
                'publishing_spaces/'+spaceId,accountPath(invitation.inviterUid),memberPath(invitation.inviterUid,spaceId),memberPath(uid,spaceId),memberPath(recipient,spaceId)]);
            const space=rawSpace && {...rawSpace,id:spaceId}, actorContext={space,actorUid:uid,member:actorMember};
            const next={uid:recipient,spaceId,status:'active',role:invitation.role,grants:invitation.grants};
            if(kind==='cancel') check(canManageSpaceMember(actorContext,null,next),'SPACE_FORBIDDEN',403);
            const status={accept:'accepted',decline:'declined',cancel:'cancelled'}[kind];
            if(invitation.status===status) return {invitation:publicInvite(invitation,time)};
            check(effective(invitation,time)==='pending','INVITATION_CLOSED',409);
            if(kind==='accept') {
                check(allowActivation===true,'SHARING_NOT_READY',503);
                check(isLive(inviterAccount,invitation.inviterUid) && inviterAccount.entitlements?.canCreateProject===true
                    && canManageSpaceMember({space,actorUid:invitation.inviterUid,member:inviterMember},null,next),'INVITER_UNAVAILABLE',403);
                check(!current || current.status!=='active','ALREADY_MEMBER',409);
                check(typeof validateScopeTargets==='function','SHARING_NOT_READY',503);
                await validateScopeTargets(tx,space,invitation.grants);
            }
            const auditPath='publishing_invitation_audit/'+id+'_'+status;
            await tx.getMany([auditPath]);
            const updated={...invitation,status,resolvedAt:time,resolvedBy:uid};
            tx.set(invitePath(id),updated);
            if(kind==='accept') tx.set(memberPath(recipient,spaceId),{...next,joinedAt:time,invitationId:id});
            if(kind!=='cancel') markRead();
            tx.set(auditPath,{invitationId:id,spaceId,actorUid:uid,recipientUid:recipient,action:status,at:time});
            return {invitation:publicInvite(updated,time)};
        });
    }
    return {execute};
}
export function createPublishingInvitationsApi({service,verifyToken,directory=null,authorizeCommand=null}) {
    return async ({request,env})=>{
        const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Authorization, Origin'}});
        try {
            check(env.PUBLISHING_INVITATIONS_ENABLED==='true','INVITATIONS_DISABLED',503);
            check(request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN_FORBIDDEN',403);
            check(request.method==='POST','METHOD_NOT_ALLOWED',405);
            check(!request.headers.get('Origin')||request.headers.get('Origin')===new URL(request.url).origin,'ORIGIN_FORBIDDEN',403);
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
            check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
            const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');
            check(token,'AUTH_REQUIRED',401);
            const identity=await verifyToken(token[1]);check(identity?.uid,'AUTH_INVALID',401);
            const command=parseJson(await readBounded(request.body,16384));
            if(authorizeCommand)await authorizeCommand(identity,command);
            if(directory&&command?.kind==='listMembers')return response(await directory.listMembers(identity,command));
            if(directory&&command?.kind==='resolveRecipient')return response(await directory.resolveRecipient(identity,command));
            if(directory&&command?.kind==='listSpaceWorks')return response(await directory.listWorks(identity,command));
            return response(await service.execute(identity,command));
        }catch(error){return response({error:error instanceof AuthoringApiError?error.code:'INVITATIONS_UNAVAILABLE'},error instanceof AuthoringApiError?error.status:503);}
    };
}
