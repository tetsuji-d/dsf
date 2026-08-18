import assert from 'node:assert/strict';
import { createIncrementalFlowPaginator } from '../js/flow-incremental-pagination.js';
import { countGraphemes } from '../js/grapheme.js';
import {
    createCanonicalFlowPageBox,
    createFlowPaginationIterator,
    paginateFlowDocument,
} from '../js/flow-pagination.js';
import {
    createFlowPreviewDocument,
    createFlowPreviewSourceState,
    FLOW_PREVIEW_PAGE_BREAK_MARKER,
    reconcileFlowPreviewSourceState,
} from '../js/flow-preview-model.js';

const pageBox = createCanonicalFlowPageBox();

function createCapacityMeasurer(capacity, metrics = null, expectedWritingMode = null) {
    return ({ fragments, writingMode }) => {
        if (expectedWritingMode) assert.equal(writingMode, expectedWritingMode);
        const used = fragments.reduce((total, fragment) => (
            total + Math.max(1, countGraphemes(fragment.text, fragment.languageKey))
        ), 0);
        if (metrics) {
            metrics.calls += 1;
            metrics.candidateGraphemes += used;
        }
        return { fits: used <= capacity };
    };
}

function createDocument(blocks) {
    return {
        schemaVersion: 1,
        layoutType: 'flow',
        id: 'incremental-document',
        sourceLanguage: 'ja',
        sections: [{
            id: 'incremental-section',
            title: {},
            blocks,
        }],
    };
}

function paragraph(id, text) {
    return { id, type: 'paragraph', texts: { ja: text } };
}

function pageBreak(id) {
    return { id, type: 'pageBreak' };
}

function assertMatchesCold(session, document, measurePage, writingMode = 'horizontal-tb') {
    const incremental = session.paginate(document);
    const cold = paginateFlowDocument(document, {
        pageBox,
        languageKey: 'ja',
        writingMode,
        measurePage,
    });
    assert.deepEqual(incremental.pagination, cold);
    return incremental;
}

// Preview reconciliation keeps identity through edits, splits, merges, and duplicate lines.
let sourceState = createFlowPreviewSourceState('A\nB\nC');
const originalIds = sourceState.blocks.map((block) => block.id);
sourceState = reconcileFlowPreviewSourceState(sourceState, 'X\nA\nB\nC');
assert.deepEqual(sourceState.blocks.slice(1).map((block) => block.id), originalIds);
const insertedId = sourceState.blocks[0].id;
sourceState = reconcileFlowPreviewSourceState(sourceState, 'X\nA\nB edited\nC');
assert.equal(sourceState.blocks[3].id, originalIds[2]);
assert.equal(sourceState.blocks[2].id, originalIds[1]);
sourceState = reconcileFlowPreviewSourceState(sourceState, 'X\nA\nB left\nB right\nC');
assert.equal(sourceState.blocks[2].id, originalIds[1]);
const splitRightId = sourceState.blocks[3].id;
assert.notEqual(splitRightId, originalIds[1]);
sourceState = reconcileFlowPreviewSourceState(sourceState, 'X\nA\nB merged\nC');
assert.equal(sourceState.blocks[2].id, originalIds[1]);
assert.equal(sourceState.blocks[3].id, originalIds[2]);
assert.equal(sourceState.blocks[0].id, insertedId);

let duplicateState = createFlowPreviewSourceState('same\nsame\nend');
const duplicateIds = duplicateState.blocks.map((block) => block.id);
duplicateState = reconcileFlowPreviewSourceState(duplicateState, 'same\nnew\nsame\nend');
assert.equal(duplicateState.blocks[0].id, duplicateIds[0]);
assert.equal(duplicateState.blocks[2].id, duplicateIds[1]);
assert.equal(duplicateState.blocks[3].id, duplicateIds[2]);

