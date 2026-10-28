import { withEditionDeadline } from './edition-load-deadline.js';
/** Short-lived, memory-only inventory. Never share it between auth sessions. */
export function createEditionListCache({ ttlMs = 30_000, timeoutMs = 15_000, now = Date.now } = {}) {
    let session, generation = 0;
    const entries = new Map();
    function invalidate() {
        generation++;
        for (const entry of entries.values()) if (entry.pending) entry.controller.abort(new Error('EDITION_LIST_CHANGED'));
        entries.clear();
    }
    async function read({ ownerSession, key, load, force = false }) {
        if (session !== ownerSession) { invalidate(); session = ownerSession; }
        if (force) invalidate();
        const epoch = generation;
        let entry = entries.get(key);
        if (!entry || (!entry.pending && entry.expires <= now())) {
            entry = { pending: true, expires: 0, controller: new AbortController() };
            entries.set(key, entry);
            const signal = entry.controller.signal;
            entry.promise = withEditionDeadline(Promise.resolve().then(() => {
                if (signal.aborted) throw signal.reason;
                return load(signal);
            }), { timeoutMs, signal }).then(rows => {
                if (epoch !== generation) throw new Error('EDITION_LIST_CHANGED');
                entry.pending = false; entry.expires = now() + ttlMs;
                return rows;
            }).catch(error => {
                entry.controller.abort(error);
                if (entries.get(key) === entry) entries.delete(key);
                throw error;
            });
        }
        const rows = await entry.promise;
        if (epoch !== generation) throw new Error('EDITION_LIST_CHANGED');
        // UI lifecycle edits must never change the inventory another view reads.
        return structuredClone(rows);
    }
    return { read, invalidate };
}
