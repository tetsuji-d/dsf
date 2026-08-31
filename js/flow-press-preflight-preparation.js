/**
 * Shared Flow Press preparation pipeline.
 *
 * The caller supplies both a certified font registry and an explicit
 * typography-to-font resolver. This module never chooses development fixtures,
 * assembles a release, estimates bytes, persists data, or publishes anything.
 */

import { createDsfPressPreflight } from './dsf-press-preflight.js';
import { resolveFlowDomTypography } from './flow-dom-measurer.js';
import {
    createFlowPublicationCompositionCaptureSession,
} from './flow-publication-composition-capture.js';
import { projectFlowPaginationToDsfV2 } from './flow-publication-projection.js';
import { deriveFlowTranslationStatus } from './flow-translation-state.js';
import { deepClone } from './utils.js';

export const FLOW_PRESS_PREFLIGHT_PREPARATION_VERSION = 1;

function createIssue(code, message, context = {}) {
    return Object.freeze({
        code: String(code || 'FLOW_PUBLICATION_PREPARATION_FAILED'),
        message: String(message || 'Flow publication preparation failed.'),
        ...context,
    });
}

function throwIfAborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('Flow Press preparation was aborted.');
    error.name = 'AbortError';
    error.code = 'FLOW_PRESS_PREFLIGHT_PREPARATION_ABORTED';
    throw error;
}

function normalizeLanguages(project, languages) {
    const source = Array.isArray(languages) && languages.length
        ? languages
        : (Array.isArray(project?.languages) && project.languages.length
            ? project.languages
            : [project?.defaultLang || 'ja']);
    return [...new Set(source.map((language) => String(language || '').trim()).filter(Boolean))];
}

function getProjectionFailureIssue(projection, groupId, language) {
    const blocked = projection?.publicationBlocked || projection?.fallback;
    return createIssue(
        blocked?.code || 'FLOW_PUBLICATION_PROJECTION_FAILED',
        blocked?.message || 'Flow fixed-text projection could not be created.',
        { groupId, language, details: blocked?.details || null },
    );
}

function getFontFailureIssue(resolution, groupId, language, writingMode, fontFamily) {
    return createIssue(
        resolution?.code || 'FLOW_PUBLICATION_FONT_UNAVAILABLE',
        resolution?.message || 'No certified font matches this Flow typography.',
        {
            groupId,
            language,
            writingMode,
            fontFamily,
            details: resolution || null,
        },
    );
}