let breakState = createFlowPreviewSourceState('A\nB');
breakState = reconcileFlowPreviewSourceState(breakState, `A\n${FLOW_PREVIEW_PAGE_BREAK_MARKER}\nB`);
const firstBreakId = breakState.blocks[1].id;
breakState = reconcileFlowPreviewSourceState(breakState, 'A\nB');
breakState = reconcileFlowPreviewSourceState(breakState, `A\n${FLOW_PREVIEW_PAGE_BREAK_MARKER}\nB`);
assert.notEqual(breakState.blocks[1].id, firstBreakId);
assert.deepEqual(
    createFlowPreviewDocument({ heading: '', sourceState: breakState }).sections[0].blocks.map((block) => block.id),
    breakState.blocks.map((block) => block.id),
);

// Incremental results are always identical to a cold pagination result.
const capacity = 10;
const measurePage = createCapacityMeasurer(capacity);
const session = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
    measurementKey: 'capacity-10',
    getPageVariantKey: () => 'uniform',
});

const baseDocument = createDocument([
    paragraph('p-a', 'A'.repeat(18)),
    paragraph('p-b', 'B'.repeat(18)),
    pageBreak('break-1'),
    paragraph('p-c', 'C'.repeat(18)),
    paragraph('p-empty', ''),
]);
const initial = assertMatchesCold(session, baseDocument, measurePage);
assert.equal(initial.changeSet.mode, 'full');
const unchanged = session.paginate(structuredClone(baseDocument));
assert.equal(unchanged.pagination, initial.pagination);
assert.equal(unchanged.changeSet.mode, 'unchanged');
assert.equal(unchanged.changeSet.measureCallCount, 0);

const endEdited = structuredClone(baseDocument);
endEdited.sections[0].blocks[4].texts.ja = '末尾';
const endResult = assertMatchesCold(session, endEdited, measurePage);
assert.equal(endResult.changeSet.mode, 'incremental');
assert.ok(endResult.changeSet.prefixPageCount > 0);

const middleEdited = structuredClone(endEdited);
middleEdited.sections[0].blocks[1].texts.ja = `XX${middleEdited.sections[0].blocks[1].texts.ja.slice(2)}`;
const middleResult = assertMatchesCold(session, middleEdited, measurePage);
assert.ok(middleResult.changeSet.suffixPageCount > 0);

const breakRemoved = structuredClone(middleEdited);
breakRemoved.sections[0].blocks = breakRemoved.sections[0].blocks.filter((block) => block.id !== 'break-1');
assertMatchesCold(session, breakRemoved, measurePage);

const consecutiveBreaks = structuredClone(breakRemoved);
consecutiveBreaks.sections[0].blocks.splice(2, 0, pageBreak('break-a'), pageBreak('break-b'));
assertMatchesCold(session, consecutiveBreaks, measurePage);

const prepended = structuredClone(consecutiveBreaks);
prepended.sections[0].blocks.unshift(paragraph('p-new', '先頭追加'));
assertMatchesCold(session, prepended, measurePage);

// Vertical writing uses the same source/checkpoint invariants and remains cold-equivalent.
const verticalMeasure = createCapacityMeasurer(10, null, 'vertical-rl');
const verticalSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'vertical-rl',
    measurePage: verticalMeasure,
    measurementKey: 'vertical-capacity-10',
    getPageVariantKey: () => 'uniform',
});
assert.equal(
    assertMatchesCold(verticalSession, baseDocument, verticalMeasure, 'vertical-rl').changeSet.mode,
    'full',
);
const verticalEdited = structuredClone(baseDocument);
verticalEdited.sections[0].blocks.unshift(paragraph('vertical-prefix', '縦書き追加'));
verticalEdited.sections[0].blocks[2].texts.ja += '編集';
assert.equal(
    assertMatchesCold(verticalSession, verticalEdited, verticalMeasure, 'vertical-rl').changeSet.mode,
    'incremental',
);
const verticalBreakEdited = structuredClone(verticalEdited);
verticalBreakEdited.sections[0].blocks.splice(4, 0, pageBreak('vertical-break'));
assertMatchesCold(verticalSession, verticalBreakEdited, verticalMeasure, 'vertical-rl');

