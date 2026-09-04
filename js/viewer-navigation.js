/** Pure page-index navigation for the Viewer fallback spread mode. */
export function getViewerPageNavigationTarget({
    currentIndex,
    totalPages,
    delta,
    spreadMode = false,
    hasVisibleSecondPage = false,
} = {}) {
    if (!Number.isInteger(currentIndex)
        || !Number.isInteger(totalPages)
        || totalPages < 1
        || currentIndex < 0
        || currentIndex >= totalPages
        || ![-1, 1].includes(delta)) return currentIndex;
    const step = spreadMode && hasVisibleSecondPage ? 2 : 1;
    return Math.max(0, Math.min(totalPages - 1, currentIndex + (delta * step)));
}
