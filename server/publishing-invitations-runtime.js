import {readInvitationRollout,createInvitationRolloutGuard} from './publishing-invitations-rollout.js';
import {createPublishingInvitationsApi,createPublishingInvitationsService,INVITATION_ROOTS} from './publishing-invitations.js';
import {createSpaceDirectoryService,validateSpaceInvitationTargets,SPACE_DIRECTORY_ROOTS} from './publishing-space-directory.js';
import {createFirestoreStore} from './private-authoring/firestore.js';
import {createGoogleClient,createIdTokenVerifier} from './private-authoring/google-auth.js';
import {check,segment} from './private-authoring/common.js';
export function createInvitationStore(google){
    const db=createFirestoreStore(google,{additionalRootCollections:[...new Set([...INVITATION_ROOTS,...SPACE_DIRECTORY_ROOTS])]});
    db.listMemberPaths=async(spaceId,afterUid)=>{
        segment(spaceId);if(afterUid!==null)segment(afterUid);
        const prefix=`projects/${google.projectId}/databases/(default)/documents/`;
        const result=await google.post('https://firestore.googleapis.com/v1/'+prefix.slice(0,-1)+':runQuery',{
            structuredQuery:{from:[{collectionId:'spaceMemberships',allDescendants:true}],
                where:{fieldFilter:{field:{fieldPath:'spaceId'},op:'EQUAL',value:{stringValue:spaceId}}},
                orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:21,
                ...(afterUid?{startAt:{values:[{referenceValue:prefix+`users/${afterUid}/spaceMemberships/${spaceId}`}],before:false}}:{})}});
        check(Array.isArray(result),'MEMBERS_UNAVAILABLE',503);
        return result.filter(r=>r.document).map(r=>{check(r.document.name.startsWith(prefix),'MEMBERS_UNAVAILABLE',503);return r.document.name.slice(prefix.length);});
    };
    return db;
}
const runtimes=new WeakMap();
export async function handlePublishingInvitations(context){
    const disabled=()=>Response.json({error:'INVITATIONS_DISABLED'},{status:503,headers:{'Cache-Control':'private, no-store'}});
    if(context.env.PUBLISHING_INVITATIONS_ENABLED!=='true')return disabled();
    try{
        const scope=readInvitationRollout(context.env);
        let handler=runtimes.get(context.env);
        if(!handler){
            const google=createGoogleClient({projectId:context.env.FIREBASE_PROJECT_ID,serviceAccountJson:context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT});
            const db=createInvitationStore(google),assertLiveIdentity=google.assertLiveIdentity;
            handler=createPublishingInvitationsApi({verifyToken:createIdTokenVerifier({projectId:context.env.FIREBASE_PROJECT_ID}),
                authorizeCommand:createInvitationRolloutGuard({db,scope}),
                directory:createSpaceDirectoryService({db,assertLiveIdentity}),
                service:createPublishingInvitationsService({db,assertLiveIdentity,validateScopeTargets:validateSpaceInvitationTargets,
                    allowActivation:context.env.PUBLISHING_INVITATIONS_ACTIVATION==='true'&&context.env.SHARED_AUTHORING_ENABLED==='true'})});
            runtimes.set(context.env,handler);
        }
        return handler(context);
    }catch{return Response.json({error:'INVITATIONS_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
