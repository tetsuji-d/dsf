function normalizePageDirection(value) {
    return value === 'rtl' ? 'rtl' : 'ltr';
}

function createFallbackSpreadUnits(totalPages) {
    if (!Number.isInteger(totalPages) || totalPages < 1) return [];
    // Legacy DSFs without book metadata still follow the DSF reading contract:
    // the first page is the outside front cover and remains a single surface.
    const units = [[0]];
    for (let index = 1; index < totalPages; index += 2) {
        units.push(index + 1 < totalPages ? [index, index + 1] : [index]);
    }
    return units;
}

function getFallbackSpreadAnchor(unit, pageDirection) {
    if (!Array.isArray(unit) || !unit.length) return -1;
    return normalizePageDirection(pageDirection) === 'rtl' && unit.length > 1
        ? unit[unit.length - 1]
        : unit[0];
}

/** Return the non-overlapping pages rendered by one fallback spread anchor. */
export function getViewerFallbackSpreadPageIndices({
    currentIndex,
    totalPages,
    pageDirection = 'ltr',
} = {}) {
    if (!Number.isInteger(currentIndex)
        || !Number.isInteger(totalPages)
        || totalPages < 1
        || currentIndex < 0
        || currentIndex >= totalPages) return [];
    const unit = createFallbackSpreadUnits(totalPages)
        .find((candidate) => candidate.includes(currentIndex));
    if (!unit) return [];
    return normalizePageDirection(pageDirection) === 'rtl' && unit.length > 1
        ? [...unit].reverse()
        : [...unit];
}

/** Pure page-index navigation for the Viewer fallback spread mode. */
export function getViewerPageNavigationTarget({
    currentIndex,
    totalPages,
    delta,
    spreadMode = false,
    pageDirection = 'ltr',
} = {}) {
    if (!Number.isInteger(currentIndex)
        || !Number.isInteger(totalPages)
        || totalPages < 1
        || currentIndex < 0
        || currentIndex >= totalPages
        || ![-1, 1].includes(delta)) return currentIndex;
    if (!spreadMode) {
        return Math.max(0, Math.min(totalPages - 1, currentIndex + delta));
    }

    const units = createFallbackSpreadUnits(totalPages);
    const unitIndex = units.findIndex((unit) => unit.includes(currentIndex));
    if (unitIndex < 0) return currentIndex;
    const nextUnitIndex = Math.max(0, Math.min(units.length - 1, unitIndex + delta));
    return getFallbackSpreadAnchor(units[nextUnitIndex], pageDirection);
}
