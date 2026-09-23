import {accountJsonRequest} from './account-json-request.js';
// Only side-effect-free commands may be retried. "read" marks a notice as read.
const reads=new Set(['inbox','listJoinedSpaces','outbox','listMembers','listSpaceWorks','getMemberAccess']);
export function createInvitationsClient({getUser,fetchImpl=fetch,timeoutMs=15000}){
    return command=>accountJsonRequest({getUser,fetcher:fetchImpl,url:'/api/invitations',command,
        readOnly:reads.has(command?.kind),limit:1500000,timeoutMs,
        errors:{auth:'AUTH_REQUIRED',timeout:'INVITATIONS_TIMEOUT',offline:'INVITATIONS_OFFLINE',invalid:'INVITATIONS_RESPONSE_INVALID',unavailable:'INVITATIONS_UNAVAILABLE'}});
}
