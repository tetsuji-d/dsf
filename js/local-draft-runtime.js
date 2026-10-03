import {state,subscribeProjectSession} from './state.js';
import {readSharedStudioAccess} from './shared-studio-access.js';
import {createLocalDraftStatus,installLocalLeaveWarning} from './local-draft-status.js';
let cloudTransitionPending=false;
export function setLocalCloudTransitionPending(value){cloudTransitionPending=!!value;window.dispatchEvent(new Event('local-draft-status'));}
export const isLocalDraft=()=>(cloudTransitionPending||!state.uid||!state.projectId)&&!readSharedStudioAccess();
export const localDraftStatus=createLocalDraftStatus(()=>window.dispatchEvent(new Event('local-draft-status')));
const warning=installLocalLeaveWarning({target:window,tracker:localDraftStatus,isLocal:isLocalDraft});
window.addEventListener('local-draft-status',warning.sync);
subscribeProjectSession(()=>{cloudTransitionPending=false;localDraftStatus.reset();});
export function noteLocalDraftEdit(){if(isLocalDraft())localDraftStatus.dirty();else warning.sync();}
