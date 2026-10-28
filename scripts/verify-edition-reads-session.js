import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the real controller with auth/view boundaries injected, without Firebase IO.
const source = readFileSync(new URL('../js/edition-reads.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const auth = { currentUser: { uid: 'owner' } }, state = { uid: 'owner' };
const listeners = [], mounted = [];
const { openEditionReads, disposeEditionReads } = new Function(
    'onAuthStateChanged', 'auth', 'state', 'getUILang', 'mountEditionReads', 'readOwnedEditions',
    `${source}\nreturn { openEditionReads, disposeEditionReads };`,
)(
    (_auth, listener) => { listeners.push(listener); return () => {}; }, auth, state, () => 'ja',
    (_root, io) => { const view = { io, disposed: false, dispose() { this.disposed = true; } }; mounted.push(view); return view; },
    async ({ isCurrent }) => { assert.equal(isCurrent(), true); return []; },
);
const firstRoot = { textContent: '' };
await openEditionReads(firstRoot);
const first = mounted.at(-1);
assert.equal(first.io.isCurrent(), true);
auth.currentUser = { uid: 'owner' }; listeners.at(-1)(auth.currentUser);
assert.equal(first.io.isCurrent(), true, 'same-account User replacement must not strand a loading view');
assert.deepEqual(await first.io.load(), []);

const oldListener = listeners.at(-1);
const nextRoot = { textContent: '' };
await openEditionReads(nextRoot);
const next = mounted.at(-1);
assert.equal(first.disposed, true);
assert.equal(first.io.isCurrent(), false, 'prior view cannot update after navigation');
oldListener(null);
assert.equal(next.disposed, false, 'queued auth callback from an old view cannot dispose the new view');
assert.equal(nextRoot.textContent, '');
auth.currentUser = null; listeners.at(-1)(null);
assert.equal(next.io.isCurrent(), false);
assert.equal(next.disposed, true);
assert.match(nextRoot.textContent, /アカウント/);
auth.currentUser = { uid: 'owner' }; listeners.at(-1)(auth.currentUser);
assert.equal(next.io.isCurrent(), false, 'signing in again never revives a prior session');
await openEditionReads({ textContent: '' });
const finalView = mounted.at(-1);
assert.equal(finalView.io.isCurrent(), true);
state.uid = 'other';
assert.equal(finalView.io.isCurrent(), false, 'state/auth account mismatch remains blocked');
state.uid = 'owner'; disposeEditionReads();
assert.equal(finalView.io.isCurrent(), false);
console.log('Reads session: same-account refresh, navigation, stale callbacks, sign-out/re-entry and UID mismatch passed.');
