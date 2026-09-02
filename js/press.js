/**
 * press.js — Press Room ロジック
 * DSP → DSF レンダリング・R2アップロード・Firestore発行
 */
import {
    doc, setDoc, getDoc, deleteDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { state, dispatch, actionTypes } from './state.js';
import { hasFlowGroups } from './flow-project-model.js';
import { extractSectionsFromBlocks } from './blocks.js';
import { assertAccountCanPublish, db, uploadPressPage, triggerAutoSave, auth, ensureUserBootstrap } from './firebase.js';
import { loadImageForCanvas } from './asset-fetch.js';
import { renderPositionedThumbImageHtml } from './sections.js';
import { t, getUILang } from './i18n-studio.js';
import { createDefaultPublication, formatPublicationDate, getListingMaxDays } from './publication.js';
import {
    CANONICAL_PAGE_WIDTH,
    CANONICAL_PAGE_HEIGHT,
    getPressResolutionDims,
    resolvePressResolutionKey,
    clampPressPublishResolutionKey
} from './page-geometry.js';
import {
    getWritingModeFromConfigs
} from './layout.js';
import { verticalGlyphText, composeTextPreviewModel } from './text-press-html.js';
import { encodeCanvasToWebP } from './canvas-encoding.js';
import { getLangProps } from './lang.js';
import { createId } from './utils.js';
import { stageProjectSummaryWrite } from './project-summary-firestore.js';
import { getBookCompositionIssues, getPageCoverKey, getPageDisplayLabel, normalizeBookSettings } from './page-labels.js';
import { renderFlowGeneratedPage } from './flow-dom-measurer.js';
import {
    FLOW_RUNTIME_INVALIDATED_EVENT,
    createFlowRuntimePageProjection,
    createFlowRuntimeProjectionSignature,
    getCachedFlowRuntimePageProjection,
} from './flow-runtime-pages.js';
import { createFlowPressPortableDownloadArtifact } from './flow-press-portable-download.js';

let _estimateTimer = null;
let _estimateRunId = 0;
let _pressListenersBound = false;
let _pressThumbLang = '';
let _pressFlowPreviewState = 'idle';
let _pressFlowPreviewError = null;
let _pressFlowPreviewController = null;
let _pressFlowPreviewRequestId = 0;
let _pressFixedTextPreviewState = 'idle';
let _pressFixedTextPreviewError = null;
let _pressFixedTextPreviewRequestId = 0;
let _pressFixedTextPreviewModule = null;
let _pressFixedTextPreviewResults = new Map();
let _pressFlowPreflightPreviewState = 'idle';
let _pressFlowPreflightPreviewError = null;
let _pressFlowPreflightPreviewRequestId = 0;
let _pressFlowPreflightPreviewController = null;
let _pressFlowPreflightPreviewModule = null;
let _pressFlowPreflightPreviewResult = null;
let _pressFlowPreflightPreviewSignature = '';
let _pressFlowPreflightPreviewProgress = null;
let _pressFlowProductionPreparationState = 'idle';
let _pressFlowProductionPreparationError = null;
let _pressFlowProductionPreparationRequestId = 0;
let _pressFlowProductionPreparationController = null;
let _pressFlowProductionPreparationModule = null;
let _pressFlowProductionPreparationResult = null;
let _pressFlowProductionPreparationSignature = '';
let _pressFlowProductionPreparationProgress = null;
let _pressFlowLocalReleasePlanningState = 'idle';
let _pressFlowLocalReleasePlanningError = null;
let _pressFlowLocalReleasePlanningRequestId = 0;
let _pressFlowLocalReleasePlanningController = null;
let _pressFlowLocalReleasePlanningModule = null;
let _pressFlowLocalReleaseSealingModule = null;
let _pressFlowLocalReleasePlanningResult = null;
let _pressFlowLocalReleasePlanningSignature = '';
let _pressFlowLocalReleaseSealedAssets = null;
let _pressFlowLocalReleasePackageState = 'idle';
let _pressFlowLocalReleasePackageError = null;
let _pressFlowLocalReleasePackageRequestId = 0;
let _pressFlowLocalReleasePackageController = null;
let _pressFlowLocalReleasePackageModule = null;
let _pressFlowLocalReleasePackageResult = null;
let _pressFlowLocalReleasePackageSignature = '';
let _pressFlowHorizonHandoffState = 'idle';
let _pressFlowHorizonHandoffError = null;
let _pressFlowHorizonHandoffRequestId = 0;
let _pressFlowHorizonHandoffController = null;
let _pressFlowHorizonHandoffModule = null;
let _pressFlowHorizonHandoffResult = null;
let _pressFlowHorizonHandoffSignature = '';
let _pressFlowHorizonHandoffReleaseId = '';
const PRESS_IMAGE_WEBP_QUALITY_BY_SCALE = Object.freeze({
    1: 0.84,
    2: 0.86,
    3: 0.90,
    4: 0.92,
    6: 0.94
});
const PRESS_TEXT_WEBP_QUALITY = 0.90;
const _spreadRenderBlobCache = new Map();

function _isSpreadImageSection(section) {
    return section?.type === 'image'
        && section.spreadImage
        && typeof section.spreadImage === 'object'
        && !!section.spreadImage.groupId;
}

function _getPageDirectionForLang(lang) {
    const props = getLangProps(lang);
    return state.languageConfigs?.[lang]?.pageDirection || props.directions?.[0]?.value || 'ltr';
}

function _isCoverPageIndex(pageIndex, total) {
    return !!getPageCoverKey(pageIndex, state.book, state.bookMode, total);
}

function _isOuterCoverPageIndex(pageIndex, total) {
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    return coverKey === 'c1' || coverKey === 'c4';
}

function _getReadablePageOrdinalForIndex(pageIndex, total) {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= total) return 0;
    let ordinal = 0;
    for (let i = 0; i <= pageIndex; i += 1) {
        if (!_isCoverPageIndex(i, total)) ordinal += 1;
    }
    return ordinal;
}

function _getAdjacentPageIndexForSpreadRole(pageIndex, total) {
    if (pageIndex < 0 || pageIndex >= total || _isOuterCoverPageIndex(pageIndex, total)) return -1;
    const coverKey = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    const mode = normalizeBookSettings(state.book || {}, state.book?.mode || state.bookMode || 'simple', total).mode;
    const readableOrdinal = _getReadablePageOrdinalForIndex(pageIndex, total);
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
    if (candidate < 0 || candidate >= total || _isOuterCoverPageIndex(candidate, total)) return -1;
    return candidate;
}

function _getPhysicalSpreadRoleForIndex(pageIndex, lang, total) {
    const adjIdx = _getAdjacentPageIndexForSpreadRole(pageIndex, total);
    if (adjIdx < 0) return '';
    const pageDir = _getPageDirectionForLang(lang);
    const pageOnLeft = pageDir === 'rtl' ? pageIndex >= adjIdx : pageIndex <= adjIdx;
    return pageOnLeft ? 'left' : 'right';
}

export function getPressSpreadImageDsfMetadata(section, pageIndex, langs = [], pages = _getRenderablePages()) {
    if (!_isSpreadImageSection(section)) return null;
    const groupId = section?.spreadImage?.groupId || '';
    if (!groupId) return null;
    const total = Array.isArray(pages) ? pages.length : 0;
    const rolesByLang = {};
    (Array.isArray(langs) ? langs : []).forEach((lang) => {
        const code = String(lang || '').trim();
        if (!code) return;
        const role = _getPhysicalSpreadRoleForIndex(pageIndex, code, total);
        if (role) rolesByLang[code] = role;
    });
    const defaultLang = state.defaultLang || (Array.isArray(langs) ? langs[0] : '') || 'ja';
    const physicalRole = rolesByLang[defaultLang] || Object.values(rolesByLang)[0] || '';
    return {
        groupId,
        physicalRole,
        rolesByLang,
        authoringRole: section.spreadImage.role === 'right' ? 'right' : 'left'
    };
}

function _getSpreadImageRenderOptions(section, pageIndex = -1, lang = state.activeLang || state.defaultLang || 'ja', total = _getRenderablePages().length) {
    if (!_isSpreadImageSection(section)) return {};
    const physicalRole = Number.isInteger(pageIndex) && pageIndex >= 0
        ? _getPhysicalSpreadRoleForIndex(pageIndex, lang, total)
        : '';
    const role = physicalRole || (section.spreadImage.role === 'left' ? 'left' : 'right');
    return {
        frameWidth: CANONICAL_PAGE_WIDTH * 2,
        frameHeight: CANONICAL_PAGE_HEIGHT,
        offsetX: role === 'left' ? CANONICAL_PAGE_WIDTH / 2 : -CANONICAL_PAGE_WIDTH / 2
    };
}

const PRESS_TRIAL_TEXT_BINARY_KEY = 'pressTrialTextBinary';

/** Horizon 発行 / DSF 書き出しの長時間レンダリングをユーザーが中断するための共有フラグ */
let _pressRenderCancelled = false;

export function resetPressRenderCancel() {
    _pressRenderCancelled = false;
}

export function requestPressRenderCancel() {
    _pressRenderCancelled = true;
}

export function throwIfPressRenderCancelled() {
    if (_pressRenderCancelled) {
        const e = new Error('PRESS_RENDER_CANCELLED');
        e.code = 'PRESS_RENDER_CANCELLED';
        throw e;
    }
}

/** Press Room: テキスト二値化＋高 q WebP の試行ルート（DSF 書き出し／クラウド発行の両方） */
function _isPressTextBinarizeTrialEnabled() {
    return document.getElementById('press-trial-text-binary')?.checked === true;
}

function _parseCssColorToRgb(str) {
    const s = String(str || '').trim() || '#ffffff';
    if (s.startsWith('#')) {
        const hex = s.slice(1);
        if (hex.length === 3) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16)
            };
        }
        if (hex.length === 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16)
            };
        }
    }
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return { r: 255, g: 255, b: 255 };
    c.fillStyle = '#ffffff';
    c.fillStyle = s;
    const out = c.fillStyle;
    if (typeof out === 'string' && out.startsWith('#') && out.length >= 7) {
        const h = out.slice(1);
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(String(out));
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return { r: 255, g: 255, b: 255 };
}

function _colorDistSq(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}

/**
 * アンチエイリアスを捨て、紙色・文字色のどちらか近い方へ量子化する（試行用）。
 */
