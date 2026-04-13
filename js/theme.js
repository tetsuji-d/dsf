const THEME_STORAGE_KEY = 'dsf_theme_mode';
const LEGACY_PORTAL_THEME_KEY = 'dsf_portal_theme';
export const SUPPORTED_THEMES = ['device', 'light', 'dark'];

let themePreferenceBound = false;

function normalizeThemeMode(mode) {
    return SUPPORTED_THEMES.includes(mode) ? mode : 'device';
}

export function getThemeMode() {
    const current = localStorage.getItem(THEME_STORAGE_KEY);
    if (SUPPORTED_THEMES.includes(current)) return current;

    const legacy = localStorage.getItem(LEGACY_PORTAL_THEME_KEY);
    if (SUPPORTED_THEMES.includes(legacy)) {
        localStorage.setItem(THEME_STORAGE_KEY, legacy);
        return legacy;
    }

    localStorage.setItem(THEME_STORAGE_KEY, 'device');
    return 'device';
}

export function getEffectiveTheme(mode = getThemeMode()) {
    const normalized = normalizeThemeMode(mode);
    if (normalized === 'light' || normalized === 'dark') return normalized;
    return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}

export function applyTheme(mode = getThemeMode()) {
    const normalized = normalizeThemeMode(mode);
    document.body.dataset.themeMode = normalized;
    document.body.dataset.theme = getEffectiveTheme(normalized);
    return normalized;
}

export function setThemeMode(mode) {
    const normalized = normalizeThemeMode(mode);
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
    localStorage.removeItem(LEGACY_PORTAL_THEME_KEY);
    applyTheme(normalized);
    return normalized;
}

export function bindThemePreferenceListener(onChange) {
    if (themePreferenceBound) return;
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media?.addEventListener) return;
    themePreferenceBound = true;
    media.addEventListener('change', () => {
        if (getThemeMode() !== 'device') return;
        applyTheme('device');
        if (typeof onChange === 'function') onChange('device');
    });
}
