import {createSharedEditLock} from './shared-edit-lock.js';
import {check,segment,readBounded,parseJson,AuthoringApiError} from './private-authoring/common.js';
import {createPrivateAuthoringSnapshot,PRIVATE_AUTHORING_MAX_BYTES,PrivateAuthoringError} from '../js/private-authoring-storage.js';
import {createSharedAssets,SHARED_IMAGE_MAX_BYTES} from './shared-assets.js';
import {createSharedAuthoringService} from './shared-authoring.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
const headers={'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',Vary:'Authorization, Origin'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const routeId=value=>{try{return segment(decodeURIComponent(value));}catch{throw new AuthoringApiError('INVALID_ID',400);}};
// Dependency-injected entry point. No deployed Pages route yet; default disabled.
export function createSharedAuthoringApi({db,privateBucket,publicBucket,verifyToken,assertLiveIdentity,now=Date.now}) {
    check(privateBucket&&privateBucket!==publicBucket,'CONFIG_AUTHORING_BUCKET');
    return async ({request,env={}})=>{
        try {
            check(env.SHARED_AUTHORING_ENABLED==='true','SHARING_NOT_READY',503);
            const url=new URL(request.url),route=/^\/api\/spaces\/([^/]+)\/works\/([^/]+)\/(context|authoring|assets|lock)(?:\/(operations\/[^/]+|[a-f0-9]{64}))?$/.exec(url.pathname);
            check(route,'ROUTE_NOT_FOUND',404);
            const spaceId=routeId(route[1]),workId=routeId(route[2]),kind=route[3],suffix=route[4];
            check(!request.headers.get('Origin')||request.headers.get('Origin')===url.origin,'ORIGIN_FORBIDDEN',403);
            check(request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN_FORBIDDEN',403);
            const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');check(token,'AUTH_REQUIRED',401);
            const identity=await verifyToken(token[1]);check(identity?.uid,'AUTH_INVALID',401);
            const sessionId=request.headers.get('X-Shared-Session'),fence=request.headers.get('X-Shared-Lock');
            const locks=createSharedEditLock({db,assertLiveIdentity,spaceId,workId,now});
            const assertEditLock=(tx,actor)=>locks.assertWrite(tx,actor,sessionId,fence);
            if(kind==='lock') {
                check(!suffix&&request.method==='POST','METHOD_NOT_ALLOWED',405);
                check(/^application\/json(?:;.*)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
                const body=parseJson(await readBounded(request.body,2048));
                check(body&&typeof body==='object'&&!Array.isArray(body),'INVALID_LOCK_ACTION',400);
                return json(await locks.execute(identity,{sessionId,action:body.action,requestId:body.requestId,fence}));
            }
            const assets=createSharedAssets({db,bucket:privateBucket,assertLiveIdentity,spaceId,workId,now,assertEditLock});
            if(kind==='assets'){
                check(suffix?!suffix.startsWith('operations/')&&request.method==='GET':request.method==='POST','METHOD_NOT_ALLOWED',405);
                if(suffix)return new Response(await assets.get(identity,suffix),{headers:{...headers,'Content-Type':'image/webp'}});
                await assets.access(identity,true);
                check(request.headers.get('Content-Type')==='image/webp','CONTENT_TYPE_INVALID',415);
                check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
                return json(await assets.put(identity,await readBounded(request.body,SHARED_IMAGE_MAX_BYTES)));
            }
            const access=await assets.access(identity);
            if(kind==='context'){
                check(!suffix&&request.method==='GET','METHOD_NOT_ALLOWED',405);
                return json({spaceId,workId,projectId:access.projectId,ownerUid:access.ownerUid,...await locks.status(identity,sessionId)});
            }
            const service=createSharedAuthoringService({db,bucket:createAuthoringBucket(privateBucket),assertLiveIdentity,spaceId,workId,now,assets,assertEditLock});
            if(suffix){
                check(suffix.startsWith('operations/')&&request.method==='GET','METHOD_NOT_ALLOWED',405);
                const context=await service.access(identity,access.projectId,{requestId:segment(suffix.slice(11)),generationId:segment(request.headers.get('X-Authoring-Generation'))});
                return json(service.operation(context));
            }
            if(request.method==='GET'){
                const context=await service.access(identity,access.projectId),result=await service.load(identity,access.projectId,context);
                return new Response(result.bytes,{headers:{...headers,'Content-Type':'application/json','X-Authoring-Head':JSON.stringify(result.head).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))}});
            }
            check(request.method==='PUT','METHOD_NOT_ALLOWED',405);
            const generationId=segment(request.headers.get('X-Authoring-Generation')),requestId=segment(request.headers.get('X-Authoring-Request-Id')),base=request.headers.get('X-Authoring-Base-Revision');
            check(typeof base==='string'&&/^(0|[1-9]\d{0,15})$/.test(base)&&Number.isSafeInteger(Number(base)),'INVALID_BASE_REVISION',400);
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
            check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
            await service.access(identity,access.projectId,{write:true,generationId});
            const snapshot=await createPrivateAuthoringSnapshot(parseJson(await readBounded(request.body,PRIVATE_AUTHORING_MAX_BYTES)));
            return json(await service.save(identity,access.projectId,{snapshot,requestId,generationId,baseRevision:Number(base)}));
        }catch(error){
            if(error instanceof AuthoringApiError)return json({error:error.code},error.status);
            if(error instanceof PrivateAuthoringError)return json({error:error.code},422);
            return json({error:'SHARED_AUTHORING_UNAVAILABLE'},503);
        }
    };
}