function _binarizeTextCanvasForTrial(canvas, section) {
    const bg = _parseCssColorToRgb(section?.backgroundColor || '#ffffff');
    const fg = _parseCssColorToRgb(section?.textColor || '#000000');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const px = { r: d[i], g: d[i + 1], b: d[i + 2] };
        const a = d[i + 3];
        if (a < 16) {
            d[i] = bg.r;
            d[i + 1] = bg.g;
            d[i + 2] = bg.b;
            d[i + 3] = 255;
            continue;
        }
        const toBg = _colorDistSq(px, bg);
        const toFg = _colorDistSq(px, fg);
        if (toBg <= toFg) {
            d[i] = bg.r;
            d[i + 1] = bg.g;
            d[i + 2] = bg.b;
        } else {
            d[i] = fg.r;
            d[i + 1] = fg.g;
            d[i + 2] = fg.b;
        }
        d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

function _encodeTextSectionWebP(canvas, section, kindLabel) {
    if (_isPressTextBinarizeTrialEnabled()) {
        _binarizeTextCanvasForTrial(canvas, section);
        // iOS 等 WASM ロッシー q=100 は二値画に不向きで肥大化しやすい → libwebp ロスレス
        return encodeCanvasToWebP(canvas, 1, `${kindLabel}（試行・二値）`, { lossless: true });
    }
    return encodeCanvasToWebP(canvas, PRESS_TEXT_WEBP_QUALITY, kindLabel);
}

function _bindPressPublishCancelOnce() {
    const btn = document.getElementById('press-publish-cancel-btn');
    if (!btn || btn.dataset.pressCancelBound === '1') return;
    btn.dataset.pressCancelBound = '1';
    btn.addEventListener('click', () => requestPressRenderCancel());
}

function _bindPressTrialTextBinaryOnce() {
    const el = document.getElementById('press-trial-text-binary');
    if (!el || el.dataset.pressBound === '1') return;
    el.dataset.pressBound = '1';
    try {
        if (sessionStorage.getItem(PRESS_TRIAL_TEXT_BINARY_KEY) === '1') el.checked = true;
    } catch (_) { /* sessionStorage 不可環境 */ }
    el.addEventListener('change', () => {
        try {
            sessionStorage.setItem(PRESS_TRIAL_TEXT_BINARY_KEY, el.checked ? '1' : '0');
        } catch (_) { /* noop */ }
        _invalidatePressFlowLocalReleaseForSettingsChange();
        _queueSizeEstimate();
    });
}

function _resetPressFlowLocalReleasePackage(nextState = 'idle', error = null) {
    _pressFlowLocalReleasePackageController?.abort();
    _pressFlowLocalReleasePackageController = null;
    _pressFlowLocalReleasePackageRequestId += 1;
    _pressFlowLocalReleasePackageState = nextState;
    _pressFlowLocalReleasePackageError = error;
    _pressFlowLocalReleasePackageResult = null;
    _pressFlowLocalReleasePackageSignature = '';
    _pressFlowLocalReleaseSealedAssets = null;
    _updatePublishBtn();
}

function _resetPressFlowHorizonHandoff(nextState = 'idle', error = null) {
    _pressFlowHorizonHandoffController?.abort();
    _pressFlowHorizonHandoffController = null;
    _pressFlowHorizonHandoffRequestId += 1;
    _pressFlowHorizonHandoffState = nextState;
    _pressFlowHorizonHandoffError = error;
    _pressFlowHorizonHandoffResult = null;
    _pressFlowHorizonHandoffSignature = '';
    _pressFlowHorizonHandoffReleaseId = '';
    _updatePublishBtn();
}

function _invalidatePressFlowLocalReleaseForSettingsChange() {
    if (!hasFlowGroups(state)) return;
    _estimateRunId += 1;
    _pressFlowLocalReleasePlanningController?.abort();
    _pressFlowLocalReleasePlanningController = null;
    _pressFlowLocalReleasePlanningRequestId += 1;
    _pressFlowLocalReleasePlanningState = 'idle';
    _pressFlowLocalReleasePlanningError = null;
    _pressFlowLocalReleasePlanningResult = null;
    _pressFlowLocalReleasePlanningSignature = '';
    _resetPressFlowHorizonHandoff();
    _resetPressFlowLocalReleasePackage();
    _renderPressFlowLocalReleaseSummary();
    _renderPressFlowLocalReleasePackageSummary();
    _renderPressFlowLocalReleaseSize();
}

function _handlePressLocalReleaseSettingChange() {
    _invalidatePressFlowLocalReleaseForSettingsChange();
    _queueSizeEstimate();
    if (document.body?.dataset?.room === 'press' && hasFlowGroups(state)) {
        void _requestPressFlowProductionPreparation();
        if (import.meta.env.DEV) void _requestPressFlowPreflightPreview();
    }
}

// ─── Press Room 入室 ─────────────────────────────────────────────────────────

/** Press Room に入ったときにページサムネイルと言語タブを描画する */
export function enterPressRoom() {
    if (!hasFlowGroups(state)) _ensureBookSettings();
    _ensurePressThumbLang();
    if (hasFlowGroups(state)) {
        _pressFlowPreviewState = 'working';
        _pressFlowPreviewError = null;
    } else {
        _pressFlowPreviewController?.abort();
        _pressFlowPreviewController = null;
        _pressFlowPreviewState = 'ready';
        _pressFlowPreviewError = null;
    }
    if (import.meta.env.DEV) {
        _pressFixedTextPreviewState = 'working';
        _pressFixedTextPreviewError = null;
        _pressFixedTextPreviewResults = new Map();
        _pressFlowPreflightPreviewState = hasFlowGroups(state) ? 'working' : 'idle';
        _pressFlowPreflightPreviewError = null;
        _pressFlowPreflightPreviewResult = null;
        _pressFlowPreflightPreviewSignature = '';
        _pressFlowPreflightPreviewProgress = null;
    }
    _pressFlowProductionPreparationState = hasFlowGroups(state) ? 'working' : 'idle';
    _pressFlowProductionPreparationError = null;
    _pressFlowProductionPreparationResult = null;
    _pressFlowProductionPreparationSignature = '';
    _pressFlowProductionPreparationProgress = null;
    _pressFlowLocalReleasePlanningController?.abort();
    _pressFlowLocalReleasePlanningController = null;
    _pressFlowLocalReleasePlanningRequestId += 1;
    _pressFlowLocalReleasePlanningState = 'idle';
    _pressFlowLocalReleasePlanningError = null;
    _pressFlowLocalReleasePlanningResult = null;
    _pressFlowLocalReleasePlanningSignature = '';
    _resetPressFlowHorizonHandoff();
    _resetPressFlowLocalReleasePackage();
    _renderThumbLangTabs();
    _renderPageThumbs();
    _renderLangTabs();
    _renderBookSettings();
    _renderPublicationSummary();
    _updatePublishBtn();
    _bindPressTrialTextBinaryOnce();
    _bindPressPublishCancelOnce();
    _queueSizeEstimate();
    if (!_pressListenersBound) {
        _pressListenersBound = true;
        document.getElementById('press-resolution')?.addEventListener('change', _handlePressLocalReleaseSettingChange);
    }
    if (hasFlowGroups(state)) {
        void _requestPressFlowPreview();
    } else if (import.meta.env.DEV) {
        void _requestPressFixedTextPreview();
    }
}

export function leavePressRoom() {
    _pressFlowPreviewController?.abort();
    _pressFlowPreviewController = null;
    _pressFlowPreviewRequestId += 1;
    _pressFlowPreviewState = 'idle';
    _pressFixedTextPreviewRequestId += 1;
    _pressFixedTextPreviewState = 'idle';
    _pressFixedTextPreviewError = null;
    _pressFixedTextPreviewResults = new Map();
    _pressFlowPreflightPreviewController?.abort();
    _pressFlowPreflightPreviewController = null;
    _pressFlowPreflightPreviewRequestId += 1;
    _pressFlowPreflightPreviewState = 'idle';
    _pressFlowPreflightPreviewError = null;
    _pressFlowPreflightPreviewResult = null;
    _pressFlowPreflightPreviewSignature = '';
    _pressFlowPreflightPreviewProgress = null;
    _pressFlowProductionPreparationController?.abort();
    _pressFlowProductionPreparationController = null;
    _pressFlowProductionPreparationRequestId += 1;
    _pressFlowProductionPreparationState = 'idle';
    _pressFlowProductionPreparationError = null;
    _pressFlowProductionPreparationResult = null;
    _pressFlowProductionPreparationSignature = '';
    _pressFlowProductionPreparationProgress = null;
    _pressFlowLocalReleasePlanningController?.abort();
    _pressFlowLocalReleasePlanningController = null;
    _pressFlowLocalReleasePlanningRequestId += 1;
    _pressFlowLocalReleasePlanningState = 'idle';
    _pressFlowLocalReleasePlanningError = null;
    _pressFlowLocalReleasePlanningResult = null;
    _pressFlowLocalReleasePlanningSignature = '';
    _resetPressFlowHorizonHandoff();
    _resetPressFlowLocalReleasePackage();
    document.getElementById('press-flow-local-release-summary')?.remove();
    document.getElementById('press-flow-local-release-package-summary')?.remove();
    clearTimeout(_estimateTimer);
    _estimateTimer = null;
    _estimateRunId += 1;
}

function _ensurePressThumbLang() {
    const langs = state.languages || ['ja'];
    if (!langs.includes(_pressThumbLang)) {
        _pressThumbLang = state.activeLang && langs.includes(state.activeLang)
            ? state.activeLang
            : langs[0];
    }
}

function _getPressThumbLang() {
    _ensurePressThumbLang();
    return _pressThumbLang || state.defaultLang || 'ja';
}

function _getPressFlowPreviewProjection() {
    if (!hasFlowGroups(state)) return null;
    return getCachedFlowRuntimePageProjection(state, _getPressThumbLang(), state.sections || [], document, 'press');
}

function _getPressFlowPreviewErrorMessage(error) {
    if (error?.code === 'FLOW_LANGUAGE_TYPOGRAPHY_MISSING') {
        return 'Flow原稿の組版設定を確認してください。';
    }
    if (error?.code === 'MAX_PAGES_EXCEEDED') {
        return 'Flow原稿のページ数が安全上限を超えました。';
    }
    return error?.message || 'Flowページの生成に失敗しました。';
}

async function _requestPressFlowPreview() {
    if (!hasFlowGroups(state)) return null;
    const languageKey = _getPressThumbLang();
    const requestSignature = createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, 'press');
    const productionSignature = _createPressFlowPreflightPreviewSignature();
    if (_pressFlowProductionPreparationSignature !== productionSignature) {
        _pressFlowProductionPreparationController?.abort();
        _pressFlowProductionPreparationController = null;
        _pressFlowProductionPreparationRequestId += 1;
        _pressFlowProductionPreparationState = 'working';
        _pressFlowProductionPreparationError = null;
        _pressFlowProductionPreparationResult = null;
        _pressFlowProductionPreparationProgress = null;
        _pressFlowLocalReleasePlanningController?.abort();
        _pressFlowLocalReleasePlanningController = null;
        _pressFlowLocalReleasePlanningRequestId += 1;
        _pressFlowLocalReleasePlanningState = 'idle';
        _pressFlowLocalReleasePlanningError = null;
        _pressFlowLocalReleasePlanningResult = null;
        _pressFlowLocalReleasePlanningSignature = '';
        _resetPressFlowHorizonHandoff();
        _resetPressFlowLocalReleasePackage();
    }
    const requestId = _pressFlowPreviewRequestId + 1;
    _pressFlowPreviewRequestId = requestId;
    _pressFlowPreviewController?.abort();
    const controller = new AbortController();
    _pressFlowPreviewController = controller;
    _pressFlowPreviewState = 'working';
    _pressFlowPreviewError = null;
    _renderPageThumbs();
    _renderBookSettings();
    try {
        const projection = await createFlowRuntimePageProjection(state, {
            ownerDocument: document,
            sessionScope: 'press',
            fixedPages: state.sections || [],
            languageKey,
            revision: requestId,
            signal: controller.signal,
            onProgress(progress) {
                if (requestId !== _pressFlowPreviewRequestId || controller.signal.aborted) return;
                const container = document.getElementById('press-page-thumbs');
                const progressEl = container?.querySelector('[data-flow-press-progress]');
                if (progressEl) progressEl.textContent = `Flowページを生成中… ${progress.generatedPageCount}ページ`;
            },
        });
        if (
            controller.signal.aborted
            || requestId !== _pressFlowPreviewRequestId
            || requestSignature !== createFlowRuntimeProjectionSignature(state, languageKey, state.sections || [], document, 'press')
            || languageKey !== _getPressThumbLang()
        ) return null;
        _pressFlowPreviewController = null;
        _pressFlowPreviewState = 'ready';
        _pressFlowPreviewError = null;
        _renderPageThumbs();
        _renderBookSettings();
        _updatePublishBtn();
        _queueSizeEstimate();
        void _requestPressFlowProductionPreparation();
        if (import.meta.env.DEV) {
            void _requestPressFixedTextPreview();
            void _requestPressFlowPreflightPreview();
        }
        return projection;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Flow pages] Press preview failed:', error);
        if (requestId !== _pressFlowPreviewRequestId) return null;
        _pressFlowPreviewController = null;
        _pressFlowPreviewState = 'error';
        _pressFlowPreviewError = error;
        _pressFlowProductionPreparationController?.abort();
        _pressFlowProductionPreparationController = null;
        _pressFlowProductionPreparationRequestId += 1;
        _pressFlowProductionPreparationState = 'error';
        _pressFlowProductionPreparationError = error;
        _pressFlowProductionPreparationResult = null;
        _pressFlowProductionPreparationProgress = null;
        _pressFlowLocalReleasePlanningController?.abort();
        _pressFlowLocalReleasePlanningController = null;
        _pressFlowLocalReleasePlanningRequestId += 1;
        _pressFlowLocalReleasePlanningState = 'error';
        _pressFlowLocalReleasePlanningError = error;
        _pressFlowLocalReleasePlanningResult = null;
        _pressFlowLocalReleasePlanningSignature = '';
        _resetPressFlowHorizonHandoff('error', error);
        _resetPressFlowLocalReleasePackage('error', error);
        _renderPageThumbs();
        _renderPressFlowProductionPreparationSummary();
        _renderPressFlowLocalReleaseSummary();
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        _renderBookSettings();
        return null;
    }
}

function _getCurrentPressPreviewPages() {
    if (hasFlowGroups(state)) return _getPressFlowPreviewProjection()?.pages || null;
    const sections = _getRenderablePages();
    const pageBlocks = Array.isArray(state.blocks)
        ? state.blocks.filter((block) => block?.kind === 'page')
        : [];
    return sections.map((section, index) => ({
        kind: 'fixed',
        section,
        index,
        blockId: pageBlocks[index]?.id || '',
        block: pageBlocks[index] || null,
    }));
}

function _getPressFixedTextPreviewKey(previewPage, language) {
    const blockId = previewPage?.blockId || previewPage?.block?.id || '';
    return `${encodeURIComponent(blockId)}::${encodeURIComponent(language)}`;
}

function _findPressFixedBlock(previewPage) {
    if (previewPage?.block?.kind === 'page') return previewPage.block;
    const blockId = previewPage?.blockId;
    return Array.isArray(state.blocks)
        ? state.blocks.find((block) => block?.kind === 'page' && block.id === blockId) || null
        : null;
}

function _renderPressFixedTextDevSummary(previewPages = _getCurrentPressPreviewPages()) {
    if (!import.meta.env.DEV) return;
    const thumbs = document.getElementById('press-page-thumbs');
    if (!thumbs) return;
    let summary = document.getElementById('press-fixed-text-dev-summary');
    if (!summary) {
        summary = document.createElement('div');
        summary.id = 'press-fixed-text-dev-summary';
        summary.className = 'press-fixed-text-dev-summary';
        summary.dataset.testid = 'press-fixed-text-dev-summary';
        thumbs.insertAdjacentElement('afterend', summary);
    }
    const textPages = Array.isArray(previewPages)
        ? previewPages.filter((page) => page?.kind === 'fixed' && page.section?.type === 'text')
        : [];
    summary.dataset.state = _pressFixedTextPreviewState;
    if (_pressFixedTextPreviewState === 'working') {
        summary.innerHTML = '<strong>9A-3B ローカル確認</strong><span>Fixed text配信候補を検証中…</span>';
        return;
    }
    if (_pressFixedTextPreviewState === 'error') {
        summary.innerHTML = `<strong>9A-3B ローカル確認</strong><span role="alert">${_esc(_pressFixedTextPreviewError?.message || 'previewに失敗しました。')}</span>`;
        return;
    }
    if (!textPages.length) {
        summary.innerHTML = '<strong>9A-3B ローカル確認</strong><span>Fixed textページはありません。発行経路は変更されません。</span>';
        return;
    }
    const results = textPages.map((page) => ({
        page,
        result: _pressFixedTextPreviewResults.get(_getPressFixedTextPreviewKey(page, _getPressThumbLang())),
    }));
    const fixedTextCount = results.filter((entry) => entry.result?.ok).length;
    const fallbacks = results.filter((entry) => entry.result && !entry.result.ok);
    const fallbackRows = fallbacks.map(({ page, result }) => {
        const code = result.fallback?.code || 'UNKNOWN';
        const message = _pressFixedTextPreviewModule?.getFixedTextPressPreviewFallbackMessage(result)
            || result.fallback?.message
            || 'WebP経路を維持します。';
        return `<li><code>${_esc(code)}</code><span>${_esc(message)}</span></li>`;
    }).join('');
    summary.innerHTML = `
        <strong>9A-3B ローカル確認</strong>
        <span><b>${fixedTextCount}</b>ページ fixedText候補 ／ <b>${fallbacks.length}</b>ページ WebP継続</span>
        ${fallbackRows ? `<ul>${fallbackRows}</ul>` : ''}
        <small>fixture fontによる開発previewです。DSF書き出し・Horizon発行には使用されません。</small>
    `;
}

function _createPressFlowPreflightPreviewSignature() {
    return JSON.stringify([
        state.version,
        state.defaultLang,
        state.languages || [],
        state.languageConfigs || {},
        _getSelectedPressLangs(),
        state.blocks || [],
    ]);
}

function _renderPressFlowPreflightDevSummary() {
    if (!import.meta.env.DEV) return;
    const thumbs = document.getElementById('press-page-thumbs');
    if (!thumbs) return;
    let summary = document.getElementById('press-flow-preflight-dev-summary');
    if (!hasFlowGroups(state)) {
        summary?.remove();
        return;
    }
    if (!summary) {
        summary = document.createElement('div');
        summary.id = 'press-flow-preflight-dev-summary';
        summary.className = 'press-fixed-text-dev-summary press-flow-preflight-dev-summary';
        summary.dataset.testid = 'press-flow-preflight-dev-summary';
        const fixedSummary = document.getElementById('press-fixed-text-dev-summary');
        (fixedSummary || thumbs).insertAdjacentElement('afterend', summary);
    }
    summary.dataset.state = _pressFlowPreflightPreviewState;
    if (_pressFlowPreflightPreviewState === 'working') {
        const progress = _pressFlowPreflightPreviewProgress;
        const progressText = progress
            ? `${String(progress.language || '').toUpperCase()} / Flow ${progress.groupIndex + 1} of ${progress.groupCount}`
            : '言語別の固定テキスト候補を計測中…';
        summary.innerHTML = `<strong>9A-6A Flow配信ローカル確認</strong><span aria-live="polite">${_esc(progressText)}</span>`;
        return;
    }
    if (_pressFlowPreflightPreviewState === 'error') {
        summary.innerHTML = `<strong>9A-6A Flow配信ローカル確認</strong><span role="alert">${_esc(_pressFlowPreflightPreviewError?.message || '確認に失敗しました。')}</span>`;
        return;
    }
    const languageResults = _pressFlowPreflightPreviewResult?.languages || [];
    if (!languageResults.length) {
        summary.innerHTML = '<strong>9A-6A Flow配信ローカル確認</strong><span>確認結果はありません。</span>';
        return;
    }
    const rows = languageResults.map((result) => {
        const firstIssue = result.preparationIssues?.[0] || result.preflight?.issues?.[0] || null;
        const issueMessage = firstIssue
            ? (_pressFlowPreflightPreviewModule?.getFlowPressPreflightPreviewIssueMessage(firstIssue)
                || firstIssue.message
                || '固定テキスト候補を確認できませんでした。')
            : '';
        const flowPages = result.preflight?.summary?.flowPageCount ?? 0;
        const deliveryPages = result.preflight?.summary?.deliveryPageCount ?? 0;
        const stateLabel = result.state === 'ready'
            ? `<b>${flowPages}</b> Flow fixedText候補 ／ 全${deliveryPages}ページ`
            : `停止${flowPages > 0 ? ` ／ <b>${flowPages}</b>ページ候補済み` : ''}`;
        return `<li data-testid="press-flow-preflight-language" data-language="${_esc(result.language)}" data-state="${_esc(result.state)}">
            <strong>${_esc(String(result.language).toUpperCase())}</strong>
            <span>${stateLabel}</span>
            ${firstIssue ? `<code>${_esc(firstIssue.code || 'UNKNOWN')}</code><span>${_esc(issueMessage)}</span>` : ''}
        </li>`;
    }).join('');
    summary.innerHTML = `
        <strong>9A-6A Flow配信ローカル確認</strong>
        <span>${_pressFlowPreflightPreviewResult.ok ? '全言語がfixedText候補です' : '停止理由を確認してください'}</span>
        <ul>${rows}</ul>
        <small>ローカルfixture fontによる候補確認です。DSF書き出し・Horizon発行・容量見積りには使用されません。</small>
    `;
}