/** Prepare every saved language without mutating the authoring project. */
export async function prepareFlowPressPreflight(options = {}) {
    const project = options.project;
    if (!project || !Array.isArray(project.blocks)) {
        throw new TypeError('Flow Press preparation requires a Project v6 block list.');
    }
    const revision = Number(options.revision);
    if (!Number.isInteger(revision) || revision < 0) {
        throw new TypeError('Flow Press preparation requires a non-negative revision.');
    }
    if (!options.fontRegistry || typeof options.fontRegistry !== 'object') {
        throw new TypeError('Flow Press preparation requires an explicit certified font registry.');
    }
    if (typeof options.resolveFont !== 'function') {
        throw new TypeError('Flow Press preparation requires an explicit font resolver.');
    }
    const ownerDocument = options.documentRef || globalThis.document;
    const maxPagesPerGroup = Number.isInteger(options.maxPagesPerGroup) && options.maxPagesPerGroup > 0
        ? options.maxPagesPerGroup
        : 2000;
    const dependencies = options.dependencies || {};
    const createCaptureSession = dependencies.createCaptureSession
        || createFlowPublicationCompositionCaptureSession;
    const projectFlow = dependencies.projectFlow || projectFlowPaginationToDsfV2;
    const createPreflight = dependencies.createPreflight || createDsfPressPreflight;
    const deriveTranslationStatus = dependencies.deriveTranslationStatus
        || deriveFlowTranslationStatus;
    const resolveTypography = dependencies.resolveTypography || resolveFlowDomTypography;
    const flowGroups = project.blocks.filter((block) => block?.kind === 'flow');
    // Keep font resolution, capture and strict projection on one settings snapshot.
    const languageConfigs = deepClone(project.languageConfigs || {});
    const languages = normalizeLanguages(project, options.languages);
    const languageResults = [];

    for (const [languageIndex, language] of languages.entries()) {
        throwIfAborted(options.signal);
        const flowPublicationProjections = {};
        const flowPublicationRevisions = {};
        const groupResults = [];
        const preparationIssues = [];

        for (const [groupIndex, group] of flowGroups.entries()) {
            throwIfAborted(options.signal);
            flowPublicationRevisions[group.id] = revision;
            options.onProgress?.(Object.freeze({
                language,
                languageIndex,
                languageCount: languages.length,
                groupId: group.id,
                groupIndex,
                groupCount: flowGroups.length,
            }));
            let session = null;
            let fontLease = null;
            try {
                const translationStatus = deriveTranslationStatus(group, language);
                if (!translationStatus.isSourceLanguage && translationStatus.requiresSourceFallback) {
                    throw createIssue(
                        'FLOW_PUBLICATION_TRANSLATION_NOT_READY',
                        'Flow translation is missing or stale.',
                        { groupId: group.id, language, translationStatus },
                    );
                }
                const profile = group.flow?.layout?.typographyByLanguage?.[language];
                const writingMode = String(profile?.writingMode || 'horizontal-tb');
                const typography = resolveTypography(language, profile || {}, writingMode, { languageConfigs });
                const fontResolution = await options.resolveFont(
                    typography.fontFamily,
                    language,
                    writingMode,
                    { typography, group, languageConfigs, fontRegistry: options.fontRegistry },
                );
                if (!fontResolution?.fontId) {
                    throw getFontFailureIssue(
                        fontResolution,
                        group.id,
                        language,
                        writingMode,
                        typography.fontFamily,
                    );
                }
                if (typeof options.prepareFont === 'function') {
                    fontLease = await options.prepareFont({
                        ownerDocument,
                        group,
                        language,
                        writingMode,
                        typography,
                        fontRegistry: options.fontRegistry,
                        fontResolution,
                        signal: options.signal,
                    });
                    if (!fontLease?.runtimeFontFamily || typeof fontLease.dispose !== 'function') {
                        throw createIssue(
                            'FONT_RUNTIME_LEASE_INVALID',
                            'Verified production font runtime lease is invalid.',
                            { groupId: group.id, language, fontId: fontResolution.fontId },
                        );
                    }
                    throwIfAborted(options.signal);
                }
                session = await createCaptureSession({
                    ownerDocument,
                    flowGroup: group,
                    language,
                    languageConfigs,
                    revision,
                    fontRegistry: options.fontRegistry,
                    fontId: fontResolution.fontId,
                    ...(fontLease ? { runtimeFontFamily: fontLease.runtimeFontFamily } : {}),
                });
                throwIfAborted(options.signal);
                const pagination = session.paginate({ maxPages: maxPagesPerGroup });
                const compositionSnapshot = session.capture(pagination);
                const projection = projectFlow({
                    flowGroup: group,
                    language,
                    languageConfigs,
                    revision,
                    pagination,
                    compositionSnapshot,
                    fontRegistry: options.fontRegistry,
                    fontId: fontResolution.fontId,
                    pageIds: pagination.pages.map((_, pageIndex) => (
                        `press-preflight:${language}:${group.id}:${String(pageIndex + 1).padStart(5, '0')}`
                    )),
                    pageLabels: pagination.pages.map((_, pageIndex) => String(pageIndex + 1)),
                });
                if (!projection?.ok) throw getProjectionFailureIssue(projection, group.id, language);
                flowPublicationProjections[group.id] = projection;
                groupResults.push(Object.freeze({
                    groupId: group.id,
                    language,
                    state: 'ready',
                    pageCount: projection.summary.pageCount,
                    lineCount: projection.summary.lineCount,
                    fontId: fontResolution.fontId,
                    fontAssetSha256: fontLease?.evidence?.sha256 || null,
                    projection,
                }));
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                const issue = error?.code && error?.message
                    ? createIssue(error.code, error.message, {
                        groupId: error.groupId || error.context?.groupId || group.id,
                        language: error.language || error.context?.language || language,
                        details: error.details || error.context || null,
                    })
                    : createIssue('FLOW_PUBLICATION_PREPARATION_FAILED', error?.message || String(error), {
                        groupId: group.id,
                        language,
                    });
                preparationIssues.push(issue);
                groupResults.push(Object.freeze({
                    groupId: group.id,
                    language,
                    state: 'blocked',
                    issue,
                }));
            } finally {
                session?.dispose?.();
                fontLease?.dispose?.();
            }
        }

        const preflight = createPreflight({
            blocks: project.blocks,
            language,
            flowPublicationProjections,
            flowPublicationRevisions,
            fontRegistry: options.fontRegistry,
        });
        languageResults.push(Object.freeze({
            language,
            state: preparationIssues.length === 0 && preflight.publishable ? 'ready' : 'blocked',
            groupResults: Object.freeze(groupResults),
            preparationIssues: Object.freeze(preparationIssues),
            preflight,
        }));
    }

    return Object.freeze({
        ok: languageResults.every((result) => result.state === 'ready'),
        preparationVersion: FLOW_PRESS_PREFLIGHT_PREPARATION_VERSION,
        preparationKind: String(options.preparationKind || 'unspecified'),
        revision,
        flowGroupCount: flowGroups.length,
        languages: Object.freeze(languageResults),
    });
}
