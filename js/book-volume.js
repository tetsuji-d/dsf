/** Runtime geometry only: no authoring fields, pagination, or saved progress. */
export const BOOK_EDGE_PROJECTION = .55;
export function getBookThickness(bodyPageCount) {
    const count = Number.isFinite(bodyPageCount) ? Math.max(0, bodyPageCount) : 0;
    // Two printed faces per leaf; covers contribute a small constant allowance.
    return Math.min(64, 4 + 1.65 * Math.sqrt(Math.ceil(count / 2)));
}
export function fitBookPageWidth(width, height, pageColumns, thickness) {
    const edge = thickness * BOOK_EDGE_PROJECTION;
    return Math.max(1, Math.min(width / (360 * pageColumns + edge * 2), height / (640 + edge * .3)) * 360);
}
const isBody = surface => surface && !surface.virtualBlank && /^P\d+$/i.test(surface.bookRole || '');
export function getBookEdgeState({units, unitIndex, bodyPageCount, rtl = false}) {
    const unit = units[unitIndex];
    if (!unit) return null;
    const thickness = getBookThickness(bodyPageCount);
    const front = unit.type === 'single' && unit.role === 'C1';
    const back = unit.type === 'single' && unit.role === 'C4';
    let before = 0;
    for (let i = 0; i < unitIndex; i++) {
        for (const surface of [units[i].center, units[i].left, units[i].right]) if (isBody(surface)) before++;
    }
    if (isBody(rtl ? unit.right : unit.left)) before++;
    const progress = front ? 0 : back ? 1 : Math.min(1, before / Math.max(1, bodyPageCount));
    const left = thickness * (rtl ? 1 - progress : progress);
    // Bounds in page widths relative to the hinge; match the existing curl world.
    const singleLeft = front ? rtl : back ? !rtl : false;
    return {thickness, progress, left, right: thickness - left, closed: front || back,
        leftPage: front || back ? (singleLeft ? -1 : 0) : -1,
        rightPage: front || back ? (singleLeft ? 0 : 1) : 1};
}
export function interpolateBookEdges(from, to, progress) {
    const p = Math.max(0, Math.min(1, progress));
    return Object.fromEntries(['thickness', 'left', 'right', 'leftPage', 'rightPage'].map(key => [key, from[key] + (to[key] - from[key]) * p]));
}
