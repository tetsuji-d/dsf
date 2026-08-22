/**
 * Local LM Studio translation adapter.
 *
 * The endpoint and selected model are runtime device settings. They are never
 * written into Project, DSP, DSF, Firestore, or translationState. Adapted from
 * the verified Gen4 provider at d97e469 without fixed page-slot constraints.
 */

import { translateProtectedText } from './browser-translator-provider.js';
import { countGraphemes } from './grapheme.js';
import { TranslationProviderError } from './translation-provider.js';

export const LM_STUDIO_TRANSLATOR_PROVIDER_ID = 'lm-studio';
export const LM_STUDIO_DEFAULT_BASE_URL = 'http://127.0.0.1:1234';

function joinUrl(baseUrl, requestPath) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/${String(requestPath || '').replace(/^\/+/, '')}`;
}

function createProviderError(message, code, cause = null) {
    return new TranslationProviderError(message, code, cause ? { cause } : {});
}

async function parseJsonResponse(response, fallbackCode) {
    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    }
    if (!response.ok) {
        const detail = payload?.error?.message
            || payload?.message
            || `${response.status} ${response.statusText}`.trim();
        throw createProviderError(`LM Studio request failed: ${detail}`, fallbackCode);
    }
    return payload;
}

function readAssistantText(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((part) => typeof part === 'string' ? part : (part?.text || ''))
            .join('')
            .trim();
    }
    return '';
}

function isLikelyTextGenerationModel(model = {}) {
    const type = String(model.type || '').toLowerCase();
    if (type === 'embedding') return false;
    if (type === 'llm') return true;
    const capabilities = Array.isArray(model.capabilities)
        ? model.capabilities.map((value) => String(value || '').toLowerCase())
        : [];
    if (capabilities.some((value) => value.includes('embed'))
        && !capabilities.some((value) => /chat|completion|generate/.test(value))) return false;
    const identity = [model.id, model.key, model.name, model.display_name].filter(Boolean).join(' ');
    return !/(^|[-_\s/:.])(embed|embedding|rerank|clip)([-_\s/:.]|$)/i.test(identity);
}

function mapNativeModels(payload) {
    return (Array.isArray(payload?.models) ? payload.models : [])
        .filter(isLikelyTextGenerationModel)
        .map((model) => ({
            id: String(model?.key || model?.id || '').trim(),
            label: String(model?.display_name || model?.key || model?.id || '').trim(),
            detail: [model?.publisher, model?.params_string].filter(Boolean).join(' · '),
        }))
        .filter((model) => model.id);
}

function mapOpenAIModels(payload) {
    return (Array.isArray(payload?.data) ? payload.data : [])
        .filter(isLikelyTextGenerationModel)
        .map((model) => ({
            id: String(model?.id || '').trim(),
            label: String(model?.id || '').trim(),
            detail: String(model?.owned_by || '').trim(),
        }))
        .filter((model) => model.id);
}

function allocateSegmentBudgets(counts, totalBudget) {
    if (!counts.length) return [];
    const weights = counts.map((value) => Math.max(1, Number(value) || 1));
    let remainingBudget = Math.max(weights.length, Math.floor(Number(totalBudget) || 0));
    let remainingWeight = weights.reduce((sum, value) => sum + value, 0);
    return weights.map((weight, index) => {
        if (index === weights.length - 1) return Math.max(1, remainingBudget);
        const minimumForRest = weights.length - index - 1;
        const proportional = Math.max(1, Math.floor((remainingBudget * weight) / remainingWeight));
        const budget = Math.min(proportional, Math.max(1, remainingBudget - minimumForRest));
        remainingBudget -= budget;
        remainingWeight -= weight;
        return budget;
    });
}

function buildSystemPrompt(sourceLang, targetLang, constraints = {}) {
    const prompt = [
        'You are a faithful professional translation engine.',
        `Translate from ${sourceLang} to ${targetLang}.`,
        'Return only the translated text. Do not add explanations, labels, quotation marks, or Markdown fences.',
        'Preserve paragraph breaks. Do not summarize, omit, or add information.',
        'Keep names, product codes, variables, and URLs unchanged unless a natural-language name clearly requires transliteration.',
        'The target document may reflow to a different page count. Do not shorten text merely to match source pages.',
    ];
    const maxCharacters = Number(constraints?.maxCharacters);
    if (Number.isFinite(maxCharacters) && maxCharacters > 0) {
        prompt.push(
            `The complete translated unit should use at most ${Math.floor(maxCharacters)} Unicode grapheme clusters.`,
        );
        if (constraints?.strictLimit === true) {
            prompt.push(
                `STRICT OUTPUT LIMIT: This translated segment must contain at most ${Math.floor(maxCharacters)} Unicode grapheme clusters.`,
                'Rewrite compactly, but preserve every fact and required term.',
            );
        }
        const previousCharacterCount = Number(constraints?.previousCharacterCount);
        if (Number.isFinite(previousCharacterCount) && previousCharacterCount > maxCharacters) {
            prompt.push(`The previous attempt used ${Math.floor(previousCharacterCount)} grapheme clusters and was too long. Shorten it.`);
        }
    }
    const protectedTerms = Array.isArray(constraints?.protectedTerms)
        ? constraints.protectedTerms.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (protectedTerms.length) {
        prompt.push(`Keep these terms exactly unchanged: ${protectedTerms.map((item) => JSON.stringify(item)).join(', ')}.`);
    }
    const glossary = Array.isArray(constraints?.glossary)
        ? constraints.glossary.filter((item) => item?.source && item?.target)
        : [];
    if (glossary.length) {
        prompt.push('Use these required translations: '
            + glossary.map((item) => `${JSON.stringify(String(item.source))} => ${JSON.stringify(String(item.target))}`).join('; ')
            + '.');
    }
    const instructions = String(constraints?.instructions || '').trim();
    if (instructions) prompt.push(`Additional translation constraint: ${instructions}`);
    return prompt.join(' ');
}

function createCancellationError(cause = null) {
    return createProviderError('Translation was cancelled.', 'TRANSLATION_CANCELLED', cause);
}

function mapConnectionError(error, options = {}) {
    if (error instanceof TranslationProviderError) return error;
    if (options.cancelled) return createCancellationError(error);
    if (options.timedOut || error?.name === 'AbortError') {
        return createProviderError(
            'LM Studio did not respond before the request timed out.',
            'LM_STUDIO_TIMEOUT',
            error,
        );
    }
    return createProviderError(
        'LM Studio could not be reached at the local address. Start its local server and enable CORS.',
        'LM_STUDIO_UNREACHABLE',
        error,
    );
}

export function createLMStudioTranslationProvider(options = {}) {
    const fetchImpl = options.fetch || globalThis?.fetch?.bind(globalThis);
    const baseUrl = String(options.baseUrl || LM_STUDIO_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 120000);

    async function request(requestPath, init = {}, externalSignal = null) {
        if (typeof fetchImpl !== 'function') {
            throw createProviderError('Fetch is unavailable in this browser.', 'LM_STUDIO_UNREACHABLE');
        }
        if (externalSignal?.aborted) throw createCancellationError(externalSignal.reason);
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timedOut = false;
        const onExternalAbort = () => controller?.abort(externalSignal?.reason);
        externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
        const timer = controller ? setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs) : null;
        try {
            return await fetchImpl(joinUrl(baseUrl, requestPath), {
                ...init,
                signal: controller?.signal || externalSignal || undefined,
                headers: {
                    Accept: 'application/json',
                    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(init.headers || {}),
                },
            });
        } catch (error) {
            throw mapConnectionError(error, {
                cancelled: externalSignal?.aborted === true,
                timedOut,
            });
        } finally {
            if (timer) clearTimeout(timer);
            externalSignal?.removeEventListener?.('abort', onExternalAbort);
        }
    }

    async function translateSegment(text, requestData) {
        const response = await request('/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({
                model: requestData.modelId,
                temperature: 0,
                stream: false,
                messages: [
                    {
                        role: 'system',
                        content: buildSystemPrompt(
                            requestData.sourceLang,
                            requestData.targetLang,
                            requestData.constraints,
                        ),
                    },
                    { role: 'user', content: String(text || '') },
                ],
            }),
        }, requestData.signal);
        const payload = await parseJsonResponse(response, 'LM_STUDIO_TRANSLATION_FAILED');
        const translated = readAssistantText(payload);
        if (!translated) {
            throw createProviderError('LM Studio returned no translated text.', 'LM_STUDIO_INVALID_RESPONSE');
        }
        return translated;
    }

    async function translateAttempt(sourceText, requestData, strictBudgets = [], previousCharacterCount = 0) {
        const segmentCounts = [];
        let segmentIndex = 0;
        const text = await translateProtectedText(sourceText, async (segment) => {
            const budget = Number(strictBudgets[segmentIndex]);
            const constraints = Number.isFinite(budget) && budget > 0
                ? {
                    ...(requestData.constraints || {}),
                    maxCharacters: Math.floor(budget),
                    strictLimit: true,
                    previousCharacterCount,
                }
                : requestData.constraints;
            const translated = await translateSegment(segment, { ...requestData, constraints });
            segmentCounts.push(countGraphemes(translated, requestData.targetLang));
            segmentIndex += 1;
            return translated;
        });
        return { text, segmentCounts };
    }

    async function translateUnit(sourceText, requestData) {
        const source = String(sourceText || '');
        if (!source.trim()) return source;
        let attempt = await translateAttempt(source, requestData);
        const maxCharacters = Number(requestData.constraints?.maxCharacters);
        if (!Number.isFinite(maxCharacters) || maxCharacters <= 0) return attempt.text;

        for (let retry = 0; retry < 2; retry += 1) {
            const characterCount = countGraphemes(attempt.text, requestData.targetLang);
            if (characterCount <= maxCharacters) return attempt.text;
            const translatedCount = attempt.segmentCounts.reduce((sum, value) => sum + value, 0);
            const fixedCount = Math.max(0, characterCount - translatedCount);
            const segmentBudget = Math.max(attempt.segmentCounts.length, maxCharacters - fixedCount);
            attempt = await translateAttempt(
                source,
                requestData,
                allocateSegmentBudgets(attempt.segmentCounts, segmentBudget),
                characterCount,
            );
        }
        return attempt.text;
    }

    return {
        id: LM_STUDIO_TRANSLATOR_PROVIDER_ID,
        label: options.label || 'LM Studio',
        local: true,
        modelMode: 'discoverable',
        supportsConstraints: true,
        async listModels() {
            try {
                const nativeResponse = await request('/api/v1/models');
                const nativePayload = await parseJsonResponse(nativeResponse, 'LM_STUDIO_MODEL_DISCOVERY_FAILED');
                const nativeModels = mapNativeModels(nativePayload);
                if (nativeModels.length || Array.isArray(nativePayload?.models)) return nativeModels;
            } catch (_) {
                // Older LM Studio releases do not expose the native endpoint.
            }
            const response = await request('/v1/models');
            const payload = await parseJsonResponse(response, 'LM_STUDIO_MODEL_DISCOVERY_FAILED');
            return mapOpenAIModels(payload);
        },
        async translate(translationRequest, context = {}) {
            const modelId = String(translationRequest?.modelId || '').trim();
            if (!modelId) {
                throw createProviderError(
                    'Select an LM Studio model before translating.',
                    'LM_STUDIO_MODEL_REQUIRED',
                );
            }
            const requestUnits = Array.isArray(translationRequest?.units) ? translationRequest.units : [];
            const units = [];
            let cancelled = false;
            for (let index = 0; index < requestUnits.length; index += 1) {
                if (context.signal?.aborted) {
                    cancelled = true;
                    break;
                }
                const unit = requestUnits[index];
                context.onProgress?.({ phase: 'translating', current: index + 1, total: requestUnits.length });
                try {
                    const text = await translateUnit(unit.text, {
                        modelId,
                        sourceLang: translationRequest.sourceLang,
                        targetLang: translationRequest.targetLang,
                        constraints: translationRequest.constraints,
                        signal: context.signal,
                    });
                    units.push({ unitId: unit.unitId, text, status: 'needs-review' });
                } catch (error) {
                    const mapped = mapConnectionError(error, {
                        cancelled: context.signal?.aborted === true,
                    });
                    if (mapped.code === 'TRANSLATION_CANCELLED') {
                        cancelled = true;
                        break;
                    }
                    units.push({
                        unitId: unit.unitId,
                        text: '',
                        status: 'error',
                        error: mapped.message,
                    });
                }
            }
            context.onProgress?.({
                phase: cancelled ? 'cancelled' : 'complete',
                current: units.length,
                total: requestUnits.length,
            });
            return { units, cancelled };
        },
    };
}
