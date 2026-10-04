/** Fullscreen is requested only by the reader's button gesture. */
export function initializeViewerFullscreen({button, text, onChange}) {
    if (!button) return null;
    const supported = !!document.fullscreenEnabled && !!document.documentElement.requestFullscreen;
    const phone=matchMedia('(max-width: 650px), (pointer: coarse) and (max-height: 650px)');
    const status = document.createElement('span');
    status.className = 'viewer-fullscreen-status'; status.setAttribute('role', 'status');
    button.after(status);
    function refresh() {
        button.hidden = !supported || phone.matches;
        const active = !!document.fullscreenElement;
        const label = text(active ? 'exitFullscreen' : 'fullscreen');
        button.title = label; button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(active));
        button.querySelector('.material-icons').textContent = active ? 'fullscreen_exit' : 'fullscreen';
    }
    button.addEventListener('click', async () => {
        button.disabled = true; status.textContent = '';
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
        } catch { status.textContent = text('fullscreenUnavailable'); }
        finally { button.disabled = false; refresh(); }
    });
    document.addEventListener('fullscreenchange', () => {refresh(); onChange();});
    phone.addEventListener('change',refresh);
    refresh();
    return {refresh};
}
