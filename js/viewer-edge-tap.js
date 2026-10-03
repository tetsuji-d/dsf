/** A tap never claims movement: swipes/pinches keep their existing handlers. */
export function viewerEdgeTapSide(x, y, rect) {
    if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const band = Math.min(64, Math.max(32, rect.width * .15), rect.width / 4);
    return x <= rect.left + band ? 'left' : x >= rect.right - band ? 'right' : null;
}

export function createViewerEdgeTap() {
    const contacts = new Set();
    let candidate = null;
    function move(e) {
        // Once moved, returning to the starting point must not become a tap.
        if (candidate?.id === e.pointerId && Math.hypot(e.clientX-candidate.x, e.clientY-candidate.y) >= 10) candidate = null;
    }
    return {
        down(e, target) {
            if (e.pointerType !== 'touch') return;
            contacts.add(e.pointerId);
            if (contacts.size !== 1) { candidate = null; return; }
            candidate = target ? {id:e.pointerId, x:e.clientX, y:e.clientY, time:e.timeStamp, target} : null;
        },
        move,
        up(e, cancelled = false) {
            move(e);
            contacts.delete(e.pointerId);
            if (candidate?.id !== e.pointerId) return null;
            const tap = candidate; candidate = null;
            return !cancelled && !contacts.size && e.timeStamp-tap.time <= 350 ? tap.target : null;
        },
        reset() { candidate = null; contacts.clear(); },
    };
}
