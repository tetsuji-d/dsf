import { auth, firebaseConfig } from './firebase-core.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { loadEditionList, filterEditionList } from './edition-list.js';
import { createEditionListCache } from './edition-list-cache.js';
import { withEditionDeadline } from './edition-load-deadline.js';
import { createEditionListReader } from './edition-list-reader.js';

const inventory = createEditionListCache({ timeoutMs: 30_000 });
let lastUser = auth.currentUser;
onAuthStateChanged(auth, user => {
    if (user !== lastUser) inventory.invalidate();
    lastUser = user;
});
// Only an invalidation notice crosses tabs; edition data stays in this session.
const changes = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dsf-edition-list') : null;
if (changes) changes.onmessage = () => inventory.invalidate();
export function invalidateOwnedEditions() {
    inventory.invalidate();
    changes?.postMessage('changed');
}

export async function readOwnedEditions({ uid, locale, scope, isCurrent = () => true, force = false }) {
    const user = auth.currentUser;
    const sameAccount = () => !!user && user.uid === uid && auth.currentUser === user;
    const assertCurrent = () => { if (!sameAccount() || !isCurrent()) throw new Error('EDITION_SESSION_CHANGED'); };
    assertCurrent();
    // The shared producer belongs to the auth session, not the first Home render.
    const load = signal => loadEditionList({ uid, locale, origin: location.origin, isCurrent: () => sameAccount() && !signal.aborted,
        ...createEditionListReader({ projectId: firebaseConfig.projectId, uid, signal, isCurrent: sameAccount, getToken: () => user.getIdToken() }),
    });
    const read = refresh => inventory.read({ ownerSession: user, key: locale || 'ja', load, force: refresh });
    const pending = read(force).catch(error => {
        assertCurrent();
        if (error.message !== 'EDITION_LIST_CHANGED') throw error;
        return read(false);
    });
    const [rows] = await Promise.all([pending,
        scope && scope.viewKind() !== 'all' && !scope.catalogueReady() ? withEditionDeadline(scope.load()) : null]);
    assertCurrent();
    // Scope is evaluated for each consumer, never cached with the owner inventory.
    return filterEditionList(rows, scope);
}
