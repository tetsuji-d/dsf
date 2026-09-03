/**
 * Fail-closed public Viewer loader for immutable DSF delivery v2 releases.
 *
 * Firestore access and Viewer state mutation stay outside this module. The
 * loader accepts the public projection (and optionally an owner-side Release
 * snapshot), verifies remote JSON bytes, prepares certified fonts, and returns
 * a disposable Viewer session.
 */

import {
    assertValidDsfDeliveryBundle,
    normalizeDsfDeliveryBundle,
} from './dsf-delivery-v2.js';
import { DSF_PRODUCTION_FONT_REGISTRY } from './dsf-font-registry.js';
import { selectDsfPublicReleaseTransport } from './dsf-horizon-release-contract.js';
import { fetchDsfProductionFontRuntimeLease } from './dsf-production-font-runtime.js';
import { sha256DsfBytes } from './dsf-release-byte-sealing.js';
import { serializeDsfReleaseJson } from './dsf-release-assembly.js';
import { prepareDsfViewerFixedTextContext } from './viewer-fixed-text.js';

export const DSF_HORIZON_VIEWER_LOAD_VERSION = 1;
export const DSF_HORIZON_VIEWER_SESSION_KIND = 'horizon-v2-public-viewer';

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const JSON_MIME_TYPE = 'application/json';
const STRONG_V2_FIELDS = Object.freeze(['dsfContentUrl', 'dsfContentHash', 'dsfPageCounts']);
const V2_FIELDS = Object.freeze([
    'dsfSchemaVersion',
    'dsfContentUrl',
    'dsfContentHash',
    'dsfLangs',
    'dsfPageCounts',
    'dsfTotalBytes',
]);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}) {
    throw new DsfHorizonViewerLoadError([createIssue(code, path, message, details)]);
}

function normalizeMetadataForV2(metadata) {
    const normalized = {};
    for (const field of V2_FIELDS) {
        if (hasOwn(metadata, field)) normalized[field] = metadata[field];
    }
    for (const field of ['authorUid', 'uid', 'workId', 'releaseId', 'defaultLang', 'pageCount']) {
        if (hasOwn(metadata, field)) normalized[field] = metadata[field];
    }
    return normalized;
}

export function isDsfHorizonV2MetadataDeclared(metadata) {
    return isRecord(metadata) && (
        metadata.dsfSchemaVersion === 2
        || STRONG_V2_FIELDS.some((field) => hasOwn(metadata, field))
    );
}

function selectV2Transport(metadata, identity, allowedContentOrigins, path) {
    if (!isDsfHorizonV2MetadataDeclared(metadata)) {
        fail('HORIZON_VIEWER_V2_LOCATOR_MISSING', path, 'DSF v2 release metadata is missing.');
    }
    let transport;
    try {
        transport = selectDsfPublicReleaseTransport(normalizeMetadataForV2(metadata), {
            ...identity,
            allowedContentOrigins,
        });
    } catch (error) {
        fail('HORIZON_VIEWER_V2_LOCATOR_INVALID', path, 'DSF v2 release metadata failed validation.', {
            causeCode: error?.code || null,
            cause: error?.message || String(error),
            validationIssues: error?.issues || [],
        });
    }
    if (transport.transportKind !== 'horizon-v2') {
        fail('HORIZON_VIEWER_V2_TRANSPORT_REQUIRED', path, 'Public Viewer requires the DSF v2 Horizon transport.');
    }
    return transport;
}

function assertMatchingTransports(publicTransport, releaseTransport) {
    const comparable = (transport) => ({
        contentUrl: transport.contentUrl,
        contentHash: transport.contentHash,
        languages: transport.languages,
        pageCounts: transport.pageCounts,
        defaultLang: transport.defaultLang,
        totalBytes: transport.totalBytes,
        identity: transport.identity,
    });
    if (serializeDsfReleaseJson(comparable(publicTransport))
        !== serializeDsfReleaseJson(comparable(releaseTransport))) {
        fail(
            'HORIZON_VIEWER_PUBLIC_RELEASE_MISMATCH',
            'metadata',
            'Public index and immutable Release metadata do not match.',
        );
    }
}

