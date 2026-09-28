import {check,segment} from './private-authoring/common.js';
import {resolveSpaceWorkAccess} from './publishing-space-directory.js';
import {readContext} from './private-authoring/service.js';
export const EDIT_LOCK_TTL=90_000, EDIT_LOCK_IDLE=30*60_000, EDIT_REQUEST_TTL=5*60_000;
// Server-only lease. The fencing token is private to one authenticated browser tab.
export function createSharedEditLock({db,assertLiveIdentity,spaceId,workId,now=Date.now,newId=()=>crypto.randomUUID()}) {
    async function read(tx,identity) {
        const scope=await resolveSpaceWorkAccess(tx,{actorUid:identity.uid,spaceId,workId,action:'readWork'});
        const source=await readContext(tx,{uid:scope.ownerUid},scope.projectId);
        const path=`users/${scope.ownerUid}/projects/${scope.projectId}/authoringLocks/current`;
        const [stored,user]=await tx.getMany([path,'users/'+identity.uid]);
        const matching=stored?.spaceId===spaceId&&stored.workId===workId&&stored.generationId===source.scope.generationId;
        let lock=matching?stored:null;
        if(lock?.holder){
            try{
                const holderAccess=lock.holder.uid===identity.uid?scope:await resolveSpaceWorkAccess(tx,{actorUid:lock.holder.uid,spaceId,workId,action:'readWork'});
                if(!holderAccess.canEdit||lock.holder.accessToken!==holderAccess.accessToken)lock=null;
            }catch(error){if(error.status===403)lock=null;else throw error;}
        }
        return {scope,path,lock,generationId:source.scope.generationId,name:String(user?.publicProfile?.displayName||user?.displayName||identity.uid).slice(0,80)};
    }
    const mine=(lock,identity,sessionId)=>!!lock?.holder&&lock.holder.uid===identity.uid&&lock.holder.sessionId===sessionId;
    const live=lock=>!!lock?.holder&&lock.expiresAt>now();
    const takeover=lock=>!live(lock)||now()-lock.lastEditAt>=EDIT_LOCK_IDLE;
    const pending=lock=>lock?.request&&lock.request.requestedAt+EDIT_REQUEST_TTL>now()?lock.request:null;
    function view(c,identity,sessionId) {
        const {scope,lock}=c,owned=mine(lock,identity,sessionId)&&live(lock),request=pending(lock);
        return {permissionCanEdit:scope.canEdit,canEdit:scope.canEdit&&owned,lock:{
            isMine:owned,holderName:live(lock)?lock.holder.name:null,expiresAt:lock?.expiresAt||null,lastEditAt:lock?.lastEditAt||null,
            canTakeover:scope.canEdit&&takeover(lock),requestPending:!!request&&request.uid===identity.uid&&request.sessionId===sessionId,
            ...(owned?{fence:lock.fence,requestId:request?.id||null,requesterName:request?.name||null}:{}),
        }};
    }
    async function assertWrite(tx,identity,sessionId,fence) {
        const c=await read(tx,identity);
        check(c.scope.canEdit,'EDIT_FORBIDDEN',403);
        check(mine(c.lock,identity,sessionId)&&live(c.lock)&&c.lock.fence===fence,'EDIT_LOCK_LOST',409);
        return c;
    }
    function holder(c,identity,sessionId) {
        return {schemaVersion:1,spaceId,workId,generationId:c.generationId,
            holder:{uid:identity.uid,sessionId,name:c.name,accessToken:c.scope.accessToken},fence:newId(),expiresAt:now()+EDIT_LOCK_TTL,lastEditAt:now(),request:null};
    }
    return {assertWrite,
        async status(identity,sessionId) {await assertLiveIdentity(identity);return db.transaction(async tx=>view(await read(tx,identity),identity,sessionId));},
        async execute(identity,{sessionId,action,fence,requestId}) {
            segment(sessionId);check(['acquire','heartbeat','edited','release','request','grant','cancel'].includes(action),'INVALID_LOCK_ACTION',400);
            await assertLiveIdentity(identity);
            return db.transaction(async tx=>{
                const c=await read(tx,identity);check(c.scope.canEdit,'EDIT_FORBIDDEN',403);
                let next=c.lock;
                if(action==='acquire') {
                    if(!(mine(c.lock,identity,sessionId)&&live(c.lock))) {
                        check(takeover(c.lock),'EDIT_LOCK_HELD',409);next=holder(c,identity,sessionId);
                    }
                } else if(action==='request') {
                    check(live(c.lock)&&!mine(c.lock,identity,sessionId),'EDIT_REQUEST_UNAVAILABLE',409);
                    const old=pending(c.lock);
                    check(!old||(old.uid===identity.uid&&old.sessionId===sessionId),'EDIT_REQUEST_PENDING',409);
                    next={...c.lock,request:old||{id:newId(),uid:identity.uid,sessionId,name:c.name,requestedAt:now()}};
                } else if(action==='cancel') {
                    const r=pending(c.lock);check(r&&r.uid===identity.uid&&r.sessionId===sessionId,'EDIT_REQUEST_UNAVAILABLE',409);
                    next={...c.lock,request:null};
                } else {
                    check(mine(c.lock,identity,sessionId)&&live(c.lock)&&c.lock.fence===fence,'EDIT_LOCK_LOST',409);
                    if(action==='release')next={...c.lock,holder:null,fence:null,expiresAt:0,request:null};
                    if(action==='heartbeat'||action==='edited') next={...c.lock,expiresAt:now()+EDIT_LOCK_TTL,...(action==='edited'?{lastEditAt:now()}:{})};
                    if(action==='grant') {
                        const r=pending(c.lock);check(r&&r.id===requestId,'EDIT_REQUEST_UNAVAILABLE',409);
                        const recipientScope=await resolveSpaceWorkAccess(tx,{actorUid:r.uid,spaceId,workId,action:'editWork'});
                        next=holder({...c,scope:recipientScope,name:r.name},{uid:r.uid},r.sessionId);
                    }
                }
                if(next!==c.lock)tx.set(c.path,{...next,lastEvent:{action,uid:identity.uid,at:now()}});
                return view({...c,lock:next},identity,sessionId);
            });
        }
    };
}
