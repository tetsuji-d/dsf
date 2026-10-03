// Runtime access belongs to the open session, never to a saved project.
let access = null;
const listeners = new Set();
export const readSharedStudioAccess = () => access ? {...access} : null;
export const canReadSharedStudio = () => !access || access.status === 'ready';
export const canEditSharedStudio = () => !access || (access.status === 'ready' && access.canEdit === true);
export function setSharedStudioAccess(next) {
    if (JSON.stringify(access) === JSON.stringify(next)) return;
    access = next ? Object.freeze({...next}) : null;
    for (const listener of listeners) listener(readSharedStudioAccess());
}
export function subscribeSharedStudioAccess(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function assertSharedStudioEdit() {
    if (!canEditSharedStudio()) throw Object.assign(new Error('Shared manuscript is read only'), {code:'EDIT_FORBIDDEN'});
}
export function assertPersonalStudioOperation() {
    if (access) throw Object.assign(new Error('共有原稿ではこの操作は利用できません。ダッシュボードから個人の原稿を開いてください。'), {code:'SHARED_OPERATION_UNAVAILABLE'});
}
