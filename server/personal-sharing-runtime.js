import {check,segment,parseJson,readBounded,AuthoringApiError} from './private-authoring/common.js';
import {createGoogleClient,createIdTokenVerifier} from './private-authoring/google-auth.js';
import {createFirestoreStore} from './private-authoring/firestore.js';
import {createAuthoringService,readContext} from './private-authoring/service.js';
import {createAuthoringBucket} from './private-authoring/r2.js';
import {createSharedAssets} from './shared-assets.js';
import {createPersonalSharingService,resolvePersonalWorkAccess,PERSONAL_SHARING_ROOTS} from './personal-sharing.js';
const headers={'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Authorization, Origin'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
export function createPersonalSharingRuntime({db,privateBucket,publicBucket,verifyToken,assertLiveIdentity,now=Date.now}){
    check(privateBucket&&privateBucket!==publicBucket,'CONFIG_AUTHORING_BUCKET');
    function reader(workId,resolver){
        const resolve=resolver||((tx,actor,action)=>resolvePersonalWorkAccess(tx,{actorUid:actor.uid,workId,action,now:now()}));
        const assets=createSharedAssets({db,bucket:privateBucket,assertLiveIdentity,spaceId:'personal',workId,now,resolveAccess:resolve});
        const service=createAuthoringService({db,bucket:createAuthoringBucket(privateBucket),assertLiveIdentity,now,
            resolveAccess:async(tx,actor,projectId,action)=>{const a=await resolve(tx,actor,action);check(a.projectId===projectId,'WORK_FORBIDDEN',403);return a;},
            validateSnapshot:(tx,actor,project)=>assets.validateProject(tx,actor,project)});
        return {assets,service};
    }
    const personal=createPersonalSharingService({db,assertLiveIdentity,now,validateSource:async(actor,scope)=>{
        const resolver=async(tx,id,action)=>{
            check(id.uid===scope.ownerUid&&action==='readWork','WORK_FORBIDDEN',403);
            const [catalogue,binding]=await tx.getMany(['users/'+id.uid+'/publishing/catalogue','publishing_work_scopes/'+scope.workId]);
            check(!catalogue?.assignments?.[scope.projectId]&&!binding,'PERSONAL_WORK_REQUIRED',409);
            const c=await readContext(tx,id,scope.projectId);check(c.scope.generationId===scope.generationId,'SHARE_SOURCE_CHANGED',409);return scope;
        };
        const {service}=reader(scope.workId,resolver),c=await service.access(actor,scope.projectId);
        await service.load(actor,scope.projectId,c);
    }});
    return async({request,env={}})=>{
        try{
            check(env.PERSONAL_SHARING_ENABLED==='true','PERSONAL_SHARING_DISABLED',503);
            const url=new URL(request.url);
            check(!request.headers.get('Origin')||request.headers.get('Origin')===url.origin,'ORIGIN_FORBIDDEN',403);
            check(request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN_FORBIDDEN',403);
            const bearer=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');check(bearer,'AUTH_REQUIRED',401);
            const actor=await verifyToken(bearer[1]);check(actor?.uid,'AUTH_INVALID',401);await assertLiveIdentity(actor);
            // Explicit staged rollout: neither flag nor an empty actor list enables public access.
            let actors;try{actors=JSON.parse(env.PERSONAL_SHARING_ACTOR_UIDS);}catch{};
            check(Array.isArray(actors)&&actors.length>0&&actors.length<=20&&actors.every(x=>typeof x==='string'),'CONFIG_PERSONAL_SHARING');
            check(actors.includes(actor.uid),'PERSONAL_SHARING_NOT_ENABLED',403);
            if(url.pathname==='/api/personal-sharing'){
                check(request.method==='POST','METHOD_NOT_ALLOWED',405);
                check(/^application\/json(?:;.*)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
                check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
                const cmd=parseJson(await readBounded(request.body,8192));
                if(cmd?.kind==='invite')check(actors.includes(cmd.recipientUid),'PERSONAL_SHARING_NOT_ENABLED',403);
                return reply(await personal.execute(actor,cmd));
            }
            const m=/^\/api\/spaces\/personal\/works\/([^/]+)\/(context|authoring|assets)(?:\/([a-f0-9]{64}))?$/.exec(url.pathname);
            check(m,'ROUTE_NOT_FOUND',404);check(request.method==='GET','READ_ONLY',403);
            const workId=segment(decodeURIComponent(m[1])),kind=m[2],hash=m[3];
            check(kind==='assets'?!!hash:!hash,'ROUTE_NOT_FOUND',404);
            const {assets,service}=reader(workId),access=await assets.access(actor);
            if(kind==='context')return reply({...access,spaceId:'personal',workId,canEdit:false,permissionCanEdit:false,
                lock:{isMine:false,holderName:null,expiresAt:null,lastEditAt:null,canTakeover:false,requestPending:false}});
            if(kind==='assets')return new Response(await assets.get(actor,hash),{headers:{...headers,'Content-Type':'image/webp'}});
            const c=await service.access(actor,access.projectId),result=await service.load(actor,access.projectId,c);
            return new Response(result.bytes,{headers:{...headers,'Content-Type':'application/json','X-Authoring-Head':JSON.stringify(result.head).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))}});
        }catch(e){return reply({error:e instanceof AuthoringApiError?e.code:'PERSONAL_SHARING_UNAVAILABLE'},e instanceof AuthoringApiError?e.status:503);}
    };
}
const runtimes=new WeakMap();
export async function handlePersonalSharing(context){
    if(context.env.PERSONAL_SHARING_ENABLED!=='true')return reply({error:'PERSONAL_SHARING_DISABLED'},503);
    try{
        let handler=runtimes.get(context.env);
        if(!handler){const google=createGoogleClient({projectId:context.env.FIREBASE_PROJECT_ID,serviceAccountJson:context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT});
            handler=createPersonalSharingRuntime({db:createFirestoreStore(google,{additionalRootCollections:PERSONAL_SHARING_ROOTS}),
                privateBucket:context.env.AUTHORING_BUCKET,publicBucket:context.env.R2_BUCKET,
                verifyToken:createIdTokenVerifier({projectId:context.env.FIREBASE_PROJECT_ID}),assertLiveIdentity:google.assertLiveIdentity});runtimes.set(context.env,handler);}
        return await handler(context);
    }catch{return reply({error:'PERSONAL_SHARING_UNAVAILABLE'},503);}
}
