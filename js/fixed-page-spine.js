/**
 * Pure operations for moving/removing persisted Fixed page Blocks inside a
 * Project v6 mixed spine. Flow and structure Blocks are opaque anchors.
 */

function unchanged(blocks, reason) {
    return Object.freeze({
        changed: false,
        reason,
        blocks,
        activeBlockIndex: -1,
        activePageIndex: -1,
    });
}

function getPageEntries(blocks) {
    const entries = [];
    (Array.isArray(blocks) ? blocks : []).forEach((block, blockIndex) => {
        if (block?.kind !== 'page') return;
        entries.push(Object.freeze({
            pageIndex: entries.length,
            blockIndex,
            block,
        }));
    });
    return entries;
}

function getSpreadGroupId(block) {
    return String(block?.content?.spreadImage?.groupId || '');
}

function resolveAtomicPageEntries(entries, pageIndex) {
    const source = entries[Number(pageIndex)];
    if (!source) return { ok: false, reason: 'invalid_page_index', entries: [] };

    const spreadGroupId = getSpreadGroupId(source.block);
    if (!spreadGroupId) return { ok: true, entries: [source] };

    const pair = entries.filter((entry) => getSpreadGroupId(entry.block) === spreadGroupId);
    if (pair.length !== 2) {
        return { ok: false, reason: 'invalid_spread_pair', entries: [] };
    }
    const pageAdjacent = pair[1].pageIndex === pair[0].pageIndex + 1;
    const blockAdjacent = pair[1].blockIndex === pair[0].blockIndex + 1;
    if (!pageAdjacent || !blockAdjacent) {
        return { ok: false, reason: 'non_contiguous_spread_pair', entries: [] };
    }
    return { ok: true, entries: pair };
}

function getPageIndexForBlockIndex(blocks, blockIndex) {
    let pageIndex = -1;
    for (let index = 0; index <= blockIndex && index < blocks.length; index += 1) {
        if (blocks[index]?.kind === 'page') pageIndex += 1;
    }
    return Math.max(0, pageIndex);
}

function sameBlockOrder(first, second) {
    return first.length === second.length && first.every((block, index) => block === second[index]);
}

export function moveFixedPageRangeInSpine(blocks, options = {}) {
    const sourceBlocks = Array.isArray(blocks) ? blocks : [];
    const position = options.position === 'before' ? 'before' : 'after';
    const pageEntries = getPageEntries(sourceBlocks);
    const sourceResult = resolveAtomicPageEntries(pageEntries, options.sourcePageIndex);
    if (!sourceResult.ok) return unchanged(sourceBlocks, sourceResult.reason);

    const targetResult = resolveAtomicPageEntries(pageEntries, options.targetPageIndex);
    if (!targetResult.ok) return unchanged(sourceBlocks, targetResult.reason);

    const sourceEntries = sourceResult.entries;
    const targetEntries = targetResult.entries;
    const sourceBlocksSet = new Set(sourceEntries.map((entry) => entry.block));
    if (targetEntries.some((entry) => sourceBlocksSet.has(entry.block))) {
        return unchanged(sourceBlocks, 'same_page_range');
    }

    const targetEntry = position === 'before' ? targetEntries[0] : targetEntries.at(-1);
    const targetBlock = targetEntry.block;
    const movedBlocks = sourceEntries.map((entry) => entry.block);
    const nextBlocks = sourceBlocks.filter((block) => !sourceBlocksSet.has(block));
    const targetBlockIndex = nextBlocks.indexOf(targetBlock);
    if (targetBlockIndex < 0) return unchanged(sourceBlocks, 'target_not_found');

    const insertBlockIndex = targetBlockIndex + (position === 'after' ? 1 : 0);
    nextBlocks.splice(insertBlockIndex, 0, ...movedBlocks);
    if (sameBlockOrder(sourceBlocks, nextBlocks)) return unchanged(sourceBlocks, 'no_change');

    const activeBlockIndex = nextBlocks.indexOf(movedBlocks[0]);
    return Object.freeze({
        changed: true,
        reason: '',
        blocks: nextBlocks,
        activeBlockIndex,
        activePageIndex: getPageIndexForBlockIndex(nextBlocks, activeBlockIndex),
    });
}

export function removeFixedPageRangeFromSpine(blocks, options = {}) {
    const sourceBlocks = Array.isArray(blocks) ? blocks : [];
    const pageEntries = getPageEntries(sourceBlocks);
    const sourceResult = resolveAtomicPageEntries(pageEntries, options.sourcePageIndex);
    if (!sourceResult.ok) return unchanged(sourceBlocks, sourceResult.reason);
    const minimumRemainingPages = Math.max(0, Number(options.minimumRemainingPages) || 0);
    if (pageEntries.length - sourceResult.entries.length < minimumRemainingPages) {
        return unchanged(sourceBlocks, 'minimum_fixed_pages');
    }

    const removedSet = new Set(sourceResult.entries.map((entry) => entry.block));
    const firstRemovedBlockIndex = sourceResult.entries[0].blockIndex;
    const nextBlocks = sourceBlocks.filter((block) => !removedSet.has(block));
    if (sameBlockOrder(sourceBlocks, nextBlocks)) return unchanged(sourceBlocks, 'no_change');

    const activeBlockIndex = nextBlocks.length
        ? Math.max(0, Math.min(firstRemovedBlockIndex, nextBlocks.length - 1))
        : 0;
    return Object.freeze({
        changed: true,
        reason: '',
        blocks: nextBlocks,
        activeBlockIndex,
        activePageIndex: nextBlocks.length
            ? getPageIndexForBlockIndex(nextBlocks, activeBlockIndex)
            : 0,
    });
}
