/**
 * Pure Flow Layout pagination.
 *
 * The caller injects page measurement. This module owns source ordering,
 * grapheme-safe binary splitting, manual page breaks, and no-loss ranges; it
 * does not know about DOM, Canvas, fonts, state, save/load, or DSF Page v5.
 */

import { CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_WIDTH } from './page-geometry.js';
import { DEFAULT_FLOW_WRITING_MODE } from './flow-typography.js';
import { segmentGraphemes } from './grapheme.js';
import {
    assertValidFlowDocument,
    getFlowBlockText,
    isFlowTextBlock,
} from './flow-document.js';

export const DEFAULT_FLOW_PAGE_PADDING = 20;
export const DEFAULT_FLOW_INITIAL_PROBE_GRAPHEMES = 256;

export class FlowPaginationError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowPaginationError';
        this.code = code;
        this.context = context;
        if (context.cause) this.cause = context.cause;
    }
}

function requirePositiveNumber(value, path) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new FlowPaginationError('INVALID_PAGE_BOX', `${path} must be a positive finite number.`, { path, value });
    }
    return number;
}

function requireNonNegativeNumber(value, path) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new FlowPaginationError('INVALID_PAGE_BOX', `${path} must be a non-negative finite number.`, { path, value });
    }
    return number;
}

function normalizePadding(value) {
    if (typeof value === 'number') {
        const padding = requireNonNegativeNumber(value, 'pageBox.padding');
        return { top: padding, right: padding, bottom: padding, left: padding };
    }
    const source = value && typeof value === 'object' ? value : {};
    return {
        top: requireNonNegativeNumber(source.top ?? 0, 'pageBox.padding.top'),
        right: requireNonNegativeNumber(source.right ?? 0, 'pageBox.padding.right'),
        bottom: requireNonNegativeNumber(source.bottom ?? 0, 'pageBox.padding.bottom'),
        left: requireNonNegativeNumber(source.left ?? 0, 'pageBox.padding.left'),
    };
}

export function normalizeFlowPageBox(pageBox) {
    if (!pageBox || typeof pageBox !== 'object') {
        throw new FlowPaginationError('INVALID_PAGE_BOX', 'pageBox is required.');
    }
    const width = requirePositiveNumber(pageBox.width, 'pageBox.width');
    const height = requirePositiveNumber(pageBox.height, 'pageBox.height');
    const padding = normalizePadding(pageBox.padding);
    const contentWidth = width - padding.left - padding.right;
    const contentHeight = height - padding.top - padding.bottom;
    if (contentWidth <= 0 || contentHeight <= 0) {
        throw new FlowPaginationError('INVALID_PAGE_BOX', 'Page padding leaves no usable content area.', {
            width,
            height,
            padding,
        });
    }
    return Object.freeze({
        width,
        height,
        padding: Object.freeze(padding),
        contentBox: Object.freeze({
            x: padding.left,
            y: padding.top,
            width: contentWidth,
            height: contentHeight,
        }),
    });
}

/** Reuse the DSF 9:16 logical page constants without fixing the paginator to them. */
export function createCanonicalFlowPageBox(options = {}) {
    return normalizeFlowPageBox({
        width: CANONICAL_PAGE_WIDTH,
        height: CANONICAL_PAGE_HEIGHT,
        padding: options.padding ?? DEFAULT_FLOW_PAGE_PADDING,
    });
}

function resolveMaxPages(value) {
    if (value == null) return Number.POSITIVE_INFINITY;
    const maxPages = Number(value);
    if (!Number.isInteger(maxPages) || maxPages < 1) {
        throw new FlowPaginationError('INVALID_MAX_PAGES', 'maxPages must be a positive integer.', { value });
    }
    return maxPages;
}

function createFragment(section, block, languageKey, text, segments, startGrapheme, endGrapheme) {
    const start = startGrapheme < segments.length ? segments[startGrapheme].index : text.length;
    const end = endGrapheme > startGrapheme
        ? segments[endGrapheme - 1].end
        : start;
    const sourceRange = Object.freeze({
        start,
        end,
        startGrapheme,
        endGrapheme,
    });
    const fragment = {
        sectionId: section.id,
        blockId: block.id,
        blockType: block.type,
        languageKey,
        text: text.slice(start, end),
        sourceRange,
        isBlockStart: startGrapheme === 0,
        isBlockEnd: endGrapheme === segments.length,
    };
    const annotations = (block.annotations?.[languageKey] || []).filter(a => a.start < end && start < a.end)
        .map(a => ({...a, start:Math.max(start,a.start)-start, end:Math.min(end,a.end)-start}));
    if (annotations.length) fragment.annotations = annotations;
    if (block.indentByLanguage?.[languageKey]) fragment.indent=Object.freeze({...block.indentByLanguage[languageKey]});
    if (block.titleRegion) fragment.titleRegion=Object.freeze({...block.titleRegion});
    if (block.type === 'heading') fragment.headingLevel = block.level;
    return Object.freeze(fragment);
}