// A large paragraph edited at the end reuses its unaffected prefix pages.
const largeMeasure = createCapacityMeasurer(100);
const largeSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: largeMeasure,
    measurementKey: 'capacity-100',
    getPageVariantKey: () => 'uniform',
});
const largeDocument = createDocument([paragraph('p-large', '頁'.repeat(10_000))]);
largeSession.paginate(largeDocument);
const largeEdited = structuredClone(largeDocument);
largeEdited.sections[0].blocks[0].texts.ja += '追記';
const largeResult = assertMatchesCold(largeSession, largeEdited, largeMeasure);
assert.ok(largeResult.changeSet.prefixPageCount >= 98);
assert.ok(largeResult.changeSet.measuredPageCount <= 2);

// Layout/font epoch changes force a cold pagination, without corrupting the prior snapshot.
let measurementEpoch = 1;
const epochSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
    measurementKey: () => `epoch-${measurementEpoch}`,
    getPageVariantKey: () => 'uniform',
});
epochSession.paginate(baseDocument);
measurementEpoch += 1;
assert.equal(epochSession.paginate(baseDocument).changeSet.mode, 'full');
assert.throws(() => epochSession.paginate({ ...baseDocument, layoutType: 'fixed' }));
assert.equal(epochSession.paginate(baseDocument).changeSet.mode, 'unchanged');

const normalizedCheckpointIterator = createFlowPaginationIterator(createDocument([
    paragraph('checkpoint-a', 'A'),
    paragraph('checkpoint-b', 'B'),
]), {
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
    startCheckpoint: {
        cursor: {
            sectionId: 'incremental-section',
            blockId: 'checkpoint-a',
            blockType: 'paragraph',
            blockIndex: 0,
            graphemeOffset: 1,
            atEnd: false,
        },
        manualBreakBefore: null,
    },
});
assert.equal(normalizedCheckpointIterator.next().value.page.fragments[0].blockId, 'checkpoint-b');

const terminalDocument = createDocument([paragraph('terminal-paragraph', 'A')]);
const terminalIterator = createFlowPaginationIterator(terminalDocument, {
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
});
const terminalCheckpoint = terminalIterator.next().value.nextCheckpoint;
const resumedTerminalIterator = createFlowPaginationIterator(terminalDocument, {
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
    pageIndexOffset: 1,
    startCheckpoint: terminalCheckpoint,
});
assert.equal(resumedTerminalIterator.next().done, true);

const utf16Measure = createCapacityMeasurer(1);
const utf16Session = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: utf16Measure,
    measurementKey: 'utf16-capacity-1',
    getPageVariantKey: () => 'uniform',
});
utf16Session.paginate(createDocument([paragraph('utf16-paragraph', 'ABCD')]));
const utf16Edited = createDocument([paragraph('utf16-paragraph', '👨‍👩‍👧‍👦BCD')]);
assertMatchesCold(utf16Session, utf16Edited, utf16Measure);

const cappedMeasure = createCapacityMeasurer(4);
const cappedSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: cappedMeasure,
    measurementKey: 'capped-capacity-4',
    getPageVariantKey: () => 'uniform',
    maxPages: 2,
});
const cappedBase = createDocument([paragraph('capped-paragraph', '12345678')]);
cappedSession.paginate(cappedBase);
const cappedOverflow = createDocument([paragraph('capped-paragraph', '123456789')]);
assert.throws(
    () => cappedSession.paginate(cappedOverflow),
    (error) => error?.code === 'MAX_PAGES_EXCEEDED',
);
assert.equal(cappedSession.paginate(cappedBase).changeSet.mode, 'unchanged');

