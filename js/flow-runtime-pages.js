/** Browser-only runtime pagination for persisted Project v6 Flow groups. */

import {
    FLOW_DOM_RENDERER_VERSION,
    createFlowDomPageMeasurer,
    resolveFlowDomTypography,
    waitForFlowFonts,
} from './flow-dom-measurer.js';
import { createIncrementalFlowPaginator } from './flow-incremental-pagination.js';
import { createCanonicalFlowPageBox } from './flow-pagination.js';
import { assertValidFlowProjectData } from './flow-project-model.js';
import { buildFlowPageProjection } from './flow-page-projection.js';
import { deepClone } from './utils.js';

const DEFAULT_MAX_PAGES_PER_GROUP = 2000;
const MAX_GROUP_CACHE_ENTRIES = 32;
const MAX_PROJECTION_CACHE_ENTRIES = 8;
const groupCache = new Map();
const projectionCache = new Map();
const selectedFlowPageByGroup = new Map();
const trackedFontDocuments = new WeakSet();
const fontEpochByDocument = new WeakMap();
const cacheIdentityByDocument = new WeakMap();
let nextDocumentCacheIdentity = 1;

export const FLOW_RUNTIME_INVALIDATED_EVENT = 'dsf:flow-runtime-invalidated';

export class FlowRuntimePageError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowRuntimePageError';
        this.code = code;
        this.context = context;
    }
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Flow runtime page generation was aborted.');
    error.name = 'AbortError';
    error.code = 'FLOW_RUNTIME_ABORTED';
    throw error;
}

function getFontEpoch(ownerDocument) {
    return fontEpochByDocument.get(ownerDocument) || 0;
}

function getDocumentCacheIdentity(ownerDocument) {
    if (!ownerDocument || (typeof ownerDocument !== 'object' && typeof ownerDocument !== 'function')) return 0;
    let identity = cacheIdentityByDocument.get(ownerDocument);
    if (!identity) {
        identity = nextDocumentCacheIdentity;
        nextDocumentCacheIdentity += 1;
        cacheIdentityByDocument.set(ownerDocument, identity);
    }
    return identity;
}

function trackFonts(ownerDocument) {
    if (!ownerDocument?.fonts || trackedFontDocuments.has(ownerDocument)) return;
    trackedFontDocuments.add(ownerDocument);
    fontEpochByDocument.set(ownerDocument, 0);
    const invalidate = () => {
        fontEpochByDocument.set(ownerDocument, getFontEpoch(ownerDocument) + 1);
        for (const [key, value] of groupCache.entries()) {
            if (value.ownerDocument === ownerDocument) groupCache.delete(key);
        }
        projectionCache.clear();
        const EventConstructor = ownerDocument.defaultView?.CustomEvent;
        if (EventConstructor) {
            ownerDocument.dispatchEvent(new EventConstructor(FLOW_RUNTIME_INVALIDATED_EVENT, {
                detail: Object.freeze({ reason: 'fonts', fontEpoch: getFontEpoch(ownerDocument) }),
            }));
        }
    };
    ownerDocument.fonts.addEventListener?.('loadingdone', invalidate);
    ownerDocument.fonts.addEventListener?.('loadingerror', invalidate);
}

function hasCompleteFlowLanguage(document, languageKey) {
    let sawTextBlock = false;
    for (const section of document?.sections || []) {
        for (const block of section?.blocks || []) {
            if (block?.type !== 'heading' && block?.type !== 'paragraph') continue;
            sawTextBlock = true;
            if (
                !block.texts
                || !Object.prototype.hasOwnProperty.call(block.texts, languageKey)
                || typeof block.texts[languageKey] !== 'string'
            ) return false;
        }
    }
    return sawTextBlock;
}

