import { canAccessPublishingSpace } from '../js/publishing-space-access.js';
import { publicationNeedsSpace, assignedPublishingSpace } from '../js/publishing-space-policy.js';
import { check, segment, AuthoringApiError, parseJson, readBounded } from './private-authoring/common.js';
import { createGoogleClient, createIdTokenVerifier } from './private-authoring/google-auth.js';
import { inspectDsfWebPBytes, sha256DsfBytes } from '../js/dsf-release-byte-sealing.js';
import { createFirestoreStore } from './private-authoring/firestore.js';

// Membership and billing are deliberately separate future operations. These routes
// only organize the caller's own cloud projects; they never grant project access.
export function createPublishingSpacesService({ db, assertLiveIdentity, now = Date.now, bucket = null }) {
    async function run(identity, command = null) {
        segment(identity.uid);
        await assertLiveIdentity(identity);
        if (command?.kind === 'readImage') {
            check(['icon', 'banner'].includes(command.slot), 'INVALID_IMAGE', 400);
            const catalogue = await run(identity);
            const space = command.spaceId === null ? {id:'my-space',profile:catalogue.mySpaceProfile} : catalogue.spaces.find(s => s.id === command.spaceId);
            check(space, 'SPACE_FORBIDDEN', 403);
            const hash = space.profile?.[command.slot];
            check(hash && /^[a-f0-9]{64}$/.test(hash), 'IMAGE_NOT_FOUND', 404);
            check(bucket, 'SPACE_MEDIA_UNAVAILABLE');
            const object = await bucket.get(mediaKey(identity.uid, space.id, hash));
            check(object && object.size <= 262144, 'IMAGE_NOT_FOUND', 404);
            const bytes = new Uint8Array(await object.arrayBuffer());
            check(await sha256DsfBytes(bytes) === hash, 'IMAGE_INVALID');
            let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
            return {schemaVersion:1, uid:identity.uid, dataUrl:'data:image/webp;base64,' + btoa(binary)};
        }
        let prepared = null;
        const publicationCheck = command?.kind === 'publicationContext';
        const personalProfile = command?.kind === 'myProfile';
        if (publicationCheck) {
            segment(command.projectId);
            check(['draft', 'publication'].includes(command.purpose), 'INVALID_COMMAND', 400);
        }
        if (command && !publicationCheck) {
            check(command && !Array.isArray(command) && ['create', 'rename', 'assign', 'profile', 'myProfile'].includes(command.kind), 'INVALID_COMMAND', 400);
            check(Number.isSafeInteger(command.baseRevision) && command.baseRevision >= 0, 'INVALID_REVISION', 400);
            if (command.kind !== 'assign' && !personalProfile) {
                check(typeof command.name === 'string' && command.name.trim().length > 0 && command.name.trim().length <= 80
                    && !/[\u0000-\u001f\u007f]/u.test(command.name), 'INVALID_NAME', 400);
            }
            if (command.kind === 'profile' || personalProfile) prepared = await prepareProfile(command.profile);
            if (personalProfile) check(command.spaceId === null, 'INVALID_ID', 400);
            if (command.spaceId !== null) segment(command.spaceId);
            if (command.kind !== 'assign' && !personalProfile) check(/^space_[a-z0-9-]{16,64}$/.test(command.spaceId), 'INVALID_ID', 400);
            if (command.kind === 'assign') {
                segment(command.projectId);
                check(command.expectedSpaceId === null || typeof command.expectedSpaceId === 'string', 'INVALID_COMMAND', 400);
            }
        }
        return db.transaction(async tx => {
            const accountPath = 'users/' + identity.uid;
            const indexPath = accountPath + '/publishing/catalogue';
            const [account, stored] = await tx.getMany([accountPath, indexPath]);
            check(account?.uid === identity.uid && account.status?.disabled === false
                && account.status?.moderationHold !== true, 'ACCOUNT_UNAVAILABLE', 403);
            if (command && !publicationCheck) check(account.entitlements?.canCreateProject === true, 'EDIT_FORBIDDEN', 403);
            const index = stored || { schemaVersion: 1, revision: 0, spaceIds: [], assignments: {} };
            check(index.schemaVersion === 1 && Array.isArray(index.spaceIds) && index.spaceIds.length <= 32
                && index.spaceIds.every(id => /^space_[a-z0-9-]{16,64}$/.test(id))
                && index.assignments && !Array.isArray(index.assignments), 'CATALOGUE_INVALID');
            const ids = [...new Set([...index.spaceIds, ...(command?.spaceId ? [command.spaceId] : [])])];
            const spacePaths = ids.map(id => 'publishing_spaces/' + id);
            const spaces = await tx.getMany(spacePaths);
            index.spaceIds.forEach(id => check(spaces[ids.indexOf(id)]?.ownerUid === identity.uid, 'SPACE_FORBIDDEN', 403));
            const result = () => ({
                schemaVersion: 1, uid: identity.uid, revision: index.revision,
                spaces: index.spaceIds.map(id => {
                    const s = spaces[ids.indexOf(id)];
                    return { id, name: s.name, ownerUid: s.ownerUid, role: 'owner', profile: s.profile || {description:'', website:'', icon:null, banner:null} };
                }),
                assignments: index.assignments,
                mySpaceProfile: index.mySpaceProfile || {description:'', website:'', icon:null, banner:null},
            });
            if (!command) return result();
            if (publicationCheck) {
                const [project] = await tx.getMany([accountPath + '/projects/' + command.projectId]);
                check(project && (!project.ownerUid || project.ownerUid === identity.uid), 'PROJECT_NOT_FOUND', 404);
                return {...result(), publication: {projectId:command.projectId, purpose:command.purpose,
                    required:publicationNeedsSpace(project, command.purpose), spaceId:assignedPublishingSpace(index, command.projectId)}};
            }
            const space = personalProfile ? {profile:index.mySpaceProfile} : command.spaceId ? spaces[ids.indexOf(command.spaceId)] : null;
            if (command.kind !== 'create' && command.spaceId) {
                // Membership is not enabled on legacy personal-authoring routes. No caller-supplied role is trusted.
                check(index.spaceIds.includes(command.spaceId) && canAccessPublishingSpace({actorUid:identity.uid,
                    space:space && {id:command.spaceId,ownerUid:space.ownerUid}}, 'manageSpace'), 'SPACE_FORBIDDEN', 403);
            }
            if (command.kind === 'assign') {
                const [project] = await tx.getMany([accountPath + '/projects/' + command.projectId]);
                check(project && (!project.ownerUid || project.ownerUid === identity.uid), 'PROJECT_NOT_FOUND', 404);
                const previous = Object.hasOwn(index.assignments, command.projectId) ? index.assignments[command.projectId] : null;
                if (previous === command.spaceId) return result(); // Lost response: safe exact retry.
                const sharedRecords=await tx.getMany([...(project.workId?['publishing_work_scopes/'+segment(project.workId)]:[]),accountPath+'/projects/'+command.projectId+'/authoringLocks/current']);
                check(sharedRecords.every(record=>!record),'SHARED_WORK_MOVE_UNAVAILABLE',409);
                check(previous === command.expectedSpaceId, 'SPACE_CONFLICT', 409);
            }
            if (command.kind === 'create' && space) {
                check(space.ownerUid === identity.uid && index.spaceIds.includes(command.spaceId)
                    && space.name === command.name.trim(), 'SPACE_CONFLICT', 409);
                return result();
            }
            if ((command.kind === 'profile' || personalProfile) && (personalProfile || space.name === command.name.trim())
                && (space.profile?.description || '') === prepared.description
                && (space.profile?.website || '') === prepared.website
                && ['icon','banner'].every(slot => prepared[slot] === undefined
                    || (prepared[slot]?.hash || null) === (space.profile?.[slot] || null))) return result();
            if (command.kind === 'rename' && space.name === command.name.trim()) return result();
            check(command.baseRevision === index.revision, 'SPACE_CONFLICT', 409);
            if (command.kind === 'create') {
                check(index.spaceIds.length < 32, 'SPACE_LIMIT', 409); // Technical bound, not a paid tier.
                const value = { schemaVersion: 1, ownerUid: identity.uid, name: command.name.trim(),
                    createdAt: new Date(now()), updatedAt: new Date(now()) };
                tx.set('publishing_spaces/' + command.spaceId, value);
                spaces[ids.indexOf(command.spaceId)] = value;
                index.spaceIds.push(command.spaceId);
            } else if (command.kind === 'profile' || personalProfile) {
                const profile = { ...(space.profile || {}), description:prepared.description, website:prepared.website };
                for (const slot of ['icon', 'banner']) {
                    const image = prepared[slot];
                    if (image === undefined) continue;
                    if (image === null) { profile[slot] = null; continue; }
                    check(bucket, 'SPACE_MEDIA_UNAVAILABLE');
                    const key = mediaKey(identity.uid, personalProfile ? 'my-space' : command.spaceId, image.hash);
                    await bucket.put(key, image.bytes, {httpMetadata:{contentType:'image/webp'}});
                    const stored = await bucket.get(key);
                    check(stored && await sha256DsfBytes(new Uint8Array(await stored.arrayBuffer())) === image.hash, 'SPACE_MEDIA_UNAVAILABLE');
                    profile[slot] = image.hash;
                }
                if (personalProfile) index.mySpaceProfile = profile;
                else {
                    const value = {...space, name:command.name.trim(), profile, updatedAt:new Date(now())};
                    tx.set('publishing_spaces/' + command.spaceId, value);
                    spaces[ids.indexOf(command.spaceId)] = value;
                }
            } else if (command.kind === 'rename') {
                const value = { ...space, name: command.name.trim(), updatedAt: new Date(now()) };
                tx.set('publishing_spaces/' + command.spaceId, value);
                spaces[ids.indexOf(command.spaceId)] = value;
            } else {
                if (command.spaceId === null) delete index.assignments[command.projectId];
                else {
                    check(Object.hasOwn(index.assignments, command.projectId)
                        || Object.keys(index.assignments).length < 2000, 'PROJECT_LIMIT', 409);
                    Object.defineProperty(index.assignments, command.projectId, { value: command.spaceId, configurable: true, enumerable: true, writable: true });
                }
            }
            index.revision++;
            tx.set(indexPath, index);
            return result();
        });
    }
    return { list: identity => run(identity), execute: (identity, command) => run(identity, command) };
}