function measureCandidate(measurePage, context) {
    let result;
    try {
        result = measurePage(Object.freeze({
            ...context,
            fragments: Object.freeze([...context.fragments]),
        }));
    } catch (cause) {
        throw new FlowPaginationError('MEASUREMENT_FAILED', 'Flow page measurement failed.', {
            cause,
            pageIndex: context.pageIndex,
        });
    }
    if (!result || typeof result.fits !== 'boolean') {
        throw new FlowPaginationError('INVALID_MEASUREMENT_RESULT', 'measurePage must return { fits: boolean }.', {
            pageIndex: context.pageIndex,
            result,
        });
    }
    return result.fits;
}

function findLargestFittingEnd({
    section,
    block,
    languageKey,
    text,
    segments,
    startGrapheme,
    probeHint,
    probeHintIsLearned,
    knownFittingEnd,
    knownFailureEnd,
    measure,
}) {
    const rubies = (block.annotations?.[languageKey] || []).filter(a=>a.type==='ruby');
    if (rubies.length) {
        const ends = segments.map((s,i)=>({offset:s.end,index:i+1})).filter(e=>e.index>startGrapheme
            && !rubies.some(a=>a.start<e.offset && e.offset<a.end));
        let low=0, high=ends.length-1, best=startGrapheme;
        while(low<=high){const middle=Math.floor((low+high)/2), end=ends[middle].index;
            if(measure(createFragment(section,block,languageKey,text,segments,startGrapheme,end))){best=end;low=middle+1;}else high=middle-1;
        }
        return best;
    }
    let best = Number.isInteger(knownFittingEnd) ? knownFittingEnd : startGrapheme;
    const remaining = segments.length - startGrapheme;
    if (remaining <= 0) return best;

    const initialSpan = Math.max(1, Math.min(
        remaining,
        Number.isInteger(probeHint) && probeHint > 0
            ? probeHint
            : DEFAULT_FLOW_INITIAL_PROBE_GRAPHEMES,
    ));
    let span = initialSpan;
    let firstFailure = Number.isInteger(knownFailureEnd) ? knownFailureEnd : null;
    let probingLearnedBoundary = probeHintIsLearned;

    while (firstFailure === null) {
        const end = Math.min(segments.length, startGrapheme + span);
        const fragment = createFragment(section, block, languageKey, text, segments, startGrapheme, end);
        if (!measure(fragment)) {
            firstFailure = end;
            break;
        }
        best = end;
        if (end === segments.length) return best;
        const growth = probingLearnedBoundary
            ? 1
            : probeHintIsLearned
                ? Math.max(16, Math.ceil(span / 8))
                : Math.max(1, span);
        probingLearnedBoundary = false;
        span = Math.min(remaining, span + growth);
    }

    let low = best + 1;
    let high = firstFailure - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const fragment = createFragment(section, block, languageKey, text, segments, startGrapheme, middle);
        if (measure(fragment)) {
            best = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return best;
}

function createFlowSourceEntries(document, languageKey) {
    const entries = [];
    const entryIndexByBlockId = new Map();
    for (const section of document.sections) {
        for (const block of section.blocks) {
            const text = isFlowTextBlock(block) ? getFlowBlockText(block, languageKey) : '';
            const segments = isFlowTextBlock(block) ? segmentGraphemes(text, languageKey) : [];
            entryIndexByBlockId.set(block.id, entries.length);
            entries.push(Object.freeze({ section, block, text, segments }));
        }
    }
    return Object.freeze({
        entries: Object.freeze(entries),
        entryIndexByBlockId,
    });
}

function createSourceCursor(source, entryIndex, graphemeOffset = 0) {
    if (entryIndex >= source.entries.length) {
        return Object.freeze({
            sectionId: null,
            blockId: null,
            blockType: null,
            blockIndex: source.entries.length,
            graphemeOffset: 0,
            atEnd: true,
        });
    }
    const entry = source.entries[entryIndex];
    return Object.freeze({
        sectionId: entry.section.id,
        blockId: entry.block.id,
        blockType: entry.block.type,
        blockIndex: entryIndex,
        graphemeOffset,
        atEnd: false,
    });
}

function cloneManualBreak(value) {
    if (!value) return null;
    return Object.freeze({ sectionId: value.sectionId, blockId: value.blockId });
}

function createCheckpoint(source, entryIndex, graphemeOffset, manualBreakBefore) {
    return Object.freeze({
        cursor: createSourceCursor(source, entryIndex, graphemeOffset),
        manualBreakBefore: cloneManualBreak(manualBreakBefore),
    });
}

function resolveStartCheckpoint(source, checkpoint) {
    if (!checkpoint) return { entryIndex: 0, graphemeOffset: 0, manualBreakBefore: null };
    const cursor = checkpoint.cursor;
    if (!cursor || typeof cursor !== 'object') {
        throw new FlowPaginationError('INVALID_CHECKPOINT', 'Flow pagination checkpoint requires a cursor.');
    }
    if (cursor.atEnd || cursor.blockId == null) {
        return {
            entryIndex: source.entries.length,
            graphemeOffset: 0,
            manualBreakBefore: cloneManualBreak(checkpoint.manualBreakBefore),
        };
    }
    const entryIndex = source.entryIndexByBlockId.get(cursor.blockId);
    if (!Number.isInteger(entryIndex)) {
        throw new FlowPaginationError('CHECKPOINT_BLOCK_MISSING', 'Checkpoint block is not present in the Flow document.', {
            blockId: cursor.blockId,
        });
    }
    const entry = source.entries[entryIndex];
    if (cursor.sectionId && cursor.sectionId !== entry.section.id) {
        throw new FlowPaginationError('CHECKPOINT_SECTION_MISMATCH', 'Checkpoint section does not match its block.', {
            blockId: cursor.blockId,
            sectionId: cursor.sectionId,
            actualSectionId: entry.section.id,
        });
    }
    const graphemeOffset = Number(cursor.graphemeOffset || 0);
    const maximum = entry.segments.length;
    if (!Number.isInteger(graphemeOffset) || graphemeOffset < 0 || graphemeOffset > maximum) {
        throw new FlowPaginationError('INVALID_CHECKPOINT_OFFSET', 'Checkpoint grapheme offset is outside its block.', {
            blockId: cursor.blockId,
            graphemeOffset,
            maximum,
        });
    }
    if (entry.block.type === 'pageBreak' && graphemeOffset !== 0) {
        throw new FlowPaginationError('INVALID_CHECKPOINT_OFFSET', 'PageBreak checkpoint offsets must be zero.', {
            blockId: cursor.blockId,
            graphemeOffset,
        });
    }
    if (entry.block.type !== 'pageBreak' && maximum > 0 && graphemeOffset === maximum) {
        return {
            entryIndex: entryIndex + 1,
            graphemeOffset: 0,
            manualBreakBefore: cloneManualBreak(checkpoint.manualBreakBefore),
        };
    }
    return {
        entryIndex,
        graphemeOffset,
        manualBreakBefore: cloneManualBreak(checkpoint.manualBreakBefore),
    };
}

function resolvePageIndexOffset(value) {
    const offset = Number(value ?? 0);
    if (!Number.isInteger(offset) || offset < 0) {
        throw new FlowPaginationError('INVALID_PAGE_INDEX_OFFSET', 'pageIndexOffset must be a non-negative integer.', {
            value,
        });
    }
    return offset;
}

/**
 * Create a resumable, page-at-a-time paginator. Checkpoints are runtime-only
 * derivations and must not be persisted as Flow source data.
 */
export function createFlowPaginationIterator(document, options = {}) {
    assertValidFlowDocument(document);
    if (typeof options.measurePage !== 'function') {
        throw new FlowPaginationError('MEASURER_REQUIRED', 'measurePage is required.');
    }

    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || document.sourceLanguage || '');
    if (!languageKey) throw new FlowPaginationError('LANGUAGE_REQUIRED', 'A saved language key is required.');
    const writingMode = String(options.writingMode || DEFAULT_FLOW_WRITING_MODE);
    const maxPages = resolveMaxPages(options.maxPages);
    const pageIndexOffset = resolvePageIndexOffset(options.pageIndexOffset);
    const source = createFlowSourceEntries(document, languageKey);
    const start = resolveStartCheckpoint(source, options.startCheckpoint);
    let entryIndex = start.entryIndex;
    let graphemeOffset = start.graphemeOffset;
    let pendingManualBreakBefore = start.manualBreakBefore;
    let nextPageIndex = pageIndexOffset;
    let finished = !!options.startCheckpoint
        && entryIndex >= source.entries.length
        && !pendingManualBreakBefore;
    let learnedProbeHint = null;

    const candidateFits = (candidateFragments) => measureCandidate(options.measurePage, {
        pageBox,
        pageIndex: nextPageIndex,
        languageKey,
        writingMode,
        fragments: candidateFragments,
    });

    const emitPage = (pageStartCheckpoint, manualBreakBefore, fragments, nextCheckpoint, reachesEnd) => {
        if (nextPageIndex >= maxPages) {
            throw new FlowPaginationError('MAX_PAGES_EXCEEDED', `Flow pagination exceeded maxPages (${maxPages}).`, {
                maxPages,
                nextPageIndex,
            });
        }
        const page = Object.freeze({
            index: nextPageIndex,
            manualBreakBefore: cloneManualBreak(manualBreakBefore),
            fragments: Object.freeze([...fragments]),
        });
        nextPageIndex += 1;
        if (reachesEnd) finished = true;
        return Object.freeze({
            page,
            startCheckpoint: pageStartCheckpoint,
            nextCheckpoint,
        });
    };

    const next = () => {
        if (finished) return Object.freeze({ done: true, value: undefined });
        const pageStartCheckpoint = createCheckpoint(
            source,
            entryIndex,
            graphemeOffset,
            pendingManualBreakBefore,
        );
        const pageManualBreakBefore = pendingManualBreakBefore;
        pendingManualBreakBefore = null;
        const currentFragments = [];

        while (entryIndex < source.entries.length) {
            const entry = source.entries[entryIndex];
            const { section, block, text, segments } = entry;

            if (currentFragments.length && block.type !== 'pageBreak'
                && (currentFragments.at(-1).titleRegion?.id || '') !== (block.titleRegion?.id || '')) {
                return Object.freeze({done:false,value:emitPage(pageStartCheckpoint,pageManualBreakBefore,
                    currentFragments,createCheckpoint(source,entryIndex,graphemeOffset,null),false)});
            }
            if (block.type === 'pageBreak') {
                const manualBreak = Object.freeze({ sectionId: section.id, blockId: block.id });
                entryIndex += 1;
                graphemeOffset = 0;
                pendingManualBreakBefore = manualBreak;
                const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, manualBreak);
                return Object.freeze({
                    done: false,
                    value: emitPage(
                        pageStartCheckpoint,
                        pageManualBreakBefore,
                        currentFragments,
                        nextCheckpoint,
                        false,
                    ),
                });
            }
            if (!isFlowTextBlock(block)) {
                throw new FlowPaginationError('UNSUPPORTED_BLOCK', `Unsupported Flow block type: ${block.type}`, {
                    sectionId: section.id,
                    blockId: block.id,
                    blockType: block.type,
                });
            }

            if (segments.length === 0) {
                const emptyFragment = createFragment(section, block, languageKey, text, segments, 0, 0);
                if (!candidateFits([...currentFragments, emptyFragment])) {
                    if (currentFragments.length > 0) {
                        const nextCheckpoint = createCheckpoint(source, entryIndex, 0, null);
                        return Object.freeze({
                            done: false,
                            value: emitPage(
                                pageStartCheckpoint,
                                pageManualBreakBefore,
                                currentFragments,
                                nextCheckpoint,
                                false,
                            ),
                        });
                    }
                    throw new FlowPaginationError('FRAGMENT_DOES_NOT_FIT', 'An empty Flow block does not fit on an empty page.', {
                        sectionId: section.id,
                        blockId: block.id,
                        sourceRange: emptyFragment.sourceRange,
                    });
                }
                currentFragments.push(emptyFragment);
                entryIndex += 1;
                graphemeOffset = 0;
                continue;
            }

            const fragmentCountBefore = currentFragments.length;
            let knownFittingEnd = null;
            let knownFailureEnd = null;
            const remainingGraphemes = segments.length - graphemeOffset;
            if (
                currentFragments.length > 0
                && !(block.annotations?.[languageKey] || []).some(a=>a.type==='ruby')
                && remainingGraphemes <= DEFAULT_FLOW_INITIAL_PROBE_GRAPHEMES * 2
            ) {
                const fullFragment = createFragment(
                    section,
                    block,
                    languageKey,
                    text,
                    segments,
                    graphemeOffset,
                    segments.length,
                );
                if (candidateFits([...currentFragments, fullFragment])) {
                    currentFragments.push(fullFragment);
                    entryIndex += 1;
                    graphemeOffset = 0;
                    continue;
                }
                if (remainingGraphemes === 1) {
                    const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, null);
                    return Object.freeze({
                        done: false,
                        value: emitPage(
                            pageStartCheckpoint,
                            pageManualBreakBefore,
                            currentFragments,
                            nextCheckpoint,
                            false,
                        ),
                    });
                }
                const oneGraphemeFragment = createFragment(
                    section,
                    block,
                    languageKey,
                    text,
                    segments,
                    graphemeOffset,
                    graphemeOffset + 1,
                );
                if (!candidateFits([...currentFragments, oneGraphemeFragment])) {
                    const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, null);
                    return Object.freeze({
                        done: false,
                        value: emitPage(
                            pageStartCheckpoint,
                            pageManualBreakBefore,
                            currentFragments,
                            nextCheckpoint,
                            false,
                        ),
                    });
                }
                knownFittingEnd = graphemeOffset + 1;
                knownFailureEnd = segments.length;
            }
            const endGrapheme = findLargestFittingEnd({
                section,
                block,
                languageKey,
                text,
                segments,
                startGrapheme: graphemeOffset,
                probeHint: learnedProbeHint ?? options.initialProbeGraphemes,
                probeHintIsLearned: learnedProbeHint !== null,
                knownFittingEnd,
                knownFailureEnd,
                measure: (fragment) => candidateFits([...currentFragments, fragment]),
            });
            if (endGrapheme <= graphemeOffset) {
                if (currentFragments.length > 0) {
                    const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, null);
                    return Object.freeze({
                        done: false,
                        value: emitPage(
                            pageStartCheckpoint,
                            pageManualBreakBefore,
                            currentFragments,
                            nextCheckpoint,
                            false,
                        ),
                    });
                }
                const failed = createFragment(
                    section,
                    block,
                    languageKey,
                    text,
                    segments,
                    graphemeOffset,
                    graphemeOffset + 1,
                );
                throw new FlowPaginationError('FRAGMENT_DOES_NOT_FIT', 'One grapheme does not fit on an empty Flow page.', {
                    sectionId: section.id,
                    blockId: block.id,
                    sourceRange: failed.sourceRange,
                });
            }

            currentFragments.push(createFragment(
                section,
                block,
                languageKey,
                text,
                segments,
                graphemeOffset,
                endGrapheme,
            ));
            const fittedCount = endGrapheme - graphemeOffset;
            if (fragmentCountBefore === 0 && endGrapheme < segments.length) learnedProbeHint = fittedCount;
            graphemeOffset = endGrapheme;
            if (graphemeOffset < segments.length) {
                const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, null);
                return Object.freeze({
                    done: false,
                    value: emitPage(
                        pageStartCheckpoint,
                        pageManualBreakBefore,
                        currentFragments,
                        nextCheckpoint,
                        false,
                    ),
                });
            }
            entryIndex += 1;
            graphemeOffset = 0;
        }

        const nextCheckpoint = createCheckpoint(source, entryIndex, graphemeOffset, null);
        return Object.freeze({
            done: false,
            value: emitPage(
                pageStartCheckpoint,
                pageManualBreakBefore,
                currentFragments,
                nextCheckpoint,
                true,
            ),
        });
    };

    return Object.freeze({
        documentId: document.id,
        languageKey,
        writingMode,
        pageBox,
        next,
    });
}

/**
 * @param {object} document valid FlowDocument
 * @param {object} options
 * @param {object} options.pageBox explicit logical page geometry
 * @param {(context: object) => {fits:boolean}} options.measurePage synchronous, deterministic, prefix-monotonic measurer
 */
export function paginateFlowDocument(document, options = {}) {
    const iterator = createFlowPaginationIterator(document, options);
    const pages = [];
    while (true) {
        const next = iterator.next();
        if (next.done) break;
        pages.push(next.value.page);
    }
    return Object.freeze({
        documentId: document.id,
        languageKey: iterator.languageKey,
        writingMode: iterator.writingMode,
        pageBox: iterator.pageBox,
        pages: Object.freeze(pages),
    });
}