export function resolveFlowRuntimeLanguage(group, requestedLanguageKey) {
    const profiles = group?.flow?.layout?.typographyByLanguage || {};
    const requestedProfile = profiles[requestedLanguageKey];
    const sourceLanguage = String(group?.flow?.document?.sourceLanguage || '');
    const sourceProfile = profiles[sourceLanguage];
    const requestedHasText = hasCompleteFlowLanguage(group?.flow?.document, requestedLanguageKey);
    const requestedHasProfile = requestedProfile
        && typeof requestedProfile === 'object'
        && !Array.isArray(requestedProfile);

    if (requestedLanguageKey === sourceLanguage || (requestedHasText && requestedHasProfile)) {
        if (!requestedHasProfile) {
            throw new FlowRuntimePageError(
                'FLOW_LANGUAGE_TYPOGRAPHY_MISSING',
                `Flow typography is not available for ${requestedLanguageKey}.`,
                { groupId: group?.id, requestedLanguageKey, sourceLanguage },
            );
        }
        return Object.freeze({
            requestedLanguageKey,
            languageKey: requestedLanguageKey,
            profile: requestedProfile,
            isSourceFallback: false,
        });
    }

    if (requestedHasText && !requestedHasProfile) {
        throw new FlowRuntimePageError(
            'FLOW_LANGUAGE_TYPOGRAPHY_MISSING',
            `Flow typography is not available for translated language ${requestedLanguageKey}.`,
            { groupId: group?.id, requestedLanguageKey, sourceLanguage },
        );
    }
    if (!sourceProfile || typeof sourceProfile !== 'object' || Array.isArray(sourceProfile)) {
        throw new FlowRuntimePageError(
            'FLOW_LANGUAGE_TYPOGRAPHY_MISSING',
            `Flow typography is not available for ${requestedLanguageKey} or its source language.`,
            { groupId: group?.id, requestedLanguageKey, sourceLanguage },
        );
    }
    return Object.freeze({
        requestedLanguageKey,
        languageKey: sourceLanguage,
        profile: sourceProfile,
        isSourceFallback: true,
    });
}

function getGroupCacheKey(group, language, ownerDocument) {
    return JSON.stringify([
        FLOW_DOM_RENDERER_VERSION,
        getDocumentCacheIdentity(ownerDocument),
        getFontEpoch(ownerDocument),
        language.requestedLanguageKey,
        language.languageKey,
        group.id,
        group.flow,
    ]);
}

function getCachedGroup(cacheKey) {
    const cached = groupCache.get(cacheKey);
    if (!cached) return null;
    groupCache.delete(cacheKey);
    groupCache.set(cacheKey, cached);
    return cached;
}

function setCachedGroup(cacheKey, entry) {
    groupCache.set(cacheKey, entry);
    while (groupCache.size > MAX_GROUP_CACHE_ENTRIES) {
        groupCache.delete(groupCache.keys().next().value);
    }
}

function setCachedProjection(signature, projection) {
    projectionCache.delete(signature);
    projectionCache.set(signature, projection);
    while (projectionCache.size > MAX_PROJECTION_CACHE_ENTRIES) {
        projectionCache.delete(projectionCache.keys().next().value);
    }
}

