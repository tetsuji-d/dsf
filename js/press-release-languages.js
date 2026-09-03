/**
 * Pure Press release-language selection helpers.
 *
 * Authoring languages belong to the project. Release languages are a
 * transient Press choice and are deliberately not persisted into the DSP.
 */

function normalizeLanguageCodes(languages) {
    if (!Array.isArray(languages)) return [];
    return [...new Set(languages.map((language) => String(language || '').trim()).filter(Boolean))];
}

export function createInitialPressReleaseLanguages(availableLanguages, defaultLanguage) {
    const available = normalizeLanguageCodes(availableLanguages);
    if (!available.length) return Object.freeze([]);
    const source = String(defaultLanguage || '').trim();
    return Object.freeze([available.includes(source) ? source : available[0]]);
}

export function reconcilePressReleaseLanguages(availableLanguages, selectedLanguages, defaultLanguage) {
    const available = normalizeLanguageCodes(availableLanguages);
    if (!available.length) return Object.freeze([]);
    const selected = new Set(normalizeLanguageCodes(selectedLanguages));
    const reconciled = available.filter((language) => selected.has(language));
    return reconciled.length
        ? Object.freeze(reconciled)
        : createInitialPressReleaseLanguages(available, defaultLanguage);
}

export function togglePressReleaseLanguage(availableLanguages, selectedLanguages, language, defaultLanguage) {
    const available = normalizeLanguageCodes(availableLanguages);
    const current = reconcilePressReleaseLanguages(available, selectedLanguages, defaultLanguage);
    const target = String(language || '').trim();
    if (!available.includes(target)) {
        return Object.freeze({ changed: false, reason: 'language-unavailable', languages: current });
    }
    const selected = new Set(current);
    if (selected.has(target) && selected.size === 1) {
        return Object.freeze({ changed: false, reason: 'at-least-one-language-required', languages: current });
    }
    if (selected.has(target)) selected.delete(target);
    else selected.add(target);
    return Object.freeze({
        changed: true,
        reason: '',
        languages: Object.freeze(available.filter((code) => selected.has(code))),
    });
}
