/** 9A-6C-A local-only Flow release assembly and payload-size planning. */

import { DSF_PRODUCTION_FONT_REGISTRY, validateDsfProductionFontRegistry } from './dsf-font-registry.js';
import { estimateDsfPortableReleaseSize } from './dsf-portable-release-estimate.js';
import { assembleDsfV2Release } from './dsf-release-assembly.js';
import { createDsfWebCryptoSha256 } from './dsf-release-byte-sealing.js';

export const FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION = 1;

const INPUT_KEYS = new Set([
    'preparation',
    'defaultLang',
    'languages',
    'pageDirections',
    'imageAssets',
    'fontRegistry',
    'hashBytes',
]);
const PAGE_DIRECTIONS = new Set(['ltr', 'rtl']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach((nested) => deepFreeze(nested, seen));
    return Object.freeze(value);
}

function createIssue(code, path, message, details = {}) {
    return { severity: 'error', code, path, message, ...details };
}

function fail(code, path, message, details = {}) {
    throw new FlowPressLocalReleasePlanningError([createIssue(code, path, message, details)]);
}

function normalizeLanguages(preparation, requested) {
    const available = new Map((preparation.languages || []).map((result) => [result?.language, result]));
    const source = Array.isArray(requested) && requested.length
        ? requested
        : [...available.keys()];
    const languages = [...new Set(source.map((language) => String(language || '').trim()).filter(Boolean))];
    if (!languages.length) fail('FLOW_LOCAL_RELEASE_LANGUAGES_MISSING', 'languages', 'At least one prepared language is required.');
    return { available, languages };
}

function validateInput(input) {
    if (!isRecord(input)) fail('FLOW_LOCAL_RELEASE_INPUT_INVALID', '', 'Local Flow release planning requires an input object.');
    for (const key of Object.keys(input)) {
        if (!INPUT_KEYS.has(key)) fail('FLOW_LOCAL_RELEASE_PROPERTY_UNSUPPORTED', key, 'Local release planning contains an unsupported property.');
    }
    const preparation = input.preparation;
    if (!isRecord(preparation)
        || preparation.preparationKind !== 'production'
        || preparation.ok !== true
        || !Array.isArray(preparation.languages)) {
        fail(
            'FLOW_LOCAL_RELEASE_PREPARATION_NOT_READY',
            'preparation',
            'A successful production Flow preparation result is required.',
        );
    }
    if (!isRecord(input.pageDirections)) {
        fail('FLOW_LOCAL_RELEASE_PAGE_DIRECTIONS_INVALID', 'pageDirections', 'Language page directions are required.');
    }
    if (!isRecord(input.imageAssets)) {
        fail('FLOW_LOCAL_RELEASE_IMAGE_ASSETS_INVALID', 'imageAssets', 'Language image asset maps are required.');
    }
    const registry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const registryValidation = validateDsfProductionFontRegistry(registry);
    if (!registryValidation.valid) {
        fail('FLOW_LOCAL_RELEASE_FONT_REGISTRY_INVALID', 'fontRegistry', 'Production font registry is invalid.', {
            validationIssues: registryValidation.issues,
        });
    }
    if (input.hashBytes !== undefined && typeof input.hashBytes !== 'function') {
        fail('FLOW_LOCAL_RELEASE_HASH_INVALID', 'hashBytes', 'hashBytes must be a function when supplied.');
    }
}

export class FlowPressLocalReleasePlanningError extends Error {
    constructor(issues) {
        super(issues?.[0]?.message || 'Flow Press local release planning failed.');
        this.name = 'FlowPressLocalReleasePlanningError';
        this.code = 'DSF_FLOW_PRESS_LOCAL_RELEASE_PLANNING_INVALID';
        this.issues = Array.isArray(issues) ? issues : [];
    }
}

/**
 * Assemble Horizon metadata from successful production preflights and actual
 * WebP descriptors, then estimate portable font overhead. Performs no I/O.
 */
export async function createFlowPressLocalReleasePlanning(input = {}) {
    validateInput(input);
    const preparation = input.preparation;
    const registry = input.fontRegistry || DSF_PRODUCTION_FONT_REGISTRY;
    const { available, languages } = normalizeLanguages(preparation, input.languages);
    const defaultLang = String(input.defaultLang || '').trim();
    if (!languages.includes(defaultLang)) {
        fail('FLOW_LOCAL_RELEASE_DEFAULT_LANGUAGE_MISSING', 'defaultLang', 'defaultLang must be one of the selected languages.');
    }

    const assemblyLanguages = languages.map((language) => {
        const result = available.get(language);
        if (!result || result.state !== 'ready' || result.preflight?.publishable !== true) {
            fail(
                'FLOW_LOCAL_RELEASE_LANGUAGE_NOT_READY',
                `preparation.languages.${language}`,
                'Every selected language must have a publishable production preflight.',
                { language },
            );
        }
        const pageDirection = input.pageDirections[language];
        if (!PAGE_DIRECTIONS.has(pageDirection)) {
            fail(
                'FLOW_LOCAL_RELEASE_PAGE_DIRECTION_INVALID',
                `pageDirections.${language}`,
                'Language page direction must be ltr or rtl.',
                { language },
            );
        }
        if (!isRecord(input.imageAssets[language])) {
            fail(
                'FLOW_LOCAL_RELEASE_LANGUAGE_IMAGE_ASSETS_MISSING',
                `imageAssets.${language}`,
                'Every selected language requires an explicit image asset map.',
                { language },
            );
        }
        return {
            language,
            pageDirection,
            preflight: result.preflight,
            imageAssets: input.imageAssets[language],
        };
    });

    const hashBytes = input.hashBytes || createDsfWebCryptoSha256();
    const assembly = await assembleDsfV2Release({
        defaultLang,
        languages: assemblyLanguages,
        hashBytes,
    });
    const portableEstimate = estimateDsfPortableReleaseSize({ assembly, fontRegistry: registry });

    return deepFreeze({
        planningVersion: FLOW_PRESS_LOCAL_RELEASE_PLANNING_VERSION,
        planningKind: 'local-only',
        ready: true,
        languages,
        assembly,
        portableEstimate,
        summary: {
            languageCount: assembly.summary.languageCount,
            pageCount: assembly.summary.pageCount,
            fixedTextPageCount: assembly.summary.fixedTextPageCount,
            imagePageCount: assembly.summary.imagePageCount,
            externalFontCount: assembly.summary.externalFontCount,
            horizonPayloadBytes: assembly.summary.totalBytes,
            portablePayloadBytes: portableEstimate.summary.totalBytes,
            portableAdditionalBytes: portableEstimate.summary.additionalBytes,
            portableFontBytes: portableEstimate.summary.fontByteLength,
            portableFontFileCount: portableEstimate.summary.fontFileCount,
        },
    });
}
