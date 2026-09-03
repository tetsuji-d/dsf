/** Pure Works projection for validated DSF v1/v2 release metadata. */

import { selectDsfPublicReleaseTransport } from './dsf-horizon-release-contract.js';

const V2_FIELDS = Object.freeze([
    'dsfContentUrl',
    'dsfContentHash',
    'dsfLangs',
    'dsfPageCounts',
    'dsfTotalBytes',
]);

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function normalizeLanguages(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((language) => typeof language === 'string' && language.trim()))];
}

function createTransportMetadata(data) {
    const metadata = {};
    const v2Declared = data.dsfSchemaVersion === 2
        || ['dsfContentUrl', 'dsfContentHash', 'dsfPageCounts'].some((field) => hasOwn(data, field));
    if (!v2Declared) {
        if (hasOwn(data, 'dsfSchemaVersion')) metadata.dsfSchemaVersion = data.dsfSchemaVersion;
        if (hasOwn(data, 'dsfPages')) metadata.dsfPages = data.dsfPages;
        return metadata;
    }
    if (hasOwn(data, 'dsfSchemaVersion')) metadata.dsfSchemaVersion = data.dsfSchemaVersion;
    for (const field of V2_FIELDS) {
        if (hasOwn(data, field)) metadata[field] = data[field];
    }
    if (hasOwn(data, 'dsfPages')) metadata.dsfPages = data.dsfPages;
    const languages = normalizeLanguages(data.dsfLangs);
    const defaultLang = languages.includes(data.defaultLang) ? data.defaultLang : languages[0];
    if (defaultLang) metadata.defaultLang = defaultLang;
    if (defaultLang && data.dsfPageCounts && Number.isInteger(data.dsfPageCounts[defaultLang])) {
        metadata.pageCount = data.dsfPageCounts[defaultLang];
    }
    return metadata;
}

export function resolveWorksDsfRelease(data, options = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Works release metadata must be an object.');
    }
    const uid = String(options.uid || data.authorUid || data.uid || '').trim();
    const workId = String(options.workId || data.workId || '').trim();
    const releaseId = String(options.releaseId || data.releaseId || '').trim();
    const transport = selectDsfPublicReleaseTransport(createTransportMetadata(data), {
        uid,
        workId,
        releaseId,
        allowedContentOrigins: Array.isArray(options.allowedContentOrigins)
            ? options.allowedContentOrigins
            : [],
    });

    if (transport.transportKind === 'horizon-v2') {
        const pageCount = transport.pageCounts[transport.defaultLang];
        return deepFreeze({
            releaseKind: 'horizon-v2',
            schemaVersion: 2,
            pageCount,
            languages: [...transport.languages],
            defaultLang: transport.defaultLang,
            deliveryFields: {
                dsfSchemaVersion: 2,
                dsfContentUrl: transport.contentUrl,
                dsfContentHash: transport.contentHash,
                dsfLangs: [...transport.languages],
                dsfPageCounts: { ...transport.pageCounts },
                dsfTotalBytes: transport.totalBytes,
                dsfPageCount: pageCount,
                defaultLang: transport.defaultLang,
                pageCount,
                dsfPages: [],
            },
        });
    }

    const languages = normalizeLanguages(data.dsfLangs?.length ? data.dsfLangs : data.languages);
    const defaultLang = languages.includes(data.defaultLang) ? data.defaultLang : (languages[0] || 'ja');
    return deepFreeze({
        releaseKind: 'webp-v1',
        schemaVersion: 1,
        pageCount: transport.pages.length,
        languages,
        defaultLang,
        deliveryFields: {
            dsfSchemaVersion: 1,
            dsfPages: transport.pages,
            dsfLangs: languages,
            dsfPageCount: transport.pages.length,
            defaultLang,
            pageCount: transport.pages.length,
        },
    });
}
