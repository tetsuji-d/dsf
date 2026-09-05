/**
 * Pure metadata contract for creating an owner-only Flow Horizon draft after
 * every immutable release file has been uploaded and sealed.
 *
 * This module does not import Firebase and cannot write Firestore by itself.
 */

import {
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND,
    FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION,
} from './flow-press-horizon-release-upload.js';
import {
    DSF_HORIZON_RELEASE_CONTRACT_VERSION,
    DSF_HORIZON_RELEASE_SEAL_KIND,
} from './dsf-horizon-release-contract.js';
import {
    CANONICAL_PAGE_HEIGHT,
    CANONICAL_PAGE_WIDTH,
} from './page-geometry.js';

export const FLOW_PRESS_HORIZON_DRAFT_WRITE_VERSION = 1;
export const FLOW_PRESS_HORIZON_DRAFT_WRITE_KIND = 'flow-press-horizon-draft-write';

const INPUT_KEYS = new Set([
    'upload',
    'projectId',
    'project',
    'publication',
    'bookConfig',
    'renderStamp',
    'thumbnail',
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FIRESTORE_DOCUMENT_ID_MAX_BYTES = 1_500;
const FIRESTORE_RESERVED_ID_PATTERN = /^__.*__$/;

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(deepClone);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepClone(nested)]));
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function fail(code, path, message) {
    throw new FlowPressHorizonDraftWriteError([{ severity: 'error', code, path, message }]);
}

function assertSafeId(value, path) {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
        fail('FLOW_HORIZON_DRAFT_ID_INVALID', path, `${path} must be a safe non-empty identifier.`);
    }
}

function assertFirestoreDocumentId(value, path) {
    if (typeof value !== 'string'
        || !value
        || value !== value.trim()
        || value !== value.normalize('NFC')
        || value.includes('/')
        || /[\u0000-\u001f\u007f]/.test(value)
        || FIRESTORE_RESERVED_ID_PATTERN.test(value)
        || new TextEncoder().encode(value).byteLength > FIRESTORE_DOCUMENT_ID_MAX_BYTES) {
        fail('FLOW_HORIZON_DRAFT_PROJECT_ID_INVALID', path, `${path} must be a valid Firestore document identifier.`);
    }
}

function normalizeString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeHttpsUrl(value) {
    const candidate = normalizeString(value);
    if (!candidate) return '';
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return '';
        return candidate;
    } catch {
        return '';
    }
}

function assertUpload(upload) {
    if (!isRecord(upload)
        || upload.executionVersion !== FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_VERSION
        || upload.executionKind !== FLOW_PRESS_HORIZON_UPLOAD_EXECUTION_KIND
        || upload.readyForMetadataWrite !== true
        || !isRecord(upload.identity)
        || !isRecord(upload.seal)
        || upload.seal.contractVersion !== DSF_HORIZON_RELEASE_CONTRACT_VERSION
        || upload.seal.contractKind !== DSF_HORIZON_RELEASE_SEAL_KIND
        || upload.seal.readyForMetadataWrite !== true
        || !isRecord(upload.seal.identity)
        || !isRecord(upload.seal.releaseMetadata)
        || !isRecord(upload.seal.publicLocator)) {
        fail('FLOW_HORIZON_DRAFT_UPLOAD_NOT_SEALED', 'upload', 'A complete Flow Horizon upload seal is required.');
    }
    for (const key of ['uid', 'workId', 'releaseId']) {
        assertSafeId(upload.identity[key], `upload.identity.${key}`);
        if (upload.identity[key] !== upload.seal.identity[key]) {
            fail('FLOW_HORIZON_DRAFT_IDENTITY_MISMATCH', `upload.seal.identity.${key}`, 'Upload execution and seal identities differ.');
        }
    }

    const metadata = upload.seal.releaseMetadata;
    const locator = upload.seal.publicLocator;
    const languages = metadata.dsfLangs;
    if (metadata.dsfSchemaVersion !== 2
        || !/^https:\/\//i.test(metadata.dsfContentUrl || '')
        || !HASH_PATTERN.test(metadata.dsfContentHash || '')
        || !Array.isArray(languages)
        || languages.length < 1
        || !isRecord(metadata.dsfPageCounts)
        || !Number.isSafeInteger(metadata.dsfTotalBytes)
        || metadata.dsfTotalBytes < 1) {
        fail('FLOW_HORIZON_DRAFT_METADATA_INVALID', 'upload.seal.releaseMetadata', 'The sealed DSF v2 release metadata is incomplete.');
    }
    const uniqueLanguages = new Set(languages);
    if (uniqueLanguages.size !== languages.length
        || languages.some((language) => typeof language !== 'string' || !language.trim())
        || languages.some((language) => !Number.isSafeInteger(metadata.dsfPageCounts[language]) || metadata.dsfPageCounts[language] < 1)) {
        fail('FLOW_HORIZON_DRAFT_PAGE_COUNTS_INVALID', 'upload.seal.releaseMetadata.dsfPageCounts', 'Every release language requires a positive page count.');
    }
    if (locator.dsfSchemaVersion !== metadata.dsfSchemaVersion
        || locator.dsfContentUrl !== metadata.dsfContentUrl
        || locator.dsfContentHash !== metadata.dsfContentHash
        || JSON.stringify(locator.dsfLangs) !== JSON.stringify(metadata.dsfLangs)
        || JSON.stringify(locator.dsfPageCounts) !== JSON.stringify(metadata.dsfPageCounts)
        || locator.dsfTotalBytes !== metadata.dsfTotalBytes
        || !uniqueLanguages.has(locator.defaultLang)
        || locator.pageCount !== metadata.dsfPageCounts[locator.defaultLang]) {
        fail('FLOW_HORIZON_DRAFT_LOCATOR_MISMATCH', 'upload.seal.publicLocator', 'The public locator does not exactly match the sealed release metadata.');
    }
    return { metadata, locator };
}