let variantMode = 'plain';
const variantSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage,
    measurementKey: 'variant-layout',
    getPageVariantKey: (index) => `${variantMode}-${index}`,
});
variantSession.paginate(baseDocument);
variantMode = 'changed';
assert.equal(variantSession.paginate(baseDocument).changeSet.mode, 'full');

// Bounded probing avoids repeatedly measuring the entire remaining suffix.
const probeDocument = createDocument([paragraph('p-probe', '長'.repeat(44_000))]);
const distinctBlocks = Array.from({ length: 400 }, (_, index) => paragraph(
    `distinct-${index}`,
    `${String(index).padStart(10, '0')}${'日'.repeat(90)}`,
));
const performanceByWritingMode = {};
for (const writingMode of ['horizontal-tb', 'vertical-rl']) {
    const probeMetrics = { calls: 0, candidateGraphemes: 0 };
    const probePages = paginateFlowDocument(probeDocument, {
        pageBox,
        languageKey: 'ja',
        writingMode,
        measurePage: createCapacityMeasurer(400, probeMetrics, writingMode),
    });
    assert.equal(probePages.pages.length, 110);
    assert.ok(
        probeMetrics.candidateGraphemes <= 100_000,
        `${writingMode} candidate graphemes were ${probeMetrics.candidateGraphemes}`,
    );
    assert.ok(probeMetrics.calls <= 250, `${writingMode} measure calls were ${probeMetrics.calls}`);

    const distinctMetrics = { calls: 0, candidateGraphemes: 0 };
    const distinctPages = paginateFlowDocument(createDocument(distinctBlocks), {
        pageBox,
        languageKey: 'ja',
        writingMode,
        measurePage: createCapacityMeasurer(400, distinctMetrics, writingMode),
    });
    assert.equal(distinctPages.pages.length, 100);
    assert.ok(distinctMetrics.calls <= 650, `${writingMode} distinct calls were ${distinctMetrics.calls}`);
    assert.ok(
        distinctMetrics.candidateGraphemes <= 210_000,
        `${writingMode} distinct candidates were ${distinctMetrics.candidateGraphemes}`,
    );
    performanceByWritingMode[writingMode] = { probeMetrics, distinctMetrics };
}
assert.deepEqual(
    performanceByWritingMode['vertical-rl'],
    performanceByWritingMode['horizontal-tb'],
);

// Differential fuzz: every incremental edit must match a fresh cold layout.
let randomSeed = 0x5f3759df;
const random = () => {
    randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
    return randomSeed / 0x1_0000_0000;
};
const randomInt = (maximum) => Math.floor(random() * maximum);
const textAtoms = ['日', '本', '語', 'A', ' ', 'e\u0301', '👨‍👩‍👧‍👦', '️'];
const randomText = () => Array.from({ length: randomInt(20) }, () => textAtoms[randomInt(textAtoms.length)]).join('');
let randomId = 1;
let randomBlocks = [paragraph(`random-${randomId}`, randomText())];
randomId += 1;
const randomMeasure = createCapacityMeasurer(17);
const randomSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: randomMeasure,
    measurementKey: 'random-capacity-17',
    getPageVariantKey: () => 'uniform',
});

