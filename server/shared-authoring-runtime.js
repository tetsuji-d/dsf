import {handlePersonalSharing} from './personal-sharing-runtime.js';
import {check,segment,parseJson,readBounded,AuthoringApiError} from './private-authoring/common.js';
import {createGoogleClient,createIdTokenVerifier} from './private-authoring/google-auth.js';
import {createFirestoreStore} from './private-authoring/firestore.js';
import {createSharedAuthoringApi} from './shared-authoring-http.js';
import {createSharedWorkRegistration} from './shared-work-registration.js';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',
    'CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Authorization, Origin'}});
const routeId=value=>{try{return segment(decodeURIComponent(value));}catch{throw new AuthoringApiError('INVALID_ID',400);}};
export function readSharedRollout(env) {
    check(env?.SHARED_AUTHORING_ENABLED==='true','SHARING_NOT_READY',503);
    let list;try{list=JSON.parse(env.SHARED_AUTHORING_TEST_SCOPES);}catch{throw new AuthoringApiError('CONFIG_SHARED_SCOPES');}
    check(Array.isArray(list)&&list.length>0&&list.length<=20,'CONFIG_SHARED_SCOPES');
    const ids=new Set();
    for(const item of list){
        check(item&&typeof item==='object'&&!Array.isArray(item),'CONFIG_SHARED_SCOPES');
        for(const key of ['spaceId','workId','ownerUid','projectId']){try{segment(item[key]);}catch{throw new AuthoringApiError('CONFIG_SHARED_SCOPES');}}
        check(Array.isArray(item.actorUids)&&item.actorUids.length>0&&item.actorUids.length<=20
            &&new Set(item.actorUids).size===item.actorUids.length&&item.actorUids.includes(item.ownerUid),'CONFIG_SHARED_SCOPES');
        for(const uid of item.actorUids){try{segment(uid);}catch{throw new AuthoringApiError('CONFIG_SHARED_SCOPES');}}
        check(!ids.has(item.workId),'CONFIG_SHARED_SCOPES');ids.add(item.workId);
    }
    return list;
}
// Dependencies may be injected for tests; Pages always uses real Firebase verification below.
export function createSharedRuntime({db,privateBucket,publicBucket,publicBaseUrl,verifyToken,assertLiveIdentity,now=Date.now}) {
    check(privateBucket&&privateBucket!==publicBucket,'CONFIG_AUTHORING_BUCKET');
    const registration=createSharedWorkRegistration({db,privateBucket,publicBucket,publicBaseUrl,assertLiveIdentity,now});
    return async context=>{
        try{
            const {request,env}=context,rollout=readSharedRollout(env),url=new URL(request.url);
            check(!request.headers.get('Origin')||request.headers.get('Origin')===url.origin,'ORIGIN_FORBIDDEN',403);
            check(request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN_FORBIDDEN',403);
            const route=/^\/api\/spaces\/([^/]+)\/works\/([^/]+)\/(sharing|context|authoring|assets|lock)(?:\/(operations\/[^/]+|[a-f0-9]{64}))?$/.exec(url.pathname);
            check(route,'ROUTE_NOT_FOUND',404);
            const spaceId=routeId(route[1]),workId=routeId(route[2]);
            const scope=rollout.find(s=>s.spaceId===spaceId&&s.workId===workId);check(scope,'SHARED_WORK_NOT_ENABLED',403);
            const bearer=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');check(bearer,'AUTH_REQUIRED',401);
            const identity=await verifyToken(bearer[1]);check(identity?.uid,'AUTH_INVALID',401);
            check(scope.actorUids.includes(identity.uid),'SHARED_ACTOR_NOT_ENABLED',403);
            if(route[3]==='sharing'){
                check(!route[4]&&['GET','POST'].includes(request.method),'METHOD_NOT_ALLOWED',405);
                if(request.method==='GET')return reply(await registration.prepare(identity,scope));
                check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
                check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
                const body=parseJson(await readBounded(request.body,2048));
                check(body?.kind==='register'&&typeof body.confirmationToken==='string'&&/^[a-f0-9]{64}$/.test(body.confirmationToken),'INVALID_COMMAND',400);
                return reply(await registration.register(identity,scope,body));
            }
            // Pin every canonical access to the exact configured storage scope, not merely a space/work URL.
            const guardedDb={transaction:callback=>db.transaction(async tx=>{
                const [binding]=await tx.getMany(['publishing_work_scopes/'+workId]);
                check(binding?.spaceId===spaceId&&binding.workId===workId&&binding.ownerUid===scope.ownerUid
                    &&binding.projectId===scope.projectId,'SHARED_SCOPE_CONFLICT',409);
                return callback(tx);
            })};
            const handler=createSharedAuthoringApi({db:guardedDb,privateBucket,publicBucket,
                verifyToken:async()=>identity,assertLiveIdentity,now});
            return await handler(context);
        }catch(error){return reply({error:error instanceof AuthoringApiError?error.code:'SHARED_AUTHORING_UNAVAILABLE'},error instanceof AuthoringApiError?error.status:503);}
    };
}
export const createSharedRuntimeStore=google=>createFirestoreStore(google,{additionalRootCollections:['publishing_spaces','publishing_labels','publishing_work_scopes','publishing_space_catalogues']});
const runtimes=new WeakMap();
export async function handleSharedAuthoring(context){
    if(new URL(context.request.url).pathname.startsWith('/api/spaces/personal/works/'))return handlePersonalSharing(context);
    try{
        readSharedRollout(context.env); // Disabled or malformed configuration performs no Auth/Firestore/R2 I/O.
        check(context.env.AUTHORING_BUCKET&&context.env.AUTHORING_BUCKET!==context.env.R2_BUCKET,'CONFIG_AUTHORING_BUCKET');
        let handler=runtimes.get(context.env);
        if(!handler){
            const google=createGoogleClient({projectId:context.env.FIREBASE_PROJECT_ID,serviceAccountJson:context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT});
            handler=createSharedRuntime({db:createSharedRuntimeStore(google),
                privateBucket:context.env.AUTHORING_BUCKET,publicBucket:context.env.R2_BUCKET,publicBaseUrl:context.env.R2_PUBLIC_URL,
                verifyToken:createIdTokenVerifier({projectId:context.env.FIREBASE_PROJECT_ID}),assertLiveIdentity:google.assertLiveIdentity});
            runtimes.set(context.env,handler);
        }
        return await handler(context);
    }catch(error){return reply({error:error instanceof AuthoringApiError?error.code:'SHARED_AUTHORING_UNAVAILABLE'},error instanceof AuthoringApiError?error.status:503);}
}
