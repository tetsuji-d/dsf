import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { auth, db } from './firebase-core.js';
import { usesPrivateAuthoring, assertPrivateAuthoringRoot, AuthoringClientError } from './private-authoring-client.js';
import { assertPrivateAuthoringHead } from './private-authoring-storage.js';
const pending = new Map();
const fail = code => { throw new AuthoringClientError(code); };
function current(context) { if (auth.currentUser !== context.user || auth.currentUser?.uid !== context.uid) fail('AUTHORING_SESSION_CHANGED'); }
async function request(context, options = {}) {
    current(context); const token = await context.user.getIdToken(); current(context);
    const response = await fetch(`/api/projects/${encodeURIComponent(context.projectId)}/actions`, { ...options,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    const reader = response.body?.getReader(); if (!reader) fail('AUTHORING_RESPONSE_INVALID');
    let size = 0; const chunks = [];
    try { for (;;) { const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > 768 * 1024) fail('AUTHORING_RESPONSE_TOO_LARGE'); chunks.push(value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
    current(context); const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('AUTHORING_RESPONSE_INVALID'); }
    if (!response.ok) throw new AuthoringClientError(/^[A-Z0-9_]{1,80}$/.test(data?.error) ? data.error : 'AUTHORING_UNAVAILABLE', response.status);
    return data;
}
export async function preparePrivateProjectAction(projectId, options = {}) {
    const user = auth.currentUser;
    if (!user) fail('AUTH_REQUIRED');
    const base = { projectId, uid: user.uid, user };
    const snap = await getDoc(doc(db, 'users', user.uid, 'projects', projectId)); current(base);
    if (!snap.exists()) {
        const deleting = pending.get(`${user.uid}/${projectId}/delete`);
        if (deleting) return deleting.context;
        fail('PROJECT_NOT_FOUND');
    }
    const root = snap.data();
    if (!usesPrivateAuthoring(root)) return null;
    assertPrivateAuthoringRoot(root, user.uid, projectId);
    const remote = await request(base);
    assertPrivateAuthoringHead(remote.head, { uid: user.uid, projectId, generationId: remote.head?.generationId });
    if (Object.hasOwn(options, 'expectedHead') && (!options.expectedHead
        || options.expectedHead.sha256 !== remote.head.sha256 || options.expectedHead.revision !== remote.head.revision
        || options.expectedHead.generationId !== remote.head.generationId)) fail('AUTHORING_REVISION_CONFLICT');
    return Object.freeze({ ...base, ...remote });
}
export async function runPrivateProjectAction(context, kind, payload = {}) {
    current(context);
    const key = `${context.uid}/${context.projectId}/${kind}`;
    const logical = JSON.stringify(payload);
    let operation = pending.get(key);
    const recoveringDifferentAction = operation && operation.logical !== logical;
    if (!operation) {
        const command = { kind, payload, requestId: crypto.randomUUID(), generationId: context.head.generationId,
            baseRevision: context.head.revision, mutationRevision: context.mutationRevision };
        operation = { logical, context, body: JSON.stringify(command) }; pending.set(key, operation);
    }
    // Preserve exact command/base/id when a commit response is lost.
    try {
        const result = await request(operation.context, { method: 'POST', body: operation.body });
        current(context); pending.delete(key);
        if (recoveringDifferentAction) throw new AuthoringClientError('前の操作の完了を確認しました。画面を再読み込みしてから操作してください。', 409);
        return result;
    } catch (error) {
        // Definitive rejection permits a fresh explicit user action after refreshing.
        if ([400, 401, 403, 409, 413, 415, 422].includes(error.status)) pending.delete(key);
        throw error;
    }
}
