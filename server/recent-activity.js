import {check,segment,AuthoringApiError,parseJson,readBounded} from './private-authoring/common.js';
import {createGoogleClient,createIdTokenVerifier} from './private-authoring/google-auth.js';
import {createOwnerAuthoringStore,readOwnerSharedScope} from './private-authoring/shared-boundary.js';
import {resolveSpaceWorkAccess} from './publishing-space-directory.js';
import {readInvitationRollout,createInvitationRolloutGuard} from './publishing-invitations-rollout.js';
const key=x=>JSON.stringify([x.ownerUid,x.projectId]);
const projectEntry=x=>({ownerUid:x.ownerUid,projectId:x.projectId,workId:x.workId||null,spaceId:x.spaceId||null,at:x.at});
export function createRecentActivityService({db,assertLiveIdentity,authorizeShared=async()=>{check(false,'SHARED_UNAVAILABLE',403);},now=Date.now}){
 return {async execute(identity,c){
  const uid=segment(identity?.uid);check(['list','opened'].includes(c?.kind),'INVALID_COMMAND',400);
  if(c.kind==='opened'){if(c.spaceId||c.workId){segment(c.spaceId);segment(c.workId);await authorizeShared(identity,c);}else segment(c.projectId);}
  await assertLiveIdentity(identity);
  return db.transaction(async tx=>{
   const path=`users/${uid}/studioActivity/recent`,[account,stored]=await tx.getMany(['users/'+uid,path]);
   check(account?.uid===uid&&account.status?.disabled===false,'ACCOUNT_UNAVAILABLE',403);
   check(!stored||(stored.schemaVersion===1&&Array.isArray(stored.entries)&&stored.entries.length<=100),'ACTIVITY_INVALID',503);
   const entries=(stored?.entries||[]).map(projectEntry);
   if(c.kind==='list')return {uid,entries}; // IDs only; the UI intersects these with fresh authorized directories.
   let target;
   if(c.spaceId){const scope=await resolveSpaceWorkAccess(tx,{actorUid:uid,spaceId:c.spaceId,workId:c.workId,action:'readWork'});target={ownerUid:scope.ownerUid,projectId:scope.projectId,workId:scope.workId,spaceId:scope.spaceId};}
   else{
    const [root,catalogue]=await tx.getMany([`users/${uid}/projects/${c.projectId}`,`users/${uid}/publishing/catalogue`]);
    check(root&&(!root.ownerUid||root.ownerUid===uid)&&!root.projectTrash,'PROJECT_UNAVAILABLE',403);
    const shared=await readOwnerSharedScope(tx,uid,c.projectId,root);
    target={ownerUid:uid,projectId:c.projectId,workId:root.workId||null,spaceId:shared?.spaceId||catalogue?.assignments?.[c.projectId]||null};
   }
   const t=now(),same=entries.find(e=>key(e)===key(target));
   if(same&&t-same.at<60000)return {recorded:true,at:same.at};
   const next=[{...target,at:t},...entries.filter(e=>key(e)!==key(target))].slice(0,100);
   tx.set(path,{schemaVersion:1,entries:next});return {recorded:true,at:t};
  });
 }};
}
const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store',Vary:'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export function createRecentActivityApi({verifyToken,service}){return async({request})=>{
 try{check(request.method==='POST','METHOD_NOT_ALLOWED',405);const origin=request.headers.get('Origin');check((!origin||origin===new URL(request.url).origin)&&request.headers.get('Sec-Fetch-Site')!=='cross-site','ORIGIN_FORBIDDEN',403);
  const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');check(token,'AUTH_REQUIRED',401);
  const identity=await verifyToken(token[1]);check(identity?.uid,'AUTH_INVALID',401);
  check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')||''),'CONTENT_TYPE_INVALID',415);
  check(!request.headers.has('Content-Encoding')||request.headers.get('Content-Encoding')==='identity','CONTENT_ENCODING_INVALID',415);
  return response(await service.execute(identity,parseJson(await readBounded(request.body,4096))));
 }catch(e){return response({error:e instanceof AuthoringApiError?e.code:'ACTIVITY_UNAVAILABLE'},e instanceof AuthoringApiError?e.status:503);}
};}
const runtimes=new WeakMap();
export async function handleRecentActivity(context){
 if(context.env.PUBLISHING_SPACES_ENABLED!=='true')return response({error:'ACTIVITY_UNAVAILABLE'},503);
 try{let handler=runtimes.get(context.env);if(!handler){
  const google=createGoogleClient({projectId:context.env.FIREBASE_PROJECT_ID,serviceAccountJson:context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT}),db=createOwnerAuthoringStore(google);
  handler=createRecentActivityApi({verifyToken:createIdTokenVerifier({projectId:context.env.FIREBASE_PROJECT_ID}),service:createRecentActivityService({db,assertLiveIdentity:google.assertLiveIdentity,
   authorizeShared:async(identity,c)=>{check(context.env.PUBLISHING_INVITATIONS_ENABLED==='true'&&context.env.SHARED_AUTHORING_ENABLED==='true','SHARED_UNAVAILABLE',403);const scope=readInvitationRollout(context.env);await createInvitationRolloutGuard({db,scope})(identity,{kind:'listSpaceWorks',spaceId:c.spaceId});}})});runtimes.set(context.env,handler);
 }return handler(context);}catch{return response({error:'ACTIVITY_UNAVAILABLE'},503);}
}
