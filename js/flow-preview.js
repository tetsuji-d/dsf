import {
    createFlowDomPageMeasurer,
    renderFlowGeneratedPage,
    resolveFlowDomTypography,
    waitForFlowFonts,
} from './flow-dom-measurer.js';
import { createCanonicalFlowPageBox, paginateFlowDocument } from './flow-pagination.js';
import {
    countFlowPreviewSourceGraphemes,
    createFlowPreviewDocument,
    insertFlowPreviewPageBreak,
} from './flow-preview-model.js';

const LANGUAGE_KEY = 'ja';
const WRITING_MODE = 'horizontal-tb';
const REFLOW_DELAY_MS = 120;
const pageBox = createCanonicalFlowPageBox();
const typography = resolveFlowDomTypography(LANGUAGE_KEY);

const elements = {
    app: document.getElementById('flow-preview-app'),
    heading: document.getElementById('flow-preview-heading'),
    body: document.getElementById('flow-preview-body'),
    insertBreak: document.getElementById('flow-preview-insert-break'),
    charCount: document.getElementById('flow-preview-char-count'),
    pageCount: document.getElementById('flow-preview-page-count'),
    status: document.getElementById('flow-preview-status'),
    error: document.getElementById('flow-preview-error'),
    pages: document.getElementById('flow-preview-pages'),
};

let measurer = null;
let reflowTimer = null;
let pendingFrame = null;
let latestPagination = null;

function handleFontsLoaded() {
    scheduleReflow({ immediate: true });
}

function setReflowState(state, message) {
    elements.app.dataset.reflowState = state;
    if (message) elements.status.textContent = message;
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

function renderPagination(pagination) {
    const fragment = document.createDocumentFragment();
    for (const page of pagination.pages) {
        fragment.appendChild(createPageFigure(page, pagination));
    }
    elements.pages.replaceChildren(fragment);
    elements.pageCount.textContent = `${pagination.pages.length}ページ`;
    elements.pageCount.dataset.pageCount = String(pagination.pages.length);
}

function runReflow() {
    pendingFrame = null;
    if (!measurer) return;
    const startedAt = performance.now();
    try {
        const documentModel = createFlowPreviewDocument({
            languageKey: LANGUAGE_KEY,
            heading: elements.heading.value,
            body: elements.body.value,
        });
        const pagination = paginateFlowDocument(documentModel, {
            pageBox,
            languageKey: LANGUAGE_KEY,
            writingMode: WRITING_MODE,
            measurePage: measurer.measurePage,
        });
        latestPagination = pagination;
        renderPagination(pagination);
        elements.error.hidden = true;
        elements.error.textContent = '';
        const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
        setReflowState('idle', `再計算 ${elapsed}ms`);
    } catch (error) {
        latestPagination = null;
        elements.error.hidden = false;
        elements.error.textContent = error?.message || 'ページ計算に失敗しました。';
        elements.pageCount.textContent = 'エラー';
        elements.pageCount.dataset.pageCount = '0';
        setReflowState('error', '再計算できませんでした');
        console.error('[FlowPreview] reflow failed:', error);
    }
}

function scheduleReflow(options = {}) {
    updateSourceStats();
    setReflowState('working', measurer ? '再計算中…' : 'フォントを準備しています');
    if (reflowTimer !== null) window.clearTimeout(reflowTimer);
    if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
    if (!measurer) return;
    reflowTimer = window.setTimeout(() => {
        reflowTimer = null;
        pendingFrame = window.requestAnimationFrame(runReflow);
    }, options.immediate ? 0 : REFLOW_DELAY_MS);
}

function insertPageBreakAtSelection() {
    const next = insertFlowPreviewPageBreak(
        elements.body.value,
        elements.body.selectionStart,
        elements.body.selectionEnd,
    );
    elements.body.value = next.value;
    elements.body.focus();
    elements.body.setSelectionRange(next.selectionStart, next.selectionEnd);
    scheduleReflow();
}

async function initializeFlowPreview() {
    elements.heading.addEventListener('input', () => scheduleReflow());
    elements.body.addEventListener('input', () => scheduleReflow());
    elements.insertBreak.addEventListener('click', insertPageBreakAtSelection);
    updateSourceStats();
    await waitForFlowFonts(document, typography);
    measurer = createFlowDomPageMeasurer({
        ownerDocument: document,
        languageKey: LANGUAGE_KEY,
        typography,
    });
    document.fonts?.addEventListener?.('loadingdone', handleFontsLoaded);
    scheduleReflow({ immediate: true });
}

window.addEventListener('beforeunload', () => {
    document.fonts?.removeEventListener?.('loadingdone', handleFontsLoaded);
    measurer?.dispose();
});

Object.defineProperty(window, '__flowPreviewLab', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
        reflow: () => scheduleReflow({ immediate: true }),
        getPagination: () => latestPagination,
    }),
});

initializeFlowPreview();