function decodeUtf8(bytes, path) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        fail('HORIZON_VIEWER_UTF8_INVALID', path, 'Remote DSF JSON is not valid UTF-8.', {
            cause: error?.message || String(error),
        });
    }
}

function parseCanonicalJson(bytes, path) {
    const text = decodeUtf8(bytes, path);
    let value;
    try {
        value = JSON.parse(text);
    } catch (error) {
        fail('HORIZON_VIEWER_JSON_INVALID', path, 'Remote DSF JSON could not be parsed.', {
            cause: error?.message || String(error),
        });
    }
    if (!isRecord(value) || serializeDsfReleaseJson(value) !== text) {
        fail('HORIZON_VIEWER_JSON_NON_CANONICAL', path, 'Remote DSF JSON must match the canonical release bytes.');
    }
    return value;
}

async function fetchVerifiedJson({ fetchImpl, url, expectedSha256, path, hashBytes, signal }) {
    let response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit',
            cache: 'force-cache',
            redirect: 'error',
            signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        fail('HORIZON_VIEWER_FETCH_FAILED', path, 'Remote DSF JSON request failed.', {
            cause: error?.message || String(error),
        });
    }
    if (!response?.ok || typeof response.arrayBuffer !== 'function') {
        fail('HORIZON_VIEWER_FETCH_FAILED', path, 'Remote DSF JSON response was not successful.', {
            status: response?.status,
        });
    }
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && contentType !== JSON_MIME_TYPE) {
        fail('HORIZON_VIEWER_JSON_MIME_MISMATCH', path, 'Remote DSF JSON response must use application/json.', {
            contentType,
        });
    }
    const declaredLengthText = String(response.headers?.get?.('content-length') || '').trim();
    if (declaredLengthText) {
        const declaredLength = Number(declaredLengthText);
        if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_JSON_BYTES) {
            fail('HORIZON_VIEWER_JSON_SIZE_INVALID', path, 'Remote DSF JSON Content-Length is invalid.', {
                contentLength: declaredLengthText,
            });
        }
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_JSON_BYTES) {
        fail('HORIZON_VIEWER_JSON_SIZE_INVALID', path, 'Remote DSF JSON exceeds the Viewer size limit.', {
            byteLength: bytes.byteLength,
        });
    }
    const sha256 = await hashBytes(bytes);
    if (sha256 !== expectedSha256) {
        fail('HORIZON_VIEWER_JSON_HASH_MISMATCH', path, 'Remote DSF JSON SHA-256 does not match its immutable locator.', {
            expected: expectedSha256,
            actual: sha256,
        });
    }
    return { bytes, value: parseCanonicalJson(bytes, path) };
}

function resolveReleaseResourceUrl(baseFileUrl, href, releaseRoot, path) {
    if (typeof href !== 'string'
        || !href
        || href !== href.trim()
        || href.startsWith('/')
        || href.includes('\\')
        || href.includes('%')
        || /^[a-z][a-z0-9+.-]*:/i.test(href)
        || /[\u0000-\u001f\u007f]/u.test(href)) {
        fail('HORIZON_VIEWER_RESOURCE_HREF_INVALID', path, 'Release resources must use a safe relative href.');
    }
    let resolved;
    try {
        resolved = new URL(href, baseFileUrl);
    } catch {
        fail('HORIZON_VIEWER_RESOURCE_HREF_INVALID', path, 'Release resource href cannot be resolved.');
    }
    if (resolved.origin !== releaseRoot.origin
        || !resolved.pathname.startsWith(releaseRoot.pathname)
        || resolved.pathname === releaseRoot.pathname
        || resolved.username
        || resolved.password
        || resolved.search
        || resolved.hash) {
        fail('HORIZON_VIEWER_RESOURCE_URL_OUTSIDE_RELEASE', path, 'Release resource URL escapes the immutable release root.');
    }
    return resolved.href;
}

function validateIndexAgainstTransport(index, transport) {
    const indexLanguages = Object.keys(index.languages || {});
    if (serializeDsfReleaseJson(indexLanguages) !== serializeDsfReleaseJson(transport.languages)
        || index.defaultLang !== transport.defaultLang) {
        fail('HORIZON_VIEWER_INDEX_LANGUAGE_MISMATCH', 'content.json.languages', 'Content index languages differ from the public locator.');
    }
    for (const language of transport.languages) {
        if (index.languages[language]?.pageCount !== transport.pageCounts[language]) {
            fail('HORIZON_VIEWER_INDEX_PAGE_COUNT_MISMATCH', `content.json.languages.${language}.pageCount`, 'Content index page count differs from the public locator.');
        }
    }
}