const mediaKey = (uid, id, hash) => 'publishing-spaces/' + uid + '/' + id + '/' + hash + '.webp';
async function prepareProfile(value) {
    check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_PROFILE', 400);
    check(typeof value.description === 'string' && value.description.length <= 2000
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.description), 'INVALID_DESCRIPTION', 400);
    check(typeof value.website === 'string' && value.website.length <= 2048, 'INVALID_WEBSITE', 400);
    const website = value.website.trim();
    if (website) {
        let url; try { url = new URL(website); } catch {}
        check(url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'INVALID_WEBSITE', 400);
    }
    const result = {description:value.description.trim(), website};
    for (const slot of ['icon', 'banner']) {
        if (!Object.hasOwn(value, slot)) continue; // Omitted image retains its current value.
        if (value[slot] === null) { result[slot] = null; continue; }
        const source = value[slot], max = slot === 'icon' ? 65536 : 262144;
        check(typeof source === 'string' && source.length <= Math.ceil(max / 3) * 4 + 23
            && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(source), 'INVALID_IMAGE', 400);
        let bytes;
        try { bytes = Uint8Array.from(atob(source.slice(23)), c => c.charCodeAt(0)); } catch { check(false, 'INVALID_IMAGE', 400); }
        check(bytes.length <= max, 'INVALID_IMAGE', 400);
        let info; try { info = await inspectDsfWebPBytes(bytes); } catch { check(false, 'INVALID_IMAGE', 400); }
        check(info.width === (slot === 'icon' ? 256 : 1536) && info.height === (slot === 'icon' ? 256 : 512), 'INVALID_IMAGE', 400);
        result[slot] = {bytes, hash:await sha256DsfBytes(bytes)};
    }
    return result;
}

