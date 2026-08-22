/**
 * Runtime-only translation provider registry and response contract.
 *
 * Provider selection, model IDs, endpoints, progress, and cancellation are
 * deliberately not Project data. Callers own UI state and persistence.
 */

import { deepClone } from './utils.js';

const providers = new Map();
const PROVIDER_UNIT_STATUSES = new Set(['translated', 'needs-review', 'error']);

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKey(value, label) {
    const key = String(value || '');
    if (!key || key !== key.trim()) {
        throw new TranslationProviderError(`${label} must be a non-empty exact key.`, 'INVALID_PROVIDER_REQUEST');
    }
    return key;
}

function normalizeStringList(value, maxItems = 100) {
    const items = Array.isArray(value) ? value : [];
    const seen = new Set();
    return items
        .map((item) => String(item || '').trim().slice(0, 160))
        .filter((item) => {
            if (!item || seen.has(item) || seen.size >= maxItems) return false;
            seen.add(item);
            return true;
        });
}

function normalizeGlossary(value) {
    const items = Array.isArray(value) ? value : [];
    const seen = new Set();
    return items
        .map((item) => ({
            source: String(item?.source || '').trim().slice(0, 160),
            target: String(item?.target || '').trim().slice(0, 160),
        }))
        .filter((item) => {
            const key = item.source.toLocaleLowerCase();
            if (!item.source || !item.target || seen.has(key) || seen.size >= 100) return false;
            seen.add(key);
            return true;
        });
}

function listRequestUnitIds(request) {
    const units = Array.isArray(request?.units) ? request.units : [];
    const seen = new Set();
    return units.map((unit) => {
        const unitId = requireExactKey(unit?.unitId, 'Translation unit ID');
        if (seen.has(unitId)) {
            throw new TranslationProviderError(`Duplicate translation unit ID: ${unitId}`, 'INVALID_PROVIDER_REQUEST');
        }
        seen.add(unitId);
        if (typeof unit?.text !== 'string') {
            throw new TranslationProviderError(`Translation unit ${unitId} must contain text.`, 'INVALID_PROVIDER_REQUEST');
        }
        return unitId;
    });
}

export class TranslationProviderError extends Error {
    constructor(message, code = 'TRANSLATION_PROVIDER_ERROR', details = {}) {
        super(message);
        this.name = 'TranslationProviderError';
        this.code = code;
        Object.assign(this, details);
    }
}

export function registerTranslationProvider(id, provider) {
    const providerId = String(id || '').trim();
    if (!providerId) {
        throw new TranslationProviderError('Translation provider ID is required.', 'INVALID_PROVIDER_ID');
    }
    if (!provider || typeof provider.translate !== 'function') {
        throw new TranslationProviderError('Translation provider must implement translate(request).', 'INVALID_PROVIDER');
    }
    providers.set(providerId, { ...provider, id: providerId });
    return () => providers.delete(providerId);
}

export function listTranslationProviders() {
    return [...providers.values()].map((provider) => ({
        id: provider.id,
        label: provider.label || provider.id,
        local: provider.local === true,
        modelMode: provider.modelMode === 'discoverable' ? 'discoverable' : 'fixed',
        defaultModelId: String(provider.defaultModelId || ''),
        defaultModelLabel: String(provider.defaultModelLabel || ''),
        supportsConstraints: provider.supportsConstraints === true,
    }));
}

export function getTranslationProvider(id) {
    return providers.get(String(id || '')) || null;
}

export async function listTranslationProviderModels(id, context = {}) {
    const provider = getTranslationProvider(id);
    if (!provider) {
        throw new TranslationProviderError('Translation provider is not configured.', 'PROVIDER_NOT_CONFIGURED');
    }
    if (provider.modelMode !== 'discoverable') {
        const modelId = String(provider.defaultModelId || 'provider-managed');
        return [{
            id: modelId,
            label: String(provider.defaultModelLabel || provider.label || modelId),
        }];
    }
    if (typeof provider.listModels !== 'function') {
        throw new TranslationProviderError(
            'Translation provider cannot list models.',
            'PROVIDER_MODEL_DISCOVERY_UNAVAILABLE',
        );
    }

    const rawModels = await provider.listModels(context);
    const seen = new Set();
    return (Array.isArray(rawModels) ? rawModels : [])
        .map((model) => ({
            id: String(model?.id || model?.name || '').trim(),
            label: String(model?.label || model?.id || model?.name || '').trim(),
            detail: String(model?.detail || '').trim(),
        }))
        .filter((model) => {
            if (!model.id || seen.has(model.id)) return false;
            seen.add(model.id);
            return true;
        });
}