function validateRegistryFonts(bundle, registry) {
    for (const [fontId, declaration] of Object.entries(bundle.index.fonts || {})) {
        const certified = registry.fonts?.[fontId]?.declaration;
        if (!certified || serializeDsfReleaseJson(declaration) !== serializeDsfReleaseJson(certified)) {
            fail('HORIZON_VIEWER_FONT_CERTIFICATE_MISMATCH', `content.json.fonts.${fontId}`, 'Release font does not match the active production registry.');
        }
    }
    for (const [language, manifest] of Object.entries(bundle.manifests || {})) {
        for (const [pageIndex, page] of manifest.pages.entries()) {
            if (page.renderKind !== 'fixedText') continue;
            for (const [lineIndex, line] of page.lines.entries()) {
                const styleRefs = [line.styleRef, ...line.runs.map((run) => run.styleRef).filter(Boolean)];
                for (const styleRef of styleRefs) {
                    const style = manifest.styles[styleRef];
                    const capabilities = registry.fonts?.[style.fontRef]?.capabilities;
                    const fontStyle = style.fontStyle || 'normal';
                    if (!capabilities
                        || !capabilities.languages.includes(language)
                        || !capabilities.writingModes.includes(line.writingMode)
                        || !capabilities.fontWeights.includes(style.fontWeight)
                        || !capabilities.fontStyles.includes(fontStyle)) {
                        fail(
                            'HORIZON_VIEWER_FONT_CAPABILITY_MISMATCH',
                            `manifests.${language}.pages[${pageIndex}].lines[${lineIndex}]`,
                            'Fixed-text style exceeds the active production font certificate.',
                            { fontId: style.fontRef, styleRef, writingMode: line.writingMode },
                        );
                    }
                }
            }
        }
    }
}

function collectFontUsages(bundle) {
    const usages = new Map();
    for (const manifest of Object.values(bundle.manifests || {})) {
        for (const style of Object.values(manifest.styles || {})) {
            if (!style?.fontRef) continue;
            if (!usages.has(style.fontRef)) usages.set(style.fontRef, new Map());
            const fontStyle = style.fontStyle || 'normal';
            const weights = usages.get(style.fontRef);
            if (!weights.has(fontStyle)) weights.set(fontStyle, new Set());
            weights.get(fontStyle).add(Number(style.fontWeight) || 400);
        }
    }
    return usages;
}

async function prepareRuntimeFonts({ bundle, registry, fontRuntimeLoader, fetchImpl, documentRef, cryptoRef, signal }) {
    const runtimeBundle = normalizeDsfDeliveryBundle(bundle);
    const certificates = {};
    const leases = [];
    try {
        for (const [fontId, styles] of collectFontUsages(bundle)) {
            let runtimeFamily = '';
            for (const [fontStyle, weights] of styles) {
                const lease = await fontRuntimeLoader({
                    registry,
                    fontId,
                    fontStyle,
                    fontWeights: [...weights],
                    fetchImpl,
                    documentRef,
                    cryptoRef,
                    signal,
                });
                if (!lease?.runtimeFontFamily || typeof lease.dispose !== 'function') {
                    fail('HORIZON_VIEWER_FONT_RUNTIME_INVALID', `content.json.fonts.${fontId}`, 'Certified font runtime did not return a disposable lease.');
                }
                if (runtimeFamily && runtimeFamily !== lease.runtimeFontFamily) {
                    fail('HORIZON_VIEWER_FONT_RUNTIME_FAMILY_MISMATCH', `content.json.fonts.${fontId}`, 'Certified font runtime family changed between styles.');
                }
                runtimeFamily = lease.runtimeFontFamily;
                leases.push(lease);
            }
            runtimeBundle.index.fonts[fontId] = {
                ...runtimeBundle.index.fonts[fontId],
                family: runtimeFamily,
            };
            certificates[fontId] = { ...runtimeBundle.index.fonts[fontId] };
        }
    } catch (error) {
        while (leases.length) {
            try { leases.pop().dispose(); } catch (_) { /* noop */ }
        }
        throw error;
    }
    return { runtimeBundle, certificates, leases };
}

