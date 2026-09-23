import {check,segment,readBounded,AuthoringApiError} from './private-authoring/common.js';
import {readContext} from './private-authoring/service.js';
import {resolveSpaceWorkAccess} from './publishing-space-directory.js';
import {inspectDsfWebPBytes,sha256DsfBytes} from '../js/dsf-release-byte-sealing.js';
import {privateImageRef,privateImageHash,mapSharedImageSlots} from '../js/shared-authoring-assets.js';
export const SHARED_IMAGE_MAX_BYTES=25*1024*1024;
// Only a dedicated private bucket is accepted by the runtime. No public URL is produced.
export function createSharedAssets({db,bucket,assertLiveIdentity,spaceId,workId,now=Date.now,assertEditLock=null,resolveAccess=null}) {
    segment(spaceId);segment(workId);
    async function context(tx,identity,write=false) {
        const access=resolveAccess ? await resolveAccess(tx,identity,write?'editWork':'readWork') : await resolveSpaceWorkAccess(tx,{actorUid:identity.uid,spaceId,workId,action:write?'editWork':'readWork'});
        if(write&&assertEditLock)await assertEditLock(tx,identity);
        const source=await readContext(tx,{uid:access.ownerUid},access.projectId);
        return {...access,generationId:source.scope.generationId,prefix:source.p.root};
    }
    const keyOf=(c,hash)=>`authoring-images/${c.ownerUid}/${c.projectId}/${c.generationId}/${hash}.webp`;
    const recordPath=(c,hash)=>`${c.prefix}/privateImageGenerations/${c.generationId}/images/${hash}`;
    function valid(record,c,hash,ready=true) {
        check(record && (!ready||record.status==='ready') && record.generationId===c.generationId
            && record.sha256===hash && record.ownerUid===c.ownerUid && record.projectId===c.projectId
            && Number.isSafeInteger(record.byteLength)&&record.byteLength>0&&record.byteLength<=SHARED_IMAGE_MAX_BYTES,
            'PRIVATE_IMAGE_NOT_READY',409);
    }
    async function charge(tx,c,write,length=0,isNew=false) {
        const path=`users/${c.ownerUid}/privateImageUsage/current`,[stored]=await tx.getMany([path]);
        const minute=Math.floor(now()/60000),day=Math.floor(now()/86400000);
        const usage={minute,requests:stored?.minute===minute?stored.requests:0,writes:stored?.minute===minute?stored.writes:0,
            day,uploadedBytes:stored?.day===day?stored.uploadedBytes:0,reservedBytes:stored?.reservedBytes??0,imageCount:stored?.imageCount??0};
        check(Object.values(usage).every(n=>Number.isSafeInteger(n)&&n>=0),'INVALID_USAGE_RECORD');
        check(++usage.requests<=120 && (!write||++usage.writes<=30),'RATE_LIMITED',429);
        if(write)usage.uploadedBytes+=length;if(isNew){usage.reservedBytes+=length;usage.imageCount++;}
        check(usage.uploadedBytes<=256*1024*1024 && usage.reservedBytes<=1024*1024*1024 && usage.imageCount<=10000,'IMAGE_QUOTA_EXCEEDED',429);
        return {path,usage};
    }
    async function readBytes(c,record) {
        let object;
        try {object=await bucket.get(keyOf(c,record.sha256));} catch {throw new AuthoringApiError('R2_UNAVAILABLE');}
        check(object,'PRIVATE_IMAGE_MISSING',502);
        try {
            check(object.size===record.byteLength && object.httpMetadata?.contentType==='image/webp'
                && object.customMetadata?.sha256===record.sha256,'PRIVATE_IMAGE_CORRUPT',502);
            const bytes=await readBounded(object.body,record.byteLength);
            check(bytes.length===record.byteLength && await sha256DsfBytes(bytes)===record.sha256,'PRIVATE_IMAGE_CORRUPT',502);
            return bytes;
        } catch(error){await object.body?.cancel().catch(()=>{});throw error;}
    }
    async function access(identity,write=false) {
        await assertLiveIdentity(identity);return db.transaction(tx=>context(tx,identity,write));
    }
    return {
        access,
        async put(identity,input) {
            await access(identity,true);
            check(input instanceof Uint8Array && input.length>0 && input.length<=SHARED_IMAGE_MAX_BYTES,'IMAGE_TOO_LARGE',413);
            const bytes=new Uint8Array(input);let info;
            try {info=await inspectDsfWebPBytes(bytes);}catch {throw new AuthoringApiError('INVALID_WEBP',422);}
            check(info.width<=7680&&info.height<=7680,'IMAGE_DIMENSIONS_INVALID',422);
            const hash=await sha256DsfBytes(bytes);
            const reserved=await db.transaction(async tx=>{
                const c=await context(tx,identity,true),path=recordPath(c,hash),[old]=await tx.getMany([path]);
                if(old){valid(old,c,hash,false);check(old.byteLength===bytes.length,'PRIVATE_IMAGE_CORRUPT',409);}
                const quota=await charge(tx,c,true,bytes.length,!old);
                const record=old||{schemaVersion:1,status:'pending',ownerUid:c.ownerUid,projectId:c.projectId,generationId:c.generationId,
                    sha256:hash,byteLength:bytes.length,width:info.width,height:info.height,createdBy:identity.uid,createdAt:now()};
                tx.set(quota.path,quota.usage);tx.set(path,record);return {c,path,record};
            });
            const {c,path,record}=reserved;
            try {await bucket.put(keyOf(c,hash),bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:hash,
                httpMetadata:{contentType:'image/webp',cacheControl:'private, no-store'},customMetadata:{sha256:hash}});}
            catch {throw new AuthoringApiError('R2_UNAVAILABLE');}
            await readBytes(c,record);await assertLiveIdentity(identity);
            await db.transaction(async tx=>{
                const latest=await context(tx,identity,true);
                check(latest.ownerUid===c.ownerUid&&latest.projectId===c.projectId&&latest.generationId===c.generationId,'AUTHORING_GENERATION_CONFLICT',409);
                const [stored]=await tx.getMany([path]);valid(stored,c,hash,false);
                tx.set(path,{...stored,status:'ready',verifiedAt:now()});
            });
            return {ref:privateImageRef(hash),sha256:hash,byteLength:bytes.length,width:info.width,height:info.height};
        },
        async get(identity,hash) {
            check(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash),'INVALID_IMAGE_ID',400);
            await assertLiveIdentity(identity);
            const {c,record}=await db.transaction(async tx=>{
                const c=await context(tx,identity),[record]=await tx.getMany([recordPath(c,hash)]);valid(record,c,hash);
                const quota=await charge(tx,c,false);tx.set(quota.path,quota.usage);return {c,record};
            });
            const bytes=await readBytes(c,record);await assertLiveIdentity(identity);
            await db.transaction(async tx=>{
                const latest=await context(tx,identity);
                check(latest.ownerUid===c.ownerUid&&latest.projectId===c.projectId&&latest.generationId===c.generationId,'AUTHORING_GENERATION_CONFLICT',409);
                const [record]=await tx.getMany([recordPath(c,hash)]);valid(record,c,hash);
            });
            return bytes;
        },
        async validateProject(tx,identity,project,write=false) {
            const c=await context(tx,identity,write),hashes=new Set();
            await mapSharedImageSlots(project,ref=>{
                const hash=privateImageHash(ref);check(hash,'PRIVATE_IMAGES_REQUIRED',409);hashes.add(hash);
                check(hashes.size<=1000,'TOO_MANY_IMAGES',422);return ref;
            });
            const ids=[...hashes],records=await tx.getMany(ids.map(hash=>recordPath(c,hash)));
            records.forEach((record,i)=>valid(record,c,ids[i]));
        }
    };
}
