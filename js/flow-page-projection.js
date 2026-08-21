/**
 * Pure runtime projection for a mixed Project v6 authoring spine.
 *
 * Fixed pages and Flow generated pages share one ordered presentation list,
 * but the generated pages are never written back into Project data.
 */

export const FLOW_PAGE_PROJECTION_VERSION = 1;

export class FlowPageProjectionError extends Error {
    constructor(code, message, context = {}) {
        super(message);
        this.name = 'FlowPageProjectionError';
        this.code = code;
        this.context = context;
    }
}

function requireArray(value, path) {
    if (!Array.isArray(value)) {
        throw new FlowPageProjectionError('INVALID_PROJECTION_INPUT', `${path} must be an array.`, {
            path,
            value,
        });
    }
    return value;
}

function getFlowResult(flowResults, groupId) {
    if (flowResults instanceof Map) return flowResults.get(groupId);
    if (flowResults && typeof flowResults === 'object') return flowResults[groupId];
    return undefined;
}

function hashRuntimePage(page) {
    const source = JSON.stringify([
        page?.manualBreakBefore || null,
        (Array.isArray(page?.fragments) ? page.fragments : []).map((fragment) => [
            fragment?.blockId || '',
            fragment?.blockType || '',
            fragment?.sourceRange?.start ?? null,
            fragment?.sourceRange?.end ?? null,
            fragment?.text || '',
        ]),
    ]);
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

function getRuntimePageAnchor(page) {
    if (page?.manualBreakBefore?.blockId) return `break:${page.manualBreakBefore.blockId}`;
    const first = Array.isArray(page?.fragments) ? page.fragments[0] : null;
    if (first) {
        return `source:${first.sectionId || ''}:${first.blockId || ''}:${first.sourceRange?.startGrapheme ?? 0}`;
    }
    return 'document-start';
}

function createFixedCell(block, blockIndex, fixedPageIndex, section, globalIndex) {
    return Object.freeze({
        kind: 'fixed',
        runtimeKey: `fixed:${block.id}`,
        index: globalIndex,
        physicalPageNumber: globalIndex + 1,
        blockIndex,
        blockId: block.id,
        fixedPageIndex,
        section,
    });
}

function createFlowCell(group, blockIndex, result, flowPageIndex, globalIndex, requestedLanguageKey) {
    const page = result.pagination.pages[flowPageIndex];
    return Object.freeze({
        kind: 'flow',
        runtimeKey: `flow:${group.id}:${result.languageKey}:${getRuntimePageAnchor(page)}:${hashRuntimePage(page)}`,
        index: globalIndex,
        physicalPageNumber: globalIndex + 1,
        blockIndex,
        blockId: group.id,
        groupId: group.id,
        documentId: group.flow.document.id,
        requestedLanguageKey,
        languageKey: result.languageKey,
        isSourceFallback: result.isSourceFallback === true,
        flowPageIndex,
        flowPageNumber: flowPageIndex + 1,
        flowPageCount: result.pagination.pages.length,
        page,
        pageBox: result.pageBox,
        writingMode: result.writingMode,
        typography: result.typography,
    });
}

/**
 * Merge Fixed compatibility pages and per-group Flow pagination results.
 * Structural authoring blocks do not create presentation pages.
 */
export function buildFlowPageProjection(options = {}) {
    const blocks = requireArray(options.blocks, 'blocks');
    const fixedPages = requireArray(options.fixedPages, 'fixedPages');
    const requestedLanguageKey = String(options.requestedLanguageKey || options.languageKey || '');
    if (!requestedLanguageKey) {
        throw new FlowPageProjectionError(
            'LANGUAGE_REQUIRED',
            'A saved language key is required for Flow page projection.',
        );
    }

    const pages = [];
    const flowGroups = [];
    let fixedPageIndex = 0;
    let flowPageCount = 0;

    blocks.forEach((block, blockIndex) => {
        if (!block || typeof block !== 'object') {
            throw new FlowPageProjectionError('INVALID_AUTHORING_BLOCK', 'Authoring blocks must be objects.', {
                blockIndex,
            });
        }
        if (block.kind === 'page') {
            if (fixedPageIndex >= fixedPages.length) {
                throw new FlowPageProjectionError(
                    'FIXED_PAGE_COUNT_MISMATCH',
                    'Fixed page blocks and compatibility pages must have the same count.',
                    { fixedPageIndex, fixedPageCount: fixedPages.length },
                );
            }
            pages.push(createFixedCell(
                block,
                blockIndex,
                fixedPageIndex,
                fixedPages[fixedPageIndex],
                pages.length,
            ));
            fixedPageIndex += 1;
            return;
        }
        if (block.kind !== 'flow') return;

        const result = getFlowResult(options.flowResults, block.id);
        if (!result) {
            throw new FlowPageProjectionError(
                'FLOW_RESULT_MISSING',
                `Flow pagination is missing for group ${block.id}.`,
                { blockIndex, groupId: block.id, requestedLanguageKey },
            );
        }
        if (
            result.requestedLanguageKey !== requestedLanguageKey
            || result.pagination?.languageKey !== result.languageKey
        ) {
            throw new FlowPageProjectionError(
                'FLOW_LANGUAGE_MISMATCH',
                `Flow pagination language does not match ${requestedLanguageKey}.`,
                {
                    blockIndex,
                    groupId: block.id,
                    requestedLanguageKey,
                    resultRequestedLanguageKey: result.requestedLanguageKey,
                    resultLanguageKey: result.languageKey,
                    paginationLanguageKey: result.pagination?.languageKey,
                },
            );
        }
        const generatedPages = requireArray(result.pagination?.pages, `flowResults.${block.id}.pagination.pages`);
        if (generatedPages.length === 0) {
            throw new FlowPageProjectionError(
                'FLOW_RESULT_EMPTY',
                `Flow pagination must contain at least one page for group ${block.id}.`,
                { blockIndex, groupId: block.id, requestedLanguageKey },
            );
        }
        const firstPageIndex = pages.length;
        generatedPages.forEach((_page, flowPageIndex) => {
            pages.push(createFlowCell(
                block,
                blockIndex,
                result,
                flowPageIndex,
                pages.length,
                requestedLanguageKey,
            ));
        });
        flowPageCount += generatedPages.length;
        flowGroups.push(Object.freeze({
            groupId: block.id,
            documentId: block.flow.document.id,
            blockIndex,
            firstPageIndex,
            pageCount: generatedPages.length,
            requestedLanguageKey: result.requestedLanguageKey,
            languageKey: result.languageKey,
            isSourceFallback: result.isSourceFallback === true,
            changeSet: result.changeSet || null,
            metrics: result.metrics || null,
        }));
    });

    if (fixedPageIndex !== fixedPages.length) {
        throw new FlowPageProjectionError(
            'FIXED_PAGE_COUNT_MISMATCH',
            'Fixed page blocks and compatibility pages must have the same count.',
            { fixedPageIndex, fixedPageCount: fixedPages.length },
        );
    }

    return Object.freeze({
        schemaVersion: FLOW_PAGE_PROJECTION_VERSION,
        languageKey: requestedLanguageKey,
        pages: Object.freeze(pages),
        flowGroups: Object.freeze(flowGroups),
        fixedPageCount: fixedPageIndex,
        flowPageCount,
        totalPageCount: pages.length,
    });
}

export function getFlowGroupProjectionPages(projection, groupId) {
    if (!projection || !Array.isArray(projection.pages)) return [];
    return projection.pages.filter((page) => page.kind === 'flow' && page.groupId === groupId);
}
