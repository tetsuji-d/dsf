/**
 * Runtime-only incremental pagination session for Flow Layout.
 *
 * The semantic FlowDocument remains authoritative. This module keeps the last
 * successful generated pages and resumable checkpoints in memory, reuses the
 * unchanged prefix, and rejoins an unchanged suffix only when both the source
 * cursor and the remaining semantic source match exactly.
 */

import {
    assertValidFlowDocument,
    getFlowBlockText,
    isFlowTextBlock,
} from './flow-document.js';
import { segmentGraphemes } from './grapheme.js';
import {
    createFlowPaginationIterator,
    FlowPaginationError,
    normalizeFlowPageBox,
} from './flow-pagination.js';
import { DEFAULT_FLOW_WRITING_MODE } from './flow-typography.js';

function createSourceIndex(document, languageKey) {
    const entries = [];
    const indexByBlockId = new Map();
    for (const section of document.sections) {
        for (const block of section.blocks) {
            const text = isFlowTextBlock(block) ? getFlowBlockText(block, languageKey) : '';
            const segments = isFlowTextBlock(block) ? segmentGraphemes(text, languageKey) : [];
            indexByBlockId.set(block.id, entries.length);
            entries.push(Object.freeze({
                sectionId: section.id,
                blockId: block.id,
                blockType: block.type,
                annotationSignature: JSON.stringify([block.annotations?.[languageKey] || [],block.titleRegion || null]),
                headingLevel: block.type === 'heading' ? block.level : null,
                text,
                segments,
            }));
        }
    }
    return Object.freeze({
        entries: Object.freeze(entries),
        indexByBlockId,
    });
}

function entryIdentityMatches(left, right) {
    return !!left && !!right
        && left.sectionId === right.sectionId
        && left.blockId === right.blockId
        && left.blockType === right.blockType
        && left.headingLevel === right.headingLevel
        && left.annotationSignature === right.annotationSignature;
}

function entryMatches(left, right) {
    return entryIdentityMatches(left, right) && left.text === right.text;
}

function graphemeText(entry, index) {
    const segment = entry.segments[index];
    return segment ? entry.text.slice(segment.index, segment.end) : '';
}

function findCommonPrefix(previousSource, nextSource) {
    const previousEntries = previousSource.entries;
    const nextEntries = nextSource.entries;
    let entryIndex = 0;
    while (entryIndex < previousEntries.length && entryIndex < nextEntries.length) {
        const previousEntry = previousEntries[entryIndex];
        const nextEntry = nextEntries[entryIndex];
        if (!entryIdentityMatches(previousEntry, nextEntry)) break;
        if (previousEntry.text === nextEntry.text) {
            entryIndex += 1;
            continue;
        }
        let graphemeOffset = 0;
        const maximum = Math.min(previousEntry.segments.length, nextEntry.segments.length);
        while (
            graphemeOffset < maximum
            && graphemeText(previousEntry, graphemeOffset) === graphemeText(nextEntry, graphemeOffset)
        ) {
            graphemeOffset += 1;
        }
        return Object.freeze({
            identical: false,
            previousBoundary: Object.freeze({ entryIndex, graphemeOffset }),
            nextBoundary: Object.freeze({ entryIndex, graphemeOffset }),
        });
    }
    const identical = entryIndex === previousEntries.length && entryIndex === nextEntries.length;
    return Object.freeze({
        identical,
        previousBoundary: Object.freeze({ entryIndex, graphemeOffset: 0 }),
        nextBoundary: Object.freeze({ entryIndex, graphemeOffset: 0 }),
    });
}

function locateCursor(source, cursor) {
    if (!cursor || cursor.atEnd || cursor.blockId == null) {
        return { entryIndex: source.entries.length, graphemeOffset: 0 };
    }
    const entryIndex = source.indexByBlockId.get(cursor.blockId);
    if (!Number.isInteger(entryIndex)) return null;
    return {
        entryIndex,
        graphemeOffset: Number(cursor.graphemeOffset || 0),
    };
}

function cursorIsStrictlyBefore(source, cursor, boundary) {
    const position = locateCursor(source, cursor);
    if (!position) return false;
    if (position.entryIndex !== boundary.entryIndex) return position.entryIndex < boundary.entryIndex;
    return position.graphemeOffset < boundary.graphemeOffset;
}

function manualBreakMatches(left, right) {
    if (!left || !right) return !left && !right;
    return left.sectionId === right.sectionId && left.blockId === right.blockId;
}