export function normalizeTranslationConstraints(value = {}) {
    const input = isRecord(value) ? value : {};
    const maxCharacters = Number(input.maxCharacters);
    return {
        ...input,
        protectedTerms: normalizeStringList(input.protectedTerms),
        glossary: normalizeGlossary(input.glossary),
        instructions: String(input.instructions || '').trim().slice(0, 1200),
        maxCharacters: Number.isFinite(maxCharacters) && maxCharacters > 0
            ? Math.floor(maxCharacters)
            : null,
        preserveSemanticStructure: input.preserveSemanticStructure !== false,
        allowTargetPageCountChange: input.allowTargetPageCountChange !== false,
    };
}

export function normalizeTranslationProviderResponse(response, request, options = {}) {
    const requestedIds = listRequestUnitIds(request);
    const requested = new Set(requestedIds);
    const rawUnits = Array.isArray(response) ? response : response?.units;
    if (!Array.isArray(rawUnits)) {
        throw new TranslationProviderError('Translation provider returned no units.', 'INVALID_PROVIDER_RESPONSE');
    }

    const seen = new Set();
    const units = rawUnits.map((unit) => {
        const unitId = requireExactKey(unit?.unitId, 'Provider result unit ID');
        if (!requested.has(unitId)) {
            throw new TranslationProviderError(
                `Translation provider returned an unknown unit: ${unitId}`,
                'INVALID_PROVIDER_RESPONSE',
            );
        }
        if (seen.has(unitId)) {
            throw new TranslationProviderError(
                `Translation provider returned duplicate unit: ${unitId}`,
                'INVALID_PROVIDER_RESPONSE',
            );
        }
        seen.add(unitId);
        const status = PROVIDER_UNIT_STATUSES.has(unit?.status) ? unit.status : 'needs-review';
        if (status !== 'error' && typeof unit?.text !== 'string') {
            throw new TranslationProviderError(
                `Translation provider result ${unitId} must contain text.`,
                'INVALID_PROVIDER_RESPONSE',
            );
        }
        return {
            unitId,
            text: typeof unit?.text === 'string' ? unit.text : '',
            status,
            error: status === 'error'
                ? String(unit?.error || 'Translation provider failed for this unit.')
                : '',
        };
    });

    const cancelled = response?.cancelled === true || options.cancelled === true;
    const missingUnitIds = requestedIds.filter((unitId) => !seen.has(unitId));
    if (missingUnitIds.length && !cancelled && options.allowPartial !== true) {
        throw new TranslationProviderError(
            `Translation provider omitted ${missingUnitIds.length} requested unit(s).`,
            'INVALID_PROVIDER_RESPONSE',
            { missingUnitIds },
        );
    }
    return { units, cancelled, missingUnitIds };
}

function isCancellation(error, signal) {
    return signal?.aborted === true
        || error?.code === 'TRANSLATION_CANCELLED'
        || error?.name === 'AbortError';
}

export async function runTranslationProvider(request, options = {}) {
    const provider = isRecord(options.provider)
        ? options.provider
        : getTranslationProvider(options.providerId);
    if (!provider || typeof provider.translate !== 'function') {
        throw new TranslationProviderError('Translation provider is not configured.', 'PROVIDER_NOT_CONFIGURED');
    }
    requireExactKey(request?.sourceLang, 'Source language');
    requireExactKey(request?.targetLang, 'Target language');
    if (request.sourceLang === request.targetLang) {
        throw new TranslationProviderError('Target language must differ from source language.', 'INVALID_LANGUAGE_PAIR');
    }
    const requestedUnitIds = listRequestUnitIds(request);
    if (!requestedUnitIds.length) {
        return {
            providerId: provider.id || options.providerId || '',
            modelId: String(request?.modelId || ''),
            units: [],
            cancelled: false,
            missingUnitIds: [],
        };
    }
    if (options.signal?.aborted) {
        return {
            providerId: provider.id || options.providerId || '',
            modelId: String(request?.modelId || ''),
            units: [],
            cancelled: true,
            missingUnitIds: requestedUnitIds,
        };
    }

    try {
        const response = await provider.translate(deepClone(request), {
            onProgress: typeof options.onProgress === 'function' ? options.onProgress : null,
            signal: options.signal || null,
        });
        const cancelled = response?.cancelled === true || options.signal?.aborted === true;
        const normalized = normalizeTranslationProviderResponse(response, request, {
            allowPartial: cancelled,
            cancelled,
        });
        return {
            providerId: provider.id || options.providerId || '',
            modelId: String(request?.modelId || ''),
            ...normalized,
        };
    } catch (error) {
        if (isCancellation(error, options.signal)) {
            return {
                providerId: provider.id || options.providerId || '',
                modelId: String(request?.modelId || ''),
                units: [],
                cancelled: true,
                missingUnitIds: requestedUnitIds,
            };
        }
        if (error instanceof TranslationProviderError) throw error;
        throw new TranslationProviderError(
            error?.message || String(error),
            error?.code || 'TRANSLATION_FAILED',
            { cause: error },
        );
    }
}
