/** Runtime-only evidence of persistence. Never serialized into a project. */
export const unknownSaveStatus = () => ({ state: 'unknown', backend: 'unknown', localCurrent: false, cloudCurrent: false, errorCode: null });
export function createEditorSaveStatus(readIdentity) {
    let identity, revision = 0, localRevision = -1, cloudRevision = -1, phase = 'unknown', backend = 'unknown', errorCode = null;
    function sync() {
        const current = readIdentity();
        if (identity !== current) {
            identity = current; revision = 0; localRevision = cloudRevision = -1;
            phase = 'unknown'; backend = 'unknown'; errorCode = null;
        }
    }
    function dirty() { sync(); revision++; phase = 'pending'; errorCode = null; }
    function begin(cloudExpected) {
        sync(); phase = 'saving'; errorCode = null;
        if (!cloudExpected) backend = 'local';
        const session = identity, savedRevision = revision;
        const current = () => { sync(); return identity === session; };
        return {
            backend(value) { if (current() && ['r2-private', 'firestore'].includes(value)) backend = value; },
            localSaved() { if (current()) { localRevision = savedRevision; if (!cloudExpected) phase = revision === savedRevision ? 'saved-local' : 'pending'; } },
            cloudSaved() { if (current()) { cloudRevision = savedRevision; phase = revision === savedRevision ? 'saved-cloud' : 'pending'; errorCode = null; } },
            failed(stage, error) {
                if (!current()) return;
                phase = 'error';
                // Only public, actionable codes. Never return raw messages, URLs or account data.
                const code = error?.code;
                errorCode = ['AUTHORING_CONFLICT', 'AUTHORING_REVISION_CONFLICT', 'AUTHORING_STALE', 'AUTHORING_RELOAD_REQUIRED', 'AUTHORING_SESSION_CHANGED', 'AUTHORING_ASSET_UNRESOLVED', 'AUTHORING_UNAVAILABLE'].includes(code)
                    ? code : stage === 'local' ? 'LOCAL_SAVE_FAILED' : 'SAVE_FAILED';
            },
        };
    }
    function read() {
        sync();
        return { state: phase, backend, localCurrent: localRevision === revision, cloudCurrent: cloudRevision === revision, errorCode };
    }
    return { dirty, begin, read };
}