function normalizeBookConfig(bookConfig, pageCount) {
    if (!isRecord(bookConfig) || !isRecord(bookConfig.book)) {
        fail('FLOW_HORIZON_DRAFT_BOOK_INVALID', 'bookConfig', 'A normalized book configuration is required.');
    }
    const mode = normalizeString(bookConfig.bookMode || bookConfig.book.mode);
    if (!['none', 'simple', 'full'].includes(mode) || bookConfig.book.mode !== mode || !isRecord(bookConfig.book.covers)) {
        fail('FLOW_HORIZON_DRAFT_BOOK_INVALID', 'bookConfig', 'The book configuration is not normalized.');
    }
    for (const [key, cover] of Object.entries(bookConfig.book.covers)) {
        if (!['c1', 'c2', 'c3', 'c4'].includes(key)
            || !isRecord(cover)
            || !Number.isInteger(cover.pageIndex)
            || cover.pageIndex < 0
            || cover.pageIndex >= pageCount) {
            fail('FLOW_HORIZON_DRAFT_BOOK_INVALID', `bookConfig.book.covers.${key}`, 'Book cover indices must address the default-language release pages.');
        }
    }
    return { bookMode: mode, book: deepClone(bookConfig.book) };
}

export class FlowPressHorizonDraftWriteError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Flow Horizon draft metadata is invalid.');
        this.name = 'FlowPressHorizonDraftWriteError';
        this.code = 'DSF_FLOW_PRESS_HORIZON_DRAFT_WRITE_INVALID';
        this.issues = deepFreeze(Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : []);
    }
}

