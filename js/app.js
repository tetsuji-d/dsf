/**
 * app.js — Studio メインエントリ（描画・UI 同期・room 切り替え）
 *
 * Room 境界・認証（Google GIS + Firebase）の地図:
 *   docs/studio-app-room-boundaries.md
 *
 * 大まかな塊:
 *   - Home: ダッシュボード（renderHomeDashboard）
 *   - Editor: refresh / キャンバス / サムネ（このファイルが最も長い）
 *   - Press / Works: enterPressRoom（press.js）, openWorksRoom（works.js）は switchRoom から委譲
 *   - 認証 UI: getStudioAuthMarkup → renderStudioAuthSlot（GIS ボタン + フォールバック）
 */
import { state, dispatch, actionTypes } from './state.js';
import { saveProject as persistProject, loadProject, uploadToStorage, uploadCoverToStorage, uploadStructureToStorage, triggerAutoSave, flushSave, flushPendingSave, generateCroppedThumbnail, listLocalRecentProjects, loadLocalRecentProject, cacheLocalRecentProject, ensureUserBootstrap, auth as firebaseAuth, authReady, db } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag, startTailDrag, startSpikeDrag } from './bubbles.js';
import { addSection, addTextSection, changeSection, changeBlock, insertStructureBlock, renderThumbs, deleteActive, deleteSectionAt, insertSectionAt, insertSpreadImageAt, duplicateSectionAt, moveSection, moveSectionRange, insertPageNearBlock, duplicateBlockAt, moveBlockAt, getOptimizedImageUrl } from './sections.js';
import { pushState, endHistoryGroup, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal, fetchCloudProjects, getCoverImage, getPageCount, deleteCloudProject } from './projects.js';
import { openWorksRoom, closeWorksRoom } from './works.js';
import { enterPressRoom, leavePressRoom, refreshFlowHorizonDryRunReadiness } from './press.js';
import { getLangProps, getAllLangs } from './lang.js';
import { t, applyI18n, setUILang, getUILang } from './i18n-studio.js';
import { getBlockIndexFromPageIndex, getPageIndexFromBlockIndex, migrateSectionsToBlocks, syncBlocksWithSections, extractSectionsFromBlocks } from './blocks.js';
import { blocksToPages } from './pages.js';
import { buildDSP, buildDSF, parseAndLoadDSP } from './export.js';
import { hydrateProjectFromPersistence } from './project-persistence.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode } from './theme.js';
import { get as idbGet } from 'idb-keyval';
import { createId } from './utils.js';
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT } from './page-geometry.js';
import { canInsertSpreadImageAt, getBookCompositionIssues, getPageDisplayLabel, getReadablePageCount, normalizeBookSettings, getPageCoverKey } from './page-labels.js';
import { composeText, paginateText, PAGE_BREAK_MARKER, getWritingModeFromConfigs, getFontPresetFromConfigs, getFontPresetOptions, parseRubyTokens, tokensToPlainText, alignRubyToLines } from './layout.js';
import { formatPublicationDate, normalizePlanTier } from './publication.js';
import { PROJECT_SCHEMA_VERSION, createFlowGroupBlock, hasFlowGroups } from './flow-project-model.js';
import { applyFlowAuthoringOperation } from './flow-authoring.js';
import {
    FlowDirectEditError,
    createFlowDirectEditSession,
    createFlowDirectEditTransaction,
    createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction,
    createFlowDirectHeadingParagraphTransaction,
    createFlowDirectParagraphMergeBackwardTransaction,
    createFlowDirectParagraphMergeForwardTransaction,
    createFlowDirectParagraphSplitTransaction,
} from './flow-direct-edit.js';
import {
    ensureFlowLanguageTypography,
    getFlowLanguageProgress,
    getFlowSourceLanguageGroupIds,
    resolveFlowAuthoringLanguage,
} from './flow-multilingual-authoring.js';
import { deriveFlowTranslationStatus } from './flow-translation-state.js';
import {
    createFlowTranslationApplyPlan,
    createFlowTranslationRequest,
} from './flow-translation-request.js';
import { applyFlowTranslationPlan } from './flow-translation-apply.js';
import {
    listTranslationProviderModels,
    listTranslationProviders,
    registerTranslationProvider,
    runTranslationProvider,
} from './translation-provider.js';
import {
    BROWSER_TRANSLATOR_PROVIDER_ID,
    createBrowserTranslationProvider,
    isBrowserTranslatorSupported,
} from './browser-translator-provider.js';
import {
    LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    createLMStudioTranslationProvider,
} from './lm-studio-translator-provider.js';
import {
    getFlowTranslationApplyFailurePresentation,
    renderFlowAuthoringView,
    updateFlowAuthoringViewStatus,
    updateFlowTranslationAutomationView,
} from './flow-authoring-view.js';
import {
    getFlowEditorSelection,
    isFlowDirectEditing,
    isFlowSourceSelected,
    resetFlowEditorSelections,
    selectFlowDirectEditing,
    selectFlowGeneratedPage,
    selectFlowSource,
} from './flow-editor-session.js';
import { renderFlowGeneratedPage } from './flow-dom-measurer.js';
import {
    findFlowSourcePointInPages,
    getFlowSourcePointClientRect,
    getFlowSourceRangeClientRects,
    mapFlowClientPointToSource,
    mapFlowTextUtf16OffsetToGrapheme,
} from './flow-source-mapping.js';
import {
    FLOW_RUNTIME_INVALIDATED_EVENT,
    createFlowRuntimePageProjection,
    createFlowRuntimeProjectionSignature,
    getCachedFlowRuntimePageProjection,
    getSelectedFlowRuntimePageIndex,
    invalidateFlowRuntimeAuthoring,
    invalidateFlowRuntimePages,
    setSelectedFlowRuntimePageIndex,
} from './flow-runtime-pages.js';
import { collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const EDITOR_FRAME_WIDTH = CANONICAL_PAGE_WIDTH;
const EDITOR_FRAME_HEIGHT = CANONICAL_PAGE_HEIGHT;
const IMAGE_SNAP_THRESHOLD = 12;
const editorImageAspectCache = new Map();
const TEXT_PAPER_PRESETS = Object.freeze({
    white: {
        label: '白紙',
        backgroundColor: '#ffffff',
        textColor: '#000000'
    },
    book: {
        label: '書籍用紙',
        backgroundColor: '#f7f1df',
        textColor: '#1f1b16'
    }
});
const TEXT_ALIGN_VALUES = Object.freeze(['start', 'center', 'end']);
const EMPTY_IMAGE_SNAP_STATE = Object.freeze({
    centerX: false,
    centerY: false,
    edgeLeft: false,
    edgeRight: false,
    edgeTop: false,
    edgeBottom: false
});
let imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };

// 見開きクリックで「隣ページをアクティブ化」した時、元のアクティブページを隣として維持するための一時保持
let _spreadActivationPinnedAdjIdx = -1;
let _pageHeadingPushTimer = null;
let _editorFlowProjectionController = null;
let _editorFlowProjectionRequestId = 0;
let _editorFlowProjectionRequestKey = '';
let _flowAuthoringReflowTimer = null;
let _flowAuthoringSourceRevision = 0;
let _flowAuthoringRenderedRevision = 0;
let _flowAuthoringComposing = false;
let _flowAuthoringLanguageFeedback = null;
let _flowPendingSourceCaret = null;
let _flowDirectEditProxy = null;
let _flowDirectEditSession = null;
let _flowDirectCompositionText = '';
let _flowDirectEditMounting = false;
let _flowDirectEditApplying = false;

registerTranslationProvider(
    BROWSER_TRANSLATOR_PROVIDER_ID,
    createBrowserTranslationProvider(),
);
registerTranslationProvider(
    LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    createLMStudioTranslationProvider(),
);

const _flowTranslationRuntime = {
    providerId: isBrowserTranslatorSupported(globalThis)
        ? BROWSER_TRANSLATOR_PROVIDER_ID
        : LM_STUDIO_TRANSLATOR_PROVIDER_ID,
    modelsByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: [{
            id: 'chrome-managed',
            label: 'Chrome built-in model',
        }],
    },
    modelIdByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: 'chrome-managed',
    },
    modelStateByProvider: {
        [BROWSER_TRANSLATOR_PROVIDER_ID]: 'ready',
        [LM_STUDIO_TRANSLATOR_PROVIDER_ID]: 'idle',
    },
    modelMessageByProvider: {},
};
let _flowTranslationJob = null;
let _flowTranslationJobSequence = 0;

function resetFlowRuntimeForProjectChange() {
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    _flowAuthoringSourceRevision = 0;
    _flowAuthoringRenderedRevision = 0;
    _flowAuthoringComposing = false;
    _flowAuthoringLanguageFeedback = null;
    _flowPendingSourceCaret = null;
    clearFlowDirectEditRuntime();
    _flowTranslationJob?.controller?.abort?.();
    _flowTranslationJob = null;
    endHistoryGroup();
    resetFlowEditorSelections();
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    invalidateFlowRuntimePages();
}

function resetFlowRuntimeAfterGroupRemoval(groupId) {
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    _flowAuthoringComposing = false;
    _flowAuthoringLanguageFeedback = null;
    _flowPendingSourceCaret = null;
    clearFlowDirectEditRuntime();
    if (_flowTranslationJob?.groupId === groupId) {
        _flowTranslationJob.controller?.abort?.();
        _flowTranslationJob = null;
    }
    resetFlowEditorSelections();
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    _flowAuthoringSourceRevision += 1;
    invalidateFlowRuntimePages();
}

function getEditorPageProjection() {
    if (state.version !== 6 || !hasFlowGroups(state)) return null;
    const languageKey = getEditorFlowProjectionLanguage(getActiveBlock());
    return getCachedFlowRuntimePageProjection(
        state,
        languageKey,
        state.sections || [],
        document,
        'editor',
    );
}

function getActiveProjectionPageIndex(projection = getEditorPageProjection()) {
    if (!projection?.pages?.length) return -1;
    const activeBlock = getActiveBlock();
    if (activeBlock?.kind === 'page') {
        return projection.pages.findIndex((page) => (
            page.kind === 'fixed' && page.blockIndex === state.activeBlockIdx
        ));
    }
    if (activeBlock?.kind === 'flow') {
        const selected = getSelectedFlowRuntimePageIndex(activeBlock.id);
        return projection.pages.findIndex((page) => (
            page.kind === 'flow'
            && page.groupId === activeBlock.id
            && page.flowPageIndex === selected
        ));
    }
    if (Number.isInteger(state.activeBlockIdx)) {
        const currentFixedPageIndex = projection.pages.findIndex((page) => (
            page.kind === 'fixed' && page.fixedPageIndex === state.activeIdx
        ));
        if (currentFixedPageIndex >= 0) return currentFixedPageIndex;
        const nextPageIndex = projection.pages.findIndex((page) => page.blockIndex >= state.activeBlockIdx);
        return nextPageIndex >= 0 ? nextPageIndex : projection.pages.length - 1;
    }
    return 0;
}

function activateProjectionPage(page) {
    if (!page) return;
    if (page.kind === 'flow') {
        selectFlowGeneratedPage(page.groupId);
        setSelectedFlowRuntimePageIndex(page.groupId, page.flowPageIndex, page.flowPageCount);
    }
    changeBlock(page.blockIndex, refreshForThumbSelection);
}

function clearFlowDirectEditRuntime(options = {}) {
    const pageElement = _flowDirectEditProxy?._flowDirectPageElement;
    if (pageElement) {
        pageElement.classList.remove('flow-direct-edit-active', 'flow-direct-edit-reflow-pending');
        pageElement.querySelectorAll('[data-flow-direct-indicator]').forEach((element) => element.remove());
    }
    _flowDirectEditProxy?.remove?.();
    _flowDirectEditProxy = null;
    _flowDirectEditSession = null;
    _flowDirectCompositionText = '';
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = false;
    if (options.resetComposition !== false) _flowAuthoringComposing = false;
}

function setFlowDirectEditNote(message) {
    const pageLockNote = document.getElementById('page-lock-note');
    if (!pageLockNote) return;
    pageLockNote.textContent = message;
    pageLockNote.style.display = 'block';
}

function toFlowPageLocalRect(pageElement, rect) {
    const pageRect = pageElement?.getBoundingClientRect?.();
    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0 || !rect) return null;
    const scaleX = (pageElement.offsetWidth || pageRect.width) / pageRect.width;
    const scaleY = (pageElement.offsetHeight || pageRect.height) / pageRect.height;
    return {
        left: (rect.left - pageRect.left) * scaleX,
        top: (rect.top - pageRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
    };
}

function createFlowDirectSourcePoint(session, text, utf16Offset, affinity = 'nearest') {
    const mapped = mapFlowTextUtf16OffsetToGrapheme(text, utf16Offset, session.languageKey, affinity);
    return Object.freeze({
        sectionId: session.sectionId,
        blockId: session.blockId,
        blockType: session.blockType,
        languageKey: session.languageKey,
        graphemeOffset: mapped.graphemeOffset,
        utf16Offset: mapped.utf16Offset,
        affinity,
    });
}

function renderFlowDirectEditIndicators(proxy = _flowDirectEditProxy) {
    const session = _flowDirectEditSession;
    const pageElement = proxy?._flowDirectPageElement;
    const page = proxy?._flowDirectPageEntry;
    if (!proxy || proxy !== _flowDirectEditProxy || !session || !pageElement || !page) return;
    pageElement.querySelectorAll('[data-flow-direct-indicator]').forEach((element) => element.remove());
    const isComposing = _flowAuthoringComposing && proxy.dataset.composing === 'true';
    if (!isComposing && String(proxy.value || '') !== session.expectedText) return;

    const text = session.expectedText;
    const composedOffset = Math.max(0, Math.min(Number(session.sourcePoint?.utf16Offset) || 0, text.length));
    const start = isComposing
        ? composedOffset
        : Math.max(0, Math.min(Number(proxy.selectionStart) || 0, text.length));
    const end = isComposing
        ? composedOffset
        : Math.max(start, Math.min(Number(proxy.selectionEnd) || start, text.length));
    const direction = !isComposing && proxy.selectionDirection === 'backward' ? 'backward' : 'none';
    const startPoint = createFlowDirectSourcePoint(session, text, start, 'forward');
    const endPoint = createFlowDirectSourcePoint(session, text, end, 'backward');
    const focusPoint = direction === 'backward' ? startPoint : endPoint;

    if (start < end) {
        getFlowSourceRangeClientRects(pageElement, page.page, startPoint, endPoint).forEach((rect) => {
            const local = toFlowPageLocalRect(pageElement, rect);
            if (!local) return;
            const highlight = document.createElement('span');
            highlight.className = 'flow-direct-selection';
            highlight.dataset.flowDirectIndicator = 'selection';
            Object.assign(highlight.style, {
                left: `${local.left}px`,
                top: `${local.top}px`,
                width: `${local.width}px`,
                height: `${local.height}px`,
            });
            pageElement.appendChild(highlight);
        });
    }

    const caretRect = getFlowSourcePointClientRect(pageElement, page.page, focusPoint);
    const localCaret = toFlowPageLocalRect(pageElement, caretRect);
    if (!localCaret) return;
    const caret = document.createElement('span');
    caret.className = 'flow-direct-caret';
    caret.dataset.flowDirectIndicator = 'caret';
    Object.assign(caret.style, {
        left: `${localCaret.left}px`,
        top: `${localCaret.top}px`,
        height: `${Math.max(12, localCaret.height)}px`,
    });
    pageElement.appendChild(caret);
    Object.assign(proxy.style, {
        left: `${Math.max(0, localCaret.left - 1)}px`,
        top: `${Math.max(0, localCaret.top)}px`,
        height: `${Math.max(16, localCaret.height)}px`,
    });

    if (_flowDirectCompositionText) {
        const composition = document.createElement('span');
        composition.className = 'flow-direct-composition';
        composition.dataset.flowDirectIndicator = 'composition';
        composition.lang = session.languageKey;
        composition.textContent = _flowDirectCompositionText;
        const sourceFragment = [...pageElement.querySelectorAll('.flow-dom-block')].find((element) => (
            element.dataset.flowSectionId === session.sectionId
            && element.dataset.flowBlockId === session.blockId
        ));
        const sourceStyle = sourceFragment ? getComputedStyle(sourceFragment) : null;
        Object.assign(composition.style, {
            left: `${localCaret.left}px`,
            top: `${localCaret.top}px`,
            minHeight: `${Math.max(16, localCaret.height)}px`,
            fontFamily: sourceStyle?.fontFamily || page.typography?.fontFamily || 'inherit',
            fontSize: sourceStyle?.fontSize || `${page.typography?.fontSize || 16}px`,
            fontWeight: sourceStyle?.fontWeight || page.typography?.fontWeight || '400',
            lineHeight: sourceStyle?.lineHeight || String(page.typography?.lineHeight || 1.8),
            letterSpacing: sourceStyle?.letterSpacing || `${page.typography?.letterSpacing || 0}px`,
            color: sourceStyle?.color || page.typography?.textColor || 'inherit',
        });
        pageElement.appendChild(composition);
    }
}

function updateFlowDirectSelectionFromProxy(proxy, options = {}) {
    if (
        proxy !== _flowDirectEditProxy
        || !_flowDirectEditSession
        || _flowDirectEditMounting
        || _flowDirectEditApplying
        || proxy.dataset.flowReflowPending === 'true'
        || String(proxy.value || '') !== _flowDirectEditSession.expectedText
    ) return;
    const text = _flowDirectEditSession.expectedText;
    const selectionStart = Math.max(0, Math.min(Number(proxy.selectionStart) || 0, text.length));
    const selectionEnd = Math.max(selectionStart, Math.min(Number(proxy.selectionEnd) || selectionStart, text.length));
    const selectionDirection = proxy.selectionDirection === 'backward' ? 'backward' : 'none';
    const focusOffset = selectionDirection === 'backward' ? selectionStart : selectionEnd;
    const focusPoint = createFlowDirectSourcePoint(
        _flowDirectEditSession,
        text,
        focusOffset,
        selectionDirection === 'backward' ? 'backward' : 'forward',
    );
    _flowDirectEditSession = Object.freeze({
        ..._flowDirectEditSession,
        selectionStart,
        selectionEnd,
        selectionDirection,
        sourcePoint: focusPoint,
    });
    selectFlowDirectEditing(_flowDirectEditSession.groupId, focusPoint);
    renderFlowDirectEditIndicators(proxy);

    if (options.navigate === false || _flowAuthoringComposing) return;
    const activeBlock = getActiveBlock();
    const projection = getEditorPageProjection();
    if (activeBlock?.id !== _flowDirectEditSession.groupId || !projection) return;
    const groupPages = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    ));
    let location;
    try {
        location = findFlowSourcePointInPages(groupPages, focusPoint);
    } catch (_) {
        return;
    }
    if (!location || location.pageIndex === getSelectedFlowRuntimePageIndex(activeBlock.id)) return;
    setSelectedFlowRuntimePageIndex(activeBlock.id, location.pageIndex, groupPages.length);
    renderEditorFlowGeneratedPage(activeBlock, projection);
    syncThumbSelectionDom();
}

function recoverFlowDirectEditProxy(proxy, message) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession) return;
    _flowDirectEditMounting = true;
    proxy.value = _flowDirectEditSession.expectedText;
    const offset = Math.min(_flowDirectEditSession.sourcePoint.utf16Offset, proxy.value.length);
    proxy.setSelectionRange(offset, offset, 'none');
    delete proxy.dataset.flowReflowPending;
    _flowDirectEditMounting = false;
    setFlowDirectEditNote(message);
    renderFlowDirectEditIndicators(proxy);
}

function commitFlowDirectEdit(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return;
    let transaction;
    try {
        transaction = createFlowDirectEditTransaction(group, _flowDirectEditSession, {
            text: String(proxy.value || ''),
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            selectionDirection: proxy.selectionDirection,
        });
    } catch (error) {
        if (error instanceof FlowDirectEditError) {
            recoverFlowDirectEditProxy(proxy, 'この操作はまだ直接編集できません。Flow原稿画面で編集してください。');
            return;
        }
        throw error;
    }

    const changed = transaction.operation.text !== _flowDirectEditSession.expectedText;
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    if (!changed) {
        if (proxy.dataset.flowReflowPending !== 'true') renderFlowDirectEditIndicators(proxy);
        return;
    }

    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, {
            historyKey: `flow:${transaction.operation.groupId}:${transaction.operation.sectionId}:${transaction.operation.blockId}:${transaction.operation.languageKey}`,
            immediate: true,
        });
    } finally {
        _flowDirectEditApplying = false;
    }
}

function splitFlowDirectParagraph(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphSplitTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            newBlockId: createId('flow_paragraph'),
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しの分割は未対応です。現在はFlow原稿画面で段落を追加してください。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落分割は未対応です。選択を解除してEnterを押してください。');
        } else if (error.code === 'FLOW_DIRECT_GRAPHEME_BOUNDARY_REQUIRED') {
            setFlowDirectEditNote('文字の途中では段落を分割できません。caretを文字の境界へ移動してください。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に分割できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(0, 0, 'none');
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('段落を分割しました。後続ページを再配置しています。');
    return true;
}

function insertFlowDirectParagraphAfterHeading(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectHeadingParagraphTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
            newBlockId: createId('flow_paragraph'),
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_HEADING_REQUIRED') {
            setFlowDirectEditNote('この位置では見出し後の本文段落を追加できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む見出し後の段落追加は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_HEADING_END_REQUIRED') {
            setFlowDirectEditNote('見出しの末尾でのみ、Enterで本文段落を追加できます。');
        } else {
            recoverFlowDirectEditProxy(proxy, '見出しの後ろへ本文段落を安全に追加できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(0, 0, 'none');
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('見出しの後ろに本文段落を追加しました。後続ページを再配置しています。');
    return true;
}

function applyFlowDirectEnter(proxy) {
    if (_flowDirectEditSession?.blockType === 'heading') {
        return insertFlowDirectParagraphAfterHeading(proxy);
    }
    return splitFlowDirectParagraph(proxy);
}

function removeFlowDirectEmptyParagraphAfterHeading(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectEmptyParagraphAfterHeadingRemovalTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出し直後の段落に本文があるため、Backspaceでは削除しません。');
        } else if (error.code === 'FLOW_DIRECT_EMPTY_PARAGRAPH_DATA_PRESENT') {
            setFlowDirectEditNote('この空段落には翻訳または追加情報があるため、データ保護のため削除しませんでした。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む空段落削除は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_START_REQUIRED') {
            setFlowDirectEditNote('空段落の先頭でのみ、Backspaceで見出し末尾へ戻れます。');
        } else {
            recoverFlowDirectEditProxy(proxy, '空段落を安全に削除できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('空段落を削除し、見出し末尾へ戻りました。後続ページを再配置しています。');
    return true;
}

function isFlowDirectParagraphImmediatelyAfterHeading(group, session) {
    if (session?.blockType !== 'paragraph') return false;
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === session.sectionId);
    const blockIndex = section?.blocks?.findIndex((entry) => entry?.id === session.blockId) ?? -1;
    return blockIndex > 0 && section.blocks[blockIndex - 1]?.type === 'heading';
}

function applyFlowDirectBackspace(proxy) {
    const group = _flowDirectEditSession
        ? getFlowGroupById(_flowDirectEditSession.groupId)
        : null;
    if (group && isFlowDirectParagraphImmediatelyAfterHeading(group, _flowDirectEditSession)) {
        return removeFlowDirectEmptyParagraphAfterHeading(proxy);
    }
    return mergeFlowDirectParagraphBackward(proxy);
}

function mergeFlowDirectParagraphBackward(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphMergeBackwardTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しはBackspaceで前の段落へ結合できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落結合は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_START_REQUIRED') {
            setFlowDirectEditNote('段落の先頭でのみ、Backspaceによる前段落との結合ができます。');
        } else if (error.code === 'FLOW_DIRECT_PREVIOUS_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('直前が段落ではないため結合しませんでした。見出しや改ページは保持されます。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT') {
            setFlowDirectEditNote('この段落には翻訳本文があるため、データ保護のため結合しませんでした。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に結合できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('前の段落へ結合しました。後続ページを再配置しています。');
    return true;
}

function mergeFlowDirectParagraphForward(proxy) {
    if (proxy !== _flowDirectEditProxy || !_flowDirectEditSession || _flowDirectEditApplying) return false;
    const group = getFlowGroupById(_flowDirectEditSession.groupId);
    if (!group) return false;
    let transaction;
    try {
        transaction = createFlowDirectParagraphMergeForwardTransaction(group, _flowDirectEditSession, {
            selectionStart: proxy.selectionStart,
            selectionEnd: proxy.selectionEnd,
        });
    } catch (error) {
        if (!(error instanceof FlowDirectEditError)) throw error;
        if (error.code === 'FLOW_DIRECT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('見出しはDeleteで次の段落へ結合できません。');
        } else if (error.code === 'FLOW_DIRECT_COLLAPSED_CARET_REQUIRED') {
            setFlowDirectEditNote('選択範囲を含む段落結合は未対応です。選択を解除してください。');
        } else if (error.code === 'FLOW_DIRECT_PARAGRAPH_END_REQUIRED') {
            setFlowDirectEditNote('段落の末尾でのみ、Deleteによる次段落との結合ができます。');
        } else if (error.code === 'FLOW_DIRECT_NEXT_PARAGRAPH_REQUIRED') {
            setFlowDirectEditNote('直後が段落ではないため結合しませんでした。見出しや改ページは保持されます。');
        } else if (error.code === 'FLOW_DIRECT_MERGE_TRANSLATION_DATA_PRESENT') {
            setFlowDirectEditNote('次の段落には翻訳本文があるため、データ保護のため結合しませんでした。');
        } else {
            recoverFlowDirectEditProxy(proxy, '段落を安全に結合できませんでした。Flow原稿画面で編集してください。');
        }
        return false;
    }

    endHistoryGroup();
    _flowDirectEditSession = transaction.nextSession;
    selectFlowDirectEditing(transaction.operation.groupId, transaction.selection.focusPoint);
    _flowDirectEditMounting = true;
    proxy.value = transaction.nextSession.expectedText;
    proxy.dataset.flowBlockId = transaction.nextSession.blockId;
    proxy.setSelectionRange(
        transaction.nextSession.selectionStart,
        transaction.nextSession.selectionEnd,
        transaction.nextSession.selectionDirection,
    );
    _flowDirectEditMounting = false;
    _flowDirectEditApplying = true;
    proxy.dataset.flowReflowPending = 'true';
    proxy._flowDirectPageElement?.classList.add('flow-direct-edit-reflow-pending');
    try {
        applyFlowAuthoringEdit(transaction.operation, { immediate: true });
    } finally {
        _flowDirectEditApplying = false;
    }
    setFlowDirectEditNote('次の段落を結合しました。後続ページを再配置しています。');
    return true;
}

function handleFlowDirectBeforeInput(event) {
    if (event.target !== _flowDirectEditProxy) return;
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault();
        if (event.inputType === 'historyUndo') performProjectUndo();
        else performProjectRedo();
        return;
    }
    if (event.inputType === 'insertParagraph') {
        event.preventDefault();
        if (!event.isComposing && !_flowAuthoringComposing) applyFlowDirectEnter(event.target);
        return;
    }
    if (
        event.inputType === 'deleteContentBackward'
        && !event.isComposing
        && !_flowAuthoringComposing
        && event.target.selectionStart === 0
        && event.target.selectionEnd === 0
    ) {
        event.preventDefault();
        applyFlowDirectBackspace(event.target);
        return;
    }
    if (
        event.inputType === 'deleteContentForward'
        && !event.isComposing
        && !_flowAuthoringComposing
        && event.target.selectionStart === event.target.selectionEnd
        && event.target.selectionEnd === String(event.target.value || '').length
    ) {
        event.preventDefault();
        mergeFlowDirectParagraphForward(event.target);
        return;
    }
    if (
        event.inputType === 'insertLineBreak'
        || /[\r\n\u2028\u2029]/u.test(String(event.data || ''))
    ) {
        event.preventDefault();
        setFlowDirectEditNote('段落内改行は未対応です。現在はFlow原稿画面で編集してください。');
    }
}

function handleFlowDirectInput(event) {
    const proxy = event.target;
    if (proxy !== _flowDirectEditProxy || _flowAuthoringComposing) return;
    commitFlowDirectEdit(proxy);
}

function handleFlowDirectCompositionStart(event) {
    if (event.target !== _flowDirectEditProxy) return;
    _flowAuthoringComposing = true;
    _flowDirectCompositionText = '';
    event.target.dataset.composing = 'true';
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
    renderFlowDirectEditIndicators(event.target);
}

function handleFlowDirectCompositionUpdate(event) {
    if (event.target !== _flowDirectEditProxy) return;
    _flowDirectCompositionText = String(event.data || '');
    renderFlowDirectEditIndicators(event.target);
}

function handleFlowDirectCompositionEnd(event) {
    if (event.target !== _flowDirectEditProxy) return;
    _flowAuthoringComposing = false;
    _flowDirectCompositionText = '';
    event.target.dataset.composing = 'false';
    commitFlowDirectEdit(event.target);
}

function exitFlowDirectEdit(groupId) {
    const activeBlock = getActiveBlock();
    endHistoryGroup();
    clearFlowDirectEditRuntime();
    selectFlowGeneratedPage(groupId);
    const projection = getEditorPageProjection();
    if (activeBlock?.id === groupId && projection) renderEditorFlowGeneratedPage(activeBlock, projection);
    syncThumbSelectionDom();
}

function mountFlowDirectEditProxy(activeBlock, page, pageElement, session) {
    clearFlowDirectEditRuntime({ resetComposition: false });
    _flowDirectEditSession = session;
    const proxy = document.createElement('textarea');
    proxy.className = 'flow-direct-input-proxy';
    proxy.dataset.testid = 'flow-direct-input';
    proxy.dataset.flowGroupId = session.groupId;
    proxy.dataset.flowSectionId = session.sectionId;
    proxy.dataset.flowBlockId = session.blockId;
    proxy.setAttribute('aria-label', `${session.blockType === 'heading' ? '見出し' : '段落'}を生成ページ上で直接編集`);
    proxy.setAttribute('autocomplete', 'off');
    proxy.setAttribute('autocorrect', 'on');
    proxy.setAttribute('autocapitalize', 'sentences');
    proxy.setAttribute('spellcheck', 'true');
    proxy.wrap = 'off';
    proxy.value = session.expectedText;
    proxy._flowDirectPageEntry = page;
    proxy._flowDirectPageElement = pageElement;
    _flowDirectEditProxy = proxy;
    pageElement.classList.add('flow-direct-edit-active');
    pageElement.appendChild(proxy);

    proxy.addEventListener('beforeinput', handleFlowDirectBeforeInput);
    proxy.addEventListener('input', handleFlowDirectInput);
    proxy.addEventListener('compositionstart', handleFlowDirectCompositionStart);
    proxy.addEventListener('compositionupdate', handleFlowDirectCompositionUpdate);
    proxy.addEventListener('compositionend', handleFlowDirectCompositionEnd);
    proxy.addEventListener('select', () => updateFlowDirectSelectionFromProxy(proxy));
    proxy.addEventListener('keyup', (event) => {
        if (!event.isComposing) updateFlowDirectSelectionFromProxy(proxy);
    });
    proxy.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            exitFlowDirectEdit(activeBlock.id);
            return;
        }
        if (event.key === 'Enter' && !event.isComposing && !_flowAuthoringComposing) {
            event.preventDefault();
            if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
                setFlowDirectEditNote('修飾キー付きEnterは未対応です。現在はFlow原稿画面で編集してください。');
                return;
            }
            applyFlowDirectEnter(proxy);
            return;
        }
        if (
            event.key === 'Backspace'
            && !event.isComposing
            && !_flowAuthoringComposing
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && proxy.selectionStart === 0
            && proxy.selectionEnd === 0
        ) {
            event.preventDefault();
            applyFlowDirectBackspace(proxy);
            return;
        }
        if (
            event.key === 'Delete'
            && !event.isComposing
            && !_flowAuthoringComposing
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && proxy.selectionStart === proxy.selectionEnd
            && proxy.selectionEnd === String(proxy.value || '').length
        ) {
            event.preventDefault();
            mergeFlowDirectParagraphForward(proxy);
        }
    });
    proxy.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData?.('text/plain') || '';
        if (/[\r\n\u2028\u2029]/u.test(text)) {
            event.preventDefault();
            setFlowDirectEditNote('複数行の貼り付けはFlow原稿画面で行ってください。');
        }
    });

    _flowDirectEditMounting = true;
    proxy.focus({ preventScroll: true });
    proxy.setSelectionRange(session.selectionStart, session.selectionEnd, session.selectionDirection);
    _flowDirectEditMounting = false;
    renderFlowDirectEditIndicators(proxy);
    setFlowDirectEditNote('Flow生成ページを直接編集中（原稿へ保存・Escで閲覧に戻る）');
}

function tryCreateFlowDirectEditSession(activeBlock, page, sourcePoint) {
    try {
        return createFlowDirectEditSession(activeBlock, {
            pageLanguageKey: page.languageKey,
            writingMode: page.writingMode,
            isSourceFallback: page.isSourceFallback,
            sourcePoint,
        });
    } catch (error) {
        if (error instanceof FlowDirectEditError) {
            return null;
        }
        throw error;
    }
}

function restoreMappedFlowSourceCaret(groupId, sourcePoint) {
    _flowPendingSourceCaret = Object.freeze({ groupId, sourcePoint });
    requestAnimationFrame(() => {
        const pending = _flowPendingSourceCaret;
        if (!pending || pending.groupId !== groupId || pending.sourcePoint !== sourcePoint) return;
        _flowPendingSourceCaret = null;
        const root = getFlowAuthoringSurface();
        if (
            !root
            || root.hidden
            || root.dataset.flowGroupId !== groupId
            || root.dataset.languageKey !== sourcePoint.languageKey
        ) return;
        const input = [...root.querySelectorAll('[data-flow-field="block-text"]')].find((element) => {
            const target = getFlowAuthoringTarget(element);
            return target.sectionId === sourcePoint.sectionId && target.blockId === sourcePoint.blockId;
        });
        const utf16Offset = Number(sourcePoint.utf16Offset);
        if (
            !input
            || !Number.isInteger(utf16Offset)
            || utf16Offset < 0
            || utf16Offset > String(input.value || '').length
            || typeof input.setSelectionRange !== 'function'
        ) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(utf16Offset, utf16Offset, 'none');
        input.scrollIntoView?.({ block: 'center', behavior: 'auto' });
        root.dataset.sourceMappedBlockId = sourcePoint.blockId;
        root.dataset.sourceMappedGraphemeOffset = String(sourcePoint.graphemeOffset);
        root.dataset.sourceMappedUtf16Offset = String(sourcePoint.utf16Offset);
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            const label = sourcePoint.blockType === 'heading' ? '見出し' : '段落';
            pageLockNote.textContent = `生成ページから${label}の該当位置へ移動しました（読取マッピング）`;
            pageLockNote.style.display = 'block';
        }
    });
}

function handleFlowGeneratedPageSourceClick(event, activeBlock, page, pageElement) {
    if (event.button !== 0 || page.isSourceFallback) return;
    let sourcePoint;
    try {
        sourcePoint = mapFlowClientPointToSource(
            pageElement,
            page.page,
            event.clientX,
            event.clientY,
        );
    } catch (error) {
        console.warn('[Flow source mapping] Generated page click could not be mapped:', error);
        return;
    }
    if (!sourcePoint) return;
    event.preventDefault();
    event.stopPropagation();
    endHistoryGroup();
    const directSession = tryCreateFlowDirectEditSession(activeBlock, page, sourcePoint);
    if (directSession) {
        selectFlowDirectEditing(activeBlock.id, directSession.sourcePoint);
        mountFlowDirectEditProxy(activeBlock, page, pageElement, directSession);
        syncThumbSelectionDom();
        return;
    }
    selectFlowSource(activeBlock.id, sourcePoint);
    restoreMappedFlowSourceCaret(activeBlock.id, sourcePoint);
    refresh();
}

function renderEditorFlowGeneratedPage(activeBlock, projection) {
    const render = document.getElementById('content-render');
    if (!render || activeBlock?.kind !== 'flow') return;
    const groupPages = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    ));
    if (!groupPages.length) {
        render.innerHTML = `
            <div id="flow-readonly-placeholder" data-flow-preview-state="error">
                <span class="material-icons">error_outline</span>
                <strong>Flowページを表示できません</strong>
                <span>原稿のページ生成結果が空です。</span>
            </div>`;
        return;
    }
    let selectedIndex = setSelectedFlowRuntimePageIndex(
        activeBlock.id,
        getSelectedFlowRuntimePageIndex(activeBlock.id),
        groupPages.length,
    );
    if (isFlowDirectEditing(activeBlock.id)) {
        try {
            const location = findFlowSourcePointInPages(
                groupPages,
                getFlowEditorSelection(activeBlock.id),
            );
            if (location) {
                selectedIndex = setSelectedFlowRuntimePageIndex(
                    activeBlock.id,
                    location.pageIndex,
                    groupPages.length,
                );
            }
        } catch (_) {
            // A history restore clamps the source point before the next render.
        }
    }
    const page = groupPages[selectedIndex];
    const pageLabel = getPageDisplayLabel(
        page.index,
        projection.totalPageCount,
        state.book,
        state.bookMode,
    );
    render.classList.add('flow-editor-preview-active');
    clearFlowDirectEditRuntime({ resetComposition: false });
    render.innerHTML = `
        <div class="flow-editor-page-surface"
            data-testid="flow-editor-generated-page"
            data-flow-runtime-key="${escapeStudioHtml(page.runtimeKey)}"
            data-publication-index="${page.index}"></div>`;
    const pageElement = render.querySelector('.flow-editor-page-surface');
    renderFlowGeneratedPage(pageElement, {
        page: page.page,
        pageBox: page.pageBox,
        languageKey: page.languageKey,
        writingMode: page.writingMode,
        typography: page.typography,
    });
    pageElement.dataset.flowSourceMapping = page.isSourceFallback ? 'source-fallback' : 'ready';
    if (!page.isSourceFallback) {
        pageElement.setAttribute('aria-label', 'Flow生成ページ。本文をクリックすると直接編集を開始します');
        pageElement.addEventListener('click', (event) => {
            handleFlowGeneratedPageSourceClick(event, activeBlock, page, pageElement);
        });
    }
    if (isFlowDirectEditing(activeBlock.id)) {
        const directSession = tryCreateFlowDirectEditSession(
            activeBlock,
            page,
            getFlowEditorSelection(activeBlock.id),
        );
        if (directSession) mountFlowDirectEditProxy(activeBlock, page, pageElement, directSession);
        else selectFlowGeneratedPage(activeBlock.id);
    }
    render.dataset.flowPreviewState = 'ready';
    render.dataset.flowPageCount = String(groupPages.length);
    render.dataset.publicationPageCount = String(projection.totalPageCount);
    const pageLockNote = document.getElementById('page-lock-note');
    if (pageLockNote) {
        const sourceLabel = page.isSourceFallback ? ` / 原文 ${page.languageKey.toUpperCase()}` : '';
        const directEditing = isFlowDirectEditing(activeBlock.id) && _flowDirectEditProxy;
        const mappingLabel = page.isSourceFallback
            ? ''
            : directEditing ? '・直接編集中' : '・本文クリックで直接編集';
        pageLockNote.textContent = `Flow原稿 ${selectedIndex + 1} / ${groupPages.length}（作品内 ${pageLabel}ページ${sourceLabel}${mappingLabel}）`;
        pageLockNote.style.display = 'block';
    }
    syncPageNavigationSlider();
    syncEditorPageCounters();
}

function getFlowAuthoringSurface() {
    return document.getElementById('flow-authoring-surface');
}

function setFlowAuthoringSurfaceVisible(visible) {
    const surface = getFlowAuthoringSurface();
    const stage = document.getElementById('canvas-stage');
    if (surface) surface.hidden = !visible;
    if (stage) stage.hidden = !!visible;
    document.getElementById('canvas-view')?.classList.toggle('flow-authoring-active', !!visible);
    syncMobileCanvasZoomBar();
}

function getFlowGroupById(groupId) {
    return (state.blocks || []).find((block) => block?.kind === 'flow' && block.id === groupId) || null;
}

function getFlowAuthoringLanguage(group) {
    return resolveFlowAuthoringLanguage(
        group,
        state.activeLang || state.defaultLang || '',
        state.languages || [],
    );
}

function getFlowAuthoringGroupProjection(projection, groupId) {
    return projection?.flowGroups?.find((entry) => entry.groupId === groupId) || null;
}

function getFlowAuthoringLanguageFeedback(group, languageKey, options = {}) {
    const canReuse = options.reuse === true
        && _flowAuthoringLanguageFeedback?.groupId === group.id
        && _flowAuthoringLanguageFeedback?.languageKey === languageKey;
    if (canReuse) return _flowAuthoringLanguageFeedback;
    const feedback = Object.freeze({
        groupId: group.id,
        languageKey,
        languageProgress: getFlowLanguageProgress(group, languageKey),
        translationStatus: deriveFlowTranslationStatus(group, languageKey),
    });
    _flowAuthoringLanguageFeedback = feedback;
    return feedback;
}

function getFlowTranslationProviderOptions() {
    return listTranslationProviders().map((provider) => ({
        ...provider,
        available: provider.id !== BROWSER_TRANSLATOR_PROVIDER_ID
            || isBrowserTranslatorSupported(globalThis),
    }));
}

function normalizeFlowTranslationProviderSelection() {
    const providers = getFlowTranslationProviderOptions();
    const current = providers.find((provider) => (
        provider.id === _flowTranslationRuntime.providerId && provider.available !== false
    ));
    if (current) return current;
    const fallback = providers.find((provider) => provider.available !== false) || providers[0] || null;
    _flowTranslationRuntime.providerId = fallback?.id || '';
    return fallback;
}

function getFlowTranslationAutomation(group, languageKey) {
    const sourceLanguage = String(group?.flow?.document?.sourceLanguage || '');
    if (!group || !languageKey || languageKey === sourceLanguage) return null;
    const provider = normalizeFlowTranslationProviderSelection();
    const providerId = provider?.id || '';
    const models = _flowTranslationRuntime.modelsByProvider[providerId] || [];
    const modelState = _flowTranslationRuntime.modelStateByProvider[providerId] || 'idle';
    let modelId = _flowTranslationRuntime.modelIdByProvider[providerId] || '';
    if (!models.some((model) => model.id === modelId)) {
        modelId = models[0]?.id || '';
        _flowTranslationRuntime.modelIdByProvider[providerId] = modelId;
    }

    const job = _flowTranslationJob;
    const isCurrentJob = job?.groupId === group.id && job?.languageKey === languageKey;
    const anotherJobRunning = job?.state === 'running' && !isCurrentJob;
    let targetCount = isCurrentJob && job.state === 'running'
        ? Math.max(0, Number(job.total) || 0)
        : 0;
    let requestMessage = '';
    if (!(isCurrentJob && job.state === 'running')) {
        try {
            targetCount = createFlowTranslationRequest(group, {
                targetLang: languageKey,
                modelId,
            }).units.length;
        } catch (error) {
            requestMessage = error?.message || String(error);
        }
    }

    const jobState = isCurrentJob ? job.state : (anotherJobRunning ? 'running' : 'idle');
    const message = isCurrentJob
        ? job.message
        : anotherJobRunning
            ? '別のFlow原稿を翻訳中です。完了または中止してから実行してください。'
            : requestMessage || _flowTranslationRuntime.modelMessageByProvider[providerId] || '';
    return {
        providers: getFlowTranslationProviderOptions(),
        providerId,
        models,
        modelId,
        modelState,
        targetCount,
        jobState,
        message,
        canStart: provider?.available !== false
            && modelState === 'ready'
            && !!modelId
            && targetCount > 0
            && job?.state !== 'running',
    };
}

function refreshFlowTranslationAutomationSurface() {
    const group = getActiveBlock();
    if (group?.kind !== 'flow' || !isFlowSourceSelected(group.id)) return;
    renderFlowAuthoringSurface(group, getEditorPageProjection());
}

function updateCurrentFlowTranslationAutomation() {
    const root = getFlowAuthoringSurface();
    const group = getActiveBlock();
    if (!root || group?.kind !== 'flow') return;
    updateFlowTranslationAutomationView(
        root,
        getFlowTranslationAutomation(group, getFlowAuthoringLanguage(group)),
    );
}

async function loadFlowTranslationProviderModels(providerId, options = {}) {
    const providerKey = String(providerId || _flowTranslationRuntime.providerId || '');
    if (!providerKey) return [];
    if (
        options.force !== true
        && _flowTranslationRuntime.modelStateByProvider[providerKey] === 'ready'
        && _flowTranslationRuntime.modelsByProvider[providerKey]?.length
    ) {
        return _flowTranslationRuntime.modelsByProvider[providerKey];
    }

    _flowTranslationRuntime.modelStateByProvider[providerKey] = 'loading';
    _flowTranslationRuntime.modelMessageByProvider[providerKey] = '利用可能なモデルを取得しています…';
    refreshFlowTranslationAutomationSurface();
    try {
        const models = await listTranslationProviderModels(providerKey);
        _flowTranslationRuntime.modelsByProvider[providerKey] = models;
        _flowTranslationRuntime.modelStateByProvider[providerKey] = 'ready';
        const selected = _flowTranslationRuntime.modelIdByProvider[providerKey];
        if (!models.some((model) => model.id === selected)) {
            _flowTranslationRuntime.modelIdByProvider[providerKey] = models[0]?.id || '';
        }
        _flowTranslationRuntime.modelMessageByProvider[providerKey] = models.length
            ? `${models.length}件のモデルを取得しました。`
            : '利用可能なモデルがありません。';
        return models;
    } catch (error) {
        _flowTranslationRuntime.modelsByProvider[providerKey] = [];
        _flowTranslationRuntime.modelStateByProvider[providerKey] = 'error';
        _flowTranslationRuntime.modelMessageByProvider[providerKey] = error?.message || String(error);
        return [];
    } finally {
        refreshFlowTranslationAutomationSurface();
    }
}

function getFlowTranslationProgressMessage(progress = {}) {
    if (progress.phase === 'preparing') return '翻訳モデルを準備しています…';
    if (progress.phase === 'downloading') {
        return `翻訳モデルを準備しています… ${Math.round((Number(progress.loaded) || 0) * 100)}%`;
    }
    if (progress.phase === 'translating') {
        return `翻訳中… ${Number(progress.current) || 0} / ${Number(progress.total) || 0}`;
    }
    return '翻訳結果を確認しています…';
}

function cancelFlowTranslationJob() {
    if (_flowTranslationJob?.state !== 'running') return;
    _flowTranslationJob.message = '翻訳を中止しています…';
    _flowTranslationJob.controller?.abort?.();
    updateCurrentFlowTranslationAutomation();
}

function installFlowTranslationVerificationProvider(options = {}) {
    const providerId = 'flow-verification-provider';
    const delayMs = Math.max(0, Math.min(5000, Number(options.delayMs) || 25));
    const expansionFactor = Math.max(1, Math.min(4, Number(options.expansionFactor) || 1));
    const requestedFailUnitIndex = Number(options.failUnitIndex);
    const failUnitIndex = Number.isInteger(requestedFailUnitIndex) && requestedFailUnitIndex >= 0
        ? requestedFailUnitIndex
        : -1;
    registerTranslationProvider(providerId, {
        id: providerId,
        label: 'Flow verification provider',
        local: true,
        modelMode: 'fixed',
        defaultModelId: 'verification-model',
        defaultModelLabel: 'Verification model',
        async translate(request, context = {}) {
            context.onProgress?.({
                phase: 'translating',
                current: 0,
                total: request.units.length,
            });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (context.signal?.aborted) return { units: [], cancelled: true };
            const units = request.units.map((unit, index) => {
                context.onProgress?.({
                    phase: 'translating',
                    current: index + 1,
                    total: request.units.length,
                });
                if (index === failUnitIndex) {
                    return {
                        unitId: unit.unitId,
                        text: '',
                        status: 'error',
                        error: 'Verification provider failed this unit.',
                    };
                }
                return {
                    unitId: unit.unitId,
                    text: unit.text
                        ? `[${request.targetLang}] ${unit.text.repeat(expansionFactor)}`
                        : '',
                    status: 'needs-review',
                };
            });
            return { units, cancelled: false };
        },
    });
    _flowTranslationRuntime.providerId = providerId;
    _flowTranslationRuntime.modelsByProvider[providerId] = [{
        id: 'verification-model',
        label: 'Verification model',
    }];
    _flowTranslationRuntime.modelIdByProvider[providerId] = 'verification-model';
    _flowTranslationRuntime.modelStateByProvider[providerId] = 'ready';
    _flowTranslationRuntime.modelMessageByProvider[providerId] = '';
    _flowTranslationJob = null;
    refreshFlowTranslationAutomationSurface();
    return providerId;
}

async function startFlowTranslationJob(groupId) {
    if (_flowTranslationJob?.state === 'running') return;
    const group = getFlowGroupById(groupId);
    if (!group) return;
    const languageKey = getFlowAuthoringLanguage(group);
    const sourceLanguage = group.flow?.document?.sourceLanguage;
    if (!languageKey || languageKey === sourceLanguage) return;

    const provider = normalizeFlowTranslationProviderSelection();
    const providerId = provider?.id || '';
    if (!providerId || provider?.available === false) return;
    if (_flowTranslationRuntime.modelStateByProvider[providerId] !== 'ready') {
        await loadFlowTranslationProviderModels(providerId);
    }
    const modelId = _flowTranslationRuntime.modelIdByProvider[providerId] || '';
    let request;
    try {
        request = createFlowTranslationRequest(getFlowGroupById(groupId), {
            targetLang: languageKey,
            modelId,
        });
    } catch (error) {
        _flowTranslationJob = {
            id: ++_flowTranslationJobSequence,
            groupId,
            languageKey,
            state: 'error',
            message: error?.message || String(error),
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
        return;
    }
    if (!request.units.length) {
        _flowTranslationJob = {
            id: ++_flowTranslationJobSequence,
            groupId,
            languageKey,
            state: 'success',
            message: '自動翻訳が必要な未翻訳・原文更新箇所はありません。',
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
        return;
    }

    const controller = new AbortController();
    const jobId = ++_flowTranslationJobSequence;
    _flowTranslationJob = {
        id: jobId,
        groupId,
        languageKey,
        total: request.units.length,
        state: 'running',
        message: `翻訳を開始しています… 0 / ${request.units.length}`,
        controller,
    };
    updateCurrentFlowTranslationAutomation();

    try {
        const response = await runTranslationProvider(request, {
            providerId,
            signal: controller.signal,
            onProgress(progress) {
                if (_flowTranslationJob?.id !== jobId) return;
                _flowTranslationJob.message = getFlowTranslationProgressMessage(progress);
                updateCurrentFlowTranslationAutomation();
            },
        });
        if (_flowTranslationJob?.id !== jobId) return;
        if (response.cancelled) {
            _flowTranslationJob = {
                ..._flowTranslationJob,
                state: 'cancelled',
                message: '翻訳を中止しました。原稿は変更されていません。',
                controller: null,
            };
            updateCurrentFlowTranslationAutomation();
            return;
        }

        const currentGroup = getFlowGroupById(groupId);
        const plan = createFlowTranslationApplyPlan(currentGroup, request, response);
        if (!plan.ready) {
            const failure = getFlowTranslationApplyFailurePresentation(plan, {
                totalCount: request.units.length,
            });
            _flowTranslationJob = {
                ..._flowTranslationJob,
                state: 'error',
                message: failure.message,
                failureKind: failure.kind,
                issues: plan.issues,
                controller: null,
            };
            updateCurrentFlowTranslationAutomation();
            return;
        }

        const existingWritingMode = currentGroup.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode;
        const authoringBlocks = ensureFlowLanguageTypography(state.blocks || [], {
            groupId,
            languageKey,
            writingMode: existingWritingMode
                || getWritingModeFromConfigs(languageKey, state.languageConfigs),
        }).blocks;
        const nextBlocks = applyFlowTranslationPlan(authoringBlocks, {
            groupId,
            targetLang: languageKey,
            plan,
        });
        endHistoryGroup();
        pushState();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
        updateHistoryButtons();
        _flowAuthoringSourceRevision += 1;
        _flowAuthoringLanguageFeedback = null;
        _flowTranslationJob = {
            ..._flowTranslationJob,
            state: 'success',
            message: `${plan.edits.length}件を一括適用しました。内容を確認してください。`,
            controller: null,
        };
        const updatedGroup = getFlowGroupById(groupId);
        if (updatedGroup && getActiveBlock()?.id === groupId) renderFlowAuthoringSurface(updatedGroup, null);
        scheduleFlowAuthoringReflow(groupId, { immediate: true });
        triggerAutoSave();
    } catch (error) {
        if (_flowTranslationJob?.id !== jobId) return;
        _flowTranslationJob = {
            ..._flowTranslationJob,
            state: controller.signal.aborted ? 'cancelled' : 'error',
            message: controller.signal.aborted
                ? '翻訳を中止しました。原稿は変更されていません。'
                : `翻訳に失敗しました。原稿は変更されていません。${error?.message ? ` ${error.message}` : ''}`,
            controller: null,
        };
        updateCurrentFlowTranslationAutomation();
    }
}

function updateActiveFlowAuthoringStatus(projection, options = {}) {
    const root = getFlowAuthoringSurface();
    const activeBlock = getActiveBlock();
    if (!root || activeBlock?.kind !== 'flow' || !isFlowSourceSelected(activeBlock.id)) return;
    const groupProjection = getFlowAuthoringGroupProjection(projection, activeBlock.id);
    const languageKey = getFlowAuthoringLanguage(activeBlock);
    const { languageProgress, translationStatus } = getFlowAuthoringLanguageFeedback(
        activeBlock,
        languageKey,
        { reuse: !projection && options.state !== 'error' },
    );
    const panelPageCount = document.getElementById('flow-authoring-page-count');
    if (panelPageCount) {
        if (!projection) {
            panelPageCount.textContent = '更新中';
        } else if (groupProjection?.isSourceFallback) {
            panelPageCount.textContent = translationStatus.body.counts.stale > 0
                ? '原文プレビュー（要更新）'
                : '原文プレビュー（未翻訳）';
        } else if (translationStatus.body.counts.untracked > 0) {
            panelPageCount.textContent = `${groupProjection?.pageCount || 0}ページ（状態未登録）`;
        } else if (translationStatus.hasOutlineIssues) {
            panelPageCount.textContent = `${groupProjection?.pageCount || 0}ページ（章名要確認）`;
        } else {
            panelPageCount.textContent = groupProjection?.pageCount ? `${groupProjection.pageCount}ページ` : '更新中';
        }
    }
    updateFlowAuthoringViewStatus(root, {
        state: options.state || (projection ? 'idle' : 'working'),
        pageCount: groupProjection?.pageCount || Number(root.dataset.pageCount) || 0,
        sourceRevision: _flowAuthoringSourceRevision,
        renderedRevision: projection ? _flowAuthoringRenderedRevision : _flowAuthoringRenderedRevision,
        changeSet: groupProjection?.changeSet,
        isSourceFallback: groupProjection?.isSourceFallback === true,
        languageProgress,
        translationStatus,
        message: options.message,
    });
    updateFlowTranslationAutomationView(
        root,
        getFlowTranslationAutomation(activeBlock, languageKey),
    );
    if (projection) {
        syncPageNavigationSlider();
        syncEditorPageCounters();
    }
}

function renderFlowAuthoringSurface(activeBlock, projection = getEditorPageProjection()) {
    const root = getFlowAuthoringSurface();
    if (!root || activeBlock?.kind !== 'flow') return;
    delete root.dataset.sourceMappedBlockId;
    delete root.dataset.sourceMappedGraphemeOffset;
    delete root.dataset.sourceMappedUtf16Offset;
    const languageKey = getFlowAuthoringLanguage(activeBlock);
    const { languageProgress, translationStatus } = getFlowAuthoringLanguageFeedback(activeBlock, languageKey);
    const translationAutomation = getFlowTranslationAutomation(activeBlock, languageKey);
    const groupProjection = getFlowAuthoringGroupProjection(projection, activeBlock.id);
    const scrollTop = root.scrollTop;
    renderFlowAuthoringView(root, {
        group: activeBlock,
        languageKey,
        pageCount: groupProjection?.pageCount || 0,
        translationStatus,
        translationAutomation,
        onInput: handleFlowAuthoringInput,
        onChange: handleFlowAuthoringChange,
        onAction: handleFlowAuthoringAction,
        onFocus: handleFlowAuthoringFocus,
        onBlur: () => endHistoryGroup(),
        onCompositionStart: handleFlowAuthoringCompositionStart,
        onCompositionEnd: handleFlowAuthoringCompositionEnd,
    });
    root.scrollTop = scrollTop;
    updateFlowAuthoringViewStatus(root, {
        state: projection ? 'idle' : 'working',
        pageCount: groupProjection?.pageCount || 0,
        sourceRevision: _flowAuthoringSourceRevision,
        renderedRevision: _flowAuthoringRenderedRevision,
        changeSet: groupProjection?.changeSet,
        isSourceFallback: groupProjection?.isSourceFallback === true,
        languageProgress,
        translationStatus,
    });
}

function getFlowAuthoringTarget(target) {
    const root = target?.closest?.('#flow-authoring-surface');
    const blockElement = target?.closest?.('[data-testid="flow-block"]');
    const sectionElement = target?.closest?.('[data-testid="flow-section"]');
    return {
        root,
        groupId: String(target?.dataset?.flowGroupId || blockElement?.dataset?.flowGroupId || root?.dataset?.flowGroupId || ''),
        sectionId: String(target?.dataset?.flowSectionId || blockElement?.dataset?.flowSectionId || sectionElement?.dataset?.flowSectionId || ''),
        blockId: String(target?.dataset?.flowBlockId || blockElement?.dataset?.flowBlockId || ''),
        blockElement,
    };
}

function findFlowAuthoringValue(target, field, languageKey) {
    const group = getFlowGroupById(target.groupId);
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === target.sectionId);
    if (field === 'section-title') return section?.title?.[languageKey] || '';
    const block = section?.blocks?.find((entry) => entry?.id === target.blockId);
    if (field === 'block-text') return block?.texts?.[languageKey] || '';
    if (field === 'heading-level') return block?.level;
    return undefined;
}

function scheduleFlowAuthoringReflow(groupId, options = {}) {
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    invalidateFlowRuntimeAuthoring(groupId);
    updateActiveFlowAuthoringStatus(null, { state: 'working' });
    if (_flowAuthoringComposing) return;
    _flowAuthoringReflowTimer = setTimeout(() => {
        _flowAuthoringReflowTimer = null;
        const group = getFlowGroupById(groupId);
        if (group) requestEditorFlowProjection(group);
    }, options.immediate ? 0 : 140);
}

function applyFlowAuthoringEdit(operation, options = {}) {
    const historyKey = String(options.historyKey || '');
    if (
        _flowTranslationJob?.groupId === operation.groupId
        && _flowTranslationJob.state !== 'running'
    ) {
        _flowTranslationJob = null;
    }
    let authoringBlocks = state.blocks || [];
    const group = getFlowGroupById(operation.groupId);
    const languageKey = String(operation.languageKey || '');
    if (
        group
        && languageKey
        && languageKey !== group.flow?.document?.sourceLanguage
        && (operation.type === 'setText' || operation.type === 'setSectionTitle')
    ) {
        const existingWritingMode = group.flow?.layout?.typographyByLanguage?.[languageKey]?.writingMode;
        authoringBlocks = ensureFlowLanguageTypography(authoringBlocks, {
            groupId: operation.groupId,
            languageKey,
            writingMode: existingWritingMode
                || getWritingModeFromConfigs(languageKey, state.languageConfigs),
        }).blocks;
    }
    if (options.recordHistory !== false) {
        pushState(historyKey ? { groupKey: historyKey, mergeWindowMs: 900 } : {});
        updateHistoryButtons();
    }
    const nextBlocks = applyFlowAuthoringOperation(authoringBlocks, operation);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    _flowAuthoringSourceRevision += 1;
    if (options.rerender === true) {
        const activeGroup = getFlowGroupById(operation.groupId);
        if (activeGroup) renderFlowAuthoringSurface(activeGroup, null);
    }
    if (!_flowAuthoringComposing) {
        scheduleFlowAuthoringReflow(operation.groupId, { immediate: options.immediate === true });
        triggerAutoSave();
    }
    return nextBlocks;
}

function getFlowAuthoringSectionFromBlocks(blocks, groupId, sectionId) {
    const group = (blocks || []).find((block) => block?.kind === 'flow' && block.id === groupId);
    return group?.flow?.document?.sections?.find((section) => section?.id === sectionId) || null;
}

function restoreFlowAuthoringBlockFocus(blockId, sectionId) {
    requestAnimationFrame(() => {
        const root = getFlowAuthoringSurface();
        const blockElement = [...(root?.querySelectorAll?.('[data-testid="flow-block"]') || [])]
            .find((entry) => entry.dataset.flowBlockId === blockId);
        const focusTarget = blockElement?.querySelector('.flow-authoring-input, [data-flow-action]')
            || [...(root?.querySelectorAll?.('[data-testid="flow-section"]') || [])]
                .find((entry) => entry.dataset.flowSectionId === sectionId)
                ?.querySelector('[data-flow-field="section-title"], [data-flow-action="insert"]');
        focusTarget?.focus?.({ preventScroll: true });
    });
}

function captureFlowAuthoringFocusSnapshot() {
    const activeElement = document.activeElement;
    if (!activeElement?.closest?.('#flow-authoring-surface')) return null;
    const target = getFlowAuthoringTarget(activeElement);
    return {
        mode: 'source',
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        field: String(activeElement.dataset?.flowField || ''),
        selectionStart: Number.isInteger(activeElement.selectionStart) ? activeElement.selectionStart : null,
        selectionEnd: Number.isInteger(activeElement.selectionEnd) ? activeElement.selectionEnd : null,
        selectionDirection: activeElement.selectionDirection || 'none',
    };
}

function captureFlowDirectEditFocusSnapshot() {
    const proxy = _flowDirectEditProxy;
    const session = _flowDirectEditSession;
    if (!proxy?.isConnected || !session || !isFlowDirectEditing(session.groupId)) return null;
    return {
        mode: 'direct',
        groupId: session.groupId,
        sectionId: session.sectionId,
        blockId: session.blockId,
        languageKey: session.languageKey,
        selectionStart: Number.isInteger(proxy.selectionStart) ? proxy.selectionStart : session.selectionStart,
        selectionEnd: Number.isInteger(proxy.selectionEnd) ? proxy.selectionEnd : session.selectionEnd,
        selectionDirection: proxy.selectionDirection || session.selectionDirection || 'none',
    };
}

function restoreFlowDirectEditFocusSnapshot(snapshot) {
    if (snapshot?.mode !== 'direct') return false;
    const group = getFlowGroupById(snapshot.groupId);
    const sourceLanguage = String(group?.flow?.document?.sourceLanguage || '');
    const section = group?.flow?.document?.sections?.find((entry) => entry?.id === snapshot.sectionId);
    const block = section?.blocks?.find((entry) => entry?.id === snapshot.blockId);
    if (
        !group
        || sourceLanguage !== snapshot.languageKey
        || (block?.type !== 'heading' && block?.type !== 'paragraph')
    ) {
        if (group) selectFlowGeneratedPage(group.id);
        return false;
    }
    const text = String(block.texts?.[sourceLanguage] || '');
    const start = Math.max(0, Math.min(Number(snapshot.selectionStart) || 0, text.length));
    const end = Math.max(start, Math.min(Number(snapshot.selectionEnd) || start, text.length));
    const direction = snapshot.selectionDirection === 'backward' ? 'backward' : 'none';
    const focusOffset = direction === 'backward' ? start : end;
    const mapped = mapFlowTextUtf16OffsetToGrapheme(
        text,
        focusOffset,
        sourceLanguage,
        direction === 'backward' ? 'backward' : 'forward',
    );
    selectFlowDirectEditing(group.id, {
        sectionId: section.id,
        blockId: block.id,
        languageKey: sourceLanguage,
        graphemeOffset: mapped.graphemeOffset,
        utf16Offset: mapped.utf16Offset,
        affinity: direction === 'backward' ? 'backward' : 'forward',
    });
    return true;
}

function captureFlowEditorFocusSnapshot() {
    return captureFlowDirectEditFocusSnapshot() || captureFlowAuthoringFocusSnapshot();
}

function restoreFlowAuthoringFocusSnapshot(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
        const root = getFlowAuthoringSurface();
        const candidates = [...(root?.querySelectorAll?.(`[data-flow-field="${snapshot.field}"]`) || [])];
        const focusTarget = candidates.find((entry) => {
            const target = getFlowAuthoringTarget(entry);
            return target.groupId === snapshot.groupId
                && target.sectionId === snapshot.sectionId
                && target.blockId === snapshot.blockId;
        });
        if (!focusTarget) {
            restoreFlowAuthoringBlockFocus(snapshot.blockId, snapshot.sectionId);
            return;
        }
        focusTarget.focus({ preventScroll: true });
        if (snapshot.selectionStart !== null && typeof focusTarget.setSelectionRange === 'function') {
            const max = String(focusTarget.value || '').length;
            focusTarget.setSelectionRange(
                Math.min(snapshot.selectionStart, max),
                Math.min(snapshot.selectionEnd ?? snapshot.selectionStart, max),
                snapshot.selectionDirection,
            );
        }
    });
}

function handleFlowAuthoringInput(event) {
    const field = event.target?.dataset?.flowField;
    if (field !== 'block-text' && field !== 'section-title') return;
    const target = getFlowAuthoringTarget(event.target);
    const group = getFlowGroupById(target.groupId);
    const languageKey = String(target.root?.dataset?.languageKey || getFlowAuthoringLanguage(group));
    if (!group || !languageKey) return;
    const value = event.target.value;
    if (findFlowAuthoringValue(target, field, languageKey) === value) return;
    event.target.classList?.remove('is-translation-missing');
    if (field === 'section-title') {
        const outlineButton = [...(target.root?.querySelectorAll?.('.flow-authoring-outline [data-flow-section-id]') || [])]
            .find((entry) => entry.dataset.flowSectionId === target.sectionId);
        if (outlineButton) outlineButton.textContent = value || '名称未設定';
    }
    selectFlowSource(target.groupId, { sectionId: target.sectionId, blockId: target.blockId });
    applyFlowAuthoringEdit({
        type: field === 'section-title' ? 'setSectionTitle' : 'setText',
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        languageKey,
        text: value,
    }, {
        historyKey: `flow:${target.groupId}:${target.sectionId}:${target.blockId || 'title'}:${languageKey}`,
    });
}

function handleFlowAuthoringChange(event) {
    const field = event.target?.dataset?.flowField;
    if (field === 'translation-provider') {
        const providerId = String(event.target.value || '');
        const provider = getFlowTranslationProviderOptions().find((entry) => (
            entry.id === providerId && entry.available !== false
        ));
        if (!provider || _flowTranslationJob?.state === 'running') return;
        _flowTranslationRuntime.providerId = providerId;
        _flowTranslationJob = null;
        refreshFlowTranslationAutomationSurface();
        if (_flowTranslationRuntime.modelStateByProvider[providerId] !== 'ready') {
            void loadFlowTranslationProviderModels(providerId);
        }
        return;
    }
    if (field === 'translation-model') {
        if (_flowTranslationJob?.state === 'running') return;
        const providerId = _flowTranslationRuntime.providerId;
        const modelId = String(event.target.value || '');
        const models = _flowTranslationRuntime.modelsByProvider[providerId] || [];
        if (models.some((model) => model.id === modelId)) {
            _flowTranslationRuntime.modelIdByProvider[providerId] = modelId;
            _flowTranslationJob = null;
            updateCurrentFlowTranslationAutomation();
        }
        return;
    }
    if (field !== 'heading-level') return;
    const target = getFlowAuthoringTarget(event.target);
    const group = getFlowGroupById(target.groupId);
    if (!group || getFlowAuthoringLanguage(group) !== group.flow?.document?.sourceLanguage) return;
    const level = Number(event.target.value);
    if (findFlowAuthoringValue(target, 'heading-level', group.flow.document.sourceLanguage) === level) return;
    endHistoryGroup();
    applyFlowAuthoringEdit({
        type: 'setHeadingLevel',
        groupId: target.groupId,
        sectionId: target.sectionId,
        blockId: target.blockId,
        level,
    }, { immediate: true });
}

function handleFlowAuthoringAction(event) {
    const button = event.target?.closest?.('[data-flow-action]');
    if (!button) return;
    const action = button.dataset.flowAction;
    const target = getFlowAuthoringTarget(button);
    if (action === 'jump-section') {
        const section = [...(getFlowAuthoringSurface()?.querySelectorAll?.('[data-testid="flow-section"]') || [])]
            .find((entry) => entry.dataset.flowSectionId === button.dataset.flowSectionId);
        section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        return;
    }
    const group = getFlowGroupById(target.groupId);
    if (!group) return;
    const languageKey = getFlowAuthoringLanguage(group);
    if (action === 'refresh-translation-models') {
        if (languageKey === group.flow?.document?.sourceLanguage || _flowTranslationJob?.state === 'running') return;
        event.preventDefault();
        _flowTranslationJob = null;
        void loadFlowTranslationProviderModels(_flowTranslationRuntime.providerId, { force: true });
        return;
    }
    if (action === 'start-translation') {
        if (languageKey === group.flow?.document?.sourceLanguage) return;
        event.preventDefault();
        void startFlowTranslationJob(group.id);
        return;
    }
    if (action === 'cancel-translation') {
        event.preventDefault();
        cancelFlowTranslationJob();
        return;
    }
    if (action === 'confirm-translation') {
        if (languageKey === group.flow?.document?.sourceLanguage) return;
        event.preventDefault();
        endHistoryGroup();
        applyFlowAuthoringEdit({
            type: 'confirmTranslation',
            groupId: target.groupId,
            languageKey,
        }, { rerender: true, immediate: true });
        return;
    }
    if (languageKey !== group.flow?.document?.sourceLanguage) return;
    if (!target.groupId || !target.sectionId) return;
    event.preventDefault();
    endHistoryGroup();
    if (action === 'insert') {
        const nextBlocks = applyFlowAuthoringEdit({
            type: 'insertBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            afterBlockId: target.blockId || null,
            blockType: button.dataset.flowBlockType,
            languageKey: getFlowGroupById(target.groupId)?.flow?.document?.sourceLanguage || 'ja',
        }, { rerender: true, immediate: true });
        const nextSection = getFlowAuthoringSectionFromBlocks(nextBlocks, target.groupId, target.sectionId);
        const afterIndex = target.blockId
            ? nextSection?.blocks?.findIndex((block) => block?.id === target.blockId)
            : (nextSection?.blocks?.length ?? 1) - 2;
        const insertedBlock = nextSection?.blocks?.[Math.max(0, Number(afterIndex) + 1)];
        restoreFlowAuthoringBlockFocus(insertedBlock?.id || '', target.sectionId);
        return;
    }
    if (action === 'remove') {
        const previousSection = getFlowAuthoringSectionFromBlocks(state.blocks, target.groupId, target.sectionId);
        const previousIndex = previousSection?.blocks?.findIndex((block) => block?.id === target.blockId) ?? -1;
        const nextBlocks = applyFlowAuthoringEdit({
            type: 'removeBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            blockId: target.blockId,
        }, { rerender: true, immediate: true });
        const nextSection = getFlowAuthoringSectionFromBlocks(nextBlocks, target.groupId, target.sectionId);
        const focusBlock = nextSection?.blocks?.[Math.min(Math.max(previousIndex, 0), Math.max(0, nextSection.blocks.length - 1))];
        restoreFlowAuthoringBlockFocus(focusBlock?.id || '', target.sectionId);
        return;
    }
    if (action === 'move') {
        applyFlowAuthoringEdit({
            type: 'moveBlock',
            groupId: target.groupId,
            sectionId: target.sectionId,
            blockId: target.blockId,
            delta: Number(button.dataset.flowDelta),
        }, { rerender: true, immediate: true });
        restoreFlowAuthoringBlockFocus(target.blockId, target.sectionId);
    }
}

function handleFlowAuthoringFocus(event) {
    const target = getFlowAuthoringTarget(event.target);
    if (!target.groupId) return;
    selectFlowSource(target.groupId, { sectionId: target.sectionId, blockId: target.blockId });
}

function handleFlowAuthoringCompositionStart() {
    _flowAuthoringComposing = true;
    const root = getFlowAuthoringSurface();
    if (root) root.dataset.composing = 'true';
    if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
    _flowAuthoringReflowTimer = null;
}

function handleFlowAuthoringCompositionEnd(event) {
    _flowAuthoringComposing = false;
    const root = getFlowAuthoringSurface();
    if (root) root.dataset.composing = 'false';
    const target = getFlowAuthoringTarget(event.target);
    if (target.groupId) scheduleFlowAuthoringReflow(target.groupId, { immediate: true });
    triggerAutoSave();
}

function clampEditorFlowProjectionSelection(activeBlock, projection) {
    if (activeBlock?.kind !== 'flow') return;
    const pageCount = projection.pages.filter((page) => (
        page.kind === 'flow' && page.groupId === activeBlock.id
    )).length;
    setSelectedFlowRuntimePageIndex(
        activeBlock.id,
        getSelectedFlowRuntimePageIndex(activeBlock.id),
        pageCount,
    );
}

function getFlowProjectionErrorMessage(error) {
    if (error?.code === 'FLOW_LANGUAGE_TYPOGRAPHY_MISSING') {
        return 'このFlow原稿の組版設定を確認してください。';
    }
    if (error?.code === 'MAX_PAGES_EXCEEDED') {
        return 'ページ数が安全上限を超えました。';
    }
    return error?.message || 'Flowページの生成に失敗しました。';
}

function getEditorFlowProjectionLanguage(projectionTarget) {
    const sourceLanguage = projectionTarget?.flow?.document?.sourceLanguage || state.defaultLang || 'ja';
    return projectionTarget?.kind === 'flow'
        ? getFlowAuthoringLanguage(projectionTarget)
        : state.activeLang || state.defaultLang || sourceLanguage;
}

function requestEditorFlowProjection(activeBlock) {
    if (activeBlock?.kind !== 'flow') return;
    const languageKey = getEditorFlowProjectionLanguage(activeBlock);
    const requestKey = createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, 'editor');
    const cached = getCachedFlowRuntimePageProjection(state, languageKey, state.sections || [], document, 'editor');
    if (cached) {
        _editorFlowProjectionController?.abort();
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _editorFlowProjectionRequestId += 1;
        const currentBlock = getActiveBlock();
        clampEditorFlowProjectionSelection(currentBlock, cached);
        if (currentBlock?.kind === 'flow') {
            renderThumbs();
            _flowAuthoringRenderedRevision = _flowAuthoringSourceRevision;
            if (isFlowSourceSelected(currentBlock.id)) updateActiveFlowAuthoringStatus(cached);
            else renderEditorFlowGeneratedPage(currentBlock, cached);
        } else if (!state.sections?.[state.activeIdx]) {
            const flowBlockIndex = (state.blocks || []).findIndex((block) => block?.id === activeBlock.id);
            if (flowBlockIndex >= 0) changeBlock(flowBlockIndex, refreshForThumbSelection);
        } else {
            renderThumbs();
            syncPageNavigationSlider();
            syncEditorPageCounters();
        }
        return;
    }
    if (_editorFlowProjectionRequestKey === requestKey && _editorFlowProjectionController) return;

    _editorFlowProjectionController?.abort();
    const controller = new AbortController();
    const requestId = _editorFlowProjectionRequestId + 1;
    _editorFlowProjectionRequestId = requestId;
    _editorFlowProjectionRequestKey = requestKey;
    _editorFlowProjectionController = controller;
    const render = document.getElementById('content-render');
    if (render) render.dataset.flowPreviewState = 'working';
    updateActiveFlowAuthoringStatus(null, { state: 'working' });

    void createFlowRuntimePageProjection(state, {
        ownerDocument: document,
        sessionScope: 'editor',
        fixedPages: state.sections || [],
        languageKey,
        revision: requestId,
        signal: controller.signal,
        onProgress(progress) {
            if (requestId !== _editorFlowProjectionRequestId || controller.signal.aborted) return;
            const status = document.querySelector('#flow-readonly-placeholder [data-flow-progress]');
            if (status) status.textContent = `ページ生成中… ${progress.generatedPageCount}ページ`;
        },
    }).then((projection) => {
        if (
            controller.signal.aborted
            || requestId !== _editorFlowProjectionRequestId
            || requestKey !== createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, 'editor')
            || languageKey !== getEditorFlowProjectionLanguage(getActiveBlock())
        ) return;
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _flowAuthoringRenderedRevision = _flowAuthoringSourceRevision;
        const currentBlock = getActiveBlock();
        clampEditorFlowProjectionSelection(currentBlock, projection);
        renderThumbs();
        if (currentBlock?.kind === 'flow') {
            if (isFlowSourceSelected(currentBlock.id)) updateActiveFlowAuthoringStatus(projection);
            else renderEditorFlowGeneratedPage(currentBlock, projection);
        } else if (!state.sections?.[state.activeIdx]) {
            const flowBlockIndex = (state.blocks || []).findIndex((block) => block?.id === activeBlock.id);
            if (flowBlockIndex >= 0) changeBlock(flowBlockIndex, refreshForThumbSelection);
        } else {
            syncPageNavigationSlider();
            syncEditorPageCounters();
        }
    }).catch((error) => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        console.error('[Flow pages] Editor preview failed:', error);
        if (
            requestId !== _editorFlowProjectionRequestId
            || languageKey !== getEditorFlowProjectionLanguage(getActiveBlock())
        ) return;
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        const currentBlock = getActiveBlock();
        if (currentBlock?.kind !== 'flow') return;
        if (isFlowSourceSelected(currentBlock.id)) {
            updateActiveFlowAuthoringStatus(null, {
                state: 'error',
                message: getFlowProjectionErrorMessage(error),
            });
            return;
        }
        clearFlowDirectEditRuntime();
        selectFlowGeneratedPage(currentBlock.id);
        const currentRender = document.getElementById('content-render');
        if (!currentRender) return;
        currentRender.innerHTML = `
            <div id="flow-readonly-placeholder" data-flow-preview-state="error">
                <span class="material-icons">error_outline</span>
                <strong>Flowページを表示できません</strong>
                <span>${escapeStudioHtml(getFlowProjectionErrorMessage(error))}</span>
            </div>`;
        currentRender.dataset.flowPreviewState = 'error';
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = `Flowページを表示できません: ${getFlowProjectionErrorMessage(error)}`;
            pageLockNote.style.display = 'block';
        }
    });
}

document.addEventListener(FLOW_RUNTIME_INVALIDATED_EVENT, () => {
    if (getCurrentRoom() !== 'editor' || !hasFlowGroups(state)) return;
    _editorFlowProjectionController?.abort();
    _editorFlowProjectionController = null;
    _editorFlowProjectionRequestKey = '';
    _editorFlowProjectionRequestId += 1;
    const activeBlock = getActiveBlock();
    if (activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id)) {
        updateActiveFlowAuthoringStatus(null, { state: 'working' });
        if (!_flowAuthoringComposing) requestEditorFlowProjection(activeBlock);
        return;
    }
    refresh();
});

function getEditorPresentationState() {
    const projection = getEditorPageProjection();
    const projectionIndex = getActiveProjectionPageIndex(projection);
    if (projection && projectionIndex >= 0) {
        const total = projection.totalPageCount;
        return {
            projection,
            activeIndex: projectionIndex,
            total,
            label: getPageDisplayLabel(projectionIndex, total, state.book, state.bookMode),
            readableTotal: getReadablePageCount(total, state.book, state.bookMode) || total,
        };
    }
    const total = (state.sections || []).length;
    const activeIndex = Math.min(Math.max(state.activeIdx ?? 0, 0), Math.max(0, total - 1));
    return {
        projection: null,
        activeIndex,
        total,
        label: getPageDisplayLabel(activeIndex, total, state.book, state.bookMode),
        readableTotal: getReadablePageCount(total, state.book, state.bookMode) || total,
    };
}

function syncEditorPageCounters() {
    const presentation = getEditorPresentationState();
    const counterText = `${presentation.label || '—'} / ${presentation.readableTotal || presentation.total || '—'}`;
    const canvasPageLabel = document.getElementById('canvas-page-label');
    if (canvasPageLabel) {
        const langCode = (state.activeLang || 'ja').toUpperCase();
        canvasPageLabel.textContent = `${counterText} ${langCode}`;
    }
    const stripCounter = document.getElementById('page-strip-counter');
    if (stripCounter) stripCounter.textContent = counterText;
    const mobileCounter = document.getElementById('page-strip-counter-mobile');
    if (mobileCounter) mobileCounter.textContent = counterText;

    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');
    const pageDir = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const activeIndex = presentation.activeIndex;
    const total = presentation.total;
    if (prevBtn) prevBtn.disabled = pageDir === 'rtl' ? activeIndex >= total - 1 : activeIndex <= 0;
    if (nextBtn) nextBtn.disabled = pageDir === 'rtl' ? activeIndex <= 0 : activeIndex >= total - 1;
}

function getEditorImageFrameMetrics(bgUrl, frameWidth = EDITOR_FRAME_WIDTH, frameHeight = EDITOR_FRAME_HEIGHT, percentBaseWidth = EDITOR_FRAME_WIDTH, percentBaseHeight = EDITOR_FRAME_HEIGHT) {
    const aspect = editorImageAspectCache.get(bgUrl);
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
        return {
            widthPercent: (frameWidth / percentBaseWidth) * 100,
            heightPercent: (frameHeight / percentBaseHeight) * 100
        };
    }

    const frameAspect = frameWidth / frameHeight;
    if (aspect > frameAspect) {
        return {
            widthPercent: (frameHeight * aspect / percentBaseWidth) * 100,
            heightPercent: (frameHeight / percentBaseHeight) * 100
        };
    }

    return {
        widthPercent: (frameWidth / percentBaseWidth) * 100,
        heightPercent: (frameWidth / aspect / percentBaseHeight) * 100
    };
}

function resetImageSnapState() {
    imageSnapState = { ...EMPTY_IMAGE_SNAP_STATE };
}

function getImageSnapMetrics(bgUrl, pos) {
    const frameMetrics = getEditorImageFrameMetrics(bgUrl);
    const width = EDITOR_FRAME_WIDTH * (frameMetrics.widthPercent / 100);
    const height = EDITOR_FRAME_HEIGHT * (frameMetrics.heightPercent / 100);
    const scale = Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1);
    const rotation = Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0;
    const rad = (rotation * Math.PI) / 180;
    const halfW = (width * scale) / 2;
    const halfH = (height * scale) / 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const extentX = Math.abs(halfW * cos) + Math.abs(halfH * sin);
    const extentY = Math.abs(halfW * sin) + Math.abs(halfH * cos);

    return {
        extentX,
        extentY
    };
}

function applyImageSnapping(pos, bgUrl) {
    if (!isImageAdjusting || !pos) {
        resetImageSnapState();
        return;
    }

    const nextState = { ...EMPTY_IMAGE_SNAP_STATE };
    const { extentX, extentY } = getImageSnapMetrics(bgUrl, pos);
    let x = Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0;
    let y = Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0;

    if (Math.abs(x) <= IMAGE_SNAP_THRESHOLD) {
        x = 0;
        nextState.centerX = true;
    } else {
        const snapLeftX = -EDITOR_FRAME_WIDTH / 2 + extentX;
        const snapRightX = EDITOR_FRAME_WIDTH / 2 - extentX;
        if (Math.abs(x - snapLeftX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapLeftX;
            nextState.edgeLeft = true;
        } else if (Math.abs(x - snapRightX) <= IMAGE_SNAP_THRESHOLD) {
            x = snapRightX;
            nextState.edgeRight = true;
        }
    }

    if (Math.abs(y) <= IMAGE_SNAP_THRESHOLD) {
        y = 0;
        nextState.centerY = true;
    } else {
        const snapTopY = -EDITOR_FRAME_HEIGHT / 2 + extentY;
        const snapBottomY = EDITOR_FRAME_HEIGHT / 2 - extentY;
        if (Math.abs(y - snapTopY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapTopY;
            nextState.edgeTop = true;
        } else if (Math.abs(y - snapBottomY) <= IMAGE_SNAP_THRESHOLD) {
            y = snapBottomY;
            nextState.edgeBottom = true;
        }
    }

    if (Math.abs(x) <= 0.001) nextState.centerX = true;
    if (Math.abs(y) <= 0.001) nextState.centerY = true;

    pos.x = x;
    pos.y = y;
    imageSnapState = nextState;
}

function getImageAdjustRenderMetrics(bgUrl, pos, options = {}) {
    const frameWidth = Number(options.frameWidth) || EDITOR_FRAME_WIDTH;
    const frameHeight = Number(options.frameHeight) || EDITOR_FRAME_HEIGHT;
    const percentBaseWidth = Number(options.percentBaseWidth) || EDITOR_FRAME_WIDTH;
    const percentBaseHeight = Number(options.percentBaseHeight) || EDITOR_FRAME_HEIGHT;
    const offsetX = Number(options.offsetX) || 0;
    const frameMetrics = getEditorImageFrameMetrics(bgUrl, frameWidth, frameHeight, percentBaseWidth, percentBaseHeight);
    const scale = Math.max(0.1, Number(pos?.scale) || 1);
    const rotation = Number(pos?.rotation) || 0;
    const flipX = pos?.flipX ? ' scaleX(-1)' : '';
    return {
        frameMetrics,
        invScale: 1 / scale,
        targetTransform: `translate(calc(-50% + ${(Number(pos?.x) || 0) + offsetX}px), calc(-50% + ${Number(pos?.y) || 0}px)) scale(${scale}) rotate(${rotation}deg)${flipX}`
    };
}

function syncImageAdjustDom() {
    const s = state.sections?.[state.activeIdx];
    if (!s || s.type !== 'image') return false;
    const pos = getActiveImagePosition();
    if (!pos) return false;

    const target = document.getElementById('image-adjust-target');
    if (!target) return false;

    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    const { frameMetrics, invScale, targetTransform } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(s, state.activeIdx));

    target.style.width = `${frameMetrics.widthPercent}%`;
    target.style.height = `${frameMetrics.heightPercent}%`;
    target.style.transform = targetTransform;

    const overlay = document.getElementById('image-adjust-overlay');
    if (overlay) {
        overlay.style.setProperty('--inv-handle-scale', String(invScale));
    }

    const rotateSlider = document.getElementById('image-rotate-slider');
    if (rotateSlider) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateSlider.value = String(rotation);
    }
    const rotateShell = document.querySelector('.img-rotate-slider-shell');
    if (rotateShell) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        const ratio = (180 - rotation) / 360;
        rotateShell.style.setProperty('--rotate-ratio', String(ratio));
        rotateShell.setAttribute('aria-valuenow', String(rotation));
    }
    const rotateValue = document.getElementById('image-rotate-value');
    if (rotateValue) {
        const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(pos.rotation) || 0)));
        rotateValue.textContent = `${rotation.toFixed(1)}°`;
    }

    const safeFrame = document.querySelector('#image-stage-overlay .image-safe-frame');
    if (safeFrame) {
        safeFrame.classList.toggle('active-left', !!imageSnapState.edgeLeft);
        safeFrame.classList.toggle('active-right', !!imageSnapState.edgeRight);
        safeFrame.classList.toggle('active-top', !!imageSnapState.edgeTop);
        safeFrame.classList.toggle('active-bottom', !!imageSnapState.edgeBottom);
    }

    const verticalGuide = document.querySelector('#image-stage-overlay .image-center-guide.vertical');
    if (verticalGuide) verticalGuide.classList.toggle('active', !!imageSnapState.centerX);
    const horizontalGuide = document.querySelector('#image-stage-overlay .image-center-guide.horizontal');
    if (horizontalGuide) horizontalGuide.classList.toggle('active', !!imageSnapState.centerY);

    const flipBtn = document.getElementById('image-flip-btn');
    if (flipBtn) flipBtn.classList.toggle('active', !!pos.flipX);

    return true;
}

let imageAdjustRaf = null;
let isAdjustingRotationSlider = false;
let imageAdjustThumbTimer = null;
function scheduleImageAdjustThumbUpdate() {
    if (imageAdjustThumbTimer) clearTimeout(imageAdjustThumbTimer);
    imageAdjustThumbTimer = setTimeout(() => {
        imageAdjustThumbTimer = null;
        renderThumbs();
    }, 80);
}

function scheduleImageAdjustDomUpdate() {
    if (imageAdjustRaf) return;
    imageAdjustRaf = requestAnimationFrame(() => {
        imageAdjustRaf = null;
        if (syncImageAdjustDom()) {
            scheduleImageAdjustThumbUpdate();
        } else {
            refresh();
        }
    });
}

window.handleEditorImageLoad = (e) => {
    const img = e?.target;
    const src = img?.getAttribute('src');
    const naturalWidth = Number(img?.naturalWidth);
    const naturalHeight = Number(img?.naturalHeight);
    if (!src || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
        return;
    }

    const aspect = naturalWidth / naturalHeight;
    const prev = editorImageAspectCache.get(src);
    if (prev && Math.abs(prev - aspect) < 0.0001) return;

    editorImageAspectCache.set(src, aspect);
    refresh();
};

function getActiveBlock() {
    const blocks = state.blocks || [];
    if (Number.isInteger(state.activeBlockIdx) && blocks[state.activeBlockIdx]) {
        return blocks[state.activeBlockIdx];
    }
    const fallbackBlockIdx = getBlockIndexFromPageIndex(blocks, state.activeIdx);
    if (fallbackBlockIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: fallbackBlockIdx });
        return blocks[fallbackBlockIdx];
    }
    return null;
}

function getEditableActiveFixedSection(expectedType = null) {
    const activeBlock = getActiveBlock();
    if (activeBlock?.kind !== 'page') return null;
    const pageIndex = getPageIndexFromBlockIndex(state.blocks || [], state.activeBlockIdx);
    if (pageIndex < 0 || pageIndex !== state.activeIdx) return null;
    const section = state.sections?.[pageIndex];
    if (!section || (expectedType && section.type !== expectedType)) return null;
    return section;
}

function canEditActiveFixedPage(expectedType = null) {
    return !!getEditableActiveFixedSection(expectedType);
}

function getFlowPreviewTargetBlock(activeBlock = getActiveBlock()) {
    if (activeBlock?.kind === 'flow') return activeBlock;
    const blocks = state.blocks || [];
    const activeIndex = Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : -1;
    if (activeIndex >= 0) {
        for (let index = activeIndex + 1; index < blocks.length; index += 1) {
            if (blocks[index]?.kind === 'flow') return blocks[index];
        }
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
            if (blocks[index]?.kind === 'flow') return blocks[index];
        }
    }
    return blocks.find((block) => block?.kind === 'flow') || null;
}


function syncBlocksFromState() {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'blocks',
        value: syncBlocksWithSections(state.blocks, state.sections, state.languages, { strictSpine: state.version === 6 }),
    } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });
    const activeBlock = getActiveBlock();
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, state.activeBlockIdx);
    if (pageIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx });
    }
    if (!activeBlock && state.blocks?.length) {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: 0 });
    }
}

function getProjectDisplayName() {
    return state.projectName || '新規プロジェクト';
}

function ensureProjectIdentity() {
    if (!state.projectId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: createId('proj') } });
    }
    if (!state.workId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    }

    if (!state.projectName) {
        const headerText = (document.getElementById('project-title')?.textContent || '').trim();
        const fallbackName = headerText && headerText !== '新規プロジェクト'
            ? headerText
            : (state.title || '新規プロジェクト');
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: fallbackName } });
    }
}

function formatHomeDate(value) {
    const date = value instanceof Date
        ? value
        : (typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0));
    if (Number.isNaN(date.getTime())) return '';
    const locale = getUILang() === 'en' ? 'en-US' : 'ja-JP';
    return date.toLocaleDateString(locale);
}

function formatProjectLanguages(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => String(code).toUpperCase()).join(', ');
}

function getStudioLanguageBadgeModifier(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'ja') return 'ja';
    if (normalized === 'en' || normalized === 'en-us') return 'en-us';
    if (normalized === 'en-gb') return 'en-gb';
    if (normalized === 'zh-cn') return 'zh-cn';
    if (normalized === 'zh-tw') return 'zh-tw';
    return 'generic';
}

function renderStudioLanguageBadge(code, className = 'home-lang-badge') {
    const modifier = getStudioLanguageBadgeModifier(code);
    const label = String(code || '').toUpperCase();
    return `<span class="${className} home-lang-${modifier}" title="${escapeStudioHtml(label)}">${modifier === 'generic' ? escapeStudioHtml(label) : ''}</span>`;
}

function renderLanguageBadges(languages) {
    const list = Array.isArray(languages) && languages.length > 0 ? languages : ['ja'];
    return list.map((code) => renderStudioLanguageBadge(code)).join('');
}

function formatProjectBytes(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Home room — ダッシュボード（クラウド / ローカル一覧） ─────────────────

function renderHomeCard(project, source) {
    const displayName = project.projectName || project.title || project.id || '無題';
    const thumb = project.listThumbnail || (
        source === 'cloud'
            ? getCoverImage(project.dsfPages, project.pages, project.blocks, project.sections)
            : (project.thumbnail || '')
    );
    const pageCount = source === 'cloud'
        ? getPageCount(project.pages, project.blocks, project.sections)
        : Math.max(1, Number(project.pageCount || 0));
    const updatedAt = formatHomeDate(project.lastUpdated || project.updatedAt);
    const sourceLabel = source === 'cloud' ? t('home_source_cloud') : t('home_source_local');
    const languageLabel = formatProjectLanguages(project.languages);
    const sizeLabel = formatProjectBytes(project.projectBytes);
    const languageBadges = renderLanguageBadges(project.languages);

    return `
        <button class="home-project-card" data-home-source="${source}" data-id="${project.id}">
            ${source === 'cloud' ? `<span class="home-project-delete material-icons" data-delete-cloud="${project.id}" title="${t('btn_delete')}">delete</span>` : ''}
            <div class="home-project-thumb">
                ${thumb
                    ? `<img src="${thumb}" alt="${displayName}">`
                    : `<div class="home-project-thumb-fallback"><span class="material-icons">folder</span></div>`}
            </div>
            <div class="home-project-info">
                <div class="home-project-title">${displayName}</div>
                <div class="home-project-meta">${t('home_pages_count', { count: pageCount })} · ${sourceLabel}${updatedAt ? ` · ${updatedAt}` : ''}</div>
                <div class="home-project-meta home-project-meta-secondary">
                    <span class="home-lang-badges">${languageBadges}</span>
                    <span>${languageLabel}${sizeLabel ? ` · ${sizeLabel}` : ''}</span>
                </div>
            </div>
        </button>
    `;
}

function isPublishedHomeWork(project) {
    return Array.isArray(project?.dsfPages) && project.dsfPages.length > 0;
}

function getHomeWorkStatus(project) {
    return String(project?.dsfStatus || project?.visibility || 'draft');
}

function getHomeWorkStatusLabel(status) {
    const map = {
        draft: t('home_status_draft'),
        public: t('home_status_public'),
        unlisted: t('home_status_unlisted'),
        private: t('home_status_private')
    };
    return map[status] || status;
}

function getHomeWorkDate(project) {
    return formatHomeDate(project?.dsfPublishedAt || project?.updatedAt || project?.lastUpdated);
}

function formatStudioPublicationDate(value) {
    return formatPublicationDate(value, getUILang() === 'en' ? 'en-US' : 'ja-JP');
}

function renderHomePublicationMeta(publication) {
    if (!publication || typeof publication !== 'object') return '';
    const listedUntil = formatStudioPublicationDate(publication.listedUntil) || t('publication_no_limit');
    const publicFrom = formatStudioPublicationDate(publication.publicFrom) || t('publication_immediate');
    const publicUntil = formatStudioPublicationDate(publication.publicUntil) || t('publication_no_limit');
    const publicPeriod = `${publicFrom} - ${publicUntil}`;
    return `
        <div class="home-work-publication">
            <span>${escapeStudioHtml(t('publication_listed_until'))}: ${escapeStudioHtml(listedUntil)}</span>
            <span>${escapeStudioHtml(t('publication_public_period'))}: ${escapeStudioHtml(publicPeriod)}</span>
        </div>
    `;
}

async function loadHomeReviewSummary(workId) {
    if (!workId) return { reviewCount: 0, goodCount: 0, badCount: 0, unavailable: false };
    try {
        const reviewQuery = query(
            collection(db, 'reviews', workId, 'items'),
            where('status', '==', 'published'),
            limit(50)
        );
        const snap = await getDocs(reviewQuery);
        let reviewCount = 0;
        let goodCount = 0;
        let badCount = 0;
        snap.forEach((entry) => {
            const data = entry.data() || {};
            reviewCount += 1;
            goodCount += Math.max(0, Number(data.goodCount) || 0);
            badCount += Math.max(0, Number(data.badCount) || 0);
        });
        return { reviewCount, goodCount, badCount, unavailable: false };
    } catch (e) {
        console.warn('[Home] Failed to load review summary:', workId, e);
        return { reviewCount: 0, goodCount: 0, badCount: 0, unavailable: true };
    }
}

async function loadHomeReviewSummaries(works) {
    const entries = await Promise.all(
        works.slice(0, 12).map(async (work) => {
            const workId = work.workId || work.id;
            return [workId, await loadHomeReviewSummary(workId)];
        })
    );
    return new Map(entries);
}

function renderHomeStatCard(icon, label, value, hint = '') {
    return `
        <article class="home-stat-card">
            <span class="material-icons" aria-hidden="true">${escapeStudioHtml(icon)}</span>
            <div>
                <strong>${escapeStudioHtml(value)}</strong>
                <span>${escapeStudioHtml(label)}</span>
                ${hint ? `<small>${escapeStudioHtml(hint)}</small>` : ''}
            </div>
        </article>
    `;
}

function renderHomeDashboardStats({ cloudProjects, localProjects, works, reviewTotals }) {
    const cloudCount = Array.isArray(cloudProjects) ? cloudProjects.length : 0;
    const publicCount = works.filter((work) => getHomeWorkStatus(work) === 'public').length;
    const visibleCount = works.filter((work) => ['public', 'unlisted'].includes(getHomeWorkStatus(work))).length;
    const draftCount = works.filter((work) => !['public', 'unlisted'].includes(getHomeWorkStatus(work))).length;
    return [
        renderHomeStatCard('library_books', t('home_stat_works'), String(works.length), t('home_stat_works_hint', { count: visibleCount })),
        renderHomeStatCard('public', t('home_stat_public'), String(publicCount), t('home_stat_public_hint', { count: draftCount })),
        renderHomeStatCard('rate_review', t('home_stat_reviews'), String(reviewTotals.reviewCount), t('home_stat_reviews_hint', { count: reviewTotals.goodCount })),
        renderHomeStatCard('folder', t('home_stat_projects'), String(cloudCount), t('home_stat_projects_hint', { count: localProjects.length }))
    ].join('');
}

function renderHomeWorkCard(work, reviewSummary) {
    const workId = work.workId || work.id;
    const status = getHomeWorkStatus(work);
    const title = work.title || work.projectName || work.id || 'Untitled';
    const thumb = getCoverImage(work.dsfPages, work.pages, work.blocks, work.sections);
    const pageCount = Array.isArray(work.dsfPages) && work.dsfPages.length
        ? work.dsfPages.length
        : getPageCount(work.pages, work.blocks, work.sections);
    const langs = Array.isArray(work.dsfLangs) && work.dsfLangs.length ? work.dsfLangs : work.languages;
    const languageBadges = renderLanguageBadges(langs);
    const date = getHomeWorkDate(work);
    const publicationMeta = renderHomePublicationMeta(work.publication);
    const reviewText = reviewSummary?.unavailable
        ? t('home_reviews_unavailable')
        : t('home_work_reviews', {
            reviews: reviewSummary?.reviewCount || 0,
            good: reviewSummary?.goodCount || 0,
            bad: reviewSummary?.badCount || 0
        });

    return `
        <article class="home-work-card" data-work-id="${escapeStudioHtml(workId)}" data-project-id="${escapeStudioHtml(work.id)}">
            <div class="home-work-thumb">
                ${thumb
                    ? `<img src="${escapeStudioHtml(thumb)}" alt="${escapeStudioHtml(title)}" loading="lazy">`
                    : `<div class="home-work-thumb-fallback"><span class="material-icons">auto_stories</span></div>`}
            </div>
            <div class="home-work-main">
                <div class="home-work-topline">
                    <span class="home-work-status home-work-status-${escapeStudioHtml(status)}">${escapeStudioHtml(getHomeWorkStatusLabel(status))}</span>
                    <span class="home-lang-badges">${languageBadges}</span>
                </div>
                <h4>${escapeStudioHtml(title)}</h4>
                <p>${escapeStudioHtml(t('home_work_meta', { pages: pageCount, date: date || '—' }))}</p>
                ${publicationMeta}
                <div class="home-work-metrics">
                    <span><strong>${escapeStudioHtml(String(reviewSummary?.reviewCount || 0))}</strong>${escapeStudioHtml(t('home_metric_reviews'))}</span>
                    <span><strong>${escapeStudioHtml(String(reviewSummary?.goodCount || 0))}</strong>${escapeStudioHtml(t('home_metric_good'))}</span>
                    <span><strong>${escapeStudioHtml(String(reviewSummary?.badCount || 0))}</strong>${escapeStudioHtml(t('home_metric_bad'))}</span>
                </div>
                <div class="home-work-review-note">${escapeStudioHtml(reviewText)}</div>
                <div class="home-work-actions">
                    <button type="button" class="home-work-action" data-home-open-project="${escapeStudioHtml(work.id)}">
                        <span class="material-icons">edit</span>${escapeStudioHtml(t('home_open_project'))}
                    </button>
                    <button type="button" class="home-work-action" data-home-copy-work="${escapeStudioHtml(workId)}">
                        <span class="material-icons">link</span>${escapeStudioHtml(t('home_copy_viewer'))}
                    </button>
                    <button type="button" class="home-work-action" onclick="switchRoom('works')">
                        <span class="material-icons">tune</span>${escapeStudioHtml(t('home_manage_work'))}
                    </button>
                </div>
            </div>
        </article>
    `;
}

async function renderHomeDashboard() {
    const cloudGrid = document.getElementById('home-cloud-grid');
    const localGrid = document.getElementById('home-local-grid');
    const cloudCount = document.getElementById('home-cloud-count');
    const localCount = document.getElementById('home-local-count');
    const statsEl = document.getElementById('home-dashboard-stats');
    const workGrid = document.getElementById('home-work-grid');
    const workCount = document.getElementById('home-work-count');
    if (!cloudGrid || !localGrid) return;

    if (statsEl) statsEl.innerHTML = renderHomeStatCard('sync', t('home_loading'), '...', '');
    if (workGrid) workGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">analytics</span><p>${t('home_loading')}</p></div>`;
    if (workCount) workCount.textContent = '...';
    cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_sync</span><p>${t('home_loading')}</p></div>`;
    localGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">history</span><p>${t('home_loading')}</p></div>`;
    if (cloudCount) cloudCount.textContent = '...';
    if (localCount) localCount.textContent = '...';

    const [cloudProjects, localProjects] = await Promise.all([
        fetchCloudProjects().catch((e) => {
            console.warn('[Home] Failed to load cloud projects:', e);
            return null;
        }),
        listLocalRecentProjects().catch((e) => {
            console.warn('[Home] Failed to load local recent projects:', e);
            return [];
        })
    ]);

    const works = Array.isArray(cloudProjects)
        ? cloudProjects.filter(isPublishedHomeWork).sort((a, b) => {
            const aTime = Number(a?.dsfPublishedAt?.toMillis?.() || a?.updatedAt?.toMillis?.() || 0);
            const bTime = Number(b?.dsfPublishedAt?.toMillis?.() || b?.updatedAt?.toMillis?.() || 0);
            return bTime - aTime;
        })
        : [];
    const reviewSummaries = await loadHomeReviewSummaries(works);
    const reviewTotals = works.reduce((acc, work) => {
        const summary = reviewSummaries.get(work.workId || work.id) || {};
        acc.reviewCount += Number(summary.reviewCount) || 0;
        acc.goodCount += Number(summary.goodCount) || 0;
        acc.badCount += Number(summary.badCount) || 0;
        return acc;
    }, { reviewCount: 0, goodCount: 0, badCount: 0 });

    if (statsEl) {
        statsEl.innerHTML = renderHomeDashboardStats({
            cloudProjects: Array.isArray(cloudProjects) ? cloudProjects : [],
            localProjects,
            works,
            reviewTotals
        });
    }
    if (workCount) workCount.textContent = String(works.length);
    if (workGrid) {
        if (!state.uid) {
            workGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">lock</span><p>${t('home_cloud_login')}</p></div>`;
        } else if (cloudProjects === null) {
            workGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_off</span><p>${t('home_cloud_error')}</p></div>`;
        } else if (!works.length) {
            workGrid.innerHTML = `
                <div class="home-empty-state">
                    <span class="material-icons">rocket_launch</span>
                    <p>${t('home_works_empty')}</p>
                    <button class="home-action-btn" onclick="switchRoom('press')"><span class="material-icons">publish</span>${t('btn_press_room')}</button>
                </div>`;
        } else {
            workGrid.innerHTML = works.slice(0, 6).map((work) => renderHomeWorkCard(work, reviewSummaries.get(work.workId || work.id))).join('');
        }
    }

    if (cloudProjects === null) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_off</span><p>${t('home_cloud_error')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '!';
    } else if (!state.uid) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">lock</span><p>${t('home_cloud_login')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else if (cloudProjects.length === 0) {
        cloudGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">cloud_done</span><p>${t('home_cloud_empty')}</p></div>`;
        if (cloudCount) cloudCount.textContent = '0';
    } else {
        cloudGrid.innerHTML = cloudProjects.map((project) => renderHomeCard(project, 'cloud')).join('');
        if (cloudCount) cloudCount.textContent = String(cloudProjects.length);
    }

    if (localProjects.length === 0) {
        localGrid.innerHTML = `<div class="home-empty-state"><span class="material-icons">folder_open</span><p>${t('home_local_empty')}</p></div>`;
        if (localCount) localCount.textContent = '0';
    } else {
        localGrid.innerHTML = localProjects.map((project) => renderHomeCard(project, 'local')).join('');
        if (localCount) localCount.textContent = String(localProjects.length);
    }

    cloudGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const pid = card.dataset.id;
            if (!pid) return;
            if (!await onLoadProject(pid)) return;
            cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap).catch(() => {});
            window.switchRoom('editor');
        });
    });

    cloudGrid.querySelectorAll('[data-delete-cloud]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pid = btn.dataset.deleteCloud;
            const project = (cloudProjects || []).find((item) => item.id === pid);
            const displayName = project?.projectName || project?.title || pid;
            if (!confirm(t('home_delete_confirm', { name: displayName }))) return;
            try {
                await deleteCloudProject(pid);
                await renderHomeDashboard();
            } catch (err) {
                console.error('[Home] Cloud delete failed:', err);
                alert(t('home_delete_error', { message: err.message }));
            }
        });
    });

    localGrid.querySelectorAll('.home-project-card').forEach((card) => {
        card.addEventListener('click', async () => {
            const snapshotId = card.dataset.id;
            try {
                await flushPendingSave();
                const loadedState = hydrateProjectFromPersistence(await loadLocalRecentProject(snapshotId));
                resetFlowRuntimeForProjectChange();
                clearHistory();
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: loadedState });
                refresh();
                window.switchRoom('editor');
            } catch (e) {
                console.error('[Home] Local project restore failed:', e);
                alert(t('home_local_open_error', { message: e.message }));
            }
        });
    });

    workGrid?.querySelectorAll('[data-home-open-project]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const pid = btn.dataset.homeOpenProject;
            const project = (cloudProjects || []).find((item) => item.id === pid);
            if (!project) return;
            if (!await onLoadProject(pid)) return;
            await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap);
            refresh();
            window.switchRoom('editor');
        });
    });

    workGrid?.querySelectorAll('[data-home-copy-work]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const workId = btn.dataset.homeCopyWork;
            if (!workId) return;
            const url = `${window.location.origin}/viewer?work=${encodeURIComponent(workId)}`;
            try {
                await navigator.clipboard.writeText(url);
                alert(t('home_copied_viewer_url', { url }));
            } catch (_) {
                prompt(t('home_copy_viewer_prompt'), url);
            }
        });
    });

    syncStudioShell();
}

// ── Studio 認証 UI — GIS ボタン + フォールバック Google ──
//    実体のサインインは gis-auth.js。ここはマークアップとスロット束ね。

function isVerifiedFlowPortableDownloadControl(control) {
    return hasFlowGroups(state)
        && control?.hasAttribute('data-flow-portable-download')
        && control.dataset.flowPortableState === 'ready'
        && document.body?.dataset?.room === 'press';
}

function isFlowHorizonDryRunControl(control) {
    return hasFlowGroups(state)
        && control?.id === 'press-publish-cloud-btn'
        && document.body?.dataset?.room === 'press';
}

function getFlowHorizonDryRunControlTitle(control) {
    return control?.dataset?.flowHorizonState === 'ready'
        ? 'Horizon upload入力のdry-runは合格しています。実upload・発行はまだ無効です'
        : 'Horizon upload入力をdry-runで検証中です。実upload・発行はまだ無効です';
}

function updateAuthUI() {
    const effectiveUser = state.user || firebaseAuth.currentUser || null;
    if (effectiveUser?.uid && state.uid !== effectiveUser.uid) {
        state.user = effectiveUser;
        state.uid = effectiveUser.uid;
    }
    const signedIn = !!(state.uid || effectiveUser?.uid);
    const saveStatus = document.getElementById('save-status');
    const authSlotNav = document.getElementById('studio-auth-slot-nav');
    const authSlotMobile = document.getElementById('studio-auth-slot-mobile');

    if (authSlotNav) renderStudioAuthSlot(authSlotNav, effectiveUser, { mobile: false, slotName: 'nav' });
    if (authSlotMobile) renderStudioAuthSlot(authSlotMobile, effectiveUser, { mobile: true, slotName: 'mobile' });

    if (!signedIn && saveStatus && !saveStatus.textContent.trim()) {
        saveStatus.textContent = t('login_prompt');
        saveStatus.style.color = '#8a5d00';
    }
    document.body.classList.toggle('auth-guest', !signedIn);
    document.querySelectorAll('[data-auth-required]').forEach((el) => {
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(el);
        const flowHorizonControl = isFlowHorizonDryRunControl(el);
        const flowPublicationBlocked = el.hasAttribute('data-flow-publication-required')
            && hasFlowGroups(state)
            && !flowPortableReady;
        el.disabled = !signedIn || flowPublicationBlocked;
        el.title = !signedIn
            ? t('login_required')
            : (flowPublicationBlocked
                ? (flowHorizonControl
                    ? getFlowHorizonDryRunControlTitle(el)
                    : 'FlowのローカルZIP検証完了後に有効になります')
                : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : ''));
    });
    document.querySelectorAll('[data-flow-publication-required]:not([data-auth-required])').forEach((el) => {
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(el);
        const blocked = hasFlowGroups(state) && !flowPortableReady;
        el.disabled = blocked;
        el.title = blocked
            ? 'FlowのローカルZIP検証完了後に有効になります'
            : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : '');
    });
    syncStudioShell();
}

function applyStudioAuthUser(user) {
    state.user = user || null;
    state.uid = user?.uid || null;
    updateAuthUI();
    if (document.body?.dataset?.room === 'press' && hasFlowGroups(state)) {
        void refreshFlowHorizonDryRunReadiness();
    }
}

let studioAuthGlobalBound = false;
let studioAccount = null;

function escapeStudioHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getStudioPlanDisplayName(account) {
    const tier = normalizePlanTier(account?.plan?.effectiveTier || account?.plan?.tier || 'free');
    const labels = {
        free: 'FREE',
        plus: 'PLUS',
        pro: 'PRO',
        business: 'BUSINESS',
    };
    return labels[tier] || tier.toUpperCase();
}

function getActiveLanguageWorkTitle() {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const localizedTitle = state.meta?.[lang]?.title;
    if (localizedTitle) return localizedTitle;
    return lang === (state.defaultLang || 'ja') ? (state.title || '') : '';
}

function closeAllStudioAuthDropdowns() {
    document.querySelectorAll('.studio-auth-slot [data-auth-dropdown].open').forEach((dropdown) => {
        dropdown.classList.remove('open');
    });
    document.querySelectorAll('.studio-auth-slot [data-auth-trigger][aria-expanded="true"]').forEach((trigger) => {
        trigger.setAttribute('aria-expanded', 'false');
    });
}

function bindStudioAuthGlobalHandlers() {
    if (studioAuthGlobalBound) return;
    studioAuthGlobalBound = true;
    document.addEventListener('click', (event) => {
        if (event.target.closest('.studio-auth-slot')) return;
        closeAllStudioAuthDropdowns();
    });
}

function getStudioThemeButtonsMarkup() {
    const currentThemeMode = getThemeMode();
    return `
        <div class="auth-panel-section">
            <div class="auth-panel-label">${escapeStudioHtml(t('themeLabel'))}</div>
            <div class="theme-mode-switcher js-theme-switcher" role="group" aria-label="${escapeStudioHtml(t('themeLabel'))}">
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${escapeStudioHtml(t('modeDevice'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${escapeStudioHtml(t('modeLight'))}</button>
                <button type="button" class="theme-mode-btn ${currentThemeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${escapeStudioHtml(t('modeDark'))}</button>
            </div>
        </div>
    `;
}

function getStudioAccountLinksMarkup(user) {
    return `
        <div class="auth-panel-links">
            ${user ? `<a href="/mypage.html" class="auth-panel-link"><span class="material-icons">manage_accounts</span><span>${escapeStudioHtml(t('myPage'))}</span></a>` : ''}
            <button type="button" class="auth-panel-link"><span class="material-icons">visibility_off</span><span>${escapeStudioHtml(t('restrictedMode'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">public</span><span>${escapeStudioHtml(t('location'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">settings</span><span>${escapeStudioHtml(t('settings'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">help_outline</span><span>${escapeStudioHtml(t('help'))}</span></button>
            <button type="button" class="auth-panel-link"><span class="material-icons">feedback</span><span>${escapeStudioHtml(t('feedback'))}</span></button>
        </div>
    `;
}

function getStudioAuthMarkup(user, { mobile = false, slotName = 'nav' } = {}) {
    const displayName = escapeStudioHtml(user?.displayName || user?.email || t('guest_label'));
    const planName = user ? escapeStudioHtml(getStudioPlanDisplayName(studioAccount)) : '';
    const photoUrl = escapeStudioHtml(user?.photoURL || '');
    const initials = escapeStudioHtml((user?.displayName || user?.email || 'U').trim().charAt(0).toUpperCase() || 'U');
    const avatarLabel = user ? displayName : escapeStudioHtml(t('btn_signin'));
    const avatarInner = photoUrl
        ? `<img src="${photoUrl}" alt="${displayName}" referrerpolicy="no-referrer">`
        : user
            ? `<span class="auth-initials">${initials}</span>`
            : `<span class="material-icons" aria-hidden="true">account_circle</span>`;
    const gisButtonId = `gis-btn-studio-${slotName}`;
    const fallbackClass = mobile ? 'mobile-auth-btn studio-signin-fallback' : 'btn-tool studio-signin-fallback';
    const signedOutSection = user ? '' : `
        <div class="auth-panel-section studio-auth-signin-section">
            <div id="${gisButtonId}" class="studio-gis-slot"></div>
            <button type="button" class="${fallbackClass}" data-auth-signin-fallback>${escapeStudioHtml(mobile ? t('btn_auth_mobile') : t('btn_signin'))}</button>
        </div>
    `;

    return `
        <div class="auth-user studio-auth-user ${mobile ? 'is-mobile' : 'is-desktop'}">
            <button type="button" class="auth-avatar-btn studio-auth-trigger" data-auth-trigger aria-label="${avatarLabel}" aria-expanded="false">
                ${avatarInner}
            </button>
            <div class="auth-dropdown auth-panel studio-auth-dropdown" data-auth-dropdown>
                <div class="auth-dropdown-name">
                    <span class="auth-dropdown-display-name">${displayName}</span>
                    ${user ? `<span class="auth-dropdown-plan">${planName}</span>` : ''}
                </div>
                ${getStudioThemeButtonsMarkup()}
                ${signedOutSection}
                ${getStudioAccountLinksMarkup(user)}
                ${user ? `<button type="button" class="btn-signout" data-auth-signout>${escapeStudioHtml(t('btn_signout'))}</button>` : ''}
            </div>
        </div>
    `;
}

function updateStudioThemeSwitchers() {
    const currentThemeMode = getThemeMode();
    document.querySelectorAll('.studio-auth-slot .js-theme-switcher .theme-mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.themeMode === currentThemeMode);
    });
}

async function hydrateStudioAccount(user) {
    if (!user?.uid) {
        studioAccount = null;
        updateAuthUI();
        return null;
    }
    try {
        const account = await ensureUserBootstrap(user);
        if (firebaseAuth.currentUser?.uid !== user.uid) return null;
        studioAccount = account || null;
        updateAuthUI();
        return account;
    } catch (e) {
        console.warn('[Auth] user bootstrap failed:', e);
        return null;
    }
}

function mountStudioGisButton(container, { mobile = false } = {}) {
    if (state.uid) return;
    const gisTarget = container.querySelector('.studio-gis-slot')?.id;
    if (!gisTarget) return;
    const device = getDeviceKey();
    const renderGisHere = mobile ? device === 'mobile' : device === 'desktop';
    if (!renderGisHere) return;
    renderGISButton(gisTarget, {
        authInstance: firebaseAuth,
        buttonOptions: {
            theme: 'outline',
            size: 'medium',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
        }
    }).catch((error) => console.warn(`[Auth] GIS ${mobile ? 'mobile' : 'desktop'} button render failed:`, error));
}

function bindStudioAuthSlot(container, user, { mobile = false } = {}) {
    const trigger = container.querySelector('[data-auth-trigger]');
    const dropdown = container.querySelector('[data-auth-dropdown]');
    trigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        const willOpen = !dropdown?.classList.contains('open');
        closeAllStudioAuthDropdowns();
        dropdown?.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
        if (willOpen && !user) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => mountStudioGisButton(container, { mobile }));
            });
        }
    });
    dropdown?.addEventListener('click', async (event) => {
        const themeBtn = event.target.closest('.theme-mode-btn');
        if (themeBtn?.dataset.themeMode) {
            setThemeMode(themeBtn.dataset.themeMode);
            updateStudioThemeSwitchers();
            return;
        }
        if (event.target.closest('[data-auth-signout]')) {
            try {
                await signOutUser(firebaseAuth);
            } catch (error) {
                console.error('[Auth] sign-out error:', error);
            }
            return;
        }
    });
    container.querySelector('[data-auth-signin-fallback]')?.addEventListener('click', async () => {
        try {
            const result = await signInWithGoogle({ authInstance: firebaseAuth });
            if (result?.user) {
                applyStudioAuthUser(result.user);
                closeAllStudioAuthDropdowns();
            }
        } catch (error) {
            console.error('[Auth] Google sign-in error:', error);
            alert(t('auth_google_failed', { message: error?.message || String(error) }));
        }
    });
}

function renderStudioAuthSlot(container, user, options = {}) {
    if (!container) return;
    bindStudioAuthGlobalHandlers();
    container.innerHTML = getStudioAuthMarkup(user, options);
    bindStudioAuthSlot(container, user, options);
}

// ── Studio shell — data-room・デバイス・サムネ列・リボン（editor 以外も共通） ─────────

const THUMB_COLUMN_OPTIONS = [8, 5, 4, 2, 1];
const MOBILE_THUMB_SIZE_MAP = { s: 4, m: 2, l: 1 };
const MOBILE_THUMB_SIZE_BY_COLS = { 4: 's', 2: 'm', 1: 'l' };

function getDeviceKey() {
    return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}

function getCurrentRoom() {
    return document.body.dataset.room || 'editor';
}

function getRoomLabel(room) {
    const keyMap = {
        home: 'nav_dashboard',
        editor: 'nav_editor',
        press: 'nav_press',
        works: 'nav_works'
    };
    return t(keyMap[room] || 'mobile_title');
}

function getMobileHeaderTitle(room) {
    if (room === 'editor') {
        return state.projectName || state.title || t('project_title_default');
    }
    return getRoomLabel(room);
}

function getMobileHeaderNavTarget(room) {
    if (room === 'editor') return 'home';
    if (room === 'press') return 'editor';
    if (room === 'works') return 'home';
    return null;
}

function syncMobileHeader() {
    const room = getCurrentRoom();
    const navBtn = document.getElementById('mobile-header-nav');
    const roomLabel = document.getElementById('mobile-header-room-label');
    const title = document.getElementById('mobile-header-title');
    const navTarget = getMobileHeaderNavTarget(room);
    const roomText = getRoomLabel(room);

    if (roomLabel) {
        roomLabel.textContent = room === 'editor' ? roomText : t('mobile_title');
    }
    if (title) {
        title.textContent = getMobileHeaderTitle(room);
        title.title = title.textContent;
    }
    if (navBtn) {
        navBtn.hidden = !navTarget;
        navBtn.dataset.targetRoom = navTarget || '';
        const backLabel = navTarget ? getRoomLabel(navTarget) : '';
        navBtn.title = backLabel;
        navBtn.setAttribute('aria-label', backLabel || roomText);
        const icon = navBtn.querySelector('.material-icons');
        if (icon) {
            icon.textContent = 'arrow_back';
        }
    }
}

function syncMobileCanvasZoomBar() {
    const zoomBar = document.getElementById('mobile-canvas-zoom-bar');
    if (!zoomBar) return;
    const flowSourceActive = document.getElementById('canvas-view')?.classList.contains('flow-authoring-active');
    const visible = getDeviceKey() === 'mobile' && getCurrentRoom() === 'editor' && !flowSourceActive;
    zoomBar.hidden = !visible;
    document.body.classList.toggle('mobile-canvas-zoom-visible', visible);
    if (visible) syncCanvasZoomUI();
}

function syncStudioShell() {
    const device = getDeviceKey();
    const room = getCurrentRoom();

    document.body.dataset.device = device;
    document.body.classList.toggle('mobile-shell', device === 'mobile');
    document.body.classList.toggle('mobile-editor-shell', device === 'mobile' && room === 'editor');

    if ((device !== 'mobile' || room !== 'editor') && typeof window.closeMobileSheet === 'function') {
        window.closeMobileSheet();
    }

    syncMobileHeader();
    syncMobileCanvasZoomBar();
    syncMobileMenuSheet();
    renderMobileBottomBar();
}

function getValidStudioRoom(room) {
    return ['home', 'editor', 'press', 'works'].includes(room) ? room : 'home';
}

function normalizeStudioRouteUrl() {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith('/studio.html')) {
        url.pathname = url.pathname.replace(/\/studio\.html$/, '/studio');
        window.history.replaceState(window.history.state, '', url);
    }
}

function syncStudioRoomUrl(room) {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith('/studio.html')) {
        url.pathname = url.pathname.replace(/\/studio\.html$/, '/studio');
    }
    if (!url.pathname.endsWith('/studio')) return;
    url.searchParams.set('room', getValidStudioRoom(room));
    window.history.replaceState(window.history.state, '', url);
}

function sanitizeThumbColumns(value) {
    const n = Number(value);
    if (THUMB_COLUMN_OPTIONS.includes(n)) return n;
    return 2;
}

function getMobileThumbSizeKey(value = state.thumbColumns) {
    const n = sanitizeThumbColumns(value);
    return MOBILE_THUMB_SIZE_BY_COLS[n] || 'm';
}

function ensureUiPrefs() {
    if (!state.uiPrefs || typeof state.uiPrefs !== 'object') {
        state.uiPrefs = {};
    }
    if (!state.uiPrefs.desktop || typeof state.uiPrefs.desktop !== 'object') {
        state.uiPrefs.desktop = {};
    }
    if (!state.uiPrefs.mobile || typeof state.uiPrefs.mobile !== 'object') {
        state.uiPrefs.mobile = {};
    }
    state.uiPrefs.desktop.thumbColumns = sanitizeThumbColumns(state.uiPrefs.desktop.thumbColumns);
    state.uiPrefs.mobile.thumbColumns = sanitizeThumbColumns(state.uiPrefs.mobile.thumbColumns);
}

function applyThumbColumnsFromPrefs() {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: state.uiPrefs[key].thumbColumns, device: key } });
}

function syncThumbColumnButtons() {
    const active = sanitizeThumbColumns(state.thumbColumns);
    document.querySelectorAll('[data-thumb-cols]').forEach((btn) => {
        const isActive = Number(btn.dataset.thumbCols) === active;
        btn.classList.toggle('active', isActive);
    });
    const activeSize = getMobileThumbSizeKey(active);
    document.querySelectorAll('[data-thumb-size]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.thumbSize === activeSize);
    });
}

function setCurrentDeviceThumbColumns(cols) {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: cols, device: key } });
}



// ──────────────────────────────────────
//  refresh — 画面全体を再描画する (Gen3: image pages only)
// ──────────────────────────────────────
function refresh(options = {}) {
    const skipAncillary = !!options.skipAncillary;
    const skipThumbs = !!options.skipThumbs;
    const visSelect = document.getElementById('prop-visibility');
    if (visSelect && document.activeElement !== visSelect) {
        visSelect.value = state.visibility || 'private';
    }

    syncBlocksFromState();
    const activeBlock = getActiveBlock();
    const flowPreviewTargetBlock = getFlowPreviewTargetBlock(activeBlock);
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);
    const isFlowReadOnly = activeBlock?.kind === 'flow'
        || (!s && state.version === 6 && (state.blocks || []).some((block) => block?.kind === 'flow'));
    const isFlowAuthoring = activeBlock?.kind === 'flow' && isFlowSourceSelected(activeBlock.id);
    setFlowAuthoringSurfaceVisible(isFlowAuthoring);
    render.classList.toggle('flow-editor-preview-active', isFlowReadOnly && !isFlowAuthoring);
    const flowAuthoringProps = document.getElementById('flow-authoring-props');
    if (flowAuthoringProps) flowAuthoringProps.hidden = !isFlowAuthoring;
    const flowAuthoringLanguage = document.getElementById('flow-authoring-language');
    if (flowAuthoringLanguage && isFlowAuthoring) {
        flowAuthoringLanguage.textContent = getFlowAuthoringLanguage(activeBlock).toUpperCase();
    }

    // Normalize stale bubble selection
    if (state.activeBubbleIdx !== null && (!s?.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    }

    // メインキャンバスの描画 — image pages only
    if (isFlowAuthoring) {
        renderFlowAuthoringSurface(activeBlock, getEditorPageProjection());
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            const sourceLanguage = activeBlock.flow?.document?.sourceLanguage || 'ja';
            const authoringLanguage = getFlowAuthoringLanguage(activeBlock);
            pageLockNote.textContent = authoringLanguage === sourceLanguage
                ? `Flow原稿を編集中（原稿言語 ${sourceLanguage.toUpperCase()}）`
                : `Flow翻訳を編集中（${authoringLanguage.toUpperCase()} / 構造は ${sourceLanguage.toUpperCase()} と共通）`;
            pageLockNote.style.display = 'block';
        }
        requestEditorFlowProjection(activeBlock);
        _hideTextPreviewOverlay();
        const imageProps = document.getElementById('image-only-props');
        if (imageProps) imageProps.style.display = 'none';
        const bubbleLayer = document.getElementById('bubble-layer');
        if (bubbleLayer) {
            bubbleLayer.innerHTML = '';
            bubbleLayer.style.display = 'none';
        }
        const bubbleShapeProps = document.getElementById('bubble-shape-props');
        if (bubbleShapeProps) bubbleShapeProps.style.display = 'none';
    } else if (isFlowReadOnly) {
        render.innerHTML = `
            <div id="flow-readonly-placeholder">
                <span class="material-icons">article</span>
                <strong>Flowテキスト</strong>
                <span data-flow-progress>ページ生成中…</span>
                <span>生成ページの確認画面です。編集するには親の「Flow原稿」を選択してください。</span>
            </div>`;
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = 'Flow原稿のページを生成中…（読取専用）';
            pageLockNote.style.display = 'block';
        }
        requestEditorFlowProjection(flowPreviewTargetBlock);
        _hideTextPreviewOverlay();
        const imageProps = document.getElementById('image-only-props');
        if (imageProps) imageProps.style.display = 'none';
        const bubbleLayer = document.getElementById('bubble-layer');
        if (bubbleLayer) {
            bubbleLayer.innerHTML = '';
            bubbleLayer.style.display = 'none';
        }
        const bubbleShapeProps = document.getElementById('bubble-shape-props');
        if (bubbleShapeProps) bubbleShapeProps.style.display = 'none';
    } else if (s && s.type === 'image') {
        const pos = getActiveImagePosition();
        if (!s.imageBasePosition) {
            s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        }
        const bgUrl = getOptimizedImageUrl(s.backgrounds?.[state.activeLang] || s.backgrounds?.[state.defaultLang] || s.background || '');
        _hideTextPreviewOverlay();

        if (!bgUrl) {
            // 画像未設定 → アップロード誘導プレースホルダーを表示
            render.innerHTML = `<div id="image-upload-placeholder" onclick="document.getElementById('file-upload').click()">
                <span class="material-icons">add_photo_alternate</span>
                <span class="placeholder-main" data-i18n="placeholder_drop_image">画像をドロップ</span>
                <span class="placeholder-sub" data-i18n="placeholder_or_click">またはクリックして選択</span>
            </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'none';
        } else {
            const { frameMetrics, targetTransform, invScale } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(s, state.activeIdx));
            const targetStyle = [
                `width:${frameMetrics.widthPercent}%`,
                `height:${frameMetrics.heightPercent}%`,
                `transform:${targetTransform};`
            ].join('; ');
            const stageOverlay = isImageAdjusting ? `
                <div id="image-stage-overlay">
                    <div class="image-safe-frame${imageSnapState.edgeLeft ? ' active-left' : ''}${imageSnapState.edgeRight ? ' active-right' : ''}${imageSnapState.edgeTop ? ' active-top' : ''}${imageSnapState.edgeBottom ? ' active-bottom' : ''}"></div>
                    <div class="image-center-guide vertical${imageSnapState.centerX ? ' active' : ''}"></div>
                    <div class="image-center-guide horizontal${imageSnapState.centerY ? ' active' : ''}"></div>
                </div>
            ` : '';

            const overlayInTarget = isImageAdjusting ? `
                <div id="image-adjust-overlay" style="--inv-handle-scale:${invScale};">
                    <div class="adjust-frame"></div>
                    <button class="img-handle corner nw" onmousedown="startImageHandleDrag(event, 'nw')" ontouchstart="startImageHandleDrag(event, 'nw')" title="左上ハンドル"></button>
                    <button class="img-handle corner ne" onmousedown="startImageHandleDrag(event, 'ne')" ontouchstart="startImageHandleDrag(event, 'ne')" title="右上ハンドル"></button>
                    <button class="img-handle corner sw" onmousedown="startImageHandleDrag(event, 'sw')" ontouchstart="startImageHandleDrag(event, 'sw')" title="左下ハンドル"></button>
                    <button class="img-handle corner se" onmousedown="startImageHandleDrag(event, 'se')" ontouchstart="startImageHandleDrag(event, 'se')" title="右下ハンドル"></button>
                    <button class="img-handle rotate" onmousedown="startImageHandleDrag(event, 'rotate')" ontouchstart="startImageHandleDrag(event, 'rotate')" title="回転ハンドル">⟳</button>
                </div>
            ` : '';

            render.innerHTML = `
                <div id="image-adjust-stage">
                    ${stageOverlay}
                    <div id="image-adjust-target" style="${targetStyle}">
                        <img id="main-img" src="${bgUrl}" onload="handleEditorImageLoad(event)">
                        ${overlayInTarget}
                    </div>
                </div>`;
            document.getElementById('image-only-props').style.display = 'block';
            document.getElementById('bubble-layer').style.display = 'block';
        }
    } else if (s && s.type === 'text') {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        renderTextPreview(s);
    } else if (s) {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
        _hideTextPreviewOverlay();
    }

    // 吹き出し描画
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (s && s.type === 'image' && !isDirectEditing) {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, langProps.defaultWritingMode || 'horizontal-tb')
        ).join('');
    }

    // パネルUIの同期
    const propType = document.getElementById('prop-type');
    if (propType) {
        propType.disabled = isFlowReadOnly;
        if (!isFlowReadOnly) propType.value = s?.type || 'image';
    }
    const deleteBtn = document.getElementById('btn-delete-active');
    if (deleteBtn) {
        const canDeleteFlowSource = isFlowAuthoring;
        const deleteLabelKey = canDeleteFlowSource ? 'btn_delete_flow' : 'btn_delete';
        deleteBtn.disabled = isFlowReadOnly && !canDeleteFlowSource;
        deleteBtn.dataset.i18n = deleteLabelKey;
        deleteBtn.textContent = t(deleteLabelKey);
        deleteBtn.title = canDeleteFlowSource
            ? t('flow_delete_source_title')
            : isFlowReadOnly
                ? t('flow_delete_generated_title')
                : '';
    }
    if (!isFlowReadOnly) {
        const pageLockNote = document.getElementById('page-lock-note');
        if (pageLockNote) {
            pageLockNote.textContent = '';
            pageLockNote.style.display = 'none';
        }
    }
    const editableFixedSection = getEditableActiveFixedSection();
    const fixedPageEditingDisabled = !editableFixedSection;
    if (fixedPageEditingDisabled && isImageAdjusting) {
        exitImageAdjustmentModeUi();
    }
    document.querySelectorAll('[data-fixed-page-edit]').forEach((control) => {
        if (control.dataset.defaultTitle === undefined) {
            control.dataset.defaultTitle = control.title || '';
        }
        control.disabled = fixedPageEditingDisabled;
        control.title = fixedPageEditingDisabled ? 'ページ原稿または生成ページは読取専用です' : control.dataset.defaultTitle;
    });
    const activeBubbleLayer = document.getElementById('bubble-layer');
    if (activeBubbleLayer) {
        if (fixedPageEditingDisabled) activeBubbleLayer.style.pointerEvents = 'none';
        else if (!isImageAdjusting) activeBubbleLayer.style.pointerEvents = '';
    }
    document.querySelectorAll('[data-flow-publication-required]').forEach((control) => {
        const needsAuth = control.hasAttribute('data-auth-required');
        const flowPortableReady = isVerifiedFlowPortableDownloadControl(control);
        const flowHorizonControl = isFlowHorizonDryRunControl(control);
        const blocked = hasFlowGroups(state) && !flowPortableReady;
        control.disabled = blocked || (needsAuth && !state.uid);
        control.title = needsAuth && !state.uid
            ? t('login_required')
            : (blocked
                ? (flowHorizonControl
                    ? getFlowHorizonDryRunControlTitle(control)
                    : 'FlowのローカルZIP検証完了後に有効になります')
                : (flowPortableReady ? '検証済みFlow portable .dsfをローカルへ保存します' : ''));
    });

    const isTextSection = editableFixedSection?.type === 'text';
    const isPageSection = editableFixedSection?.type === 'image' || editableFixedSection?.type === 'text';
    if (!isFlowReadOnly && hasFlowGroups(state) && !getEditorPageProjection()) {
        if (flowPreviewTargetBlock) requestEditorFlowProjection(flowPreviewTargetBlock);
    }

    // FAB「テキスト追加」ボタンをテキストページでは非表示
    const fabAddBubble = document.getElementById('fab-add-bubble');
    if (fabAddBubble) fabAddBubble.style.display = (isTextSection || isFlowReadOnly) ? 'none' : '';

    // テキストページではキャンバスのクリックカーソルをデフォルトに戻す
    const canvasView = document.getElementById('canvas-view');
    if (canvasView) canvasView.style.cursor = (isTextSection || isFlowReadOnly) ? 'default' : '';

    // テキストセクション専用パネル
    const textSectionProps = document.getElementById('text-section-props');
    if (textSectionProps) {
        textSectionProps.style.display = isTextSection ? 'block' : 'none';
        if (isTextSection) {
            _syncTextSectionPanel(s);
        }
    }

    const pageHeadingProps = document.getElementById('canvas-page-heading-props');
    if (pageHeadingProps) pageHeadingProps.style.display = isPageSection ? 'flex' : 'none';
    if (isPageSection) {
        syncPageHeadingField(s);
    }
    renderEditorTocPreview();

    const hasSelectedBubble = !isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx];

    // 吹き出しテキストエディター（バブル選択時のみ表示）
    const genericTextEditor = document.getElementById('generic-text-editor');
    if (genericTextEditor) genericTextEditor.style.display = hasSelectedBubble ? 'block' : 'none';

    // テキストエリア: バブル選択時のテキスト表示
    const propTextEl = document.getElementById('prop-text');
    if (propTextEl) {
        if (hasSelectedBubble) {
            propTextEl.value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
        } else if (!isTextSection) {
            propTextEl.value = '';
        }
        propTextEl.style.display = hasSelectedBubble ? 'block' : 'none';
        propTextEl.readOnly = false;
    }

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) {
        textLabel.textContent = `テキスト入力 [${langProps.label}]`;
    }

    // 吹き出し形状＆カラーセレクタの同期（テキストセクションでは非表示）
    const shapeProps = document.getElementById('bubble-shape-props');
    if (!isTextSection && state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
        if (shapeProps) shapeProps.style.display = 'block';
        updateBubblePropPanel(s.bubbles[state.activeBubbleIdx]);
    } else {
        if (shapeProps) shapeProps.style.display = 'none';
        updateBubblePropPanel(null);
    }

    // プロジェクト名表示
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = getProjectDisplayName();
    }

    // 作品タイトル同期
    const propTitle = document.getElementById('prop-title');
    if (propTitle && document.activeElement !== propTitle) {
        propTitle.value = getActiveLanguageWorkTitle();
    }
    // 生成Flowページを含むruntime projectionとFixed互換ページを同じ番号体系で表示する。
    syncEditorPageCounters();
    syncPageNavigationSlider();

    // モバイル見開きボタンのアクティブ状態
    const mobileSpreadBtn = document.getElementById('btn-spread-view-mobile');
    if (mobileSpreadBtn) {
        mobileSpreadBtn.classList.toggle('active', !!(state.uiPrefs?.spreadView) && !hasFlowGroups(state));
        mobileSpreadBtn.disabled = hasFlowGroups(state);
    }

    // 見開きページを更新
    refreshSpreadPage();

    // 言語タブの更新
    if (!skipAncillary) {
        renderLangTabs();
        syncLangPanel();
        renderLangSettings();
        updateHistoryButtons();
    }
    if (!skipThumbs) {
        renderThumbs();
    }
    if (!skipAncillary) {
        syncThumbColumnButtons();
        syncStudioShell();
    }
}

function captureViewportSnapshot() {
    const sidebarPages = document.querySelector('.sidebar-pages');
    const editorMain = document.getElementById('editor-main');
    return {
        windowX: window.scrollX,
        windowY: window.scrollY,
        sidebarPagesScrollTop: sidebarPages?.scrollTop ?? 0,
        editorMainScrollTop: editorMain?.scrollTop ?? 0
    };
}

function restoreViewportSnapshot(snapshot) {
    if (!snapshot) return;
    requestAnimationFrame(() => {
        window.scrollTo(snapshot.windowX, snapshot.windowY);
        const sidebarPages = document.querySelector('.sidebar-pages');
        if (sidebarPages) sidebarPages.scrollTop = snapshot.sidebarPagesScrollTop;
        const editorMain = document.getElementById('editor-main');
        if (editorMain) editorMain.scrollTop = snapshot.editorMainScrollTop;
    });
}

function refreshForThumbSelection() {
    const snapshot = captureViewportSnapshot();
    refresh({ skipAncillary: true, skipThumbs: true });
    syncThumbSelectionDom();
    restoreViewportSnapshot(snapshot);
}

function syncThumbSelectionDom() {
    document.querySelectorAll('.thumb-wrap, .thumb-row').forEach((el) => {
        const blockIndex = Number(el.dataset.blockIndex);
        const flowPageIndex = el.dataset.flowPageIndex === undefined
            ? null
            : Number(el.dataset.flowPageIndex);
        const activeBlock = getActiveBlock();
        const isFlowPage = Number.isInteger(flowPageIndex);
        const isActive = Number.isInteger(blockIndex)
            && blockIndex === state.activeBlockIdx
            && (
                isFlowPage
                    ? activeBlock?.kind === 'flow'
                        && !isFlowSourceSelected(activeBlock.id)
                        && flowPageIndex === getSelectedFlowRuntimePageIndex(activeBlock.id)
                    : activeBlock?.kind === 'flow'
                        ? isFlowSourceSelected(activeBlock.id)
                        : true
            );
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
}

// ──────────────────────────────────────
//  言語UI
// ──────────────────────────────────────
function getEditorLangDirection(code) {
    const props = getLangProps(code);
    const fallback = props.directions?.[0]?.value || 'ltr';
    return state.languageConfigs?.[code]?.pageDirection || fallback;
}

function getEditorLangDirectionArrow(code) {
    return getEditorLangDirection(code) === 'rtl' ? '&lt;&lt;' : '&gt;&gt;';
}

function renderEditorLangTabContent(code) {
    const props = getLangProps(code);
    const codeLabel = String(code || '').toUpperCase();
    return `
        ${renderStudioLanguageBadge(code, 'lang-tab-badge')}
        <span class="lang-tab-label">${escapeStudioHtml(props.label)}</span>
        <span class="lang-tab-code">${escapeStudioHtml(codeLabel)}</span>
        <span class="lang-tab-dir">${getEditorLangDirectionArrow(code)}</span>
    `;
}

function renderLangTabs() {
    const html = state.languages.map(code => {
        const active = code === state.activeLang ? 'active' : '';
        const label = `${getLangProps(code).label} ${String(code).toUpperCase()} ${getEditorLangDirection(code) === 'rtl' ? '<<' : '>>'}`;
        return `<button class="lang-tab ${active}" onclick="switchLang('${code}')" title="${escapeStudioHtml(label)}">${renderEditorLangTabContent(code)}</button>`;
    }).join('');
    ['lang-tabs', 'lang-tabs-mobile', 'lang-tabs-top', 'lang-tabs-pages-panel'].forEach((id) => {
        const container = document.getElementById(id);
        if (container) container.innerHTML = html;
    });
}

function renderLangSettings() {
    const list = document.getElementById('lang-list');
    if (!list) return;
    const draft = _getPsSettingsSource();
    const languages = draft.languages || ['ja'];
    const configs = draft.languageConfigs || {};
    list.innerHTML = languages.map(code => {
        const props = getLangProps(code);
        const canRemove = languages.length > 1;
        const removeBtn = canRemove
            ? `<button class="btn-sm lang-item-remove" onclick="removeLang('${code}')">✕</button>`
            : '';

        // 複数方向対応の言語にはインラインセレクトを表示
        let dirSelect = '';
        if (props.directions && props.directions.length > 1) {
            const currentDir = configs?.[code]?.pageDirection || props.directions[0].value;
            const options = props.directions.map(d => {
                const sel = d.value === currentDir ? ' selected' : '';
                return `<option value="${d.value}"${sel}>${d.label}</option>`;
            }).join('');
            dirSelect = `<select class="lang-dir-select" onchange="changeLangDirection('${code}', this.value)">${options}</select>`;
        }

        return `<div class="lang-item"><span class="lang-item-label">${props.label}</span>${dirSelect}${removeBtn}</div>`;
    }).join('');
}

window.changeLangDirection = (code, dir) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (!draft.languageConfigs) draft.languageConfigs = {};
    if (!draft.languageConfigs[code]) draft.languageConfigs[code] = {};
    draft.languageConfigs[code].pageDirection = dir;
    renderLangSettings();
    renderProjectSettingsTable();
};

// ──────────────────────────────────────
//  Undo/Redoボタンの有効/無効を更新
// ──────────────────────────────────────
function updateHistoryButtons() {
    const info = getHistoryInfo();
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !info.canUndo;
    if (redoBtn) redoBtn.disabled = !info.canRedo;
}

let thumbDragSourceIdx = null;
let thumbTouchState = null;
let suppressThumbClickUntil = 0;

function clearThumbDropHints() {
    document.querySelectorAll('.thumb-wrap').forEach((el) => {
        el.classList.remove(
            'drop-before',
            'drop-after',
            'drag-source',
            'preview-gap-left',
            'preview-gap-right',
            'preview-gap-left-edge',
            'preview-gap-right-edge'
        );
    });
    document.getElementById('thumb-drop-indicator')?.remove();
    document.getElementById('thumb-drop-preview')?.remove();
}

function getThumbElement(index) {
    return document.querySelector(`.thumb-wrap[data-section-index="${index}"]`);
}

function getSpreadGroupIdByIndex(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx)) return '';
    return state.sections?.[idx]?.spreadImage?.groupId || '';
}

function getSpreadPairIndices(index) {
    const idx = Number(index);
    if (!Number.isInteger(idx)) return [];
    const groupId = getSpreadGroupIdByIndex(idx);
    if (!groupId) return [idx];
    const pair = (state.sections || [])
        .map((section, pageIdx) => section?.spreadImage?.groupId === groupId ? pageIdx : -1)
        .filter((pageIdx) => pageIdx >= 0)
        .sort((a, b) => a - b);
    return pair.length ? pair : [idx];
}

function getSpreadPairStart(index) {
    const pair = getSpreadPairIndices(index);
    return pair[0] ?? Number(index);
}

function getSpreadPairEnd(index) {
    const pair = getSpreadPairIndices(index);
    return pair[pair.length - 1] ?? Number(index);
}

function addThumbClassToSpreadPair(index, className) {
    getSpreadPairIndices(index).forEach((pageIdx) => {
        getThumbElement(pageIdx)?.classList.add(className);
    });
}

function setThumbDeleteDropzoneActive(active) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone) return;
    zone.classList.toggle('is-active', !!active);
}

function clearThumbDeleteDropzone() {
    document.body.classList.remove('thumb-delete-mode');
    setThumbDeleteDropzoneActive(false);
}

function isPointInThumbDeleteDropzone(clientX, clientY) {
    const zone = document.getElementById('thumb-delete-dropzone');
    if (!zone || zone.offsetParent === null) return false;
    const rect = zone.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function getThumbTargetFromPoint(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const direct = hit ? hit.closest('.thumb-wrap') : null;
    if (direct) return direct;
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const thumbs = [...container.querySelectorAll('.thumb-wrap[data-section-index]')];
    if (!thumbs.length) return null;
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    thumbs.forEach((thumb) => {
        const rect = thumb.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - centerX, clientY - centerY);
        if (dist < nearestDistance) {
            nearest = thumb;
            nearestDistance = dist;
        }
    });
    return nearest;
}

function getThumbVisualThumbs() {
    const container = document.getElementById('thumb-container');
    if (!container) return [];
    return [...container.querySelectorAll('.thumb-wrap[data-section-index]')].sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return rectA.left - rectB.left;
    });
}

function getMobileThumbInsertTarget(clientX) {
    const container = document.getElementById('thumb-container');
    if (!container) return null;
    const sourceIndex = Number(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    const sourceEl = getThumbElement(sourceIndex);
    if (!sourceEl) return null;
    const sourceRect = sourceEl.getBoundingClientRect();
    const sourcePair = new Set(getSpreadPairIndices(sourceIndex));
    const visualThumbs = getThumbVisualThumbs().filter((thumb) => !sourcePair.has(Number(thumb.dataset.sectionIndex)));
    const dir = container.dataset.dir === 'rtl' ? 'rtl' : 'ltr';
    if (!visualThumbs.length) {
        const containerRect = container.getBoundingClientRect();
        return {
            insertIndex: 0,
            boundary: containerRect.left + sourceRect.width / 2,
            top: sourceRect.top,
            height: sourceRect.height,
            sourceRect,
            leftEl: null,
            rightEl: null
        };
    }
    const rects = visualThumbs.map((thumb) => ({
        el: thumb,
        index: Number(thumb.dataset.sectionIndex),
        rect: thumb.getBoundingClientRect()
    }));
    const first = rects[0];
    const last = rects[rects.length - 1];
    if (clientX <= first.rect.left + first.rect.width / 2) {
        return {
            insertIndex: dir === 'rtl' ? first.index + 1 : first.index,
            boundary: first.rect.left,
            top: first.rect.top,
            height: first.rect.height,
            sourceRect,
            leftEl: null,
            rightEl: first.el
        };
    }
    for (let i = 0; i < rects.length - 1; i += 1) {
        const left = rects[i];
        const right = rects[i + 1];
        const midpoint = (left.rect.right + right.rect.left) / 2;
        if (clientX <= midpoint) {
            return {
                insertIndex: dir === 'rtl' ? left.index : right.index,
                boundary: (left.rect.right + right.rect.left) / 2,
                top: Math.min(left.rect.top, right.rect.top),
                height: Math.max(left.rect.height, right.rect.height),
                sourceRect,
                leftEl: left.el,
                rightEl: right.el
            };
        }
    }
    return {
        insertIndex: dir === 'rtl' ? last.index : last.index + 1,
        boundary: last.rect.right,
        top: last.rect.top,
        height: last.rect.height,
        sourceRect,
        leftEl: last.el,
        rightEl: null
    };
}

function showMobileThumbInsertPreview(target) {
    const container = document.getElementById('thumb-container');
    const sourceEl = getThumbElement(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx);
    if (!container || !sourceEl || !target) return;
    clearThumbDropHints();
    addThumbClassToSpreadPair(thumbTouchState?.sourceIndex ?? thumbDragSourceIdx, 'drag-source');

    const containerRect = container.getBoundingClientRect();
    const leftPx = target.boundary - containerRect.left + container.scrollLeft;
    const topPx = target.top - containerRect.top + container.scrollTop;

    if (target.leftEl && target.rightEl) {
        target.leftEl.classList.add('preview-gap-right');
        target.rightEl.classList.add('preview-gap-left');
    } else if (target.leftEl) {
        target.leftEl.classList.add('preview-gap-right-edge');
    } else if (target.rightEl) {
        target.rightEl.classList.add('preview-gap-left-edge');
    }

    const indicator = document.createElement('div');
    indicator.id = 'thumb-drop-indicator';
    indicator.style.left = `${leftPx - 2}px`;
    indicator.style.top = `${topPx + 6}px`;
    indicator.style.height = `${Math.max(40, target.height - 12)}px`;
    container.appendChild(indicator);

    const preview = sourceEl.cloneNode(true);
    preview.id = 'thumb-drop-preview';
    preview.removeAttribute('onclick');
    preview.removeAttribute('ontouchstart');
    preview.removeAttribute('draggable');
    preview.style.width = `${target.sourceRect.width}px`;
    preview.style.minWidth = `${target.sourceRect.width}px`;
    preview.style.left = `${leftPx - target.sourceRect.width / 2}px`;
    preview.style.top = `${topPx}px`;
    container.appendChild(preview);
}

function markThumbDropHint(index, position) {
    clearThumbDropHints();
    addThumbClassToSpreadPair(thumbDragSourceIdx, 'drag-source');
    const targetIndex = position === 'before' ? getSpreadPairStart(index) : getSpreadPairEnd(index);
    const el = getThumbElement(targetIndex);
    if (!el) return;
    el.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function getDropPositionByPoint(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (window.innerWidth < 1024) {
        const isRtl = window.getComputedStyle(el.parentElement).flexDirection === 'row-reverse';
        const before = clientX < (rect.left + rect.width / 2);
        if (isRtl) return before ? 'after' : 'before';
        return before ? 'before' : 'after';
    }
    return clientY < (rect.top + rect.height / 2) ? 'before' : 'after';
}

function moveSectionWithHistory(fromIndex, targetIndex, position) {
    const insertIndex = position === 'before' ? getSpreadPairStart(targetIndex) : getSpreadPairEnd(targetIndex) + 1;
    return moveSectionToInsertIndexWithHistory(fromIndex, insertIndex);
}

function moveSectionToInsertIndexWithHistory(fromIndex, insertIndex) {
    const from = Number(fromIndex);
    const pair = getSpreadPairIndices(from);
    if (pair.length > 1) {
        const fromStart = pair[0];
        const count = pair.length;
        let to = Math.max(0, Math.min(Number(insertIndex), state.sections.length));
        if (!Number.isInteger(fromStart) || !Number.isInteger(to)) return false;
        if (to > fromStart && to < fromStart + count) return false;
        if (to === fromStart || to === fromStart + count) return false;
        const simulated = [...(state.sections || [])];
        const moved = simulated.splice(fromStart, count);
        const simulatedTo = to > fromStart ? to - count : to;
        simulated.splice(simulatedTo, 0, ...moved);
        if (!validateSpreadImageCompositionForSections(simulated)) return false;
        pushState();
        moveSectionRange(fromStart, count, to, refresh);
        triggerAutoSave();
        return true;
    }
    let to = Math.max(0, Math.min(insertIndex, state.sections.length));
    if (to === from || to === from + 1) return false;
    const simulated = [...(state.sections || [])];
    const [moved] = simulated.splice(from, 1);
    const simulatedTo = to > from ? to - 1 : to;
    simulated.splice(simulatedTo, 0, moved);
    if (!validateSpreadImageCompositionForSections(simulated)) return false;
    pushState();
    moveSection(from, to, refresh);
    triggerAutoSave();
    return true;
}

function deleteSectionWithHistory(sectionIndex) {
    const idx = Number(sectionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sections.length) return false;
    if (state.sections.length <= 1) return false;
    pushState();
    deleteSectionAt(idx, refreshForThumbSelection);
    triggerAutoSave();
    return true;
}

function bindTouchDragListeners() {
    document.addEventListener('touchmove', onThumbTouchMove, { passive: false });
    document.addEventListener('touchend', onThumbTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onThumbTouchCancel, { passive: false });
}

function unbindTouchDragListeners() {
    document.removeEventListener('touchmove', onThumbTouchMove);
    document.removeEventListener('touchend', onThumbTouchEnd);
    document.removeEventListener('touchcancel', onThumbTouchCancel);
}

function onThumbTouchMove(e) {
    if (!thumbTouchState) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    thumbTouchState.lastX = touch.clientX;
    thumbTouchState.lastY = touch.clientY;

    const dx = touch.clientX - thumbTouchState.startX;
    const dy = touch.clientY - thumbTouchState.startY;

    if (!thumbTouchState.active) {
        if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) + 6) {
            thumbTouchState = null;
            unbindTouchDragListeners();
            clearThumbDropHints();
            clearThumbDeleteDropzone();
            thumbDragSourceIdx = null;
            return;
        }
        if (dy <= -12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'move';
            addThumbClassToSpreadPair(thumbTouchState.sourceIndex, 'drag-source');
        } else if (dy >= 12 && Math.abs(dy) > Math.abs(dx) + 4) {
            thumbTouchState.active = true;
            thumbTouchState.mode = 'delete';
            document.body.classList.add('thumb-delete-mode');
            setThumbDeleteDropzoneActive(false);
            addThumbClassToSpreadPair(thumbTouchState.sourceIndex, 'drag-source');
        } else {
            return;
        }
    }

    e.preventDefault();
    if (thumbTouchState.mode === 'delete') {
        clearThumbDropHints();
        setThumbDeleteDropzoneActive(isPointInThumbDeleteDropzone(touch.clientX, touch.clientY));
        return;
    }

    if (window.innerWidth < 1024) {
        const target = getMobileThumbInsertTarget(touch.clientX);
        if (target) {
            thumbTouchState.insertIndex = target.insertIndex;
            showMobileThumbInsertPreview(target);
        }
    } else {
        const wrap = getThumbTargetFromPoint(touch.clientX, touch.clientY);
        if (!wrap) return;
        const targetIndex = Number(wrap.dataset.sectionIndex);
        if (!Number.isInteger(targetIndex)) return;
        const position = getDropPositionByPoint(wrap, touch.clientX, touch.clientY);
        thumbTouchState.targetIndex = targetIndex;
        thumbTouchState.position = position;
        markThumbDropHint(targetIndex, position);
    }

    const container = document.getElementById('thumb-container');
    if (container) {
        const cRect = container.getBoundingClientRect();
        if (window.innerWidth < 1024) {
            if (touch.clientX < cRect.left + 40) container.scrollBy({ left: -24, behavior: 'auto' });
            if (touch.clientX > cRect.right - 40) container.scrollBy({ left: 24, behavior: 'auto' });
        } else {
            if (touch.clientY < cRect.top + 40) container.scrollBy({ top: -20, behavior: 'auto' });
            if (touch.clientY > cRect.bottom - 40) container.scrollBy({ top: 20, behavior: 'auto' });
        }
    }
}

function onThumbTouchEnd(e) {
    if (!thumbTouchState) return;
    const endTouch = e?.changedTouches?.[0];
    const endX = endTouch?.clientX ?? thumbTouchState.lastX ?? thumbTouchState.startX;
    const endY = endTouch?.clientY ?? thumbTouchState.lastY ?? thumbTouchState.startY;
    let changed = false;
    if (thumbTouchState.active) {
        if (thumbTouchState.mode === 'delete') {
            if (isPointInThumbDeleteDropzone(endX, endY)) {
                changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
            }
        } else {
            if (window.innerWidth < 1024) {
                const target = getMobileThumbInsertTarget(endX);
                if (target) {
                    thumbTouchState.insertIndex = target.insertIndex;
                    showMobileThumbInsertPreview(target);
                }
                if (Number.isInteger(thumbTouchState.insertIndex)) {
                    changed = moveSectionToInsertIndexWithHistory(thumbTouchState.sourceIndex, thumbTouchState.insertIndex);
                }
            } else {
                const endWrap = getThumbTargetFromPoint(endX, endY);
                if (endWrap) {
                    const endTargetIndex = Number(endWrap.dataset.sectionIndex);
                    if (Number.isInteger(endTargetIndex)) {
                        thumbTouchState.targetIndex = endTargetIndex;
                        thumbTouchState.position = getDropPositionByPoint(endWrap, endX, endY);
                        markThumbDropHint(endTargetIndex, thumbTouchState.position);
                    }
                }
                if (Number.isInteger(thumbTouchState.targetIndex)) {
                    changed = moveSectionWithHistory(thumbTouchState.sourceIndex, thumbTouchState.targetIndex, thumbTouchState.position || 'after');
                }
            }
        }
    } else if (thumbTouchState.mode === 'delete' && isPointInThumbDeleteDropzone(endX, endY)) {
        changed = deleteSectionWithHistory(thumbTouchState.sourceIndex);
    } else {
        changeSection(thumbTouchState.sourceIndex, refreshForThumbSelection);
        changed = true;
    }
    if (changed) {
        suppressThumbClickUntil = Date.now() + 350;
    }
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

function onThumbTouchCancel() {
    if (!thumbTouchState) return;
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    clearThumbDeleteDropzone();
    thumbDragSourceIdx = null;
}

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const s = getEditableActiveFixedSection();
    if (!s) return;
    pushState();
    s[k] = v;
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────
//  背景画像調整モード
// ──────────────────────────────────────
let isImageAdjusting = false;
let mobileAdjustViewBackup = null;
let imageHandleDrag = null;

function calcMobileAdjustScale(pos) {
    const view = document.getElementById('canvas-view');
    if (!view) return 0.6;
    const cw = view.clientWidth || CANONICAL_PAGE_WIDTH;
    const ch = view.clientHeight || CANONICAL_PAGE_HEIGHT;
    const halfW = CANONICAL_PAGE_WIDTH / 2;
    const halfH = CANONICAL_PAGE_HEIGHT / 2;
    const visibilityFactor = Math.max(
        1,
        pos?.scale || 1,
        1 + Math.abs(pos?.x || 0) / halfW,
        1 + Math.abs(pos?.y || 0) / halfH
    );
    const needW = CANONICAL_PAGE_WIDTH * visibilityFactor;
    const needH = CANONICAL_PAGE_HEIGHT * visibilityFactor;
    const s = Math.min(cw / needW, ch / needH) * 0.82;
    return Math.min(Math.max(s, 0.22), 0.9);
}

function isSpreadImageSection(section) {
    return section?.type === 'image'
        && section.spreadImage
        && typeof section.spreadImage === 'object'
        && !!section.spreadImage.groupId;
}

function getSpreadImagePhysicalRole(pageIndex) {
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0) return '';
    const adjIdx = getSpreadAdjacentPageIndexForRole(idx);
    if (adjIdx < 0) return '';
    const lang = state.activeLang || state.defaultLang || 'ja';
    const pageDir = getEditorLangDirection(lang);
    const pageOnLeft = pageDir === 'rtl' ? idx >= adjIdx : idx <= adjIdx;
    return pageOnLeft ? 'left' : 'right';
}

function getSpreadImageRenderOptions(section, pageIndex = -1) {
    if (!isSpreadImageSection(section)) return {};
    const resolvedIndex = Number.isInteger(pageIndex) && pageIndex >= 0
        ? pageIndex
        : (state.sections || []).indexOf(section);
    const physicalRole = getSpreadImagePhysicalRole(resolvedIndex);
    const role = physicalRole || (section.spreadImage.role === 'left' ? 'left' : 'right');
    return {
        frameWidth: CANONICAL_PAGE_WIDTH * 2,
        frameHeight: CANONICAL_PAGE_HEIGHT,
        percentBaseWidth: CANONICAL_PAGE_WIDTH,
        percentBaseHeight: CANONICAL_PAGE_HEIGHT,
        offsetX: role === 'left' ? CANONICAL_PAGE_WIDTH / 2 : -CANONICAL_PAGE_WIDTH / 2
    };
}

function normalizeImagePosition(pos = {}) {
    const toNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    return {
        x: toNum(pos.x, 0),
        y: toNum(pos.y, 0),
        scale: Math.max(0.1, toNum(pos.scale, 1)),
        rotation: toNum(pos.rotation, 0),
        flipX: !!pos.flipX
    };
}

function syncSpreadImageGroupForLang(activeIdx, lang) {
    const active = state.sections?.[activeIdx];
    if (!isSpreadImageSection(active)) return null;
    const groupId = active.spreadImage.groupId;
    const members = (state.sections || []).filter((section) => section?.spreadImage?.groupId === groupId);
    if (members.length < 2) return null;

    let shared = active.imagePositions?.[lang]
        || members.find((section) => section.imagePositions?.[lang])?.imagePositions?.[lang]
        || active.imagePosition
        || members.find((section) => section.imagePosition)?.imagePosition
        || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    shared = normalizeImagePosition(shared);

    members.forEach((section) => {
        if (!section.imagePositions) section.imagePositions = {};
        section.imagePositions[lang] = shared;
        section.imagePosition = shared;
        if (!section.imageBasePosition) {
            section.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
        }
    });
    return shared;
}

function getActiveImagePosition() {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return null;
    const lang = state.activeLang || state.defaultLang || 'ja';
    const spreadShared = syncSpreadImageGroupForLang(state.activeIdx, lang);
    if (spreadShared) return spreadShared;
    if (!s.imagePositions) s.imagePositions = {};
    if (!s.imagePositions[lang]) {
        // Migrate from legacy shared imagePosition on first access
        const legacy = s.imagePosition || {};
        s.imagePositions[lang] = {
            x: Number.isFinite(Number(legacy.x)) ? Number(legacy.x) : 0,
            y: Number.isFinite(Number(legacy.y)) ? Number(legacy.y) : 0,
            scale: Math.max(0.1, Number.isFinite(Number(legacy.scale)) ? Number(legacy.scale) : 1),
            rotation: Number.isFinite(Number(legacy.rotation)) ? Number(legacy.rotation) : 0,
            flipX: legacy.flipX || false
        };
    }
    const pos = s.imagePositions[lang];
    const toNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    pos.x = toNum(pos.x, 0);
    pos.y = toNum(pos.y, 0);
    pos.scale = Math.max(0.1, toNum(pos.scale, 1));
    pos.rotation = toNum(pos.rotation, 0);
    if (pos.flipX === undefined) pos.flipX = false;
    if (!s.imageBasePosition) s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    return pos;
}

function getPointerClientPoint(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function roundRotationHalfStep(value) {
    const n = Number(value) || 0;
    return Math.round(n * 2) / 2;
}

window.adjustImageZoom = (delta) => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.scale = Math.max(0.1, pos.scale + delta);
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.resetImageTransform = () => {
    const s = getEditableActiveFixedSection('image');
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !s || !pos) return;
    const base = s.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
    pushState();
    pos.x = base.x || 0;
    pos.y = base.y || 0;
    pos.scale = base.scale || 1;
    pos.rotation = base.rotation || 0;
    pos.flipX = base.flipX || false;
    resetImageSnapState();
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.toggleImageFlipX = () => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.flipX = !pos.flipX;
    scheduleImageAdjustDomUpdate();
    triggerAutoSave();
};

window.setImageRotationFromSlider = (value) => {
    if (!canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    const rotation = roundRotationHalfStep(Math.max(-180, Math.min(180, Number(value) || 0)));
    pos.rotation = rotation;
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
};

window.startImageRotationSliderAdjust = (event) => {
    if (!canEditActiveFixedPage('image')) return;
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.setPointerCapture && event.pointerId != null) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
    }
    isAdjustingRotationSlider = true;
    window.moveImageRotationSliderAdjust(event);
};

window.endImageRotationSliderAdjust = (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
        if (event.currentTarget?.releasePointerCapture && event.pointerId != null) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch { }
        }
    }
    isAdjustingRotationSlider = false;
};

window.moveImageRotationSliderAdjust = (event) => {
    if (!isAdjustingRotationSlider || !event?.currentTarget) return;
    event.stopPropagation();
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.height) return;
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const ratio = y / rect.height;
    const rotation = 180 - (ratio * 360);
    window.setImageRotationFromSlider(rotation);
};

window.startImageHandleDrag = (e, handleType) => {
    if (!isImageAdjusting || !canEditActiveFixedPage('image')) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const target = document.getElementById('image-adjust-target') || document.getElementById('canvas-transform-layer');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    imageHandleDrag = {
        handleType,
        startPoint: p,
        center: { x: cx, y: cy },
        base: {
            x: pos.x,
            y: pos.y,
            scale: pos.scale,
            rotation: pos.rotation || 0
        },
        startAngle: Math.atan2(p.y - cy, p.x - cx),
        startDist: Math.hypot(p.x - cx, p.y - cy) || 1
    };
    pushState();
    window.addEventListener('mousemove', onImageHandleDragMove);
    window.addEventListener('mouseup', onImageHandleDragEnd);
};

function onImageHandleDragMove(e) {
    if (!isImageAdjusting || !imageHandleDrag || !canEditActiveFixedPage('image')) return;
    const pos = getActiveImagePosition();
    if (!pos) return;

    const p = getPointerClientPoint(e);
    const dx = p.x - imageHandleDrag.startPoint.x;
    const dy = p.y - imageHandleDrag.startPoint.y;

    if (imageHandleDrag.handleType === 'rotate') {
        const currentAngle = Math.atan2(p.y - imageHandleDrag.center.y, p.x - imageHandleDrag.center.x);
        const deltaDeg = (currentAngle - imageHandleDrag.startAngle) * (180 / Math.PI);
        pos.rotation = imageHandleDrag.base.rotation + deltaDeg;
    } else {
        const currentDist = Math.hypot(p.x - imageHandleDrag.center.x, p.y - imageHandleDrag.center.y) || 1;
        const ratio = currentDist / imageHandleDrag.startDist;
        pos.scale = Math.max(0.1, imageHandleDrag.base.scale * ratio);
        pos.x = imageHandleDrag.base.x + dx / (2 * canvasScale);
        pos.y = imageHandleDrag.base.y + dy / (2 * canvasScale);
    }
    const s = state.sections[state.activeIdx];
    const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
    applyImageSnapping(pos, bgUrl);
    scheduleImageAdjustDomUpdate();
}

function onImageHandleDragEnd() {
    if (!imageHandleDrag) return;
    imageHandleDrag = null;
    resetImageSnapState();
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    const s = state.sections[state.activeIdx];
    if (s && state.uid) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl) {
            generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                .catch(e => console.warn('[DSF] Thumbnail update skipped (onImageHandleDragEnd):', e));
        }
    }
    triggerAutoSave();
}

function exitImageAdjustmentModeUi() {
    isImageAdjusting = false;
    isAdjustingRotationSlider = false;
    imageHandleDrag = null;
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    resetImageSnapState();
    ['btn-adjust-img', 'btn-adjust-img-panel'].forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.background = '#fff';
        btn.style.color = '#333';
    });
    document.getElementById('canvas-transform-layer')?.classList.remove('adjust-image-mode');
    const bubbleLayer = document.getElementById('bubble-layer');
    if (bubbleLayer) bubbleLayer.style.pointerEvents = '';
    document.getElementById('image-zoom-controls-floating')?.classList.remove('visible');
    if (mobileAdjustViewBackup) {
        canvasScale = mobileAdjustViewBackup.scale;
        canvasTranslate = { ...mobileAdjustViewBackup.translate };
        mobileAdjustViewBackup = null;
        updateCanvasTransform();
    }
    document.body.classList.remove('image-adjusting-mobile');
    const info = document.getElementById('text-label');
    if (info) info.textContent = 'テキスト入力';
}

window.toggleImageAdjustment = () => {
    const s = getEditableActiveFixedSection('image');
    if (!s) return;

    isImageAdjusting = !isImageAdjusting;
    if (!isImageAdjusting) {
        exitImageAdjustmentModeUi();
    }

    // UI更新
    ['btn-adjust-img', 'btn-adjust-img-panel'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.style.background = isImageAdjusting ? 'var(--primary)' : '#fff';
            btn.style.color = isImageAdjusting ? '#fff' : '#333';
        }
    });

    // クロップ枠外のグレーアウト表示切り替え
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        if (isImageAdjusting) {
            layer.classList.add('adjust-image-mode');
        } else {
            layer.classList.remove('adjust-image-mode');
            resetImageSnapState();
        }
    }
    const bubbleLayer = document.getElementById('bubble-layer');
    if (bubbleLayer) {
        bubbleLayer.style.pointerEvents = isImageAdjusting ? 'none' : '';
    }
    const floatingControls = document.getElementById('image-zoom-controls-floating');
    if (floatingControls) {
        floatingControls.classList.toggle('visible', isImageAdjusting);
    }

    const isMobile = window.innerWidth < 1024;
    if (isMobile && isImageAdjusting) {
        if (typeof window.closeMobileSheet === 'function') {
            window.closeMobileSheet();
        }
        mobileAdjustViewBackup = {
            scale: canvasScale,
            translate: { ...canvasTranslate }
        };
        const pos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1 };
        canvasScale = calcMobileAdjustScale(pos);
        canvasTranslate = { x: 0, y: 0 };
        updateCanvasTransform();
        document.body.classList.add('image-adjusting-mobile');
    } else if (isMobile && !isImageAdjusting) {
        if (mobileAdjustViewBackup) {
            canvasScale = mobileAdjustViewBackup.scale;
            canvasTranslate = { ...mobileAdjustViewBackup.translate };
            updateCanvasTransform();
        }
        mobileAdjustViewBackup = null;
        document.body.classList.remove('image-adjusting-mobile');
    }

    // ガイド表示などの視覚的フィードバック
    const imgInfo = document.getElementById('text-label');
    if (imgInfo) {
        imgInfo.textContent = isImageAdjusting ? "画像をドラッグ/ピンチして調整" : "テキスト入力";
    }

    // 調整モード確定: refresh で handles 表示/非表示を切り替える
    refresh();
    // 調整モード終了時に値を確定して保存＋サムネイル再生成
    if (!isImageAdjusting) {
        triggerAutoSave();
        // サムネイル更新（多言語対応: backgrounds[activeLang] を優先使用）
        const lang = state.activeLang || state.defaultLang || 'ja';
        const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
        const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
        if (thumbBgUrl && state.uid) {
            generateCroppedThumbnail(
                thumbBgUrl,
                thumbPos,
                refresh
            ).catch(e => console.warn('[DSF] Thumbnail update skipped (toggleImageAdjustment):', e));
        }
    }
};

// 画像操作イベントリスナー
function initImageAdjustment() {
    const view = document.getElementById('canvas-view');
    // We bind events to view but check target or mode

    let isDraggingImg = false;
    let startPos = { x: 0, y: 0 };
    let startTransform = { x: 0, y: 0 };
    let startScale = 1;
    let initialPinchDist = null;

    // Events

    const onMove = (clientX, clientY) => {
        if (isAdjustingRotationSlider) return;
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;
        const pos = getActiveImagePosition();
        if (!pos) return;
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;
        const s = state.sections[state.activeIdx];
        const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
        applyImageSnapping(pos, bgUrl);
        scheduleImageAdjustDomUpdate();
    };

    const onMoveWrap = (e) => onMove(e.clientX, e.clientY);

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            resetImageSnapState();
            const s = state.sections[state.activeIdx];
            if (s && state.uid) {
                const lang = state.activeLang || state.defaultLang || 'ja';
                const thumbBgUrl = s.backgrounds?.[lang] || s.backgrounds?.[state.defaultLang] || s.background || '';
                const thumbPos = getActiveImagePosition() || s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
                if (thumbBgUrl) {
                    generateCroppedThumbnail(thumbBgUrl, thumbPos, refresh)
                        .catch(e => console.warn('[DSF] Thumbnail update skipped (onEnd):', e));
                }
            }
            triggerAutoSave();
        }
        window.removeEventListener('mousemove', onMoveWrap);
        window.removeEventListener('mouseup', onEnd);
    };

    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting || isAdjustingRotationSlider) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getActiveImagePosition();
        startTransform = pos ? { x: pos.x, y: pos.y } : { x: 0, y: 0 };
        window.addEventListener('mousemove', onMoveWrap);
        window.addEventListener('mouseup', onEnd);
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        if (isAdjustingRotationSlider) return;
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget)) {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });

    // Touch
    view.addEventListener('touchstart', (e) => {
        if (isAdjustingRotationSlider) return;
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget || e.touches.length === 2)) {
            e.stopPropagation();
            if (e.touches.length === 1) {
                onStart(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                // Pinch start
                isDraggingImg = false; // Cancel drag
                const dist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                initialPinchDist = dist;
                const pos = getActiveImagePosition();
                startScale = pos?.scale || 1;
            }
        }
    }, { passive: false });

    view.addEventListener('touchmove', (e) => {
        onImageHandleDragMove(e);
        if (!isImageAdjusting) return;
        if (isAdjustingRotationSlider) {
            e.preventDefault();
            return;
        }
        if (e.touches.length === 1) {
            e.preventDefault(); // Prevent scroll
            onMove(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2 && initialPinchDist) {
            e.preventDefault();
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const scale = dist / initialPinchDist;
            const pos = getActiveImagePosition();
            if (!pos) return;
            pos.scale = Math.max(0.1, startScale * scale);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        initialPinchDist = null;
        onEnd();
        onImageHandleDragEnd();
    });

    // Wheel Zoom for Image
    view.addEventListener('wheel', (e) => {
        if (isImageAdjusting) {
            e.preventDefault();
            e.stopPropagation();
            const pos = getActiveImagePosition();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            pos.scale = Math.max(0.1, (pos.scale || 1) * delta);
            const s = state.sections[state.activeIdx];
            const bgUrl = getOptimizedImageUrl(s?.backgrounds?.[state.activeLang] || s?.backgrounds?.[state.defaultLang] || s?.background || '');
            applyImageSnapping(pos, bgUrl);
            scheduleImageAdjustDomUpdate();
            // Debounce save?
            if (window.saveTimer) clearTimeout(window.saveTimer);
            window.saveTimer = setTimeout(triggerAutoSave, 500);
        }
    }, { passive: false });
}

// ──────────────────────────────────────
//  テキスト更新（多言語対応）
// ──────────────────────────────────────
let textPushTimer = null;
function updateActiveText(v) {
    const s = getEditableActiveFixedSection();
    if (!s) return;
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        setBubbleText(s.bubbles[state.activeBubbleIdx], v);
    }
    refresh();
    triggerAutoSave();
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション キャンバスプレビュー
// ──────────────────────────────────────────────────────────────

function _hideTextPreviewOverlay() {
    const overlay = document.getElementById('text-preview-overlay');
    if (overlay) overlay.style.display = 'none';
}

/** HTML 特殊文字をエスケープ */
function _escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const VERTICAL_GLYPH_MAP = Object.freeze({
    'ー': '︱',
    '―': '︱',
    '—': '︱',
    '–': '︲',
    '…': '︙',
    '‥': '︰',
    '、': '︑',
    '。': '︒',
    '，': '︐',
    '：': '︓',
    '；': '︔',
    '！': '︕',
    '？': '︖',
    '（': '︵',
    '）': '︶',
    '｛': '︷',
    '｝': '︸',
    '〔': '︹',
    '〕': '︺',
    '【': '︻',
    '】': '︼',
    '《': '︽',
    '》': '︾',
    '〈': '︿',
    '〉': '﹀',
    '「': '﹁',
    '」': '﹂',
    '『': '﹃',
    '』': '﹄',
    '［': '﹇',
    '］': '﹈'
});

function _verticalGlyphText(text) {
    return Array.from(String(text || ''), ch => VERTICAL_GLYPH_MAP[ch] || ch).join('');
}

function _markupVerticalDigits(text) {
    const chars = Array.from(String(text || ''));
    return chars.map(ch => _escHtml(_verticalGlyphText(ch))).join('');
}

/**
 * 縦書き列の 1 行を HTML にマークアップする。
 * 2〜4 桁の半角または全角数字を <span class="tcy"> でラップし縦中横（Tate-Chu-Yoko）を適用する。
 * ルビなし plain-text 用。ruby 付き行は _markupTokenLine を使用する。
 */
function _markupVerticalLine(rawLine) {
    if (!rawLine) return '\u00a0';
    return _markupTcyText(rawLine) || '\u00a0';
}

/**
 * トークン行からベーステキストのみ HTML を生成する（縦書き列用）。
 * ruby token は base テキストだけを出力し、<ruby> 要素を使わない。
 * ルビ注釈は別レイヤー（.tpv-ruby-overlay）で描画する。
 */
function _baseTextFromTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        parts.push(_markupTcyText(tok.kind === 'ruby' ? tok.base : (tok.text || '')));
    }
    return parts.join('') || '\u00a0';
}

/**
 * トークン行（alignRubyToLines の 1 要素）を HTML にマークアップする。
 * - plain text token: _escHtml + TCY 数字ラップ（_markupVerticalLine 相当）
 * - ruby token: <ruby>base<rt>ruby</rt></ruby>（base にも TCY 適用）
 * 横書きで使用する。
 */
function _markupTokenLine(tokenLine) {
    if (!tokenLine || !tokenLine.length) return '\u00a0';
    const parts = [];
    for (const tok of tokenLine) {
        if (tok.kind === 'ruby') {
            const markedBase = _markupTcyText(tok.base);
            const rubyText = _escHtml(tok.ruby || '');
            parts.push(`<ruby>${markedBase}<rt>${rubyText}</rt></ruby>`);
        } else {
            parts.push(_markupTcyText(tok.text || ''));
        }
    }
    const html = parts.join('');
    return html || '\u00a0';
}

/** 文字列内の 2〜4 桁の半角・全角数字に TCY span を適用する（内部ヘルパー） */
function _markupTcyText(text) {
    if (!text) return '';
    return _markupVerticalDigits(text);
}

/**
 * composeText の lines 配列を縦書き連続フロー用 HTML に変換する。
 * 空行（段落区切り）は全角スペース（字下げ代わり）に変換し、
 * 行間スペースを入れずに連結することで CSS のマルチカラムフロー
 * （column-fill: auto）が列を上から下まで充填できるようにする。
 */
function _buildCjkHtmlFlow(lines) {
    const parts = [];
    for (const line of lines) {
        if (line === '') {
            parts.push('\u3000'); // 段落区切り → 字下げ（U+3000 ideographic space）
        } else {
            parts.push(_markupVerticalLine(line));
        }
    }
    return parts.join('');
}

/**
 * composeText の lines 配列を段落単位に再結合する（横書き向け）。
 * 連続する非空行をスペースで繋ぎ、空行は null（ブランク行）として返す。
 * CSS が justify + hyphens で再ラップできるよう、行分割を解除する。
 */
function _linesIntoParagraphs(lines, lineBreaks = []) {
    const result = [];
    let buf = [];
    function flushBuf() {
        if (!buf.length) return;
        result.push(buf.join(' '));
        buf = [];
    }
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(line);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

/**
 * ルビあり横書き向け: alignRubyToLines の token-line 配列を段落単位に結合する。
 * 空行（lines[i] === ''）は null として返す。
 * 連続する token 行のトークンを結合し、text トークン間にスペースを挿入する。
 * @param {Array<Array>} rubyLines  alignRubyToLines の返り値
 * @param {string[]} lines          composeText の lines（空行判定用）
 * @returns {Array<Array<token>|null>}
 */
function _tokenLinesIntoParagraphs(rubyLines, lines, lineBreaks = []) {
    const result = [];
    let buf = [];

    function flushBuf() {
        if (!buf.length) return;
        // 複数行のトークンをスペース区切りで結合（行境界にスペースを挿入）
        const merged = [];
        for (let i = 0; i < buf.length; i++) {
            merged.push(...buf[i]);
            if (i < buf.length - 1) {
                merged.push({ kind: 'text', text: ' ' });
            }
        }
        result.push(merged);
        buf = [];
    }

    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') {
            flushBuf();
            result.push(null);
        } else {
            buf.push(rubyLines[i] || []);
            if (lineBreaks[i]) flushBuf();
        }
    }
    flushBuf();
    return result;
}

function _getHorizontalTextOffsetY(composed) {
    if (!composed || composed.writingMode !== 'horizontal-tb') return 0;
    return 0;
}

function _getTextSectionAlign(section) {
    const value = section?.textAlign || 'start';
    return TEXT_ALIGN_VALUES.includes(value) ? value : 'start';
}

function _getHorizontalBlockJustifyCss(section) {
    const align = _getTextSectionAlign(section);
    if (align === 'center') return 'center';
    if (align === 'end') return 'flex-end';
    return 'flex-start';
}

function _getVerticalBlockJustifyCss(section) {
    const align = _getTextSectionAlign(section);
    if (align === 'center') return 'center';
    if (align === 'end') return 'flex-end';
    return 'flex-start';
}

function _getVerticalBlockOffsetPx(section, frameW, usedCols, colW) {
    const groupW = Math.min(frameW, usedCols * colW);
    const align = _getTextSectionAlign(section);
    if (align === 'center') return Math.max(0, (frameW - groupW) / 2);
    if (align === 'end') return 0;
    return Math.max(0, frameW - groupW);
}

/**
 * テキストセクションの組版結果をキャンバス上の HTML オーバーレイとして描画する。
 *
 * ▼ 縦書き (vertical-rl)
 *   - 列ごとに <span class="tpv-col"> を生成し、flex row-reverse で右端から配置
 *   - 列幅   = frame.w / maxLines（全列が枠内に収まるよう均等割り）
 *   - 文字ピッチ = frame.h / charsPerLine（縦方向均等割り）
 *   - 2〜4 桁の半角・全角数字に <span class="tcy"> を自動付与（縦中横）
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 *
 * ▼ 横書き (horizontal-tb)
 *   - composeText() が確定した行をそのまま 1 行ずつ描画
 *   - 行頭は揃えたまま、ブロック全体を start / center / end に配置
 *   - {base|ruby} 記法を <ruby> タグに変換（ルビ）
 */
function renderTextPreview(section) {
    const overlay = document.getElementById('text-preview-overlay');
    if (!overlay) return;

    const lang = state.activeLang || state.defaultLang || 'ja';
    const raw = section.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);

    // ルビマークアップを解析し、ベーステキストで組版する
    let rubyTokens, hasRuby, plainText, rubyLines;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby = rubyTokens.some(t => t.kind === 'ruby');
        plainText = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch (e) {
        console.error('[renderTextPreview] ruby parse error:', e);
        rubyTokens = []; hasRuby = false; plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);
    const textAlign = _getTextSectionAlign(section);

    // ルビあり: 行ごとのトークン配列を構築
    try {
        rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null;
    } catch (e) {
        console.error('[renderTextPreview] ruby align error:', e);
        rubyLines = null;
    }

    const paperStyle = _getTextPaperStyle(_getTextPaperPresetKey(section));
    overlay.style.backgroundColor = paperStyle.backgroundColor;
    overlay.style.display = 'block';

    const frameEl = document.getElementById('text-preview-frame');
    if (frameEl) {
        const { x, y, w, h } = composed.frame;
        frameEl.style.left          = `${x}px`;
        frameEl.style.top           = `${y}px`;
        frameEl.style.width         = `${w}px`;
        frameEl.style.height        = `${h}px`;
        frameEl.style.fontFamily    = composed.font.family;
        frameEl.style.fontSize      = `${composed.font.size}px`;
        frameEl.style.color         = paperStyle.textColor;
        frameEl.style.writingMode   = '';
        frameEl.style.lineHeight    = '';
        frameEl.style.letterSpacing = composed.font.letterSpacing
            ? `${composed.font.letterSpacing}px` : '0';
        // hyphens:auto などが言語固有処理を使えるよう lang 属性を設定
        frameEl.setAttribute('lang', lang.toLowerCase());
    }

    const contentEl = document.getElementById('text-preview-content');
    if (contentEl) {
        if (!raw) {
            contentEl.innerHTML = '';
        } else if (composed.writingMode === 'vertical-rl') {
            // 縦書き: 2 レイヤー方式
            //
            // Layer 1 (.tpv-vertical): ベーステキスト列のみ（<ruby> なし）
            //   列幅・文字ピッチの計算はルビに左右されないため安定する。
            //
            // Layer 2 (.tpv-ruby-overlay): ルビ注釈を絶対座標で独立描画
            //   列レイアウトへの影響ゼロ。文字の行間が詰まらない。
            //
            // 座標系（canonical px、contentEl の左上が原点）:
            //   列 i（0=最右列）の左端 = w - (i+1)*colW
            //   列 i の右端           = w - i*colW
            //   ルビは列 i の右側（右端から右へ rubyW px）に配置
            //   文字オフセット co の上端 = co * charPitch
            const { w, h }    = composed.frame;
            const maxCols     = composed.rules?.maxLines    || 12;
            const charsPerCol = composed.rules?.charsPerLine || 33;
            const fontSize    = composed.font.size;
            const colW        = Math.floor(w / maxCols);
            const lineHeight  = (colW / fontSize).toFixed(3);
            const letterSpacing = ((h / charsPerCol) - fontSize).toFixed(3);
            const charPitch   = h / charsPerCol; // 1 文字あたりの縦ピクセル（canonical）
            const rubyFontSize = Math.round(fontSize * 0.5); // rt のフォントサイズ（canonical）
            const rubyColW    = Math.round(fontSize * 0.65); // ルビ注釈の横幅（canonical）
            const verticalJustify = _getVerticalBlockJustifyCss(section);
            const usedCols = composed.lines.length;
            const groupW = usedCols * colW;
            const blockOffsetX = _getVerticalBlockOffsetPx(section, w, usedCols, colW);
            // 字形は line-height の中央に配置されるため、ルビは字形右端 = 列右端 - (colW - fontSize)/2 に置く
            const charRightOffset = Math.round((colW - fontSize) / 2);

            // Layer 1: ベーステキスト列（ruby 要素なし）
            const cols = composed.lines.map((line, i) => {
                const content = rubyLines
                    ? _baseTextFromTokenLine(rubyLines[i])
                    : _markupVerticalLine(line);
                return `<span class="tpv-col"` +
                    ` style="width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px"` +
                    `>${content}</span>`;
            }).join('');

            // Layer 2: ルビ注釈オーバーレイ
            let rubyOverlay = '';
            if (rubyLines) {
                const anns = [];
                for (let i = 0; i < rubyLines.length; i++) {
                    let charOffset = 0;
                    for (const tok of rubyLines[i]) {
                        const baseLen = tok.kind === 'ruby'
                            ? Array.from(tok.base || '').length
                            : Array.from(tok.text || '').length;
                        if (tok.kind === 'ruby' && tok.ruby) {
                            // 字形は line-height の中央にある。
                            // 字形右端 = 列右端 - charRightOffset = w - i*colW - charRightOffset
                            // ルビはその右（字形右端）から配置し、字形に密着させる。
                            const annLeft = groupW - i * colW - charRightOffset;
                            // ルビテキストを base 文字スパンの中央に揃えるため top を調整する
                            const rubyLen = Array.from(tok.ruby).length;
                            const rubyH   = Math.round(rubyLen * rubyFontSize * 1.2);
                            const baseH   = Math.round(baseLen * charPitch);
                            const annTop  = Math.round(charOffset * charPitch + Math.max(0, (baseH - rubyH) / 2));
                            anns.push(
                                `<span class="tpv-ruby-ann"` +
                                ` style="left:${Math.round(blockOffsetX + annLeft)}px;top:${annTop}px;` +
                                `width:${rubyColW}px;` +
                                `font-size:${rubyFontSize}px"` +
                                `>${_escHtml(_verticalGlyphText(tok.ruby))}</span>`
                            );
                        }
                        charOffset += baseLen;
                    }
                }
                if (anns.length) {
                    rubyOverlay = `<div class="tpv-ruby-overlay">${anns.join('')}</div>`;
                }
            }

            contentEl.innerHTML = `<div class="tpv-vertical" style="justify-content:${verticalJustify}">${cols}</div>${rubyOverlay}`;
        } else {
            // 横書き: 行頭は揃えたまま、行ブロック全体だけを配置する
            const lineH  = composed.frame.h / (composed.rules?.maxLines || 20);
            const offsetY = _getHorizontalTextOffsetY(composed);
            const horizontalJustify = _getHorizontalBlockJustifyCss(section);

            let html;
            if (rubyLines) {
                html = rubyLines.map((tokenLine, idx) => {
                    if (!composed.lines[idx]) {
                        return `<div class="tpv-blank" style="height:${lineH}px"></div>`;
                    }
                    return `<div class="tpv-line">${tokenLine.map(tok =>
                        tok.kind === 'ruby'
                            ? `<ruby>${_markupTcyText(tok.base)}<rt>${_escHtml(tok.ruby || '')}</rt></ruby>`
                            : _escHtml(tok.text || '')
                    ).join('')}</div>`;
                }).join('');
            } else {
                html = (composed.lines || []).map(line =>
                    !line
                        ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                        : `<div class="tpv-line">${_escHtml(line)}</div>`
                ).join('');
            }
            contentEl.innerHTML =
                `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="line-height:${lineH}px;transform:translateY(${offsetY}px);justify-content:${horizontalJustify}"><div class="tpv-horizontal-block">${html}</div></div>`;
        }
    }

    const placeholder = document.getElementById('text-preview-placeholder');
    if (placeholder) placeholder.style.display = raw ? 'none' : 'flex';
}

// ──────────────────────────────────────────────────────────────
//  テキストセクション パネル同期・入力ハンドラ
// ──────────────────────────────────────────────────────────────

let _textBodyPushTimer = null;
let _textBodyDebounceTimer = null;

/**
 * テキストセクションパネルを現在のセクション内容で同期する
 */
function _syncTextSectionPanel(section) {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const textarea = document.getElementById('prop-body-text');
    if (textarea && document.activeElement !== textarea) {
        textarea.value = section.texts?.[lang] ?? '';
    }
    const label = document.getElementById('text-body-label');
    if (label) label.textContent = `本文 [${lang.toUpperCase()}]`;

    _syncTextPaperPresetControls(section);
    _syncTextAlignControls(section);
    _updateTextOverflowBadge(section, lang);
}

function _inferTextPaperPresetKey(section) {
    if (section?.paperPreset && TEXT_PAPER_PRESETS[section.paperPreset]) {
        return section.paperPreset;
    }
    const bg = String(section?.backgroundColor || '').toLowerCase();
    const ink = String(section?.textColor || '').toLowerCase();
    const match = Object.entries(TEXT_PAPER_PRESETS).find(([, preset]) =>
        preset.backgroundColor.toLowerCase() === bg && preset.textColor.toLowerCase() === ink
    );
    return match?.[0] || 'white';
}

function _getTextPaperPresetKey(section) {
    if (state.textPaperPreset && TEXT_PAPER_PRESETS[state.textPaperPreset]) {
        return state.textPaperPreset;
    }
    return _inferTextPaperPresetKey(section);
}

function _syncTextPaperPresetControls(section) {
    const activeKey = _getTextPaperPresetKey(section);
    document.querySelectorAll('[data-text-paper-preset], [data-project-text-paper-preset]').forEach((button) => {
        const key = button.dataset.textPaperPreset || button.dataset.projectTextPaperPreset;
        const isActive = key === activeKey;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function _getProjectTextPaperPresetKey(source = state) {
    if (source?.textPaperPreset && TEXT_PAPER_PRESETS[source.textPaperPreset]) return source.textPaperPreset;
    const textSection = (source?.sections || []).find((section) => section?.type === 'text');
    return _inferTextPaperPresetKey(textSection);
}

function _getTextPaperStyle(key) {
    const presetKey = TEXT_PAPER_PRESETS[key] ? key : 'white';
    const preset = TEXT_PAPER_PRESETS[presetKey];
    return {
        paperPreset: presetKey,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor
    };
}

function _applyTextPaperStyleToSections(sections, key) {
    const nextStyle = _getTextPaperStyle(key);
    return (sections || []).map((section) => {
        if (section?.type !== 'text') return section;
        return { ...section, ...nextStyle };
    });
}

function _applyTextPaperStyleToBlocks(blocks, key) {
    const nextStyle = _getTextPaperStyle(key);
    return (blocks || []).map((block) => {
        if (block?.kind !== 'page' || block.content?.pageKind !== 'text') return block;
        return {
            ...block,
            content: {
                ...(block.content || {}),
                ...nextStyle
            }
        };
    });
}

function _syncTextAlignControls(section) {
    const activeAlign = _getTextSectionAlign(section);
    document.querySelectorAll('[data-text-align]').forEach((button) => {
        const isActive = button.dataset.textAlign === activeAlign;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function updateTextSectionAlign(value) {
    if (!TEXT_ALIGN_VALUES.includes(value)) return;

    const idx = state.activeIdx;
    const section = getEditableActiveFixedSection('text');
    if (!section) return;

    pushState();

    const sectionIndices = new Set([idx]);
    const blockIdx = Number.isInteger(state.activeBlockIdx) && state.activeBlockIdx >= 0
        ? state.activeBlockIdx
        : getBlockIndexFromPageIndex(state.blocks, idx);
    const activeBlock = state.blocks?.[blockIdx];
    const flowId = activeBlock?.kind === 'page' ? activeBlock.content?._flow?.id : '';

    let touchedBlock = false;
    const newBlocks = Array.isArray(state.blocks)
        ? state.blocks.map((block, bi) => {
            if (block?.kind !== 'page') return block;
            const sameFlow = flowId && block.content?._flow?.id === flowId;
            const samePage = bi === blockIdx;
            if (!sameFlow && !samePage) return block;
            const pageIdx = getPageIndexFromBlockIndex(state.blocks, bi);
            if (pageIdx >= 0) sectionIndices.add(pageIdx);
            touchedBlock = true;
            return {
                ...block,
                content: {
                    ...block.content,
                    textAlign: value
                }
            };
        })
        : [];

    const newSections = (state.sections || []).map((item, sectionIdx) => {
        if (!sectionIndices.has(sectionIdx) || item?.type !== 'text') return item;
        return { ...item, textAlign: value };
    });

    const blocks = touchedBlock
        ? newBlocks
        : syncBlocksWithSections(state.blocks, newSections, state.languages, { strictSpine: state.version === 6 });

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: blocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(blocks) } });

    renderTextPreview(newSections[idx]);
    _syncTextAlignControls(newSections[idx]);
    refresh();
    triggerAutoSave();
}

function updateTextSectionPaperPreset(key) {
    if (!TEXT_PAPER_PRESETS[key]) return;
    if (!canEditActiveFixedPage('text')) return;

    pushState();

    const newSections = _applyTextPaperStyleToSections(state.sections, key);
    const newBlocks = _applyTextPaperStyleToBlocks(state.blocks, key);

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: key } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(newBlocks) } });

    const section = newSections[state.activeIdx];
    if (section?.type === 'text') renderTextPreview(section);
    _syncTextPaperPresetControls(section);
    refresh();
    triggerAutoSave();
}

window.updateTextSectionPaperPreset = updateTextSectionPaperPreset;
window.updateTextSectionAlign = updateTextSectionAlign;

/**
 * 溢れバッジを更新する（溢れ時はページ数を表示）
 */
function _updateTextOverflowBadge(section, lang) {
    const badge = document.getElementById('text-overflow-badge');
    if (!badge) return;
    const raw = section.texts?.[lang] ?? '';
    if (!raw) { badge.style.display = 'none'; return; }
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);
    const tokens = parseRubyTokens(raw);
    const plainText = tokens.some(t => t.kind === 'ruby') ? tokensToPlainText(tokens) : raw;
    const result = composeText(plainText, lang, writingMode, fontPreset);
    if (!result.overflow) {
        badge.style.display = 'none';
    } else {
        // ページ数を計算して表示
        const pages = paginateText(plainText, lang, writingMode, fontPreset);
        const count = pages.length;
        badge.style.display = 'block';
        badge.textContent = t('label_text_flow', { count }) || `→ ${count} ページに展開`;
    }
}

// ──────────────────────────────────────
//  テキスト自動ページ流し込み (Auto Text Flow)
// ──────────────────────────────────────

let _autoFlowDebounceTimer = null;

/** flowId に属する継続ページブロック（idx > 0）のインデックスを取得する */
function _findFlowContinuationIndices(blocks, flowId) {
    const result = [];
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId && b.content._flow.idx > 0) {
            result.push(i);
        }
    }
    result.sort((a, b) => blocks[a].content._flow.idx - blocks[b].content._flow.idx);
    return result;
}

/** フロー継続ページブロックを新規作成する */
function _createContinuationBlock(masterBlock, text, flowId, flowIdx, lang) {
    const texts = {};
    texts[lang] = text;
    return {
        id: createId('page'),
        kind: 'page',
        content: {
            pageKind: 'text',
            background: masterBlock.content?.background || '',
            paperPreset: masterBlock.content?.paperPreset || 'white',
            backgroundColor: masterBlock.content?.backgroundColor || '',
            textColor: masterBlock.content?.textColor || '',
            textAlign: masterBlock.content?.textAlign || 'start',
            texts,
            bubbles: [],
            _flow: { id: flowId, idx: flowIdx }
        }
    };
}

/**
 * テキストセクションを自動ページ分割する。
 *
 * 多言語動作ルール:
 *  - 言語 A で溢れてページ追加した場合、他言語の継続スロットは空のまま追加するだけ。
 *  - 言語 B に切り替えて溢れが発生した場合:
 *      ・継続スロットの B テキストが「空」→ そのスロットを上書きして埋める
 *      ・継続スロットの B テキストが「非空」→ 上書きせず末尾に新規スロットを挿入
 *      ・既存スロット数を超えて新規ページが必要な場合 → 末尾に新規ブロックを追加
 *      ・他言語のページ数を超えた分 → 他言語は空スロットとして追加済み
 *  - B テキストが必要ページ数より少ない（テキスト削減）場合は、余剰スロットの
 *    B テキストをクリア。他言語コンテンツがあれば削除せず保持。
 */
function autoFlowTextSection() {
    if (!canEditActiveFixedPage('text')) return;
    const lang = state.activeLang || state.defaultLang || 'ja';
    const pageIdx = state.activeIdx;
    const blockIdx = getBlockIndexFromPageIndex(state.blocks, pageIdx);
    if (blockIdx < 0) return;

    const masterBlock = state.blocks[blockIdx];
    if (masterBlock?.kind !== 'page' || masterBlock.content?.pageKind !== 'text') return;
    // 継続ブロック上ではマスターフローのみ処理する
    if ((masterBlock.content._flow?.idx ?? 0) > 0) return;

    const rawText = masterBlock.content.texts?.[lang] ?? '';
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset = getFontPresetFromConfigs(lang, state.languageConfigs);

    const tokens = parseRubyTokens(rawText);
    const plainText = tokens.some(t => t.kind === 'ruby') ? tokensToPlainText(tokens) : rawText;
    const pageTexts = paginateText(plainText, lang, writingMode, fontPreset);

    let flowId = masterBlock.content._flow?.id;
    if (!flowId && pageTexts.length > 1) flowId = createId('flow');

    const newBlocks = [...state.blocks];

    // マスターブロックの _flow を更新
    const masterContent = { ...masterBlock.content };
    if (pageTexts.length > 1) {
        masterContent._flow = { id: flowId, idx: 0 };
    } else {
        delete masterContent._flow;
    }
    newBlocks[blockIdx] = { ...masterBlock, content: masterContent };

    const neededCount = pageTexts.length - 1;

    if (!flowId) {
        // フローなし・溢れなし
        _applyBlocksAndRefresh(newBlocks);
        return;
    }

    // 継続ブロックを配列上の位置順に収集
    const contIndices = [];
    for (let i = 0; i < newBlocks.length; i++) {
        const b = newBlocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId && (b.content._flow?.idx ?? 0) > 0) {
            contIndices.push(i);
        }
    }
    contIndices.sort((a, b) => a - b);

    const getLangText = (bi) => (newBlocks[bi]?.content?.texts?.[lang] ?? '').trim();
    const hasOtherLang = (bi) =>
        Object.entries(newBlocks[bi]?.content?.texts || {})
            .some(([l, txt]) => l !== lang && txt?.trim());

    // ── 空スロットと非空スロットを分類 ──
    const emptySlots   = contIndices.filter(bi => !getLangText(bi));
    const nonEmptySlots = contIndices.filter(bi => !!getLangText(bi));

    if (neededCount === 0) {
        // 溢れなし: 全継続ブロックの lang テキストをクリア（他言語があれば削除しない）
        for (let i = contIndices.length - 1; i >= 0; i--) {
            const bi = contIndices[i];
            if (hasOtherLang(bi)) {
                newBlocks[bi] = {
                    ...newBlocks[bi],
                    content: { ...newBlocks[bi].content, texts: { ...newBlocks[bi].content.texts, [lang]: '' } }
                };
            } else {
                newBlocks.splice(bi, 1);
            }
        }
    } else {
        let assigned = 0; // pageTexts[1..] の割り当て済み数

        // Step 1: 空スロットを前から順に埋める
        for (let i = 0; i < emptySlots.length && assigned < neededCount; i++) {
            const bi = emptySlots[i];
            newBlocks[bi] = {
                ...newBlocks[bi],
                content: {
                    ...newBlocks[bi].content,
                    texts: { ...newBlocks[bi].content.texts, [lang]: pageTexts[assigned + 1] }
                }
            };
            assigned++;
        }

        // Step 2: まだ足りない場合 → 末尾に新規ブロックを追加
        const stillNeeded = neededCount - assigned;
        if (stillNeeded > 0) {
            // 現時点での最後の継続ブロック位置を再取得（splice後の変化考慮）
            let insertAfter = blockIdx;
            for (let i = 0; i < newBlocks.length; i++) {
                const b = newBlocks[i];
                if (b?.kind === 'page' && b.content?._flow?.id === flowId) {
                    insertAfter = i;
                }
            }
            const newConts = [];
            for (let i = 0; i < stillNeeded; i++) {
                newConts.push(_createContinuationBlock(
                    newBlocks[blockIdx], pageTexts[assigned + 1 + i], flowId, contIndices.length + i + 1, lang
                ));
            }
            newBlocks.splice(insertAfter + 1, 0, ...newConts);
        }

        // Step 3: 非空スロットが neededCount を超えている場合は余剰をクリア
        // （割り当て済み空スロット + 非空スロット > neededCount のとき末尾から削除）
        const totalExisting = Math.min(emptySlots.length, neededCount) + nonEmptySlots.length;
        if (totalExisting > neededCount) {
            const excessCount = totalExisting - neededCount;
            const toExcess = nonEmptySlots.slice(-excessCount);
            for (let i = toExcess.length - 1; i >= 0; i--) {
                const bi = toExcess[i];
                if (hasOtherLang(bi)) {
                    newBlocks[bi] = {
                        ...newBlocks[bi],
                        content: { ...newBlocks[bi].content, texts: { ...newBlocks[bi].content.texts, [lang]: '' } }
                    };
                } else {
                    newBlocks.splice(bi, 1);
                }
            }
        }
    }

    // _flow.idx を配列上の出現順に再番号付け
    let flowIdx = 0;
    for (let i = 0; i < newBlocks.length; i++) {
        const b = newBlocks[i];
        if (b?.kind === 'page' && b.content?._flow?.id === flowId) {
            newBlocks[i] = { ...b, content: { ...b.content, _flow: { id: flowId, idx: flowIdx++ } } };
        }
    }

    _applyBlocksAndRefresh(newBlocks);
}

function _applyBlocksAndRefresh(newBlocks) {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
    const newSections = extractSectionsFromBlocks(newBlocks);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(newBlocks) } });
    refresh();
    triggerAutoSave();
}

// HTML から onclick で呼べるよう window に公開
window.autoFlowTextSection = autoFlowTextSection;

function _getActiveSectionHeading(section, lang) {
    if (!section || !lang) return '';
    return section.headings?.[lang] || '';
}

function syncPageHeadingField(section) {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const input = document.getElementById('canvas-page-heading-input');
    if (input && document.activeElement !== input) {
        input.value = _getActiveSectionHeading(section, lang);
    }
}

function _getSectionHeadingForToc(section, lang) {
    if (!section || (section.type !== 'image' && section.type !== 'text')) return '';
    const defaultLang = state.defaultLang || 'ja';
    return (
        section.headings?.[lang] ||
        (lang !== defaultLang ? section.headings?.[defaultLang] : '') ||
        ''
    ).trim();
}

function getEditorTocItems() {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const projection = getEditorPageProjection();
    const pageCount = projection?.totalPageCount || (state.sections || []).length;
    return (state.sections || [])
        .map((section, pageIndex) => {
            const heading = _getSectionHeadingForToc(section, lang);
            if (!heading) return null;
            const projectedPage = projection?.pages?.find((page) => (
                page.kind === 'fixed' && page.fixedPageIndex === pageIndex
            ));
            const presentationIndex = projectedPage?.index ?? pageIndex;
            return {
                pageIndex,
                label: getPageDisplayLabel(presentationIndex, pageCount, state.book, state.bookMode),
                heading
            };
        })
        .filter(Boolean);
}

function renderEditorTocPreview() {
    const panels = [...document.querySelectorAll('.js-toc-preview-panel')];
    if (!panels.length) return;
    const activeSection = getEditableActiveFixedSection();
    const isPageSection = activeSection?.type === 'image' || activeSection?.type === 'text';
    panels.forEach((panel) => { panel.style.display = isPageSection ? 'block' : 'none'; });
    if (!isPageSection) return;

    const items = getEditorTocItems();
    const html = !items.length
        ? `<div class="toc-preview-empty">${escapeStudioHtml(t('toc_preview_empty'))}</div>`
        : items.map((item) => {
            const active = item.pageIndex === state.activeIdx;
            const activeLabel = active ? `<span class="toc-preview-current">${escapeStudioHtml(t('toc_preview_current'))}</span>` : '';
            return `
                <button type="button" class="toc-preview-item${active ? ' active' : ''}" onclick="jumpToTocPage(${item.pageIndex})">
                    <span class="toc-preview-page">${escapeStudioHtml(item.label)}</span>
                    <span class="toc-preview-heading">${escapeStudioHtml(item.heading)}</span>
                    ${activeLabel}
                </button>
            `;
        }).join('');

    panels.forEach((panel) => {
        const list = panel.querySelector('.js-toc-preview-list');
        if (list) list.innerHTML = html;
    });
}

function updatePageHeading(value, langOverride) {
    const idx = state.activeIdx;
    const section = getEditableActiveFixedSection();
    if (!section || (section.type !== 'image' && section.type !== 'text')) return;
    const lang = langOverride || state.activeLang || state.defaultLang || 'ja';

    if (!_pageHeadingPushTimer) {
        pushState();
    } else {
        clearTimeout(_pageHeadingPushTimer);
    }
    _pageHeadingPushTimer = setTimeout(() => { _pageHeadingPushTimer = null; }, 600);
    const nextSections = (state.sections || []).map((sec, secIdx) => {
        if (secIdx !== idx) return sec;
        return {
            ...sec,
            headings: {
                ...(sec.headings || {}),
                [lang]: value || ''
            }
        };
    });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: nextSections } });

    const activeBlockIdx = getBlockIndexFromPageIndex(state.blocks, idx);
    const nextBlocks = (state.blocks || []).map((block, blockIdx) => {
        if (blockIdx !== activeBlockIdx || block?.kind !== 'page') return block;
        return {
            ...block,
            content: {
                ...(block.content || {}),
                headings: {
                    ...(block.content?.headings || {}),
                    [lang]: value || ''
                }
            }
        };
    });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(nextBlocks) } });

    refresh({ skipThumbs: true });
    triggerAutoSave();
}

/**
 * テキストセクションの本文入力ハンドラ（debounce 付き）
 */
function updateTextSectionBody(v) {
    const idx = state.activeIdx;
    const s = getEditableActiveFixedSection('text');
    if (!s) return;
    const lang = state.activeLang || state.defaultLang || 'ja';

    if (!_textBodyPushTimer) {
        pushState();
    } else {
        clearTimeout(_textBodyPushTimer);
    }
    _textBodyPushTimer = setTimeout(() => { _textBodyPushTimer = null; }, 600);

    dispatch({ type: actionTypes.UPDATE_SECTION_TEXT, payload: { idx, lang, text: v } });

    // blocks/pages を同期
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'blocks',
        value: syncBlocksWithSections(state.blocks, state.sections, state.languages, { strictSpine: state.version === 6 }),
    } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });

    // プレビューと溢れバッジをリアルタイム更新（debounce）
    clearTimeout(_textBodyDebounceTimer);
    _textBodyDebounceTimer = setTimeout(() => {
        const sec = state.sections[idx];
        _updateTextOverflowBadge(sec, lang);
        renderTextPreview(sec);
    }, 300);

    // 自動ページ流し込み（少し長めに待つ）
    clearTimeout(_autoFlowDebounceTimer);
    _autoFlowDebounceTimer = setTimeout(() => {
        autoFlowTextSection();
    }, 1000);

    triggerAutoSave();
}

function updateBubbleShape(shapeName) {
    const s = getEditableActiveFixedSection();
    if (s && state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        pushState();
        s.bubbles[state.activeBubbleIdx].shape = shapeName;
        refresh();
        triggerAutoSave();
    }
}

// ──────────────────────────────────────
//  最近使った色パレット
// ──────────────────────────────────────
const RECENT_COLORS_KEY = 'dsf_bubble_recent_colors';
const RECENT_COLORS_MAX = 16;

function loadRecentColors() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) || '[]');
    } catch { return []; }
}

function addRecentColor(color) {
    const hex = (color || '').toLowerCase();
    if (!hex.match(/^#[0-9a-f]{6}$/)) return;
    let list = loadRecentColors();
    list = [hex, ...list.filter(c => c !== hex)].slice(0, RECENT_COLORS_MAX);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch { }
    renderRecentColors();
}

function renderRecentColors() {
    const container = document.getElementById('bubble-recent-colors');
    if (!container) return;
    const list = loadRecentColors();
    if (list.length === 0) {
        container.innerHTML = '<span style="font-size:11px;color:#aaa;">まだありません</span>';
        return;
    }
    container.innerHTML = list.map(c =>
        `<button class="recent-color-swatch" style="background:${c};" title="${c}"
            onclick="applyRecentColor('${c}')" type="button"></button>`
    ).join('');
}

// 最後にアクティブだったカラープロップを記憶
let _lastColorProp = 'strokeColor';

function applyRecentColor(hex) {
    const propEls = {
        strokeColor: 'prop-stroke-color',
        fillColor: 'prop-fill-color',
        fontColor: 'prop-font-color'
    };
    // 選択中のカラーピッカーに適用
    const el = document.getElementById(propEls[_lastColorProp]);
    if (el) el.value = hex;
    updateBubbleColor(_lastColorProp, hex);
}
window.applyRecentColor = applyRecentColor;

function updateBubbleColor(prop, value) {
    _lastColorProp = prop;
    const s = getEditableActiveFixedSection();
    if (s && state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx][prop] = value;
        addRecentColor(value);
        refresh();
        triggerAutoSave();
    }
}
window.updateBubbleColor = updateBubbleColor;

// ─── AR 設定パネル ───────────────────────────────────────────────────────────


// フキダシ選択時に右パネルの値を同期する
function updateBubblePropPanel(bubble) {
    const shapeEl = document.getElementById('prop-shape');
    const strokeEl = document.getElementById('prop-stroke-color');
    const fillEl = document.getElementById('prop-fill-color');
    const fontEl = document.getElementById('prop-font-color');
    if (!bubble) {
        if (shapeEl) shapeEl.value = 'speech';
        if (strokeEl) strokeEl.value = '#000000';
        if (fillEl) fillEl.value = '#ffffff';
        if (fontEl) fontEl.value = '#000000';
        renderRecentColors();
        return;
    }
    if (shapeEl) shapeEl.value = bubble.shape || 'speech';
    if (strokeEl) strokeEl.value = bubble.strokeColor || '#000000';
    if (fillEl) fillEl.value = bubble.fillColor || '#ffffff';
    const defaultFont = (bubble.shape === 'urchin') ? '#ffffff' : '#000000';
    if (fontEl) fontEl.value = bubble.fontColor || defaultFont;
    renderRecentColors();
}
window.updateBubblePropPanel = updateBubblePropPanel;



// ──────────────────────────────────────
//  ページ送り方向更新
// ──────────────────────────────────────
function updatePageDirection(dir) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
    state.languageConfigs[lang].pageDirection = dir;
    pushState();
    refresh();
    triggerAutoSave();
}
window.updatePageDirection = updatePageDirection;

function syncLangPanel() {
    const sel = document.getElementById('lang-page-direction');
    if (!sel) return;
    const dir = state.languageConfigs?.[state.activeLang]?.pageDirection || 'ltr';
    sel.value = dir;
}


async function onLoadProject(pid) {
    try {
        await flushPendingSave();
        resetFlowRuntimeForProjectChange();
        await loadProject(pid, () => {
            clearHistory();
            ensureUiPrefs();
            applyThumbColumnsFromPrefs();
            refresh();
            renderLangSettings();
            if (getCurrentRoom() === 'press') enterPressRoom();
        });
        return true;
    } catch (error) {
        console.error('[Studio] Project load failed:', error);
        alert(`プロジェクトを安全に読み込めませんでした。\n${error?.message || String(error)}`);
        return false;
    }
}

// --- キーボードショートカット ---
document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229 || _flowAuthoringComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        performProjectUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        performProjectRedo();
    }
});

function refreshAfterHistoryRestore(focusSnapshot = null) {
    _flowAuthoringSourceRevision += 1;
    invalidateFlowRuntimeAuthoring();
    clearFlowDirectEditRuntime();
    restoreFlowDirectEditFocusSnapshot(focusSnapshot);
    refresh();
    if (focusSnapshot?.mode !== 'direct') restoreFlowAuthoringFocusSnapshot(focusSnapshot);
}

function performProjectUndo() {
    if (_flowTranslationJob?.state === 'running') {
        _flowTranslationJob.controller?.abort?.();
    }
    _flowTranslationJob = null;
    endHistoryGroup();
    const focusSnapshot = captureFlowEditorFocusSnapshot();
    if (undo(() => refreshAfterHistoryRestore(focusSnapshot))) triggerAutoSave();
}

function performProjectRedo() {
    if (_flowTranslationJob?.state === 'running') {
        _flowTranslationJob.controller?.abort?.();
    }
    _flowTranslationJob = null;
    endHistoryGroup();
    const focusSnapshot = captureFlowEditorFocusSnapshot();
    if (redo(() => refreshAfterHistoryRestore(focusSnapshot))) triggerAutoSave();
}

// --- グローバル関数の登録 ---
window.handleCanvasClick = (e) => {
    // テキストページはキャンバスクリックを無効にする（吹き出し追加・画像操作不要）
    const activeSection = getEditableActiveFixedSection();
    if (!activeSection || activeSection.type === 'text') return;
    pushState();
    handleCanvasClick(e, refresh);
    triggerAutoSave();
};
window.selectBubble = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    selectBubble(e, i, refresh);
};
function hideContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    contextMenu.style.display = 'none';
    contextMenu.dataset.pointerX = '';
    contextMenu.dataset.pointerY = '';
}
function showContextMenuAt(x, y, html) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    contextMenu.innerHTML = html;
    contextMenu.style.display = 'flex';
    const rect = contextMenu.getBoundingClientRect();
    let menuX = x;
    let menuY = y;
    if (menuX + rect.width > window.innerWidth) menuX = window.innerWidth - rect.width - 8;
    if (menuY + rect.height > window.innerHeight) menuY = window.innerHeight - rect.height - 8;
    contextMenu.style.left = `${Math.max(8, menuX)}px`;
    contextMenu.style.top = `${Math.max(8, menuY)}px`;
}
function insertSectionBeforeActiveByType(sectionType = 'image') {
    if (state.version === 6) {
        const blockIdx = Number.isInteger(state.activeBlockIdx)
            ? state.activeBlockIdx
            : Math.max(0, (state.blocks || []).length - 1);
        pushState();
        insertPageNearBlock(blockIdx, 'before', refresh, sectionType);
        triggerAutoSave();
        return;
    }
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    const insertAt = activeIdx >= 0 ? activeIdx : (state.sections || []).length;
    pushState();
    insertSectionAt(insertAt, refresh, sectionType);
    triggerAutoSave();
}
function isActiveCoverPage() {
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    if (activeIdx < 0) return false;
    return isCoverPage(activeIdx);
}

function getCompositionIssueMessage(issue) {
    const messages = {
        cover_requires_even_pages: '表紙あり構成では総ページ数を偶数にしてください。',
        cover_requires_two_or_more_pages: '表紙あり構成には最低2ページが必要です。',
        cover_disallows_three_pages: '表紙あり3ページ構成は使用できません。2ページ、または4ページ以上の偶数にしてください。',
        spread_image_requires_covers: '表紙なし構成では見開き画像ページを使用できません。',
        spread_image_requires_full_covers: '見開き画像ページは C1/C2/C3/C4 構成の見開き位置でのみ使用できます。',
        spread_image_requires_adjacent_pair: '見開き画像ページは隣接する2ページ単位で配置してください。',
        spread_image_cannot_include_cover: '見開き画像ページに C1/C4 外側表紙ページを含めることはできません。',
        spread_image_invalid_body_pair: '見開き画像ページは C2|1、2|3、最終ページ|C3 のような紙面上の隣接見開き位置にだけ挿入できます。'
    };
    return messages[issue] || issue;
}

function alertCompositionIssues(issues) {
    const unique = [...new Set(issues || [])];
    if (!unique.length) return;
    alert(unique.map(getCompositionIssueMessage).join('\n'));
}

function validateSpreadImageCompositionForSections(sections) {
    const issues = getBookCompositionIssues({
        pageCount: (sections || []).length,
        book: state.book || {},
        bookMode: state.bookMode || state.book?.mode || 'simple',
        sections
    }).filter((issue) => issue.startsWith('spread_image_'));
    if (!issues.length) return true;
    alertCompositionIssues(issues);
    return false;
}

function insertSpreadImageBeforeActive() {
    if (state.version === 6) {
        alert('Project v6での見開きページ追加は、混在スパイン対応後に利用できます。');
        return;
    }
    const activeIdx = Number.isInteger(state.activeIdx) ? state.activeIdx : -1;
    const insertAt = activeIdx >= 0 ? activeIdx : (state.sections || []).length;
    const decision = canInsertSpreadImageAt(insertAt, (state.sections || []).length, state.book || {}, state.bookMode || state.book?.mode || 'simple');
    if (!decision.ok) {
        alertCompositionIssues(decision.issues);
        return;
    }
    pushState();
    insertSpreadImageAt(insertAt, refresh);
    triggerAutoSave();
}
function addProjectPageAtTail(sectionType) {
    if (state.version !== 6) return false;
    const blocks = state.blocks || [];
    pushState();
    insertPageNearBlock(blocks.length ? blocks.length - 1 : -1, 'after', refresh, sectionType);
    triggerAutoSave();
    return true;
}
window.addSection = () => {
    if (addProjectPageAtTail('image')) return;
    pushState();
    addSection(refresh);
    triggerAutoSave();
};
window.addTextSection = () => {
    if (addProjectPageAtTail('text')) return;
    pushState();
    addTextSection(refresh);
    triggerAutoSave();
};
window.insertFlowGroupBeforeActive = () => {
    endHistoryGroup();
    pushState();
    const sourceLanguage = state.defaultLang || state.activeLang || state.languages?.[0] || 'ja';
    const writingMode = getWritingModeFromConfigs(sourceLanguage, state.languageConfigs);
    const group = createFlowGroupBlock({
        sourceLanguage,
        writingMode,
        document: {
            sourceLanguage,
            sections: [{
                title: { [sourceLanguage]: '新しいFlow原稿' },
                blocks: [
                    { type: 'heading', level: 1, texts: { [sourceLanguage]: '見出し' } },
                    { type: 'paragraph', texts: { [sourceLanguage]: '' } },
                ],
            }],
        },
    });
    const nextBlocks = [...(state.blocks || [])];
    const insertAt = Number.isInteger(state.activeBlockIdx)
        ? Math.max(0, Math.min(state.activeBlockIdx, nextBlocks.length))
        : nextBlocks.length;
    nextBlocks.splice(insertAt, 0, group);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'version', value: PROJECT_SCHEMA_VERSION } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: insertAt });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    invalidateFlowRuntimePages({ preserveSelection: true });
    selectFlowSource(group.id);
    refresh();
    triggerAutoSave();
};
window.insertSectionBeforeActive = () => insertSectionBeforeActiveByType('image');
window.insertTextSectionBeforeActive = () => insertSectionBeforeActiveByType('text');
window.insertSpreadImageBeforeActive = insertSpreadImageBeforeActive;
window.addSectionByType = (sectionType = 'image', e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    hideContextMenu();
    if (sectionType === 'text') {
        window.addTextSection();
        return;
    }
    if (sectionType === 'spread-image') {
        insertSpreadImageBeforeActive();
        return;
    }
    window.addSection();
};
window.showTailPageAddMenu = (e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const anchor = e?.currentTarget;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    showContextMenuAt(
        rect.left + rect.width - 220,
        rect.top - 8,
        `
            <div class="context-menu-item" onclick="addSectionByType('image', event)">
                <span class="material-icons">add_photo_alternate</span> ${t('btn_add_section')}
            </div>
            <div class="context-menu-item" onclick="addSectionByType('spread-image', event)">
                <span class="material-icons">view_week</span> ${t('btn_add_spread_image_section')}
            </div>
            <div class="context-menu-item" onclick="addSectionByType('text', event)">
                <span class="material-icons">article</span> ${t('btn_add_text_section')}
            </div>
        `
    );
};
window.updateTextSectionBody = updateTextSectionBody;
window.updatePageHeading = updatePageHeading;
window.jumpToTocPage = (pageIndex) => {
    changeSection(Number(pageIndex), refreshForThumbSelection);
};

/** テキストエリアのカーソル位置に改ページマーカーを挿入する */
window.insertPageBreak = function() {
    if (!canEditActiveFixedPage('text')) return;
    const ta = document.getElementById('prop-body-text');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    // 前後に改行を挿入（連続改ページを防ぐ）
    const before = start > 0 && val[start - 1] !== '\n' ? '\n' : '';
    const after  = end < val.length && val[end] !== '\n' ? '\n' : '';
    const marker = `${before}${PAGE_BREAK_MARKER}\n${after}`;
    const newVal = val.slice(0, start) + marker + val.slice(end);
    ta.value = newVal;
    const newCursor = start + marker.length;
    ta.setSelectionRange(newCursor, newCursor);
    ta.focus();
    updateTextSectionBody(newVal);
};

/** テキストエリアの選択範囲をルビ記法に変換する */
window.insertRubyMarkup = function() {
    if (!canEditActiveFixedPage('text')) return;
    const ta = document.getElementById('prop-body-text');
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const val = ta.value || '';
    const selected = val.slice(start, end);
    const baseText = selected || '漢字';
    const rubyText = 'かんじ';
    const markup = `{${baseText}|${rubyText}}`;
    const newVal = val.slice(0, start) + markup + val.slice(end);
    ta.value = newVal;

    const rubyStart = start + 1 + baseText.length + 1;
    const rubyEnd = rubyStart + rubyText.length;
    ta.focus();
    ta.setSelectionRange(rubyStart, rubyEnd);
    updateTextSectionBody(newVal);
};

// ── キャンバスへのドラッグ&ドロップ（画像アップロード） ──────────────────────
window.handleCanvasDragOver = (e) => {
    const s = getEditableActiveFixedSection('image');
    if (!s) return;
    // 画像ファイルを含むドラッグのみ受け付ける
    if ([...e.dataTransfer.types].some(t => t === 'Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.getElementById('canvas-view')?.classList.add('drag-over');
    }
};

window.handleCanvasDragLeave = (e) => {
    // canvas-view の外へ出たときのみ解除（子要素への移動は無視）
    if (!e.currentTarget.contains(e.relatedTarget)) {
        document.getElementById('canvas-view')?.classList.remove('drag-over');
    }
};

window.handleCanvasDrop = (e) => {
    e.preventDefault();
    document.getElementById('canvas-view')?.classList.remove('drag-over');
    const s = getEditableActiveFixedSection('image');
    if (!s) return;
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    // 既存の uploadToStorage に File を渡すため擬似 input を作成
    pushState();
    uploadToStorage({ files: [file] }, refresh);
    triggerAutoSave();
};
window.changeSection = (i) => {
    if (Date.now() < suppressThumbClickUntil) return;
    _spreadActivationPinnedAdjIdx = -1; // サムネ選択時はピンを解除
    changeSection(i, refreshForThumbSelection);
};

// ──────────────────────────────────────
//  ページナビゲーション（ストリップヘッダーボタン・キーボード）
// ──────────────────────────────────────

function isOuterCoverPage(pageIndex) {
    const total = (state.sections || []).length;
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    return coverKey === 'c1' || coverKey === 'c4';
}

function isCoverPage(pageIndex) {
    const total = (state.sections || []).length;
    return !!getPageCoverKey(pageIndex, state.book, state.bookMode, total);
}

function getReadablePageOrdinal(pageIndex) {
    const total = (state.sections || []).length;
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= total) return 0;
    let ordinal = 0;
    for (let i = 0; i <= idx; i += 1) {
        if (!isCoverPage(i)) ordinal += 1;
    }
    return ordinal;
}

function getPageLabelForIndex(pageIndex) {
    const total = (state.sections || []).length;
    return getPageDisplayLabel(pageIndex, total, state.book, state.bookMode);
}

function getActiveCompareLang() {
    const langs = Array.isArray(state.languages) ? state.languages : [];
    if (langs.length < 2) return '';
    const active = state.activeLang || state.defaultLang || langs[0];
    return langs.find((code) => code !== active) || '';
}

function getLangShortCode(code) {
    return String(code || '').toUpperCase();
}

function getSpreadAdjacentPageIndex(activeIdx) {
    const sections = state.sections || [];
    const total = sections.length;
    if (activeIdx < 0 || activeIdx >= total) return -1;
    if (isOuterCoverPage(activeIdx)) return -1;
    const pinned = _spreadActivationPinnedAdjIdx;
    if (pinned >= 0 && pinned !== activeIdx && !isOuterCoverPage(pinned)) return pinned;

    const coverKey = getPageCoverKey(activeIdx, state.book, state.bookMode, total);
    const mode = state.bookMode || state.book?.mode || 'simple';
    const readableOrdinal = getReadablePageOrdinal(activeIdx);
    let candidate;
    if (coverKey === 'c2') {
        candidate = activeIdx + 1;
    } else if (coverKey === 'c3') {
        candidate = activeIdx - 1;
    } else if (mode === 'full') {
        candidate = readableOrdinal % 2 === 1 ? activeIdx - 1 : activeIdx + 1;
    } else {
        candidate = readableOrdinal % 2 === 1 ? activeIdx + 1 : activeIdx - 1;
    }
    if (candidate < 0 || candidate >= total) return -1;
    if (isOuterCoverPage(candidate)) return -1;
    return candidate;
}

function getSpreadAdjacentPageIndexForRole(pageIndex) {
    const sections = state.sections || [];
    const total = sections.length;
    if (pageIndex < 0 || pageIndex >= total) return -1;
    if (isOuterCoverPage(pageIndex)) return -1;

    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    const mode = state.bookMode || state.book?.mode || 'simple';
    const readableOrdinal = getReadablePageOrdinal(pageIndex);
    let candidate;
    if (coverKey === 'c2') {
        candidate = pageIndex + 1;
    } else if (coverKey === 'c3') {
        candidate = pageIndex - 1;
    } else if (mode === 'full') {
        candidate = readableOrdinal % 2 === 1 ? pageIndex - 1 : pageIndex + 1;
    } else {
        candidate = readableOrdinal % 2 === 1 ? pageIndex + 1 : pageIndex - 1;
    }
    if (candidate < 0 || candidate >= total) return -1;
    if (isOuterCoverPage(candidate)) return -1;
    return candidate;
}

function getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir) {
    const activeFirst = pageDir === 'rtl'
        ? activeIdx >= adjIdx
        : activeIdx <= adjIdx;
    return activeFirst ? [activeIdx, adjIdx] : [adjIdx, activeIdx];
}

function getPageSliderBubbleText() {
    const activeIdx = state.activeIdx ?? 0;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    if (compareLang) {
        const label = getPageLabelForIndex(activeIdx);
        return `${getLangShortCode(state.activeLang)} ${label} | ${label} ${getLangShortCode(compareLang)}`;
    }

    const adjIdx = getSpreadAdjacentPageIndex(activeIdx);
    if (adjIdx >= 0) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const pageDir = getEditorLangDirection(lang);
        const [leftIdx, rightIdx] = getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir);
        return `${getPageLabelForIndex(leftIdx)} | ${getPageLabelForIndex(rightIdx)}`;
    }
    return getPageLabelForIndex(activeIdx);
}

function getPageSliderBubbleParts() {
    const activeIdx = state.activeIdx ?? 0;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    if (compareLang) {
        const label = getPageLabelForIndex(activeIdx);
        return {
            left: `${getLangShortCode(state.activeLang)} ${label}`,
            right: `${label} ${getLangShortCode(compareLang)}`,
            activeSide: 'left'
        };
    }

    const adjIdx = getSpreadAdjacentPageIndex(activeIdx);
    if (adjIdx >= 0) {
        const lang = state.activeLang || state.defaultLang || 'ja';
        const pageDir = getEditorLangDirection(lang);
        const [leftIdx, rightIdx] = getVisualSpreadPageIndices(activeIdx, adjIdx, pageDir);
        return {
            left: getPageLabelForIndex(leftIdx),
            right: getPageLabelForIndex(rightIdx),
            activeSide: leftIdx === activeIdx ? 'left' : 'right'
        };
    }
    return null;
}

function syncPageNavigationSlider() {
    const presentation = getEditorPresentationState();
    const total = presentation.total;
    const activeIdx = presentation.activeIndex;
    const slider = document.getElementById('page-nav-slider');
    const bubble = document.getElementById('page-nav-slider-bubble');
    const totalEl = document.getElementById('page-nav-slider-total');
    const compareBtn = document.getElementById('btn-language-compare-view');
    const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const isRtl = pageDirection === 'rtl';
    const ratio = total > 1 ? activeIdx / (total - 1) : 0;
    const visualRatio = isRtl ? 1 - ratio : ratio;
    const pct = ratio * 100;

    if (slider) {
        slider.max = String(Math.max(0, total - 1));
        slider.value = String(activeIdx);
        slider.disabled = total <= 1;
        slider.style.setProperty('--page-slider-progress', `${pct}%`);
        slider.dir = isRtl ? 'rtl' : 'ltr';
        slider.dataset.dir = pageDirection;
    }
    if (bubble) {
        const parts = presentation.projection ? null : getPageSliderBubbleParts();
        if (parts) {
            bubble.classList.add('is-pair');
            bubble.classList.toggle('active-left', parts.activeSide === 'left');
            bubble.classList.toggle('active-right', parts.activeSide === 'right');
            bubble.innerHTML = `<span class="page-nav-bubble-left">${escapeStudioHtml(parts.left)}</span><span class="page-nav-bubble-divider">|</span><span class="page-nav-bubble-right">${escapeStudioHtml(parts.right)}</span>`;
        } else {
            bubble.classList.remove('is-pair');
            bubble.classList.remove('active-left', 'active-right');
            bubble.textContent = presentation.label || getPageSliderBubbleText();
        }
        const width = slider?.clientWidth || bubble.parentElement?.clientWidth || 0;
        const thumb = 16;
        const x = width > thumb ? (thumb / 2) + (width - thumb) * visualRatio : 0;
        bubble.style.left = `${x}px`;
    }
    if (totalEl) {
        totalEl.textContent = String(getReadablePageCount(total, state.book, state.bookMode) || total);
    }
    if (compareBtn) {
        const enabled = !!state.uiPrefs?.languageCompareView && !!getActiveCompareLang();
        compareBtn.classList.toggle('active', enabled);
        compareBtn.disabled = hasFlowGroups(state)
            || !Array.isArray(state.languages)
            || state.languages.length < 2;
    }
    const spreadBtn = document.getElementById('btn-spread-view');
    if (spreadBtn) spreadBtn.disabled = hasFlowGroups(state);
}

window.onPageSliderInput = (value) => {
    const nextIdx = Number(value);
    const projection = getEditorPageProjection();
    if (projection) {
        if (!Number.isInteger(nextIdx) || nextIdx < 0 || nextIdx >= projection.pages.length) return;
        _spreadActivationPinnedAdjIdx = -1;
        activateProjectionPage(projection.pages[nextIdx]);
        return;
    }
    const sections = state.sections || [];
    if (!Number.isInteger(nextIdx) || nextIdx < 0 || nextIdx >= sections.length) return;
    _spreadActivationPinnedAdjIdx = -1;
    changeSection(nextIdx, refreshForThumbSelection);
};

window.pagePrev = () => {
    _spreadActivationPinnedAdjIdx = -1; // 通常ナビ時はピンを解除
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index > 0) activateProjectionPage(projection.pages[index - 1]);
        return;
    }
    const idx = state.activeIdx ?? 0;
    if (idx > 0) changeSection(idx - 1, refreshForThumbSelection);
};

window.pageNext = () => {
    _spreadActivationPinnedAdjIdx = -1; // 通常ナビ時はピンを解除
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index >= 0 && index < projection.pages.length - 1) {
            activateProjectionPage(projection.pages[index + 1]);
        }
        return;
    }
    const idx = state.activeIdx ?? 0;
    if (idx < (state.sections || []).length - 1) changeSection(idx + 1, refreshForThumbSelection);
};

window.pageVisualLeft = () => movePageSelectionByVisualDirection('left');
window.pageVisualRight = () => movePageSelectionByVisualDirection('right');

function movePageSelectionByVisualDirection(direction) {
    const projection = getEditorPageProjection();
    if (projection) {
        const index = getActiveProjectionPageIndex(projection);
        if (index < 0) return;
        const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
        const delta = direction === 'right'
            ? (pageDirection === 'rtl' ? -1 : 1)
            : (pageDirection === 'rtl' ? 1 : -1);
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= projection.pages.length) return;
        _spreadActivationPinnedAdjIdx = -1;
        activateProjectionPage(projection.pages[nextIndex]);
        return;
    }
    const idx = state.activeIdx ?? 0;
    const pages = state.sections || [];
    if (!pages.length) return;
    const pageDirection = getEditorLangDirection(state.activeLang || state.defaultLang || 'ja');
    const delta = direction === 'right'
        ? (pageDirection === 'rtl' ? -1 : 1)
        : (pageDirection === 'rtl' ? 1 : -1);
    const pair = getSpreadPairIndices(idx);
    const nextIdx = pair.length > 1
        ? (delta > 0 ? pair[pair.length - 1] + 1 : pair[0] - 1)
        : idx + delta;
    if (nextIdx < 0 || nextIdx >= pages.length) return;
    _spreadActivationPinnedAdjIdx = -1;
    changeSection(nextIdx, refreshForThumbSelection);
}

// ──────────────────────────────────────
//  見開き表示 (Spread View)
// ──────────────────────────────────────

window.toggleSpreadView = () => {
    if (hasFlowGroups(state)) return;
    const current = state.uiPrefs?.spreadView || false;
    const next = !current;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'uiPrefs', value: { ...(state.uiPrefs || {}), spreadView: next, languageCompareView: next ? false : !!state.uiPrefs?.languageCompareView }
    }});
    // デスクトップ・モバイル両方のボタンを同期
    document.getElementById('btn-spread-view')?.classList.toggle('active', next);
    document.getElementById('btn-spread-view-mobile')?.classList.toggle('active', next);
    document.getElementById('btn-language-compare-view')?.classList.remove('active');
    // キャンバスサイズ再計算 → 見開きページ表示/非表示を更新
    fitCanvasView();
    refreshSpreadPage();
    syncPageNavigationSlider();
};

window.toggleLanguageCompareView = () => {
    if (hasFlowGroups(state)) return;
    if (!getActiveCompareLang()) return;
    const current = !!state.uiPrefs?.languageCompareView;
    const next = !current;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: {
        key: 'uiPrefs', value: { ...(state.uiPrefs || {}), languageCompareView: next, spreadView: next ? false : !!state.uiPrefs?.spreadView }
    }});
    document.getElementById('btn-language-compare-view')?.classList.toggle('active', next);
    document.getElementById('btn-spread-view')?.classList.remove('active');
    document.getElementById('btn-spread-view-mobile')?.classList.remove('active');
    fitCanvasView();
    refreshSpreadPage();
    syncPageNavigationSlider();
    triggerAutoSave();
};

/**
 * 見開きページ（隣接ページ）を描画・更新する
 */
/**
 * テキストセクションの組版 HTML を任意のコンテナへ描画する
 * renderTextPreview と同じロジックだが DOM id に依存せず要素を受け取る。
 */
function _renderTextIntoSpread(section, lang, outerEl, frameEl, contentEl) {
    const writingMode  = getWritingModeFromConfigs(lang, state.languageConfigs);
    const fontPreset   = getFontPresetFromConfigs(lang, state.languageConfigs);
    const raw          = section.texts?.[lang] ?? '';

    let rubyTokens, hasRuby, plainText, rubyLines;
    try {
        rubyTokens = parseRubyTokens(raw);
        hasRuby    = rubyTokens.some(t => t.kind === 'ruby');
        plainText  = hasRuby ? tokensToPlainText(rubyTokens) : raw;
    } catch (_) {
        rubyTokens = []; hasRuby = false; plainText = raw;
    }

    const composed = composeText(plainText, lang, writingMode, fontPreset);
    const textAlign = _getTextSectionAlign(section);
    try { rubyLines = hasRuby ? alignRubyToLines(rubyTokens, composed.lines) : null; }
    catch (_) { rubyLines = null; }

    const paperStyle = _getTextPaperStyle(_getTextPaperPresetKey(section));
    outerEl.style.backgroundColor = paperStyle.backgroundColor;

    const { x, y, w, h } = composed.frame;
    frameEl.style.cssText = [
        `position:absolute`,
        `left:${x}px`, `top:${y}px`,
        `width:${w}px`, `height:${h}px`,
        `font-family:${composed.font.family}`,
        `font-size:${composed.font.size}px`,
        `color:${paperStyle.textColor}`,
        `letter-spacing:${composed.font.letterSpacing ? composed.font.letterSpacing + 'px' : '0'}`,
    ].join(';');
    frameEl.setAttribute('lang', lang.toLowerCase());

    if (!raw) { contentEl.innerHTML = ''; return; }

    if (composed.writingMode === 'vertical-rl') {
        const maxCols      = composed.rules?.maxLines    || 12;
        const charsPerCol  = composed.rules?.charsPerLine || 33;
        const fontSize     = composed.font.size;
        const colW         = Math.floor(w / maxCols);
        const lineHeight   = (colW / fontSize).toFixed(3);
        const letterSpacing = ((h / charsPerCol) - fontSize).toFixed(3);
        const charPitch    = h / charsPerCol;
        const rubyFontSize = Math.round(fontSize * 0.5);
        const rubyColW     = Math.round(fontSize * 0.65);
        const charRightOffset = Math.round((colW - fontSize) / 2);
        const verticalJustify = _getVerticalBlockJustifyCss(section);
        const usedCols = composed.lines.length;
        const groupW = usedCols * colW;
        const blockOffsetX = _getVerticalBlockOffsetPx(section, w, usedCols, colW);

        const cols = composed.lines.map((line, i) => {
            const content = rubyLines
                ? _baseTextFromTokenLine(rubyLines[i])
                : _markupVerticalLine(line);
            return `<span class="tpv-col"` +
                ` style="width:${colW}px;line-height:${lineHeight};letter-spacing:${letterSpacing}px"` +
                `>${content}</span>`;
        }).join('');

        let rubyOverlay = '';
        if (rubyLines) {
            const anns = [];
            for (let i = 0; i < rubyLines.length; i++) {
                let charOffset = 0;
                for (const tok of rubyLines[i]) {
                    const baseLen = tok.kind === 'ruby'
                        ? Array.from(tok.base || '').length
                        : Array.from(tok.text || '').length;
                    if (tok.kind === 'ruby' && tok.ruby) {
                        const annLeft = groupW - i * colW - charRightOffset;
                        const rubyLen = Array.from(tok.ruby).length;
                        const rubyH   = Math.round(rubyLen * rubyFontSize * 1.2);
                        const baseH   = Math.round(baseLen * charPitch);
                        const annTop  = Math.round(charOffset * charPitch + Math.max(0, (baseH - rubyH) / 2));
                        anns.push(
                            `<span class="tpv-ruby-ann"` +
                            ` style="left:${Math.round(blockOffsetX + annLeft)}px;top:${annTop}px;` +
                            `width:${rubyColW}px;font-size:${rubyFontSize}px"` +
                            `>${_escHtml(_verticalGlyphText(tok.ruby))}</span>`
                        );
                    }
                    charOffset += baseLen;
                }
            }
            if (anns.length) rubyOverlay = `<div class="tpv-ruby-overlay">${anns.join('')}</div>`;
        }
        contentEl.innerHTML = `<div class="tpv-vertical" style="justify-content:${verticalJustify}">${cols}</div>${rubyOverlay}`;
    } else {
        const lineH = h / (composed.rules?.maxLines || 20);
        const offsetY = _getHorizontalTextOffsetY(composed);
        const horizontalJustify = _getHorizontalBlockJustifyCss(section);
        let html;
        if (rubyLines) {
            html = rubyLines.map((tokenLine, idx) =>
                !composed.lines[idx]
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<div class="tpv-line">${tokenLine.map(tok =>
                        tok.kind === 'ruby'
                            ? `<ruby>${_markupTcyText(tok.base)}<rt>${_escHtml(tok.ruby || '')}</rt></ruby>`
                            : _escHtml(tok.text || '')
                      ).join('')}</div>`
            ).join('');
        } else {
            html = (composed.lines || []).map(line =>
                !line
                    ? `<div class="tpv-blank" style="height:${lineH}px"></div>`
                    : `<div class="tpv-line">${_escHtml(line)}</div>`
            ).join('');
        }
        contentEl.innerHTML =
            `<div class="tpv-horizontal" lang="${lang.toLowerCase()}" style="line-height:${lineH}px;transform:translateY(${offsetY}px);justify-content:${horizontalJustify}"><div class="tpv-horizontal-block">${html}</div></div>`;
    }
}

function refreshSpreadPage() {
    const isSpread = state.uiPrefs?.spreadView || false;
    const compareLang = state.uiPrefs?.languageCompareView ? getActiveCompareLang() : '';
    const isLanguageCompare = !!compareLang;
    const spreadEl = document.getElementById('canvas-spread-page');
    const stage    = document.getElementById('canvas-stage');
    if (!spreadEl || !stage) return;
    if (hasFlowGroups(state)) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        stage.classList.remove('spread-image-pair-active');
        document.getElementById('canvas-transform-layer')?.classList.remove('active-pair-page');
        return;
    }

    // スプレッドボタンのアクティブ状態を同期
    const btn = document.getElementById('btn-spread-view');
    if (btn) btn.classList.toggle('active', isSpread);

    // 見出し入力はアクティブページ上端の外側に出すため、ページレイヤー自体は clip しない。
    const transformLayer = document.getElementById('canvas-transform-layer');
    if (transformLayer) {
        transformLayer.style.overflow = 'visible';
        transformLayer.classList.toggle('active-pair-page', isSpread || isLanguageCompare);
    }
    stage.classList.remove('spread-image-pair-active');
    spreadEl.classList.remove('spread-image-pair-active');

    if (!isSpread && !isLanguageCompare) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        if (transformLayer) transformLayer.classList.remove('active-pair-page');
        return;
    }

    const lang    = state.activeLang || state.defaultLang || 'ja';
    // languageConfigs に保存された pageDirection を参照（'rtl' | 'ltr'）
    const pageDir = state.languageConfigs?.[lang]?.pageDirection || (lang === 'ja' ? 'rtl' : 'ltr');
    const isRTL   = pageDir === 'rtl';

    const sections  = state.sections || [];
    const activeIdx = state.activeIdx ?? 0;
    const total     = sections.length;
    const adjIdx = isLanguageCompare ? activeIdx : getSpreadAdjacentPageIndex(activeIdx);
    const renderLang = isLanguageCompare ? compareLang : lang;

    if (adjIdx < 0 || adjIdx >= total) {
        spreadEl.style.display = 'none';
        stage.style.flexDirection = '';
        return;
    }

    // flex 方向: ページ番号（インデックス）が小さい方を右（RTL）または左（LTR）に固定する。
    // #canvas-transform-layer（アクティブ）が常に低インデックス側とは限らないため、
    // activeIdx と adjIdx の大小で flex-direction を決定する。
    //   RTL: 低インデックス → 右 (transform-layer が右) → activeIdx < adjIdx なら row-reverse, それ以外は row
    //   LTR: 低インデックス → 左 (transform-layer が左) → activeIdx < adjIdx なら row, それ以外は row-reverse
    if (isLanguageCompare) {
        stage.style.flexDirection = 'row';
    } else if (isRTL) {
        stage.style.flexDirection = activeIdx < adjIdx ? 'row-reverse' : 'row';
    } else {
        stage.style.flexDirection = activeIdx < adjIdx ? 'row' : 'row-reverse';
    }

    spreadEl.style.display = 'block';
    spreadEl.dataset.adjIdx = adjIdx;

    const adjSection = sections[adjIdx];
    const activeSection = sections[activeIdx];
    const sharedSpreadGroup = !isLanguageCompare
        && activeSection?.spreadImage?.groupId
        && activeSection.spreadImage.groupId === adjSection?.spreadImage?.groupId;
    stage.classList.toggle('spread-image-pair-active', !!sharedSpreadGroup);
    spreadEl.classList.toggle('spread-image-pair-active', !!sharedSpreadGroup);

    // ページ番号ラベル
    const labelEl = document.getElementById('canvas-spread-label');
    if (labelEl) {
        const adjLabel = getPageDisplayLabel(adjIdx, total, state.book, state.bookMode);
        labelEl.textContent = `${adjLabel} ${renderLang.toUpperCase()}`;
    }

    // ── 隣ページのコンテンツを描画 ──────────────────────────────
    const contentEl = document.getElementById('canvas-spread-content');
    if (!contentEl) return;

    if (adjSection.type === 'text') {
        // テキストページ: renderTextPreview と同じロジックで描画
        contentEl.innerHTML = '';
        contentEl.style.backgroundImage = '';
        contentEl.style.backgroundColor = '';
        contentEl.style.position = 'relative';
        contentEl.style.width  = '100%';
        contentEl.style.height = '100%';
        contentEl.style.overflow = 'hidden';

        // フレーム要素を確保（初回は作成）
        let spFrame = contentEl.querySelector('.spread-text-frame');
        let spContent = contentEl.querySelector('.spread-text-content');
        if (!spFrame) {
            spFrame   = document.createElement('div');
            spFrame.className = 'spread-text-frame';
            spContent = document.createElement('div');
            spContent.className = 'spread-text-content';
            spFrame.appendChild(spContent);
            contentEl.appendChild(spFrame);
        }
        contentEl.style.backgroundColor = _getTextPaperStyle(_getTextPaperPresetKey(adjSection)).backgroundColor;
        _renderTextIntoSpread(adjSection, renderLang, contentEl, spFrame, spContent);
    } else {
        // 画像ページ: メインキャンバスと同じ位置・トリミングで描画
        contentEl.innerHTML = '';
        contentEl.style.backgroundImage = '';
        contentEl.style.position = 'relative';
        contentEl.style.width  = '100%';
        contentEl.style.height = '100%';
        contentEl.style.overflow = 'hidden';
        contentEl.style.backgroundColor = adjSection.backgroundColor || '#fff';

        const bgUrl = getOptimizedImageUrl(
            adjSection.backgrounds?.[renderLang] || adjSection.backgrounds?.[state.defaultLang] || adjSection.background || ''
        );

        if (!bgUrl) {
            // 画像未設定: プレースホルダー
            contentEl.innerHTML =
                `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#aaa;">
                    <span class="material-icons" style="font-size:48px;">add_photo_alternate</span>
                </div>`;
        } else {
            // 言語別位置 → 共通位置 → レガシー → デフォルトの優先順で取得（main canvas と同じロジック）
            const pos = adjSection.imagePositions?.[renderLang]
                || adjSection.imagePositions?.[state.defaultLang]
                || adjSection.imageBasePosition
                || adjSection.imagePosition
                || { x: 0, y: 0, scale: 1, rotation: 0, flipX: false };
            const cached = editorImageAspectCache.get(bgUrl);

            const _renderSpreadImg = () => {
                const { frameMetrics, targetTransform } = getImageAdjustRenderMetrics(bgUrl, pos, getSpreadImageRenderOptions(adjSection, adjIdx));
                // 画像レイヤー（メインキャンバスと同じ transform）
                const imgEl = document.createElement('img');
                imgEl.src = bgUrl;
                imgEl.style.cssText = [
                    'position:absolute',
                    'top:50%', 'left:50%',
                    `width:${frameMetrics.widthPercent}%`,
                    `height:${frameMetrics.heightPercent}%`,
                    `transform:${targetTransform}`,
                    'transform-origin:center center',
                    'pointer-events:none',
                ].join(';');
                contentEl.appendChild(imgEl);

                // 吹き出しレイヤー
                const bubbles = adjSection.bubbles || [];
                if (bubbles.length > 0) {
                    const langProps = getLangProps(renderLang);
                    const bLayer = document.createElement('div');
                    bLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
                    bLayer.innerHTML = bubbles.map((b, i) =>
                        renderBubbleHTML(b, i, false, langProps.defaultWritingMode || 'horizontal-tb')
                    ).join('');
                    contentEl.appendChild(bLayer);
                }
            };

            if (cached) {
                // アスペクト比がキャッシュ済み → 即座に描画
                _renderSpreadImg();
            } else {
                // アスペクト比未キャッシュ → object-fit:cover で仮表示し、ロード後に再描画
                const tmpImg = document.createElement('img');
                tmpImg.src = bgUrl;
                tmpImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                contentEl.appendChild(tmpImg);
                const loader = new Image();
                loader.onload = () => {
                    if (loader.naturalWidth && loader.naturalHeight) {
                        editorImageAspectCache.set(bgUrl, loader.naturalWidth / loader.naturalHeight);
                    }
                    // キャッシュが埋まったら正確な位置で再描画
                    if ((state.uiPrefs?.spreadView) &&
                        document.getElementById('canvas-spread-content') === contentEl) {
                        contentEl.innerHTML = '';
                        contentEl.style.backgroundColor = adjSection.backgroundColor || '#fff';
                        _renderSpreadImg();
                    }
                };
                loader.src = bgUrl;
            }
        }
    }
}

/**
 * 見開きの隣ページをクリック → そのページをアクティブにして編集可能にする。
 * 見開きに表示されている 2 ページは変わらない（ページ送りなし）。
 */
window.spreadPageActivate = (e) => {
    if (e) e.stopPropagation();
    const spreadEl = document.getElementById('canvas-spread-page');
    if (!spreadEl) return;
    const adjIdx = parseInt(spreadEl.dataset.adjIdx, 10);
    if (!Number.isInteger(adjIdx) || adjIdx < 0) return;

    // 現在のアクティブページを「次の隣ページ」としてピン留めする。
    // refreshSpreadPage はこの値を参照して表示を維持する。
    _spreadActivationPinnedAdjIdx = state.activeIdx ?? 0;
    changeSection(adjIdx, refreshForThumbSelection);
    // changeSection → refresh → refreshSpreadPage が同期的に完了した後にリセット
    _spreadActivationPinnedAdjIdx = -1;
};

// ──────────────────────────────────────
//  キーボードナビゲーション（エディター）
// ──────────────────────────────────────

document.addEventListener('keydown', (e) => {
    // テキスト入力中・モーダル表示中はスキップ
    const tag = document.activeElement?.tagName || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.getAttribute('contenteditable') === 'true') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (getCurrentRoom() !== 'editor') return;
    // ページストリップが折りたたまれていてもナビは有効にする
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 画像調整モード中は矢印キーを使わない
        if (document.getElementById('canvas-transform-layer')?.classList.contains('adjust-image-mode')) return;
        e.preventDefault();
        movePageSelectionByVisualDirection(e.key === 'ArrowRight' ? 'right' : 'left');
    }
});
window.changeBlock = (idx) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeBlock(idx, refreshForThumbSelection);
};
window.changeFlowSourceBlock = (blockIndex) => {
    if (Date.now() < suppressThumbClickUntil) return;
    const block = state.blocks?.[Number(blockIndex)];
    if (block?.kind !== 'flow') return;
    endHistoryGroup();
    selectFlowSource(block.id);
    changeBlock(blockIndex, refresh);
};
window.changeFlowGeneratedPage = (blockIndex, flowPageIndex) => {
    if (Date.now() < suppressThumbClickUntil) return;
    const block = state.blocks?.[Number(blockIndex)];
    if (block?.kind !== 'flow') return;
    const projection = getEditorPageProjection();
    const pageCount = projection?.pages?.filter((page) => (
        page.kind === 'flow' && page.groupId === block.id
    )).length || 1;
    endHistoryGroup();
    selectFlowGeneratedPage(block.id);
    setSelectedFlowRuntimePageIndex(block.id, flowPageIndex, pageCount);
    changeBlock(blockIndex, refreshForThumbSelection);
};
window.insertSectionAtIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.version === 6) {
        alert('Project v6ではページ上の＋ボタンを使って挿入位置を指定してください。');
        return;
    }
    const insertAt = Math.max(0, Math.min(Number(idx) || 0, (state.sections || []).length));
    const simulated = [...(state.sections || [])];
    simulated.splice(insertAt, 0, { type: 'image' });
    if (!validateSpreadImageCompositionForSections(simulated)) return;
    pushState();
    insertSectionAt(insertAt, refresh);
    triggerAutoSave();
};
window.duplicateSectionByIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.version === 6) return;
    pushState();
    duplicateSectionAt(idx, refresh);
    triggerAutoSave();
};
window.insertPageNearBlock = (blockIdx, position, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    insertPageNearBlock(blockIdx, position, refresh);
    triggerAutoSave();
};
window.duplicateBlockByIndex = (blockIdx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (state.blocks?.[blockIdx]?.kind === 'flow') return;
    pushState();
    duplicateBlockAt(blockIdx, refresh);
    triggerAutoSave();
};
window.moveBlockByIndex = (blockIdx, direction, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    const moved = moveBlockAt(blockIdx, direction, refresh);
    if (moved) triggerAutoSave();
};
window.startThumbDrag = (e, idx) => {
    thumbDragSourceIdx = idx;
    addThumbClassToSpreadPair(idx, 'drag-source');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    }
};
window.onThumbDragOver = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
    markThumbDropHint(idx, position);
};
window.onThumbDragLeave = () => {
    // no-op; keep hint until a new target is selected
};
window.onThumbDrop = (e, idx) => {
    if (!Number.isInteger(thumbDragSourceIdx)) return;
    e.preventDefault();
    const el = getThumbElement(idx);
    if (!el) return;
    const position = getDropPositionByPoint(el, e.clientX, e.clientY);
    moveSectionWithHistory(thumbDragSourceIdx, idx, position);
    suppressThumbClickUntil = Date.now() + 250;
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.endThumbDrag = () => {
    thumbDragSourceIdx = null;
    clearThumbDropHints();
};
window.startThumbTouchDrag = (e, idx) => {
    if (e.touches?.length !== 1) return;
    const touch = e.touches[0];
    thumbDragSourceIdx = idx;
    clearThumbDeleteDropzone();
    clearThumbDropHints();
    thumbTouchState = {
        sourceIndex: idx,
        mode: null,
        targetIndex: null,
        insertIndex: null,
        position: 'after',
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        lastX: touch.clientX,
        lastY: touch.clientY
    };
    bindTouchDragListeners();
};
function deleteActiveFlowGroup(activeBlock) {
    if (activeBlock?.kind !== 'flow' || !isFlowSourceSelected(activeBlock.id)) return false;
    if (!window.confirm(t('confirm_delete_flow'))) return false;

    const removedIndex = state.activeBlockIdx;
    const nextBlocks = applyFlowAuthoringOperation(state.blocks || [], {
        type: 'removeGroup',
        groupId: activeBlock.id,
    });
    const nextBlockIndex = nextBlocks.length
        ? Math.max(0, Math.min(removedIndex, nextBlocks.length - 1))
        : 0;
    const nextBlock = nextBlocks[nextBlockIndex] || null;
    const nextPageIndex = nextBlock
        ? Math.max(0, getPageIndexFromBlockIndex(nextBlocks, nextBlockIndex))
        : 0;

    endHistoryGroup();
    pushState();
    resetFlowRuntimeAfterGroupRemoval(activeBlock.id);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: nextBlockIndex });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: nextPageIndex });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    if (nextBlock?.kind === 'flow') selectFlowSource(nextBlock.id);
    refresh();
    triggerAutoSave();
    return true;
}

window.deleteActive = () => {
    const activeBlock = state.blocks?.[state.activeBlockIdx];
    if (activeBlock?.kind === 'flow') {
        deleteActiveFlowGroup(activeBlock);
        return;
    }
    pushState();
    deleteActive(refresh);
    triggerAutoSave();
};
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.changeBubbleShapeFromMenu = (idx, shapeName) => {
    const s = getEditableActiveFixedSection();
    if (s?.bubbles?.[idx]) {
        pushState();
        s.bubbles[idx].shape = shapeName;
        refresh();
        triggerAutoSave();
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }
};
window.updateTitle = (v) => {
    const lang = state.activeLang || state.defaultLang || 'ja';
    const defaultLang = state.defaultLang || lang;
    const nextMeta = {
        ...(state.meta || {}),
        [lang]: {
            ...(state.meta?.[lang] || {}),
            title: v || ''
        }
    };
    const representativeTitle = nextMeta?.[defaultLang]?.title || v || '';
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: nextMeta } });
    dispatch({ type: actionTypes.SET_TITLE, payload: representativeTitle });
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) headerGuideTitle.textContent = v || 'タイトル未設定';
    triggerAutoSave();
};
window.setThumbColumns = (cols) => {
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.setThumbSize = (sizeKey) => {
    const cols = MOBILE_THUMB_SIZE_MAP[sizeKey] || 2;
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.uploadToStorage = (input) => {
    if (!canEditActiveFixedPage()) {
        if (input) input.value = '';
        return;
    }
    pushState();
    uploadToStorage(input, refresh);
};

window.performUndo = performProjectUndo;
window.performRedo = performProjectRedo;

// FAB用
window.addBubbleFab = () => {
    if (!canEditActiveFixedPage()) return;
    pushState();
    addBubbleAtCenter(refresh);
    triggerAutoSave();
};

// バブル移動ハンドル用
window.onHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startDrag(e, i, refresh);
};

// しっぽ移動ハンドル用
window.onTailHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startTailDrag(e, i, refresh);
};

// ウニ・スパイク長ハンドル用
window.onSpikeHandleDown = (e, i) => {
    if (!canEditActiveFixedPage()) return;
    startSpikeDrag(e, i, refresh);
};

// ズーム・パン機能
let canvasScale = 1;
let canvasTranslate = { x: 0, y: 0 };

const CANVAS_ZOOM_PRESETS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 300, 400];

function syncCanvasZoomUI() {
    const select = document.getElementById('canvas-zoom-select');
    const percent = Math.round(canvasScale * 100);
    if (select) {
        const custom = select.querySelector('option[value="custom"]');
        if (CANVAS_ZOOM_PRESETS.includes(percent)) {
            if (custom) custom.hidden = true;
            select.value = String(percent);
        } else if (custom) {
            custom.hidden = false;
            custom.textContent = `${percent}%`;
            select.value = 'custom';
        }
    }

    const mobileRange = document.getElementById('mobile-canvas-zoom-range');
    if (mobileRange) {
        mobileRange.value = String(Math.min(Math.max(percent, 25), 300));
    }
    const mobileValue = document.getElementById('mobile-canvas-zoom-value');
    if (mobileValue) {
        mobileValue.textContent = `${percent}%`;
    }
}

window.setCanvasZoomPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    canvasScale = Math.min(Math.max(num / 100, 0.1), 5);
    updateCanvasTransform();
};

window.fitCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };

    const container = document.getElementById('canvas-view');
    if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const activeIdx = state.activeIdx ?? 0;
        const isSpreadPair = !!state.uiPrefs?.spreadView && getSpreadAdjacentPageIndex(activeIdx) >= 0;
        const isLanguageCompare = !!state.uiPrefs?.languageCompareView && !!getActiveCompareLang();
        const targetW = (isSpreadPair || isLanguageCompare) ? CANONICAL_PAGE_WIDTH * 2 : CANONICAL_PAGE_WIDTH;
        const targetH = CANONICAL_PAGE_HEIGHT;

        let s = Math.min(cw / targetW, ch / targetH) * 0.9;
        if (s > 1.2) s = 1.0;
        canvasScale = s;
    } else {
        canvasScale = 1;
    }

    updateCanvasTransform();
};

function updateCanvasTransform() {
    // #canvas-stage を transform する（旧: #canvas-transform-layer）
    const stage = document.getElementById('canvas-stage');
    if (stage) {
        stage.style.transform = `translate(-50%, -50%) translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasScale})`;
    }
    syncCanvasZoomUI();
}

// キャンバスリセット（中央寄せ・初期サイズ）
window.resetCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };
    updateCanvasTransform();
};

function initCanvasZoom() {
    const view = document.getElementById('canvas-view');
    if (!view) return;

    // 初期化時にリセット（flex レイアウト確定後に実行）
    requestAnimationFrame(() => fitCanvasView());

    // #canvas-view のサイズ変化（ページストリップ開閉・パネル開閉・ウィンドウリサイズ等）
    // に対して自動的にキャンバススケールを再計算する
    if (typeof ResizeObserver !== 'undefined') {
        let _fitRaf = null;
        const ro = new ResizeObserver(() => {
            if (_fitRaf) cancelAnimationFrame(_fitRaf);
            _fitRaf = requestAnimationFrame(() => { fitCanvasView(); _fitRaf = null; });
        });
        ro.observe(view);
    }

    // Pan handling
    let isPanning = false;
    let startPan = { x: 0, y: 0 };
    let startTranslate = { x: 0, y: 0 };

    const onPanMove = (e) => {
        const dx = e.clientX - startPan.x;
        const dy = e.clientY - startPan.y;
        canvasTranslate.x = startTranslate.x + dx;
        canvasTranslate.y = startTranslate.y + dy;
        updateCanvasTransform();
    };

    const onPanEnd = () => {
        isPanning = false;
        view.style.cursor = 'default';
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanEnd);
    };

    view.addEventListener('mousedown', (e) => {
        // 画像調整中はCanvas全体のパンを無効化
        if (isImageAdjusting) return;

        // バブルやテキストレイヤー以外ならPan開始
        if (e.target.id === 'canvas-view'
            || e.target.id === 'content-render'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            startTranslate = { ...canvasTranslate };
            view.style.cursor = 'grabbing';
            window.addEventListener('mousemove', onPanMove);
            window.addEventListener('mouseup', onPanEnd);
        }
    });

    // Touch Pan & Pinch (Simplified)
    // Hammer.js or similar recommended for robust pinch, but implementing basic logic here
    // For now, support single touch pan (if not on bubble)
    view.addEventListener('touchstart', (e) => {
        // 画像調整中はCanvasパン無効
        if (isImageAdjusting) return;

        if (e.touches.length === 1 && (
            e.target.id === 'canvas-view'
            || e.target.id === 'main-richtext-area'
            || e.target.classList.contains('text-layer')
        )) {
            isPanning = true;
            startPan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            startTranslate = { ...canvasTranslate };
        }
    });

    view.addEventListener('touchmove', (e) => {
        if (isPanning && e.touches.length === 1) {
            const dx = e.touches[0].clientX - startPan.x;
            const dy = e.touches[0].clientY - startPan.y;
            canvasTranslate.x = startTranslate.x + dx;
            canvasTranslate.y = startTranslate.y + dy;
            updateCanvasTransform();
        }
    }, { passive: false });

    view.addEventListener('touchend', () => {
        isPanning = false;
    });

    // Wheel Zoom
    view.addEventListener('wheel', (e) => {
        if (isImageAdjusting) return; // 画像調整中はCanvasズーム無効

        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        canvasScale *= delta;
        canvasScale = Math.min(Math.max(0.1, canvasScale), 5); // Limit scale
        updateCanvasTransform();
    }, { passive: false });
}

// プロジェクト名インライン編集
window.onProjectTitleInput = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: name === '新規プロジェクト' ? '' : name } });
    }
};
window.onProjectTitleKeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
    }
};
window.onProjectTitleBlur = () => {
    const el = document.getElementById('project-title');
    if (el) {
        const name = (el.textContent || '').trim();
        state.projectName = name === '新規プロジェクト' ? '' : name;
        triggerAutoSave();
    }
};
window.saveProject = async () => {
    ensureProjectIdentity();
    await persistProject();
    refresh();
};

window.importDSP = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof closeMobileSheet === 'function') {
        closeMobileSheet();
    }

    // Show loading? Optional since it might be fast, but let's just do it
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    try {
        await flushPendingSave();
        const loadedState = hydrateProjectFromPersistence(await parseAndLoadDSP(file));

        resetFlowRuntimeForProjectChange();
        clearHistory();
        dispatch({
            type: actionTypes.LOAD_PROJECT,
            payload: loadedState
        });
        await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap);

        // Update title UI
        const pt = document.getElementById('project-title');
        if (pt) pt.textContent = state.projectName || state.title || 'Untitled';
        const inputTitle = document.getElementById('prop-title');
        if (inputTitle) inputTitle.value = state.title || '';

        refresh();
        window.switchRoom('editor');
    } catch (e) {
        console.error("DSP Import failed", e);
        alert("読み込みエラー: " + e.message);
    } finally {
        document.body.style.cursor = originalCursor;
        event.target.value = ''; // Reset input
    }
};

window.exportDSP = async () => {
    const btnDataList = document.querySelectorAll('button[onclick="exportDSP()"]');
    btnDataList.forEach(btn => btn.textContent = '⏳ ZIP生成中...');
    try {
        await buildDSP();
    } catch (e) {
        console.error("Export DSP failed:", e);
        alert("エクスポート中にエラーが発生しました。\n" + e.message);
    } finally {
        btnDataList.forEach(btn => btn.textContent = '⬇ プロジェクト保存 (.dsp)');
    }
};

let _dsfExportInProgress = false;

window.exportDSF = async () => {
    if (_dsfExportInProgress) return;
    _dsfExportInProgress = true;
    const btnDataList = document.querySelectorAll('button[onclick="exportDSF()"]');
    const buttonSnapshots = Array.from(btnDataList, (btn) => ({
        btn,
        innerHTML: btn.innerHTML,
        disabled: btn.disabled,
    }));
    buttonSnapshots.forEach(({ btn }) => {
        btn.textContent = '⏳ ZIP確認中...';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
    });
    try {
        await buildDSF();
    } catch (e) {
        console.error("Export DSF failed:", e);
        if (e?.code === 'PRESS_RENDER_CANCELLED') {
            alert(t('press_render_cancelled'));
        } else if (e?.code === 'FLOW_PORTABLE_DOWNLOAD_NOT_READY'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_STALE'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_PACKAGE_UNVERIFIED'
            || e?.code === 'FLOW_PORTABLE_DOWNLOAD_BLOB_INVALID') {
            alert('Flow portable .dsfの検証結果が現在の原稿と一致しません。PressのZIP検証完了後にもう一度実行してください。');
        } else {
            alert("エクスポート中にエラーが発生しました。\n" + e.message);
        }
    } finally {
        _dsfExportInProgress = false;
        buttonSnapshots.forEach(({ btn, innerHTML, disabled }) => {
            btn.innerHTML = innerHTML;
            btn.disabled = disabled;
            btn.removeAttribute('aria-busy');
        });
    }
};

window.shareProject = async () => {
    if (!state.projectId) {
        alert("プロジェクトが保存されていません。");
        return;
    }
    if (!state.workId) {
        alert("作品IDがまだありません。保存してからもう一度共有してください。");
        return;
    }
    if (!state.uid) {
        alert("ログインしてください。");
        return;
    }

    await flushSave();

    const host = window.location.host;
    const visibility = state.visibility || 'private';
    if (visibility === 'private') {
        alert('現在の状態は「非公開」です。\nこのままでは作品を共有できません。上部メニューから「限定公開」か「公開」に変更してください。');
        return;
    }
    const url = `${window.location.protocol}//${host}/viewer?work=${encodeURIComponent(state.workId)}`;

    try {
        await navigator.clipboard.writeText(url);
        alert(`スマホ用URLをコピーしました！\n\n${url}`);
    } catch (e) {
        prompt("ビューワー用URL (コピーしてください):", url);
    }
};

window.updateVisibility = async (val) => {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'visibility', value: val } });
    await flushSave();
    const map = {
        'private': '非公開（自分だけの状態）',
        'unlisted': '限定公開（URLを知っている人のみ閲覧可能）',
        'public': '公開（ポータルに掲載され誰でも閲覧可能）'
    };
    console.log(`[DSF] Visibility updated to ${val}`);
};

// 吹き出し直接編集（多言語対応）
let directEditPushTimer = null;
window.onBubbleTextInput = (e, i) => {
    const text = (e.target.innerText || '').replace(/\n+$/, '');
    const s = getEditableActiveFixedSection('image');
    if (s?.bubbles && s.bubbles[i]) {
        if (!directEditPushTimer) {
            pushState();
        } else {
            clearTimeout(directEditPushTimer);
        }
        directEditPushTimer = setTimeout(() => { directEditPushTimer = null; }, 500);

        setBubbleText(s.bubbles[i], text);
        document.getElementById('prop-text').value = text;
        triggerAutoSave();
    }
};
window.onBubbleTextBlur = () => {
    setTimeout(() => refresh(), 10);
};

// 言語切替
window.switchLang = (code) => {
    state.activeLang = code;
    refresh();
};

// lang-add-select を現在の追加済み言語を除いて生成する
function renderLangAddSelect() {
    const select = document.getElementById('lang-add-select');
    if (!select) return;
    const draft = _getPsSettingsSource();
    const added = new Set(draft.languages || ['ja']);
    const allLangs = getAllLangs();
    const options = [];
    allLangs.forEach(({ code, label, directions }) => {
        if (added.has(code)) return; // 既追加はスキップ
        directions.forEach(({ value: dir, label: dirLabel }) => {
            const suffix = dirLabel ? ` — ${dirLabel}` : '';
            const dirStr = dir.toUpperCase();
            options.push(`<option value="${code}:${dir}">${label}${suffix} (${dirStr})</option>`);
        });
    });
    select.innerHTML = options.length
        ? options.join('')
        : '<option value="">— 追加できる言語がありません —</option>';
}

// 言語追加（セレクト値は "code:dir" 形式）
window.addLang = () => {
    const select = document.getElementById('lang-add-select');
    if (!select || !select.value || select.value.startsWith('—')) return;
    const [code, dir] = select.value.split(':');
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (!code || draft.languages.includes(code)) return;
    draft.languages.push(code);
    if (!draft.languageConfigs) draft.languageConfigs = {};
    draft.languageConfigs[code] = { pageDirection: dir || 'ltr' };
    renderLangSettings();
    renderLangAddSelect();
    renderProjectSettingsTable();
};

// 言語削除
window.removeLang = (code) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    if (draft.languages.length <= 1) return;
    const sourceFlowGroups = getFlowSourceLanguageGroupIds(state.blocks || [], code);
    if (sourceFlowGroups.length) {
        alert(`「${getLangProps(code).label}」は${sourceFlowGroups.length}件のFlow原稿の原稿言語です。先に原稿言語を移行する必要があります。`);
        return;
    }
    if (!confirm(t('confirm_remove_lang', { lang: getLangProps(code).label }))) return;
    draft.languages = draft.languages.filter(c => c !== code);
    if (draft.defaultLang === code) draft.defaultLang = draft.languages[0] || 'ja';
    if (draft.activeLang === code) draft.activeLang = draft.defaultLang || draft.languages[0];
    renderLangSettings();
    renderLangAddSelect();
    renderProjectSettingsTable();
};

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal(async (pid) => {
    if (!await onLoadProject(pid)) return false;
    await cacheLocalRecentProject(JSON.parse(JSON.stringify(state)), window.localImageMap).catch((e) => {
        console.warn('[Home] Failed to cache cloud project locally:', e);
    });
    window.switchRoom('editor');
    return true;
});
window.closeProjectModal = closeProjectModal;

// Works Room
window.openWorksRoom = openWorksRoom;
window.closeWorksRoom = closeWorksRoom;
window.loadWorksRoom  = () => openWorksRoom(true); // true = ルームモード
window.loadAndOpenProject = async (pid) => {
    closeWorksRoom();
    if (!await onLoadProject(pid)) return;
    window.switchRoom('editor');
};
window.copyViewerUrl = async (pid) => {
    const projectWorkId = document.querySelector(`.works-row[data-pid="${CSS.escape(pid)}"]`)?.dataset.workId || pid;
    const url = `${window.location.origin}/viewer?work=${encodeURIComponent(projectWorkId)}`;
    try {
        await navigator.clipboard.writeText(url);
        alert('URLをコピーしました:\n' + url);
    } catch {
        prompt('ビューワーURL:', url);
    }
};
window.loadAndRepress = async (pid) => {
    closeWorksRoom();
    if (!await onLoadProject(pid)) return;
    window.switchRoom('press');
};

// 新規プロジェクト
window.newProject = async () => {
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return false;
    await flushPendingSave();
    resetFlowRuntimeForProjectChange();
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: null } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'version', value: 5 } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'releaseId', value: null } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: '' } });
    dispatch({ type: actionTypes.SET_TITLE, payload: '' });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'labelName', value: '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'rating', value: 'all' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'license', value: 'all-rights-reserved' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: 'white' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: {} } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: ['ja'] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: 'ja' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: { ja: { pageDirection: 'rtl' } } } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: 'simple' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: { mode: 'simple', covers: { c1: { pageIndex: 0 }, c4: { pageIndex: 0 } } } } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uiPrefs', value: { desktop: { thumbColumns: 2 }, mobile: { thumbColumns: 2 } } } });
    applyThumbColumnsFromPrefs();
    dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: 'ja' });
    const initialSections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        backgrounds: {},
        bubbles: []
    }];
    const initialBlocks = migrateSectionsToBlocks(initialSections, ['ja']);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: initialSections } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: initialBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(initialBlocks) } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: Math.max(0, getBlockIndexFromPageIndex(initialBlocks, 0)) });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    clearHistory();
    refresh();
    renderLangSettings();
    closeProjectModal();
    return true;
};

function setRibbonTab(tabName) {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.ribbonTab === tabName);
    });
    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.ribbonPanel === tabName);
    });
}

function syncDesktopToggleButtons() {
    const drawerOpen = document.body.classList.contains('drawer-open');
    const rightCollapsed = document.body.classList.contains('right-collapsed');
    const leftBtn = document.getElementById('btn-toggle-sidebar');
    const rightBtn = document.getElementById('btn-toggle-panel');
    if (leftBtn) leftBtn.textContent = drawerOpen ? '🖼 Assetsを閉じる' : '🖼 Assets';
    if (rightBtn) rightBtn.textContent = rightCollapsed ? '⚙ Editを開く' : '⚙ Edit';
}

window.toggleDesktopPanel = (side) => {
    if (side === 'right') {
        document.body.classList.toggle('right-collapsed');
    }
    syncDesktopToggleButtons();
};

window.togglePagesPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    window.toggleDrawer('pages');
};

window.toggleEditPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('right');
};

let activeDrawer = null;

window.toggleDrawer = (drawerName) => {
    if (window.innerWidth < 1024) return;
    if (activeDrawer === drawerName && document.body.classList.contains('drawer-open')) {
        window.closeDrawer();
        return;
    }
    activeDrawer = drawerName;
    document.body.classList.add('drawer-open');
    document.querySelectorAll('.sidebar-assets, .sidebar-pages, .sidebar-toc').forEach((el) => {
        el.style.display = 'none';
    });
    const target = document.querySelector(`.sidebar-${drawerName}`);
    if (target) target.style.display = 'flex';
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.drawer === drawerName);
    });
    syncDesktopToggleButtons();
};

window.closeDrawer = () => {
    activeDrawer = null;
    document.body.classList.remove('drawer-open');
    document.querySelectorAll('.icon-bar-btn').forEach((btn) => btn.classList.remove('active'));
    syncDesktopToggleButtons();
};

// ===== Project Settings Modal =====

const PS_META_FIELDS = [
    { key: 'title',       get label() { return t('field_title'); },       type: 'input'    },
    { key: 'author',      get label() { return t('field_author'); },      type: 'input'    },
    { key: 'description', get label() { return t('field_description'); }, type: 'textarea' },
    { key: 'linerNotes',  get label() { return t('field_liner_notes'); }, type: 'textarea' },
    { key: 'copyright',   get label() { return t('field_copyright'); },   type: 'input'    },
];

// ── PS テーブル列ドラッグ ──
let _psDragLang = null;
let _psDraft = null;

function _cloneProjectSettingsDraft() {
    const languages = [...(state.languages && state.languages.length ? state.languages : ['ja'])];
    const defaultLang = languages.includes(state.defaultLang) ? state.defaultLang : languages[0];
    const activeLang = languages.includes(state.activeLang) ? state.activeLang : defaultLang;
    const pageCount = (state.sections || []).length;
    const bookMode = state.bookMode || state.book?.mode || 'simple';
    const book = normalizeBookSettings(state.book || { mode: bookMode }, bookMode, pageCount);
    return {
        projectName: state.projectName || '',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        textPaperPreset: _getProjectTextPaperPresetKey(state),
        bookMode: book.mode,
        book,
        languages,
        defaultLang,
        activeLang,
        languageConfigs: state.languageConfigs ? JSON.parse(JSON.stringify(state.languageConfigs)) : {},
        meta: state.meta ? JSON.parse(JSON.stringify(state.meta)) : {}
    };
}

function _ensurePsDraft() {
    if (!_psDraft) _psDraft = _cloneProjectSettingsDraft();
    return _psDraft;
}

function _getPsSettingsSource() {
    return _psDraft || {
        languages: state.languages || ['ja'],
        defaultLang: state.defaultLang || 'ja',
        activeLang: state.activeLang || state.defaultLang || 'ja',
        labelName: state.labelName || '',
        rating: state.rating || 'all',
        license: state.license || 'all-rights-reserved',
        textPaperPreset: _getProjectTextPaperPresetKey(state),
        bookMode: state.bookMode || state.book?.mode || 'simple',
        book: normalizeBookSettings(state.book || {}, state.bookMode || state.book?.mode || 'simple', (state.sections || []).length),
        languageConfigs: state.languageConfigs || {},
        meta: state.meta || {}
    };
}

function _capturePsInputsToDraft() {
    const draft = _ensurePsDraft();

    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) draft.projectName = nameEl.value.trim();

    const labelEl = document.getElementById('ps-label-name');
    if (labelEl) draft.labelName = labelEl.value.trim();

    ['rating', 'license'].forEach(key => {
        const el = document.getElementById(`ps-${key}`);
        if (el) draft[key] = el.value;
    });

    const bookModeEl = document.getElementById('ps-book-mode');
    if (bookModeEl) {
        const requestedMode = bookModeEl.value === 'none' ? 'none' : 'cover';
        const normalizedBook = normalizeBookSettings({ mode: requestedMode }, requestedMode, (state.sections || []).length);
        draft.bookMode = normalizedBook.mode;
        draft.book = normalizedBook;
    }

    document.querySelectorAll('#ps-meta-table .ps-meta-input').forEach(input => {
        const lang = input.dataset.lang;
        const key  = input.dataset.key;
        if (lang && key) {
            if (!draft.meta[lang]) draft.meta[lang] = {};
            draft.meta[lang][key] = input.value;
        }
    });

    document.querySelectorAll('#ps-meta-table .ps-font-select').forEach(sel => {
        const lang = sel.dataset.lang;
        if (lang) {
            if (!draft.languageConfigs[lang]) draft.languageConfigs[lang] = {};
            draft.languageConfigs[lang].fontPreset = sel.value;
        }
    });

    return draft;
}

window.psColDragStart = (e, lang) => {
    _psDragLang = lang;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('ps-col-dragging');
};

window.psColDragEnd = (e) => {
    e.currentTarget.classList.remove('ps-col-dragging');
};

window.psColDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('ps-col-drag-over');
};

window.psColDragLeave = (e) => {
    e.currentTarget.classList.remove('ps-col-drag-over');
};

window.psColDrop = (e, targetLang) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ps-col-drag-over');
    if (!_psDragLang || _psDragLang === targetLang) { _psDragLang = null; return; }

    const draft = _capturePsInputsToDraft();

    // Reorder languages
    const langs = [...draft.languages];
    const fromIdx = langs.indexOf(_psDragLang);
    const toIdx   = langs.indexOf(targetLang);
    if (fromIdx === -1 || toIdx === -1) { _psDragLang = null; return; }
    langs.splice(fromIdx, 1);
    langs.splice(toIdx, 0, _psDragLang);
    draft.languages = langs;
    draft.defaultLang = langs[0];
    _psDragLang = null;

    renderProjectSettingsTable();
    renderLangSettings();
};

function renderProjectSettingsTable() {
    const container = document.getElementById('ps-meta-table');
    if (!container) return;

    const draft = _getPsSettingsSource();
    const langs = draft.languages || ['ja'];
    const meta = draft.meta || {};
    const configs = draft.languageConfigs || {};
    const isMobile = window.innerWidth < 768 || document.body.dataset.device === 'mobile';

    if (isMobile) {
        const cards = langs.map((lang, idx) => {
            const props = getLangProps(lang);
            const dir = (configs?.[lang]?.pageDirection || 'ltr').toUpperCase();
            const code = lang.toUpperCase();
            const isDefault = idx === 0;
            const defaultBadge = isDefault
                ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
                : '';
            const fields = PS_META_FIELDS.map(field => {
                const val = escapeStudioHtml(meta[lang]?.[field.key] || '');
                const ph = escapeStudioHtml(getLangProps(lang).placeholders?.[field.key] || '');
                const control = field.type === 'textarea'
                    ? `<textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea>`
                    : `<input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}">`;
                return `
                    <div class="ps-meta-mobile-field">
                        <label class="ps-meta-mobile-label">${field.label}</label>
                        ${control}
                    </div>
                `;
            }).join('');
            return `
                <section class="ps-meta-mobile-card">
                    <header class="ps-meta-mobile-head${isDefault ? ' ps-meta-header--default' : ''}">
                        <div class="ps-meta-mobile-head-main">
                            <div class="ps-meta-mobile-lang">${props.label}</div>
                            <div class="ps-meta-mobile-sub">${code} / ${dir}</div>
                        </div>
                        ${defaultBadge}
                    </header>
                    <div class="ps-meta-mobile-body">${fields}</div>
                </section>
            `;
        }).join('');
        container.innerHTML = `<div class="ps-meta-mobile-list">${cards}</div>`;
        return;
    }

    // grid-template-columns: label col (fixed) + one col per language (fixed 180px each → horizontal scroll)
    const colTemplate = `120px ${langs.map(() => '320px').join(' ')}`;

    let html = `<div class="ps-meta-grid" style="grid-template-columns:${colTemplate};">`;

    // Header row: empty label cell + draggable language headers
    html += `<div class="ps-meta-cell ps-meta-header ps-meta-corner"></div>`;
    langs.forEach((lang, idx) => {
        const props = getLangProps(lang);
        const dir  = (configs?.[lang]?.pageDirection || 'ltr').toUpperCase();
        const code = lang.toUpperCase();
        const isDefault = idx === 0;
        const defaultBadge = isDefault
            ? `<span class="ps-default-badge">${t('ps_default_badge')}</span>`
            : '';
        html += `<div class="ps-meta-cell ps-meta-header${isDefault ? ' ps-meta-header--default' : ''}"
            draggable="true"
            data-lang="${lang}"
            ondragstart="psColDragStart(event,'${lang}')"
            ondragend="psColDragEnd(event)"
            ondragover="psColDragOver(event)"
            ondragleave="psColDragLeave(event)"
            ondrop="psColDrop(event,'${lang}')">
            <span class="ps-meta-header-drag">⠿</span>
            ${props.label}
            <span class="ps-meta-header-sub">${code} / ${dir}</span>
            ${defaultBadge}
        </div>`;
    });

    // Data rows
    PS_META_FIELDS.forEach(field => {
        html += `<div class="ps-meta-cell ps-meta-row-label">${field.label}</div>`;
        langs.forEach(lang => {
            const val = escapeStudioHtml(meta[lang]?.[field.key] || '');
            const ph  = escapeStudioHtml(getLangProps(lang).placeholders?.[field.key] || '');
            if (field.type === 'textarea') {
                html += `<div class="ps-meta-cell"><textarea class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" placeholder="${ph}">${val}</textarea></div>`;
            } else {
                html += `<div class="ps-meta-cell"><input type="text" class="ps-meta-input" data-lang="${lang}" data-key="${field.key}" value="${val}" placeholder="${ph}"></div>`;
            }
        });
    });

    // フォントプリセット行
    const fontOptions = getFontPresetOptions();
    html += `<div class="ps-meta-cell ps-meta-row-label">${t('field_font')}</div>`;
    langs.forEach(lang => {
        const current = configs?.[lang]?.fontPreset || 'gothic';
        const opts = fontOptions.map(o =>
            `<option value="${o.value}"${o.value === current ? ' selected' : ''}>${o.label}</option>`
        ).join('');
        html += `<div class="ps-meta-cell"><select class="ps-font-select" data-lang="${lang}">${opts}</select></div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function renderProjectBookSettings() {
    const container = document.getElementById('ps-book-settings');
    if (!container) return;
    const draft = _getPsSettingsSource();
    const pageCount = (state.sections || []).length;
    if (!pageCount) {
        container.innerHTML = `<p class="press-book-empty">${escapeStudioHtml(t('press_book_no_pages'))}</p>`;
        return;
    }

    const settings = normalizeBookSettings(draft.book || {}, draft.bookMode || 'simple', pageCount);
    const coverRow = (key, labelKey) => {
        const pageIndex = settings.covers[key]?.pageIndex;
        if (pageIndex === undefined) return '';
        return `<div class="press-book-cover-fixed">
            <span>${escapeStudioHtml(t(labelKey))}</span>
            <strong>${escapeStudioHtml(t('press_cover_page', { page: pageIndex + 1 }))}</strong>
        </div>`;
    };

    container.innerHTML = `
        <div class="press-book-mode-row">
            <span>${escapeStudioHtml(t('press_book_layout'))}</span>
            <select id="ps-book-mode">
                <option value="none" ${settings.mode === 'none' ? 'selected' : ''}>${escapeStudioHtml(t('press_book_none'))}</option>
                <option value="cover" ${settings.mode !== 'none' ? 'selected' : ''}>${escapeStudioHtml(t('press_book_cover_auto'))}</option>
            </select>
        </div>
        <div class="press-book-fixed-hint">${escapeStudioHtml(t('press_book_fixed_hint'))}</div>
        <div class="press-book-covers-fixed">
            ${coverRow('c1', 'press_cover_c1')}
            ${coverRow('c2', 'press_cover_c2')}
            ${coverRow('c3', 'press_cover_c3')}
            ${coverRow('c4', 'press_cover_c4')}
        </div>
    `;

    const modeEl = container.querySelector('#ps-book-mode');
    if (modeEl) modeEl.addEventListener('change', () => window.updateProjectBookMode(modeEl.value));
}

window.updateProjectBookMode = (mode) => {
    _capturePsInputsToDraft();
    const draft = _ensurePsDraft();
    const requestedMode = mode === 'none' ? 'none' : 'cover';
    const normalizedBook = normalizeBookSettings({ mode: requestedMode }, requestedMode, (state.sections || []).length);
    draft.bookMode = normalizedBook.mode;
    draft.book = normalizedBook;
    renderProjectBookSettings();
};

function renderProjectTextPaperSettings() {
    const draft = _getPsSettingsSource();
    const activeKey = _getProjectTextPaperPresetKey(draft);
    document.querySelectorAll('[data-project-text-paper-preset]').forEach((button) => {
        const isActive = button.dataset.projectTextPaperPreset === activeKey;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

window.updateProjectTextPaperPreset = (key) => {
    if (!TEXT_PAPER_PRESETS[key]) return;
    const draft = _ensurePsDraft();
    draft.textPaperPreset = key;
    renderProjectTextPaperSettings();
};

window.openProjectSettings = () => {
    const modal = document.getElementById('project-settings-modal');
    if (!modal) return;
    _psDraft = _cloneProjectSettingsDraft();
    const draft = _ensurePsDraft();

    // Project name
    const nameEl = document.getElementById('ps-project-name');
    if (nameEl) nameEl.value = draft.projectName || '';

    const labelEl = document.getElementById('ps-label-name');
    if (labelEl) labelEl.value = draft.labelName || '';

    // Global settings
    const ratingEl = document.getElementById('ps-rating');
    if (ratingEl) ratingEl.value = draft.rating || 'all';

    const licenseEl = document.getElementById('ps-license');
    if (licenseEl) licenseEl.value = draft.license || 'all-rights-reserved';

    // Language settings
    renderLangSettings();
    renderLangAddSelect();

    // Per-language meta table
    renderProjectSettingsTable();
    renderProjectBookSettings();
    renderProjectTextPaperSettings();

    modal.style.display = 'flex';
};

window.closeProjectSettings = (e) => {
    if (e && e.currentTarget !== e.target) return;
    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';
    _psDraft = null;
};

window.saveProjectSettings = () => {
    const draft = _capturePsInputsToDraft();
    const nextLanguages = draft.languages && draft.languages.length ? [...draft.languages] : ['ja'];
    const missingFlowSourceLanguages = [...new Set((state.blocks || [])
        .filter((block) => block?.kind === 'flow')
        .map((block) => String(block.flow?.document?.sourceLanguage || ''))
        .filter((languageKey) => languageKey && !nextLanguages.includes(languageKey)))];
    if (missingFlowSourceLanguages.length) {
        alert(`Flow原稿の原稿言語 ${missingFlowSourceLanguages.map((code) => code.toUpperCase()).join(', ')} は作品言語から削除できません。`);
        return;
    }
    const nextDefaultLang = nextLanguages.includes(draft.defaultLang) ? draft.defaultLang : nextLanguages[0];
    const nextActiveLang = nextLanguages.includes(draft.activeLang) ? draft.activeLang : nextDefaultLang;

    // Project name
    const newName = draft.projectName || '';
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectName', value: newName } });
    const titleDisplay = document.getElementById('project-title');
    if (titleDisplay) titleDisplay.textContent = newName || '新規プロジェクト';

    // Global settings
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'labelName', value: draft.labelName || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'rating', value: draft.rating || 'all' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'license', value: draft.license || 'all-rights-reserved' } });
    const nextTextPaperPreset = _getProjectTextPaperPresetKey(draft);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'textPaperPreset', value: nextTextPaperPreset } });
    const nextBook = normalizeBookSettings(draft.book || {}, draft.bookMode || 'simple', (state.sections || []).length);
    const compositionIssues = getBookCompositionIssues({
        pageCount: (state.sections || []).length,
        book: nextBook,
        bookMode: nextBook.mode,
        sections: state.sections || []
    });
    if (compositionIssues.includes('spread_image_requires_covers')) {
        alertCompositionIssues(compositionIssues);
        return;
    }
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: nextBook.mode } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: nextBook } });

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: nextLanguages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: nextDefaultLang } });
    dispatch({ type: actionTypes.SET_ACTIVE_LANGUAGE, payload: nextActiveLang });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'meta', value: draft.meta || {} } });
    dispatch({ type: actionTypes.SET_TITLE, payload: draft.meta?.[nextDefaultLang]?.title || '' });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: draft.languageConfigs || {} } });

    const nextSections = _applyTextPaperStyleToSections(state.sections, nextTextPaperPreset);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: nextSections } });

    const syncedBlocks = syncBlocksWithSections(
        state.blocks,
        nextSections,
        nextLanguages,
        { strictSpine: state.version === 6 },
    );
    const nextBlocks = _applyTextPaperStyleToBlocks(syncedBlocks, nextTextPaperPreset);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: nextBlocks } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(nextBlocks) } });

    const modal = document.getElementById('project-settings-modal');
    if (modal) modal.style.display = 'none';
    _psDraft = null;

    renderLangSettings();
    renderLangTabs();
    refresh();
    triggerAutoSave();
};

// ===== Room Navigation（body.dataset.room の単一入口。各 room の「中身」は下記のみ委譲） =====
window.switchRoom = (room) => {
    const targetRoom = getValidStudioRoom(room);
    const previousRoom = getCurrentRoom();
    if (previousRoom === 'press' && targetRoom !== 'press') {
        leavePressRoom();
    }
    if (previousRoom === 'editor' && targetRoom !== 'editor') {
        if (_flowAuthoringReflowTimer) clearTimeout(_flowAuthoringReflowTimer);
        _flowAuthoringReflowTimer = null;
        _editorFlowProjectionController?.abort();
        _editorFlowProjectionController = null;
        _editorFlowProjectionRequestKey = '';
        _editorFlowProjectionRequestId += 1;
    }
    document.body.dataset.room = targetRoom;
    syncStudioRoomUrl(targetRoom);
    syncStudioShell();
    if (targetRoom === 'editor' && previousRoom !== 'editor') {
        refresh();
    }
    if (targetRoom === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] render failed:', e));
    }
    // press / works は専用モジュールが DOM・イベントを持つ
    if (targetRoom === 'press') {
        enterPressRoom();
    }
    if (targetRoom === 'works') {
        loadWorksRoom(); // openWorksRoom(true) と同義（ルームモード）
    }
};

window.togglePageStrip = () => {
    document.body.classList.toggle('strip-collapsed');
    const chevron = document.getElementById('page-strip-chevron');
    if (chevron) {
        chevron.textContent = document.body.classList.contains('strip-collapsed') ? 'expand_less' : 'expand_more';
    }
    // #page-strip の CSS transition（200ms）完了後にキャンバスサイズを再計算
    setTimeout(() => fitCanvasView(), 220);
};

window.handleMobileHeaderNav = () => {
    const navBtn = document.getElementById('mobile-header-nav');
    const targetRoom = navBtn?.dataset.targetRoom;
    if (targetRoom) {
        window.switchRoom(targetRoom);
    }
};

window.uploadAsset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        // TODO: implement asset upload to Firebase Storage
        console.log('uploadAsset: files selected', files.map((f) => f.name));
    };
    input.click();
};

const MOBILE_ROOM_ACTIONS = {
    home: [
        {
            key: 'new-project',
            icon: 'add_circle',
            labelKey: 'bottom_new_project',
            onClick: async () => {
                if (await window.newProject()) {
                    window.switchRoom('editor');
                }
            }
        },
        {
            key: 'open-local',
            icon: 'folder_open',
            labelKey: 'bottom_open_local',
            onClick: () => document.getElementById('dsp-upload')?.click()
        },
        {
            key: 'menu',
            icon: 'menu',
            labelKey: 'bottom_menu',
            sheet: 'menu'
        }
    ],
    editor: [
        { key: 'pages', icon: 'view_carousel', labelKey: 'bottom_pages', sheet: 'pages' },
        { key: 'add', icon: 'add_circle', labelKey: 'bottom_add', sheet: 'add' },
        { key: 'edit', icon: 'tune', labelKey: 'bottom_edit', sheet: 'edit' },
        { key: 'export', icon: 'ios_share', labelKey: 'bottom_export', sheet: 'export' },
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    press: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ],
    works: [
        { key: 'menu', icon: 'menu', labelKey: 'bottom_menu', sheet: 'menu' }
    ]
};

let activeMobileSheet = null;
let lastDeviceKey = getDeviceKey();

function getMobileActionConfigs(room = getCurrentRoom()) {
    return MOBILE_ROOM_ACTIONS[room] || [];
}

function setBottomBarActive(actionName) {
    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === actionName);
    });
}

function syncMobileMenuSheet() {
    const room = getCurrentRoom();
    document.querySelectorAll('[data-mobile-room-only]').forEach((el) => {
        el.hidden = el.dataset.mobileRoomOnly !== room;
    });
    document.querySelectorAll('[data-mobile-room-nav]').forEach((el) => {
        el.classList.toggle('active', el.dataset.mobileRoomNav === room);
    });
    document.querySelectorAll('[data-studio-room-nav]').forEach((el) => {
        el.classList.toggle('active', el.dataset.studioRoomNav === room);
    });
}

function setStudioLogoMenuOpen(open) {
    const menu = document.getElementById('studio-logo-menu');
    const btn = document.getElementById('studio-logo-menu-btn');
    if (!menu) return;
    menu.hidden = !open;
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncMobileMenuSheet();
}

window.closeStudioLogoMenu = () => {
    setStudioLogoMenuOpen(false);
};

window.toggleStudioLogoMenu = (event) => {
    event?.stopPropagation();
    const menu = document.getElementById('studio-logo-menu');
    setStudioLogoMenuOpen(!!menu?.hidden);
};

function setMobileStudioNavOpen(open) {
    const menu = document.getElementById('mobile-studio-nav-menu');
    const btn = document.getElementById('mobile-studio-logo-btn');
    if (!menu) return;
    menu.hidden = !open;
    document.body.classList.toggle('mobile-studio-nav-open', open);
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
        syncMobileMenuSheet();
    }
}

window.closeMobileStudioNavMenu = () => {
    setMobileStudioNavOpen(false);
};

window.toggleMobileStudioNavMenu = (event) => {
    event?.stopPropagation();
    if (window.innerWidth >= 1024) return;
    const menu = document.getElementById('mobile-studio-nav-menu');
    const shouldOpen = !!menu?.hidden;
    closeMobileSheet();
    setMobileStudioNavOpen(shouldOpen);
};

function handleMobileBottomAction(actionKey) {
    const action = getMobileActionConfigs().find((item) => item.key === actionKey);
    if (!action) return;
    closeMobileStudioNavMenu();
    if (action.sheet) {
        openMobileSheet(action.sheet);
        return;
    }
    closeMobileSheet();
    action.onClick?.();
}

function renderMobileBottomBar() {
    const bottomBar = document.getElementById('bottom-bar');
    if (!bottomBar) return;
    const device = getDeviceKey();
    const actions = device === 'mobile' ? getMobileActionConfigs() : [];

    document.body.classList.toggle('mobile-bottom-visible', actions.length > 0);

    if (!actions.length) {
        bottomBar.innerHTML = '';
        setBottomBarActive(null);
        return;
    }

    bottomBar.style.setProperty('--mobile-bottom-columns', String(actions.length));
    bottomBar.innerHTML = actions.map((action) => `
        <button class="bottom-item" data-mobile-action="${action.key}">
            <span class="material-icons">${action.icon}</span><span>${t(action.labelKey)}</span>
        </button>
    `).join('');

    bottomBar.querySelectorAll('.bottom-item').forEach((item) => {
        item.addEventListener('click', () => handleMobileBottomAction(item.dataset.mobileAction));
    });

    if (activeMobileSheet && !actions.some((action) => action.key === activeMobileSheet || action.sheet === activeMobileSheet)) {
        closeMobileSheet();
    } else {
        setBottomBarActive(activeMobileSheet);
    }
}

window.closeMobileSheet = () => {
    activeMobileSheet = null;
    document.body.classList.remove('mobile-sheet-active');
    ['sidebar', 'panel-right', 'mobile-action-sheet'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('mobile-sheet-open');
    });
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => el.classList.remove('active'));
    setBottomBarActive(null);
};

window.closeMobileOverlays = () => {
    closeMobileStudioNavMenu();
    closeMobileSheet();
};

function openMobileActionSheet(contentId) {
    const actionSheet = document.getElementById('mobile-action-sheet');
    if (!actionSheet) return;
    actionSheet.classList.add('mobile-sheet-open');
    document.querySelectorAll('.mobile-sheet-content').forEach((el) => {
        el.classList.toggle('active', el.id === contentId);
    });
}

window.openMobileSheet = (sheetName) => {
    if (window.innerWidth >= 1024) return;
    if (activeMobileSheet === sheetName) {
        closeMobileSheet();
        return;
    }

    closeMobileStudioNavMenu();
    closeMobileSheet();
    activeMobileSheet = sheetName;
    document.body.classList.add('mobile-sheet-active');
    setBottomBarActive(sheetName);

    if (sheetName === 'pages') {
        document.getElementById('sidebar')?.classList.add('mobile-sheet-open');
        return;
    }
    if (sheetName === 'edit') {
        document.getElementById('panel-right')?.classList.add('mobile-sheet-open');
        return;
    }

    const map = {
        menu: 'mobile-sheet-menu',
        add: 'mobile-sheet-add',
        export: 'mobile-sheet-export',
        lang: 'mobile-sheet-lang'
    };
    openMobileActionSheet(map[sheetName] || 'mobile-sheet-menu');
};

function initUIChrome() {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.addEventListener('click', () => setRibbonTab(tab.dataset.ribbonTab));
    });

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => window.toggleDrawer('assets'));
    document.getElementById('btn-toggle-panel')?.addEventListener('click', () => toggleDesktopPanel('right'));

    window.addEventListener('dsf-auth-signed-in', (event) => {
        const user = event.detail?.user || firebaseAuth.currentUser || null;
        if (user) {
            applyStudioAuthUser(user);
            closeAllStudioAuthDropdowns();
            renderHomeDashboard().catch((e) => console.warn('[Home] render failed after auth event:', e));
        }
    });
    window.addEventListener('dsf-auth-error', (event) => {
        const error = event.detail?.error;
        console.error('[Auth] Google credential sign-in error:', error);
        alert(t('auth_google_failed', { message: error?.message || String(error || '') }));
    });

    document.addEventListener('click', (event) => {
        const desktopMenu = document.getElementById('studio-logo-menu');
        const desktopBtn = document.getElementById('studio-logo-menu-btn');
        if (desktopMenu && !desktopMenu.hidden && !desktopMenu.contains(event.target) && !desktopBtn?.contains(event.target)) {
            closeStudioLogoMenu();
        }

        const menu = document.getElementById('mobile-studio-nav-menu');
        const btn = document.getElementById('mobile-studio-logo-btn');
        if (!menu || menu.hidden) return;
        if (menu.contains(event.target) || btn?.contains(event.target)) return;
        closeMobileStudioNavMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeStudioLogoMenu();
            closeMobileStudioNavMenu();
        }
    });

    window.addEventListener('resize', () => {
        const currentDeviceKey = getDeviceKey();
        if (currentDeviceKey !== lastDeviceKey) {
            lastDeviceKey = currentDeviceKey;
            applyThumbColumnsFromPrefs();
            refresh();
            updateAuthUI();
        }
        syncStudioShell();
    });

    setRibbonTab('home');
    syncDesktopToggleButtons();
    syncStudioShell();
}

function finishInitialRoomBoot() {
    document.body.removeAttribute('data-booting');
    syncStudioShell();
}

// 後方互換: 旧モバイルナビAPI
window.toggleMobilePanel = (panelName) => {
    if (panelName === 'sidebar') return openMobileSheet('pages');
    if (panelName === 'properties') return openMobileSheet('edit');
    return closeMobileSheet();
};

window.toggleAuth = async () => {
    try {
        if (state.uid) {
            await signOutUser(firebaseAuth);
        } else {
            const result = await signInWithGoogle({ authInstance: firebaseAuth });
            if (result?.user) applyStudioAuthUser(result.user);
        }
    } catch (e) {
        console.error('[Auth] toggleAuth error:', e);
        alert(t('auth_google_failed', { message: e?.message || String(e) }));
    }
};

// Firebase Auth → state.user / uid。ログイン後にだけ URL ?id= のクラウドプロジェクトを開く。
onAuthChanged((user) => {
    applyStudioAuthUser(user);
    renderHomeDashboard().catch((e) => console.warn('[Home] render failed after auth:', e));
    if (user) {
        void hydrateStudioAccount(user);
        const pid = new URLSearchParams(window.location.search).get('id');
        if (pid) void onLoadProject(pid);
    } else {
        studioAccount = null;
    }
}, firebaseAuth);

// ── UI言語スイッチャー（windowに公開） ──────────────────────────
window.setStudioUILang = (lang) => {
    setUILang(lang);
    // 動的レンダリング済みコンポーネントを再描画
    renderLangTabs();
    updateAuthUI();
    renderHomeDashboard().catch((e) => console.warn('[Home] render failed after language switch:', e));
    if (document.getElementById('project-settings-modal')?.style.display !== 'none') {
        _capturePsInputsToDraft();
        renderProjectSettingsTable();
        renderLangSettings();
        renderLangAddSelect();
        renderProjectBookSettings();
    }
    if (getCurrentRoom() === 'press') {
        enterPressRoom();
    }
    syncStudioShell();
};

// --- 初回描画: UI 骨組み → リダイレクト認証結果 → GIS 初期化 → ローカル復元 → ?room= ---
async function bootstrapApp() {
    initUIChrome();
    normalizeStudioRouteUrl();
    const urlParams = new URLSearchParams(window.location.search);
    const targetRoom = getValidStudioRoom(urlParams.get('room'));

    ensureUiPrefs();
    applyThumbColumnsFromPrefs();
    applyTheme();
    bindThemePreferenceListener(() => {
        updateStudioThemeSwitchers();
    });
    applyI18n(); // UI言語を適用
    window.switchRoom(targetRoom);
    finishInitialRoomBoot();

    await authReady;

    // Prevent local restore if we are explicitly loading a cloud project via URL
    const hasCloudId = urlParams.has('id');

    const redirectOutcome = await handleRedirectResult(firebaseAuth);
    if (redirectOutcome?.error) {
        alert(t('auth_google_failed', { message: redirectOutcome.error?.message || String(redirectOutcome.error) }));
    }
    if (redirectOutcome?.result?.user) {
        applyStudioAuthUser(redirectOutcome.result.user);
        await hydrateStudioAccount(redirectOutcome.result.user);
    } else if (firebaseAuth.currentUser) {
        applyStudioAuthUser(firebaseAuth.currentUser);
        await hydrateStudioAccount(firebaseAuth.currentUser);
    }
    await initGIS({ authInstance: firebaseAuth, autoPrompt: false });

    if (!hasCloudId) {
        try {
            const backup = await idbGet('dsf_autosave');
            if (backup && backup.state) {
                console.log("[DSF] Found local auto-save backup. Restoring...");

                // Restore object URLs for unsaved guest images
                let stateStr = JSON.stringify(backup.state);
                const restoredMap = {};

                if (backup.imageMap) {
                    for (const [oldUrl, localId] of Object.entries(backup.imageMap)) {
                        const blob = await idbGet(localId);
                        if (blob) {
                            const newUrl = URL.createObjectURL(blob);
                            restoredMap[newUrl] = localId; // keep the new mapping alive
                            stateStr = stateStr.split(oldUrl).join(newUrl);
                        }
                    }
                }

                window.localImageMap = restoredMap;
                const restoredState = hydrateProjectFromPersistence(JSON.parse(stateStr));

                // Only dispatch state keys that exist in our actual store
                resetFlowRuntimeForProjectChange();
                clearHistory();
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: restoredState });
                console.log("[DSF] Auto-save restored successfully.");
            }
        } catch (err) {
            console.warn("[DSF] Error restoring local auto-save:", err);
        }
    }

    if (import.meta.env.DEV && urlParams.get('flowTranslationVerification') === '1') {
        installFlowTranslationVerificationProvider({
            delayMs: Number(urlParams.get('flowTranslationDelayMs')) || 25,
            expansionFactor: Number(urlParams.get('flowTranslationExpansionFactor')) || 1,
            failUnitIndex: urlParams.has('flowTranslationFailUnitIndex')
                ? Number(urlParams.get('flowTranslationFailUnitIndex'))
                : -1,
        });
    }
    refresh();
    renderLangSettings();
    updateAuthUI();
    if (getCurrentRoom() === 'press') {
        enterPressRoom();
    }
    if (getCurrentRoom() === 'home') {
        renderHomeDashboard().catch((e) => console.warn('[Home] initial render failed:', e));
    }
}

if (import.meta.env.MODE !== 'production') {
    Object.defineProperty(window, '__flowAuthoringLab', {
        configurable: true,
        value: Object.freeze({
            getSourceSnapshot() {
                const active = getActiveBlock();
                return active?.kind === 'flow'
                    ? Object.freeze(JSON.parse(JSON.stringify(active.flow.document)))
                    : null;
            },
            getRuntimeState() {
                const root = getFlowAuthoringSurface();
                const active = getActiveBlock();
                const projection = getEditorPageProjection();
                const groupProjection = active?.kind === 'flow'
                    ? getFlowAuthoringGroupProjection(projection, active.id)
                    : null;
                const languageKey = active?.kind === 'flow' ? getFlowAuthoringLanguage(active) : '';
                const translationStatus = active?.kind === 'flow'
                    ? deriveFlowTranslationStatus(active, languageKey)
                    : null;
                return Object.freeze({
                    groupId: active?.kind === 'flow' ? active.id : '',
                    mode: active?.kind === 'flow' ? getFlowEditorSelection(active.id).mode : '',
                    reflowState: root?.dataset.reflowState || '',
                    sourceRevision: Number(root?.dataset.sourceRevision || 0),
                    renderedRevision: Number(root?.dataset.renderedRevision || 0),
                    pageCount: Number(root?.dataset.pageCount || groupProjection?.pageCount || 0),
                    changeMode: root?.dataset.changeMode || '',
                    prefixPageCount: Number(root?.dataset.prefixPageCount || 0),
                    measuredPageCount: Number(root?.dataset.measuredPageCount || 0),
                    composing: root?.dataset.composing === 'true',
                    sourceFallback: root?.dataset.sourceFallback === 'true',
                    translationStatus: translationStatus?.status || '',
                    outlineIssues: translationStatus?.hasOutlineIssues === true,
                });
            },
            getTranslationStatus() {
                const active = getActiveBlock();
                if (active?.kind !== 'flow') return null;
                return Object.freeze(JSON.parse(JSON.stringify(
                    deriveFlowTranslationStatus(active, getFlowAuthoringLanguage(active)),
                )));
            },
            getTranslationStateSnapshot() {
                const active = getActiveBlock();
                if (active?.kind !== 'flow') return null;
                return active.flow.translationState === undefined
                    ? null
                    : Object.freeze(JSON.parse(JSON.stringify(active.flow.translationState)));
            },
            installDeterministicTranslationProvider(options = {}) {
                return installFlowTranslationVerificationProvider(options);
            },
            getTranslationJob() {
                if (!_flowTranslationJob) return null;
                const { controller, ...snapshot } = _flowTranslationJob;
                return Object.freeze(JSON.parse(JSON.stringify(snapshot)));
            },
            awaitTranslationSettled() {
                return new Promise((resolve, reject) => {
                    const startedAt = Date.now();
                    const check = () => {
                        const snapshot = this.getTranslationJob();
                        if (snapshot && snapshot.state !== 'running') {
                            resolve(snapshot);
                            return;
                        }
                        if (Date.now() - startedAt > 30000) {
                            reject(new Error('Timed out waiting for Flow translation.'));
                            return;
                        }
                        setTimeout(check, 25);
                    };
                    check();
                });
            },
            getHistoryInfo() {
                return Object.freeze({ ...getHistoryInfo() });
            },
            awaitSettled(revision = _flowAuthoringSourceRevision) {
                const target = Number(revision) || 0;
                return new Promise((resolve, reject) => {
                    const startedAt = Date.now();
                    const check = () => {
                        const snapshot = this.getRuntimeState();
                        if (snapshot.reflowState === 'error') {
                            reject(new Error('Flow authoring reflow failed.'));
                            return;
                        }
                        if (
                            snapshot.reflowState === 'idle'
                            && snapshot.renderedRevision >= target
                            && !_editorFlowProjectionController
                            && !_flowAuthoringReflowTimer
                        ) {
                            resolve(snapshot);
                            return;
                        }
                        if (Date.now() - startedAt > 30000) {
                            reject(new Error('Timed out waiting for Flow authoring reflow.'));
                            return;
                        }
                        setTimeout(check, 25);
                    };
                    check();
                });
            },
        }),
    });
}

bootstrapApp();

// --- 右サイドバーリサイザー初期化 ---
function initSidebarResizer() {
    const resizer = document.getElementById('resizer-right');
    if (!resizer) return;

    const doResize = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let newWidth = window.innerWidth - clientX;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > 800) newWidth = 800;
        document.body.style.setProperty('--right-panel-width', `${newWidth}px`);
    };

    const stopResize = () => {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', doResize);
        window.removeEventListener('touchmove', doResize);
        window.removeEventListener('mouseup', stopResize);
        window.removeEventListener('touchend', stopResize);
    };

    const startResize = (e) => {
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        if (e.type === 'mousedown') e.preventDefault();
        window.addEventListener('mousemove', doResize);
        window.addEventListener('touchmove', doResize, { passive: true });
        window.addEventListener('mouseup', stopResize);
        window.addEventListener('touchend', stopResize);
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: true });
}

initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
initSidebarResizer(); // Initialize sidebar resizer
initContextMenu(); // Initialize right-click context menu

// ============================================================
// Context Menu (Right-Click) Logic
// ============================================================
function initContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;

    // キャンバスおよび吹き出し上の右クリックをフック
    document.addEventListener('contextmenu', (e) => {
        // Only intercept if we are in the editor area
        const canvasView = document.getElementById('canvas-view');
        if (!canvasView || !canvasView.contains(e.target)) return;

        e.preventDefault(); // デフォルトメニューを禁止
        if (!canEditActiveFixedPage()) {
            hideContextMenu();
            return;
        }

        // どこがクリックされたか判定
        const bubbleSvg = e.target.closest('.bubble-svg');
        const bubbleText = e.target.closest('.bubble-text');
        const isBubble = bubbleSvg || bubbleText;

        // メニュー内容を動的に生成
        contextMenu.innerHTML = '';

        if (isBubble) {
            // 吹き出しの上で右クリックした場合
            // 要素IDからインデックスを逆引き
            let bubbleIndex = -1;
            const targetEl = bubbleSvg || bubbleText;
            if (targetEl && targetEl.id) {
                const match = targetEl.id.match(/^bubble-(?:svg|text)-(\d+)$/);
                if (match) bubbleIndex = parseInt(match[1], 10);
            }

            if (bubbleIndex !== -1) {
                // select it first (pass refresh so UI updates)
                selectBubble(e, bubbleIndex, refresh);

                const currentShape = (() => {
                    const s2 = state.sections[state.activeIdx];
                    return s2?.bubbles?.[bubbleIndex]?.shape || 'speech';
                })();

                const shapeOptions = [
                    ['speech', '角丸'], ['oval', '楕円'], ['rect', '四角'],
                    ['cloud', '雲'], ['wave', '波'], ['thought', '思考'],
                    ['explosion', '💥 爆発'], ['digital', '📡 電子音'],
                    ['shout', '⚡ ギザギザ'], ['flash', '✨ フラッシュ'], ['urchin', '🦔 ウニフラッシュ']
                ].map(([v, l]) =>
                    `<option value="${v}"${v === currentShape ? ' selected' : ''}>${l}</option>`
                ).join('');

                contextMenu.innerHTML = `
                    <div class="context-menu-item context-menu-shape">
                        <span class="material-icons">auto_fix_high</span>
                        <select class="context-shape-select" onchange="changeBubbleShapeFromMenu(${bubbleIndex}, this.value)" onclick="event.stopPropagation()">
                            ${shapeOptions}
                        </select>
                    </div>
                    <div class="context-menu-item" onclick="duplicateSelectedBubble(${bubbleIndex})">
                        <span class="material-icons">content_copy</span> 複製
                    </div>
                    <div class="context-menu-item" onclick="deleteSelectedBubble(${bubbleIndex})" style="color: #d32f2f;">
                        <span class="material-icons">delete</span> 削除
                    </div>
                `;
            }
        } else {
            // キャンバス（何もない場所）で右クリックした場合
            contextMenu.innerHTML = `
                <div class="context-menu-item" onclick="addBubbleAtPointer(event)">
                    <span class="material-icons">text_fields</span> ここにテキストを追加
                </div>
            `;
            // ポインター座標を一時保存（addBubbleAtPointerで使う）
            contextMenu.dataset.pointerX = e.clientX;
            contextMenu.dataset.pointerY = e.clientY;
        }

        showContextMenuAt(e.clientX, e.clientY, contextMenu.innerHTML);
    });

    // 画面のどこかをクリックしたらコンテキストメニューを閉じる
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });
}

// Global functions for context menu actions
window.addBubbleAtPointer = function (e) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    hideContextMenu();
    if (!canEditActiveFixedPage()) return;

    const clientX = parseFloat(contextMenu.dataset.pointerX);
    const clientY = parseFloat(contextMenu.dataset.pointerY);

    if (isNaN(clientX) || isNaN(clientY)) return;

    const layer = document.getElementById('canvas-transform-layer');
    if (!layer) return;

    const rect = layer.getBoundingClientRect();

    // Convert screen coordinates to canvas % coordinates
    let x = ((clientX - rect.left) / rect.width) * 100;
    let y = ((clientY - rect.top) / rect.height) * 100;

    // Clamp
    x = Math.max(5, Math.min(95, x));
    y = Math.max(5, Math.min(95, y));

    pushState();
    const newBubble = {
        id: 'bubble_' + Date.now(),
        shape: 'rect',
        text: 'テキスト',
        x: x.toFixed(1),
        y: y.toFixed(1),
        tailX: 0,
        tailY: 20
    };

    if (!state.sections[state.activeIdx].bubbles) {
        state.sections[state.activeIdx].bubbles = [];
    }
    state.sections[state.activeIdx].bubbles.push(newBubble);

    // Select the newly created bubble
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.duplicateSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) hideContextMenu();

    const section = getEditableActiveFixedSection();
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    const source = section.bubbles[bubbleIndex];
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = 'bubble_' + Date.now();
    clone.x = (parseFloat(source.x) + 5).toFixed(1); // slightly offset
    clone.y = (parseFloat(source.y) + 5).toFixed(1);

    section.bubbles.push(clone);
    state.activeBubbleIdx = section.bubbles.length - 1;

    refresh();
    triggerAutoSave();
};

window.deleteSelectedBubble = function (bubbleIndex) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) hideContextMenu();

    const section = getEditableActiveFixedSection();
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    section.bubbles.splice(bubbleIndex, 1);
    state.activeBubbleIdx = null;

    refresh();
    triggerAutoSave();
};