function checkpointKey(checkpoint) {
    const cursor = checkpoint?.cursor;
    const manualBreak = checkpoint?.manualBreakBefore;
    return JSON.stringify([
        cursor?.blockId ?? null,
        Number(cursor?.graphemeOffset || 0),
        cursor?.atEnd === true,
        manualBreak?.blockId ?? null,
    ]);
}

function remainingSourceMatches(previousSource, previousCheckpoint, nextSource, nextCheckpoint) {
    if (!manualBreakMatches(
        previousCheckpoint?.manualBreakBefore,
        nextCheckpoint?.manualBreakBefore,
    )) return false;
    const previousPosition = locateCursor(previousSource, previousCheckpoint?.cursor);
    const nextPosition = locateCursor(nextSource, nextCheckpoint?.cursor);
    if (!previousPosition || !nextPosition) return false;
    if (previousPosition.graphemeOffset !== nextPosition.graphemeOffset) return false;

    let previousIndex = previousPosition.entryIndex;
    let nextIndex = nextPosition.entryIndex;
    if (previousIndex >= previousSource.entries.length || nextIndex >= nextSource.entries.length) {
        return previousIndex >= previousSource.entries.length && nextIndex >= nextSource.entries.length;
    }

    const previousFirst = previousSource.entries[previousIndex];
    const nextFirst = nextSource.entries[nextIndex];
    if (!entryIdentityMatches(previousFirst, nextFirst)) return false;
    if (previousPosition.graphemeOffset > 0 || nextPosition.graphemeOffset > 0) {
        const previousSegment = previousFirst.segments[previousPosition.graphemeOffset];
        const nextSegment = nextFirst.segments[nextPosition.graphemeOffset];
        const previousOffset = previousSegment ? previousSegment.index : previousFirst.text.length;
        const nextOffset = nextSegment ? nextSegment.index : nextFirst.text.length;
        if (previousOffset !== nextOffset) return false;
        if (previousFirst.text.slice(previousOffset) !== nextFirst.text.slice(nextOffset)) return false;
        previousIndex += 1;
        nextIndex += 1;
    }

    while (previousIndex < previousSource.entries.length && nextIndex < nextSource.entries.length) {
        if (!entryMatches(previousSource.entries[previousIndex], nextSource.entries[nextIndex])) return false;
        previousIndex += 1;
        nextIndex += 1;
    }
    return previousIndex === previousSource.entries.length && nextIndex === nextSource.entries.length;
}

function freezePagination(iterator, documentId, pages) {
    return Object.freeze({
        documentId,
        languageKey: iterator.languageKey,
        writingMode: iterator.writingMode,
        pageBox: iterator.pageBox,
        pages: Object.freeze(pages),
    });
}

function reindexPage(page, index) {
    if (page.index === index) return page;
    return Object.freeze({
        index,
        manualBreakBefore: page.manualBreakBefore,
        fragments: page.fragments,
    });
}

function freezeRecord(record, page, pageVariantKey = record.pageVariantKey) {
    if (record.page === page && record.pageVariantKey === pageVariantKey) return record;
    return Object.freeze({
        page,
        startCheckpoint: record.startCheckpoint,
        nextCheckpoint: record.nextCheckpoint,
        pageVariantKey,
    });
}

function attachPageVariant(record, getPageVariantKey) {
    return Object.freeze({
        page: record.page,
        startCheckpoint: record.startCheckpoint,
        nextCheckpoint: record.nextCheckpoint,
        pageVariantKey: String(getPageVariantKey(record.page.index)),
    });
}

function resolveMeasurementKey(value, document) {
    const resolved = typeof value === 'function' ? value(document) : value;
    return String(resolved ?? 'default');
}

function normalizeMaxPages(value) {
    if (value == null) return Number.POSITIVE_INFINITY;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new FlowPaginationError('INVALID_MAX_PAGES', 'maxPages must be a positive integer.', { value });
    }
    return number;
}

function createPaginationCancellationError(code, revision) {
    const error = new Error(code === 'PAGINATION_SUPERSEDED'
        ? 'Flow pagination was superseded by a newer operation.'
        : 'Flow pagination was aborted.');
    error.name = 'AbortError';
    error.code = code;
    error.revision = revision;
    return error;
}

function normalizePositiveInteger(value, fallback, path) {
    if (value == null) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new FlowPaginationError('INVALID_ASYNC_OPTION', `${path} must be a positive integer.`, {
            path,
            value,
        });
    }
    return number;
}

function normalizeNonNegativeNumber(value, fallback, path) {
    if (value == null) return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new FlowPaginationError('INVALID_ASYNC_OPTION', `${path} must be a non-negative number.`, {
            path,
            value,
        });
    }
    return number;
}

