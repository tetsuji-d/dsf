/**
 * Chrome Translator API adapter for plain semantic translation units.
 *
 * Flow PageBreaks are separate semantic blocks, so this adapter never copies
 * text between page slots. It preserves whitespace and protected tokens only.
 * Adapted from the verified Gen4 provider at d97e469.
 */

import { TranslationProviderError } from './translation-provider.js';

export const BROWSER_TRANSLATOR_PROVIDER_ID = 'chrome-translator';

const PROTECTED_TOKEN_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+|\{\{[^{}]+\}\}|\$\{[^{}]+\}|%[sdif]|\b[A-Z]{2,}[A-Z0-9-]*\d[A-Z0-9-]*\b)/g;

export function normalizeTranslatorLanguage(language) {
    const normalized = String(language || '').trim().replace(/_/g, '-');
    if (!normalized) return '';
    const lower = normalized.toLowerCase();
    if (lower === 'zh-hant' || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') {
        return 'zh-Hant';
    }
    if (lower === 'zh' || lower === 'zh-hans' || lower === 'zh-cn' || lower === 'zh-sg') {
        return 'zh';
    }
    if (lower === 'iw') return 'he';
    return lower.split('-')[0];
}

export function isBrowserTranslatorSupported(scope = globalThis) {
    return typeof scope?.Translator?.create === 'function';
}

async function translatePreservingWhitespace(value, translateSegment) {
    const source = String(value || '');
    if (!source.trim()) return source;
    const leading = source.match(/^\s*/)?.[0] || '';
    const withoutLeading = source.slice(leading.length);
    const trailing = withoutLeading.match(/\s*$/)?.[0] || '';
    const body = withoutLeading.slice(0, withoutLeading.length - trailing.length);
    if (!body) return source;
    const translated = await translateSegment(body);
    return `${leading}${String(translated || '').trim()}${trailing}`;
}

export async function translateProtectedText(value, translateSegment) {
    if (typeof translateSegment !== 'function') {
        throw new TranslationProviderError('A segment translator is required.', 'INVALID_SEGMENT_TRANSLATOR');
    }
    const source = String(value || '');
    const output = [];
    let cursor = 0;
    let match;
    PROTECTED_TOKEN_PATTERN.lastIndex = 0;
    while ((match = PROTECTED_TOKEN_PATTERN.exec(source)) !== null) {
        if (match.index > cursor) {
            output.push(await translatePreservingWhitespace(source.slice(cursor, match.index), translateSegment));
        }
        output.push(match[0]);
        cursor = PROTECTED_TOKEN_PATTERN.lastIndex;
    }
    if (cursor < source.length) {
        output.push(await translatePreservingWhitespace(source.slice(cursor), translateSegment));
    }
    return output.length ? output.join('') : translatePreservingWhitespace(source, translateSegment);
}

function createCancellationError(cause = null) {
    return new TranslationProviderError(
        'Translation was cancelled.',
        'TRANSLATION_CANCELLED',
        cause ? { cause } : {},
    );
}

function throwIfCancelled(signal) {
    if (signal?.aborted) throw createCancellationError(signal.reason);
}

function awaitWithSignal(value, signal) {
    if (!signal) return Promise.resolve(value);
    throwIfCancelled(signal);
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(createCancellationError(signal.reason));
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(value).then(
            (result) => {
                signal.removeEventListener('abort', onAbort);
                resolve(result);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

function mapBrowserTranslationError(error) {
    if (error instanceof TranslationProviderError) return error;
    const name = String(error?.name || '');
    if (name === 'AbortError') return createCancellationError(error);
    if (name === 'NotSupportedError') {
        return new TranslationProviderError(
            'This language pair is not supported by the browser.',
            'TRANSLATION_PAIR_UNAVAILABLE',
        );
    }
    if (name === 'NotAllowedError') {
        return new TranslationProviderError(
            'Start translation again from the translation button.',
            'TRANSLATION_USER_ACTIVATION_REQUIRED',
        );
    }
    return new TranslationProviderError(
        error?.message || String(error),
        'BROWSER_TRANSLATION_FAILED',
        { cause: error },
    );
}

export function createBrowserTranslationProvider(options = {}) {
    const translatorApi = options.Translator || globalThis?.Translator;
    const sessions = new Map();

    function getSession(sourceLanguage, targetLanguage, onProgress) {
        const key = `${sourceLanguage}:${targetLanguage}`;
        if (sessions.has(key)) return sessions.get(key);
        if (typeof translatorApi?.create !== 'function') {
            throw new TranslationProviderError(
                'The browser Translator API is unavailable.',
                'BROWSER_TRANSLATOR_UNAVAILABLE',
            );
        }

        onProgress?.({ phase: 'preparing', loaded: 0 });
        let sessionPromise;
        try {
            sessionPromise = Promise.resolve(translatorApi.create({
                sourceLanguage,
                targetLanguage,
                monitor(monitor) {
                    monitor.addEventListener('downloadprogress', (event) => {
                        onProgress?.({ phase: 'downloading', loaded: Number(event?.loaded) || 0 });
                    });
                },
            })).catch((error) => {
                sessions.delete(key);
                throw mapBrowserTranslationError(error);
            });
        } catch (error) {
            throw mapBrowserTranslationError(error);
        }
        sessions.set(key, sessionPromise);
        return sessionPromise;
    }

    return {
        id: BROWSER_TRANSLATOR_PROVIDER_ID,
        label: options.label || 'Chrome Translator',
        local: true,
        modelMode: 'fixed',
        defaultModelId: 'chrome-managed',
        defaultModelLabel: 'Chrome built-in model',
        async translate(request, context = {}) {
            const sourceLanguage = normalizeTranslatorLanguage(request?.sourceLang);
            const targetLanguage = normalizeTranslatorLanguage(request?.targetLang);
            if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) {
                throw new TranslationProviderError('Invalid browser translation language pair.', 'INVALID_LANGUAGE_PAIR');
            }
            const requestUnits = Array.isArray(request?.units) ? request.units : [];
            const hasText = requestUnits.some((unit) => String(unit?.text || '').trim());
            let session = null;
            if (hasText) {
                try {
                    session = await awaitWithSignal(
                        getSession(sourceLanguage, targetLanguage, context.onProgress),
                        context.signal,
                    );
                } catch (error) {
                    const mapped = mapBrowserTranslationError(error);
                    if (mapped.code === 'TRANSLATION_CANCELLED') return { units: [], cancelled: true };
                    throw mapped;
                }
            }

            const units = [];
            let cancelled = false;
            for (let index = 0; index < requestUnits.length; index += 1) {
                if (context.signal?.aborted) {
                    cancelled = true;
                    break;
                }
                const unit = requestUnits[index];
                context.onProgress?.({ phase: 'translating', current: index + 1, total: requestUnits.length });
                if (!String(unit.text || '').trim()) {
                    units.push({ unitId: unit.unitId, text: String(unit.text || ''), status: 'needs-review' });
                    continue;
                }
                try {
                    const text = await translateProtectedText(
                        unit.text,
                        (segment) => awaitWithSignal(session.translate(segment), context.signal),
                    );
                    units.push({ unitId: unit.unitId, text, status: 'needs-review' });
                } catch (error) {
                    const mapped = mapBrowserTranslationError(error);
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
