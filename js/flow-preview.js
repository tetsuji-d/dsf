import {
    createFlowDomPageMeasurer,
    renderFlowGeneratedPage,
    resolveFlowDomTypography,
    waitForFlowFonts,
} from './flow-dom-measurer.js';
import { createIncrementalFlowPaginator } from './flow-incremental-pagination.js';
import { createCanonicalFlowPageBox } from './flow-pagination.js';
import {
    countFlowPreviewSourceGraphemes,
    createFlowPreviewDocument,
    createFlowPreviewSourceState,
    insertFlowPreviewPageBreak,
    reconcileFlowPreviewSourceState,
} from './flow-preview-model.js';

const LANGUAGE_KEY = 'ja';
const DEFAULT_WRITING_MODE = 'horizontal-tb';
const REFLOW_DELAY_MS = 120;
const pageBox = createCanonicalFlowPageBox();
let writingMode = DEFAULT_WRITING_MODE;
let typography = resolveFlowDomTypography(LANGUAGE_KEY, {}, writingMode);

const elements = {
    app: document.getElementById('flow-preview-app'),
    heading: document.getElementById('flow-preview-heading'),
    body: document.getElementById('flow-preview-body'),
    writingModes: Array.from(document.querySelectorAll('[name="flow-preview-writing-mode"]')),
    insertBreak: document.getElementById('flow-preview-insert-break'),
    charCount: document.getElementById('flow-preview-char-count'),
    typographySummary: document.getElementById('flow-preview-typography-summary'),
    pageCount: document.getElementById('flow-preview-page-count'),
    status: document.getElementById('flow-preview-status'),
    error: document.getElementById('flow-preview-error'),
    pages: document.getElementById('flow-preview-pages'),
};

let measurer = null;
let incrementalPaginator = null;
let sourceState = null;
let reflowTimer = null;
let pendingFrame = null;
let latestPagination = null;
let latestChangeSet = null;
let latestMetrics = null;
let sourceRevision = 0;
let requestedRevision = 0;
let renderedRevision = 0;
let activeReflowController = null;
let activeReflowJobId = 0;
let nextPageNodeId = 1;
const composingTargets = new Set();
const settleWaiters = new Set();

function hasActiveComposition() {
    return composingTargets.size > 0;
}

function isPaginationCancellation(error) {
    return error?.code === 'PAGINATION_ABORTED'
        || error?.code === 'PAGINATION_SUPERSEDED'
        || error?.name === 'AbortError';
}