function _renderPressFlowProductionPreparationSummary() {
    const thumbs = document.getElementById('press-page-thumbs');
    if (!thumbs) return;
    let summary = document.getElementById('press-flow-production-preparation-summary');
    if (!hasFlowGroups(state)) {
        summary?.remove();
        return;
    }
    if (!summary) {
        summary = document.createElement('div');
        summary.id = 'press-flow-production-preparation-summary';
        summary.className = 'press-flow-production-preparation-summary';
        summary.dataset.testid = 'press-flow-production-preparation-summary';
        const devSummary = document.getElementById('press-flow-preflight-dev-summary');
        const fixedSummary = document.getElementById('press-fixed-text-dev-summary');
        (devSummary || fixedSummary || thumbs).insertAdjacentElement('afterend', summary);
    }
    summary.dataset.state = _pressFlowProductionPreparationState === 'ready' && _pressFlowProductionPreparationResult
        ? (_pressFlowProductionPreparationResult.ok ? 'ready' : 'blocked')
        : _pressFlowProductionPreparationState;
    if (_pressFlowProductionPreparationState === 'working') {
        const progress = _pressFlowProductionPreparationProgress;
        const progressText = progress
            ? `${String(progress.language || '').toUpperCase()} / Flow ${progress.groupIndex + 1} of ${progress.groupCount}`
            : '本番フォント登録と固定テキスト配信条件を確認中…';
        summary.innerHTML = `<strong>9A-6B Flow配信準備</strong><span aria-live="polite">${_esc(progressText)}</span>`;
        return;
    }
    if (_pressFlowProductionPreparationState === 'error') {
        summary.innerHTML = `<strong>9A-6B Flow配信準備</strong><span role="alert">${_esc(_pressFlowProductionPreparationError?.message || '準備判定に失敗しました。')}</span>`;
        return;
    }
    const languageResults = _pressFlowProductionPreparationResult?.languages || [];
    if (!languageResults.length) {
        summary.innerHTML = '<strong>9A-6B Flow配信準備</strong><span>本番準備の判定結果はありません。</span>';
        return;
    }
    const rows = languageResults.map((result) => {
        const firstIssue = result.preparationIssues?.[0] || result.preflight?.issues?.[0] || null;
        const issueMessage = firstIssue
            ? (_pressFlowProductionPreparationModule?.getFlowPressPublicationPreparationIssueMessage(firstIssue)
                || firstIssue.message
                || '本番準備を完了できませんでした。')
            : '';
        const flowPages = result.preflight?.summary?.flowPageCount ?? 0;
        const stateLabel = result.state === 'ready'
            ? `<b>${flowPages}</b>ページ 本番preflight合格`
            : '発行準備を停止';
        return `<li data-testid="press-flow-production-language" data-language="${_esc(result.language)}" data-state="${_esc(result.state)}">
            <strong>${_esc(String(result.language).toUpperCase())}</strong>
            <span>${stateLabel}</span>
            ${firstIssue ? `<code>${_esc(firstIssue.code || 'UNKNOWN')}</code><span>${_esc(issueMessage)}</span>` : ''}
        </li>`;
    }).join('');
    const fontCount = _pressFlowProductionPreparationResult.productionFontCount ?? 0;
    summary.innerHTML = `
        <strong>9A-6B Flow配信準備</strong>
        <span>${_pressFlowProductionPreparationResult.ok ? '本番preflightに合格しました' : '本番発行の準備が完了していません'}</span>
        <small>本番認定フォント ${fontCount}件</small>
        <ul>${rows}</ul>
        <small>これは発行直前の準備判定です。合格後はローカル配信設計と容量見積りへ進みますが、DSF書き出し・upload・発行は行いません。</small>
    `;
}

