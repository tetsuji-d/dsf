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
    measure,
}) {
    let low = startGrapheme + 1;
    let high = segments.length;
    let best = startGrapheme;
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

/**
 * @param {object} document valid FlowDocument
 * @param {object} options
 * @param {object} options.pageBox explicit logical page geometry
 * @param {(context: object) => {fits:boolean}} options.measurePage synchronous, deterministic, prefix-monotonic measurer
 */
export function paginateFlowDocument(document, options = {}) {
    assertValidFlowDocument(document);
    if (typeof options.measurePage !== 'function') {
        throw new FlowPaginationError('MEASURER_REQUIRED', 'measurePage is required.');
    }

    const pageBox = normalizeFlowPageBox(options.pageBox);
    const languageKey = String(options.languageKey || document.sourceLanguage || '');
    if (!languageKey) throw new FlowPaginationError('LANGUAGE_REQUIRED', 'A saved language key is required.');
    const writingMode = String(options.writingMode || DEFAULT_FLOW_WRITING_MODE);
    const maxPages = resolveMaxPages(options.maxPages);
    const pages = [];
    let currentFragments = [];
    let currentManualBreakBefore = null;

    const pushCurrentPage = () => {
        if (pages.length >= maxPages) {
            throw new FlowPaginationError('MAX_PAGES_EXCEEDED', `Flow pagination exceeded maxPages (${maxPages}).`, {
                maxPages,
                nextPageIndex: pages.length,
            });
        }
        pages.push(Object.freeze({
            index: pages.length,
            manualBreakBefore: currentManualBreakBefore,
            fragments: Object.freeze([...currentFragments]),
        }));
        currentFragments = [];
        currentManualBreakBefore = null;
    };

    const candidateFits = (candidateFragments) => measureCandidate(options.measurePage, {
        pageBox,
        pageIndex: pages.length,
        languageKey,
        writingMode,
        fragments: candidateFragments,
    });

    for (const section of document.sections) {
        for (const block of section.blocks) {
            if (block.type === 'pageBreak') {
                pushCurrentPage();
                currentManualBreakBefore = Object.freeze({ sectionId: section.id, blockId: block.id });
                continue;
            }
            if (!isFlowTextBlock(block)) {
                throw new FlowPaginationError('UNSUPPORTED_BLOCK', `Unsupported Flow block type: ${block.type}`, {
                    sectionId: section.id,
                    blockId: block.id,
                    blockType: block.type,
                });
            }

            const text = getFlowBlockText(block, languageKey);
            const segments = segmentGraphemes(text, languageKey);
            if (segments.length === 0) {
                const emptyFragment = createFragment(section, block, languageKey, text, segments, 0, 0);
                if (!candidateFits([...currentFragments, emptyFragment])) {
                    if (currentFragments.length > 0) pushCurrentPage();
                    if (!candidateFits([emptyFragment])) {
                        throw new FlowPaginationError('FRAGMENT_DOES_NOT_FIT', 'An empty Flow block does not fit on an empty page.', {
                            sectionId: section.id,
                            blockId: block.id,
                            sourceRange: emptyFragment.sourceRange,
                        });
                    }
                }
                currentFragments.push(emptyFragment);
                continue;
            }

            let startGrapheme = 0;
            while (startGrapheme < segments.length) {
                const fullFragment = createFragment(
                    section,
                    block,
                    languageKey,
                    text,
                    segments,
                    startGrapheme,
                    segments.length,
                );
                if (candidateFits([...currentFragments, fullFragment])) {
                    currentFragments.push(fullFragment);
                    startGrapheme = segments.length;
                    continue;
                }

                const endGrapheme = findLargestFittingEnd({
                    section,
                    block,
                    languageKey,
                    text,
                    segments,
                    startGrapheme,
                    measure: (fragment) => candidateFits([...currentFragments, fragment]),
                });
                if (endGrapheme <= startGrapheme) {
                    if (currentFragments.length > 0) {
                        pushCurrentPage();
                        continue;
                    }
                    const failed = createFragment(
                        section,
                        block,
                        languageKey,
                        text,
                        segments,
                        startGrapheme,
                        startGrapheme + 1,
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
                    startGrapheme,
                    endGrapheme,
                ));
                startGrapheme = endGrapheme;
                pushCurrentPage();
            }
        }
    }

    pushCurrentPage();
    return Object.freeze({
        documentId: document.id,
        languageKey,
        writingMode,
        pageBox,
        pages: Object.freeze(pages),
    });
}