function defaultNow() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function defaultYieldScheduler() {
    if (typeof globalThis.setTimeout === 'function') {
        return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
    return Promise.resolve();
}

function waitForYieldScheduler(yieldScheduler, progress, signal, revision) {
    const scheduled = Promise.resolve().then(() => yieldScheduler(progress));
    if (!signal) return scheduled;
    if (signal.aborted) {
        return Promise.reject(createPaginationCancellationError('PAGINATION_ABORTED', revision));
    }
    return new Promise((resolve, reject) => {
        const handleAbort = () => {
            signal.removeEventListener('abort', handleAbort);
            reject(createPaginationCancellationError('PAGINATION_ABORTED', revision));
        };
        signal.addEventListener('abort', handleAbort, { once: true });
        scheduled.then(
            (value) => {
                signal.removeEventListener('abort', handleAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', handleAbort);
                reject(error);
            },
        );
    });
}

/** Create one in-memory incremental paginator. No cache is persisted. */
export function createIncrementalFlowPaginator(options = {}) {
    if (typeof options.measurePage !== 'function') {
        throw new FlowPaginationError('MEASURER_REQUIRED', 'measurePage is required.');
    }
    const normalizedPageBox = normalizeFlowPageBox(options.pageBox);
    const pageBoxKey = JSON.stringify(normalizedPageBox);
    const writingMode = String(options.writingMode || DEFAULT_FLOW_WRITING_MODE);
    const getPageVariantKey = typeof options.getPageVariantKey === 'function'
        ? options.getPageVariantKey
        : (pageIndex) => String(pageIndex);
    const maxPages = normalizeMaxPages(options.maxPages);
    let snapshot = null;
    let snapshotVersion = 0;
    let operationGeneration = 0;

    const runFull = function* runFull(document, context, baseSnapshot) {
        let measureCallCount = 0;
        const iterator = createFlowPaginationIterator(document, {
            pageBox: normalizedPageBox,
            languageKey: context.languageKey,
            writingMode,
            maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
            initialProbeGraphemes: options.initialProbeGraphemes,
            measurePage(measureContext) {
                measureCallCount += 1;
                return options.measurePage(measureContext);
            },
        });
        const records = [];
        while (true) {
            const next = iterator.next();
            if (next.done) break;
            records.push(attachPageVariant(next.value, getPageVariantKey));
            yield Object.freeze({
                mode: 'full',
                generatedPageCount: records.length,
                measureCallCount,
                prefixPageCount: 0,
            });
        }
        const pages = records.map((record) => record.page);
        const pagination = freezePagination(iterator, document.id, pages);
        const previousPageCount = baseSnapshot?.pagination.pages.length || 0;
        const changeSet = Object.freeze({
            prefixPageCount: 0,
            oldMiddlePageCount: previousPageCount,
            newMiddlePageCount: pages.length,
            suffixPageCount: 0,
            measuredPageCount: pages.length,
            measureCallCount,
            mode: 'full',
        });
        const nextSnapshot = Object.freeze({
            documentId: document.id,
            measurementKey: context.measurementKey,
            languageKey: context.languageKey,
            pageBoxKey,
            writingMode,
            source: context.source,
            records: Object.freeze(records),
            pagination,
        });
        return Object.freeze({
            result: Object.freeze({ pagination, changeSet }),
            nextSnapshot,
        });
    };

    const createRun = (document, baseSnapshot) => {
        assertValidFlowDocument(document);
        const languageKey = String(options.languageKey || document.sourceLanguage || '');
        if (!languageKey) throw new FlowPaginationError('LANGUAGE_REQUIRED', 'A saved language key is required.');
        const measurementKey = resolveMeasurementKey(options.measurementKey, document);
        const source = createSourceIndex(document, languageKey);
        const context = { languageKey, measurementKey, source };

        return (function* paginationRun() {
            if (
                !baseSnapshot
                || baseSnapshot.documentId !== document.id
                || baseSnapshot.measurementKey !== measurementKey
                || baseSnapshot.languageKey !== languageKey
                || baseSnapshot.pageBoxKey !== pageBoxKey
                || baseSnapshot.writingMode !== writingMode
            ) {
                return yield* runFull(document, context, baseSnapshot);
            }

            if (baseSnapshot.records.some((record, index) => (
                record.pageVariantKey !== String(getPageVariantKey(index))
            ))) {
                return yield* runFull(document, context, baseSnapshot);
            }

            const commonPrefix = findCommonPrefix(baseSnapshot.source, source);
            if (commonPrefix.identical) {
                const pageCount = baseSnapshot.pagination.pages.length;
                const result = Object.freeze({
                    pagination: baseSnapshot.pagination,
                    changeSet: Object.freeze({
                        prefixPageCount: pageCount,
                        oldMiddlePageCount: 0,
                        newMiddlePageCount: 0,
                        suffixPageCount: 0,
                        measuredPageCount: 0,
                        measureCallCount: 0,
                        mode: 'unchanged',
                    }),
                });
                return Object.freeze({ result, nextSnapshot: baseSnapshot });
            }

            let prefixPageCount = 0;
            while (
                prefixPageCount < baseSnapshot.records.length
                && cursorIsStrictlyBefore(
                    baseSnapshot.source,
                    baseSnapshot.records[prefixPageCount].nextCheckpoint.cursor,
                    commonPrefix.previousBoundary,
                )
            ) {
                prefixPageCount += 1;
            }

            const startCheckpoint = prefixPageCount > 0
                ? baseSnapshot.records[prefixPageCount]?.startCheckpoint || null
                : null;
            const oldCheckpointMap = new Map();
            for (let index = prefixPageCount; index < baseSnapshot.records.length; index += 1) {
                const checkpoint = baseSnapshot.records[index].startCheckpoint;
                if (checkpoint.cursor.atEnd && !checkpoint.manualBreakBefore) continue;
                const key = checkpointKey(checkpoint);
                const indices = oldCheckpointMap.get(key) || [];
                indices.push(index);
                oldCheckpointMap.set(key, indices);
            }

            let measureCallCount = 0;
            let iterator;
            try {
                iterator = createFlowPaginationIterator(document, {
                    pageBox: normalizedPageBox,
                    languageKey,
                    writingMode,
                    maxPages: Number.isFinite(maxPages) ? maxPages : undefined,
                    pageIndexOffset: prefixPageCount,
                    startCheckpoint,
                    initialProbeGraphemes: options.initialProbeGraphemes,
                    measurePage(measureContext) {
                        measureCallCount += 1;
                        return options.measurePage(measureContext);
                    },
                });
            } catch (error) {
                if (
                    error instanceof FlowPaginationError
                    && ['CHECKPOINT_BLOCK_MISSING', 'CHECKPOINT_SECTION_MISMATCH', 'INVALID_CHECKPOINT_OFFSET'].includes(error.code)
                ) {
                    return yield* runFull(document, context, baseSnapshot);
                }
                throw error;
            }

            const records = baseSnapshot.records.slice(0, prefixPageCount);
            let generatedPageCount = 0;
            let suffixStart = baseSnapshot.records.length;
            let converged = false;
            while (true) {
                const next = iterator.next();
                if (next.done) break;
                const nextRecord = attachPageVariant(next.value, getPageVariantKey);
                records.push(nextRecord);
                generatedPageCount += 1;
                const newSuffixPageIndex = records.length;
                const candidates = oldCheckpointMap.get(checkpointKey(next.value.nextCheckpoint)) || [];
                for (const candidateIndex of candidates) {
                    if (!remainingSourceMatches(
                        baseSnapshot.source,
                        baseSnapshot.records[candidateIndex].startCheckpoint,
                        source,
                        next.value.nextCheckpoint,
                    )) continue;
                    let variantsMatch = true;
                    for (let offset = 0; candidateIndex + offset < baseSnapshot.records.length; offset += 1) {
                        if (
                            String(getPageVariantKey(newSuffixPageIndex + offset))
                            !== baseSnapshot.records[candidateIndex + offset].pageVariantKey
                        ) {
                            variantsMatch = false;
                            break;
                        }
                    }
                    if (!variantsMatch) continue;
                    suffixStart = candidateIndex;
                    converged = true;
                    break;
                }
                yield Object.freeze({
                    mode: 'incremental',
                    generatedPageCount,
                    measureCallCount,
                    prefixPageCount,
                });
                if (converged) break;
            }

            const suffixPageCount = converged ? baseSnapshot.records.length - suffixStart : 0;
            if (suffixPageCount > 0) {
                for (let index = suffixStart; index < baseSnapshot.records.length; index += 1) {
                    const oldRecord = baseSnapshot.records[index];
                    const page = reindexPage(oldRecord.page, records.length);
                    records.push(freezeRecord(
                        oldRecord,
                        page,
                        String(getPageVariantKey(page.index)),
                    ));
                }
            }
            if (records.length > maxPages) {
                throw new FlowPaginationError('MAX_PAGES_EXCEEDED', `Flow pagination exceeded maxPages (${maxPages}).`, {
                    maxPages,
                    nextPageIndex: maxPages,
                });
            }

            const pages = records.map((record) => record.page);
            const pagination = freezePagination(iterator, document.id, pages);
            const oldMiddlePageCount = baseSnapshot.records.length - prefixPageCount - suffixPageCount;
            const changeSet = Object.freeze({
                prefixPageCount,
                oldMiddlePageCount,
                newMiddlePageCount: generatedPageCount,
                suffixPageCount,
                measuredPageCount: generatedPageCount,
                measureCallCount,
                mode: 'incremental',
            });
            const nextSnapshot = Object.freeze({
                documentId: document.id,
                measurementKey,
                languageKey,
                pageBoxKey,
                writingMode,
                source,
                records: Object.freeze(records),
                pagination,
            });
            return Object.freeze({
                result: Object.freeze({ pagination, changeSet }),
                nextSnapshot,
            });
        }());
    };

    const assertActive = (generation, signal, revision) => {
        if (signal?.aborted) throw createPaginationCancellationError('PAGINATION_ABORTED', revision);
        if (generation !== operationGeneration) {
            throw createPaginationCancellationError('PAGINATION_SUPERSEDED', revision);
        }
    };

    const commitCompletedRun = (completed, baseSnapshot, generation, signal, revision) => {
        assertActive(generation, signal, revision);
        if (completed.nextSnapshot !== baseSnapshot) {
            snapshot = completed.nextSnapshot;
            snapshotVersion += 1;
        }
        return revision == null
            ? completed.result
            : Object.freeze({ ...completed.result, revision });
    };

    const paginate = (document) => {
        const generation = operationGeneration + 1;
        operationGeneration = generation;
        const baseSnapshot = snapshot;
        const run = createRun(document, baseSnapshot);
        let step = run.next();
        while (!step.done) step = run.next();
        return commitCompletedRun(step.value, baseSnapshot, generation, null, null);
    };

    const paginateAsync = async (document, asyncOptions = {}) => {
        const generation = operationGeneration + 1;
        operationGeneration = generation;
        const baseSnapshot = snapshot;
        const baseSnapshotVersion = snapshotVersion;
        const revision = asyncOptions.revision;
        const signal = asyncOptions.signal;
        const maxPagesPerChunk = normalizePositiveInteger(
            asyncOptions.maxPagesPerChunk ?? options.asyncMaxPagesPerChunk,
            1,
            'maxPagesPerChunk',
        );
        const chunkBudgetMs = normalizeNonNegativeNumber(
            asyncOptions.chunkBudgetMs ?? options.asyncChunkBudgetMs,
            8,
            'chunkBudgetMs',
        );
        const now = asyncOptions.now || options.now || defaultNow;
        const yieldScheduler = asyncOptions.yieldScheduler
            || options.yieldScheduler
            || defaultYieldScheduler;
        const onProgress = typeof asyncOptions.onProgress === 'function'
            ? asyncOptions.onProgress
            : null;
        if (typeof now !== 'function' || typeof yieldScheduler !== 'function') {
            throw new FlowPaginationError('INVALID_ASYNC_OPTION', 'now and yieldScheduler must be functions.');
        }

        assertActive(generation, signal, revision);
        const run = createRun(document, baseSnapshot);
        let step;
        let pagesSinceYield = 0;
        let chunkStartedAt = now();
        while (true) {
            assertActive(generation, signal, revision);
            step = run.next();
            assertActive(generation, signal, revision);
            if (step.done) break;
            pagesSinceYield += 1;
            const elapsedMs = Math.max(0, now() - chunkStartedAt);
            const progress = Object.freeze({
                revision,
                baseSnapshotVersion,
                generatedPageCount: step.value.generatedPageCount,
                pagesSinceYield,
                measureCallCount: step.value.measureCallCount,
                prefixPageCount: step.value.prefixPageCount,
                mode: step.value.mode,
                elapsedMs,
            });
            onProgress?.(progress);
            if (pagesSinceYield < maxPagesPerChunk && elapsedMs < chunkBudgetMs) continue;
            assertActive(generation, signal, revision);
            await waitForYieldScheduler(yieldScheduler, progress, signal, revision);
            assertActive(generation, signal, revision);
            pagesSinceYield = 0;
            chunkStartedAt = now();
        }
        return commitCompletedRun(step.value, baseSnapshot, generation, signal, revision);
    };

    return Object.freeze({
        paginate,
        paginateAsync,
        invalidate() {
            operationGeneration += 1;
            snapshot = null;
            snapshotVersion += 1;
        },
        getSnapshot() {
            if (!snapshot) return null;
            return Object.freeze({
                version: snapshotVersion,
                documentId: snapshot.documentId,
                measurementKey: snapshot.measurementKey,
                languageKey: snapshot.languageKey,
                pageCount: snapshot.pagination.pages.length,
            });
        },
    });
}
