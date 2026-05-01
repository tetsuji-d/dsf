export function normalizeBookSettings(book = {}, bookMode = 'simple', pageCount = 0) {
    const count = Math.max(0, Number(pageCount) || 0);
    const sourceMode = book?.mode || bookMode || 'simple';
    const mode = sourceMode === 'none'
        ? 'none'
        : (count >= 4 ? 'full' : 'simple');
    const last = Math.max(0, count - 1);
    const covers = {};
    if (mode !== 'none') {
        covers.c1 = { pageIndex: 0 };
        covers.c4 = { pageIndex: last };
    }
    if (mode === 'full') {
        covers.c2 = { pageIndex: 1 };
        covers.c3 = { pageIndex: count - 2 };
    }
    return { mode, covers };
}

function getReadableOrdinalForSettings(pageIndex, settings, pageCount) {
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pageCount) return 0;
    let ordinal = 0;
    for (let i = 0; i <= idx; i += 1) {
        const isCover = Object.values(settings.covers || {}).some((cover) => cover?.pageIndex === i);
        if (!isCover) ordinal += 1;
    }
    return ordinal;
}

function isOuterCoverKey(coverKey) {
    return coverKey === 'c1' || coverKey === 'c4';
}

function isAllowedInnerCoverSpreadPair(leftIndex, rightIndex, settings, pageCount) {
    const c2Index = settings.covers?.c2?.pageIndex;
    const c3Index = settings.covers?.c3?.pageIndex;
    const pair = new Set([leftIndex, rightIndex]);
    const hasC2 = Number.isInteger(c2Index) && pair.has(c2Index);
    const hasC3 = Number.isInteger(c3Index) && pair.has(c3Index);
    if (!hasC2 && !hasC3) return false;
    if (hasC2 && hasC3) return rightIndex === leftIndex + 1;

    const coverIndex = hasC2 ? c2Index : c3Index;
    const pageIndex = leftIndex === coverIndex ? rightIndex : leftIndex;
    if (getPageCoverKey(pageIndex, settings, settings.mode, pageCount)) return false;
    if (hasC2) return pageIndex === coverIndex + 1;
    return pageIndex === coverIndex - 1;
}

export function getBookCompositionIssues({ pageCount = 0, book = {}, bookMode = 'simple', sections = null } = {}) {
    const count = Math.max(0, Number(pageCount) || 0);
    const settings = normalizeBookSettings(book, bookMode, count);
    const issues = [];
    if (settings.mode !== 'none') {
        if (count % 2 !== 0) issues.push('cover_requires_even_pages');
        if (count === 1) issues.push('cover_requires_two_or_more_pages');
        if (count === 3) issues.push('cover_disallows_three_pages');
    } else if (Array.isArray(sections)) {
        const hasSpreadImage = sections.some((section) => !!section?.spreadImage?.groupId);
        if (hasSpreadImage) issues.push('spread_image_requires_covers');
    }

    const spreadIssues = getSpreadImageCompositionIssues({ sections, book, bookMode, pageCount: count });
    return [...issues, ...spreadIssues];
}

export function getSpreadImageCompositionIssues({ sections = [], book = {}, bookMode = 'simple', pageCount = 0 } = {}) {
    if (!Array.isArray(sections) || !sections.length) return [];
    const count = Math.max(0, Number(pageCount) || sections.length || 0);
    const settings = normalizeBookSettings(book, bookMode, count);
    const issues = [];
    const groups = new Map();
    sections.forEach((section, index) => {
        const groupId = section?.spreadImage?.groupId;
        if (!groupId) return;
        if (!groups.has(groupId)) groups.set(groupId, []);
        groups.get(groupId).push(index);
    });

    if (!groups.size) return issues;
    if (settings.mode === 'none') {
        issues.push('spread_image_requires_covers');
        return issues;
    }
    if (settings.mode !== 'full') {
        issues.push('spread_image_requires_full_covers');
    }

    groups.forEach((indices) => {
        const pair = [...indices].sort((a, b) => a - b);
        if (pair.length !== 2 || pair[1] !== pair[0] + 1) {
            issues.push('spread_image_requires_adjacent_pair');
            return;
        }
        const [leftIndex, rightIndex] = pair;
        const leftCover = getPageCoverKey(leftIndex, settings, settings.mode, count);
        const rightCover = getPageCoverKey(rightIndex, settings, settings.mode, count);
        if (isOuterCoverKey(leftCover) || isOuterCoverKey(rightCover)) {
            issues.push('spread_image_cannot_include_cover');
            return;
        }
        if (leftCover || rightCover) {
            if (!isAllowedInnerCoverSpreadPair(leftIndex, rightIndex, settings, count)) {
                issues.push('spread_image_invalid_body_pair');
            }
            return;
        }
        const firstOrdinal = getReadableOrdinalForSettings(leftIndex, settings, count);
        const secondOrdinal = getReadableOrdinalForSettings(rightIndex, settings, count);
        if (firstOrdinal % 2 !== 0 || secondOrdinal !== firstOrdinal + 1) {
            issues.push('spread_image_invalid_body_pair');
        }
    });
    return [...new Set(issues)];
}

