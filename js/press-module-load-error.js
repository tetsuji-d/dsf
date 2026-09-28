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
        <div class="press-recovery-actions"><button type="button" onclick="exportDSP()">${escapeHtml(t('press_recovery_save_dsp'))}</button><button type="button" onclick="switchRoom('editor')">${escapeHtml(t('press_recovery_editor'))}</button></div>
        <details><summary>${escapeHtml(t('press_module_load_details'))}</summary><small>${escapeHtml(error?.message || '')}</small></details>`;
}
