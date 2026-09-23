import {check,segment} from './private-authoring/common.js';
import {readContext} from './private-authoring/service.js';
const live=(a,uid)=>a?.uid===uid&&a.status?.disabled===false&&a.status?.moderationHold!==true;
const sharePath=id=>'personal_work_shares/'+segment(id);
const invitePath=id=>'personal_work_invitations/'+segment(id);
const indexPath=uid=>'users/'+segment(uid)+'/personalSharing/inbox';
const status=(i,t)=>i.status==='pending'&&i.expiresAt!==null&&i.expiresAt<=t?'expired':i.status;
const expose=(i,t)=>({...i,status:status(i,t)});
export const PERSONAL_SHARING_ROOTS=['personal_work_shares','personal_work_invitations','handles','publishing_work_scopes'];
async function personalSource(tx,ownerUid,projectId,workId){
    const [owner,catalogue,binding]=await tx.getMany(['users/'+ownerUid,'users/'+ownerUid+'/publishing/catalogue','publishing_work_scopes/'+workId]);
    check(live(owner,ownerUid),'ACCOUNT_UNAVAILABLE',403);
    check(!catalogue?.assignments?.[projectId]&&!binding,'PERSONAL_WORK_REQUIRED',409);
    const c=await readContext(tx,{uid:ownerUid},projectId);
    check(c.root.workId===workId&&c.head,'WORK_NOT_READY',409);return c;
}
export async function resolvePersonalWorkAccess(tx,{actorUid,workId,action,now=Date.now()}){
    check(action==='readWork','READ_ONLY',403);
    const [actor,s]=await tx.getMany(['users/'+segment(actorUid),sharePath(workId)]);
    check(live(actor,actorUid)&&s?.workId===workId,'WORK_FORBIDDEN',403);
    const c=await personalSource(tx,s.ownerUid,s.projectId,workId);
    check(c.scope.generationId===s.generationId,'SHARE_SOURCE_CHANGED',409);
    if(actorUid!==s.ownerUid){
        const ids=s.invitationIds||[];check(ids.length<=100,'SHARE_INVALID');
        const invites=await tx.getMany(ids.map(invitePath));
        check(invites.some(i=>i?.workId===workId&&i.ownerUid===s.ownerUid&&i.generationId===s.generationId&&i.recipientUid===actorUid&&i.status==='accepted'),'WORK_FORBIDDEN',403);
    }
    return {ownerUid:s.ownerUid,projectId:s.projectId,workId,canEdit:false};
}
export function createPersonalSharingService({db,assertLiveIdentity,validateSource,now=Date.now}){
    async function execute(identity,cmd){
        const uid=segment(identity?.uid),kind=cmd?.kind,t=now();
        check(['prepare','outbox','lookup','invite','inbox','accept','decline','revoke'].includes(kind),'INVALID_COMMAND',400);
        await assertLiveIdentity(identity);
        // Validate actual saved content before offering an invitation, without changing it.
        let prepared=null;
        if(['prepare','invite'].includes(kind)){
            const projectId=segment(cmd.projectId);
            prepared=await db.transaction(async tx=>{
                const [root]=await tx.getMany(['users/'+uid+'/projects/'+projectId]);check(root?.ownerUid===uid,'WORK_FORBIDDEN',403);
                const workId=segment(root.workId),c=await personalSource(tx,uid,projectId,workId);
                return {ownerUid:uid,projectId,workId,generationId:c.scope.generationId,revision:c.head.revision,sha256:c.head.sha256};
            });
            await validateSource(identity,prepared);
        }
        return db.transaction(async tx=>{
            const [a]=await tx.getMany(['users/'+uid]);check(live(a,uid),'ACCOUNT_UNAVAILABLE',403);
            if(kind==='inbox'){
                const [index]=await tx.getMany([indexPath(uid)]),ids=index?.ids||[];check(ids.length<=200,'INDEX_INVALID');
                const items=await tx.getMany(ids.map(invitePath));
                check(items.every(i=>i?.recipientUid===uid),'INDEX_INVALID');
                return {items:items.map(i=>expose(i,t)),pendingCount:items.filter(i=>status(i,t)==='pending').length};
            }
            if(kind==='outbox'){
                const projectId=segment(cmd.projectId),[root]=await tx.getMany(['users/'+uid+'/projects/'+projectId]);
                check(root?.ownerUid===uid,'WORK_FORBIDDEN',403);
                if(!root.workId)return {items:[]};
                const [share]=await tx.getMany([sharePath(root.workId)]);
                check(!share||(share.ownerUid===uid&&share.projectId===projectId),'WORK_FORBIDDEN',403);
                const items=await tx.getMany((share?.invitationIds||[]).map(invitePath));
                return {items:items.map(i=>expose(i,t))};
            }
            if(kind==='lookup'){
                const handle=String(cmd.handle||'').replace(/^@/,'').toLowerCase();check(/^[a-z0-9_]{4,20}$/.test(handle),'INVALID_HANDLE',400);
                const usagePath='users/'+uid+'/personalSharing/lookup', [usage,record]=await tx.getMany([usagePath,'handles/'+handle]);
                const minute=Math.floor(t/60000),count=usage?.minute===minute?usage.count:0;check(count<20,'LOOKUP_LIMIT',429);
                const [target]=record?.uid?await tx.getMany(['users/'+segment(record.uid)]):[null];
                const recipient=record?.handle===handle&&live(target,record.uid)&&target.publicProfile?.handle===handle&&record.uid!==uid?{uid:record.uid,handle,displayName:target.publicProfile.displayName||target.displayName||handle}:null;
                tx.set(usagePath,{minute,count:count+1});return {recipient};
            }
            if(prepared){
                const c=await personalSource(tx,uid,prepared.projectId,prepared.workId);
                check(c.scope.generationId===prepared.generationId&&c.head.revision===prepared.revision&&c.head.sha256===prepared.sha256,'SOURCE_CHANGED',409);
                const path=sharePath(prepared.workId),[old]=await tx.getMany([path]);
                check(!old||(old.ownerUid===uid&&old.projectId===prepared.projectId&&old.generationId===prepared.generationId),'SHARE_SOURCE_CHANGED',409);
                const ids=old?.invitationIds||[],invitations=await tx.getMany(ids.map(invitePath));
                if(kind==='prepare')return {...prepared,title:c.root.projectName||c.root.title||'名称未設定',items:invitations.map(i=>expose(i,t))};
                check(cmd.revision===prepared.revision&&cmd.generationId===prepared.generationId,'SOURCE_CHANGED',409);
                const id=segment(cmd.id);check(/^personal_[a-z0-9-]{16,64}$/.test(id),'INVALID_ID',400);
                const recipientUid=segment(cmd.recipientUid);check(recipientUid!==uid,'SELF_INVITE',400);
                const days=cmd.expiresInDays;check([1,3,7,14,30,null].includes(days),'INVALID_EXPIRY',400);
                const ip=invitePath(id),up='users/'+uid+'/personalSharing/usage';
                const [existing,recipient,index,usage]=await tx.getMany([ip,'users/'+recipientUid,indexPath(recipientUid),up]);
                check(live(recipient,recipientUid),'RECIPIENT_UNAVAILABLE',403);
                if(existing){check(existing.ownerUid===uid&&existing.workId===prepared.workId&&existing.recipientUid===recipientUid&&existing.expiresInDays===days&&existing.generationId===prepared.generationId,'INVITATION_CONFLICT',409);return {invitation:expose(existing,t)};}
                check(ids.length<100&&(index?.ids||[]).length<200,'INVITATION_LIMIT',409);
                check(!invitations.some(i=>i.recipientUid===recipientUid&&['pending','accepted'].includes(status(i,t))),'ALREADY_SHARED',409);
                const day=Math.floor(t/86400000),count=usage?.day===day?usage.count:0;check(count<30,'INVITATION_LIMIT',429);
                const invitation={id,ownerUid:uid,inviterName:a.publicProfile?.displayName||a.displayName||uid,recipientUid,
                    recipientName:recipient.publicProfile?.displayName||recipient.displayName||recipientUid,
                    projectId:prepared.projectId,workId:prepared.workId,generationId:prepared.generationId,title:c.root.projectName||c.root.title||'名称未設定',
                    status:'pending',createdAt:t,expiresInDays:days,expiresAt:days===null?null:t+days*86400000};
                tx.set(path,{ownerUid:uid,projectId:prepared.projectId,workId:prepared.workId,generationId:prepared.generationId,invitationIds:[id,...ids]});
                tx.set(ip,invitation);tx.set(indexPath(recipientUid),{ids:[id,...(index?.ids||[])]});tx.set(up,{day,count:count+1});
                return {invitation};
            }
            const ip=invitePath(segment(cmd.id)),[i]=await tx.getMany([ip]);check(i,'INVITATION_NOT_FOUND',404);
            const owner=kind==='revoke';check(owner?i.ownerUid===uid:i.recipientUid===uid,'INVITATION_FORBIDDEN',403);
            const next=owner?'revoked':kind==='accept'?'accepted':'declined';
            if(i.status===next)return {invitation:expose(i,t)};
            check(owner?['pending','accepted'].includes(i.status):status(i,t)==='pending','INVITATION_CLOSED',409);
            if(kind==='accept'){
                const [s]=await tx.getMany([sharePath(i.workId)]);
                check(s?.ownerUid===i.ownerUid&&s.projectId===i.projectId&&s.generationId===i.generationId&&s.invitationIds.includes(i.id),'SHARE_INVALID',409);
                const c=await personalSource(tx,i.ownerUid,i.projectId,i.workId);check(c.scope.generationId===i.generationId,'SHARE_SOURCE_CHANGED',409);
            }
            const updated={...i,status:next,updatedAt:t};tx.set(ip,updated);return {invitation:expose(updated,t)};
        });
    }
    return {execute};
}
