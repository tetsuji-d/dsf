/**
 * Pure language and typography capabilities for Flow Layout.
 *
 * Normalized language tags are for internal lookup only. Persisted project
 * keys must not be rewritten without a separate schema migration.
 * The profile intentionally excludes page capacity and certified font assets;
 * those belong to pagination and publication integration respectively.
 */

const LANGUAGE_ALIASES = Object.freeze({
    en: 'en',
    'en-us': 'en-US',
    'en-gb': 'en-GB',
    fr: 'fr',
    'fr-fr': 'fr-FR',
    'fr-ca': 'fr-CA',
    es: 'es',
    'es-es': 'es-ES',
    'es-mx': 'es-MX',
    de: 'de',
    'de-de': 'de-DE',
    'de-at': 'de-AT',
    'de-ch': 'de-CH',
    pt: 'pt',
    'pt-br': 'pt-BR',
    'pt-pt': 'pt-PT',
    ja: 'ja',
    jp: 'ja',
    ko: 'ko',
    kr: 'ko',
    zh: 'zh-Hans',
    'zh-cn': 'zh-Hans',
    'zh-sg': 'zh-Hans',
    'zh-hans': 'zh-Hans',
    'zh-tw': 'zh-Hant',
    'zh-hk': 'zh-Hant',
    'zh-mo': 'zh-Hant',
    'zh-hant': 'zh-Hant',
});

export const DEFAULT_FLOW_WRITING_MODE = 'horizontal-tb';

const SUPPORTED_WRITING_MODES = Object.freeze({
    jpan: new Set(['horizontal-tb', 'vertical-rl']),
    hans: new Set(['horizontal-tb']),
    hant: new Set(['horizontal-tb', 'vertical-rl']),
    kore: new Set(['horizontal-tb']),
    latn: new Set(['horizontal-tb']),
});

const KINSOKU_PROFILES = Object.freeze({
    japanese: Object.freeze({
        id: 'japanese',
        lineStart: '、。，．・：；！？)]}〉》」』】〕〗〙〛ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー',
        lineEnd: '([<{〈《「『【〔〖〘〚',
    }),
    chinese: Object.freeze({
        id: 'chinese',
        lineStart: '、。，．・：；！？)]}〉》」』】〕〗〙〛’”',
        lineEnd: '([<{〈《「『【〔〖〘〚‘“',
    }),
    korean: Object.freeze({
        id: 'korean',
        lineStart: '、。，．・：；！？)]}〉》」』】〕’”',
        lineEnd: '([<{〈《「『【〔‘“',
    }),
    none: Object.freeze({ id: 'none', lineStart: '', lineEnd: '' }),
});

export function normalizeFlowLanguageTag(code) {
    const raw = String(code || '').trim().replace(/_/g, '-');
    if (!raw) return 'ja';
    const alias = LANGUAGE_ALIASES[raw.toLowerCase()];
    if (alias) return alias;
    try {
        return Intl.getCanonicalLocales(raw)[0] || raw;
    } catch (_) {
        return raw;
    }
}

export function getFlowLanguageScript(code) {
    const languageTag = normalizeFlowLanguageTag(code);
    const lower = languageTag.toLowerCase();
    if (typeof Intl !== 'undefined' && typeof Intl.Locale === 'function') {
        try {
            const script = new Intl.Locale(languageTag).maximize().script?.toLowerCase();
            if (script) return script;
        } catch (_) {
            // Fall through to the conservative lookup below for unknown tags.
        }
    }
    const explicitScript = lower.split('-').find((part) => /^[a-z]{4}$/.test(part));
    if (explicitScript) return explicitScript;
    if (lower === 'ja' || lower.startsWith('ja-')) return 'jpan';
    if (lower === 'ko' || lower.startsWith('ko-')) return 'kore';
    if (lower.startsWith('zh-hant')) return 'hant';
    if (/^zh-(tw|hk|mo)(-|$)/.test(lower)) return 'hant';
    if (lower.startsWith('zh')) return 'hans';
    if (/^(en|fr|es|de|pt)(-|$)/.test(lower)) return 'latn';
    return 'zyyy';
}

export function getFlowKinsokuProfile(code) {
    const script = getFlowLanguageScript(code);
    if (script === 'jpan') return KINSOKU_PROFILES.japanese;
    if (script === 'hans' || script === 'hant') return KINSOKU_PROFILES.chinese;
    if (script === 'kore') return KINSOKU_PROFILES.korean;
    return KINSOKU_PROFILES.none;
}

export function isFlowWritingModeSupported(code, writingMode) {
    const script = getFlowLanguageScript(code);
    const mode = String(writingMode || DEFAULT_FLOW_WRITING_MODE);
    return SUPPORTED_WRITING_MODES[script]?.has(mode) ?? false;
}

export function getFlowTypographyProfile(code, writingMode) {
    const lookupLanguageTag = normalizeFlowLanguageTag(code);
    const script = getFlowLanguageScript(lookupLanguageTag);
    const mode = String(writingMode || DEFAULT_FLOW_WRITING_MODE);
    const kinsoku = getFlowKinsokuProfile(lookupLanguageTag);
    const cjk = script === 'jpan' || script === 'hans' || script === 'hant' || script === 'kore';
    return Object.freeze({
        lookupLanguageTag,
        script,
        writingMode: mode,
        writingModeSupported: isFlowWritingModeSupported(lookupLanguageTag, mode),
        rules: Object.freeze({
            wrapPolicy: cjk ? 'break-anywhere' : script === 'latn' ? 'keep-words' : 'language-default',
            kinsokuProfileId: kinsoku.id,
        }),
    });
}