/** Build the exact owner metadata changes for one sealed Flow release. */
export function createFlowPressHorizonDraftWrite(input = {}) {
    if (!isRecord(input)) fail('FLOW_HORIZON_DRAFT_INPUT_INVALID', '', 'Flow Horizon draft input must be an object.');
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) fail('FLOW_HORIZON_DRAFT_PROPERTY_UNSUPPORTED', key, 'Flow Horizon draft input contains an unsupported property.');
    }
    const { metadata, locator } = assertUpload(input.upload);
    // projectId identifies the existing owner Firestore document and is not
    // interpolated into the immutable R2 release path. Preserve valid legacy
    // Firestore IDs instead of applying the narrower public delivery ID rule.
    assertFirestoreDocumentId(input.projectId, 'projectId');
    if (!isRecord(input.project)) fail('FLOW_HORIZON_DRAFT_PROJECT_INVALID', 'project', 'Project metadata is required.');
    if (!isRecord(input.publication)) fail('FLOW_HORIZON_DRAFT_PUBLICATION_INVALID', 'publication', 'Draft publication limits are required.');
    if (!Number.isSafeInteger(input.renderStamp) || input.renderStamp < 1) {
        fail('FLOW_HORIZON_DRAFT_RENDER_STAMP_INVALID', 'renderStamp', 'A positive render stamp is required.');
    }

    const identity = deepClone(input.upload.identity);
    const pageCount = locator.pageCount;
    const bookConfig = normalizeBookConfig(input.bookConfig, pageCount);
    const delivery = deepClone(metadata);
    const publication = deepClone(input.publication);
    const thumbnail = normalizeHttpsUrl(input.thumbnail);
    if (!thumbnail) {
        fail('FLOW_HORIZON_DRAFT_THUMBNAIL_INVALID', 'thumbnail', 'A verified HTTPS release thumbnail is required.');
    }
    const projectFields = {
        workId: identity.workId,
        releaseId: identity.releaseId,
        labelName: normalizeString(input.project.labelName),
        rating: normalizeString(input.project.rating, 'all') || 'all',
        license: normalizeString(input.project.license, 'all-rights-reserved') || 'all-rights-reserved',
        meta: isRecord(input.project.meta) ? deepClone(input.project.meta) : {},
        thumbnail,
        dsfPages: [],
        ...bookConfig,
        ...delivery,
        dsfPageCount: pageCount,
        dsfStatus: 'draft',
        publication,
        dsfRenderStamp: input.renderStamp,
        dsfResolution: `${CANONICAL_PAGE_WIDTH}x${CANONICAL_PAGE_HEIGHT}`,
        dsfQuality: 100,
        dsfQualityMode: 'fixed-layout-v2',
        dsfQualityProfile: { image: 100, text: 100 },
        visibility: 'private',
    };
    const authoringLanguages = Array.isArray(input.project.languages)
        ? [...new Set(input.project.languages.filter((language) => typeof language === 'string' && language.trim()))]
        : [...delivery.dsfLangs];
    const projectDefaultLang = normalizeString(input.project.defaultLang) || locator.defaultLang;

    return deepFreeze({
        writeVersion: FLOW_PRESS_HORIZON_DRAFT_WRITE_VERSION,
        writeKind: FLOW_PRESS_HORIZON_DRAFT_WRITE_KIND,
        readyForFirestoreWrite: true,
        identity,
        projectId: input.projectId,
        projectPatch: projectFields,
        workPatch: {
            workId: identity.workId,
            projectId: input.projectId,
            ownerUid: identity.uid,
            title: normalizeString(input.project.title),
            labelName: projectFields.labelName,
            rating: projectFields.rating,
            license: projectFields.license,
            meta: deepClone(projectFields.meta),
            thumbnail,
            languages: authoringLanguages.length ? authoringLanguages : [...delivery.dsfLangs],
            defaultLang: projectDefaultLang,
            latestReleaseId: identity.releaseId,
            latestProjectId: input.projectId,
            publication: deepClone(publication),
        },
        releaseDocument: {
            releaseId: identity.releaseId,
            workId: identity.workId,
            projectId: input.projectId,
            thumbnail,
            dsfPages: [],
            ...bookConfig,
            ...delivery,
            defaultLang: locator.defaultLang,
            pageCount,
            dsfStatus: 'draft',
            publication: deepClone(publication),
            dsfRenderStamp: input.renderStamp,
            dsfResolution: projectFields.dsfResolution,
            dsfQuality: projectFields.dsfQuality,
            dsfQualityMode: projectFields.dsfQualityMode,
            dsfQualityProfile: deepClone(projectFields.dsfQualityProfile),
        },
        publicIndexDocumentIds: [...new Set([identity.workId, input.projectId])],
        summary: {
            languageCount: delivery.dsfLangs.length,
            pageCount,
            totalBytes: delivery.dsfTotalBytes,
        },
    });
}

/** A retry may reuse a Release ID only when its immutable v2 locator is exact. */
export function assertCompatibleFlowPressHorizonRelease(existing, draft) {
    if (!existing) return true;
    if (!isRecord(existing) || !isRecord(draft) || draft.readyForFirestoreWrite !== true) {
        fail('FLOW_HORIZON_DRAFT_RETRY_INVALID', 'existingRelease', 'Existing release retry input is invalid.');
    }
    const expected = draft.releaseDocument;
    for (const key of [
        'releaseId',
        'workId',
        'projectId',
        'thumbnail',
        'dsfSchemaVersion',
        'dsfContentUrl',
        'dsfContentHash',
        'dsfTotalBytes',
    ]) {
        if (existing[key] !== expected[key]) {
            fail('FLOW_HORIZON_DRAFT_RELEASE_COLLISION', `existingRelease.${key}`, 'An existing Release ID points to different immutable content.');
        }
    }
    if (JSON.stringify(existing.dsfLangs) !== JSON.stringify(expected.dsfLangs)
        || JSON.stringify(existing.dsfPageCounts) !== JSON.stringify(expected.dsfPageCounts)) {
        fail('FLOW_HORIZON_DRAFT_RELEASE_COLLISION', 'existingRelease.dsfPageCounts', 'An existing Release ID has different language pages.');
    }
    return true;
}
