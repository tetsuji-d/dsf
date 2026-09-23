import {check,segment} from './private-authoring/common.js';
export function readInvitationRollout(env){
    check(env.FIREBASE_PROJECT_ID==='vmnn-26345-stg','INVITATIONS_DISABLED',503);
    let s;try{s=JSON.parse(env.PUBLISHING_INVITATIONS_TEST_SCOPE);}catch{check(false,'INVITATIONS_DISABLED',503);}
    check(s&&typeof s==='object','INVITATIONS_DISABLED',503);
    for(const k of ['spaceId','ownerUid','recipientUid'])segment(s[k]);
    check(s.ownerUid!==s.recipientUid&&/^@?[a-z0-9_]{4,20}$/.test(s.recipientHandle),'INVITATIONS_DISABLED',503);
    return Object.freeze(s);
}
export function createInvitationRolloutGuard({db,scope:s}){
    return async(identity,c)=>{
        const uid=identity.uid;
        check(uid===s.ownerUid||uid===s.recipientUid,'INVITATION_TEST_ONLY',403);
        check(c&&typeof c==='object','INVALID_COMMAND',400);
        if(c.kind==='inbox')return;
        const manager=['invite','outbox','listMembers','resolveRecipient','getMemberAccess','setMemberAccess'];
        if(manager.includes(c.kind))check(uid===s.ownerUid,'INVITATION_TEST_ONLY',403);
        if([...manager,'listSpaceWorks'].includes(c.kind)){
            check(c.spaceId===s.spaceId,'INVITATION_TEST_ONLY',403);
            if(['getMemberAccess','setMemberAccess'].includes(c.kind))check(c.memberUid===s.recipientUid,'INVITATION_TEST_ONLY',403);
            if(c.kind==='invite')check(c.recipientUid===s.recipientUid,'INVITATION_TEST_ONLY',403);
            if(c.kind==='resolveRecipient')check(typeof c.handle==='string'&&c.handle.replace(/^@/,'')===s.recipientHandle.replace(/^@/,''),'INVITATION_TEST_ONLY',403);
            await db.transaction(async tx=>{const [space]=await tx.getMany(['publishing_spaces/'+s.spaceId]);check(space?.ownerUid===s.ownerUid&&space.status!=='deleted','INVITATION_TEST_ONLY',403);});
            return;
        }
        check(['read','accept','decline','cancel'].includes(c.kind),'INVALID_COMMAND',400);
        check(typeof c.id==='string'&&/^inv_[a-z0-9-]{16,64}$/.test(c.id),'INVALID_ID',400);
        await db.transaction(async tx=>{const [i,space]=await tx.getMany(['publishing_invitations/'+c.id,'publishing_spaces/'+s.spaceId]);
            check(space?.ownerUid===s.ownerUid&&space.status!=='deleted'&&i?.spaceId===s.spaceId&&i.inviterUid===s.ownerUid&&i.recipientUid===s.recipientUid,'INVITATION_TEST_ONLY',403);
        });
    };
}
