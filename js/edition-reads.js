import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { auth } from './firebase-core.js';
import { state } from './state.js';
import { getUILang } from './i18n-studio.js';
import { editionFolder } from './edition-policy.js';
import { editionShareUrl } from './edition-list-presentation.js';
import { confirmEditionAction } from './edition-dialog.js';
import { buildOwnerDraftViewerUrl } from './viewer-owner-preview.js';
import { mountEditionReads } from './edition-reads-view.js';
import { readOwnedEditions, invalidateOwnedEditions } from './edition-list-client.js';

let view = null, stopAuth = () => {}, viewEpoch = 0;
export function disposeEditionReads() { viewEpoch++; stopAuth(); stopAuth = () => {}; view?.dispose(); view = null; }
export async function openEditionReads(root, scope = null, selection = {}) {
    disposeEditionReads();
    const user = auth.currentUser, uid = state.uid;
    if (!user || user.uid !== uid) { root.textContent = getUILang() === 'en' ? 'Sign in to view Reads.' : 'リーズを表示するにはログインしてください。'; return; }
    const epoch = viewEpoch;
    let sessionValid = true;
    // Firebase may replace the User object for the same signed-in account.
    // Keep the view live across that refresh, but never across sign-out or a new view.
    const current = () => sessionValid && viewEpoch === epoch && state.uid === uid && auth.currentUser?.uid === uid;
    const assertCurrent = () => { if (!current()) throw new Error('EDITION_SESSION_CHANGED'); };
    stopAuth = onAuthStateChanged(auth, next => {
        if (viewEpoch !== epoch) return;
        if (next?.uid !== uid) { sessionValid = false; view?.dispose(); root.textContent = getUILang() === 'en' ? 'Account changed. Reopen Reads.' : 'アカウントが変わりました。リーズを開き直してください。'; }
    });
    view = mountEditionReads(root, {
        locale: getUILang, isCurrent: current, initialFolder: selection.folder || 'private', initialEditionId: selection.editionId,
        load: ({ force = false } = {}) => readOwnedEditions({ uid, locale: getUILang(), scope, isCurrent: current, force }),
        async execute(row, action, extra) {
            assertCurrent(); const token = await auth.currentUser.getIdToken(); assertCurrent();
            try {
            const response = await fetch('/api/editions', { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: row.workId, releaseId: row.releaseId, action, baseRevision: row.state.revision,
                    requestId: crypto.randomUUID(), ...(['successor','label','embed'].includes(action) ? extra : {}) }) });
            assertCurrent(); const result = await response.json(); assertCurrent();
            if (!response.ok) throw Object.assign(new Error(result.error || 'EDITION_UNAVAILABLE'), { code: result.error });
            return result;
            } finally {
                // An interrupted response can still have committed on the server.
                invalidateOwnedEditions();
            }
        },
        confirm: message => confirmEditionAction(message, getUILang()), copy: url => navigator.clipboard.writeText(url),
        preview: row => window.open(['public', 'unlisted'].includes(editionFolder(row.state))
            ? editionShareUrl(row)
            : buildOwnerDraftViewerUrl(location.origin, row.projectId, row.releaseId), '_blank', 'noopener,noreferrer'),
    });
}
