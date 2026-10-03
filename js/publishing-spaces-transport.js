import {accountJsonRequest} from './account-json-request.js';
// Transport used by Studio and isolated browser verification. No Firebase imports.
const fail = code => { throw new Error(code); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^space_[a-z0-9-]{16,64}$/.test(value);
function validate(data, uid, image) {
    if (!record(data) || data.uid !== uid || data.schemaVersion !== 1) fail('SPACES_RESPONSE_INVALID');
    if (image) {
        if (typeof data.dataUrl !== 'string' || data.dataUrl.length > 350000 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.dataUrl)) fail('SPACES_RESPONSE_INVALID');
        return data;
    }
    if (!Array.isArray(data.spaces) || data.spaces.length > 32 || !record(data.assignments)
        || Object.keys(data.assignments).length > 2000 || !Number.isSafeInteger(data.revision) || data.revision < 0) fail('SPACES_RESPONSE_INVALID');
    const ids = new Set();
    for (const space of data.spaces) {
        if (!record(space) || !id(space.id) || ids.has(space.id) || space.ownerUid !== uid || space.role !== 'owner'
            || typeof space.name !== 'string' || space.name.length > 80 || !space.name.trim()) fail('SPACES_RESPONSE_INVALID');
        ids.add(space.id);
        if (space.profile) {
            const p = space.profile;
            if (!record(p) || typeof p.description !== 'string' || p.description.length > 2000
                || typeof p.website !== 'string' || p.website.length > 2048
                || ['icon','banner'].some(slot => p[slot] != null && !/^[a-f0-9]{64}$/.test(p[slot]))) fail('SPACES_RESPONSE_INVALID');
        }
    }
    if (data.mySpaceProfile !== undefined) {
        const p = data.mySpaceProfile;
        if (!record(p) || typeof p.description !== 'string' || p.description.length > 2000
            || typeof p.website !== 'string' || p.website.length > 2048
            || ['icon','banner'].some(slot => p[slot] != null && !/^[a-f0-9]{64}$/.test(p[slot]))) fail('SPACES_RESPONSE_INVALID');
    }
    if (Object.values(data.assignments).some(value => !ids.has(value))) fail('SPACES_RESPONSE_INVALID');
    return data;
}
export function createPublishingSpacesClient({getUser, fetcher = globalThis.fetch, timeoutMs = 20000}) {
    return async function request(command = null) {
        const user = getUser();
        const current = () => { if (!user || getUser() !== user) fail('AUTH_CHANGED'); };
        current();
        const data = await accountJsonRequest({getUser,fetcher,url:'/api/publishing-spaces',command,
            readOnly:!command||['readImage','publicationContext'].includes(command.kind),limit:600000,timeoutMs,
            errors:{auth:'AUTH_CHANGED',timeout:'SPACES_TIMEOUT',offline:'SPACES_OFFLINE',invalid:'SPACES_RESPONSE_INVALID',unavailable:'SPACES_UNAVAILABLE'}});
        current();
        const validated = validate(data,user.uid,command?.kind === 'readImage');
        if (command?.kind === 'publicationContext') {
            const p = validated.publication;
            if (!record(p) || p.projectId !== command.projectId || p.purpose !== command.purpose
                || typeof p.required !== 'boolean' || (p.spaceId !== null && (!id(p.spaceId)
                || validated.assignments[command.projectId] !== p.spaceId
                || !validated.spaces.some(space => space.id === p.spaceId)))) fail('SPACES_RESPONSE_INVALID');
        }
        return validated;
    };
}
