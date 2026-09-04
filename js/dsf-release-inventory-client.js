/**
 * Fetch the authenticated owner's read-only DSF release storage inventory.
 *
 * Authentication is supplied by the caller so this module stays testable and
 * never owns Firebase state. The endpoint derives the owner namespace from the
 * token; no uid or storage prefix is accepted here.
 */

export const DSF_RELEASE_INVENTORY_CLIENT_DEFAULT_LIMIT = 1000;
export const DSF_RELEASE_INVENTORY_CLIENT_MAX_PAGES = 50;

const SAFE_LIMIT_MAX = 1000;
const SAFE_CURSOR_MAX_LENGTH = 4096;

function createInventoryClientError(code, message) {
    const error = new Error(message);
    error.name = 'DsfReleaseInventoryClientError';
    error.code = code;
    return error;
}

function assertResponsePage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.inventoryVersion !== 1
        || value.inventoryKind !== 'owner-dsf-release-storage-page'
        || typeof value.prefix !== 'string'
        || !Array.isArray(value.objects)
        || !Number.isSafeInteger(value.scannedObjectCount)
        || value.scannedObjectCount < value.objects.length
        || typeof value.truncated !== 'boolean'
        || (value.truncated && (typeof value.cursor !== 'string'
            || !value.cursor
            || value.cursor.length > SAFE_CURSOR_MAX_LENGTH))
        || (!value.truncated && value.cursor !== null)) {
        throw createInventoryClientError(
            'DSF_RELEASE_INVENTORY_RESPONSE_INVALID',
            'Release inventory returned an invalid response.',
        );
    }
    return value;
}

/**
 * Cursor-paginate /release-inventory with a hard upper bound.
 *
 * When the bound is reached, the returned final page remains `truncated:true`.
 * The pure audit therefore reports `complete:false` and never treats absent
 * storage objects as missing.
 */
export async function fetchDsfReleaseInventoryPages({
    token,
    fetchImpl = globalThis.fetch,
    endpoint = '/release-inventory',
    limit = DSF_RELEASE_INVENTORY_CLIENT_DEFAULT_LIMIT,
    maxPages = DSF_RELEASE_INVENTORY_CLIENT_MAX_PAGES,
    signal,
} = {}) {
    if (typeof token !== 'string' || !token.trim()) {
        throw createInventoryClientError(
            'DSF_RELEASE_INVENTORY_AUTH_REQUIRED',
            'Authentication is required for release inventory.',
        );
    }
    if (typeof fetchImpl !== 'function'
        || !Number.isSafeInteger(limit) || limit < 1 || limit > SAFE_LIMIT_MAX
        || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
        throw createInventoryClientError(
            'DSF_RELEASE_INVENTORY_OPTIONS_INVALID',
            'Release inventory options are invalid.',
        );
    }

    const pages = [];
    const seenCursors = new Set();
    let cursor = null;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const url = new URL(endpoint, globalThis.location?.origin || 'https://dsf.invalid');
        url.searchParams.set('limit', String(limit));
        if (cursor) url.searchParams.set('cursor', cursor);

        let response;
        try {
            response = await fetchImpl(url.pathname + url.search, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
                credentials: 'same-origin',
                signal,
            });
        } catch (cause) {
            if (cause?.name === 'AbortError') throw cause;
            throw createInventoryClientError(
                'DSF_RELEASE_INVENTORY_REQUEST_FAILED',
                'Release inventory request failed.',
            );
        }
        if (!response?.ok) {
            throw createInventoryClientError(
                'DSF_RELEASE_INVENTORY_HTTP_FAILED',
                `Release inventory request failed (${Number(response?.status) || 0}).`,
            );
        }

        let page;
        try {
            page = assertResponsePage(await response.json());
        } catch (error) {
            if (error?.code === 'DSF_RELEASE_INVENTORY_RESPONSE_INVALID') throw error;
            throw createInventoryClientError(
                'DSF_RELEASE_INVENTORY_RESPONSE_INVALID',
                'Release inventory returned an invalid response.',
            );
        }
        pages.push(page);
        if (!page.truncated) break;
        if (seenCursors.has(page.cursor)) {
            throw createInventoryClientError(
                'DSF_RELEASE_INVENTORY_CURSOR_REPEATED',
                'Release inventory returned a repeated cursor.',
            );
        }
        seenCursors.add(page.cursor);
        cursor = page.cursor;
    }

    return Object.freeze(pages.slice());
}
