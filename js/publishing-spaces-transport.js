// Transport used by Studio and isolated browser verification. No Firebase imports.
const fail = code => { throw new Error(code); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^space_[a-z0-9-]{16,64}$/.test(value);
async function boundedText(response, current) {
    const reader = response.body?.getReader();
    if (!reader) fail('SPACES_RESPONSE_INVALID');
    let size = 0; const chunks = [];
    try {
        for (;;) {
            const {value,done} = await reader.read(); current();
            if (done) break;
            size += value.byteLength;
            if (size > 600000) fail('SPACES_RESPONSE_INVALID');
            chunks.push(value);
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('SPACES_RESPONSE_INVALID'); }
}
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
    if (Object.values(data.assignments).some(value => !ids.has(value))) fail('SPACES_RESPONSE_INVALID');
    return data;
}
export function createPublishingSpacesClient({getUser, fetcher = globalThis.fetch}) {
    return async function request(command = null) {
        const user = getUser();
        const current = () => { if (!user || getUser() !== user) fail('AUTH_CHANGED'); };
        current();
        const token = await user.getIdToken(); current();
        let response;
        try {
            response = await fetcher('/api/publishing-spaces', {
                method: command ? 'POST' : 'GET', cache:'no-store', redirect:'error', credentials:'omit',
                signal:AbortSignal.timeout(20000),
                headers:{Authorization:'Bearer ' + token,'Content-Type':'application/json'},
                ...(command ? {body:JSON.stringify(command)} : {}),
            });
        } catch (error) { current(); fail(error.name === 'TimeoutError' ? 'SPACES_TIMEOUT' : 'SPACES_OFFLINE'); }
        current();
        const text = await boundedText(response,current); current();
        let data; try { data = JSON.parse(text); } catch { fail('SPACES_UNAVAILABLE'); }
        if (!response.ok) fail(typeof data?.error === 'string' ? data.error : 'SPACES_UNAVAILABLE');
        return validate(data,user.uid,command?.kind === 'readImage');
    };
}