export function canInsertSpreadImageAt(insertIndex, pageCount = 0, book = {}, bookMode = 'simple') {
    const currentCount = Math.max(0, Number(pageCount) || 0);
    const idx = Math.max(0, Math.min(Number(insertIndex) || 0, currentCount));
    const finalCount = currentCount + 2;
    const settings = normalizeBookSettings(book, bookMode, finalCount);
    const issues = [];
    if (settings.mode === 'none') issues.push('spread_image_requires_covers');
    if (settings.mode !== 'full') issues.push('spread_image_requires_full_covers');
    if (finalCount % 2 !== 0) issues.push('cover_requires_even_pages');

    const leftCover = getPageCoverKey(idx, settings, settings.mode, finalCount);
    const rightCover = getPageCoverKey(idx + 1, settings, settings.mode, finalCount);
    if (isOuterCoverKey(leftCover) || isOuterCoverKey(rightCover)) {
        issues.push('spread_image_cannot_include_cover');
    } else if (leftCover || rightCover) {
        if (!isAllowedInnerCoverSpreadPair(idx, idx + 1, settings, finalCount)) {
            issues.push('spread_image_invalid_body_pair');
        }
    } else {
        const firstOrdinal = getReadableOrdinalForSettings(idx, settings, finalCount);
        const secondOrdinal = getReadableOrdinalForSettings(idx + 1, settings, finalCount);
        if (firstOrdinal % 2 !== 0 || secondOrdinal !== firstOrdinal + 1) {
            issues.push('spread_image_invalid_body_pair');
        }
    }
    if (idx + 1 >= finalCount) {
        issues.push('spread_image_invalid_body_pair');
    }

    return {
        ok: issues.length === 0,
        issues: [...new Set(issues)],
        finalBook: settings
    };
}

export function getPageCoverKey(pageIndex, book = {}, bookMode = 'simple', pageCount = 0) {
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0) return '';
    const settings = normalizeBookSettings(book, bookMode, pageCount);
    for (const key of ['c1', 'c2', 'c3', 'c4']) {
        if (settings.covers[key]?.pageIndex === idx && (key === 'c1' || key === 'c4' || settings.mode === 'full')) {
            return key;
        }
    }
    return '';
}

export function getReadablePageCount(pageCount = 0, book = {}, bookMode = 'simple') {
    const count = Math.max(0, Number(pageCount) || 0);
    let covers = 0;
    for (let i = 0; i < count; i += 1) {
        if (getPageCoverKey(i, book, bookMode, count)) covers += 1;
    }
    return Math.max(0, count - covers);
}

export function getPageDisplayLabel(pageIndex, pageCount = 0, book = {}, bookMode = 'simple') {
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0) return '';
    const count = Math.max(0, Number(pageCount) || 0);
    const coverKey = getPageCoverKey(idx, book, bookMode, count);
    if (coverKey) return coverKey.toUpperCase();

    let readableIndex = 0;
    for (let i = 0; i <= idx; i += 1) {
        if (!getPageCoverKey(i, book, bookMode, count)) readableIndex += 1;
    }
    return String(Math.max(1, readableIndex));
}