function _formatPressPayloadBytes(byteLength) {
    const bytes = Number(byteLength);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _createPressFlowLocalReleasePlanningSignature() {
    const selectedLanguages = _getSelectedPressLangs();
    return JSON.stringify([
        _createPressFlowPreflightPreviewSignature(),
        resolvePressResolutionKey(document.getElementById('press-resolution')?.value),
        selectedLanguages,
        Object.fromEntries(selectedLanguages.map((language) => [language, _getLangDirection(language)])),
        _isPressTextBinarizeTrialEnabled(),
    ]);
}

function _createPressFlowLocalReleasePackageSignature() {
    return JSON.stringify([
        _createPressFlowLocalReleasePlanningSignature(),
        state.projectId || '',
        state.workId || '',
        state.releaseId || '',
        state.title || '',
        state.labelName || '',
        state.rating || '',
        state.license || '',
        state.meta || {},
        state.created?.seconds ?? state.created ?? null,
        state.user?.email || '',
        state.bookMode || '',
        state.book || {},
    ]);
}

function _createPressFlowHorizonIdentityError(code, message) {
    const error = new Error(message);
    error.code = code;
    error.issues = [{ severity: 'error', code, path: 'identity', message }];
    return error;
}

function _getPressFlowHorizonIdentity({ createReleaseId = false } = {}) {
    const authUid = String(auth.currentUser?.uid || '').trim();
    const stateUid = String(state.uid || '').trim();
    if (!authUid) {
        throw _createPressFlowHorizonIdentityError(
            'FLOW_HORIZON_HANDOFF_LOGIN_REQUIRED',
            'Horizon配信先を確定するにはログインが必要です。',
        );
    }
    if (stateUid && stateUid !== authUid) {
        throw _createPressFlowHorizonIdentityError(
            'FLOW_HORIZON_HANDOFF_UID_MISMATCH',
            'Studioの作品所有者と現在のログインユーザーが一致しません。',
        );
    }
    const projectId = String(state.projectId || '').trim();
    const workId = String(state.workId || '').trim();
    if (!projectId || !workId) {
        throw _createPressFlowHorizonIdentityError(
            'FLOW_HORIZON_HANDOFF_CLOUD_PROJECT_REQUIRED',
            '作品をクラウド保存するとHorizon配信先をdry-runできます。',
        );
    }
    const publicBaseUrl = String(import.meta.env.VITE_R2_PUBLIC_URL || '').trim();
    if (!/^https:\/\//.test(publicBaseUrl)) {
        throw _createPressFlowHorizonIdentityError(
            'FLOW_HORIZON_HANDOFF_PUBLIC_ORIGIN_MISSING',
            'Horizon配信用のHTTPS公開originが設定されていません。',
        );
    }
    if (createReleaseId && !_pressFlowHorizonHandoffReleaseId) {
        _pressFlowHorizonHandoffReleaseId = createId('rel');
    }
    return {
        uid: authUid,
        workId,
        releaseId: _pressFlowHorizonHandoffReleaseId,
        publicBaseUrl,
    };
}

function _createPressFlowHorizonHandoffSignature(identity) {
    return JSON.stringify([
        _createPressFlowLocalReleasePlanningSignature(),
        identity.uid,
        identity.workId,
        identity.releaseId,
        identity.publicBaseUrl,
    ]);
}

function _pickPressFlowLocalMetadataValue(languages, key) {
    const defaultLang = languages.includes(state.defaultLang) ? state.defaultLang : languages[0];
    const preferred = state.meta?.[defaultLang]?.[key];
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
    for (const language of languages) {
        const value = state.meta?.[language]?.[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function _toPressFlowLocalIsoDate(value, fallback) {
    try {
        const date = value?.toDate instanceof Function ? value.toDate() : new Date(value);
        if (Number.isFinite(date.getTime())) return date.toISOString();
    } catch (_) { /* use local verification time */ }
    return fallback;
}

function _createPressFlowLocalReleaseMetadata(languages) {
    const now = new Date().toISOString();
    const workId = String(state.workId || '').trim() || 'press-local-work';
    const title = String(state.title || '').trim()
        || _pickPressFlowLocalMetadataValue(languages, 'title')
        || 'Untitled';
    const author = _pickPressFlowLocalMetadataValue(languages, 'author')
        || String(state.user?.email || '').trim()
        || 'Unknown Author';
    const localizedKeys = ['title', 'author', 'description', 'linerNotes', 'copyright'];
    const localizedMeta = {};
    for (const language of languages) {
        const source = state.meta?.[language];
        if (!source || typeof source !== 'object') continue;
        const entry = Object.fromEntries(localizedKeys
            .filter((key) => typeof source[key] === 'string')
            .map((key) => [key, source[key]]));
        if (Object.keys(entry).length) localizedMeta[language] = entry;
    }
    return {
        projectId: String(state.projectId || '').trim(),
        workId,
        releaseId: 'press-local-release-preview',
        title,
        author,
        labelName: String(state.labelName || '').trim(),
        rating: String(state.rating || '').trim() || 'all',
        license: String(state.license || '').trim() || 'all-rights-reserved',
        localizedMeta,
        created: _toPressFlowLocalIsoDate(state.created, now),
        modified: now,
        generator: 'DSF Studio local package verification',
        spread: state.bookMode === 'none' || state.book?.mode === 'none' ? 'none' : 'auto',
    };
}

function _renderPressFlowLocalReleaseSummary() {
    const thumbs = document.getElementById('press-page-thumbs');
    if (!thumbs) return;
    let summary = document.getElementById('press-flow-local-release-summary');
    if (!hasFlowGroups(state)) {
        summary?.remove();
        return;
    }
    if (!summary) {
        summary = document.createElement('div');
        summary.id = 'press-flow-local-release-summary';
        summary.className = 'press-flow-production-preparation-summary press-flow-local-release-summary';
        summary.dataset.testid = 'press-flow-local-release-summary';
        const productionSummary = document.getElementById('press-flow-production-preparation-summary');
        (productionSummary || thumbs).insertAdjacentElement('afterend', summary);
    }
    summary.dataset.state = _pressFlowLocalReleasePlanningState;
    summary.dataset.horizonState = _pressFlowHorizonHandoffState;
    summary.dataset.horizonReady = _pressFlowHorizonHandoffState === 'ready'
        && _pressFlowHorizonHandoffResult?.readyForUpload === true
        ? 'true'
        : 'false';
    if (_pressFlowLocalReleasePlanningState === 'working') {
        summary.innerHTML = '<strong>9A-6C ローカル配信設計</strong><span aria-live="polite">WebP実bytesと固定テキストmanifestから容量を計算中…</span>';
        return;
    }
    if (_pressFlowLocalReleasePlanningState === 'error') {
        const issue = _pressFlowLocalReleasePlanningError?.issues?.[0];
        const code = issue?.code || _pressFlowLocalReleasePlanningError?.code || 'FLOW_LOCAL_RELEASE_FAILED';
        summary.innerHTML = `
            <strong>9A-6C ローカル配信設計</strong>
            <span role="alert">容量計算を完了できませんでした</span>
            <code>${_esc(code)}</code>
            <small>${_esc(issue?.message || _pressFlowLocalReleasePlanningError?.message || '不明なエラー')}</small>
        `;
        return;
    }
    if (_pressFlowLocalReleasePlanningState === 'blocked') {
        summary.innerHTML = '<strong>9A-6C ローカル配信設計</strong><span>本番preflightが停止しているため容量計算を行いません。</span>';
        return;
    }
    const result = _pressFlowLocalReleasePlanningResult;
    if (_pressFlowLocalReleasePlanningState !== 'ready' || !result?.ready) {
        summary.innerHTML = '<strong>9A-6C ローカル配信設計</strong><span>本番preflightの完了を待っています。</span>';
        return;
    }
    const value = result.summary;
    const horizonStatus = _renderPressFlowHorizonHandoffStatus();
    summary.innerHTML = `
        <strong>9A-6C ローカル配信設計</strong>
        <span><b>${value.fixedTextPageCount}</b> fixedText ／ <b>${value.imagePageCount}</b> WebP</span>
        <span>Horizon ${_formatPressPayloadBytes(value.horizonPayloadBytes)}</span>
        <span>ダウンロード ${_formatPressPayloadBytes(value.portablePayloadBytes)}</span>
        ${horizonStatus}
        <small>同梱font ${_formatPressPayloadBytes(value.portableFontBytes)}（${value.portableFontFileCount}ファイル）。payload計算結果で、続くZIP検証もメモリ内だけで行います。</small>
    `;
}

function _renderPressFlowHorizonHandoffStatus() {
    const attributes = `class="press-flow-horizon-readiness" data-testid="press-flow-horizon-handoff-readiness" data-state="${_esc(_pressFlowHorizonHandoffState)}" aria-live="polite"`;
    if (_pressFlowHorizonHandoffState === 'working') {
        return `<span ${attributes}><b>Horizon配信準備</b> exact WebPと配信pathを検証中…</span>`;
    }
    if (_pressFlowHorizonHandoffState === 'blocked') {
        const issue = _pressFlowHorizonHandoffError?.issues?.[0];
        const code = issue?.code || _pressFlowHorizonHandoffError?.code || 'FLOW_HORIZON_HANDOFF_BLOCKED';
        const message = issue?.message || _pressFlowHorizonHandoffError?.message || 'Horizon dry-runの前提が揃っていません。';
        return `<span ${attributes}><b>Horizon配信準備</b> ${_esc(message)} <code>${_esc(code)}</code></span>`;
    }
    if (_pressFlowHorizonHandoffState === 'error') {
        const issue = _pressFlowHorizonHandoffError?.issues?.[0];
        const code = issue?.code || _pressFlowHorizonHandoffError?.code || 'FLOW_HORIZON_HANDOFF_FAILED';
        const message = issue?.message || _pressFlowHorizonHandoffError?.message || 'Horizon dry-runを完了できませんでした。';
        return `<span ${attributes} role="alert"><b>Horizon配信準備</b> 検証失敗: ${_esc(message)} <code>${_esc(code)}</code></span>`;
    }
    const result = _pressFlowHorizonHandoffResult;
    if (_pressFlowHorizonHandoffState === 'ready' && result?.readyForUpload) {
        return `<span ${attributes}><b>Horizon配信準備</b> dry-run合格: ${result.summary.fileCount}ファイル／${_formatPressPayloadBytes(result.summary.totalBytes)}（WebP ${result.summary.imageFileCount}件をexact照合）。アップロード未実行。</span>`;
    }
    return `<span ${attributes}><b>Horizon配信準備</b> ローカル配信設計の完了を待っています。</span>`;
}

function _renderPressFlowLocalReleasePackageSummary() {
    const thumbs = document.getElementById('press-page-thumbs');
    if (!thumbs) return;
    let summary = document.getElementById('press-flow-local-release-package-summary');
    if (!hasFlowGroups(state)) {
        summary?.remove();
        return;
    }
    if (!summary) {
        summary = document.createElement('div');
        summary.id = 'press-flow-local-release-package-summary';
        summary.className = 'press-flow-production-preparation-summary press-flow-local-release-package-summary';
        summary.dataset.testid = 'press-flow-local-release-package-summary';
        const planningSummary = document.getElementById('press-flow-local-release-summary');
        (planningSummary || thumbs).insertAdjacentElement('afterend', summary);
    }
    summary.dataset.state = _pressFlowLocalReleasePackageState;
    if (_pressFlowLocalReleasePackageState === 'working') {
        summary.innerHTML = '<strong>9A-6C-B ローカルZIP検証</strong><span aria-live="polite">実WOFF2とsealed WebPからDSF ZIPを生成・再展開中…</span>';
        return;
    }
    if (_pressFlowLocalReleasePackageState === 'error') {
        const issue = _pressFlowLocalReleasePackageError?.issues?.[0];
        const code = issue?.code || _pressFlowLocalReleasePackageError?.code || 'FLOW_LOCAL_PACKAGE_FAILED';
        summary.innerHTML = `
            <strong>9A-6C-B ローカルZIP検証</strong>
            <span role="alert">DSF ZIPの検証を完了できませんでした</span>
            <code>${_esc(code)}</code>
            <small>${_esc(issue?.message || _pressFlowLocalReleasePackageError?.message || '不明なエラー')}</small>
        `;
        return;
    }
    const result = _pressFlowLocalReleasePackageResult;
    if (_pressFlowLocalReleasePackageState !== 'ready' || !result?.ready) {
        summary.innerHTML = '<strong>9A-6C-B ローカルZIP検証</strong><span>ローカル配信設計の完了を待っています。</span>';
        return;
    }
    const value = result.summary;
    summary.innerHTML = `
        <strong>9A-6C-B ローカルZIP検証</strong>
        <span><b>${value.entryCount}</b>ファイル round-trip合格</span>
        <span>正確な.dsf ${_formatPressPayloadBytes(value.zipByteLength)}</span>
        <span>展開時 ${_formatPressPayloadBytes(value.inventoryByteLength)}</span>
        <small>SHA-256 ${_esc(value.zipSha256.slice(0, 16))}… 。この検証済みBlobだけをDSF書き出しに使用できます。upload・Horizon発行は行いません。</small>
    `;
}

function _renderPressFlowLocalReleaseSize() {
    const element = document.getElementById('press-size-estimate');
    if (!element || !hasFlowGroups(state)) return;
    if (_pressFlowLocalReleasePlanningState === 'working') {
        element.textContent = 'Flow配信サイズを計算中…';
        return;
    }
    if (_pressFlowLocalReleasePlanningState === 'error') {
        element.textContent = 'Flow配信サイズを計算できません';
        return;
    }
    if (_pressFlowLocalReleasePlanningState === 'blocked') {
        element.textContent = 'Flow本番preflightが停止しています';
        return;
    }
    const summary = _pressFlowLocalReleasePlanningResult?.summary;
    if (_pressFlowLocalReleasePlanningState === 'ready' && summary) {
        if (_pressFlowLocalReleasePackageState === 'working') {
            element.textContent = `Horizon ≈ ${_formatPressPayloadBytes(summary.horizonPayloadBytes)} ／ ダウンロードZIPを検証中…`;
            return;
        }
        if (_pressFlowLocalReleasePackageState === 'ready' && _pressFlowLocalReleasePackageResult?.summary) {
            element.textContent = `Horizon ≈ ${_formatPressPayloadBytes(summary.horizonPayloadBytes)} ／ ダウンロード.dsf ${_formatPressPayloadBytes(_pressFlowLocalReleasePackageResult.summary.zipByteLength)}（実測）`;
            return;
        }
        const suffix = _pressFlowLocalReleasePackageState === 'error' ? '（ZIP検証失敗）' : '（payload）';
        element.textContent = `Horizon ≈ ${_formatPressPayloadBytes(summary.horizonPayloadBytes)} ／ ダウンロード ≈ ${_formatPressPayloadBytes(summary.portablePayloadBytes)}${suffix}`;
        return;
    }
    element.textContent = 'Flow本番preflightを確認中…';
}

async function _requestPressFixedTextPreview() {
    if (!import.meta.env.DEV || document.body?.dataset?.room !== 'press') return null;
    const previewPages = _getCurrentPressPreviewPages();
    if (!previewPages) return null;
    const language = _getPressThumbLang();
    const requestId = _pressFixedTextPreviewRequestId + 1;
    _pressFixedTextPreviewRequestId = requestId;
    _pressFixedTextPreviewState = 'working';
    _pressFixedTextPreviewError = null;
    _pressFixedTextPreviewResults = new Map();
    _renderPageThumbs();
    try {
        _pressFixedTextPreviewModule ||= await import('./fixed-text-press-preview.js');
        const textPages = previewPages.filter((page) => page?.kind === 'fixed' && page.section?.type === 'text');
        const results = new Map();
        for (const previewPage of textPages) {
            if (requestId !== _pressFixedTextPreviewRequestId || document.body?.dataset?.room !== 'press') return null;
            const block = _findPressFixedBlock(previewPage);
            const result = await _pressFixedTextPreviewModule.prepareFixedTextPressPreview({
                block,
                section: previewPage.section,
                language,
                pageId: `press-preview:${block?.id || previewPage.index || 0}:${language}`,
                pageLabel: getPageDisplayLabel(
                    previewPage.index ?? previewPages.indexOf(previewPage),
                    previewPages.length,
                    state.book,
                    state.bookMode,
                ),
                languageConfigs: state.languageConfigs || {},
                documentRef: document,
            });
            results.set(_getPressFixedTextPreviewKey(previewPage, language), result);
        }
        if (requestId !== _pressFixedTextPreviewRequestId || language !== _getPressThumbLang()) return null;
        _pressFixedTextPreviewResults = results;
        _pressFixedTextPreviewState = 'ready';
        _renderPageThumbs();
        return results;
    } catch (error) {
        if (requestId !== _pressFixedTextPreviewRequestId) return null;
        console.error('[Press fixedText preview] failed:', error);
        _pressFixedTextPreviewError = error;
        _pressFixedTextPreviewState = 'error';
        _renderPageThumbs();
        return null;
    }
}

async function _requestPressFlowPreflightPreview() {
    if (!import.meta.env.DEV || document.body?.dataset?.room !== 'press' || !hasFlowGroups(state)) return null;
    const signature = _createPressFlowPreflightPreviewSignature();
    if (
        _pressFlowPreflightPreviewState === 'ready'
        && _pressFlowPreflightPreviewResult
        && _pressFlowPreflightPreviewSignature === signature
    ) {
        _renderPressFlowPreflightDevSummary();
        return _pressFlowPreflightPreviewResult;
    }
    const requestId = _pressFlowPreflightPreviewRequestId + 1;
    _pressFlowPreflightPreviewRequestId = requestId;
    _pressFlowPreflightPreviewController?.abort();
    const controller = new AbortController();
    _pressFlowPreflightPreviewController = controller;
    _pressFlowPreflightPreviewState = 'working';
    _pressFlowPreflightPreviewError = null;
    _pressFlowPreflightPreviewResult = null;
    _pressFlowPreflightPreviewProgress = null;
    _renderPressFlowPreflightDevSummary();
    try {
        _pressFlowPreflightPreviewModule ||= await import('./flow-press-preflight-preview.js');
        const result = await _pressFlowPreflightPreviewModule.prepareFlowPressPreflightPreview({
            project: state,
            languages: _getSelectedPressLangs(),
            revision: requestId,
            documentRef: document,
            signal: controller.signal,
            onProgress(progress) {
                if (requestId !== _pressFlowPreflightPreviewRequestId || controller.signal.aborted) return;
                _pressFlowPreflightPreviewProgress = progress;
                _renderPressFlowPreflightDevSummary();
            },
        });
        if (
            controller.signal.aborted
            || requestId !== _pressFlowPreflightPreviewRequestId
            || signature !== _createPressFlowPreflightPreviewSignature()
            || document.body?.dataset?.room !== 'press'
        ) return null;
        _pressFlowPreflightPreviewController = null;
        _pressFlowPreflightPreviewState = 'ready';
        _pressFlowPreflightPreviewError = null;
        _pressFlowPreflightPreviewResult = result;
        _pressFlowPreflightPreviewSignature = signature;
        _pressFlowPreflightPreviewProgress = null;
        _renderPressFlowPreflightDevSummary();
        return result;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Press Flow preflight preview] failed:', error);
        if (requestId !== _pressFlowPreflightPreviewRequestId) return null;
        _pressFlowPreflightPreviewController = null;
        _pressFlowPreflightPreviewState = 'error';
        _pressFlowPreflightPreviewError = error;
        _pressFlowPreflightPreviewResult = null;
        _pressFlowPreflightPreviewProgress = null;
        _renderPressFlowPreflightDevSummary();
        return null;
    }
}

async function _requestPressFlowProductionPreparation() {
    if (document.body?.dataset?.room !== 'press' || !hasFlowGroups(state)) return null;
    const signature = _createPressFlowPreflightPreviewSignature();
    if (
        _pressFlowProductionPreparationState === 'ready'
        && _pressFlowProductionPreparationResult
        && _pressFlowProductionPreparationSignature === signature
    ) {
        _renderPressFlowProductionPreparationSummary();
        void _requestPressFlowLocalReleasePlanning(_pressFlowProductionPreparationResult);
        return _pressFlowProductionPreparationResult;
    }
    const requestId = _pressFlowProductionPreparationRequestId + 1;
    _pressFlowProductionPreparationRequestId = requestId;
    _pressFlowProductionPreparationController?.abort();
    const controller = new AbortController();
    _pressFlowProductionPreparationController = controller;
    _pressFlowProductionPreparationState = 'working';
    _pressFlowProductionPreparationError = null;
    _pressFlowProductionPreparationResult = null;
    _pressFlowProductionPreparationProgress = null;
    _pressFlowLocalReleasePlanningController?.abort();
    _pressFlowLocalReleasePlanningController = null;
    _pressFlowLocalReleasePlanningRequestId += 1;
    _pressFlowLocalReleasePlanningState = 'idle';
    _pressFlowLocalReleasePlanningError = null;
    _pressFlowLocalReleasePlanningResult = null;
    _pressFlowLocalReleasePlanningSignature = '';
    _resetPressFlowHorizonHandoff();
    _resetPressFlowLocalReleasePackage();
    _renderPressFlowProductionPreparationSummary();
    _renderPressFlowLocalReleaseSummary();
    _renderPressFlowLocalReleasePackageSummary();
    _renderPressFlowLocalReleaseSize();
    try {
        _pressFlowProductionPreparationModule ||= await import('./flow-press-publication-preparation.js');
        const result = await _pressFlowProductionPreparationModule.prepareFlowPressPublication({
            project: state,
            languages: _getSelectedPressLangs(),
            revision: requestId,
            documentRef: document,
            signal: controller.signal,
            onProgress(progress) {
                if (requestId !== _pressFlowProductionPreparationRequestId || controller.signal.aborted) return;
                _pressFlowProductionPreparationProgress = progress;
                _renderPressFlowProductionPreparationSummary();
            },
        });
        if (
            controller.signal.aborted
            || requestId !== _pressFlowProductionPreparationRequestId
            || signature !== _createPressFlowPreflightPreviewSignature()
            || document.body?.dataset?.room !== 'press'
        ) return null;
        _pressFlowProductionPreparationController = null;
        _pressFlowProductionPreparationState = 'ready';
        _pressFlowProductionPreparationError = null;
        _pressFlowProductionPreparationResult = result;
        _pressFlowProductionPreparationSignature = signature;
        _pressFlowProductionPreparationProgress = null;
        _renderPressFlowProductionPreparationSummary();
        void _requestPressFlowLocalReleasePlanning(result);
        return result;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Press Flow production preparation] failed:', error);
        if (requestId !== _pressFlowProductionPreparationRequestId) return null;
        _pressFlowProductionPreparationController = null;
        _pressFlowProductionPreparationState = 'error';
        _pressFlowProductionPreparationError = error;
        _pressFlowProductionPreparationResult = null;
        _pressFlowProductionPreparationProgress = null;
        _renderPressFlowProductionPreparationSummary();
        _pressFlowLocalReleasePlanningState = 'error';
        _pressFlowLocalReleasePlanningError = error;
        _pressFlowLocalReleasePlanningResult = null;
        _pressFlowLocalReleasePlanningSignature = '';
        _resetPressFlowHorizonHandoff('error', error);
        _resetPressFlowLocalReleasePackage('error', error);
        _renderPressFlowLocalReleaseSummary();
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        return null;
    }
}

function _throwIfPressFlowLocalReleaseCancelled(signal, requestId) {
    if (!signal?.aborted && requestId === _pressFlowLocalReleasePlanningRequestId) return;
    const error = new Error('Flow local release planning was cancelled.');
    error.name = 'AbortError';
    throw error;
}

async function _createPressFlowLocalReleaseImageAssets(preparation, languages, targetWidth, targetHeight, signal, requestId) {
    const pageBlocks = Array.isArray(state.blocks)
        ? state.blocks.filter((block) => block?.kind === 'page')
        : [];
    const renderablePages = _getRenderablePages();
    const imageAssets = {};
    const sealedAssets = [];
    for (const language of languages) {
        _throwIfPressFlowLocalReleaseCancelled(signal, requestId);
        const languageResult = preparation.languages.find((result) => result?.language === language);
        imageAssets[language] = {};
        const imageDecisions = (languageResult?.preflight?.decisions || [])
            .filter((decision) => decision?.renderKind === 'image');
        for (const decision of imageDecisions) {
            _throwIfPressFlowLocalReleaseCancelled(signal, requestId);
            if (decision.sourceKind !== 'fixed') {
                const error = new Error('Flow image fallback cannot be included implicitly.');
                error.code = 'FLOW_LOCAL_RELEASE_IMAGE_SOURCE_UNSUPPORTED';
                throw error;
            }
            const fixedPageIndex = pageBlocks.findIndex((block) => block.id === decision.blockId);
            const section = fixedPageIndex >= 0 ? renderablePages[fixedPageIndex] : null;
            if (!section) {
                const error = new Error(`Fixed page ${decision.blockId} cannot be rendered for local assembly.`);
                error.code = 'FLOW_LOCAL_RELEASE_FIXED_PAGE_MISSING';
                throw error;
            }
            const blob = await renderPressSectionToWebP(
                section,
                language,
                targetWidth,
                targetHeight,
                fixedPageIndex,
                renderablePages,
            );
            _throwIfPressFlowLocalReleaseCancelled(signal, requestId);
            if (!(blob instanceof Blob) || blob.type !== 'image/webp') {
                const error = new Error(`Fixed page ${decision.blockId} did not produce a WebP asset.`);
                error.code = 'FLOW_LOCAL_RELEASE_WEBP_MISSING';
                throw error;
            }
            const deliveryPageIndex = Number.isInteger(decision.deliveryPageIndex)
                ? decision.deliveryPageIndex
                : decision.fixedPageIndex;
            const sealed = await _pressFlowLocalReleaseSealingModule.sealDsfWebPAsset({
                bytes: blob,
                expectedWidth: targetWidth,
                expectedHeight: targetHeight,
                pageId: `press-local:${language}:${decision.blockId}`,
                pageLabel: String(deliveryPageIndex + 1),
            });
            imageAssets[language][decision.blockId] = sealed.descriptor;
            sealedAssets.push({
                language,
                blockId: decision.blockId,
                pageIndex: deliveryPageIndex,
                sealed,
            });
        }
    }
    return { imageAssets, sealedAssets };
}

async function _requestPressFlowLocalReleasePlanning(preparation = _pressFlowProductionPreparationResult) {
    if (document.body?.dataset?.room !== 'press' || !hasFlowGroups(state) || !preparation?.ok) {
        _pressFlowLocalReleasePlanningController?.abort();
        _pressFlowLocalReleasePlanningController = null;
        _pressFlowLocalReleasePlanningRequestId += 1;
        _pressFlowLocalReleasePlanningState = preparation && !preparation.ok ? 'blocked' : 'idle';
        _pressFlowLocalReleasePlanningError = null;
        _pressFlowLocalReleasePlanningResult = null;
        _pressFlowLocalReleasePlanningSignature = '';
        _resetPressFlowHorizonHandoff(preparation && !preparation.ok ? 'blocked' : 'idle');
        _resetPressFlowLocalReleasePackage(preparation && !preparation.ok ? 'blocked' : 'idle');
        _renderPressFlowLocalReleaseSummary();
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        return null;
    }
    const signature = _createPressFlowLocalReleasePlanningSignature();
    if (
        _pressFlowLocalReleasePlanningState === 'ready'
        && _pressFlowLocalReleasePlanningResult
        && _pressFlowLocalReleasePlanningSignature === signature
    ) {
        _renderPressFlowLocalReleaseSummary();
        if (_pressFlowLocalReleaseSealedAssets) {
            void _requestPressFlowHorizonHandoff(
                _pressFlowLocalReleasePlanningResult,
                _pressFlowLocalReleaseSealedAssets,
            );
            void _requestPressFlowLocalReleasePackage(
                _pressFlowLocalReleasePlanningResult,
                _pressFlowLocalReleaseSealedAssets,
            );
        }
        _renderPressFlowLocalReleaseSize();
        return _pressFlowLocalReleasePlanningResult;
    }

    const requestId = _pressFlowLocalReleasePlanningRequestId + 1;
    _pressFlowLocalReleasePlanningRequestId = requestId;
    _pressFlowLocalReleasePlanningController?.abort();
    const controller = new AbortController();
    _pressFlowLocalReleasePlanningController = controller;
    _pressFlowLocalReleasePlanningState = 'working';
    _pressFlowLocalReleasePlanningError = null;
    _pressFlowLocalReleasePlanningResult = null;
    _resetPressFlowHorizonHandoff();
    _resetPressFlowLocalReleasePackage();
    _renderPressFlowLocalReleaseSummary();
    _renderPressFlowLocalReleasePackageSummary();
    _renderPressFlowLocalReleaseSize();

    try {
        [_pressFlowLocalReleasePlanningModule, _pressFlowLocalReleaseSealingModule] = await Promise.all([
            _pressFlowLocalReleasePlanningModule || import('./flow-press-local-release-planning.js'),
            _pressFlowLocalReleaseSealingModule || import('./dsf-release-byte-sealing.js'),
        ]);
        _throwIfPressFlowLocalReleaseCancelled(controller.signal, requestId);
        const preparedLanguages = new Set(preparation.languages.map((result) => result?.language).filter(Boolean));
        const languages = _getSelectedPressLangs().filter((language) => preparedLanguages.has(language));
        if (!languages.length) {
            const error = new Error('No prepared language is selected for local release planning.');
            error.code = 'FLOW_LOCAL_RELEASE_LANGUAGES_MISSING';
            throw error;
        }
        const defaultLang = languages.includes(state.defaultLang) ? state.defaultLang : languages[0];
        const resolutionKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
        const { width, height } = getPressResolutionDims(resolutionKey);
        const { imageAssets, sealedAssets } = await _createPressFlowLocalReleaseImageAssets(
            preparation,
            languages,
            width,
            height,
            controller.signal,
            requestId,
        );
        _throwIfPressFlowLocalReleaseCancelled(controller.signal, requestId);
        const result = await _pressFlowLocalReleasePlanningModule.createFlowPressLocalReleasePlanning({
            preparation,
            defaultLang,
            languages,
            pageDirections: Object.fromEntries(languages.map((language) => [language, _getLangDirection(language)])),
            imageAssets,
        });
        if (
            controller.signal.aborted
            || requestId !== _pressFlowLocalReleasePlanningRequestId
            || signature !== _createPressFlowLocalReleasePlanningSignature()
            || document.body?.dataset?.room !== 'press'
        ) return null;
        _pressFlowLocalReleasePlanningController = null;
        _pressFlowLocalReleasePlanningState = 'ready';
        _pressFlowLocalReleasePlanningError = null;
        _pressFlowLocalReleasePlanningResult = result;
        _pressFlowLocalReleasePlanningSignature = signature;
        _pressFlowLocalReleaseSealedAssets = sealedAssets;
        _renderPressFlowLocalReleaseSummary();
        void _requestPressFlowHorizonHandoff(result, sealedAssets);
        void _requestPressFlowLocalReleasePackage(result, sealedAssets);
        _renderPressFlowLocalReleaseSize();
        return result;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Press Flow local release planning] failed:', error);
        if (requestId !== _pressFlowLocalReleasePlanningRequestId) return null;
        _pressFlowLocalReleasePlanningController = null;
        _pressFlowLocalReleasePlanningState = 'error';
        _pressFlowLocalReleasePlanningError = error;
        _pressFlowLocalReleasePlanningResult = null;
        _pressFlowLocalReleasePlanningSignature = '';
        _resetPressFlowHorizonHandoff('error', error);
        _resetPressFlowLocalReleasePackage('error', error);
        _renderPressFlowLocalReleaseSummary();
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        return null;
    }
}

function _throwIfPressFlowHorizonHandoffCancelled(signal, requestId) {
    if (!signal?.aborted && requestId === _pressFlowHorizonHandoffRequestId) return;
    const error = new Error('Flow Horizon dry-run handoff was cancelled.');
    error.name = 'AbortError';
    throw error;
}

async function _requestPressFlowHorizonHandoff(
    planning = _pressFlowLocalReleasePlanningResult,
    sealedAssets = _pressFlowLocalReleaseSealedAssets,
) {
    if (document.body?.dataset?.room !== 'press'
        || !hasFlowGroups(state)
        || !planning?.ready
        || !Array.isArray(sealedAssets)) {
        _resetPressFlowHorizonHandoff();
        _renderPressFlowLocalReleaseSummary();
        return null;
    }

    let identity;
    try {
        identity = _getPressFlowHorizonIdentity({ createReleaseId: true });
    } catch (error) {
        _resetPressFlowHorizonHandoff('blocked', error);
        _renderPressFlowLocalReleaseSummary();
        return null;
    }
    const signature = _createPressFlowHorizonHandoffSignature(identity);
    if (_pressFlowHorizonHandoffState === 'ready'
        && _pressFlowHorizonHandoffResult?.readyForUpload
        && _pressFlowHorizonHandoffSignature === signature) {
        _renderPressFlowLocalReleaseSummary();
        _updatePublishBtn();
        return _pressFlowHorizonHandoffResult;
    }

    const requestId = _pressFlowHorizonHandoffRequestId + 1;
    _pressFlowHorizonHandoffRequestId = requestId;
    _pressFlowHorizonHandoffController?.abort();
    const controller = new AbortController();
    _pressFlowHorizonHandoffController = controller;
    _pressFlowHorizonHandoffState = 'working';
    _pressFlowHorizonHandoffError = null;
    _pressFlowHorizonHandoffResult = null;
    _pressFlowHorizonHandoffSignature = '';
    _renderPressFlowLocalReleaseSummary();
    _updatePublishBtn();

    try {
        _pressFlowHorizonHandoffModule ||= await import('./flow-press-horizon-release-handoff.js');
        _throwIfPressFlowHorizonHandoffCancelled(controller.signal, requestId);
        const result = await _pressFlowHorizonHandoffModule.createFlowPressHorizonReleaseHandoff({
            planning,
            sealedAssets,
            uid: identity.uid,
            workId: identity.workId,
            releaseId: identity.releaseId,
            publicBaseUrl: identity.publicBaseUrl,
            signal: controller.signal,
        });
        let currentSignature = '';
        try {
            currentSignature = _createPressFlowHorizonHandoffSignature(
                _getPressFlowHorizonIdentity(),
            );
        } catch (_) {
            /* identity changes invalidate this request below */
        }
        if (controller.signal.aborted
            || requestId !== _pressFlowHorizonHandoffRequestId
            || signature !== currentSignature
            || planning !== _pressFlowLocalReleasePlanningResult
            || sealedAssets !== _pressFlowLocalReleaseSealedAssets
            || document.body?.dataset?.room !== 'press') return null;
        _pressFlowHorizonHandoffController = null;
        _pressFlowHorizonHandoffState = 'ready';
        _pressFlowHorizonHandoffError = null;
        _pressFlowHorizonHandoffResult = result;
        _pressFlowHorizonHandoffSignature = signature;
        _renderPressFlowLocalReleaseSummary();
        _updatePublishBtn();
        return result;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Press Flow Horizon dry-run handoff] failed:', error);
        if (requestId !== _pressFlowHorizonHandoffRequestId) return null;
        _pressFlowHorizonHandoffController = null;
        _pressFlowHorizonHandoffState = 'error';
        _pressFlowHorizonHandoffError = error;
        _pressFlowHorizonHandoffResult = null;
        _pressFlowHorizonHandoffSignature = '';
        _renderPressFlowLocalReleaseSummary();
        _updatePublishBtn();
        return null;
    }
}

