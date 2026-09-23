import {check,readBounded} from './private-authoring/common.js';
import {readContext,usageValue,AUTHORING_LIMITS,AUTHORING_LEASE_MS} from './private-authoring/service.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
import {createPrivateAuthoringSnapshot,createPrivateAuthoringDescriptor,planPrivateAuthoringCommit} from '../js/private-authoring-storage.js';
import {mapSharedImageSlots,privateImageRef} from '../js/shared-authoring-assets.js';
import {sha256DsfBytes} from '../js/dsf-release-byte-sealing.js';
import {managedImageKey} from './shared-image-preflight.js';
import {isPrivateAuthoringId} from '../js/private-authoring-ids.js';

// Copy immutable objects first; the source head and sharing boundary change in one transaction.
export async function migrateSharedImages({db,privateBucket,publicBucket,publicBaseUrl,identity,scope,
    project,images,command,inspectCurrent,assertCurrent,assertLiveIdentity,writeBinding,now=Date.now}) {
    check(command.copyImages===true&&images.copyable,'IMAGE_MIGRATION_REQUIRED',409);
    check(command.imagePlanHash===images.imagePlanHash,'IMAGE_PLAN_CHANGED',409);
    check(isPrivateAuthoringId(command.requestId),'INVALID_REQUEST_ID',400);
    const refs=new Map();
    await mapSharedImageSlots(project,value=>{if(!refs.has(value))refs.set(value,images.entries[refs.size]);return value;});
    const migrated=await mapSharedImageSlots(project,value=>privateImageRef(refs.get(value).sha256));
    const snapshot=await createPrivateAuthoringSnapshot(migrated),unique=[...new Map(images.entries.map(e=>[e.sha256,e])).values()];
    const reservation=await db.transaction(async tx=>{
        await inspectCurrent(tx);
        const c=await readContext(tx,identity,scope.projectId,command.requestId),time=now();
        const descriptor=createPrivateAuthoringDescriptor(snapshot,c.scope,command.requestId);
        const recordPaths=unique.map(e=>`${c.p.root}/privateImageGenerations/${c.scope.generationId}/images/${e.sha256}`);
        const usagePath=`users/${identity.uid}/privateImageUsage/current`;
        const [stored,...records]=await tx.getMany([usagePath,...recordPaths]);
        if(c.operation){
            check(c.operation.state==='pending'&&c.operation.baseRevision===c.head.revision
                &&c.operation.descriptor.sha256===descriptor.sha256
                &&JSON.stringify(c.operation.sharedRegistration)===JSON.stringify({spaceId:scope.spaceId,workId:scope.workId,confirmationToken:command.confirmationToken,imagePlanHash:command.imagePlanHash}),
            'AUTHORING_REQUEST_REUSED',409);
            check(time<c.operation.leaseExpiresAtMs,'AUTHORING_LEASE_EXPIRED',409);
        }
        const minute=Math.floor(time/60000),day=Math.floor(time/86400000);
        const imageUsage={minute,requests:stored?.minute===minute?stored.requests:0,writes:stored?.minute===minute?stored.writes:0,
            day,uploadedBytes:stored?.day===day?stored.uploadedBytes:0,reservedBytes:stored?.reservedBytes??0,imageCount:stored?.imageCount??0};
        check(Object.values(imageUsage).every(n=>Number.isSafeInteger(n)&&n>=0),'INVALID_USAGE_RECORD');
        check(++imageUsage.requests<=120&&++imageUsage.writes<=30,'RATE_LIMITED',429);
        unique.forEach((e,i)=>{
            const old=records[i];
            if(old)check(['pending','ready'].includes(old.status)&&old.ownerUid===identity.uid&&old.projectId===scope.projectId
                &&old.generationId===c.scope.generationId&&old.sha256===e.sha256&&old.byteLength===e.byteLength,'PRIVATE_IMAGE_CORRUPT',409);
            else{imageUsage.reservedBytes+=e.byteLength;imageUsage.imageCount++;}
            imageUsage.uploadedBytes+=e.byteLength;
        });
        check(imageUsage.uploadedBytes<=256*1024*1024&&imageUsage.reservedBytes<=1024*1024*1024&&imageUsage.imageCount<=10000,'IMAGE_QUOTA_EXCEEDED',429);
        const usage=usageValue(c.usage,time);
        check(++usage.requestCount<=AUTHORING_LIMITS.requestsPerMinute&&++usage.writeCount<=AUTHORING_LIMITS.writesPerMinute,'RATE_LIMITED',429);
        usage.uploadedBytes+=snapshot.byteLength;
        if(!c.operation){usage.reservedBytes+=snapshot.byteLength;usage.operationCount++;}
        check(usage.uploadedBytes<=AUTHORING_LIMITS.uploadBytesPerDay&&usage.reservedBytes<=AUTHORING_LIMITS.reservedBytes&&usage.operationCount<=AUTHORING_LIMITS.operations,'AUTHORING_QUOTA_EXCEEDED',429);
        const operation=c.operation||{storageVersion:1,state:'pending',generationId:c.scope.generationId,baseRevision:c.head.revision,
            descriptor,createdAtMs:time,leaseExpiresAtMs:time+AUTHORING_LEASE_MS,actorUid:identity.uid,
            sharedRegistration:{spaceId:scope.spaceId,workId:scope.workId,confirmationToken:command.confirmationToken,imagePlanHash:command.imagePlanHash}};
        const saved=unique.map((e,i)=>records[i]||{schemaVersion:1,status:'pending',ownerUid:identity.uid,projectId:scope.projectId,generationId:c.scope.generationId,
            sha256:e.sha256,byteLength:e.byteLength,width:e.width,height:e.height,createdBy:identity.uid,createdAt:time});
        tx.set(usagePath,imageUsage);tx.set(c.p.usage,usage);tx.set(c.p.operation,operation);
        saved.forEach((r,i)=>tx.set(recordPaths[i],r));
        return {c,descriptor,recordPaths,saved};
    });
    const {c,descriptor,recordPaths,saved}=reservation;
    const copied=new Set();
    for(const [ref,e]of refs){
        if(copied.has(e.sha256))continue;
        await assertCurrent();
        const key=managedImageKey(ref,identity.uid,publicBaseUrl);
        check(key,'UNSUPPORTED_IMAGE_REFERENCE',409);
        const source=await publicBucket.get(key);let bytes;
        try{
            check(source?.size===e.byteLength&&source.httpMetadata?.contentType==='image/webp','IMAGE_PLAN_CHANGED',409);
            bytes=await readBounded(source.body,e.byteLength);
            check(bytes.length===e.byteLength&&await sha256DsfBytes(bytes)===e.sha256,'IMAGE_PLAN_CHANGED',409);
        }finally{await source?.body?.cancel().catch(()=>{});}
        await assertCurrent();
        const target=`authoring-images/${identity.uid}/${scope.projectId}/${c.scope.generationId}/${e.sha256}.webp`;
        await privateBucket.put(target,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:e.sha256,
            httpMetadata:{contentType:'image/webp',cacheControl:'private, no-store'},customMetadata:{sha256:e.sha256}});
        const copy=await privateBucket.get(target);
        try{
            check(copy?.size===e.byteLength&&copy.httpMetadata?.contentType==='image/webp'&&copy.customMetadata?.sha256===e.sha256,'PRIVATE_IMAGE_CORRUPT',502);
            const verified=await readBounded(copy.body,e.byteLength);
            check(verified.length===e.byteLength&&await sha256DsfBytes(verified)===e.sha256,'PRIVATE_IMAGE_CORRUPT',502);
        }finally{await copy?.body?.cancel().catch(()=>{});}
        copied.add(e.sha256);
    }
    await assertCurrent();
    await createAuthoringBucket(privateBucket).put(snapshot,descriptor,c.scope);
    await assertLiveIdentity(identity);
    return db.transaction(async tx=>{
        const current=await inspectCurrent(tx);
        const latest=await readContext(tx,identity,scope.projectId,command.requestId,c.scope.generationId),time=now();
        const records=await tx.getMany(recordPaths);
        check(latest.operation?.state==='pending'&&latest.operation.descriptor.sha256===descriptor.sha256,'AUTHORING_REQUEST_REUSED',409);
        check(time<latest.operation.leaseExpiresAtMs,'AUTHORING_LEASE_EXPIRED',409);
        records.forEach((r,i)=>check(r&&r.sha256===saved[i].sha256&&r.generationId===c.scope.generationId&&r.byteLength===saved[i].byteLength,'PRIVATE_IMAGE_CORRUPT',409));
        const plan=planPrivateAuthoringCommit({scope:c.scope,projectStatus:'active',baseRevision:c.head.revision,candidate:descriptor,currentHead:latest.head});
        check(plan.action==='commit','SHARED_PREPARATION_CHANGED',409);
        tx.set(latest.p.head,plan.head);
        tx.set(latest.p.control,{...latest.control,previousHead:latest.head});
        tx.set(latest.p.operation,{...latest.operation,state:'committed',result:'commit',committedHead:plan.head,completedAtMs:time});
        records.forEach((r,i)=>tx.set(recordPaths[i],{...r,status:'ready',verifiedAt:time}));
        writeBinding(tx,current);
        return {registered:true,changed:true,imagesCopied:unique.length};
    });
}