for (let iteration = 0; iteration < 250; iteration += 1) {
    const operation = randomInt(5);
    if (operation === 0) {
        const paragraphIndices = randomBlocks
            .map((block, index) => block.type === 'paragraph' ? index : -1)
            .filter((index) => index >= 0);
        if (paragraphIndices.length > 0) {
            const index = paragraphIndices[randomInt(paragraphIndices.length)];
            randomBlocks[index] = paragraph(randomBlocks[index].id, randomText());
        }
    } else if (operation === 1) {
        const index = randomInt(randomBlocks.length + 1);
        randomBlocks.splice(index, 0, paragraph(`random-${randomId}`, randomText()));
        randomId += 1;
    } else if (operation === 2 && randomBlocks.length > 0) {
        randomBlocks.splice(randomInt(randomBlocks.length), 1);
    } else if (operation === 3) {
        const index = randomInt(randomBlocks.length + 1);
        randomBlocks.splice(index, 0, pageBreak(`random-break-${randomId}`));
        randomId += 1;
    } else if (operation === 4 && randomBlocks.length > 1) {
        const from = randomInt(randomBlocks.length);
        const [moved] = randomBlocks.splice(from, 1);
        randomBlocks.splice(randomInt(randomBlocks.length + 1), 0, moved);
    }

    const randomDocument = createDocument(structuredClone(randomBlocks));
    const before = JSON.stringify(randomDocument);
    const randomIncremental = randomSession.paginate(randomDocument);
    const incrementalResult = randomIncremental.pagination;
    const coldResult = paginateFlowDocument(randomDocument, {
        pageBox,
        languageKey: 'ja',
        writingMode: 'horizontal-tb',
        measurePage: randomMeasure,
    });
    assert.deepEqual(incrementalResult, coldResult, `random edit ${iteration} diverged`);
    assert.equal(JSON.stringify(randomDocument), before, `random edit ${iteration} mutated its source`);
}

// Async draining yields by page, matches cold output, and never commits cancelled work.
const asyncMeasure = createCapacityMeasurer(10);
const asyncSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
    measurementKey: 'async-capacity-10',
    getPageVariantKey: () => 'uniform',
});
const asyncDocument = createDocument([paragraph('async-large', '非'.repeat(1_000))]);
const asyncYields = [];
const asyncResult = await asyncSession.paginateAsync(asyncDocument, {
    revision: 1,
    maxPagesPerChunk: 3,
    chunkBudgetMs: 1_000_000,
    yieldScheduler(progress) {
        asyncYields.push(progress);
        return Promise.resolve();
    },
});
assert.equal(asyncResult.revision, 1);
assert.deepEqual(asyncResult.pagination, paginateFlowDocument(asyncDocument, {
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
}));
assert.ok(asyncYields.length > 0);
assert.ok(asyncYields.every((progress) => progress.pagesSinceYield <= 3));
assert.equal(asyncSession.paginate(asyncDocument).changeSet.mode, 'unchanged');

const abortBase = createDocument([paragraph('abort-large', '旧'.repeat(500))]);
const abortSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
    measurementKey: 'abort-capacity-10',
    getPageVariantKey: () => 'uniform',
});
abortSession.paginate(abortBase);
const abortVersion = abortSession.getSnapshot().version;
let releaseAbortYield;
let notifyAbortYield;
const abortYieldReached = new Promise((resolve) => { notifyAbortYield = resolve; });
const abortController = new AbortController();
const abortEdited = createDocument([
    paragraph('abort-prefix', '追加'),
    paragraph('abort-large', '旧'.repeat(500)),
]);
const abortPending = abortSession.paginateAsync(abortEdited, {
    revision: 2,
    signal: abortController.signal,
    maxPagesPerChunk: 1,
    yieldScheduler() {
        notifyAbortYield();
        return new Promise((resolve) => { releaseAbortYield = resolve; });
    },
});
await abortYieldReached;
abortController.abort();
await assert.rejects(abortPending, (error) => (
    error?.code === 'PAGINATION_ABORTED' && error?.revision === 2
));
releaseAbortYield();
assert.equal(abortSession.getSnapshot().version, abortVersion);
assert.equal(abortSession.paginate(abortBase).changeSet.mode, 'unchanged');

const schedulerFailureVersion = abortSession.getSnapshot().version;
await assert.rejects(
    abortSession.paginateAsync(abortEdited, {
        revision: 2.5,
        maxPagesPerChunk: 1,
        yieldScheduler() {
            throw new Error('scheduler failed');
        },
    }),
    /scheduler failed/,
);
assert.equal(abortSession.getSnapshot().version, schedulerFailureVersion);
assert.equal(abortSession.paginate(abortBase).changeSet.mode, 'unchanged');

const supersedeSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
    measurementKey: 'supersede-capacity-10',
    getPageVariantKey: () => 'uniform',
});
supersedeSession.paginate(abortBase);
let releaseSupersededYield;
let notifySupersededYield;
const supersededYieldReached = new Promise((resolve) => { notifySupersededYield = resolve; });
const supersededPending = supersedeSession.paginateAsync(abortEdited, {
    revision: 3,
    maxPagesPerChunk: 1,
    yieldScheduler() {
        notifySupersededYield();
        return new Promise((resolve) => { releaseSupersededYield = resolve; });
    },
});
await supersededYieldReached;
const latestDocument = createDocument([
    paragraph('abort-prefix', '最新'),
    paragraph('abort-large', '旧'.repeat(500)),
]);
const latestResult = await supersedeSession.paginateAsync(latestDocument, {
    revision: 4,
    maxPagesPerChunk: 4,
    chunkBudgetMs: 1_000_000,
    yieldScheduler: () => Promise.resolve(),
});
releaseSupersededYield();
await assert.rejects(supersededPending, (error) => (
    error?.code === 'PAGINATION_SUPERSEDED' && error?.revision === 3
));
assert.equal(latestResult.revision, 4);
assert.deepEqual(latestResult.pagination, paginateFlowDocument(latestDocument, {
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
}));
assert.equal(supersedeSession.paginate(latestDocument).changeSet.mode, 'unchanged');

let releaseSyncSupersedeYield;
let notifySyncSupersedeYield;
const syncSupersedeReached = new Promise((resolve) => { notifySyncSupersedeYield = resolve; });
const syncSupersedePending = supersedeSession.paginateAsync(abortEdited, {
    revision: 4.5,
    maxPagesPerChunk: 1,
    yieldScheduler() {
        notifySyncSupersedeYield();
        return new Promise((resolve) => { releaseSyncSupersedeYield = resolve; });
    },
});
await syncSupersedeReached;
const syncLatestResult = supersedeSession.paginate(latestDocument);
releaseSyncSupersedeYield();
await assert.rejects(syncSupersedePending, (error) => error?.code === 'PAGINATION_SUPERSEDED');
assert.equal(syncLatestResult.changeSet.mode, 'unchanged');
assert.equal(supersedeSession.paginate(latestDocument).changeSet.mode, 'unchanged');

const invalidateSession = createIncrementalFlowPaginator({
    pageBox,
    languageKey: 'ja',
    writingMode: 'horizontal-tb',
    measurePage: asyncMeasure,
    measurementKey: 'invalidate-capacity-10',
    getPageVariantKey: () => 'uniform',
});
invalidateSession.paginate(abortBase);
let releaseInvalidateYield;
let notifyInvalidateYield;
const invalidateReached = new Promise((resolve) => { notifyInvalidateYield = resolve; });
const invalidatePending = invalidateSession.paginateAsync(abortEdited, {
    revision: 4.75,
    maxPagesPerChunk: 1,
    yieldScheduler() {
        notifyInvalidateYield();
        return new Promise((resolve) => { releaseInvalidateYield = resolve; });
    },
});
await invalidateReached;
invalidateSession.invalidate();
releaseInvalidateYield();
await assert.rejects(invalidatePending, (error) => error?.code === 'PAGINATION_SUPERSEDED');
assert.equal(invalidateSession.getSnapshot(), null);

const cappedAsyncVersion = cappedSession.getSnapshot().version;
await assert.rejects(
    cappedSession.paginateAsync(cappedOverflow, {
        revision: 5,
        maxPagesPerChunk: 1,
        yieldScheduler: () => Promise.resolve(),
    }),
    (error) => error?.code === 'MAX_PAGES_EXCEEDED',
);
assert.equal(cappedSession.getSnapshot().version, cappedAsyncVersion);
assert.equal(cappedSession.paginate(cappedBase).changeSet.mode, 'unchanged');

console.log('Flow incremental pagination verification passed.');