function _isPressFlowHorizonHandoffReady() {
    if (_pressFlowHorizonHandoffState !== 'ready'
        || !_pressFlowHorizonHandoffResult?.readyForUpload
        || !_pressFlowHorizonHandoffSignature) return false;
    try {
        return _pressFlowHorizonHandoffSignature === _createPressFlowHorizonHandoffSignature(
            _getPressFlowHorizonIdentity(),
        );
    } catch (_) {
        return false;
    }
}

export function getFlowHorizonDryRunHandoff() {
    if (!hasFlowGroups(state) || !_isPressFlowHorizonHandoffReady()) {
        const error = new Error('Flow Horizon dry-run handoff is not ready.');
        error.code = 'FLOW_HORIZON_HANDOFF_NOT_READY';
        throw error;
    }
    return _pressFlowHorizonHandoffResult;
}

export function refreshFlowHorizonDryRunReadiness() {
    if (document.body?.dataset?.room !== 'press' || !hasFlowGroups(state)) return Promise.resolve(null);
    return _requestPressFlowHorizonHandoff(
        _pressFlowLocalReleasePlanningResult,
        _pressFlowLocalReleaseSealedAssets,
    );
}

function _throwIfPressFlowLocalPackageCancelled(signal, requestId) {
    if (!signal?.aborted && requestId === _pressFlowLocalReleasePackageRequestId) return;
    const error = new Error('Flow local release package verification was cancelled.');
    error.name = 'AbortError';
    throw error;
}

async function _requestPressFlowLocalReleasePackage(
    planning = _pressFlowLocalReleasePlanningResult,
    sealedAssets = _pressFlowLocalReleaseSealedAssets,
) {
    if (document.body?.dataset?.room !== 'press'
        || !hasFlowGroups(state)
        || !planning?.ready
        || !Array.isArray(sealedAssets)) {
        _resetPressFlowLocalReleasePackage();
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        return null;
    }
    const signature = _createPressFlowLocalReleasePackageSignature();
    if (_pressFlowLocalReleasePackageState === 'ready'
        && _pressFlowLocalReleasePackageResult
        && _pressFlowLocalReleasePackageSignature === signature) {
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        _updatePublishBtn();
        return _pressFlowLocalReleasePackageResult;
    }

    const requestId = _pressFlowLocalReleasePackageRequestId + 1;
    _pressFlowLocalReleasePackageRequestId = requestId;
    _pressFlowLocalReleasePackageController?.abort();
    const controller = new AbortController();
    _pressFlowLocalReleasePackageController = controller;
    _pressFlowLocalReleasePackageState = 'working';
    _pressFlowLocalReleasePackageError = null;
    _pressFlowLocalReleasePackageResult = null;
    _renderPressFlowLocalReleasePackageSummary();
    _renderPressFlowLocalReleaseSize();
    _updatePublishBtn();

    try {
        _pressFlowLocalReleasePackageModule ||= await import('./flow-press-local-release-package.js');
        _throwIfPressFlowLocalPackageCancelled(controller.signal, requestId);
        const result = await _pressFlowLocalReleasePackageModule.createFlowPressLocalReleasePackage({
            planning,
            sealedAssets,
            metadata: _createPressFlowLocalReleaseMetadata(planning.languages),
            signal: controller.signal,
        });
        if (controller.signal.aborted
            || requestId !== _pressFlowLocalReleasePackageRequestId
            || signature !== _createPressFlowLocalReleasePackageSignature()
            || planning !== _pressFlowLocalReleasePlanningResult
            || document.body?.dataset?.room !== 'press') return null;
        _pressFlowLocalReleasePackageController = null;
        _pressFlowLocalReleasePackageState = 'ready';
        _pressFlowLocalReleasePackageError = null;
        _pressFlowLocalReleasePackageResult = result;
        _pressFlowLocalReleasePackageSignature = signature;
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        _updatePublishBtn();
        return result;
    } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return null;
        console.error('[Press Flow local release package] failed:', error);
        if (requestId !== _pressFlowLocalReleasePackageRequestId) return null;
        _pressFlowLocalReleasePackageController = null;
        _pressFlowLocalReleasePackageState = 'error';
        _pressFlowLocalReleasePackageError = error;
        _pressFlowLocalReleasePackageResult = null;
        _pressFlowLocalReleasePackageSignature = '';
        _renderPressFlowLocalReleasePackageSummary();
        _renderPressFlowLocalReleaseSize();
        _updatePublishBtn();
        return null;
    }
}

export function getFlowPortableDsfDownloadArtifact() {
    if (!hasFlowGroups(state)
        || _pressFlowLocalReleasePackageState !== 'ready'
        || !_pressFlowLocalReleasePackageResult
        || !_pressFlowLocalReleasePackageSignature) {
        const error = new Error('Flow portable DSF download is not ready.');
        error.code = 'FLOW_PORTABLE_DOWNLOAD_NOT_READY';
        throw error;
    }
    return createFlowPressPortableDownloadArtifact({
        packageResult: _pressFlowLocalReleasePackageResult,
        expectedSignature: _pressFlowLocalReleasePackageSignature,
        currentSignature: _createPressFlowLocalReleasePackageSignature(),
    });
}

function _isPressFlowPortableDownloadReady() {
    try {
        getFlowPortableDsfDownloadArtifact();
        return true;
    } catch (_) {
        return false;
    }
}

document.addEventListener(FLOW_RUNTIME_INVALIDATED_EVENT, () => {
    if (document.body?.dataset?.room !== 'press' || !hasFlowGroups(state)) return;
    void _requestPressFlowPreview();
});

function _getLangDirection(code) {
    const props = getLangProps(code);
    const fallback = props.directions?.[0]?.value || 'ltr';
    return state.languageConfigs?.[code]?.pageDirection || fallback;
}

function _getLangDirectionArrow(code) {
    return _getLangDirection(code) === 'rtl' ? '&lt;&lt;' : '&gt;&gt;';
}

function _getLangBadgeModifier(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'ja') return 'ja';
    if (normalized === 'en' || normalized === 'en-us') return 'en-us';
    if (normalized === 'en-gb') return 'en-gb';
    if (normalized === 'zh-cn') return 'zh-cn';
    if (normalized === 'zh-tw') return 'zh-tw';
    return 'generic';
}

function _renderPressLangTabContent(code) {
    const props = getLangProps(code);
    const modifier = _getLangBadgeModifier(code);
    const codeLabel = String(code || '').toUpperCase();
    return `
        <span class="lang-tab-badge home-lang-${modifier}" title="${_esc(codeLabel)}">${modifier === 'generic' ? _esc(codeLabel) : ''}</span>
        <span class="lang-tab-label">${_esc(props.label)}</span>
        <span class="lang-tab-code">${_esc(codeLabel)}</span>
        <span class="lang-tab-dir">${_getLangDirectionArrow(code)}</span>
    `;
}