function createViewerPages(manifest) {
    return manifest.pages.map((deliveryPage) => ({
        id: deliveryPage.id,
        deliveryV2: deliveryPage,
        content: {
            backgrounds: deliveryPage.renderKind === 'image'
                ? { '__all': deliveryPage.image.href }
                : {},
            bubbles: {},
        },
    }));
}

function createProject(metadata, transport, index, pages) {
    return {
        projectId: metadata.projectId || '',
        workId: transport.identity.workId,
        releaseId: transport.identity.releaseId,
        authorUid: transport.identity.uid,
        title: metadata.title || '',
        authorName: metadata.authorName || '',
        labelName: metadata.labelName || '',
        rating: metadata.rating || 'all',
        license: metadata.license || 'all-rights-reserved',
        meta: isRecord(metadata.meta) ? metadata.meta : {},
        publication: isRecord(metadata.publication) ? metadata.publication : null,
        dsfStatus: metadata.dsfStatus || 'public',
        dsfSchemaVersion: 2,
        dsfContentUrl: transport.contentUrl,
        dsfContentHash: transport.contentHash,
        dsfLangs: [...transport.languages],
        dsfPageCounts: { ...transport.pageCounts },
        dsfTotalBytes: transport.totalBytes,
        languages: [...transport.languages],
        defaultLang: transport.defaultLang,
        languageConfigs: Object.fromEntries(transport.languages.map((language) => [
            language,
            { pageDirection: index.languages[language].pageDirection },
        ])),
        pages,
        dsfResolution: `${index.canonicalPage.width}x${index.canonicalPage.height}`,
        bookMode: metadata.bookMode || 'simple',
    };
}

function createAssetUrls(bundle, contentUrl, releaseRoot) {
    const assetUrls = new Map();
    for (const [language, manifest] of Object.entries(bundle.manifests)) {
        const manifestUrl = resolveReleaseResourceUrl(
            contentUrl,
            bundle.index.languages[language].href,
            releaseRoot,
            `content.json.languages.${language}.href`,
        );
        for (const [pageIndex, page] of manifest.pages.entries()) {
            const resources = [];
            if (page.renderKind === 'image') resources.push(['image.href', page.image.href]);
            if (page.renderKind === 'fixedText' && page.background?.imageHref) {
                resources.push(['background.imageHref', page.background.imageHref]);
            }
            for (const [field, href] of resources) {
                const resolved = resolveReleaseResourceUrl(
                    manifestUrl,
                    href,
                    releaseRoot,
                    `manifests.${language}.pages[${pageIndex}].${field}`,
                );
                const previous = assetUrls.get(href);
                if (previous && previous !== resolved) {
                    fail('HORIZON_VIEWER_RESOURCE_HREF_COLLISION', `manifests.${language}.pages[${pageIndex}].${field}`, 'The same resource href resolves to different release files.');
                }
                assetUrls.set(href, resolved);
            }
        }
    }
    return assetUrls;
}

export class DsfHorizonViewerLoadError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Public DSF v2 release could not be opened.');
        this.name = 'DsfHorizonViewerLoadError';
        this.code = 'DSF_HORIZON_VIEWER_LOAD_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