const response = (data, status = 200) => Response.json(data, { status, headers: {
    'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin',
} });
export function createPublishingSpacesApi({ verifyToken, service }) {
    return async ({ request, env }) => {
        try {
            check(env.PUBLISHING_SPACES_ENABLED === 'true', 'SPACES_DISABLED');
            check(['GET', 'POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 405);
            const origin = request.headers.get('Origin');
            check(!origin || origin === new URL(request.url).origin, 'ORIGIN_FORBIDDEN', 403);
            const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
            check(token, 'AUTH_REQUIRED', 401);
            const identity = await verifyToken(token[1]);
            check(identity?.uid, 'AUTH_INVALID', 401);
            if (request.method === 'GET') return response(await service.list(identity));
            check(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || ''), 'CONTENT_TYPE_INVALID', 415);
            check(!request.headers.has('Content-Encoding') || request.headers.get('Content-Encoding') === 'identity', 'CONTENT_ENCODING_INVALID', 415);
            return response(await service.execute(identity, parseJson(await readBounded(request.body, 460800))));
        } catch (error) {
            return response({ error: error instanceof AuthoringApiError ? error.code : 'SPACES_UNAVAILABLE' },
                error instanceof AuthoringApiError ? error.status : 503);
        }
    };
}
const runtimes = new WeakMap();
export async function handlePublishingSpaces(context) {
    if (context.env?.PUBLISHING_SPACES_ENABLED !== 'true') return response({ error: 'SPACES_DISABLED' }, 503);
    try {
        let handler = runtimes.get(context.env);
        if (!handler) {
            const google = createGoogleClient({ projectId: context.env.FIREBASE_PROJECT_ID,
                serviceAccountJson: context.env.AUTHORING_GOOGLE_SERVICE_ACCOUNT });
            handler = createPublishingSpacesApi({
                verifyToken: createIdTokenVerifier({ projectId: context.env.FIREBASE_PROJECT_ID }),
                service: createPublishingSpacesService({
                    db: createFirestoreStore(google, { additionalRootCollections: ['publishing_spaces', 'publishing_work_scopes'] }),
                    assertLiveIdentity: google.assertLiveIdentity,
                    bucket: context.env.AUTHORING_BUCKET && context.env.AUTHORING_BUCKET !== context.env.R2_BUCKET ? context.env.AUTHORING_BUCKET : null,
                }),
            });
            runtimes.set(context.env, handler);
        }
        return await handler(context);
    } catch { return response({ error: 'SPACES_UNAVAILABLE' }, 503); }
}
