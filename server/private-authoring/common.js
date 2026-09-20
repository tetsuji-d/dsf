export class AuthoringApiError extends Error {
    constructor(code, status = 503) { super(code); this.name = 'AuthoringApiError'; this.code = code; this.status = status; }
}
export function check(condition, code, status = 503) {
    if (!condition) throw new AuthoringApiError(code, status);
}
export function segment(value) {
    check(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'INVALID_ID', 400);
    return value;
}
export async function readBounded(stream, limit) {
    check(stream && typeof stream.getReader === 'function', 'BODY_REQUIRED', 400);
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            check(size <= limit, 'BODY_TOO_LARGE', 413);
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}
export function parseJson(bytes) {
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { throw new AuthoringApiError('INVALID_JSON', 400); }
}
export async function fetchJson(fetcher, url, options = {}) {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) }); }
    catch (error) {
        console.warn('[PrivateAuthoringUpstream]', JSON.stringify({ host: new URL(url).hostname, stage: 'fetch', name: error?.name || 'Error' }));
        throw new AuthoringApiError('UPSTREAM_UNAVAILABLE');
    }
    let data;
    try { data = parseJson(await readBounded(response.body, 4 * 1024 * 1024)); }
    catch { throw new AuthoringApiError('UPSTREAM_INVALID_RESPONSE'); }
    if (!response.ok) {
        const error = new AuthoringApiError('UPSTREAM_UNAVAILABLE');
        const upstreamCode = typeof data?.error === 'string' ? data.error : data?.error?.status;
        console.warn('[PrivateAuthoringUpstream]', JSON.stringify({ host: new URL(url).hostname, stage: 'response', status: response.status,
            code: typeof upstreamCode === 'string' && /^[A-Za-z_]{1,64}$/.test(upstreamCode) ? upstreamCode : 'UNKNOWN' }));
        // Never expose the upstream body, credentials, document data or token.
        error.aborted = response.status === 409 && data?.error?.status === 'ABORTED';
        throw error;
    }
    return { data, headers: response.headers };
}