function yieldToBrowser() {
    return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function syncBodySourceState() {
    sourceState = sourceState
        ? reconcileFlowPreviewSourceState(sourceState, elements.body.value, { languageKey: LANGUAGE_KEY })
        : createFlowPreviewSourceState(elements.body.value, { languageKey: LANGUAGE_KEY });
    return sourceState;
}

function updateTypographySummary() {
    const label = writingMode === 'vertical-rl' ? '縦書き' : '横書き';
    elements.typographySummary.textContent = `${label} / ${typography.fontSize}px / 行高${typography.lineHeight}`;
    elements.app.dataset.writingMode = writingMode;
}

function createFlowRuntime() {
    measurer?.dispose();
    typography = resolveFlowDomTypography(LANGUAGE_KEY, {}, writingMode);
    measurer = createFlowDomPageMeasurer({
        ownerDocument: document,
        languageKey: LANGUAGE_KEY,
        writingMode,
        typography,
    });
    incrementalPaginator = createIncrementalFlowPaginator({
        pageBox,
        languageKey: LANGUAGE_KEY,
        writingMode,
        measurePage: measurer.measurePage,
        measurementKey: () => measurer.getLayoutKey(),
        getPageVariantKey: () => 'uniform',
    });
    updateTypographySummary();
}

function handleFontsLoaded() {
    measurer?.invalidate();
    incrementalPaginator?.invalidate();
    scheduleReflow({ immediate: true });
}

function setReflowState(state, message) {
    elements.app.dataset.reflowState = state;
    elements.app.dataset.sourceRevision = String(sourceRevision);
    elements.app.dataset.requestedRevision = String(requestedRevision);
    elements.app.dataset.renderedRevision = String(renderedRevision);
    elements.app.dataset.writingMode = writingMode;
    const stale = state === 'working';
    elements.app.dataset.stale = String(stale);
    elements.pages.setAttribute('aria-busy', String(stale));
    if (message) elements.status.textContent = message;
}

function resolveSettleWaiters() {
    for (const waiter of settleWaiters) {
        if (renderedRevision < waiter.revision && elements.app.dataset.reflowState !== 'error') continue;
        settleWaiters.delete(waiter);
        waiter.resolve(getFlowPreviewState());
    }
}

function getFlowPreviewState() {
    return Object.freeze({
        phase: elements.app.dataset.reflowState,
        sourceRevision,
        requestedRevision,
        renderedRevision,
        stale: elements.app.dataset.stale === 'true',
        composing: hasActiveComposition(),
        writingMode,
        pageCount: latestPagination?.pages.length || 0,
    });
}

function updateSourceStats() {
    const count = countFlowPreviewSourceGraphemes(
        elements.heading.value,
        elements.body.value,
        LANGUAGE_KEY,
    );
    elements.charCount.textContent = count.toLocaleString('ja-JP');
}

function createPageFigure(page, pagination) {
    const figure = document.createElement('figure');
    figure.className = 'flow-preview-sheet';
    figure.dataset.testid = 'flow-page';
    figure.dataset.pageIndex = String(page.index);
    figure.dataset.writingMode = pagination.writingMode;
    figure.dataset.renderNodeId = String(nextPageNodeId);
    nextPageNodeId += 1;
    figure.dataset.manualBreakBefore = page.manualBreakBefore ? 'true' : 'false';

    const header = document.createElement('div');
    header.className = 'flow-preview-sheet-header';
    const label = document.createElement('span');
    label.textContent = `Page ${page.index + 1}`;
    header.appendChild(label);
    if (page.manualBreakBefore) {
        const breakLabel = document.createElement('span');
        breakLabel.className = 'flow-preview-manual-break';
        breakLabel.textContent = '手動改ページ';
        header.appendChild(breakLabel);
    }

    const viewport = document.createElement('div');
    viewport.className = 'flow-preview-page-viewport';
    const pageElement = document.createElement('div');
    pageElement.className = 'flow-preview-page';
    renderFlowGeneratedPage(pageElement, {
        page,
        pageBox: pagination.pageBox,
        languageKey: pagination.languageKey,
        writingMode: pagination.writingMode,
        typography,
    });
    viewport.appendChild(pageElement);

    const caption = document.createElement('figcaption');
    caption.textContent = page.fragments.length
        ? `${page.fragments.length} fragment / ${page.fragments.map((fragment) => fragment.blockType).join(', ')}`
        : '空ページ';

    figure.append(header, viewport, caption);
    return figure;
}

function updatePageFigureIndex(figure, pageIndex) {
    figure.dataset.pageIndex = String(pageIndex);
    const label = figure.querySelector('.flow-preview-sheet-header > span:first-child');
    if (label) label.textContent = `Page ${pageIndex + 1}`;
}

function renderPagination(pagination, changeSet) {
    const previousPageCount = latestPagination?.pages.length || 0;
    const existingNodes = Array.from(elements.pages.children);
    let pageNodesCreated = 0;
    const renderFull = !latestPagination
        || !changeSet
        || changeSet.mode === 'full'
        || existingNodes.length !== previousPageCount;

    if (renderFull) {
        const fragment = document.createDocumentFragment();
        for (const page of pagination.pages) {
            fragment.appendChild(createPageFigure(page, pagination));
            pageNodesCreated += 1;
        }
        elements.pages.replaceChildren(fragment);
    } else if (changeSet.mode !== 'unchanged') {
        const prefixCount = changeSet.prefixPageCount;
        const suffixCount = changeSet.suffixPageCount;
        const oldMiddleEnd = existingNodes.length - suffixCount;
        for (let index = oldMiddleEnd - 1; index >= prefixCount; index -= 1) {
            existingNodes[index].remove();
        }
        const insertionPoint = suffixCount > 0 ? existingNodes[oldMiddleEnd] : null;
        const newMiddleEnd = pagination.pages.length - suffixCount;
        const fragment = document.createDocumentFragment();
        for (let index = prefixCount; index < newMiddleEnd; index += 1) {
            fragment.appendChild(createPageFigure(pagination.pages[index], pagination));
            pageNodesCreated += 1;
        }
        elements.pages.insertBefore(fragment, insertionPoint);
        Array.from(elements.pages.children).forEach((figure, index) => updatePageFigureIndex(figure, index));
    }

    elements.pageCount.textContent = `${pagination.pages.length}ページ`;
    elements.pageCount.dataset.pageCount = String(pagination.pages.length);
    return pageNodesCreated;
}

async function runReflow(targetRevision) {
    pendingFrame = null;
    if (!measurer || !incrementalPaginator || targetRevision !== requestedRevision) return;
    const controller = new AbortController();
    const jobId = activeReflowJobId + 1;
    activeReflowJobId = jobId;
    activeReflowController?.abort();
    activeReflowController = controller;
    const startedAt = performance.now();
    let yieldCount = 0;
    try {
        if (!sourceState) syncBodySourceState();
        const sourceSnapshot = sourceState;
        const headingSnapshot = elements.heading.value;
        const documentModel = createFlowPreviewDocument({
            languageKey: LANGUAGE_KEY,
            heading: headingSnapshot,
            sourceState: sourceSnapshot,
        });
        measurer.resetMetrics();
        const { pagination, changeSet } = await incrementalPaginator.paginateAsync(documentModel, {
            revision: targetRevision,
            signal: controller.signal,
            maxPagesPerChunk: 1,
            chunkBudgetMs: 8,
            async yieldScheduler(progress) {
                yieldCount += 1;
                if (targetRevision === requestedRevision && !controller.signal.aborted) {
                    elements.app.dataset.progressPages = String(progress.generatedPageCount);
                    elements.status.textContent = `再計算中… ${progress.generatedPageCount}ページ`;
                }
                await yieldToBrowser();
            },
        });
        if (
            controller.signal.aborted
            || jobId !== activeReflowJobId
            || targetRevision !== requestedRevision
        ) return;
        const domCommitStartedAt = performance.now();
        const pageNodesCreated = renderPagination(pagination, changeSet);
        const domCommitMs = Math.max(0, performance.now() - domCommitStartedAt);
        latestPagination = pagination;
        latestChangeSet = changeSet;
        renderedRevision = targetRevision;
        latestMetrics = Object.freeze({
            ...changeSet,
            ...measurer.getMetrics(),
            pageNodesCreated,
            yieldCount,
            domCommitMs,
        });
        elements.app.dataset.changeMode = changeSet.mode;
        elements.app.dataset.prefixPages = String(changeSet.prefixPageCount);
        elements.app.dataset.recomputedPages = String(changeSet.measuredPageCount);
        elements.app.dataset.suffixPages = String(changeSet.suffixPageCount);
        elements.app.dataset.measureCalls = String(changeSet.measureCallCount);
        elements.app.dataset.cacheHits = String(latestMetrics.cacheHits);
        elements.app.dataset.cacheMisses = String(latestMetrics.cacheMisses);
        elements.app.dataset.pageNodesCreated = String(pageNodesCreated);
        elements.app.dataset.yieldCount = String(yieldCount);
        elements.app.dataset.domCommitMs = String(Math.max(0, Math.round(domCommitMs)));
        elements.app.dataset.progressPages = String(changeSet.measuredPageCount);
        elements.error.hidden = true;
        elements.error.textContent = '';
        const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
        const modeLabel = changeSet.mode === 'incremental'
            ? `増分 ${changeSet.measuredPageCount}ページ`
            : changeSet.mode === 'unchanged' ? '変更なし' : `全文 ${changeSet.measuredPageCount}ページ`;
        setReflowState('idle', `${modeLabel} / ${elapsed}ms`);
    } catch (error) {
        if (isPaginationCancellation(error)) return;
        if (targetRevision !== requestedRevision) return;
        latestPagination = null;
        latestChangeSet = null;
        latestMetrics = null;
        elements.error.hidden = false;
        elements.error.textContent = error?.message || 'ページ計算に失敗しました。';
        elements.pages.replaceChildren();
        elements.pageCount.textContent = 'エラー';
        elements.pageCount.dataset.pageCount = '0';
        setReflowState('error', '再計算できませんでした');
        console.error('[FlowPreview] reflow failed:', error);
    } finally {
        if (activeReflowController === controller) activeReflowController = null;
        resolveSettleWaiters();
    }
}

function scheduleReflow(options = {}) {
    if (options.sourceChanged) sourceRevision += 1;
    requestedRevision += 1;
    const targetRevision = requestedRevision;
    activeReflowController?.abort();
    updateSourceStats();
    setReflowState('working', measurer ? '再計算中…' : 'フォントを準備しています');
    if (reflowTimer !== null) window.clearTimeout(reflowTimer);
    if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
    if (!measurer || hasActiveComposition()) return targetRevision;
    reflowTimer = window.setTimeout(() => {
        reflowTimer = null;
        pendingFrame = window.requestAnimationFrame(() => {
            pendingFrame = null;
            void runReflow(targetRevision);
        });
    }, options.immediate ? 0 : REFLOW_DELAY_MS);
    return targetRevision;
}

function insertPageBreakAtSelection() {
    const next = insertFlowPreviewPageBreak(
        elements.body.value,
        elements.body.selectionStart,
        elements.body.selectionEnd,
        { selectionDirection: elements.body.selectionDirection },
    );
    elements.body.value = next.value;
    syncBodySourceState();
    elements.body.focus();
    elements.body.setSelectionRange(next.selectionStart, next.selectionEnd, next.selectionDirection);
    scheduleReflow({ sourceChanged: true });
}

function handleSourceInput(event) {
    if (event.currentTarget === elements.body) syncBodySourceState();
    scheduleReflow({ sourceChanged: true });
}

function handleCompositionStart(event) {
    composingTargets.add(event.currentTarget);
}

function handleCompositionEnd(event) {
    composingTargets.delete(event.currentTarget);
    if (event.currentTarget === elements.body) syncBodySourceState();
    if (!hasActiveComposition()) scheduleReflow({ immediate: true });
}

function handleWritingModeChange(event) {
    if (!event.currentTarget.checked) return;
    const nextWritingMode = String(event.currentTarget.value || DEFAULT_WRITING_MODE);
    if (nextWritingMode === writingMode) return;
    const runtimeReady = !!measurer;
    activeReflowController?.abort();
    incrementalPaginator?.invalidate();
    writingMode = nextWritingMode;
    typography = resolveFlowDomTypography(LANGUAGE_KEY, {}, writingMode);
    if (runtimeReady) createFlowRuntime();
    else updateTypographySummary();
    scheduleReflow({ immediate: true });
}

async function initializeFlowPreview() {
    elements.heading.addEventListener('input', handleSourceInput);
    elements.body.addEventListener('input', handleSourceInput);
    elements.heading.addEventListener('compositionstart', handleCompositionStart);
    elements.heading.addEventListener('compositionend', handleCompositionEnd);
    elements.body.addEventListener('compositionstart', handleCompositionStart);
    elements.body.addEventListener('compositionend', handleCompositionEnd);
    elements.writingModes.forEach((input) => input.addEventListener('change', handleWritingModeChange));
    elements.insertBreak.addEventListener('click', insertPageBreakAtSelection);
    syncBodySourceState();
    updateSourceStats();
    updateTypographySummary();
    await waitForFlowFonts(document, typography, writingMode, LANGUAGE_KEY);
    createFlowRuntime();
    document.fonts?.addEventListener?.('loadingdone', handleFontsLoaded);
    document.fonts?.addEventListener?.('loadingerror', handleFontsLoaded);
    scheduleReflow({ immediate: true });
}

window.addEventListener('beforeunload', () => {
    activeReflowController?.abort();
    document.fonts?.removeEventListener?.('loadingdone', handleFontsLoaded);
    document.fonts?.removeEventListener?.('loadingerror', handleFontsLoaded);
    measurer?.dispose();
});

Object.defineProperty(window, '__flowPreviewLab', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
        reflow: () => scheduleReflow({ immediate: true }),
        getPagination: () => latestPagination,
        getChangeSet: () => latestChangeSet,
        getMetrics: () => latestMetrics,
        getState: getFlowPreviewState,
        getSourceSnapshot: () => sourceState ? Object.freeze({
            body: sourceState.body,
            blocks: Object.freeze(sourceState.blocks.map((block) => Object.freeze({
                id: block.id,
                type: block.type,
                text: block.type === 'paragraph' ? block.texts[LANGUAGE_KEY] : null,
            }))),
        }) : null,
        awaitSettled: (revision = requestedRevision) => {
            const target = Number(revision) || requestedRevision;
            if (
                renderedRevision >= target
                && elements.app.dataset.reflowState !== 'working'
            ) return Promise.resolve(getFlowPreviewState());
            return new Promise((resolve) => settleWaiters.add({ revision: target, resolve }));
        },
    }),
});

initializeFlowPreview();
