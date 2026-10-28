// Call synchronously from a click: waiting for fullscreen/network work can lose
// the browser's user activation. Never navigate the embedding page as fallback.
export function openEmbeddedReaderTab(url, host = window) {
    let tab;
    try {
        tab = host.open('about:blank', '_blank');
        if (!tab || tab === host || tab === host.parent || tab === host.top) return false;
        tab.opener = null;
        tab.location.replace(url);
        return true;
    } catch {
        // Only close the fresh blank tab we own, never an existing context.
        if (tab && tab !== host && tab !== host.parent && tab !== host.top) {
            try { tab.close(); } catch {}
        }
        return false;
    }
}

export function bindEmbeddedReaderLink(link, {open = openEmbeddedReaderTab, onBlocked = () => {}} = {}) {
    link.addEventListener('click', event => {
        // Keep native modified clicks, middle clicks and long-press link menus.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        if (!open(link.href)) onBlocked(link);
    });
}

export function canUseEmbeddedFullscreen(doc) {
    return !!doc.fullscreenElement || (doc.fullscreenEnabled === true && typeof doc.documentElement?.requestFullscreen === 'function');
}

export async function toggleEmbeddedFullscreen(doc, onUnavailable) {
    try {
        if (doc.fullscreenElement) await doc.exitFullscreen();
        else if (canUseEmbeddedFullscreen(doc)) await doc.documentElement.requestFullscreen();
        else onUnavailable();
    } catch {
        // Ask for a fresh, explicit link click instead of an asynchronous popup.
        onUnavailable();
    }
}
