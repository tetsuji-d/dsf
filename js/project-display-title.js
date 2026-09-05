/**
 * Pure helpers for resolving project and work labels without collapsing the
 * authoring project name into the multilingual work title.
 *
 * Current authoring data stores localized titles in `meta[lang].title` and a
 * representative legacy title in `title`. Older data may instead store a
 * localized object directly in `title`, so that shape remains readable here.
 */

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed ? trimmed.normalize('NFC') : '';
}

function normalizeLocale(value) {
    const locale = normalizeText(value).replace(/_/g, '-').toLowerCase();
    return locale.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function localeBase(locale) {
    return normalizeLocale(locale).split('-')[0] || '';
}

function addLocale(order, seen, locale) {
    const normalized = normalizeLocale(locale);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    order.push(normalized);
}

function setLocalizedTitle(target, locale, value) {
    const normalizedLocale = normalizeLocale(locale);
    const normalizedTitle = normalizeText(value);
    if (!normalizedLocale || !normalizedTitle || target.has(normalizedLocale)) return;
    target.set(normalizedLocale, normalizedTitle);
}

function collectTitleData(project) {
    const source = isRecord(project) ? project : {};
    const meta = isRecord(source.meta) ? source.meta : {};
    const localized = new Map();
    const legacyLocalized = new Map();

    // `meta[lang].title` is the current multilingual authoring source.
    for (const [locale, entry] of Object.entries(meta)) {
        if (isRecord(entry)) setLocalizedTitle(localized, locale, entry.title);
    }

    // Some older envelopes used `meta.title = { ja, en, ... }`.
    if (isRecord(meta.title)) {
        for (const [locale, value] of Object.entries(meta.title)) {
            setLocalizedTitle(localized, locale, value);
        }
    }

    // The current root title is a representative string. A localized object is
    // accepted only as a legacy read shape and never treated as projectName.
    const rootTitle = normalizeText(source.title);
    if (isRecord(source.title)) {
        for (const [locale, value] of Object.entries(source.title)) {
            setLocalizedTitle(legacyLocalized, locale, value);
        }
    }

    // Current semantic metadata wins over a legacy root-title map for the same
    // locale, while missing locales remain readable from the legacy object.
    for (const [locale, value] of legacyLocalized) {
        if (!localized.has(locale)) localized.set(locale, value);
    }

    const localeOrder = [];
    const seenLocales = new Set();
    if (Array.isArray(source.languages)) {
        source.languages.forEach((locale) => addLocale(localeOrder, seenLocales, locale));
    }
    for (const locale of localized.keys()) addLocale(localeOrder, seenLocales, locale);

    return {
        localized,
        localeOrder,
        rootTitle,
        projectName: normalizeText(source.projectName),
        defaultLang: normalizeLocale(source.defaultLang),
    };
}

function findLocaleTitle(localized, localeOrder, requestedLocale) {
    const requested = normalizeLocale(requestedLocale);
    if (!requested) return '';

    const exact = localized.get(requested);
    if (exact) return exact;

    const base = localeBase(requested);
    if (!base) return '';

    // A generic title (`en`) is preferred before a regional sibling. When the
    // request itself is generic and only `en-us`/`en-gb` exist, author-declared
    // `languages` order determines the deterministic choice.
    const generic = localized.get(base);
    if (generic) return generic;

    for (const locale of localeOrder) {
        if (locale !== requested && localeBase(locale) === base) {
            const value = localized.get(locale);
            if (value) return value;
        }
    }
    return '';
}

function findAnyLocalizedTitle(localized, localeOrder) {
    for (const locale of localeOrder) {
        const value = localized.get(locale);
        if (value) return value;
    }
    return '';
}

/** Return only the private/editor-facing project label. */
export function resolveProjectName(project) {
    return collectTitleData(project).projectName;
}

/**
 * Resolve a work title in this strict order:
 * requested locale -> default locale -> representative root title -> any
 * localized title -> optional projectName.
 *
 * `locale` and `requestedLocale` are aliases. Regional locale siblings such
 * as `en-us` and `en-gb` are selected using the project's language order.
 */
export function resolveProjectDisplayTitle(project, options = {}) {
    const data = collectTitleData(project);
    const requestedLocale = options.locale ?? options.requestedLocale ?? '';
    const requested = findLocaleTitle(data.localized, data.localeOrder, requestedLocale);
    if (requested) return requested;

    const defaultTitle = findLocaleTitle(data.localized, data.localeOrder, data.defaultLang);
    if (defaultTitle) return defaultTitle;
    if (data.rootTitle) return data.rootTitle;

    const anyLocalized = findAnyLocalizedTitle(data.localized, data.localeOrder);
    if (anyLocalized) return anyLocalized;
    return options.includeProjectName === true ? data.projectName : '';
}

/** Resolve the canonical/default-language representative work title. */
export function resolveProjectDefaultTitle(project, options = {}) {
    const data = collectTitleData(project);
    return resolveProjectDisplayTitle(project, {
        locale: data.defaultLang,
        includeProjectName: options.includeProjectName === true,
    });
}

/** Canonical is an explicit alias for the default-language resolver. */
export function resolveProjectCanonicalTitle(project, options = {}) {
    return resolveProjectDefaultTitle(project, options);
}