function yieldToBrowser() {
    return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function waitForPromiseOrAbort(promise, signal) {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            const error = new Error('Flow runtime page generation was aborted.');
            error.name = 'AbortError';
            error.code = 'FLOW_RUNTIME_ABORTED';
            reject(error);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

async function paginateFlowGroup(group, options) {
    const { requestedLanguageKey, ownerDocument, signal } = options;
    const language = resolveFlowRuntimeLanguage(group, requestedLanguageKey);
    const { languageKey, profile } = language;
    const cacheKey = getGroupCacheKey(group, language, ownerDocument);
    const cached = getCachedGroup(cacheKey);
    if (cached) {
        return cached.result;
    }

    for (const [key, value] of groupCache.entries()) {
        if (value.groupId === group.id && value.requestedLanguageKey === requestedLanguageKey && key !== cacheKey) {
            groupCache.delete(key);
        }
    }
    const writingMode = String(profile.writingMode || 'horizontal-tb');
    const pageBox = createCanonicalFlowPageBox({ padding: group.flow.layout.padding });
    const typography = resolveFlowDomTypography(languageKey, profile, writingMode);
    await waitForPromiseOrAbort(
        waitForFlowFonts(ownerDocument, typography, writingMode, languageKey),
        signal,
    );
    throwIfAborted(signal);

    const measurer = createFlowDomPageMeasurer({
        ownerDocument,
        languageKey,
        writingMode,
        typography,
    });
    try {
        const paginator = createIncrementalFlowPaginator({
            pageBox,
            languageKey,
            writingMode,
            maxPages: options.maxPagesPerGroup || DEFAULT_MAX_PAGES_PER_GROUP,
            measurePage: measurer.measurePage,
            measurementKey: () => measurer.getLayoutKey(),
            getPageVariantKey: () => 'uniform',
        });
        const { pagination, changeSet } = await paginator.paginateAsync(group.flow.document, {
            revision: options.revision,
            signal,
            maxPagesPerChunk: options.maxPagesPerChunk || 1,
            chunkBudgetMs: options.chunkBudgetMs ?? 8,
            yieldScheduler: options.yieldScheduler || yieldToBrowser,
            onProgress(progress) {
                options.onProgress?.(Object.freeze({
                    ...progress,
                    groupId: group.id,
                    requestedLanguageKey,
                    languageKey,
                }));
            },
        });
        throwIfAborted(signal);
        const result = Object.freeze({
            groupId: group.id,
            documentId: group.flow.document.id,
            requestedLanguageKey,
            languageKey,
            isSourceFallback: language.isSourceFallback,
            pageBox,
            writingMode,
            typography,
            pagination,
            changeSet,
            metrics: measurer.getMetrics(),
        });
        const entry = Object.freeze({
            ownerDocument,
            groupId: group.id,
            requestedLanguageKey,
            languageKey,
            cacheKey,
            result,
        });
        setCachedGroup(cacheKey, entry);
        return result;
    } finally {
        measurer.dispose();
    }
}

export function createFlowRuntimeProjectionSignature(
    project,
    languageKey,
    fixedPages = [],
    ownerDocument = globalThis.document,
) {
    return JSON.stringify([
        FLOW_DOM_RENDERER_VERSION,
        getDocumentCacheIdentity(ownerDocument),
        String(languageKey || ''),
        Array.isArray(project?.blocks) ? project.blocks : [],
        Array.isArray(fixedPages) ? fixedPages : [],
    ]);
}

/** Generate a complete Fixed + Flow presentation list without mutating state. */
export async function createFlowRuntimePageProjection(project, options = {}) {
    assertValidFlowProjectData(project);
    const ownerDocument = options.ownerDocument || globalThis.document;
    if (!ownerDocument?.body) {
        throw new FlowRuntimePageError('DOM_REQUIRED', 'Flow runtime pagination requires a browser document.');
    }
    const blocks = deepClone(project.blocks);
    const fixedPages = deepClone(Array.isArray(options.fixedPages) ? options.fixedPages : []);
    const projectSnapshot = Object.freeze({
        version: project.version,
        defaultLang: project.defaultLang,
        blocks,
    });
    assertValidFlowProjectData(projectSnapshot);
    const requestedLanguageKey = String(options.languageKey || projectSnapshot.defaultLang || '');
    if (!requestedLanguageKey) {
        throw new FlowRuntimePageError('LANGUAGE_REQUIRED', 'A saved language key is required.');
    }
    const signal = options.signal;
    trackFonts(ownerDocument);
    throwIfAborted(signal);

    const flowResults = new Map();
    const signature = createFlowRuntimeProjectionSignature(
        projectSnapshot,
        requestedLanguageKey,
        fixedPages,
        ownerDocument,
    );
    const groups = blocks.filter((block) => block?.kind === 'flow');
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        throwIfAborted(signal);
        const group = groups[groupIndex];
        const result = await paginateFlowGroup(group, {
            ...options,
            ownerDocument,
            requestedLanguageKey,
            signal,
            revision: options.revision ?? 0,
            onProgress(progress) {
                options.onProgress?.(Object.freeze({
                    ...progress,
                    groupIndex,
                    groupCount: groups.length,
                }));
            },
        });
        flowResults.set(group.id, result);
    }
    throwIfAborted(signal);

    const projection = buildFlowPageProjection({
        blocks,
        fixedPages,
        flowResults,
        requestedLanguageKey,
    });
    const completed = Object.freeze({
        ...projection,
        signature,
    });
    setCachedProjection(signature, completed);
    return completed;
}

export function invalidateFlowRuntimePages() {
    groupCache.clear();
    projectionCache.clear();
    selectedFlowPageByGroup.clear();
}

export function getCachedFlowRuntimePageProjection(
    project,
    languageKey,
    fixedPages = [],
    ownerDocument = globalThis.document,
) {
    const key = String(languageKey || '');
    const signature = createFlowRuntimeProjectionSignature(project, key, fixedPages, ownerDocument);
    const cached = projectionCache.get(signature);
    if (!cached) return null;
    projectionCache.delete(signature);
    projectionCache.set(signature, cached);
    return cached;
}

export function getSelectedFlowRuntimePageIndex(groupId) {
    return selectedFlowPageByGroup.get(String(groupId || '')) || 0;
}

export function setSelectedFlowRuntimePageIndex(groupId, pageIndex, pageCount = Number.POSITIVE_INFINITY) {
    const key = String(groupId || '');
    const max = Number.isFinite(pageCount) ? Math.max(0, Number(pageCount) - 1) : Number.MAX_SAFE_INTEGER;
    const next = Math.max(0, Math.min(Number(pageIndex) || 0, max));
    selectedFlowPageByGroup.set(key, next);
    return next;
}