function _renderThumbLangTabs() {
    const container = document.getElementById('press-thumb-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    const current = _getPressThumbLang();
    container.classList.toggle('press-thumb-lang-tabs--rtl', _getLangDirection(current) === 'rtl');
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-thumb-lang-tab ${code === current ? 'active' : ''}"
            data-lang="${code}"
            onclick="switchPressThumbLang('${code}')"
            title="${_esc(`${getLangProps(code).label} ${String(code).toUpperCase()} ${_getLangDirection(code) === 'rtl' ? '<<' : '>>'}`)}">${_renderPressLangTabContent(code)}</button>`
    ).join('');
}

function _renderPageThumbs() {
    const container = document.getElementById('press-page-thumbs');
    if (!container) return;
    const lang = _getPressThumbLang();
    container.classList.toggle('press-page-thumbs--rtl', _getLangDirection(lang) === 'rtl');
    const hasFlow = hasFlowGroups(state);
    const projection = hasFlow ? _getPressFlowPreviewProjection() : null;
    container.dataset.projectionState = hasFlow ? _pressFlowPreviewState : 'ready';
    if (hasFlow && (_pressFlowPreviewState === 'working' || !projection)) {
        delete container.dataset.pageCount;
        if (_pressFlowPreviewState === 'error') {
            container.innerHTML = `
                <p class="press-empty press-flow-preview-error" role="alert">
                    ${_esc(_getPressFlowPreviewErrorMessage(_pressFlowPreviewError))}
                </p>`;
        } else {
            container.innerHTML = `
                <p class="press-empty press-flow-preview-loading" data-flow-press-progress aria-live="polite">
                    Flowページを生成中…
                </p>`;
        }
        _renderPressFixedTextDevSummary(null);
        _renderPressFlowPreflightDevSummary();
        _renderPressFlowProductionPreparationSummary();
        _renderPressFlowLocalReleaseSummary();
        return;
    }

    const previewPages = _getCurrentPressPreviewPages() || [];
    if (!previewPages.length) {
        container.dataset.pageCount = '0';
        container.innerHTML = '<p class="press-empty">ページがありません</p>';
        _renderPressFixedTextDevSummary(previewPages);
        _renderPressFlowPreflightDevSummary();
        _renderPressFlowProductionPreparationSummary();
        _renderPressFlowLocalReleaseSummary();
        return;
    }

    container.dataset.pageCount = String(previewPages.length);

    container.innerHTML = previewPages.map((previewPage, i) => {
        const label = getPageDisplayLabel(i, previewPages.length, state.book, state.bookMode);
        const roles = _getCoverRolesForPage(i, previewPages.length);
        const badges = roles.length
            ? `<div class="press-thumb-cover-badges">${roles.map(role => `<span>${role.toUpperCase()}</span>`).join('')}</div>`
            : '';
        if (previewPage.kind === 'flow') {
            const fallbackBadge = previewPage.isSourceFallback
                ? `<span class="press-flow-source-language">原文 ${_esc(previewPage.languageKey.toUpperCase())}</span>`
                : '';
            return `<div class="press-thumb-item press-thumb-item--flow"
                data-testid="press-flow-page"
                data-publication-index="${i}"
                data-flow-page-index="${previewPage.flowPageIndex}">
                <div class="press-thumb-media">
                    <div class="press-thumb-flow-viewport">
                        <div class="press-thumb-flow-page" data-flow-runtime-key="${_esc(previewPage.runtimeKey)}"></div>
                    </div>
                    <span class="press-flow-page-badge">FLOW</span>
                    ${fallbackBadge}
                    ${badges}
                </div>
                <div class="press-thumb-label">${_esc(label)}</div>
            </div>`;
        }
        const section = previewPage.section;
        if (section.type === 'text') {
            const raw = section.texts?.[lang] || section.text || '';
            const snippet = _makeTextThumbSnippet(raw);
            const bg = section.backgroundColor || '#ffffff';
            const ink = section.textColor || '#000000';
            const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs || {});
            const verticalClass = writingMode === 'vertical-rl' ? ' is-vertical' : '';
            const previewKey = _getPressFixedTextPreviewKey(previewPage, lang);
            const devResult = import.meta.env.DEV ? _pressFixedTextPreviewResults.get(previewKey) : null;
            const isFixedText = devResult?.ok && devResult.renderKind === 'fixedText';
            const fallbackMessage = devResult && !devResult.ok
                ? (_pressFixedTextPreviewModule?.getFixedTextPressPreviewFallbackMessage(devResult)
                    || devResult.fallback?.message
                    || 'WebP経路を維持します。')
                : '';
            const devBadge = import.meta.env.DEV
                ? (isFixedText
                    ? '<span class="press-fixed-text-dev-badge is-fixed-text">FIXED TEXT</span>'
                    : (devResult
                        ? `<span class="press-fixed-text-dev-badge is-webp" title="${_esc(fallbackMessage)}">WebP</span>`
                        : '<span class="press-fixed-text-dev-badge is-pending">確認中</span>'))
                : '';
            const previewMarkup = isFixedText
                ? `<div class="press-thumb-fixed-text-viewport" data-fixed-text-preview-key="${_esc(previewKey)}"></div>`
                : `<div class="press-thumb-text-preview${verticalClass}" style="background:${_esc(bg)};color:${_esc(ink)}">${_esc(snippet) || '&nbsp;'}</div>`;
            return `<div class="press-thumb-item press-thumb-item--text"
                ${import.meta.env.DEV ? 'data-testid="press-fixed-text-preview"' : ''}
                ${import.meta.env.DEV ? `data-render-kind="${isFixedText ? 'fixedText' : 'image'}"` : ''}
                ${devResult && !devResult.ok ? `data-fallback-code="${_esc(devResult.fallback?.code || 'UNKNOWN')}"` : ''}>
                <div class="press-thumb-media">
                    ${previewMarkup}
                    ${devBadge}
                    ${badges}
                </div>
                <div class="press-thumb-label">${_esc(label)}</div>
            </div>`;
        }
        const thumbImg = renderPositionedThumbImageHtml(section, lang, label);
        return `<div class="press-thumb-item">
            <div class="press-thumb-media">
                ${thumbImg
                    ? `<div class="press-thumb-canvas">${thumbImg}</div>`
                    : `<div class="press-thumb-empty"><span class="material-icons">image</span></div>`}
                ${badges}
            </div>
            <div class="press-thumb-label">${label}</div>
        </div>`;
    }).join('');

    if (projection) {
        const flowPageByKey = new Map(projection.pages
            .filter((page) => page.kind === 'flow')
            .map((page) => [page.runtimeKey, page]));
        container.querySelectorAll('.press-thumb-flow-page').forEach((pageElement) => {
            const page = flowPageByKey.get(pageElement.dataset.flowRuntimeKey || '');
            if (!page) return;
            renderFlowGeneratedPage(pageElement, {
                page: page.page,
                pageBox: page.pageBox,
                languageKey: page.languageKey,
                writingMode: page.writingMode,
                typography: page.typography,
            });
            pageElement.style.position = 'absolute';
            pageElement.style.left = '0';
            pageElement.style.top = '0';
            pageElement.style.transformOrigin = 'top left';
            pageElement.style.transform = 'scale(0.2)';
        });
    }
    if (import.meta.env.DEV && _pressFixedTextPreviewModule) {
        container.querySelectorAll('.press-thumb-fixed-text-viewport').forEach((viewport) => {
            const result = _pressFixedTextPreviewResults.get(viewport.dataset.fixedTextPreviewKey || '');
            if (!result?.ok) return;
            try {
                const pageElement = _pressFixedTextPreviewModule.createFixedTextPressPreviewElement({
                    documentRef: document,
                    result,
                });
                pageElement.style.transformOrigin = 'top left';
                pageElement.style.transform = 'scale(0.2)';
                viewport.append(pageElement);
            } catch (error) {
                console.error('[Press fixedText preview] render failed:', error);
            }
        });
    }
    _renderPressFixedTextDevSummary(previewPages);
    _renderPressFlowPreflightDevSummary();
    _renderPressFlowProductionPreparationSummary();
    _renderPressFlowLocalReleaseSummary();
}

function _makeTextThumbSnippet(raw) {
    const plain = String(raw || '')
        .replace(/\{([^|{}]+)\|([^|{}]*)\}/g, '$1')
        .replace(/^===$/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(plain).slice(0, 42).join('');
}

function _formatPressPublicationDate(value) {
    return formatPublicationDate(value, getUILang() === 'en' ? 'en-US' : 'ja-JP');
}

function _renderPublicationSummary() {
    const container = document.getElementById('press-publication-summary');
    if (!container) return;
    _renderPublicationSummaryContent(container, null);
    if (auth.currentUser) {
        ensureUserBootstrap(auth.currentUser)
            .then(account => _renderPublicationSummaryContent(container, account))
            .catch(() => {});
    }
}

function _renderPublicationSummaryContent(container, account = null) {
    const publication = state.publication && typeof state.publication === 'object'
        ? state.publication
        : (account ? createDefaultPublication(account, new Date()) : null);
    const listedUntil = publication
        ? (_formatPressPublicationDate(publication.listedUntil) || t('publication_no_limit'))
        : _formatPressListingWindow(account);
    container.innerHTML = `
        <div class="press-publication-summary-title">
            <span class="material-icons" aria-hidden="true">event_available</span>
            <span>${_esc(t('publication_press_hint'))}</span>
        </div>
        <div class="press-publication-summary-grid">
            <span><strong>${_esc(t('publication_listed_until'))}</strong>${_esc(listedUntil)}</span>
        </div>
    `;
}

function _formatPressListingWindow(account = null) {
    if (!account) return `${t('publication_immediate')} - ${t('publication_free_14_days')}`;
    const maxDays = getListingMaxDays(account);
    return maxDays === null
        ? `${t('publication_immediate')} - ${t('publication_no_limit')}`
        : `${t('publication_immediate')} - ${t('publication_free_14_days')}`;
}

function _renderLangTabs() {
    const container = document.getElementById('press-lang-tabs');
    if (!container) return;
    const langs = state.languages || ['ja'];
    container.innerHTML = langs.map(code =>
        `<button class="lang-tab press-lang-tab active"
            data-lang="${code}"
            onclick="togglePressLang('${code}')"
            title="${_esc(`${getLangProps(code).label} ${String(code).toUpperCase()} ${_getLangDirection(code) === 'rtl' ? '<<' : '>>'}`)}">${_renderPressLangTabContent(code)}</button>`
    ).join('');
}

function _readBookSettings(pageCount = _getRenderablePages().length) {
    const raw = state.book || {};
    const sourceMode = raw.mode || state.bookMode || 'cover';
    const mode = sourceMode === 'none' ? 'none' : 'cover';
    return _normalizeBookSettings({ ...raw, mode }, pageCount);
}

function _writeBookSettings(next, shouldAutosave = true) {
    const projection = hasFlowGroups(state) ? _getPressFlowPreviewProjection() : null;
    const pageCount = projection?.totalPageCount ?? _getRenderablePages().length;
    const normalized = _normalizeBookSettings(next, pageCount);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'bookMode', value: normalized.mode } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'book', value: normalized } });
    if (shouldAutosave) triggerAutoSave();
}

function _normalizeBookSettings(next, pageCount = _getRenderablePages().length) {
    const sourceMode = next?.mode || state.book?.mode || state.bookMode || 'simple';
    return normalizeBookSettings(next, sourceMode, pageCount);
}

function _ensureBookSettings() {
    const pageCount = _getRenderablePages().length;
    if (!pageCount) return;
    const current = _readBookSettings(pageCount);
    const normalized = _normalizeBookSettings(current, pageCount);
    const currentJson = JSON.stringify(state.book || {});
    const nextJson = JSON.stringify(normalized);
    if (state.bookMode !== normalized.mode || currentJson !== nextJson) {
        _writeBookSettings(normalized, false);
    }
}

function _renderBookSettings() {
    const container = document.getElementById('press-book-settings');
    if (!container) return;
    const hasFlow = hasFlowGroups(state);
    const projection = hasFlow ? _getPressFlowPreviewProjection() : null;
    if (hasFlow && (_pressFlowPreviewState === 'working' || !projection)) {
        container.innerHTML = _pressFlowPreviewState === 'error'
            ? `<p class="press-book-empty">Flowページを確認できません</p>`
            : `<p class="press-book-empty">Flowページ数を計算中…</p>`;
        return;
    }
    const pageCount = hasFlow ? projection.totalPageCount : _getRenderablePages().length;
    if (!pageCount) {
        container.innerHTML = `<p class="press-book-empty">${_esc(t('press_book_no_pages'))}</p>`;
        return;
    }

    const settings = _readBookSettings(pageCount);
    const mode = settings.mode;
    const coverRow = (key, labelKey) => {
        const pageIndex = settings.covers[key]?.pageIndex;
        if (pageIndex === undefined) return '';
        return `<div class="press-book-cover-fixed">
            <span>${_esc(t(labelKey))}</span>
            <strong>${_esc(t('press_cover_page', { page: pageIndex + 1 }))}</strong>
        </div>`;
    };

    container.innerHTML = `
        <div class="press-book-mode-row">
            <span>${_esc(t('press_book_layout'))}</span>
            <select id="press-book-mode">
                <option value="none" ${mode === 'none' ? 'selected' : ''}>${_esc(t('press_book_none'))}</option>
                <option value="cover" ${mode !== 'none' ? 'selected' : ''}>${_esc(t('press_book_cover_auto'))}</option>
            </select>
        </div>
        <div class="press-book-fixed-hint">${_esc(t('press_book_fixed_hint'))}</div>
        <div class="press-book-covers-fixed">
            ${coverRow('c1', 'press_cover_c1')}
            ${coverRow('c2', 'press_cover_c2')}
            ${coverRow('c3', 'press_cover_c3')}
            ${coverRow('c4', 'press_cover_c4')}
        </div>
    `;

    const modeEl = container.querySelector('#press-book-mode');
    if (modeEl) modeEl.addEventListener('change', () => window.updatePressBookMode(modeEl.value));
}

function _getCoverRolesForPage(pageIndex, total = _getRenderablePages().length) {
    const key = getPageCoverKey(pageIndex, state.book, state.bookMode, total);
    return key ? [key] : [];
}

function _queueSizeEstimate() {
    clearTimeout(_estimateTimer);
    _estimateTimer = setTimeout(() => { _updateSizeEstimate(); }, 120);
}

function _getSelectedPressLangs() {
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    return selectedLangs.length ? selectedLangs : (state.languages || ['ja']);
}

async function _updateSizeEstimate() {
    const el = document.getElementById('press-size-estimate');
    if (!el) return;

    const runId = ++_estimateRunId;

    if (hasFlowGroups(state)) {
        if (_pressFlowProductionPreparationState === 'ready' && _pressFlowProductionPreparationResult?.ok) {
            await _requestPressFlowLocalReleasePlanning(_pressFlowProductionPreparationResult);
            if (runId !== _estimateRunId) return;
        }
        _renderPressFlowLocalReleaseSize();
        return;
    }
    el.textContent = t('press_estimating_size');

    const resKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const { width: w, height: h } = getPressResolutionDims(resKey);
    const pages = _getRenderablePages();
    const langs = _getSelectedPressLangs();

    const tasks = [];
    for (const [pageIndex, section] of pages.entries()) {
        for (const lang of langs) {
            if (section.type === 'text') {
                tasks.push({ kind: 'text', section, lang });
            } else {
                const bgUrl = section.backgrounds?.[lang] || section.background;
                if (!bgUrl && !_isSpreadImageSection(section)) continue;
                tasks.push({
                    kind: 'image',
                    section,
                    pageIndex,
                    pages,
                    lang,
                    bgUrl,
                });
            }
        }
    }

    if (!tasks.length) {
        el.textContent = '≈ 0.0 MB';
        return;
    }

    const sampleCount = Math.min(4, tasks.length);
    const sampleTasks = [];
    if (tasks.length <= sampleCount) {
        sampleTasks.push(...tasks);
    } else {
        for (let i = 0; i < sampleCount; i++) {
            const index = Math.round((tasks.length - 1) * (i / (sampleCount - 1)));
            sampleTasks.push(tasks[index]);
        }
    }

    try {
        let totalSampleBytes = 0;
        for (const task of sampleTasks) {
            const quality = _getPressQualityForTask(task, w, h);
            const blob = task.kind === 'text'
                ? await _renderTextSectionToWebP(task.section, task.lang, w, h, quality)
                : await _renderSectionImageBlob(task.section, task.lang, w, h, quality, task.pageIndex, task.pages);
            totalSampleBytes += blob.size;
            if (runId !== _estimateRunId) return;
        }
        const avgBytes = totalSampleBytes / sampleTasks.length;
        const estimatedBytes = avgBytes * tasks.length;
        if (runId !== _estimateRunId) return;
        el.textContent = `≈ ${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    } catch (err) {
        console.warn('[Press] size estimate failed:', err);
        if (runId !== _estimateRunId) return;
        el.textContent = '—';
    }
}

function _updatePublishBtn() {
    const hasFlow = hasFlowGroups(state);
    const flowPortableReady = hasFlow && _isPressFlowPortableDownloadReady();
    const flowHorizonReady = hasFlow && _isPressFlowHorizonHandoffReady();
    document.querySelectorAll('[data-flow-publication-required]').forEach((btn) => {
        const needsAuth = btn.hasAttribute('data-auth-required');
        const isPortableDownload = btn.hasAttribute('data-flow-portable-download');
        const isHorizonPublish = btn.id === 'press-publish-cloud-btn';
        if (hasFlow && isPortableDownload) {
            btn.dataset.flowPortableState = flowPortableReady ? 'ready' : 'waiting';
            btn.disabled = !flowPortableReady;
            btn.title = flowPortableReady
                ? '検証済みFlow portable .dsfをローカルへ保存します'
                : 'Flow portable ZIPのround-trip検証完了後に有効になります';
            return;
        }
        delete btn.dataset.flowPortableState;
        if (hasFlow && isHorizonPublish) {
            btn.dataset.flowHorizonState = flowHorizonReady ? 'ready' : 'waiting';
            btn.disabled = true;
            btn.title = flowHorizonReady
                ? 'Horizon upload入力のdry-runは合格しています。実upload・発行はまだ無効です'
                : 'Horizon upload入力のdry-run完了後も、実upload・発行はこの段階では無効です';
            return;
        }
        delete btn.dataset.flowHorizonState;
        btn.disabled = hasFlow || (needsAuth && !state.uid);
        btn.title = hasFlow
            ? 'Flowのローカル書き出しとは別経路です。upload・Horizon発行はまだ無効です'
            : (needsAuth && !state.uid ? 'ログインが必要です' : '');
    });
}

/** Press Room の言語タブをトグル（複数選択可） */
window.togglePressLang = (code) => {
    const tab = document.querySelector(`.press-lang-tab[data-lang="${code}"]`);
    if (tab) tab.classList.toggle('active');
    _handlePressLocalReleaseSettingChange();
};

window.switchPressThumbLang = (code) => {
    const langs = state.languages || ['ja'];
    if (!langs.includes(code)) return;
    _pressThumbLang = code;
    if (import.meta.env.DEV) {
        _pressFixedTextPreviewRequestId += 1;
        _pressFixedTextPreviewState = 'working';
        _pressFixedTextPreviewError = null;
        _pressFixedTextPreviewResults = new Map();
    }
    _renderThumbLangTabs();
    if (hasFlowGroups(state)) {
        void _requestPressFlowPreview();
    } else {
        _renderPageThumbs();
        if (import.meta.env.DEV) void _requestPressFixedTextPreview();
    }
};

window.updatePressBookMode = (mode) => {
    const nextMode = mode === 'none' ? 'none' : 'cover';
    _writeBookSettings({ mode: nextMode });
    _invalidatePressFlowLocalReleaseForSettingsChange();
    _renderBookSettings();
    _renderPageThumbs();
    _queueSizeEstimate();
};

function _getCompositionIssueMessage(issue) {
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

export function getPressBookCompositionIssueMessages() {
    const pages = _getRenderablePages();
    const book = _readBookSettings(pages.length);
    const issues = getBookCompositionIssues({
        pageCount: pages.length,
        book,
        bookMode: book.mode,
        sections: pages
    });
    return [...new Set(issues)].map(_getCompositionIssueMessage);
}

function _validateBookCompositionForPress() {
    const messages = getPressBookCompositionIssueMessages();
    if (!messages.length) return true;
    alert(messages.join('\n'));
    return false;
}

window.updatePressBookCover = (key, value) => {
    void key;
    void value;
    _writeBookSettings(_readBookSettings());
    _renderBookSettings();
    _renderPageThumbs();
};

// ─── レンダリング & 発行 ─────────────────────────────────────────────────────

/** Press Room の「Horizonに発行」ボタンから呼ばれる */
window.publishToCloud = async () => {
    if (hasFlowGroups(state)) {
        alert('Flow作品のupload・発行はまだ有効化されていないため、このプロジェクトは発行できません。ローカル配信設計と容量だけ確認できます。');
        return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
        alert('ログインしてください');
        return;
    }
    if (state.uid && state.uid !== uid) {
        console.warn('[Press] state.uid does not match auth; syncing from Firebase');
        state.uid = uid;
    }
    let account = null;
    try {
        account = await assertAccountCanPublish(auth.currentUser);
    } catch (e) {
        alert(e?.message || String(e));
        return;
    }
    if (!state.projectId) {
        alert('プロジェクトをクラウドに保存してから発行してください');
        return;
    }
    if (!state.workId) {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: createId('work') } });
    }

    const pages = _getRenderablePages();
    if (!pages.length) {
        alert('レンダリングするページがありません');
        return;
    }
    if (!_validateBookCompositionForPress()) return;

    const publication = createDefaultPublication(account, new Date());

    // 設定取得
    const rawResKey = resolvePressResolutionKey(document.getElementById('press-resolution')?.value);
    const publishResKey = clampPressPublishResolutionKey(rawResKey);
    if (publishResKey !== rawResKey) {
        console.info('[Press] Publish resolution clamped to minimum publish size:', publishResKey, '(UI was', rawResKey + ')');
    }
    const { width: targetW, height: targetH } = getPressResolutionDims(publishResKey);
    const resStr = publishResKey;

    // 選択言語取得（アクティブなタブ）
    const selectedLangs = Array.from(
        document.querySelectorAll('.press-lang-tab.active')
    ).map(el => el.dataset.lang).filter(Boolean);
    const langs = selectedLangs.length ? selectedLangs : (state.languages || ['ja']);

    let totalOps = 0;
    for (const section of pages) {
        for (const lang of langs) {
            if (section.type === 'text') {
                totalOps += 1;
            } else if (section.backgrounds?.[lang] || section.background) {
                totalOps += 1;
            }
        }
    }
    if (!totalOps) {
        alert('選択した言語にレンダリングできるコンテンツがありません（画像または本文を確認してください）');
        return;
    }

    const openPressPublishModal = () => {
        const el = document.getElementById('press-publish-modal');
        if (el) {
            el.style.display = 'flex';
            el.setAttribute('aria-hidden', 'false');
        }
        const bar = document.getElementById('press-publish-modal-bar');
        if (bar) {
            bar.max = 100;
            bar.value = 0;
        }
        requestAnimationFrame(() => {
            document.getElementById('press-publish-cancel-btn')?.focus();
        });
    };

    const closePressPublishModal = () => {
        const el = document.getElementById('press-publish-modal');
        if (el) {
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
        }
        const bar = document.getElementById('press-publish-modal-bar');
        if (bar) {
            bar.max = 100;
            bar.value = 0;
        }
    };

    /** @param {string} msg @param {number | null} fraction 0..1、null は不定（準備中） */
    const setModalProgress = (msg, fraction) => {
        const statusEl = document.getElementById('press-publish-modal-status');
        const bar = document.getElementById('press-publish-modal-bar');
        if (statusEl) statusEl.textContent = msg;
        if (!bar) return;
        if (fraction == null) {
            bar.removeAttribute('value');
        } else {
            bar.max = 100;
            bar.value = Math.round(Math.min(100, Math.max(0, fraction * 100)));
        }
    };

    resetPressRenderCancel();
    const onEscKey = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            requestPressRenderCancel();
        }
    };
    window.addEventListener('keydown', onEscKey, true);

    openPressPublishModal();
    setModalProgress(t('press_preparing'), null);

    try {
        const dsfPages = [];
        let pageNum = 0;
        let totalBytes = 0;
        let done = 0;
        const renderStamp = Date.now();
        const workId = state.workId;
        const releaseId = createId('rel');
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'releaseId', value: releaseId } });

        try {
            await auth.currentUser.getIdToken(true);
        } catch (_) {
            /* トークン更新に失敗しても getIdToken(false) で再試行される */
        }

        for (const [pageIndex, section] of pages.entries()) {
            throwIfPressRenderCancelled();
            pageNum++;
            const langUrls = {};
            const langBytes = {};
            let pageTotalBytes = 0;

            for (const lang of langs) {
                throwIfPressRenderCancelled();
                let blob;
                if (section.type === 'text') {
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
                } else {
                    const bgUrl = section.backgrounds?.[lang] || section.background;
                    if (!bgUrl && !_isSpreadImageSection(section)) continue;
                    done++;
                    setModalProgress(
                        t('press_rendering_progress', { done, total: totalOps }),
                        done / totalOps
                    );
                    blob = await _renderSectionImageBlob(
                        section,
                        lang,
                        targetW,
                        targetH,
                        _getPressQualityForSection(section, targetW, targetH),
                        pageIndex,
                        pages
                    );
                }
                throwIfPressRenderCancelled();
                totalBytes += blob.size;
                pageTotalBytes += blob.size;

                const path = `users/${uid}/dsf/${workId}/${releaseId}/${lang}/page_${String(pageNum).padStart(3, '0')}.webp`;
                langUrls[lang] = await uploadPressPage(blob, path);
                langBytes[lang] = blob.size;
            }

            const spreadImage = getPressSpreadImageDsfMetadata(section, pageIndex, langs, pages);
            const dsfPage = {
                pageNum,
                pageType: section.type === 'text' ? 'normal_text' : 'normal_image',
                workId,
                releaseId,
                urls: langUrls,
                bytesByLang: langBytes,
                totalBytes: pageTotalBytes,
            };
            if (spreadImage) dsfPage.spreadImage = spreadImage;
            dsfPages.push(dsfPage);
        }

        throwIfPressRenderCancelled();
        setModalProgress(t('press_saving_firestore'), 1);

        // Firestoreに DSF メタデータを保存
        const qualityProfile = getPressQualityProfile(resStr);
        const projectRef = doc(db, 'users', uid, 'projects', state.projectId);
        const existingProjectSnap = await getDoc(projectRef);
        const existingProject = existingProjectSnap.exists() ? existingProjectSnap.data() : {};
        const publishedAt = new Date();
        const projectPatch = {
                dsfPages,
                ...getPressBookConfigForExport(dsfPages.length),
                workId,
                releaseId,
                labelName:      state.labelName || '',
                rating:         state.rating || 'all',
                license:        state.license || 'all-rights-reserved',
                meta:           state.meta || {},
                dsfStatus:      'draft',
                dsfPublishedAt: serverTimestamp(),
                publication,
                dsfRenderStamp: renderStamp,
                dsfResolution:  resStr,
                dsfQuality:     Math.round(qualityProfile.image * 100),
                dsfQualityMode: 'auto-resolution',
                dsfQualityProfile: {
                    image: Math.round(qualityProfile.image * 100),
                    text: Math.round(PRESS_TEXT_WEBP_QUALITY * 100),
                },
                dsfLangs:       langs,
                dsfTotalBytes:  totalBytes,
                visibility:     'private',
            };
        const projectBatch = writeBatch(db);
        projectBatch.set(projectRef, projectPatch, { merge: true });
        stageProjectSummaryWrite(
            projectBatch,
            db,
            uid,
            state.projectId,
            { ...state, ...existingProject },
            projectPatch,
            { summaryOverrides: { dsfPublishedAt: publishedAt } },
        );
        await projectBatch.commit();

        await setDoc(
            doc(db, 'users', uid, 'works', workId),
            {
                workId,
                projectId: state.projectId,
                ownerUid: uid,
                title: state.title || '',
                labelName: state.labelName || '',
                rating: state.rating || 'all',
                license: state.license || 'all-rights-reserved',
                meta: state.meta || {},
                languages: state.languages || ['ja'],
                defaultLang: state.defaultLang || state.languages?.[0] || 'ja',
                latestReleaseId: releaseId,
                latestProjectId: state.projectId,
                publication,
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

        await setDoc(
            doc(db, 'users', uid, 'works', workId, 'releases', releaseId),
            {
                releaseId,
                workId,
                projectId: state.projectId,
                dsfPages,
                ...getPressBookConfigForExport(dsfPages.length),
                dsfStatus: 'draft',
                dsfPublishedAt: serverTimestamp(),
                publication,
                dsfRenderStamp: renderStamp,
                dsfResolution: resStr,
                dsfQuality: Math.round(qualityProfile.image * 100),
                dsfQualityMode: 'auto-resolution',
                dsfQualityProfile: {
                    image: Math.round(qualityProfile.image * 100),
                    text: Math.round(PRESS_TEXT_WEBP_QUALITY * 100),
                },
                dsfLangs: langs,
                dsfTotalBytes: totalBytes,
                createdAt: serverTimestamp()
            },
            { merge: true }
        );

        // Press は新しい DSF を draft として作り直す。
        // 公開インデックスは Works が管理するため、再発行時は stale な公開行を外す。
        await deleteDoc(doc(db, 'public_projects', workId))
            .catch((e) => console.warn('[Press] Failed to clear public_projects on draft publish:', e?.message || e));
        await deleteDoc(doc(db, 'public_projects', state.projectId))
            .catch((e) => console.warn('[Press] Failed to clear public_projects on draft publish:', e?.message || e));

        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'publication', value: publication } });

        console.log(`[Press] Published ${dsfPages.length} pages → draft`);
        closePressPublishModal();

        // Works Room へ遷移
        window.switchRoom('works');

    } catch (e) {
        if (e?.code === 'PRESS_RENDER_CANCELLED') {
            console.info('[Press] publishToCloud cancelled by user');
            alert(t('press_render_cancelled'));
        } else {
            console.error('[Press] publishToCloud error:', e);
            alert('発行中にエラーが発生しました:\n' + (e?.message || String(e)));
        }
        closePressPublishModal();
    } finally {
        window.removeEventListener('keydown', onEscKey, true);
        resetPressRenderCancel();
    }
};

