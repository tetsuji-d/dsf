/** Recognize module transport failures without treating manuscript errors as reloadable. */
export function isPressModuleLoadError(error) {
    const seen = new Set();
    while (error && !seen.has(error)) {
        seen.add(error);
        const message = typeof error === 'string' ? error : error.message;
        if (/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk [\w-]+ failed/i.test(message || '')) return true;
        error = error.cause;
    }
    return false;
}

export function renderPressModuleLoadError(error, t, escapeHtml) {
    if (!isPressModuleLoadError(error)) return null;
    return `<span role="alert">${escapeHtml(t('press_module_load_failed'))}</span>
        <small>${escapeHtml(t('press_module_load_recovery'))}</small>
        <details><summary>${escapeHtml(t('press_module_load_details'))}</summary><small>${escapeHtml(error?.message || '')}</small></details>`;
}
