import {check, segment, AuthoringApiError, parseJson, readBounded} from './private-authoring/common.js';
import {createGoogleClient, createIdTokenVerifier} from './private-authoring/google-auth.js';
import {createOwnerAuthoringStore, assertPersonalMutation} from './private-authoring/shared-boundary.js';
export const PROJECT_TRASH_RETENTION_MS = 30 * 86400000;

// Only lifecycle metadata changes. Source, assets, assignments and publication remain intact.
export function createProjectTrashService({db, assertLiveIdentity, now = Date.now}) {
    return {async execute(identity, command) {
        const uid = segment(identity?.uid), pid = segment(command?.projectId);
        check(['context', 'trash', 'restore'].includes(command.kind), 'INVALID_COMMAND', 400);
        if (command.kind !== 'context') {
            segment(command.requestId);
            check(Number.isSafeInteger(command.baseRevision) && command.baseRevision >= 0
                && typeof command.sourceVersion === 'string' && command.sourceVersion.length < 100,
            'INVALID_REVISION', 400);
        }
        await assertLiveIdentity(identity);
        return db.transaction(async tx => {
            const rootPath = `users/${uid}/projects/${pid}`, controlPath = `users/${uid}/project_trash/${pid}`;
            const cataloguePath = `users/${uid}/publishing/catalogue`;
            const [account, root, control, catalogue] = await tx.getMany([`users/${uid}`, rootPath, controlPath, cataloguePath]);
            check(account?.uid === uid && account.status?.disabled === false, 'ACCOUNT_UNAVAILABLE', 403);
            check(root && (!root.ownerUid || root.ownerUid === uid), 'PROJECT_NOT_FOUND', 404);
            await assertPersonalMutation(tx, uid, pid, root);
            const spaceId = catalogue?.assignments?.[pid] || null;
            if (spaceId) {
                const [space] = await tx.getMany(['publishing_spaces/' + segment(spaceId)]);
                check(catalogue.spaceIds?.includes(spaceId) && space?.ownerUid === uid, 'SPACE_FORBIDDEN', 403);
            }
            check(!control || (control.schemaVersion === 1 && Number.isSafeInteger(control.revision)
                && control.revision >= 1 && ['active', 'trashed'].includes(control.status)), 'TRASH_STATE_INVALID', 409);
            const privateRoot = root.authoringBackend === 'r2-private';
            const headPath = rootPath + '/authoringHeads/current', authoringControlPath = rootPath + '/authoringControl/current';
            const [head, authoringControl] = privateRoot ? await tx.getMany([headPath, authoringControlPath]) : [];
            check(!privateRoot || (head && authoringControl?.status === 'active' && Number.isSafeInteger(head.revision)), 'AUTHORING_NOT_ACTIVE', 409);
            const revision = control?.revision || 0, t = now();
            const sourceVersion = tx.exportDocument(rootPath)?.updateTime;
            check(typeof sourceVersion === 'string' && sourceVersion.length > 0, 'PROJECT_VERSION_UNAVAILABLE');
            const trashed = !!root.projectTrash;
            check(trashed === (control?.status === 'trashed')
                && (!trashed || (root.projectTrash.revision === revision
                    && root.projectTrash.restoreUntilMs === control.restoreUntilMs)), 'TRASH_STATE_INVALID', 409);
            const result = () => ({projectId: pid, revision, sourceVersion, serverTimeMs: t,
                status: trashed ? 'trashed' : 'active', restoreUntilMs: control?.restoreUntilMs || null});
            if (command.kind === 'context') return result();
            const signature = JSON.stringify([command.kind, command.baseRevision, command.sourceVersion]);
            if (control?.requestId === command.requestId) {
                check(control.signature === signature, 'REQUEST_REUSED', 409);
                return result(); // Exact retry does not extend the retention period.
            }
            check(revision === command.baseRevision && sourceVersion === command.sourceVersion, 'PROJECT_CHANGED', 409);
            if (command.kind === 'trash') check(!trashed, 'PROJECT_ALREADY_TRASHED', 409);
            else check(trashed && t < control.restoreUntilMs, 'TRASH_RESTORE_EXPIRED', 409);
            const nextRevision = revision + 1;
            const marker = command.kind === 'trash' ? {revision: nextRevision, trashedAtMs: t, restoreUntilMs: t + PROJECT_TRASH_RETENTION_MS} : null;
            tx.patch(rootPath, {projectTrash: marker});
            // Advance the save fence without changing immutable source bytes or their descriptor.
            if (privateRoot) {
                tx.set(headPath, {...head, revision: head.revision + 1});
                tx.set(authoringControlPath, {...authoringControl, mutationRevision: (authoringControl.mutationRevision || 0) + 1});
            }
            tx.set(controlPath, {schemaVersion: 1, revision: nextRevision,
                status: marker ? 'trashed' : 'active', requestId: command.requestId, signature,
                trashedAtMs: marker?.trashedAtMs || control.trashedAtMs,
                restoreUntilMs: marker?.restoreUntilMs || control.restoreUntilMs, updatedAtMs: t});
            return {projectId: pid, revision: nextRevision, status: marker ? 'trashed' : 'active',
                restoreUntilMs: marker?.restoreUntilMs || null, serverTimeMs: t};
        });
    }};
}
const response = (data, status = 200) => Response.json(data, {status, headers: {
    'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin',
}});
export function createProjectTrashApi({verifyToken, service}) {
    return async ({request, env}) => {
        try {
            check(env.PUBLISHING_SPACES_ENABLED === 'true', 'TRASH_UNAVAILABLE');
            check(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
            const origin = request.headers.get('Origin');
            check((!origin || origin === new URL(request.url).origin)
                && request.headers.get('Sec-Fetch-Site') !== 'cross-site', 'ORIGIN_FORBIDDEN', 403);
            const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
            check(token, 'AUTH_REQUIRED', 401);
            const identity = await verifyToken(token[1]);
            check(identity?.uid, 'AUTH_INVALID', 401);
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''), 'CONTENT_TYPE_INVALID', 415);
            check(!request.headers.has('Content-Encoding') || request.headers.get('Content-Encoding') === 'identity', 'CONTENT_ENCODING_INVALID', 415);
            return response(await service.execute(identity, parseJson(await readBounded(request.body, 4096))));
        } catch (e) { return response({error: e instanceof AuthoringApiError ? e.code : 'TRASH_UNAVAILABLE'}, e instanceof AuthoringApiError ? e.status : 503); }
    };
}
const runtimes = new WeakMap();
export async function handleProjectTrash(context) {
    if (context.env?.PUBLISHING_SPACES_ENABLED !== 'true') return response({error: 'TRASH_UNAVAILABLE'}, 503);
    try {
        let handler = runtimes.get(context.env);
        if (!handler) {
            const google = createGoogleClient({projectId: context.env.FIREBASE_PROJECT_ID, serviceAccountJson: context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT});
            handler = createProjectTrashApi({verifyToken: createIdTokenVerifier({projectId: context.env.FIREBASE_PROJECT_ID}),
                service: createProjectTrashService({db: createOwnerAuthoringStore(google), assertLiveIdentity: google.assertLiveIdentity})});
            runtimes.set(context.env, handler);
        }
        return await handler(context);
    } catch { return response({error: 'TRASH_UNAVAILABLE'}, 503); }
}