// ─── レンダリング処理 ────────────────────────────────────────────────────────

async function _renderPageToWebP(bgUrl, pos, targetW, targetH, quality, options = {}) {
    // Pages Functions 経由で画像を同一オリジン取得し、Canvas CORS taint を回避する
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 元画像');

    const canvas = document.createElement('canvas');
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 基準フレームは正規論理ページ（page-geometry）。見開き画像は2ページ幅の仮想フレームから片側だけ切り出す。
    const frameBaseW = Number(options.frameWidth) || CANONICAL_PAGE_WIDTH;
    const frameBaseH = Number(options.frameHeight) || CANONICAL_PAGE_HEIGHT;
    const pageRatioX = targetW / CANONICAL_PAGE_WIDTH;
    const pageRatioY = targetH / CANONICAL_PAGE_HEIGHT;
    const frameTargetW = targetW * (frameBaseW / CANONICAL_PAGE_WIDTH);
    const frameTargetH = targetH * (frameBaseH / CANONICAL_PAGE_HEIGHT);
    const offsetX = Number(options.offsetX) || 0;

    const safePos = {
        x:        Number.isFinite(Number(pos?.x))        ? Number(pos.x)        : 0,
        y:        Number.isFinite(Number(pos?.y))        ? Number(pos.y)        : 0,
        scale:    Math.max(0.1, Number.isFinite(Number(pos?.scale))    ? Number(pos.scale)    : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX:    !!pos?.flipX,
    };

    ctx.save();
    ctx.translate(targetW / 2, targetH / 2);
    ctx.translate((safePos.x + offsetX) * pageRatioX, safePos.y * pageRatioY);
    ctx.rotate((safePos.rotation * Math.PI) / 180);
    ctx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    // object-fit: cover と同じ挙動
    const imgAspect   = img.width  / img.height;
    const frameAspect = frameTargetW / frameTargetH;
    let drawW, drawH;
    if (imgAspect > frameAspect) {
        drawH = frameTargetH;
        drawW = frameTargetH * imgAspect;
    } else {
        drawW = frameTargetW;
        drawH = frameTargetW / imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    revoke();

    return encodeCanvasToWebP(canvas, quality, '画像ページ');
}

function _normalizeImageTransform(pos = {}) {
    return {
        x: Number.isFinite(Number(pos?.x)) ? Number(pos.x) : 0,
        y: Number.isFinite(Number(pos?.y)) ? Number(pos.y) : 0,
        scale: Math.max(0.1, Number.isFinite(Number(pos?.scale)) ? Number(pos.scale) : 1),
        rotation: Number.isFinite(Number(pos?.rotation)) ? Number(pos.rotation) : 0,
        flipX: !!pos?.flipX,
    };
}

function _serializeSpreadCacheTransform(pos) {
    return [
        Number(pos?.x || 0).toFixed(4),
        Number(pos?.y || 0).toFixed(4),
        Number(pos?.scale || 1).toFixed(4),
        Number(pos?.rotation || 0).toFixed(4),
        pos?.flipX ? '1' : '0'
    ].join(':');
}

function _getSpreadImageGroupIndices(pages, groupId) {
    if (!Array.isArray(pages) || !groupId) return [];
    return pages
        .map((section, index) => section?.spreadImage?.groupId === groupId ? index : -1)
        .filter((index) => index >= 0);
}

function _getSpreadImageSharedBackground(pages, indices, lang) {
    for (const index of indices) {
        const section = pages[index];
        const url = section?.backgrounds?.[lang]
            || section?.backgrounds?.[state.defaultLang]
            || section?.background
            || '';
        if (url) return url;
    }
    return '';
}

function _getSpreadImageSharedPosition(pages, indices, lang) {
    for (const index of indices) {
        const section = pages[index];
        const pos = section?.imagePositions?.[lang]
            || section?.imagePositions?.[state.defaultLang]
            || section?.imagePosition
            || section?.imageBasePosition;
        if (pos) return _normalizeImageTransform(pos);
    }
    return _normalizeImageTransform();
}

async function _renderSpreadImagePairBlobs(bgUrl, pos, targetW, targetH, quality) {
    const { img, revoke } = await loadImageForCanvas(bgUrl, 'Press Room 見開き元画像');
    const spreadCanvas = document.createElement('canvas');
    spreadCanvas.width = targetW * 2;
    spreadCanvas.height = targetH;
    const spreadCtx = spreadCanvas.getContext('2d');
    if (!spreadCtx) {
        revoke();
        throw new Error('Canvas 2D が利用できません');
    }

    spreadCtx.fillStyle = '#ffffff';
    spreadCtx.fillRect(0, 0, spreadCanvas.width, spreadCanvas.height);

    const safePos = _normalizeImageTransform(pos);
    const frameTargetW = spreadCanvas.width;
    const frameTargetH = targetH;
    const scaleX = frameTargetW / (CANONICAL_PAGE_WIDTH * 2);
    const scaleY = frameTargetH / CANONICAL_PAGE_HEIGHT;

    spreadCtx.save();
    spreadCtx.translate(frameTargetW / 2, frameTargetH / 2);
    spreadCtx.translate(safePos.x * scaleX, safePos.y * scaleY);
    spreadCtx.rotate((safePos.rotation * Math.PI) / 180);
    spreadCtx.scale(safePos.flipX ? -safePos.scale : safePos.scale, safePos.scale);

    const imgAspect = img.width / img.height;
    const frameAspect = frameTargetW / frameTargetH;
    let drawW;
    let drawH;
    if (imgAspect > frameAspect) {
        drawH = frameTargetH;
        drawW = frameTargetH * imgAspect;
    } else {
        drawW = frameTargetW;
        drawH = frameTargetW / imgAspect;
    }
    spreadCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    spreadCtx.restore();
    revoke();

    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = targetW;
    leftCanvas.height = targetH;
    const leftCtx = leftCanvas.getContext('2d');
    const rightCanvas = document.createElement('canvas');
    rightCanvas.width = targetW;
    rightCanvas.height = targetH;
    const rightCtx = rightCanvas.getContext('2d');
    if (!leftCtx || !rightCtx) throw new Error('Canvas 2D が利用できません');

    leftCtx.drawImage(spreadCanvas, 0, 0, targetW, targetH, 0, 0, targetW, targetH);
    rightCtx.drawImage(spreadCanvas, targetW, 0, targetW, targetH, 0, 0, targetW, targetH);

    // 見開き中央の継ぎ目は左右を別々にロッシー圧縮すると色差が出るため、
    // 見開き画像ページだけは分割後の左右ページをロスレス WebP で固定する。
    const [leftBlob, rightBlob] = await Promise.all([
        encodeCanvasToWebP(leftCanvas, 1, '見開き画像ページ(左)', { lossless: true }),
        encodeCanvasToWebP(rightCanvas, 1, '見開き画像ページ(右)', { lossless: true })
    ]);
    return { leftBlob, rightBlob };
}

async function _renderSectionImageBlob(section, lang, targetW, targetH, quality, pageIndex, pages = _getRenderablePages()) {
    const bgUrl = section?.backgrounds?.[lang] || section?.backgrounds?.[state.defaultLang] || section?.background || '';
    const pos = section?.imagePositions?.[lang]
        || section?.imagePositions?.[state.defaultLang]
        || section?.imagePosition
        || section?.imageBasePosition;
    if (!_isSpreadImageSection(section)) {
        return _renderPageToWebP(bgUrl, pos, targetW, targetH, quality);
    }

    const groupId = section?.spreadImage?.groupId || '';
    const total = pages.length;
    const indices = _getSpreadImageGroupIndices(pages, groupId);
    if (indices.length !== 2) {
        return _renderPageToWebP(
            bgUrl,
            pos,
            targetW,
            targetH,
            quality,
            _getSpreadImageRenderOptions(section, pageIndex, lang, total)
        );
    }

    const sharedBgUrl = _getSpreadImageSharedBackground(pages, indices, lang) || bgUrl;
    const sharedPos = _getSpreadImageSharedPosition(pages, indices, lang);
    const cacheKey = [
        groupId,
        lang,
        targetW,
        targetH,
        Number(quality).toFixed(4),
        sharedBgUrl,
        _serializeSpreadCacheTransform(sharedPos)
    ].join('|');
    if (!_spreadRenderBlobCache.has(cacheKey)) {
        _spreadRenderBlobCache.set(cacheKey, _renderSpreadImagePairBlobs(sharedBgUrl, sharedPos, targetW, targetH, quality));
    }
    const pair = await _spreadRenderBlobCache.get(cacheKey);
    const role = _getPhysicalSpreadRoleForIndex(pageIndex, lang, total)
        || (section?.spreadImage?.role === 'left' ? 'left' : 'right');
    return role === 'left' ? pair.leftBlob : pair.rightBlob;
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function _getRenderablePages() {
    const authoringSections = Array.isArray(state.blocks) && state.blocks.some(b => b?.kind === 'page')
        ? extractSectionsFromBlocks(state.blocks)
        : (state.sections || []);
    return authoringSections.filter(s => s && (s.type === 'image' || s.type === 'text'));
}

function _getImagePressQuality(targetW, targetH) {
    const scale = Math.max(1, Math.round(Math.min(targetW / CANONICAL_PAGE_WIDTH, targetH / CANONICAL_PAGE_HEIGHT)));
    return PRESS_IMAGE_WEBP_QUALITY_BY_SCALE[scale] || 0.94;
}

function _getPressQualityForSection(section, targetW, targetH) {
    return section?.type === 'text' ? PRESS_TEXT_WEBP_QUALITY : _getImagePressQuality(targetW, targetH);
}

function _getPressQualityForTask(task, targetW, targetH) {
    return task?.kind === 'text' ? PRESS_TEXT_WEBP_QUALITY : _getImagePressQuality(targetW, targetH);
}

export function getRenderablePressPages() {
    return _getRenderablePages();
}

export function getSelectedPressLangs() {
    return _getSelectedPressLangs();
}

export function getPressQualityProfile(resolutionKey = '') {
    const { width, height } = getPressResolutionDims(resolutionKey || resolvePressResolutionKey(document.getElementById('press-resolution')?.value || '1080x1920'));
    const textQ = _isPressTextBinarizeTrialEnabled() ? 1 : PRESS_TEXT_WEBP_QUALITY;
    return {
        image: _getImagePressQuality(width, height),
        text: textQ
    };
}

export function getPressBookConfigForExport(pageCount = _getRenderablePages().length) {
    const book = _normalizeBookSettings(_readBookSettings(pageCount), pageCount);
    return {
        bookMode: book.mode,
        book: {
            mode: book.mode,
            covers: book.covers
        }
    };
}

export async function renderPressSectionToWebP(section, lang, targetW, targetH, pageIndexOverride = null, pagesOverride = null) {
    if (section?.type === 'text') {
        return _renderTextSectionToWebP(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH));
    }
    const pages = Array.isArray(pagesOverride) ? pagesOverride : _getRenderablePages();
    const pageIndex = Number.isInteger(pageIndexOverride) ? pageIndexOverride : pages.indexOf(section);
    const bgUrl = section?.backgrounds?.[lang] || section?.backgrounds?.[state.defaultLang] || section?.background;
    if (!bgUrl && !_isSpreadImageSection(section)) return null;
    return _renderSectionImageBlob(section, lang, targetW, targetH, _getPressQualityForSection(section, targetW, targetH), pageIndex, pages);
}

function _prepareTextComposition(section, lang) {
    return composeTextPreviewModel(section, lang, state.languageConfigs || {});
}

const SMALL_KANA_VERTICAL_OFFSET = Object.freeze({
    x: 0.12,
    y: -0.08
});
const SMALL_KANA_SET = new Set(Array.from(
    'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ'
));

function _drawVerticalPlainText(ctx, text, x, startSlot, metrics) {
    const chars = Array.from(String(text || ''));
    let slot = startSlot;
    for (let i = 0; i < chars.length;) {
        const y = metrics.frameY + (slot + (metrics.slotOffset || 0)) * metrics.charPitch + metrics.charPitch / 2;
        const glyph = verticalGlyphText(chars[i]);
        ctx.font = `${metrics.fontPx}px ${metrics.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const isSmallKana = SMALL_KANA_SET.has(chars[i]);
        const gx = x + (isSmallKana ? metrics.fontPx * SMALL_KANA_VERTICAL_OFFSET.x : 0);
        const gy = y + (isSmallKana ? metrics.fontPx * SMALL_KANA_VERTICAL_OFFSET.y : 0);
        ctx.fillText(glyph, gx, gy);
        slot += 1;
        i += 1;
    }
    return slot - startSlot;
}

function _drawVerticalRubyText(ctx, tokenLine, x, metrics) {
    let slot = 0;
    for (const tok of tokenLine || []) {
        const base = tok.kind === 'ruby' ? (tok.base || '') : (tok.text || '');
        const startSlot = slot;
        const used = _drawVerticalPlainText(ctx, base, x, slot, metrics);
        if (tok.kind === 'ruby' && tok.ruby) {
            const rubyChars = Array.from(verticalGlyphText(tok.ruby));
            const rubyX = x + metrics.fontPx * 0.68;
            const rubyBlockH = rubyChars.length * metrics.rubyPitch;
            const baseBlockH = Math.max(used, 1) * metrics.charPitch;
            const rubyTop = metrics.frameY + (startSlot + (metrics.slotOffset || 0)) * metrics.charPitch + Math.max(0, (baseBlockH - rubyBlockH) / 2);
            ctx.font = `${metrics.rubyFontPx}px ${metrics.family}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            rubyChars.forEach((ch, idx) => {
                ctx.fillText(ch, rubyX, rubyTop + idx * metrics.rubyPitch + metrics.rubyPitch / 2);
            });
        }
        slot += used;
    }
}

function _getTextSectionAlign(section) {
    const value = section?.textAlign || 'start';
    return value === 'center' || value === 'end' ? value : 'start';
}

function _getVerticalBlockOffsetPx(frameW, usedCols, colW, align) {
    const groupW = Math.min(frameW, usedCols * colW);
    if (align === 'center') return Math.max(0, (frameW - groupW) / 2);
    if (align === 'end') return 0;
    return Math.max(0, frameW - groupW);
}

function _getHorizontalBlockOffsetPx(frameW, blockW, align) {
    if (align === 'center') return Math.max(0, (frameW - blockW) / 2);
    if (align === 'end') return Math.max(0, frameW - blockW);
    return 0;
}

async function _renderVerticalTextSectionToWebP(section, lang, targetW, targetH, _quality) {
    const { raw, composed, rubyLines } = _prepareTextComposition(section, lang);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が利用できません');

    const sx = targetW / CANONICAL_PAGE_WIDTH;
    const sy = targetH / CANONICAL_PAGE_HEIGHT;
    const s = Math.min(sx, sy);
    ctx.fillStyle = section.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    if (!raw) {
        return _encodeTextSectionWebP(canvas, section, '空テキストページ');
    }

    await document.fonts.ready;

    const { x, y, w, h } = composed.frame;
    const maxCols = composed.rules?.maxLines || 12;
    const charsPerCol = composed.rules?.charsPerLine || 33;
    const colW = Math.floor(w / maxCols) * sx;
    const fontPx = composed.font.size * s;
    const frameX = x * sx;
    const frameY = y * sy;
    const frameW = w * sx;
    const charPitch = (h * sy) / charsPerCol;
    const family = composed.font.family;

    ctx.fillStyle = section.textColor || '#000000';
    ctx.imageSmoothingEnabled = true;
    const textAlign = _getTextSectionAlign(section);

    const metrics = {
        frameY,
        colW,
        charPitch,
        fontPx,
        rubyFontPx: Math.max(7, Math.round(fontPx * 0.5)),
        rubyPitch: Math.max(8, Math.round(fontPx * 0.6)),
        family
    };

    composed.lines.forEach((line, i) => {
        const blockOffsetX = _getVerticalBlockOffsetPx(frameW, composed.lines.length, colW, textAlign);
        const xCenter = frameX + blockOffsetX + (composed.lines.length - i - 0.5) * colW;
        const lineMetrics = { ...metrics, slotOffset: 0 };
        if (rubyLines) {
            _drawVerticalRubyText(ctx, rubyLines[i] || [], xCenter, lineMetrics);
        } else {
            _drawVerticalPlainText(ctx, line, xCenter, 0, lineMetrics);
        }
    });

    return _encodeTextSectionWebP(canvas, section, '縦書きテキストページ');
}

async function _renderHorizontalTextSectionToWebP(section, lang, targetW, targetH, _quality) {
    const { raw, composed } = _prepareTextComposition(section, lang);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が利用できません');

    const sx = targetW / CANONICAL_PAGE_WIDTH;
    const sy = targetH / CANONICAL_PAGE_HEIGHT;
    const s = Math.min(sx, sy);

    ctx.fillStyle = section.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    if (!raw) {
        return _encodeTextSectionWebP(canvas, section, '空テキストページ');
    }

    await document.fonts.ready;

    const { x, y, w, h } = composed.frame;
    const frameX = x * sx;
    const frameY = y * sy;
    const frameW = w * sx;
    const fontPx = composed.font.size * s;
    const lineH = (h * sy) / (composed.rules?.maxLines || 20);
    const family = composed.font.family;

    ctx.fillStyle = section.textColor || '#000000';
    ctx.font = `${fontPx}px ${family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.imageSmoothingEnabled = true;
    const textAlign = _getTextSectionAlign(section);

    const lines = composed.lines || [];
    const baselineOffset = Math.max(fontPx, (lineH - fontPx) / 2 + fontPx * 0.86);
    const lineWidths = lines.map((line) => ctx.measureText(String(line || '').trimEnd()).width);
    const blockWidth = Math.min(frameW, lineWidths.reduce((max, width) => Math.max(max, width), 0));
    const blockOffsetX = _getHorizontalBlockOffsetPx(frameW, blockWidth, textAlign);
    const blockStartX = frameX + blockOffsetX;

    lines.forEach((line, i) => {
        const text = String(line || '');
        if (!text) return;
        const baseline = frameY + i * lineH + baselineOffset;
        _drawHorizontalLine(ctx, text, blockStartX, baseline, frameW, false, 'start');
    });

    return _encodeTextSectionWebP(canvas, section, '横書きテキストページ');
}

function _drawHorizontalLine(ctx, line, x, baseline, width, justify, align = 'start') {
    const text = String(line || '').trimEnd();
    if (!text) return;

    const naturalWidth = ctx.measureText(text).width;
    if (align === 'center') {
        ctx.fillText(text, x + Math.max(0, width - naturalWidth) / 2, baseline);
        return;
    }
    if (align === 'end') {
        ctx.fillText(text, x + Math.max(0, width - naturalWidth), baseline);
        return;
    }
    if (!justify || !/\s/.test(text) || naturalWidth / width < 0.88) {
        ctx.fillText(text, x, baseline);
        return;
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
        ctx.fillText(text, x, baseline);
        return;
    }

    const wordWidth = words.reduce((sum, word) => sum + ctx.measureText(word).width, 0);
    const extra = width - wordWidth;
    const normalSpace = ctx.measureText(' ').width;
    const gap = extra / (words.length - 1);
    if (extra <= normalSpace * (words.length - 1) || gap > normalSpace * 2.2) {
        ctx.fillText(text, x, baseline);
        return;
    }

    let cursor = x;
    words.forEach((word, idx) => {
        ctx.fillText(word, cursor, baseline);
        cursor += ctx.measureText(word).width + (idx < words.length - 1 ? gap : 0);
    });
}

/**
 * テキストページを WebP 化する。
 * 縦書きは CSS/html2canvas に任せず、Canvas に列と文字を明示配置する。
 * 横書きも Canvas に直接描画する。html2canvas の foreignObject は環境により白紙化するため使わない。
 */
async function _renderTextSectionToWebP(section, lang, targetW, targetH, quality) {
    const writingMode = getWritingModeFromConfigs(lang, state.languageConfigs || {});
    if (writingMode === 'vertical-rl') {
        return _renderVerticalTextSectionToWebP(section, lang, targetW, targetH, quality);
    }
    return _renderHorizontalTextSectionToWebP(section, lang, targetW, targetH, quality);
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
