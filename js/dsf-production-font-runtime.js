/** Verified production WOFF2 loading for one ephemeral Press composition session. */

import { validateDsfProductionFontRegistry } from './dsf-font-registry.js';
import { verifyDsfProductionFontAsset } from './dsf-font-asset-verification.js';

export const DSF_PRODUCTION_FONT_RUNTIME_VERSION = 1;

const FONT_PROBE_TEXT = '永Ag雪、。()123';

export class DsfProductionFontRuntimeError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'DsfProductionFontRuntimeError';
        this.code = code;
        this.context = context;
        if (context.cause) this.cause = context.cause;
    }
}

function fail(code, message, context = {}) {
    throw new DsfProductionFontRuntimeError(code, message, context);
}

function resolveEntry(registry, fontId) {
    const validation = validateDsfProductionFontRegistry(registry);
    if (!validation.valid) {
        fail('FONT_REGISTRY_INVALID', 'Production font registry is invalid.', { issues: validation.issues });
    }
    const entry = registry.fonts?.[fontId];
    if (!entry) fail('FONT_NOT_CERTIFIED', 'Font ID is not present in the production registry.', { fontId });
    return entry;
}

function normalizeWeights(entry, values) {
    const source = Array.isArray(values) && values.length ? values : entry.capabilities.fontWeights;
    const weights = [...new Set(source.map(Number))];
    for (const weight of weights) {
        if (!Number.isInteger(weight) || !entry.capabilities.fontWeights.includes(weight)) {
            fail('FONT_WEIGHT_UNSUPPORTED', 'Requested runtime weight is not certified.', { weight });
        }
    }
    return weights;
}

function createRuntimeFamily(fontId, sha256) {
    const safeId = String(fontId || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'font';
    return `DSF Verified ${safeId} ${sha256.slice(0, 12)}`;
}

function quoteFontFamily(value) {
    return `"${String(value || '').replace(/["\\]/g, '')}"`;
}

/** Load already supplied bytes after exact-byte verification and return a disposable lease. */
export async function createDsfProductionFontRuntimeLease(options = {}) {
    const fontId = String(options.fontId || '').trim();
    const entry = resolveEntry(options.registry, fontId);
    const ownerDocument = options.documentRef || globalThis.document;
    const fontSet = ownerDocument?.fonts;
    const FontFaceCtor = options.FontFaceCtor || ownerDocument?.defaultView?.FontFace || globalThis.FontFace;
    if (!fontSet || typeof fontSet.add !== 'function' || typeof fontSet.delete !== 'function'
        || typeof fontSet.check !== 'function' || typeof FontFaceCtor !== 'function') {
        fail('FONT_RUNTIME_API_UNAVAILABLE', 'FontFace and FontFaceSet APIs are required for production composition.');
    }
    const fontStyle = String(options.fontStyle || 'normal');
    if (!entry.capabilities.fontStyles.includes(fontStyle)) {
        fail('FONT_STYLE_UNSUPPORTED', 'Requested runtime style is not certified.', { fontStyle });
    }
    const fontWeights = normalizeWeights(entry, options.fontWeights);
    const evidence = await verifyDsfProductionFontAsset({
        registry: options.registry,
        fontId,
        bytes: options.bytes,
        cryptoRef: options.cryptoRef,
    });
    const runtimeFontFamily = createRuntimeFamily(fontId, evidence.sha256);
    const faces = [];
    try {
        for (const weight of fontWeights) {
            const buffer = await evidence.blob.arrayBuffer();
            const face = new FontFaceCtor(runtimeFontFamily, buffer, {
                style: fontStyle,
                weight: String(weight),
                display: 'block',
            });
            const loaded = await face.load();
            if (!loaded || (loaded.status && loaded.status !== 'loaded')) {
                fail('FONT_RUNTIME_FACE_LOAD_FAILED', 'Verified WOFF2 could not be parsed by FontFace.', {
                    fontId,
                    weight,
                });
            }
            fontSet.add(loaded);
            faces.push(loaded);
            const descriptor = `${weight} 16px ${quoteFontFamily(runtimeFontFamily)}`;
            if (!fontSet.check(descriptor, FONT_PROBE_TEXT)) {
                fail('FONT_RUNTIME_FACE_CHECK_FAILED', 'Verified FontFace is unavailable after registration.', {
                    fontId,
                    weight,
                });
            }
        }
    } catch (cause) {
        faces.forEach((face) => fontSet.delete(face));
        if (cause instanceof DsfProductionFontRuntimeError) throw cause;
        fail('FONT_RUNTIME_FACE_LOAD_FAILED', 'Verified WOFF2 could not be loaded for production composition.', {
            fontId,
            cause,
        });
    }
    let disposed = false;
    return Object.freeze({
        runtimeVersion: DSF_PRODUCTION_FONT_RUNTIME_VERSION,
        fontId,
        certifiedFamily: entry.declaration.family,
        runtimeFontFamily,
        fontWeights: Object.freeze([...fontWeights]),
        fontStyle,
        evidence,
        dispose() {
            if (disposed) return;
            disposed = true;
            faces.forEach((face) => fontSet.delete(face));
        },
    });
}

/** Fetch one immutable registry URL without credentials, then verify and load its exact bytes. */
export async function fetchDsfProductionFontRuntimeLease(options = {}) {
    const fontId = String(options.fontId || '').trim();
    const entry = resolveEntry(options.registry, fontId);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        fail('FONT_ASSET_FETCH_UNAVAILABLE', 'Fetch is unavailable for the production font asset.', { fontId });
    }
    let response;
    try {
        response = await fetchImpl(entry.declaration.href, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'force-cache',
            redirect: 'error',
            signal: options.signal,
        });
    } catch (cause) {
        if (cause?.name === 'AbortError') throw cause;
        fail('FONT_ASSET_FETCH_FAILED', 'Production font asset request failed.', { fontId, cause });
    }
    if (!response?.ok || typeof response.arrayBuffer !== 'function') {
        fail('FONT_ASSET_FETCH_FAILED', 'Production font asset response was not successful.', {
            fontId,
            status: response?.status,
        });
    }
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && contentType !== 'font/woff2') {
        fail('FONT_ASSET_RESPONSE_MIME_MISMATCH', 'Production font response MIME type must be font/woff2.', {
            fontId,
            contentType,
        });
    }
    const contentLength = String(response.headers?.get?.('content-length') || '').trim();
    if (contentLength) {
        const parsedLength = Number(contentLength);
        if (!Number.isInteger(parsedLength) || parsedLength !== entry.asset.byteLength) {
            fail('FONT_ASSET_RESPONSE_LENGTH_MISMATCH', 'Production font response length differs from the registry.', {
                fontId,
                expected: entry.asset.byteLength,
                actual: contentLength,
            });
        }
    }
    const bytes = await response.arrayBuffer();
    return createDsfProductionFontRuntimeLease({ ...options, fontId, bytes });
}