export async function loadDsfHorizonViewerRelease(input = {}) {
    if (!isRecord(input.publicMetadata)) {
        throw new TypeError('Public index metadata is required.');
    }
    const identity = {
        uid: String(input.uid || '').trim(),
        workId: String(input.workId || '').trim(),
        releaseId: String(input.releaseId || '').trim(),
    };
    const allowedContentOrigins = Array.isArray(input.allowedContentOrigins) ? input.allowedContentOrigins : [];
    const publicTransport = selectV2Transport(input.publicMetadata, identity, allowedContentOrigins, 'publicMetadata');
    const releaseTransport = isRecord(input.releaseMetadata)
        ? selectV2Transport(input.releaseMetadata, identity, allowedContentOrigins, 'releaseMetadata')
        : publicTransport;
    if (isRecord(input.releaseMetadata)) assertMatchingTransports(publicTransport, releaseTransport);

    const fetchImpl = input.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') fail('HORIZON_VIEWER_FETCH_UNAVAILABLE', 'fetchImpl', 'Fetch is unavailable.');
    const cryptoRef = input.cryptoRef || globalThis.crypto;
    const hashBytes = input.hashBytes || ((bytes) => sha256DsfBytes(bytes, { cryptoRef }));
    const registry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const documentRef = input.documentRef || globalThis.document;
    const fontRuntimeLoader = input.fontRuntimeLoader || fetchDsfProductionFontRuntimeLease;
    const contentUrl = releaseTransport.contentUrl;
    const contentLocation = new URL(contentUrl);
    const releaseRoot = new URL('./', contentLocation);
    const runtimeLeases = [];

    try {
        const content = await fetchVerifiedJson({
            fetchImpl,
            url: contentUrl,
            expectedSha256: releaseTransport.contentHash,
            path: 'content.json',
            hashBytes,
            signal: input.signal,
        });
        validateIndexAgainstTransport(content.value, releaseTransport);
        const manifests = {};
        for (const language of releaseTransport.languages) {
            const descriptor = content.value.languages[language];
            const manifestUrl = resolveReleaseResourceUrl(
                contentUrl,
                descriptor.href,
                releaseRoot,
                `content.json.languages.${language}.href`,
            );
            const manifest = await fetchVerifiedJson({
                fetchImpl,
                url: manifestUrl,
                expectedSha256: descriptor.sha256,
                path: descriptor.href,
                hashBytes,
                signal: input.signal,
            });
            manifests[language] = manifest.value;
        }
        const sourceBundle = normalizeDsfDeliveryBundle({ index: content.value, manifests });
        assertValidDsfDeliveryBundle(sourceBundle);
        validateRegistryFonts(sourceBundle, registry);

        const fontRuntime = await prepareRuntimeFonts({
            bundle: sourceBundle,
            registry,
            fontRuntimeLoader,
            fetchImpl,
            documentRef,
            cryptoRef,
            signal: input.signal,
        });
        runtimeLeases.push(...fontRuntime.leases);
        const contextsByLanguage = new Map();
        const pagesByLanguage = new Map();
        for (const language of releaseTransport.languages) {
            const context = await prepareDsfViewerFixedTextContext({
                bundle: fontRuntime.runtimeBundle,
                language,
                certifiedFonts: fontRuntime.certificates,
                fontFaceSet: documentRef?.fonts,
            });
            contextsByLanguage.set(language, context);
            pagesByLanguage.set(language, createViewerPages(context.manifest));
        }
        const assetUrls = createAssetUrls(fontRuntime.runtimeBundle, contentUrl, releaseRoot);
        const projectMetadata = {
            ...input.releaseMetadata,
            ...input.publicMetadata,
            ...(isRecord(input.projectMetadata) ? input.projectMetadata : {}),
        };
        const project = createProject(
            projectMetadata,
            releaseTransport,
            fontRuntime.runtimeBundle.index,
            pagesByLanguage.get(releaseTransport.defaultLang),
        );
        let disposed = false;
        return {
            sessionVersion: DSF_HORIZON_VIEWER_LOAD_VERSION,
            sessionKind: DSF_HORIZON_VIEWER_SESSION_KIND,
            transport: releaseTransport,
            index: sourceBundle.index,
            manifests: sourceBundle.manifests,
            project,
            contextsByLanguage,
            pagesByLanguage,
            assetUrls,
            dispose() {
                if (disposed) return;
                disposed = true;
                while (runtimeLeases.length) {
                    try { runtimeLeases.pop().dispose(); } catch (_) { /* noop */ }
                }
            },
        };
    } catch (error) {
        while (runtimeLeases.length) {
            try { runtimeLeases.pop().dispose(); } catch (_) { /* noop */ }
        }
        if (error instanceof DsfHorizonViewerLoadError || error?.name === 'AbortError') throw error;
        fail('HORIZON_VIEWER_PREPARATION_FAILED', '', 'Public DSF v2 Viewer preparation failed.', {
            causeCode: error?.code || null,
            cause: error?.message || String(error),
            validationIssues: error?.issues || [],
        });
    }
}
