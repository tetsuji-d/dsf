// Browser-local consent preference only. No manuscript or operation tokens are persisted.
export const AI_PREFERENCE_KEY = 'dsf_studio_ai_access_v1';
const defaults = () => ({ enabled: false, access: 'read' });
export function createStudioAIPreferences({ connection, readState, storage, onChange = () => {} }) {
    let preference = defaults(), target = null, suspended = false, stored = Boolean(storage);
    function load() {
        try {
            const saved = JSON.parse(storage?.getItem(AI_PREFERENCE_KEY) || 'null');
            stored = Boolean(storage);
            preference = saved && typeof saved.enabled === 'boolean' && ['read', 'edit'].includes(saved.access)
                ? { enabled: saved.enabled, access: saved.access } : defaults();
        } catch { preference = defaults(); stored = false; }
    }
    load();
    function pause() { target = null; connection.disable(); }
    function refresh() {
        const state = readState();
        if (suspended || !preference.enabled || state.room !== 'editor' || state.workIdentity == null) {
            if (target || !['off', 'unsupported'].includes(connection.getStatus())) pause();
            onChange(); return Promise.resolve();
        }
        if (target?.identity === state.workIdentity && target.access === preference.access) { onChange(); return Promise.resolve(); }
        target = { identity: state.workIdentity, access: preference.access };
        return connection.enable(preference.access === 'edit');
    }
    function set(next) {
        preference = { enabled: next.enabled === true, access: next.access === 'edit' ? 'edit' : 'read' };
        try { if (!storage) throw Error('Storage unavailable'); storage.setItem(AI_PREFERENCE_KEY, JSON.stringify(preference)); stored = true; }
        catch { stored = false; }
        pause(); return refresh();
    }
    return { get: () => ({ ...preference, stored }), set, refresh, pause,
        retry: () => { pause(); return refresh(); },
        reload: () => { load(); pause(); return refresh(); },
        suspend: () => { suspended = true; pause(); },
        resume: () => { suspended = false; return refresh(); } };
}
