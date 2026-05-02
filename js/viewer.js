/**
 * viewer.js — DSF Viewer (Gen 3)
 *
 * シンプルな WebP 画像ビューワー。
 * ページは連番のみ。言語ごとに別の WebP 画像を持ち、
 * 言語ごとのページ送り方向（rtl/ltr）に対応する。
 */
import { state, dispatch, actionTypes } from './state.js';
import { renderBubbleHTML } from './bubbles.js';
import { getLangProps } from './lang.js';
import { db, auth as firebaseAuth, ensureUserBootstrap } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
import { getOptimizedImageUrl } from './sections.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode } from './theme.js';
import { doc, getDoc, getDocs, setDoc, deleteDoc, addDoc, collection, query, where, limit, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseAndLoadDSF } from './export.js';
import { CANONICAL_PAGE_WIDTH, CANONICAL_PAGE_HEIGHT, CANONICAL_PAGE_ASPECT } from './page-geometry.js';

// ── Module State ──────────────────────────────────────────────
let sharedProjectRef = null;
let isProjectLoading = false;
let projectLoaded = false;
let lastLoadErrorCode = '';
let privateLoginPromptActive = false;
let privateLoginRequested = false;
let privateLoginDeclined = false;
let bookmarkRestoreAttempted = false;
let bookmarkSaveTimer = null;
let bookmarkUiState = createBookmarkUiState();
let reviewUiState = createReviewUiState();

// 見開き表示フラグ
let spreadMode = false;
let requestedBookMode = '';
let viewerBookModel = null;
let bookSpreadIndex = 0;
let viewerSpreadManualOverride = false;

// ── Zoom / Pan State ──────────────────────────────────────────
let viewScale = 1;
let viewX = 0;
let viewY = 0;
let isPinching = false;
let isPanning = false;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pointerCache = [];
let pointerStartX = 0;
let pointerStartY = 0;
let lastPanX = 0;
let lastPanY = 0;
let lastTapTime = 0;
let lastWheelNavTime = 0;
let suppressZoneClickUntil = 0;
let activeGesturePointerId = null;
let pointerGestureConsumed = false;
let pageAnimationToken = 0;
let singleSpreadSwipe = {
    active: false,
    dragging: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    basePercent: 0,
    currentPercent: 0,
    pair: null
};
const VIEWER_PRELOAD_PAGE_RADIUS = 3;
const VIEWER_PRELOAD_BOOK_UNIT_RADIUS = 2;
const viewerPreloadedImageUrls = new Set();
const VIEWER_UI_LANG_KEY = 'dsf_viewer_ui_lang';
const VIEWER_DEV_MODE_KEY = 'dsf_viewer_dev_mode';
const VIEWER_DEV_SMOOTHING_KEY = 'dsf_viewer_dev_smoothing';
const VIEWER_DEV_MORPH_KEY = 'dsf_viewer_dev_morph';
const VIEWER_DEV_HOLD_MS = 1200;
const VIEWER_INFO_SWIPE_OPEN_MIN = 42;
const VIEWER_INFO_SWIPE_OPEN_FULL = 120;
const VIEWER_INFO_SWIPE_ZONE = 120;
const VIEWER_INFO_HANDLE_SENSITIVITY = 1.18;
const VIEWER_DRAWER_WIDTH = 630;
const VIEWER_DRAWER_GAP = 0;
const VIEWER_AUTO_SPREAD_MIN_WIDTH = 860;
/** インク判定（輝度しきい値・低いほど「濃い部分だけがインク」）。高すぎるとアンチエイリアスまで膨張して潰れる。 */
const VIEWER_DEV_MORPH_LUM_THRESHOLD = 168;
const METRIC_EVENT_SCHEMA_VERSION = 1;
const METRIC_SESSION_KEY = 'dsf_viewer_metric_session_id';
let viewerUiLang = localStorage.getItem(VIEWER_UI_LANG_KEY)
    || (navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en');
let viewerDevMode = localStorage.getItem(VIEWER_DEV_MODE_KEY) === '1';
let viewerDevSmoothing = localStorage.getItem(VIEWER_DEV_SMOOTHING_KEY) === '1';
let viewerDevMorph = localStorage.getItem(VIEWER_DEV_MORPH_KEY) === '1';
/** モルフォ試行の直近結果（パネル表示用） */
let viewerDevMorphLastRun = { pending: false, replaced: 0, skipped: 0, lastErr: '' };
let viewerProjectMeta = {
    source: 'file',
    resolution: '',
    totalBytes: 0,
    qualityProfile: null,
    labelName: '',
    meta: {},
    rootTitle: '',
    projectId: '',
    workId: '',
    releaseId: '',
    authorUid: ''
};
const VIEWER_INFO_STATES = ['closed', 'peek', 'summary', 'full'];
let viewerInfoPanelState = 'closed';
let viewerInfoLayoutMode = 'sheet';
let viewerUiAutoHideTimer = null;
let viewerInfoHandleDrag = {
    active: false,
    pointerId: null,
    startY: 0,
    startHeight: 0,
    currentHeight: 0,
    startedInBody: false,
    bodyScrollTop: 0
};
let metricSessionId = getMetricSessionId();
let metricViewStarted = false;
let metricReadCompleteSent = false;
const metricPageViewKeys = new Set();
let metricDeliveryState = createMetricDeliveryState();

const VIEWER_UI = {
    ja: {
        close: '閉じる',
        openFile: 'ファイルを開く',
        prevPage: '前のページ',
        nextPage: '次のページ',
        toggleUi: 'メニュー表示/非表示',
        account: 'アカウント',
        guest: 'ゲスト',
        themeLabel: '表示モード',
        modeDevice: 'デバイス',
        modeLight: 'ライト',
        modeDark: 'ダーク',
        signIn: 'サインイン',
        signOut: 'サインアウト',
        imageMissing: '画像未設定',
        authError: '認証エラー: {message}',
        uidRequired: 'URLにuidが必要です。',
        projectNotFound: 'プロジェクトが見つかりません: {pid}',
        privateTitle: 'この作品は非公開です',
        privateBody: '作者の方は Google でサインインすると閲覧できます。',
        privateCancel: 'キャンセル',
        privateProject: 'この作品は非公開です。',
        unpublishedProject: 'このURLには発行済みの DSF データがありません。',
        developerModeOn: 'Developer mode: ON',
        developerModeOff: 'Developer mode: OFF',
        loadError: '読み込みエラー: {message}',
        standaloneTitle: 'DSFファイルを開く',
        standaloneBody: 'ローカルの .dsf / .dsp / .zip / .json をこのビューワーで表示できます。',
        standaloneOpen: 'ファイルを選択',
        standaloneHint: 'ファイルをここへドラッグして開くこともできます。',
        infoPanel: '作品情報',
        infoPanelOpen: '作品情報を開く',
        infoPanelClose: '作品情報を閉じる',
        infoPanelExpand: '情報を広げる',
        infoPanelCollapse: '情報を縮小する',
        infoLabel: 'レーベル',
        infoSeries: 'シリーズ',
        infoAuthor: '著者',
        infoDescription: '概要',
        infoLinerNotes: 'ライナーノーツ',
        infoReviews: 'レビュー',
        reviewSignedOut: 'ログインするとレビューを投稿できます。',
        reviewNotShared: '共有作品でのみレビューできます。',
        reviewLoading: 'レビューを読み込んでいます…',
        reviewEmpty: 'まだレビューはありません。',
        reviewError: 'レビューの処理に失敗しました: {message}',
        reviewBodyLabel: 'レビュー本文',
        reviewBodyPlaceholder: 'この作品の感想を書く',
        reviewSubmit: 'レビューを投稿',
        reviewSubmitting: '投稿中…',
        reviewPosted: 'レビューを投稿しました。',
        reviewBy: '{name}',
        reviewAnonymous: '読者',
        reviewConfirm: '以下の内容で投稿します。誹謗中傷、個人攻撃、極端な表現が含まれていないか確認してください。\n\n{body}',
        reviewGood: '高評価',
        reviewBad: '低評価',
        bookmarkTitle: 'しおり',
        bookmarkSignedOut: 'ログインすると、この作品の続きから読めます。',
        bookmarkNotShared: '共有作品でのみしおりを保存できます。',
        bookmarkLoading: 'しおりを確認しています…',
        bookmarkSaving: 'しおりを保存しています…',
        bookmarkSaved: '{page}/{total}ページ目を保存中',
        bookmarkNone: 'まだしおりはありません。現在位置を保存できます。',
        bookmarkDeleted: 'しおりを削除しました。',
        bookmarkError: 'しおりの処理に失敗しました: {message}',
        bookmarkProgress: '進捗 {progress}%',
        bookmarkSaveNow: '現在位置を保存',
        bookmarkResume: '続きから読む',
        bookmarkRestart: '先頭から読む',
        bookmarkDelete: 'しおりを削除',
        bookmarkSignIn: 'ログインして保存',
        devSmoothing: 'ごく弱いコントラスト（試行）',
        devSmoothingNote: 'アンシャープはハロ・痩せが出やすいため廃止。効果は控えめです。基本オフ推奨。',
        devMorph: 'モルフォロジー膨張（試行）',
        devMorphNote: 'ラスタ膨張はアンチエイリアスと相性が悪く、太字というより潰れやすい。読みの改善は Press の書き出し（解像度・階調）を優先。技術デモ向け。fetch／media-proxy。',
        devMorphStatusPending: 'Morph: 処理中…',
        devMorphStatusOff: 'Morph: —（オフ）',
        devMorphStatusResult: 'Morph: 置換 {replaced} / スキップ {skipped}',
        devMorphStatusHint: 'スキップ時: メディアの CORS（AllowedOrigins にこのビューワのオリジン）を確認。'
    },
    en: {
        close: 'Close',
        openFile: 'Open file',
        prevPage: 'Previous page',
        nextPage: 'Next page',
        toggleUi: 'Show/hide menu',
        account: 'Account',
        guest: 'Guest',
        themeLabel: 'Theme',
        modeDevice: 'Device',
        modeLight: 'Light',
        modeDark: 'Dark',
        signIn: 'Sign in',
        signOut: 'Sign out',
        imageMissing: 'No image',
        authError: 'Authentication error: {message}',
        uidRequired: 'The URL requires a uid parameter.',
        projectNotFound: 'Project not found: {pid}',
        privateTitle: 'This work is private',
        privateBody: 'If you are the author, sign in with Google to view it.',
        privateCancel: 'Cancel',
        privateProject: 'This work is private.',
        unpublishedProject: 'This URL does not have published DSF data yet.',
        developerModeOn: 'Developer mode: ON',
        developerModeOff: 'Developer mode: OFF',
        loadError: 'Load error: {message}',
        standaloneTitle: 'Open a DSF file',
        standaloneBody: 'View a local .dsf, .dsp, .zip, or .json file in this viewer.',
        standaloneOpen: 'Choose file',
        standaloneHint: 'You can also drag a file here.',
        infoPanel: 'Work info',
        infoPanelOpen: 'Open work info',
        infoPanelClose: 'Close work info',
        infoPanelExpand: 'Expand info',
        infoPanelCollapse: 'Collapse info',
        infoLabel: 'Label',
        infoSeries: 'Series',
        infoAuthor: 'Author',
        infoDescription: 'Overview',
        infoLinerNotes: 'Liner Notes',
        infoReviews: 'Reviews',
        reviewSignedOut: 'Sign in to post a review.',
        reviewNotShared: 'Reviews are available for shared works only.',
        reviewLoading: 'Loading reviews…',
        reviewEmpty: 'No reviews yet.',
        reviewError: 'Review failed: {message}',
        reviewBodyLabel: 'Review',
        reviewBodyPlaceholder: 'Write a review',
        reviewSubmit: 'Post review',
        reviewSubmitting: 'Posting…',
        reviewPosted: 'Review posted.',
        reviewBy: '{name}',
        reviewAnonymous: 'Reader',
        reviewConfirm: 'Post this review? Please confirm it does not include harassment, personal attacks, or extreme content.\n\n{body}',
        reviewGood: 'Like',
        reviewBad: 'Dislike',
        bookmarkTitle: 'Bookmark',
        bookmarkSignedOut: 'Sign in to keep reading this work from where you left off.',
        bookmarkNotShared: 'Bookmarks are available for shared works only.',
        bookmarkLoading: 'Checking bookmark…',
        bookmarkSaving: 'Saving bookmark…',
        bookmarkSaved: 'Saved page {page}/{total}',
        bookmarkNone: 'No bookmark yet. You can save the current position.',
        bookmarkDeleted: 'Bookmark deleted.',
        bookmarkError: 'Bookmark failed: {message}',
        bookmarkProgress: 'Progress {progress}%',
        bookmarkSaveNow: 'Save current position',
        bookmarkResume: 'Continue reading',
        bookmarkRestart: 'Start from beginning',
        bookmarkDelete: 'Delete bookmark',
        bookmarkSignIn: 'Sign in to save',
        devSmoothing: 'Mild contrast (trial)',
        devSmoothingNote: 'Unsharp removed (halos/thin strokes). Very subtle contrast; usually leave off.',
        devMorph: 'Morphology dilation (trial)',
        devMorphNote: 'Raster dilation fights anti-aliasing; tends to crush strokes. Prefer Press export (resolution/tones) for legibility. Demo-grade. fetch / media-proxy.',
        devMorphStatusPending: 'Morph: running…',
        devMorphStatusOff: 'Morph: — (off)',
        devMorphStatusResult: 'Morph: replaced {replaced} / skipped {skipped}',
        devMorphStatusHint: 'If skipped: check media CORS (AllowedOrigins must include this viewer origin).'
    }
};

if (!VIEWER_UI[viewerUiLang]) viewerUiLang = 'ja';

// ── Init ──────────────────────────────────────────────────────
async function init() {
    applyTheme();
    bindThemePreferenceListener(() => {
        applyTheme();
    });

    const layer = document.getElementById('click-layer');
    if (layer) {
        layer.addEventListener('pointerdown', onPointerDown);
        layer.addEventListener('pointermove', onPointerMove);
        layer.addEventListener('pointerup', onPointerUp);
        layer.addEventListener('pointercancel', onPointerCancel);
        layer.addEventListener('click', suppressClickAfterSwipe, true);
    }

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', handleViewerResize);
    setupStandaloneFileDrop();

    await initAuth().catch((e) => console.warn('[Viewer] initAuth failed:', e));
    applyViewerUiLanguage();
    updateViewerInfoPanelLayout();
    renderViewerInfoPanel();
    bindViewerInfoHandle();
    bindViewerSliderPreview();
    bindViewerHoverChrome();
    applyViewerDevSmoothingClass();

    const params = new URLSearchParams(window.location.search);
    const workId = params.get('work') || params.get('w');
    const pid = params.get('project') || params.get('id');
    const uid = params.get('author') || params.get('uid');
    const src = params.get('src') || params.get('file') || params.get('url');
    requestedBookMode = String(params.get('bookMode') || params.get('book') || '').toLowerCase();
    if (workId) {
        sharedProjectRef = { workId };
        attemptLoad();
    } else if (pid) {
        sharedProjectRef = { pid, uid };
        attemptLoad();
    } else if (src) {
        loadRemoteDsf(src);
    } else {
        showStandaloneEmpty();
    }

    resizeCanvas();
    updateUiVisibility();
}

// ── Auth ─────────────────────────────────────────────────────
async function initAuth() {
    const redirectOutcome = await handleRedirectResult(firebaseAuth);
    if (redirectOutcome?.error) {
        alert(vt('authError', { message: redirectOutcome.error?.message || String(redirectOutcome.error) }));
    }
    await initGIS({ authInstance: firebaseAuth });
    let firstState = true;
    return new Promise((resolve) => {
        onAuthChanged(user => {
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'user', value: user || null } });
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uid', value: user?.uid || null } });
            if (user) {
                void ensureUserBootstrap(user).catch((e) => console.warn('[Viewer] user bootstrap failed:', e));
                privateLoginRequested = false;
                privateLoginDeclined = false;
                closePrivateLoginModal();
            } else {
                bookmarkRestoreAttempted = false;
                resetBookmarkUiState();
            }
            renderViewerAuthSlot(user || null);
            renderViewerInfoPanel();
            if (firstState) {
                firstState = false;
                resolve(user || null);
                return;
            }
            if (sharedProjectRef && (!projectLoaded || lastLoadErrorCode === 'permission-denied')) {
                attemptLoad();
            }
            if (projectLoaded && user) {
                bookmarkRestoreAttempted = false;
                void restoreBookmarkIfAvailable();
            }
        }, firebaseAuth);
    });
}

window.viewerToggleAuth = async () => {
    try {
        if (state.uid) await signOutUser(firebaseAuth);
        else await signInWithGoogle({ authInstance: firebaseAuth });
    } catch (e) {
        alert(vt('authError', { message: e.message }));
    }
};

function closePrivateLoginModal() {
    const modal = document.getElementById('viewer-private-login-modal');
    if (!modal) return;
    modal.remove();
    privateLoginPromptActive = false;
}

function showPrivateLoginModal() {
    if (document.getElementById('viewer-private-login-modal')) return;
    privateLoginPromptActive = true;
    const modal = document.createElement('div');
    modal.id = 'viewer-private-login-modal';
    modal.className = 'viewer-private-login-modal';
    modal.innerHTML = `
        <div class="viewer-private-login-panel" role="dialog" aria-modal="true" aria-labelledby="viewer-private-login-title">
            <div id="viewer-private-login-title" class="viewer-private-login-title">${esc(vt('privateTitle'))}</div>
            <div class="viewer-private-login-body">${esc(vt('privateBody'))}</div>
            <div id="gis-btn-private-login" class="viewer-private-login-gis"></div>
            <div class="viewer-private-login-actions">
                <button type="button" class="viewer-private-login-cancel" data-private-login-cancel>${esc(vt('privateCancel'))}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => mountPrivateLoginGisButton());
    });

    const cancel = modal.querySelector('[data-private-login-cancel]');
    cancel?.addEventListener('click', () => {
        privateLoginDeclined = true;
        closePrivateLoginModal();
    });
}

function mountPrivateLoginGisButton() {
    if (state.uid) return;
    const host = document.getElementById('gis-btn-private-login');
    if (!host) return;
    host.innerHTML = '';
    renderGISButton('gis-btn-private-login', {
        authInstance: firebaseAuth,
        buttonOptions: {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left',
        }
    }).catch((error) => console.warn('[Viewer] private GIS button render failed:', error));
}

async function attemptLoad() {
    if (!sharedProjectRef || isProjectLoading) return;
    isProjectLoading = true;
    try {
        const ok = sharedProjectRef.workId
            ? await loadWorkFromPublicIndex(sharedProjectRef.workId)
            : await loadFromFirestore(sharedProjectRef.pid, sharedProjectRef.uid);
        if (ok) { projectLoaded = true; lastLoadErrorCode = ''; }
    } finally {
        isProjectLoading = false;
    }
}

// ── Firestore ─────────────────────────────────────────────────
async function loadWorkFromPublicIndex(workId) {
    try {
        const indexSnap = await getDoc(doc(db, 'public_projects', workId));
        if (!indexSnap.exists()) {
            alert(vt('projectNotFound', { pid: workId }));
            return false;
        }
        const indexData = indexSnap.data() || {};
        const pid = indexData.projectId || indexData.pid || workId;
        const uid = indexData.authorUid || indexData.uid || '';
        if (!uid) {
            alert(vt('uidRequired'));
            return false;
        }
        sharedProjectRef = { workId, pid, uid };
        return loadFromFirestore(pid, uid, { workId, releaseId: indexData.releaseId || '' });
    } catch (e) {
        lastLoadErrorCode = e?.code || '';
        alert(vt('loadError', { message: e.message }));
        return false;
    }
}

async function loadFromFirestore(pid, uid, resolved = {}) {
    if (!uid) { alert(vt('uidRequired')); return false; }
    try {
        const snap = await getDoc(doc(db, 'users', uid, 'projects', pid));
        if (!snap.exists()) { alert(vt('projectNotFound', { pid })); return false; }
        const data = snap.data();
        data.projectId = pid;
        data.authorUid = data.authorUid || data.uid || uid;
        if (resolved.workId && !data.workId) data.workId = resolved.workId;
        if (resolved.releaseId && !data.releaseId) data.releaseId = resolved.releaseId;
        loadProjectData(data, { source: 'shared' });
        return true;
    } catch (e) {
        lastLoadErrorCode = e?.code || '';
        if (lastLoadErrorCode === 'permission-denied') {
            if (!state.uid) {
                if (privateLoginPromptActive || privateLoginRequested || privateLoginDeclined) return false;
                showPrivateLoginModal();
            } else {
                alert(vt('privateProject'));
            }
        } else {
            alert(vt('loadError', { message: e.message }));
        }
        return false;
    }
}

// ── Standalone / File Loading ─────────────────────────────────
function showStandaloneEmpty() {
    document.body.classList.add('viewer-empty');
    const empty = document.getElementById('viewer-empty-state');
    if (empty) empty.hidden = false;
    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = 'DSF Viewer';
}

function hideStandaloneEmpty() {
    document.body.classList.remove('viewer-empty', 'viewer-drag-over');
    const empty = document.getElementById('viewer-empty-state');
    if (empty) empty.hidden = true;
}

function updateStandaloneEmptyText() {
    const title = document.getElementById('viewer-empty-title');
    const body = document.getElementById('viewer-empty-body');
    const open = document.getElementById('viewer-empty-open-label');
    const hint = document.getElementById('viewer-empty-hint');
    if (title) title.textContent = vt('standaloneTitle');
    if (body) body.textContent = vt('standaloneBody');
    if (open) open.textContent = vt('standaloneOpen');
    if (hint) hint.textContent = vt('standaloneHint');
}

async function loadViewerFile(file) {
    if (!file) return;
    document.body.style.cursor = 'wait';
    try {
        if (/\.(dsf|dsp|zip)$/i.test(file.name)) {
            loadProjectData(await parseAndLoadDSF(file), { source: 'file' });
        } else {
            loadProjectData(JSON.parse(await file.text()), { source: 'file' });
        }
    } catch (e) {
        alert(vt('loadError', { message: e.message }));
        if (!projectLoaded) showStandaloneEmpty();
    } finally {
        document.body.style.cursor = '';
    }
}

async function loadRemoteDsf(src) {
    document.body.style.cursor = 'wait';
    try {
        const res = await fetch(src, { mode: 'cors' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
        const blob = await res.blob();
        const name = decodeURIComponent(new URL(src, window.location.href).pathname.split('/').pop() || 'remote.dsf');
        if (/\.(dsf|dsp|zip)$/i.test(name) || /zip|octet-stream/i.test(blob.type || '')) {
            loadProjectData(
                await parseAndLoadDSF(new File([blob], name, { type: blob.type || 'application/zip' })),
                { source: 'file' }
            );
        } else {
            loadProjectData(JSON.parse(await blob.text()), { source: 'file' });
        }
    } catch (e) {
        alert(vt('loadError', { message: e.message }));
        if (!projectLoaded) showStandaloneEmpty();
    } finally {
        document.body.style.cursor = '';
    }
}

function setupStandaloneFileDrop() {
    ['dragenter', 'dragover'].forEach(type => {
        window.addEventListener(type, (e) => {
            e.preventDefault();
            document.body.classList.add('viewer-drag-over');
            if (!projectLoaded) showStandaloneEmpty();
        });
    });
    ['dragleave', 'drop'].forEach(type => {
        window.addEventListener(type, (e) => {
            e.preventDefault();
            if (type === 'drop') {
                const file = e.dataTransfer?.files?.[0];
                if (file) loadViewerFile(file);
            }
            document.body.classList.remove('viewer-drag-over');
        });
    });
}

window.loadDsf = async (input) => {
    const file = input.files[0];
    try {
        await loadViewerFile(file);
    } finally {
        input.value = '';
    }
};

// ── Project Data ──────────────────────────────────────────────
function loadProjectData(raw, options = {}) {
    const source = options.source || 'file';
    const hasDsfPages = Array.isArray(raw.dsfPages) && raw.dsfPages.length > 0;
    if (source === 'shared' && !hasDsfPages) {
        throw new Error(vt('unpublishedProject'));
    }
    const pages = hasDsfPages
        ? normalizeDsfPages(raw.dsfPages)
        : normalizePagesGen3(raw.pages || raw.sections || []);
    const languages = resolveViewerLanguages(raw, hasDsfPages);
    const defaultLang = languages.includes(raw.defaultLang) ? raw.defaultLang : languages[0];
    const languageConfigs = normalizeLanguageConfigs(raw.languageConfigs, languages);
    viewerBookModel = buildViewerBookModel(raw, pages);
    viewerProjectMeta = buildViewerProjectMeta(raw, source);
    bookmarkRestoreAttempted = false;
    resetBookmarkUiState();
    resetReviewUiState();
    resetMetricState();
    bookSpreadIndex = 0;
    viewerInfoPanelState = 'closed';

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: raw.projectId || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'workId', value: raw.workId || raw.projectId || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'releaseId', value: raw.releaseId || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'title', value: raw.title || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: pages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: languages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: defaultLang } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: languageConfigs } });
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: defaultLang });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    syncViewerAutoSpreadMode();

    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = raw.title || '';

    projectLoaded = true;
    lastLoadErrorCode = '';
    hideStandaloneEmpty();
    renderViewerLanguagePicker();
    updateViewerInfoPanelLayout();
    renderViewerInfoPanel();

    refresh();
    trackViewStart();
    trackPageView('initial');
    void restoreBookmarkIfAvailable();
    void loadViewerReviews();
}

function buildViewerProjectMeta(raw, source) {
    const explicitTotal = Number(raw?.dsfTotalBytes);
    const dsfPages = Array.isArray(raw?.dsfPages) ? raw.dsfPages : [];
    const derivedTotal = dsfPages.reduce((sum, page) => {
        const totalBytes = Number(page?.totalBytes);
        if (Number.isFinite(totalBytes) && totalBytes > 0) return sum + totalBytes;
        const bytesByLang = page?.bytesByLang && typeof page.bytesByLang === 'object'
            ? Object.values(page.bytesByLang).reduce((inner, value) => inner + (Number(value) || 0), 0)
            : 0;
        return sum + bytesByLang;
    }, 0);
    return {
        source,
        resolution: String(raw?.dsfResolution || raw?.resolution || ''),
        totalBytes: Number.isFinite(explicitTotal) && explicitTotal > 0 ? explicitTotal : derivedTotal,
        qualityProfile: raw?.dsfQualityProfile || raw?.qualityProfile || null,
        labelName: String(raw?.labelName || '').trim(),
        meta: raw?.meta && typeof raw.meta === 'object' ? raw.meta : {},
        rootTitle: String(raw?.title || '').trim(),
        projectId: String(raw?.projectId || '').trim(),
        workId: String(raw?.workId || raw?.projectId || '').trim(),
        releaseId: String(raw?.releaseId || '').trim(),
        authorUid: String(raw?.authorUid || raw?.uid || '').trim()
    };
}

function createBookmarkUiState() {
    return {
        status: 'idle',
        bookmark: null,
        lastError: ''
    };
}

function resetBookmarkUiState() {
    bookmarkUiState = createBookmarkUiState();
}

function setBookmarkUiState(patch) {
    bookmarkUiState = { ...bookmarkUiState, ...patch };
    renderViewerInfoPanel();
}

function canUseViewerBookmark() {
    return viewerProjectMeta.source === 'shared' && !!viewerProjectMeta.workId;
}

function getCurrentBookmarkPayload() {
    const pages = getPages();
    const pageIndex = pages.length ? Math.max(0, Math.min(pages.length - 1, getIndex())) : 0;
    return {
        workId: viewerProjectMeta.workId,
        releaseId: viewerProjectMeta.releaseId || state.releaseId || null,
        language: state.activeLang || state.defaultLang || 'ja',
        pageIndex,
        pageCount: pages.length,
        progress: pages.length ? (pageIndex + 1) / pages.length : 0,
        completed: pages.length > 0 && pageIndex >= pages.length - 1
    };
}

function normalizeBookmarkData(data = {}) {
    const pages = getPages();
    const pageCount = pages.length;
    const pageIndex = pageCount ? Math.max(0, Math.min(pageCount - 1, Number(data.pageIndex) || 0)) : 0;
    const progress = pageCount ? (pageIndex + 1) / pageCount : 0;
    return {
        workId: String(data.workId || viewerProjectMeta.workId || ''),
        releaseId: data.releaseId || null,
        language: String(data.language || state.activeLang || state.defaultLang || 'ja'),
        pageIndex,
        pageCount,
        progress,
        completed: !!data.completed || (pageCount > 0 && pageIndex >= pageCount - 1),
        updatedAt: data.updatedAt || null
    };
}

function formatBookmarkStatusText() {
    if (!canUseViewerBookmark()) return vt('bookmarkNotShared');
    if (!state.uid) return vt('bookmarkSignedOut');
    if (bookmarkUiState.status === 'loading') return vt('bookmarkLoading');
    if (bookmarkUiState.status === 'saving') return vt('bookmarkSaving');
    if (bookmarkUiState.status === 'deleted') return vt('bookmarkDeleted');
    if (bookmarkUiState.status === 'error') {
        return vt('bookmarkError', { message: bookmarkUiState.lastError || 'unknown' });
    }
    const bookmark = bookmarkUiState.bookmark;
    if (!bookmark) return vt('bookmarkNone');
    return vt('bookmarkSaved', {
        page: String((Number(bookmark.pageIndex) || 0) + 1),
        total: String(bookmark.pageCount || getPages().length || 1)
    });
}

function renderViewerBookmarkSection() {
    const section = document.getElementById('viewer-info-bookmark-section');
    const container = document.getElementById('viewer-info-bookmark');
    if (!section || !container) return;
    section.hidden = !shouldShowViewerInfoBody();
    if (section.hidden) return;

    const bookmark = bookmarkUiState.bookmark;
    const progress = Math.round(((bookmark?.progress ?? getCurrentBookmarkPayload().progress) || 0) * 100);
    const signedIn = !!state.uid;
    const enabled = canUseViewerBookmark();
    const canResume = signedIn && enabled && !!bookmark;
    const canSave = signedIn && enabled;
    const canDelete = signedIn && enabled && !!bookmark;

    container.innerHTML = `
        <div class="viewer-info-bookmark-card" data-status="${esc(bookmarkUiState.status)}">
            <div class="viewer-info-bookmark-main">
                <span class="material-icons" aria-hidden="true">bookmark</span>
                <div>
                    <div class="viewer-info-bookmark-status">${esc(formatBookmarkStatusText())}</div>
                    <div class="viewer-info-bookmark-progress">${esc(vt('bookmarkProgress', { progress: String(progress) }))}</div>
                </div>
            </div>
            <div class="viewer-info-bookmark-actions">
                ${!signedIn ? `<button type="button" class="viewer-info-bookmark-primary" data-bookmark-signin>${esc(vt('bookmarkSignIn'))}</button>` : ''}
                ${canResume ? `<button type="button" class="viewer-info-bookmark-primary" data-bookmark-resume>${esc(vt('bookmarkResume'))}</button>` : ''}
                ${canSave ? `<button type="button" class="viewer-info-bookmark-secondary" data-bookmark-save>${esc(vt('bookmarkSaveNow'))}</button>` : ''}
                ${canSave ? `<button type="button" class="viewer-info-bookmark-secondary" data-bookmark-restart>${esc(vt('bookmarkRestart'))}</button>` : ''}
                ${canDelete ? `<button type="button" class="viewer-info-bookmark-danger" data-bookmark-delete>${esc(vt('bookmarkDelete'))}</button>` : ''}
            </div>
        </div>
    `;

    container.querySelector('[data-bookmark-signin]')?.addEventListener('click', () => {
        void signInWithGoogle({ authInstance: firebaseAuth })
            .catch((e) => alert(vt('authError', { message: e?.message || String(e) })));
    });
    container.querySelector('[data-bookmark-resume]')?.addEventListener('click', () => {
        resumeViewerBookmark();
    });
    container.querySelector('[data-bookmark-save]')?.addEventListener('click', () => {
        void saveBookmark().catch((e) => console.warn('[Viewer] bookmark save failed:', e));
    });
    container.querySelector('[data-bookmark-restart]')?.addEventListener('click', () => {
        restartViewerFromBeginning();
    });
    container.querySelector('[data-bookmark-delete]')?.addEventListener('click', () => {
        void deleteViewerBookmark().catch((e) => console.warn('[Viewer] bookmark delete failed:', e));
    });
}

async function restoreBookmarkIfAvailable() {
    if (bookmarkRestoreAttempted) return;
    if (!state.uid || !viewerProjectMeta.workId || viewerProjectMeta.source !== 'shared') return;
    bookmarkRestoreAttempted = true;
    try {
        setBookmarkUiState({ status: 'loading', lastError: '' });
        const snap = await getDoc(doc(db, 'users', state.uid, 'bookmarks', viewerProjectMeta.workId));
        if (!snap.exists()) {
            setBookmarkUiState({ status: 'none', bookmark: null, lastError: '' });
            return;
        }
        const bookmark = normalizeBookmarkData(snap.data() || {});
        const pages = getPages();
        if (!pages.length) {
            setBookmarkUiState({ status: 'saved', bookmark, lastError: '' });
            return;
        }
        const pageIndex = bookmark.pageIndex;
        const language = String(bookmark.language || '');
        if (language && (state.languages || []).includes(language)) {
            dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: language });
        }
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });
        if (spreadMode && hasBookModel()) {
            bookSpreadIndex = findBookUnitIndexForPage(pageIndex);
        }
        resetZoom();
        refresh();
        trackPageView('bookmark_restore');
        setBookmarkUiState({ status: 'saved', bookmark: normalizeBookmarkData(bookmark), lastError: '' });
    } catch (e) {
        setBookmarkUiState({ status: 'error', lastError: e?.message || String(e) });
        console.warn('[Viewer] bookmark restore failed:', e);
    }
}

function queueBookmarkSave() {
    if (!state.uid || !viewerProjectMeta.workId || viewerProjectMeta.source !== 'shared') return;
    clearTimeout(bookmarkSaveTimer);
    bookmarkSaveTimer = setTimeout(() => {
        void saveBookmark().catch((e) => console.warn('[Viewer] bookmark save failed:', e));
    }, 450);
}

async function saveBookmark() {
    const pages = getPages();
    if (!pages.length || !state.uid || !viewerProjectMeta.workId) return;
    const payload = getCurrentBookmarkPayload();
    setBookmarkUiState({ status: 'saving', lastError: '' });
    try {
        await setDoc(doc(db, 'users', state.uid, 'bookmarks', viewerProjectMeta.workId), {
            workId: payload.workId,
            releaseId: payload.releaseId,
            language: payload.language,
            pageIndex: payload.pageIndex,
            progress: payload.progress,
            completed: payload.completed,
            updatedAt: serverTimestamp()
        }, { merge: true });
        setBookmarkUiState({ status: 'saved', bookmark: payload, lastError: '' });
    } catch (e) {
        setBookmarkUiState({ status: 'error', lastError: e?.message || String(e) });
        throw e;
    }
}

function resumeViewerBookmark() {
    const bookmark = bookmarkUiState.bookmark;
    if (!bookmark) return;
    const pages = getPages();
    if (!pages.length) return;
    const pageIndex = Math.max(0, Math.min(pages.length - 1, Number(bookmark.pageIndex) || 0));
    const language = String(bookmark.language || '');
    if (language && (state.languages || []).includes(language)) {
        dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: language });
    }
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });
    if (spreadMode && hasBookModel()) {
        bookSpreadIndex = findBookUnitIndexForPage(pageIndex);
    }
    resetZoom();
    refresh();
    trackPageView('bookmark_resume');
}

function restartViewerFromBeginning() {
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    if (spreadMode && hasBookModel()) {
        bookSpreadIndex = findBookUnitIndexForPage(0);
    }
    resetZoom();
    refresh();
    trackPageView('bookmark_restart');
    void saveBookmark().catch((e) => console.warn('[Viewer] bookmark restart save failed:', e));
}

async function deleteViewerBookmark() {
    if (!state.uid || !viewerProjectMeta.workId) return;
    clearTimeout(bookmarkSaveTimer);
    try {
        await deleteDoc(doc(db, 'users', state.uid, 'bookmarks', viewerProjectMeta.workId));
        setBookmarkUiState({ status: 'deleted', bookmark: null, lastError: '' });
    } catch (e) {
        setBookmarkUiState({ status: 'error', lastError: e?.message || String(e) });
        throw e;
    }
}

function createReviewUiState() {
    return {
        status: 'idle',
        reviews: [],
        lastError: '',
        posted: false,
        reactionPendingId: ''
    };
}

function resetReviewUiState() {
    reviewUiState = createReviewUiState();
}

function setReviewUiState(patch) {
    reviewUiState = { ...reviewUiState, ...patch };
    renderViewerInfoPanel();
}

function canUseViewerReviews() {
    return viewerProjectMeta.source === 'shared' && !!viewerProjectMeta.workId;
}

function normalizeReviewData(id, data = {}) {
    return {
        reviewId: String(data.reviewId || id || ''),
        workId: String(data.workId || viewerProjectMeta.workId || ''),
        releaseId: String(data.releaseId || ''),
        projectId: String(data.projectId || ''),
        readerUid: String(data.readerUid || ''),
        readerName: String(data.readerName || vt('reviewAnonymous')).slice(0, 80),
        rating: Math.max(1, Math.min(5, Number(data.rating) || 0)),
        goodCount: Math.max(0, Number(data.goodCount) || 0),
        badCount: Math.max(0, Number(data.badCount) || 0),
        userReaction: data.userReaction === 'good' || data.userReaction === 'bad' ? data.userReaction : '',
        body: String(data.body || '').slice(0, 2000),
        status: String(data.status || 'published'),
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
    };
}

async function hydrateViewerReviewReactions(reviews) {
    if (!state.uid || !viewerProjectMeta.workId || !reviews.length) return reviews;
    const hydrated = await Promise.all(reviews.map(async (review) => {
        try {
            const reactionRef = doc(db, 'reviews', viewerProjectMeta.workId, 'items', review.reviewId, 'reactions', state.uid);
            const reactionSnap = await getDoc(reactionRef);
            if (!reactionSnap.exists()) return review;
            const reaction = reactionSnap.data()?.reaction;
            return {
                ...review,
                userReaction: reaction === 'good' || reaction === 'bad' ? reaction : ''
            };
        } catch (_) {
            return review;
        }
    }));
    return hydrated;
}

async function loadViewerReviews(options = {}) {
    if (!canUseViewerReviews()) {
        setReviewUiState({ status: 'idle', reviews: [], lastError: '' });
        return;
    }
    const previousReviews = Array.isArray(reviewUiState.reviews) ? reviewUiState.reviews : [];
    setReviewUiState({ status: 'loading', lastError: '' });
    try {
        const reviewQuery = query(
            collection(db, 'reviews', viewerProjectMeta.workId, 'items'),
            where('status', '==', 'published'),
            limit(20)
        );
        const snap = await getDocs(reviewQuery);
        let reviews = snap.docs
            .map((entry) => normalizeReviewData(entry.id, entry.data()))
            .sort((a, b) => compareFirestoreTimestampDesc(a.createdAt, b.createdAt));
        reviews = await hydrateViewerReviewReactions(reviews);
        if (options.keepPosted) {
            const seen = new Set(reviews.map((review) => review.reviewId));
            reviews = [
                ...previousReviews.filter((review) => review.reviewId && !seen.has(review.reviewId)),
                ...reviews
            ].sort((a, b) => compareFirestoreTimestampDesc(a.createdAt, b.createdAt));
        }
        setReviewUiState({
            status: 'loaded',
            reviews,
            lastError: '',
            posted: !!options.keepPosted && reviewUiState.posted
        });
    } catch (e) {
        setReviewUiState({ status: 'error', lastError: e?.message || String(e) });
        console.warn('[Viewer] reviews load failed:', e);
    }
}

function compareFirestoreTimestampDesc(a, b) {
    const aMs = typeof a?.toMillis === 'function' ? a.toMillis() : 0;
    const bMs = typeof b?.toMillis === 'function' ? b.toMillis() : 0;
    return bMs - aMs;
}

function getReviewFormValues(container) {
    const body = String(container.querySelector('[name="review-body"]')?.value || '').trim();
    return { body };
}

function autoResizeReviewTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(180, Math.max(42, textarea.scrollHeight))}px`;
}

function bindReviewTextareaAutosize(container) {
    const textarea = container.querySelector('[name="review-body"]');
    if (!textarea) return;
    autoResizeReviewTextarea(textarea);
    textarea.addEventListener('input', () => autoResizeReviewTextarea(textarea));
}

async function submitViewerReview(container) {
    if (!state.uid || !canUseViewerReviews()) return;
    const { body } = getReviewFormValues(container);
    if (!body) return;
    if (!window.confirm(vt('reviewConfirm', { body: body.slice(0, 1000) }))) return;
    setReviewUiState({ status: 'submitting', lastError: '', posted: false });
    try {
        const reviewRef = doc(collection(db, 'reviews', viewerProjectMeta.workId, 'items'));
        const payload = {
            reviewId: reviewRef.id,
            workId: viewerProjectMeta.workId,
            releaseId: viewerProjectMeta.releaseId || state.releaseId || '',
            projectId: viewerProjectMeta.projectId || state.projectId || '',
            authorUid: viewerProjectMeta.authorUid || '',
            readerUid: state.uid,
            readerName: String(state.user?.displayName || vt('reviewAnonymous')).slice(0, 80),
            goodCount: 0,
            badCount: 0,
            body: body.slice(0, 2000),
            status: 'published',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        await setDoc(reviewRef, payload);
        const localReview = normalizeReviewData(reviewRef.id, {
            ...payload,
            createdAt: { toMillis: () => Date.now() },
            updatedAt: { toMillis: () => Date.now() }
        });
        setReviewUiState({
            status: 'loaded',
            reviews: [localReview, ...reviewUiState.reviews.filter((review) => review.reviewId !== reviewRef.id)],
            lastError: '',
            posted: true
        });
        const bodyInput = container.querySelector('[name="review-body"]');
        if (bodyInput) {
            bodyInput.value = '';
            autoResizeReviewTextarea(bodyInput);
        }
        void loadViewerReviews({ keepPosted: true });
    } catch (e) {
        setReviewUiState({ status: 'error', lastError: e?.message || String(e), posted: false });
        throw e;
    }
}

async function setViewerReviewReaction(reviewId, reaction) {
    if (!state.uid || !canUseViewerReviews()) return;
    if (reaction !== 'good' && reaction !== 'bad') return;
    const existingReview = (reviewUiState.reviews || []).find((review) => review.reviewId === reviewId);
    if (!existingReview) return;
    const previousReaction = existingReview.userReaction || '';
    const nextReaction = previousReaction === reaction ? '' : reaction;
    setReviewUiState({ reactionPendingId: reviewId, lastError: '' });
    try {
        const reviewRef = doc(db, 'reviews', viewerProjectMeta.workId, 'items', reviewId);
        const reactionRef = doc(db, 'reviews', viewerProjectMeta.workId, 'items', reviewId, 'reactions', state.uid);
        const result = await runTransaction(db, async (transaction) => {
            const reviewSnap = await transaction.get(reviewRef);
            if (!reviewSnap.exists()) throw new Error('review not found');
            const reactionSnap = await transaction.get(reactionRef);
            const currentReaction = reactionSnap.exists() ? reactionSnap.data()?.reaction : '';
            const resolvedNext = currentReaction === reaction ? '' : reaction;
            let goodCount = Math.max(0, Number(reviewSnap.data()?.goodCount) || 0);
            let badCount = Math.max(0, Number(reviewSnap.data()?.badCount) || 0);
            if (currentReaction === 'good') goodCount = Math.max(0, goodCount - 1);
            if (currentReaction === 'bad') badCount = Math.max(0, badCount - 1);
            if (resolvedNext === 'good') goodCount += 1;
            if (resolvedNext === 'bad') badCount += 1;
            transaction.update(reviewRef, { goodCount, badCount, updatedAt: serverTimestamp() });
            if (resolvedNext) {
                if (reactionSnap.exists()) {
                    transaction.update(reactionRef, { reaction: resolvedNext, updatedAt: serverTimestamp() });
                } else {
                    transaction.set(reactionRef, {
                        workId: viewerProjectMeta.workId,
                        reviewId,
                        uid: state.uid,
                        reaction: resolvedNext,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                }
            } else if (reactionSnap.exists()) {
                transaction.delete(reactionRef);
            }
            return { goodCount, badCount, userReaction: resolvedNext };
        });
        setReviewUiState({
            reactionPendingId: '',
            reviews: (reviewUiState.reviews || []).map((review) => review.reviewId === reviewId
                ? { ...review, ...result }
                : review)
        });
    } catch (e) {
        setReviewUiState({
            reactionPendingId: '',
            lastError: e?.message || String(e)
        });
        console.warn('[Viewer] review reaction failed:', e);
    }
}

function renderViewerReviewSection() {
    const section = document.getElementById('viewer-info-review-section');
    const container = document.getElementById('viewer-info-reviews');
    if (!section || !container) return;
    section.hidden = !shouldShowViewerInfoBody();
    if (section.hidden) return;

    const enabled = canUseViewerReviews();
    const signedIn = !!state.uid;
    const disabledMessage = !enabled
        ? vt('reviewNotShared')
        : (!signedIn ? vt('reviewSignedOut') : '');
    const statusMessage = reviewUiState.status === 'loading'
        ? vt('reviewLoading')
        : (reviewUiState.status === 'error'
            ? vt('reviewError', { message: reviewUiState.lastError || 'unknown' })
            : (reviewUiState.posted ? vt('reviewPosted') : ''));
    const reviews = reviewUiState.reviews || [];

    container.innerHTML = `
        <div class="viewer-review-card">
            ${disabledMessage ? `<div class="viewer-review-note">${esc(disabledMessage)}</div>` : ''}
            ${statusMessage ? `<div class="viewer-review-note">${esc(statusMessage)}</div>` : ''}
            ${signedIn && enabled ? `
                <form class="viewer-review-form">
                    <label class="viewer-review-field">
                        <span>${esc(vt('reviewBodyLabel'))}</span>
                        <textarea name="review-body" rows="1" maxlength="2000" placeholder="${esc(vt('reviewBodyPlaceholder'))}"></textarea>
                    </label>
                    <button type="submit" class="viewer-review-submit" ${reviewUiState.status === 'submitting' ? 'disabled' : ''}>
                        ${esc(reviewUiState.status === 'submitting' ? vt('reviewSubmitting') : vt('reviewSubmit'))}
                    </button>
                </form>
            ` : ''}
            <div class="viewer-review-list">
                ${reviews.length ? reviews.map(renderViewerReviewItem).join('') : `<div class="viewer-review-empty">${esc(vt('reviewEmpty'))}</div>`}
            </div>
        </div>
    `;

    container.querySelector('.viewer-review-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        void submitViewerReview(container).catch((e) => console.warn('[Viewer] review submit failed:', e));
    });
    bindReviewTextareaAutosize(container);
    container.querySelectorAll('.viewer-review-reaction').forEach((button) => {
        button.addEventListener('click', () => {
            const reviewId = button.dataset.reviewId || '';
            const reaction = button.dataset.reaction || '';
            void setViewerReviewReaction(reviewId, reaction);
        });
    });
}

function renderViewerReviewItem(review) {
    const pending = reviewUiState.reactionPendingId === review.reviewId;
    const goodActive = review.userReaction === 'good';
    const badActive = review.userReaction === 'bad';
    return `
        <article class="viewer-review-item">
            <div class="viewer-review-item-head">
                <strong>${esc(vt('reviewBy', {
                    name: review.readerName || vt('reviewAnonymous')
                }))}</strong>
            </div>
            <p>${esc(review.body)}</p>
            <div class="viewer-review-reactions" aria-label="review reactions">
                <button type="button" class="viewer-review-reaction ${goodActive ? 'is-active' : ''}" data-review-id="${esc(review.reviewId)}" data-reaction="good" ${pending ? 'disabled' : ''}>
                    <span class="material-icons" aria-hidden="true">thumb_up</span>
                    <span>${esc(vt('reviewGood'))}</span>
                    <strong>${Math.max(0, Number(review.goodCount) || 0)}</strong>
                </button>
                <button type="button" class="viewer-review-reaction ${badActive ? 'is-active' : ''}" data-review-id="${esc(review.reviewId)}" data-reaction="bad" ${pending ? 'disabled' : ''} aria-label="${esc(vt('reviewBad'))}">
                    <span class="material-icons" aria-hidden="true">thumb_down</span>
                </button>
            </div>
        </article>
    `;
}

function getMetricSessionId() {
    try {
        const existing = sessionStorage.getItem(METRIC_SESSION_KEY);
        if (existing) return existing;
        const generated = `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(METRIC_SESSION_KEY, generated);
        return generated;
    } catch (_) {
        return `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
}

function resetMetricState() {
    metricViewStarted = false;
    metricReadCompleteSent = false;
    metricPageViewKeys.clear();
    metricDeliveryState = createMetricDeliveryState();
}

function shouldTrackMetrics() {
    return viewerProjectMeta.source === 'shared' && !!viewerProjectMeta.workId;
}

function createMetricDeliveryState() {
    return {
        pending: 0,
        sent: 0,
        failed: 0,
        lastEvent: null,
        lastError: ''
    };
}

function updateMetricDeliveryState(patch) {
    metricDeliveryState = { ...metricDeliveryState, ...patch };
    if (viewerDevMode) renderViewerDevMetrics();
}

function buildMetricDebugEvent(payload, status) {
    return {
        status,
        eventType: payload.eventType || '',
        reason: payload.reason || '',
        workId: payload.workId || '',
        releaseId: payload.releaseId || '',
        pageIndex: Number(payload.pageIndex) || 0,
        pageCount: Number(payload.pageCount) || 0,
        progress: Number(payload.progress) || 0,
        language: payload.language || '',
        at: new Date().toLocaleTimeString()
    };
}

function getMetricSnapshot(eventType, reason = '') {
    const pages = getPages();
    const pageCount = Math.max(0, pages.length);
    const pageIndex = pageCount ? Math.max(0, Math.min(pageCount - 1, getIndex())) : 0;
    const progress = pageCount ? (pageIndex + 1) / pageCount : 0;
    const readerUid = firebaseAuth?.currentUser?.uid || '';
    return {
        schemaVersion: METRIC_EVENT_SCHEMA_VERSION,
        eventType,
        workId: viewerProjectMeta.workId || '',
        releaseId: viewerProjectMeta.releaseId || state.releaseId || '',
        projectId: viewerProjectMeta.projectId || state.projectId || '',
        readerUid,
        isSignedIn: !!readerUid,
        sessionId: metricSessionId,
        language: state.activeLang || state.defaultLang || 'ja',
        pageIndex,
        pageCount,
        progress,
        reason: String(reason || '').slice(0, 40),
        source: viewerProjectMeta.source || 'shared',
        viewerPath: `${window.location.pathname}${window.location.search}`.slice(0, 256),
        referrer: String(document.referrer || '').slice(0, 500),
        viewportWidth: Math.max(0, Math.round(window.innerWidth || 0)),
        viewportHeight: Math.max(0, Math.round(window.innerHeight || 0)),
        createdAt: serverTimestamp()
    };
}

function enqueueMetricEvent(eventType, reason = '') {
    if (!shouldTrackMetrics()) return;
    const payload = getMetricSnapshot(eventType, reason);
    updateMetricDeliveryState({
        pending: metricDeliveryState.pending + 1,
        lastEvent: buildMetricDebugEvent(payload, 'pending'),
        lastError: ''
    });
    void addDoc(collection(db, 'metric_events'), payload)
        .then((ref) => {
            updateMetricDeliveryState({
                pending: Math.max(0, metricDeliveryState.pending - 1),
                sent: metricDeliveryState.sent + 1,
                lastEvent: { ...buildMetricDebugEvent(payload, 'sent'), eventId: ref.id },
                lastError: ''
            });
        })
        .catch((e) => {
            updateMetricDeliveryState({
                pending: Math.max(0, metricDeliveryState.pending - 1),
                failed: metricDeliveryState.failed + 1,
                lastEvent: buildMetricDebugEvent(payload, 'failed'),
                lastError: `${e?.code || 'error'} ${e?.message || e || ''}`.trim().slice(0, 180)
            });
            console.warn('[Viewer] metric event failed:', eventType, e);
        });
}

function trackViewStart() {
    if (metricViewStarted) return;
    metricViewStarted = true;
    enqueueMetricEvent('view_start', 'load');
}

function trackPageView(reason = 'navigation') {
    if (!shouldTrackMetrics()) return;
    const pageIndex = getIndex();
    const key = `${viewerProjectMeta.workId}:${viewerProjectMeta.releaseId || ''}:${state.activeLang}:${pageIndex}`;
    if (metricPageViewKeys.has(key)) return;
    metricPageViewKeys.add(key);
    enqueueMetricEvent('page_view', reason);
    trackReadCompleteIfNeeded();
}

function trackReadCompleteIfNeeded() {
    if (metricReadCompleteSent) return;
    const total = getTotal();
    if (total <= 0 || getIndex() < total - 1) return;
    metricReadCompleteSent = true;
    enqueueMetricEvent('read_complete', 'last_page');
}

function getViewerInfoLayoutMode() {
    return window.innerWidth >= 1024 ? 'drawer' : 'sheet';
}

function normalizeViewerInfoPanelState(nextState, layout = viewerInfoLayoutMode) {
    if (!VIEWER_INFO_STATES.includes(nextState)) return 'closed';
    if (layout === 'drawer') return nextState === 'closed' ? 'closed' : 'full';
    return nextState;
}

function updateViewerInfoPanelLayout() {
    viewerInfoLayoutMode = getViewerInfoLayoutMode();
    viewerInfoPanelState = normalizeViewerInfoPanelState(viewerInfoPanelState, viewerInfoLayoutMode);
    const panel = document.getElementById('viewer-info-panel');
    if (!panel) return;
    panel.dataset.layout = viewerInfoLayoutMode;
    syncViewerInfoChromeState();
}

function getViewerLocalizedMeta(lang = state.activeLang) {
    const meta = viewerProjectMeta.meta && typeof viewerProjectMeta.meta === 'object'
        ? viewerProjectMeta.meta
        : {};
    const current = meta?.[lang] && typeof meta[lang] === 'object' ? meta[lang] : {};
    const fallback = meta?.[state.defaultLang] && typeof meta[state.defaultLang] === 'object'
        ? meta[state.defaultLang]
        : {};
    return {
        title: String(current.title || fallback.title || state.title || viewerProjectMeta.rootTitle || '').trim(),
        author: String(current.author || fallback.author || '').trim(),
        description: String(current.description || fallback.description || '').trim(),
        linerNotes: String(current.linerNotes || fallback.linerNotes || '').trim(),
        series: String(current.series || fallback.series || '').trim()
    };
}

function stepViewerInfoState(from, direction) {
    const idx = VIEWER_INFO_STATES.indexOf(from);
    if (idx < 0) return 'closed';
    const next = idx + direction;
    return VIEWER_INFO_STATES[Math.max(0, Math.min(VIEWER_INFO_STATES.length - 1, next))];
}

function shouldShowViewerInfoBody() {
    return viewerInfoLayoutMode === 'drawer'
        ? viewerInfoPanelState !== 'closed'
        : viewerInfoPanelState === 'full';
}

function buildViewerInfoKicker(meta) {
    const parts = [];
    const langCode = String(state.activeLang || '').toUpperCase();
    if (langCode) parts.push(langCode);
    if (viewerProjectMeta.labelName) parts.push(viewerProjectMeta.labelName);
    else if (meta.author) parts.push(meta.author);
    return parts.join(' / ');
}

function parseViewerRichText(text) {
    const source = String(text || '').trim();
    if (!source) return '';
    const paragraphs = source.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return paragraphs.map((block) => {
        const html = esc(block)
            .replace(/\{\{([^|{}]+)\|([^{}]+)\}\}/g, (_, label, link) => {
                const safeLabel = esc(String(label || '').trim());
                const rawLink = String(link || '').trim();
                if (!safeLabel) return '';
                if (/^https?:\/\//i.test(rawLink)) {
                    return `<a href="${esc(rawLink)}" target="_blank" rel="noreferrer noopener">${safeLabel}</a>`;
                }
                if (/^(\/|\.\/|\.\.\/)/.test(rawLink)) {
                    return `<a href="${esc(rawLink)}">${safeLabel}</a>`;
                }
                return `<span class="viewer-info-inline-link-disabled" title="${esc(rawLink)}">${safeLabel}</span>`;
            })
            .replace(/\n/g, '<br>');
        return `<p>${html}</p>`;
    }).join('');
}

function renderViewerInfoPanel() {
    const panel = document.getElementById('viewer-info-panel');
    if (!panel) return;
    updateViewerInfoPanelLayout();
    panel.dataset.state = viewerInfoPanelState;
    panel.hidden = viewerInfoLayoutMode === 'sheet' && viewerInfoPanelState === 'closed';
    syncViewerInfoChromeState();
    if (viewerInfoPanelState === 'closed') return;

    const meta = getViewerLocalizedMeta();
    const title = meta.title || state.title || viewerProjectMeta.rootTitle || 'Untitled';
    const label = viewerProjectMeta.labelName;
    const description = meta.description;
    const linerNotes = meta.linerNotes;
    const series = meta.series;

    const kickerEl = document.getElementById('viewer-info-kicker');
    const titleEl = document.getElementById('viewer-info-title');
    const seriesEl = document.getElementById('viewer-info-series');
    const labelRow = document.getElementById('viewer-info-label-row');
    const labelEl = document.getElementById('viewer-info-label');
    const authorRow = document.getElementById('viewer-info-author-row');
    const authorEl = document.getElementById('viewer-info-author');
    const descEl = document.getElementById('viewer-info-description');
    const notesSection = document.getElementById('viewer-info-notes-section');
    const notesEl = document.getElementById('viewer-info-notes');
    const bookmarkSection = document.getElementById('viewer-info-bookmark-section');
    const reviewSection = document.getElementById('viewer-info-review-section');
    const expandBtn = document.getElementById('viewer-info-expand-btn');
    const peekBtn = document.getElementById('viewer-info-peek-btn');
    const handleBtn = document.getElementById('viewer-info-handle');

    if (kickerEl) kickerEl.textContent = buildViewerInfoKicker(meta);
    if (titleEl) titleEl.textContent = title;

    if (seriesEl) {
        seriesEl.hidden = !series;
        seriesEl.textContent = series;
    }

    if (labelRow) labelRow.hidden = !label;
    if (labelEl) labelEl.textContent = label;
    if (authorRow) authorRow.hidden = !meta.author;
    if (authorEl) authorEl.textContent = meta.author;

    if (descEl) {
        descEl.hidden = !description;
        descEl.textContent = description;
    }

    if (notesSection) notesSection.hidden = !shouldShowViewerInfoBody() || !linerNotes;
    if (notesEl) notesEl.innerHTML = linerNotes ? parseViewerRichText(linerNotes) : '';

    if (bookmarkSection) bookmarkSection.hidden = !shouldShowViewerInfoBody();
    renderViewerBookmarkSection();

    if (reviewSection) reviewSection.hidden = !shouldShowViewerInfoBody();
    renderViewerReviewSection();
    if (expandBtn) expandBtn.hidden = viewerInfoLayoutMode === 'drawer' || viewerInfoPanelState === 'full';
    if (peekBtn) peekBtn.hidden = viewerInfoLayoutMode === 'drawer' || viewerInfoPanelState === 'peek';
    if (handleBtn) handleBtn.hidden = viewerInfoLayoutMode === 'drawer';
}

function applyViewerInfoPanelLabels() {
    const infoBtn = document.getElementById('viewer-info-btn');
    if (infoBtn) infoBtn.title = vt('infoPanel');
    const handleBtn = document.getElementById('viewer-info-handle');
    if (handleBtn) handleBtn.setAttribute('aria-label', vt('infoPanelOpen'));
    const closeBtn = document.getElementById('viewer-info-close-btn');
    if (closeBtn) closeBtn.title = vt('infoPanelClose');
    const expandBtn = document.getElementById('viewer-info-expand-btn');
    if (expandBtn) expandBtn.title = vt('infoPanelExpand');
    const peekBtn = document.getElementById('viewer-info-peek-btn');
    if (peekBtn) peekBtn.title = vt('infoPanelCollapse');

    const labelLabels = document.querySelectorAll('#viewer-info-label-row .viewer-info-meta-label');
    labelLabels.forEach((node) => { node.textContent = vt('infoLabel'); });
    const authorLabels = document.querySelectorAll('#viewer-info-author-row .viewer-info-meta-label');
    authorLabels.forEach((node) => { node.textContent = vt('infoAuthor'); });
    const notesTitle = document.querySelector('#viewer-info-notes-section .viewer-info-section-title');
    if (notesTitle) notesTitle.textContent = vt('infoLinerNotes');
    const bookmarkTitle = document.querySelector('#viewer-info-bookmark-section .viewer-info-section-title');
    if (bookmarkTitle) bookmarkTitle.textContent = vt('bookmarkTitle');
    const reviewTitle = document.querySelector('#viewer-info-review-section .viewer-info-section-title');
    if (reviewTitle) reviewTitle.textContent = vt('infoReviews');
}

function bindViewerInfoHandle() {
    const shell = getViewerInfoPanelShell();
    if (!shell || shell.dataset.dragBound === '1') return;
    shell.dataset.dragBound = '1';
    shell.addEventListener('pointerdown', onViewerInfoHandlePointerDown);
    shell.addEventListener('pointermove', onViewerInfoHandlePointerMove);
    shell.addEventListener('pointerup', onViewerInfoHandlePointerUp);
    shell.addEventListener('pointercancel', onViewerInfoHandlePointerCancel);
}

function getViewerInfoPanelShell() {
    return document.querySelector('#viewer-info-panel .viewer-info-panel-shell');
}

function getViewerInfoSheetHeights() {
    const isCompact = window.innerWidth <= 768;
    const peek = isCompact ? 104 : 98;
    const summary = isCompact ? 208 : 220;
    const full = Math.min(
        Math.round(window.innerHeight * 0.9),
        Math.max(summary + 40, window.innerHeight - 72)
    );
    return { peek, summary, full };
}

function getViewerInfoCurrentSheetHeight() {
    const shell = getViewerInfoPanelShell();
    const measured = shell?.getBoundingClientRect?.().height || 0;
    if (measured > 0) return measured;
    const heights = getViewerInfoSheetHeights();
    if (viewerInfoPanelState === 'full') return heights.full;
    if (viewerInfoPanelState === 'summary') return heights.summary;
    if (viewerInfoPanelState === 'peek') return heights.peek;
    return 0;
}

function setViewerInfoSheetDragHeight(height) {
    const shell = getViewerInfoPanelShell();
    if (!shell) return;
    shell.classList.add('is-dragging');
    shell.style.height = `${Math.max(0, height)}px`;
}

function clearViewerInfoSheetDragHeight() {
    const shell = getViewerInfoPanelShell();
    if (!shell) return;
    shell.classList.remove('is-dragging');
    shell.style.removeProperty('height');
}

function getViewerInfoStateFromHeight(height) {
    const { peek, summary, full } = getViewerInfoSheetHeights();
    if (height <= peek * 0.48) return 'closed';
    const candidates = [
        { state: 'peek', height: peek },
        { state: 'summary', height: summary },
        { state: 'full', height: full }
    ];
    return candidates
        .map((item) => ({ ...item, distance: Math.abs(item.height - height) }))
        .sort((a, b) => a.distance - b.distance)[0]?.state || 'peek';
}

function onViewerInfoHandlePointerDown(event) {
    if (viewerInfoLayoutMode !== 'sheet') return;
    if (event.target.closest('a, button, input, textarea, select, label')) return;
    viewerInfoHandleDrag.active = true;
    viewerInfoHandleDrag.pointerId = event.pointerId;
    viewerInfoHandleDrag.startY = event.clientY;
    viewerInfoHandleDrag.startHeight = getViewerInfoCurrentSheetHeight();
    viewerInfoHandleDrag.currentHeight = viewerInfoHandleDrag.startHeight;
    const body = document.getElementById('viewer-info-body');
    viewerInfoHandleDrag.startedInBody = !!event.target.closest('#viewer-info-body');
    viewerInfoHandleDrag.bodyScrollTop = body?.scrollTop || 0;
    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
}

function onViewerInfoHandlePointerMove(event) {
    if (!viewerInfoHandleDrag.active || viewerInfoHandleDrag.pointerId !== event.pointerId) return;
    const dy = event.clientY - viewerInfoHandleDrag.startY;
    const body = document.getElementById('viewer-info-body');
    const bodyScrollTop = body?.scrollTop || 0;
    const draggingDown = dy > 0;
    const draggingUp = dy < 0;
    const fullState = viewerInfoPanelState === 'full';

    if (viewerInfoHandleDrag.startedInBody && fullState) {
        if (draggingUp) return;
        if (draggingDown && bodyScrollTop > 0) return;
    }

    event.preventDefault();
    const { full } = getViewerInfoSheetHeights();
    const nextHeight = Math.max(
        0,
        Math.min(full, viewerInfoHandleDrag.startHeight - (dy * VIEWER_INFO_HANDLE_SENSITIVITY))
    );
    viewerInfoHandleDrag.currentHeight = nextHeight;
    setViewerInfoSheetDragHeight(nextHeight);
}

function onViewerInfoHandlePointerUp(event) {
    if (!viewerInfoHandleDrag.active || viewerInfoHandleDrag.pointerId !== event.pointerId) return;
    const dy = event.clientY - viewerInfoHandleDrag.startY;
    const magnitude = Math.abs(dy);
    try { event.currentTarget?.releasePointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
    viewerInfoHandleDrag.active = false;
    viewerInfoHandleDrag.pointerId = null;
    viewerInfoHandleDrag.startedInBody = false;
    viewerInfoHandleDrag.bodyScrollTop = 0;
    clearViewerInfoSheetDragHeight();
    if (magnitude < 8) {
        window.advanceViewerInfoPanel();
        return;
    }
    const next = getViewerInfoStateFromHeight(viewerInfoHandleDrag.currentHeight);
    window.setViewerInfoPanelState(next);
}

function onViewerInfoHandlePointerCancel(event) {
    if (viewerInfoHandleDrag.pointerId !== event.pointerId) return;
    try { event.currentTarget?.releasePointerCapture?.(event.pointerId); } catch (_) { /* ignore */ }
    viewerInfoHandleDrag.active = false;
    viewerInfoHandleDrag.pointerId = null;
    viewerInfoHandleDrag.startedInBody = false;
    viewerInfoHandleDrag.bodyScrollTop = 0;
    clearViewerInfoSheetDragHeight();
}

function isViewerInfoSheetOpen() {
    return viewerInfoLayoutMode === 'sheet' && viewerInfoPanelState !== 'closed';
}

function syncViewerInfoChromeState() {
    const ui = document.getElementById('viewer-ui');
    const layout = document.getElementById('viewer-layout');
    if (!ui) return;
    ui.classList.toggle('viewer-sheet-open', isViewerInfoSheetOpen());
    layout?.classList.toggle('viewer-drawer-open', viewerInfoLayoutMode === 'drawer' && viewerInfoPanelState !== 'closed');
}

function isViewerBottomSwipeStart(clientX, clientY) {
    if (viewerInfoLayoutMode !== 'sheet' || viewerInfoPanelState !== 'closed') return false;
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    return clientY >= rect.bottom - Math.min(VIEWER_INFO_SWIPE_ZONE, rect.height * 0.18);
}

window.setViewerInfoPanelState = (nextState) => {
    viewerInfoPanelState = normalizeViewerInfoPanelState(nextState, getViewerInfoLayoutMode());
    renderViewerInfoPanel();
    if (getViewerInfoLayoutMode() === 'drawer') requestAnimationFrame(() => resizeCanvas());
};

window.toggleViewerInfoPanel = () => {
    if (getViewerInfoLayoutMode() === 'drawer') {
        window.setViewerInfoPanelState(viewerInfoPanelState === 'closed' ? 'full' : 'closed');
        return;
    }
    if (viewerInfoPanelState === 'closed' || viewerInfoPanelState === 'peek') {
        window.setViewerInfoPanelState('summary');
        return;
    }
    window.setViewerInfoPanelState('closed');
};

window.stepUpViewerInfoPanel = () => {
    if (viewerInfoLayoutMode === 'drawer') {
        window.setViewerInfoPanelState('full');
        return;
    }
    const from = viewerInfoPanelState === 'closed' ? 'peek' : viewerInfoPanelState;
    window.setViewerInfoPanelState(stepViewerInfoState(from, 1));
};

window.stepDownViewerInfoPanel = () => {
    if (viewerInfoLayoutMode === 'drawer') {
        window.setViewerInfoPanelState('closed');
        return;
    }
    const from = viewerInfoPanelState === 'closed' ? 'peek' : viewerInfoPanelState;
    window.setViewerInfoPanelState(stepViewerInfoState(from, -1));
};

window.advanceViewerInfoPanel = () => {
    if (viewerInfoLayoutMode === 'drawer') {
        window.setViewerInfoPanelState(viewerInfoPanelState === 'closed' ? 'full' : 'closed');
        return;
    }
    if (viewerInfoPanelState === 'closed') {
        window.setViewerInfoPanelState('summary');
        return;
    }
    if (viewerInfoPanelState === 'peek') {
        window.setViewerInfoPanelState('summary');
        return;
    }
    if (viewerInfoPanelState === 'summary') {
        window.setViewerInfoPanelState('full');
        return;
    }
    window.setViewerInfoPanelState('summary');
};

function collapseViewerInfoPanelForNavigation() {
    if (viewerInfoLayoutMode === 'drawer') return;
    if (viewerInfoPanelState === 'full') {
        viewerInfoPanelState = 'summary';
        renderViewerInfoPanel();
    }
}

function resolveViewerLanguages(raw, hasDsfPages) {
    if (hasDsfPages) {
        const dsfLangs = Array.isArray(raw.dsfLangs)
            ? raw.dsfLangs.map((code) => String(code || '').trim()).filter(Boolean)
            : [];
        if (dsfLangs.length) return [...new Set(dsfLangs)];

        const langsFromPages = new Set();
        for (const page of raw.dsfPages || []) {
            const urls = page?.urls;
            if (!urls || typeof urls !== 'object') continue;
            Object.keys(urls).forEach((code) => {
                if (code && code !== '__all') langsFromPages.add(code);
            });
        }
        if (langsFromPages.size) return [...langsFromPages];
    }

    const projectLangs = Array.isArray(raw.languages)
        ? raw.languages.map((code) => String(code || '').trim()).filter(Boolean)
        : [];
    return projectLangs.length ? [...new Set(projectLangs)] : ['ja'];
}

/**
 * DSF ページ正規化（dsfPages: R2 WebP URLs）
 */
function normalizeDsfPages(dsfPages) {
    return dsfPages.map((p, i) => {
        const spreadImage = normalizeDsfSpreadImageMeta(p.spreadImage);
        const devMeta = {
            pageType: p.pageType || '',
            bytesByLang: { ...(p.bytesByLang || {}) },
            totalBytes: Number(p.totalBytes) || 0
        };
        const content = {
            backgrounds: { ...(p.urls || {}) },
            thumbnail: '',
            bubbles: {}
        };
        if (spreadImage) {
            devMeta.spreadImage = spreadImage;
            content.spreadImage = spreadImage;
        }
        return {
            id: `dsf_${p.pageNum || i + 1}`,
            devMeta,
            content,
            ...(spreadImage ? { spreadImage } : {})
        };
    });
}

function normalizeDsfSpreadImageMeta(raw) {
    if (!raw || typeof raw !== 'object' || !raw.groupId) return null;
    const rolesByLang = {};
    if (raw.rolesByLang && typeof raw.rolesByLang === 'object') {
        Object.entries(raw.rolesByLang).forEach(([lang, role]) => {
            const code = String(lang || '').trim();
            const normalizedRole = role === 'left' || role === 'right' ? role : '';
            if (code && normalizedRole) rolesByLang[code] = normalizedRole;
        });
    }
    const physicalRole = raw.physicalRole === 'left' || raw.physicalRole === 'right'
        ? raw.physicalRole
        : '';
    return {
        groupId: String(raw.groupId),
        ...(physicalRole ? { physicalRole } : {}),
        ...(Object.keys(rolesByLang).length ? { rolesByLang } : {}),
        ...(raw.authoringRole === 'right' || raw.authoringRole === 'left' ? { authoringRole: raw.authoringRole } : {})
    };
}

/**
 * Gen3 ページ正規化。
 * 旧フォーマット（content.background 単一文字列）も受け入れる。
 */
function normalizePagesGen3(rawPages) {
    return rawPages.map((p, i) => {
        const c = p.content || {};
        const spreadImage = normalizeDsfSpreadImageMeta(c.spreadImage || p.spreadImage);
        // Gen3: backgrounds は言語コードをキーとするオブジェクト
        // 旧フォーマット: background が単一文字列 → '__all' キーで保持
        const backgrounds = typeof c.backgrounds === 'object' && c.backgrounds !== null
            ? { ...c.backgrounds }
            : {};
        if (!Object.keys(backgrounds).length && c.background) {
            backgrounds['__all'] = c.background;
        }
        // bubbles: Gen3 では言語キーのオブジェクト or 旧フォーマットの配列
        const bubbles = (c.bubbles && !Array.isArray(c.bubbles))
            ? c.bubbles
            : (Array.isArray(c.bubbles) ? { '__all': c.bubbles } : {});
        return {
            id: p.id || `page_${i}`,
            content: {
                backgrounds,
                thumbnail: c.thumbnail || '',
                bubbles,
                ...(spreadImage ? { spreadImage } : {})
            },
            ...(spreadImage ? { spreadImage } : {})
        };
    });
}

/**
 * languageConfigs 正規化。
 * 旧フォーマット（writingMode）から pageDirection を導出する。
 */
function normalizeLanguageConfigs(raw, languages) {
    const configs = {};
    languages.forEach(lang => {
        const existing = raw?.[lang] || {};
        let dir = existing.pageDirection;
        if (!dir) {
            // 旧フォーマット互換: vertical-rl (日本語縦書き) → rtl
            dir = (existing.writingMode === 'vertical-rl') ? 'rtl' : 'ltr';
        }
        configs[lang] = { pageDirection: dir };
    });
    return configs;
}

// ── Book Model ────────────────────────────────────────────────
function isBookModeRequested() {
    return ['1', 'true', 'paper', 'book', 'simple', 'full'].includes(requestedBookMode);
}

function clonePageSurface(page, role = 'P', sourcePageIndex = -1) {
    if (!page) return null;
    return {
        ...page,
        bookRole: role,
        sourcePageIndex,
        content: {
            ...(page.content || {}),
            backgrounds: { ...(page.content?.backgrounds || {}) },
            bubbles: { ...(page.content?.bubbles || {}) }
        }
    };
}

function makeBlankSurface(role = 'blank') {
    return {
        id: `book_${role}_blank`,
        bookRole: role,
        sourcePageIndex: -1,
        virtualBlank: true,
        content: { backgrounds: {}, bubbles: {} }
    };
}

function normalizeCoverSurface(rawCover, role, pages = []) {
    if (!rawCover) return null;
    if (typeof rawCover === 'string') {
        return {
            id: `cover_${role.toLowerCase()}`,
            bookRole: role,
            sourcePageIndex: -1,
            content: { backgrounds: { '__all': rawCover }, bubbles: {} }
        };
    }

    const page = Array.isArray(rawCover) ? rawCover[0] : rawCover;
    if (!page || typeof page !== 'object') return null;

    const refIndex = Number.isFinite(Number(page.pageIndex))
        ? Number(page.pageIndex)
        : Number.isFinite(Number(page.pageNum))
            ? Number(page.pageNum) - 1
            : Number.isFinite(Number(page.index))
                ? Number(page.index)
                : null;
    if (refIndex !== null) {
        const idx = Math.max(0, Math.min(pages.length - 1, Math.round(refIndex)));
        return clonePageSurface(pages[idx], role, idx);
    }

    if (page.content) {
        return clonePageSurface(normalizePagesGen3([{ ...page, id: page.id || `cover_${role.toLowerCase()}` }])[0], role, -1);
    }

    const backgrounds = {};
    if (page.urls && typeof page.urls === 'object') Object.assign(backgrounds, page.urls);
    if (page.backgrounds && typeof page.backgrounds === 'object') Object.assign(backgrounds, page.backgrounds);
    if (page.background) backgrounds['__all'] = page.background;
    if (page.url) backgrounds['__all'] = page.url;
    if (page.src) backgrounds['__all'] = page.src;

    if (!Object.keys(backgrounds).length) return null;
    return {
        id: page.id || `cover_${role.toLowerCase()}`,
        bookRole: role,
        sourcePageIndex: -1,
        content: { backgrounds, thumbnail: page.thumbnail || '', bubbles: page.bubbles || {} }
    };
}

function pickCover(covers, names) {
    for (const name of names) {
        if (covers?.[name]) return covers[name];
    }
    return null;
}

function buildFullBookUnits(covers, bodyPages, dir) {
    const blank = (role) => makeBlankSurface(role);
    const units = [{ type: 'single', center: covers.c1, role: 'C1' }];

    if (dir === 'rtl') {
        if (bodyPages[0] || covers.c2) {
            units.push({ type: 'spread', left: bodyPages[0] || blank('P1'), right: covers.c2 || blank('C2') });
        }
        const middle = bodyPages.slice(1);
        while (middle.length > 1) {
            const right = middle.shift();
            const left = middle.shift();
            units.push({ type: 'spread', left, right });
        }
        if (middle.length || covers.c3) {
            units.push({ type: 'spread', left: covers.c3 || blank('C3'), right: middle[0] || blank('last') });
        }
    } else {
        if (bodyPages[0] || covers.c2) {
            units.push({ type: 'spread', left: covers.c2 || blank('C2'), right: bodyPages[0] || blank('P1') });
        }
        const middle = bodyPages.slice(1);
        while (middle.length > 1) {
            const left = middle.shift();
            const right = middle.shift();
            units.push({ type: 'spread', left, right });
        }
        if (middle.length || covers.c3) {
            units.push({ type: 'spread', left: middle[0] || blank('last'), right: covers.c3 || blank('C3') });
        }
    }

    units.push({ type: 'single', center: covers.c4, role: 'C4' });
    return units.filter(Boolean);
}

function buildSimpleBookUnits(covers, bodyPages, dir) {
    const blank = (role) => makeBlankSurface(role);
    const units = [{ type: 'single', center: covers.c1, role: 'C1' }];
    for (let i = 0; i < bodyPages.length; i += 2) {
        const first = bodyPages[i];
        const second = bodyPages[i + 1] || blank('body');
        units.push(dir === 'rtl'
            ? { type: 'spread', left: second, right: first }
            : { type: 'spread', left: first, right: second });
    }
    units.push({ type: 'single', center: covers.c4, role: 'C4' });
    return units;
}

function getSurfacePhysicalSpreadRole(surface, lang) {
    const meta = getSurfaceSpreadImageMeta(surface);
    if (!meta || typeof meta !== 'object' || !meta.groupId) return '';
    const roleForLang = meta.rolesByLang?.[lang];
    if (roleForLang === 'left' || roleForLang === 'right') return roleForLang;
    return meta.physicalRole === 'left' || meta.physicalRole === 'right' ? meta.physicalRole : '';
}

function getSurfaceSpreadImageMeta(surface) {
    return surface?.content?.spreadImage || surface?.spreadImage || surface?.devMeta?.spreadImage || null;
}

function getSurfaceSpreadGroupId(surface) {
    const meta = getSurfaceSpreadImageMeta(surface);
    return meta?.groupId ? String(meta.groupId) : '';
}

function normalizeSpreadUnitForLang(unit, lang) {
    if (!unit || unit.type !== 'spread') return unit;
    const leftGroup = getSurfaceSpreadGroupId(unit.left);
    const rightGroup = getSurfaceSpreadGroupId(unit.right);
    if (!leftGroup || leftGroup !== rightGroup) return unit;

    const leftRole = getSurfacePhysicalSpreadRole(unit.left, lang);
    const rightRole = getSurfacePhysicalSpreadRole(unit.right, lang);
    if (!leftRole || !rightRole || leftRole === rightRole) return unit;

    const surfaces = [unit.left, unit.right];
    const physicalLeft = surfaces.find((surface) => getSurfacePhysicalSpreadRole(surface, lang) === 'left');
    const physicalRight = surfaces.find((surface) => getSurfacePhysicalSpreadRole(surface, lang) === 'right');
    if (!physicalLeft || !physicalRight) return unit;
    return { ...unit, left: physicalLeft, right: physicalRight };
}

function buildViewerBookModel(raw, pages) {
    const coversRaw = raw.book?.covers || raw.covers || {};
    const explicitMode = raw.book?.mode || raw.bookMode || coversRaw.mode || '';
    const forceBook = isBookModeRequested();
    const hasExplicitCovers = !!(coversRaw && Object.keys(coversRaw).length);
    if (!explicitMode && !hasExplicitCovers && !forceBook) return null;

    let c1 = normalizeCoverSurface(
        pickCover(coversRaw, ['c1', 'C1', 'front', 'frontCover', 'coverFront']) || raw.coverFront,
        'C1',
        pages
    );
    let c2 = normalizeCoverSurface(
        pickCover(coversRaw, ['c2', 'C2', 'insideFront', 'frontInside', 'coverInsideFront']),
        'C2',
        pages
    );
    let c3 = normalizeCoverSurface(
        pickCover(coversRaw, ['c3', 'C3', 'insideBack', 'backInside', 'coverInsideBack']),
        'C3',
        pages
    );
    let c4 = normalizeCoverSurface(
        pickCover(coversRaw, ['c4', 'C4', 'back', 'backCover', 'coverBack']) || raw.coverBack,
        'C4',
        pages
    );
    let bodyPages = [];

    if (forceBook && (!c1 || !c4) && pages.length >= 2) {
        c1 = c1 || clonePageSurface(pages[0], 'C1', 0);
        c4 = c4 || clonePageSurface(pages[pages.length - 1], 'C4', pages.length - 1);
        bodyPages = pages.slice(1, -1).map((page, i) => clonePageSurface(page, `P${i + 1}`, i + 1));
    }

    if (!c1 || !c4) return null;
    if (!bodyPages.length) {
        const coverIndexes = new Set([c1, c2, c3, c4]
            .map(surface => surface?.sourcePageIndex)
            .filter(idx => Number.isInteger(idx) && idx >= 0));
        bodyPages = pages
            .map((page, i) => coverIndexes.has(i) ? null : clonePageSurface(page, `P${i + 1}`, i))
            .filter(Boolean);
    }

    const requestedFull = requestedBookMode === 'full' || String(explicitMode).toLowerCase() === 'full';
    const hasInsideCovers = !!(c2 || c3);
    const mode = requestedFull || hasInsideCovers ? 'full' : 'simple';
    const covers = { c1, c2, c3, c4 };

    return {
        enabled: true,
        mode,
        covers,
        bodyPages,
        spreadsByDir: {
            rtl: mode === 'full' ? buildFullBookUnits(covers, bodyPages, 'rtl') : buildSimpleBookUnits(covers, bodyPages, 'rtl'),
            ltr: mode === 'full' ? buildFullBookUnits(covers, bodyPages, 'ltr') : buildSimpleBookUnits(covers, bodyPages, 'ltr')
        }
    };
}

function hasBookModel() {
    return !!viewerBookModel?.enabled;
}

function getBookUnits() {
    if (!hasBookModel()) return [];
    const dir = getPageDirection() === 'rtl' ? 'rtl' : 'ltr';
    return viewerBookModel.spreadsByDir?.[dir] || [];
}

function getCurrentBookUnit() {
    const units = getBookUnits();
    if (!units.length) return null;
    bookSpreadIndex = Math.max(0, Math.min(bookSpreadIndex, units.length - 1));
    return normalizeSpreadUnitForLang(units[bookSpreadIndex], state.activeLang);
}

function getBookUnitPrimaryPageIndex(unit) {
    const candidates = unit?.center
        ? [unit.center]
        : [unit?.right, unit?.left].sort((a, b) => {
            const aBody = /^P\d+$/i.test(String(a?.bookRole || '')) ? 0 : 1;
            const bBody = /^P\d+$/i.test(String(b?.bookRole || '')) ? 0 : 1;
            return aBody - bBody;
        });
    const page = candidates.find((surface) => Number.isInteger(surface?.sourcePageIndex) && surface.sourcePageIndex >= 0);
    return page ? page.sourcePageIndex : -1;
}

function findBookUnitIndexForPage(pageIndex) {
    const units = getBookUnits();
    const idx = units.findIndex((unit) => [unit.center, unit.left, unit.right].some((surface) => surface?.sourcePageIndex === pageIndex));
    return idx >= 0 ? idx : 0;
}

// ── Language ──────────────────────────────────────────────────
window.switchViewerLang = (code) => {
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: code });
    closeViewerLangMenu();
    refresh();
    queueBookmarkSave();
    trackPageView('language_change');
};

function getPageDirection() {
    return state.languageConfigs?.[state.activeLang]?.pageDirection || 'ltr';
}

function vt(key, vars = {}) {
    const template = VIEWER_UI[viewerUiLang]?.[key] ?? VIEWER_UI.ja[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function getViewerBadgeModifier(code) {
    const normalized = String(code || '').trim().toLowerCase();
    if (normalized === 'ja') return 'ja';
    if (normalized === 'en' || normalized === 'en-us') return 'en-us';
    if (normalized === 'en-gb') return 'en-gb';
    if (normalized === 'zh-cn') return 'zh-cn';
    if (normalized === 'zh-tw') return 'zh-tw';
    return 'generic';
}

function renderViewerLanguageBadge(code) {
    const modifier = getViewerBadgeModifier(code);
    const label = String(code || '').toUpperCase();
    return `<span class="viewer-lang-badge viewer-lang-${modifier}">${modifier === 'generic' ? esc(label) : ''}</span>`;
}

function getViewerDirectionArrow(code) {
    const dir = state.languageConfigs?.[code]?.pageDirection || 'ltr';
    return dir === 'rtl' ? '&lt;&lt;' : '&gt;&gt;';
}

function renderViewerLanguageOption(code) {
    const props = getLangProps(code);
    const dirArrow = getViewerDirectionArrow(code);
    const codeLabel = String(code).toUpperCase();
    return `
        ${renderViewerLanguageBadge(code)}
        <span class="viewer-lang-text">
            <span class="viewer-lang-label">${esc(props.label)}</span>
            <span class="viewer-lang-code">${esc(codeLabel)}</span>
            <span class="viewer-lang-dir">${dirArrow}</span>
        </span>
    `;
}

function renderViewerLanguagePicker() {
    const picker = document.getElementById('viewer-lang-picker');
    const button = document.getElementById('lang-picker-button');
    const menu = document.getElementById('lang-picker-menu');
    if (!picker || !button || !menu) return;

    const languages = state.languages?.length ? state.languages : [];
    if (languages.length <= 1) {
        picker.style.display = 'none';
        picker.classList.remove('open');
        menu.innerHTML = '';
        button.innerHTML = '';
        return;
    }

    picker.style.display = 'block';
    button.innerHTML = renderViewerLanguageOption(state.activeLang);
    menu.innerHTML = languages.map((code) => `
        <button class="viewer-lang-option ${code === state.activeLang ? 'active' : ''}" type="button" data-viewer-lang="${code}">
            ${renderViewerLanguageOption(code)}
        </button>
    `).join('');

    menu.querySelectorAll('[data-viewer-lang]').forEach((item) => {
        item.addEventListener('click', () => {
            window.switchViewerLang(item.dataset.viewerLang);
        });
    });
}

window.toggleViewerLangMenu = () => {
    const picker = document.getElementById('viewer-lang-picker');
    if (!picker || picker.style.display === 'none') return;
    picker.classList.toggle('open');
};

function closeViewerLangMenu() {
    document.getElementById('viewer-lang-picker')?.classList.remove('open');
}

function closeViewerAuthDropdown() {
    const authRoot = document.querySelector('.viewer-auth');
    const trigger = authRoot?.querySelector('.viewer-auth-trigger');
    authRoot?.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');
}

/** Google 公式ボタンは表示中のコンテナ向け。閉じたドロップダウン内では 0 サイズになりがちなので開いた直後に描画する。 */
function tryMountViewerGisButton() {
    if (state.uid) return;
    const host = document.getElementById('gis-btn-viewer');
    if (!host) return;
    host.innerHTML = '';
    renderGISButton('gis-btn-viewer', {
        authInstance: firebaseAuth,
        buttonOptions: {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'rectangular',
            text: 'signin_with',
            logo_alignment: 'left'
        }
    }).catch((err) => console.warn('[Viewer] GIS button render failed:', err));
}

function renderViewerAuthSlot(user = state.user || null) {
    const slot = document.getElementById('viewer-auth-slot');
    if (!slot) return;

    const themeMode = getThemeMode();
    const nameRaw = user?.displayName || user?.email || vt('guest');
    const initial = ((nameRaw || 'U').trim()[0] || 'U').toUpperCase();

    const signInOutBlock = user
        ? `<button type="button" class="viewer-auth-action" data-auth-toggle>${esc(vt('signOut'))}</button>`
        : `
                <div class="viewer-auth-section-label">${esc(vt('signIn'))}</div>
                <div class="viewer-auth-gis-slot">
                    <div id="gis-btn-viewer"></div>
                    <button type="button" class="viewer-auth-signin-fallback" data-viewer-auth-signin-fallback aria-label="${esc(vt('signIn'))}">
                        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
                        ${esc(vt('signIn'))}
                    </button>
                </div>
            `;

    slot.innerHTML = `
        <div class="viewer-auth">
            <button type="button" class="viewer-auth-trigger" aria-label="${esc(vt('account'))}" aria-expanded="false">
                ${user?.photoURL
                    ? `<img src="${esc(user.photoURL)}" alt="${esc(nameRaw)}" referrerpolicy="no-referrer">`
                    : user
                        ? `<span class="viewer-auth-initials">${esc(initial)}</span>`
                        : `<span class="material-icons" aria-hidden="true">account_circle</span>`}
            </button>
            <div class="viewer-auth-dropdown">
                <div class="viewer-auth-name">${esc(nameRaw)}</div>
                <div class="viewer-auth-section-label">${esc(vt('themeLabel'))}</div>
                <div class="viewer-theme-switcher">
                    <button type="button" class="viewer-theme-btn ${themeMode === 'device' ? 'active' : ''}" data-theme-mode="device">${esc(vt('modeDevice'))}</button>
                    <button type="button" class="viewer-theme-btn ${themeMode === 'light' ? 'active' : ''}" data-theme-mode="light">${esc(vt('modeLight'))}</button>
                    <button type="button" class="viewer-theme-btn ${themeMode === 'dark' ? 'active' : ''}" data-theme-mode="dark">${esc(vt('modeDark'))}</button>
                </div>
                ${signInOutBlock}
                <button type="button" class="viewer-dev-hotspot" aria-hidden="true" tabindex="-1"></button>
            </div>
        </div>
    `;

    const authRoot = slot.querySelector('.viewer-auth');
    const trigger = slot.querySelector('.viewer-auth-trigger');
    trigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        const shouldOpen = !authRoot?.classList.contains('open');
        closeViewerAuthDropdown();
        if (shouldOpen) {
            authRoot?.classList.add('open');
            trigger?.setAttribute('aria-expanded', 'true');
            if (!user) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => tryMountViewerGisButton());
                });
            }
        }
    });

    slot.querySelectorAll('[data-theme-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
            setThemeMode(btn.dataset.themeMode);
            applyTheme();
            renderViewerAuthSlot(state.user || null);
        });
    });

    slot.querySelector('[data-auth-toggle]')?.addEventListener('click', async () => {
        closeViewerAuthDropdown();
        try {
            await signOutUser(firebaseAuth);
        } catch (e) {
            alert(vt('authError', { message: e?.message || String(e) }));
        }
    });

    slot.querySelector('[data-viewer-auth-signin-fallback]')?.addEventListener('click', async () => {
        closeViewerAuthDropdown();
        try {
            await signInWithGoogle({ authInstance: firebaseAuth });
        } catch (e) {
            alert(vt('authError', { message: e?.message || String(e) }));
        }
    });

    const hotspot = slot.querySelector('.viewer-dev-hotspot');
    let holdTimer = null;
    let holdTriggered = false;
    const clearHold = () => {
        if (holdTimer) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
        }
    };
    hotspot?.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        holdTriggered = false;
        clearHold();
        holdTimer = window.setTimeout(() => {
            holdTriggered = true;
            toggleViewerDevMode();
        }, VIEWER_DEV_HOLD_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => {
        hotspot?.addEventListener(type, (event) => {
            clearHold();
            if (holdTriggered) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    });
}

function applyViewerDevSmoothingClass() {
    document.body.classList.toggle('viewer-dev-smooth-page', viewerDevSmoothing);
}

function toggleViewerDevMode() {
    viewerDevMode = !viewerDevMode;
    localStorage.setItem(VIEWER_DEV_MODE_KEY, viewerDevMode ? '1' : '0');
    showViewerDevToast(vt(viewerDevMode ? 'developerModeOn' : 'developerModeOff'));
    renderViewerDevMetrics(getPages()[getIndex()], state.activeLang);
}

function showViewerDevToast(message) {
    let toast = document.getElementById('viewer-dev-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'viewer-dev-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(showViewerDevToast._timerId);
    showViewerDevToast._timerId = window.setTimeout(() => {
        toast.classList.remove('visible');
    }, 1600);
}

window.setViewerUiLang = (lang) => {
    if (!VIEWER_UI[lang]) return;
    viewerUiLang = lang;
    localStorage.setItem(VIEWER_UI_LANG_KEY, lang);
    applyViewerUiLanguage();
    renderViewerLanguagePicker();
    refresh();
};

function applyViewerUiLanguage() {
    document.documentElement.lang = viewerUiLang === 'en' ? 'en' : 'ja';
    document.querySelectorAll('.viewer-ui-lang-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.uiLang === viewerUiLang);
    });
    const closeBtn = document.getElementById('viewer-close-btn');
    if (closeBtn) closeBtn.title = vt('close');
    const fileBtn = document.getElementById('viewer-file-btn');
    if (fileBtn) fileBtn.title = vt('openFile');
    const zonePrev = document.getElementById('zone-prev');
    const zoneNext = document.getElementById('zone-next');
    const zoneMenu = document.getElementById('zone-menu');
    if (zoneMenu) zoneMenu.title = vt('toggleUi');
    if (zonePrev) zonePrev.title = vt('prevPage');
    if (zoneNext) zoneNext.title = vt('nextPage');
    updateStandaloneEmptyText();
    applyViewerInfoPanelLabels();
    renderViewerInfoPanel();
    renderViewerAuthSlot(state.user || null);
    if (viewerDevMode) renderViewerDevMetrics();
}

// ── Navigation ────────────────────────────────────────────────
function getPages() { return Array.isArray(state.pages) ? state.pages : []; }
function getTotal() { return getPages().length; }
function getIndex() { return Math.max(0, Math.min(state.activeIdx || 0, getTotal() - 1)); }

function getPageAssetUrl(page, lang) {
    const bgs = page?.content?.backgrounds || {};
    const rawUrl = bgs[lang] || bgs['__all'] || '';
    return rawUrl ? getOptimizedImageUrl(rawUrl) : '';
}

function getPreloadLanguages() {
    const langs = [state.activeLang, state.defaultLang].filter(Boolean);
    return [...new Set(langs)].slice(0, 2);
}

function collectBookUnitSurfaces(unit) {
    return [unit?.center, unit?.left, unit?.right].filter((surface) => surface && !surface.virtualBlank);
}

function preloadViewerImageUrl(url) {
    if (!url || viewerPreloadedImageUrls.has(url)) return;
    viewerPreloadedImageUrls.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = url;
    if (img.decode) img.decode().catch(() => {});
}

function preloadNearbyViewerImages() {
    const pages = getPages();
    if (!pages.length) return;
    const langs = getPreloadLanguages();
    const targets = new Set();

    if (spreadMode && hasBookModel()) {
        const units = getBookUnits();
        const from = Math.max(0, bookSpreadIndex - VIEWER_PRELOAD_BOOK_UNIT_RADIUS);
        const to = Math.min(units.length - 1, bookSpreadIndex + VIEWER_PRELOAD_BOOK_UNIT_RADIUS);
        for (let i = from; i <= to; i++) {
            langs.forEach((lang) => {
                collectBookUnitSurfaces(normalizeSpreadUnitForLang(units[i], lang)).forEach((surface) => targets.add(surface));
            });
        }
    } else {
        const index = getIndex();
        const from = Math.max(0, index - VIEWER_PRELOAD_PAGE_RADIUS);
        const to = Math.min(pages.length - 1, index + VIEWER_PRELOAD_PAGE_RADIUS);
        for (let i = from; i <= to; i++) targets.add(pages[i]);
    }

    targets.forEach((page) => {
        langs.forEach((lang) => preloadViewerImageUrl(getPageAssetUrl(page, lang)));
    });
}

function scheduleViewerDevMorphPipeline() {
    if (!viewerDevMorph) return;
    viewerDevMorphLastRun = { pending: true, replaced: 0, skipped: 0, lastErr: '' };
    queueMicrotask(() => {
        void runViewerDevMorphPipeline();
    });
}

/**
 * 輝度しきい値でインクマスクを作り、3×3 1 回膨張。新規インク画素は単色で塗る（試行用）。
 */
function dilateInkOnceLuminance(imageData, lumThreshold) {
    const { data, width, height } = imageData;
    const n = width * height;
    const ink = new Uint8Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        ink[p] = L < lumThreshold ? 1 : 0;
    }
    const dil = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (ink[p]) {
                dil[p] = 1;
                continue;
            }
            let v = 0;
            neighbor: for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    if (ink[ny * width + nx]) {
                        v = 1;
                        break neighbor;
                    }
                }
            }
            dil[p] = v;
        }
    }
    const newInkRgb = 26;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        if (!dil[p] || ink[p]) continue;
        data[i] = newInkRgb;
        data[i + 1] = newInkRgb;
        data[i + 2] = newInkRgb;
        data[i + 3] = 255;
    }
}

/** Hosted viewer only: same-origin /media-proxy fallback when direct fetch() is CORS-blocked. */
function canUseMorphMediaProxy() {
    if (typeof window === 'undefined') return false;
    const { protocol, hostname } = window.location;
    if (protocol === 'file:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    return true;
}

async function fetchImageForMorphDev(url) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

async function morphReplaceImgWithCanvasIfNeeded(img) {
    if (!img || img.tagName !== 'IMG' || !viewerDevMorph) return { ok: false, err: '' };
    const src = String(img.currentSrc || img.src || '').trim();
    if (!src) return { ok: false, err: 'no src' };

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, err: 'no 2d context' };

    let w = 0;
    let h = 0;

    try {
        if (src.startsWith('blob:') || src.startsWith('data:')) {
            let nw = img.naturalWidth;
            let nh = img.naturalHeight;
            if (!nw || !nh) {
                try {
                    if (img.decode) await img.decode();
                    nw = img.naturalWidth;
                    nh = img.naturalHeight;
                } catch (_) {
                    await new Promise((resolve, reject) => {
                        const ok = () => {
                            nw = img.naturalWidth;
                            nh = img.naturalHeight;
                            if (nw && nh) resolve();
                            else reject(new Error('no natural size'));
                        };
                        if (img.complete) ok();
                        else {
                            img.onload = ok;
                            img.onerror = () => reject(new Error('image load error'));
                        }
                    });
                }
            }
            w = nw;
            h = nh;
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0);
        } else {
            let res;
            if (canUseMorphMediaProxy()) {
                try {
                    res = await fetchImageForMorphDev(src);
                } catch {
                    const proxyUrl = new URL('/media-proxy', window.location.origin);
                    proxyUrl.searchParams.set('u', src);
                    res = await fetch(proxyUrl.toString(), { credentials: 'omit' });
                    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
                }
            } else {
                res = await fetchImageForMorphDev(src);
            }
            const blob = await res.blob();
            const bitmap = await createImageBitmap(blob);
            w = bitmap.width;
            h = bitmap.height;
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
        }

        const imageData = ctx.getImageData(0, 0, w, h);
        dilateInkOnceLuminance(imageData, VIEWER_DEV_MORPH_LUM_THRESHOLD);
        ctx.putImageData(imageData, 0, 0);
    } catch (e) {
        const msg = e?.message || String(e);
        console.warn('[Viewer] dev morph skipped:', msg);
        return { ok: false, err: msg };
    }

    canvas.className = img.className;
    img.replaceWith(canvas);
    return { ok: true };
}

async function runViewerDevMorphPipeline() {
    if (!viewerDevMorph) {
        viewerDevMorphLastRun = { pending: false, replaced: 0, skipped: 0, lastErr: '' };
        return;
    }

    const imgs = document.querySelectorAll(
        '#viewer-content img.viewer-page-image, #viewer-spread-content img.viewer-page-image'
    );
    let replaced = 0;
    let skipped = 0;
    let lastErr = '';
    for (const img of imgs) {
        try {
            const r = await morphReplaceImgWithCanvasIfNeeded(img);
            if (r?.ok) replaced += 1;
            else {
                skipped += 1;
                if (r?.err) lastErr = r.err;
            }
        } catch (e) {
            skipped += 1;
            lastErr = e?.message || String(e);
            console.warn('[Viewer] dev morph failed:', lastErr);
        }
    }
    viewerDevMorphLastRun = {
        pending: false,
        replaced,
        skipped,
        lastErr: lastErr || ''
    };
    if (viewerDevMode) renderViewerDevMetrics();
}

function renderPageContentHTML(page, lang) {
    const url = getPageAssetUrl(page, lang);
    if (!url) {
        return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;">${vt('imageMissing')}</div>`;
    }
    const spreadRole = getSurfacePhysicalSpreadRole(page, lang);
    const spreadClass = spreadRole ? ` viewer-page-image-spread viewer-page-image-spread-${spreadRole}` : '';
    const spreadAttr = spreadRole ? ` data-spread-role="${esc(spreadRole)}"` : '';
    // Never set crossOrigin on the displayed img: without media CORS the image fails to decode (broken image).
    // Morph uses fetch() + createImageBitmap so pixels are readable when R2 CORS allows the viewer origin.
    return `<img class="viewer-page-image${spreadClass}"${spreadAttr} src="${esc(url)}" loading="eager">`;
}

function renderPageBubblesHTML(page, lang) {
    const bubbles = page?.content?.bubbles?.[lang]
        ?? page?.content?.bubbles?.['__all']
        ?? [];
    return Array.isArray(bubbles)
        ? bubbles.map((b, i) => renderBubbleHTML(b, i, false)).join('')
        : '';
}

function renderSurfaceContentHTML(surface, lang) {
    if (surface?.virtualBlank) return '<div class="viewer-blank-page" aria-hidden="true"></div>';
    return renderPageContentHTML(surface, lang);
}

function renderSurfaceBubblesHTML(surface, lang) {
    if (surface?.virtualBlank) return '';
    return renderPageBubblesHTML(surface, lang);
}

function renderPageIntoDom(page, lang) {
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    if (contentEl) {
        delete contentEl.dataset.singleSpread;
        contentEl.style.setProperty('--viewer-single-spread-offset', '0%');
        contentEl.innerHTML = renderSurfaceContentHTML(page, lang);
    }
    if (bubblesEl) {
        delete bubblesEl.dataset.singleSpread;
        bubblesEl.style.setProperty('--viewer-single-spread-offset', '0%');
        bubblesEl.innerHTML = renderSurfaceBubblesHTML(page, lang);
    }
    resetSingleSpreadSwipe();
    scheduleViewerDevMorphPipeline();
    renderViewerDevMetrics();
}

function getDisplaySurfaceCandidates(displayIndex) {
    const pages = getPages();
    const rawPage = pages[displayIndex] || null;
    const mappedSurface = getViewerSurfaceForDisplayIndex(displayIndex) || null;
    return [mappedSurface, rawPage].filter((surface, pos, list) => (
        surface && list.indexOf(surface) === pos
    ));
}

function findSpreadSurfaceForDisplayIndex(displayIndex, lang, expectedGroupId = '', excludedRole = '') {
    const candidates = getDisplaySurfaceCandidates(displayIndex);
    for (const surface of candidates) {
        const groupId = getSurfaceSpreadGroupId(surface);
        const role = getSurfacePhysicalSpreadRole(surface, lang);
        if (!groupId || (role !== 'left' && role !== 'right')) continue;
        if (expectedGroupId && groupId !== expectedGroupId) continue;
        if (excludedRole && role === excludedRole) continue;
        return { surface, groupId, role };
    }
    return null;
}

function getSingleModeSpreadPair(displayIndex, lang) {
    if (spreadMode) return null;
    const pages = getPages();
    if (pages.length <= 1 || displayIndex < 0 || displayIndex >= pages.length) return null;

    const currentInfo = findSpreadSurfaceForDisplayIndex(displayIndex, lang);
    const current = currentInfo?.surface;
    const groupId = currentInfo?.groupId || '';
    const currentRole = currentInfo?.role || '';
    if (!groupId || (currentRole !== 'left' && currentRole !== 'right')) return null;

    const candidateIndexes = [
        displayIndex - 1,
        displayIndex + 1,
        ...pages.map((_, index) => index)
    ].filter((index, pos, list) => (
        index >= 0
        && index < pages.length
        && index !== displayIndex
        && list.indexOf(index) === pos
    ));

    let partnerInfo = null;
    const partnerIndex = candidateIndexes.find((index) => {
        partnerInfo = findSpreadSurfaceForDisplayIndex(index, lang, groupId, currentRole);
        return Boolean(partnerInfo);
    });
    if (!Number.isInteger(partnerIndex)) return null;

    const partner = partnerInfo?.surface || getViewerSurfaceForDisplayIndex(partnerIndex) || pages[partnerIndex];
    const currentIsLeft = currentRole === 'left';
    return {
        groupId,
        currentIndex: displayIndex,
        currentRole,
        partnerIndex,
        leftIndex: currentIsLeft ? displayIndex : partnerIndex,
        rightIndex: currentIsLeft ? partnerIndex : displayIndex,
        left: currentIsLeft ? current : partner,
        right: currentIsLeft ? partner : current
    };
}

function renderSingleModeSpreadPairIntoDom(pair, lang) {
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    const offset = pair.currentRole === 'right' ? -50 : 0;
    const contentHtml = `
        <div class="viewer-single-spread-strip" style="--viewer-single-spread-offset:${offset}%">
            <div class="viewer-single-spread-page viewer-single-spread-page-left">${renderSurfaceContentHTML(pair.left, lang)}</div>
            <div class="viewer-single-spread-page viewer-single-spread-page-right">${renderSurfaceContentHTML(pair.right, lang)}</div>
        </div>
    `;
    const bubblesHtml = `
        <div class="viewer-single-spread-strip viewer-single-spread-bubbles" style="--viewer-single-spread-offset:${offset}%">
            <div class="viewer-single-spread-page viewer-single-spread-page-left">${renderSurfaceBubblesHTML(pair.left, lang)}</div>
            <div class="viewer-single-spread-page viewer-single-spread-page-right">${renderSurfaceBubblesHTML(pair.right, lang)}</div>
        </div>
    `;

    if (contentEl) {
        contentEl.dataset.singleSpread = 'true';
        contentEl.innerHTML = contentHtml;
    }
    if (bubblesEl) {
        bubblesEl.dataset.singleSpread = 'true';
        bubblesEl.innerHTML = bubblesHtml;
    }
    resetSingleSpreadSwipe();
    scheduleViewerDevMorphPipeline();
    renderViewerDevMetrics();
}

function renderDisplayIndexIntoDom(displayIndex, lang) {
    const pair = getSingleModeSpreadPair(displayIndex, lang);
    if (pair) {
        renderSingleModeSpreadPairIntoDom(pair, lang);
        return;
    }
    const page = getViewerSurfaceForDisplayIndex(displayIndex) || getPages()[displayIndex];
    renderPageIntoDom(page, lang);
}

function renderViewerDevMetrics() {
    let panel = document.getElementById('viewer-dev-metrics');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'viewer-dev-metrics';
        document.body.appendChild(panel);
    }
    if (!viewerDevMode) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }

    const lang = state.activeLang;
    const pageEntries = getViewerDevMetricEntries(lang);
    const totalBytes = Number(viewerProjectMeta.totalBytes) || 0;
    const totalPages = getPages().length;
    const avgBytes = totalPages > 0 && totalBytes > 0 ? Math.round(totalBytes / totalPages) : 0;
    const quality = viewerProjectMeta.qualityProfile?.image
        ? `${viewerProjectMeta.qualityProfile.image}%`
        : '—';
    const pageSummary = pageEntries.map((entry) => `${entry.label} ${entry.pageRef}`).join(' / ') || '—';

    let morphStatusMain = '';
    let morphStatusErrHtml = '';
    if (!viewerDevMorph) {
        morphStatusMain = vt('devMorphStatusOff');
    } else if (viewerDevMorphLastRun.pending) {
        morphStatusMain = vt('devMorphStatusPending');
    } else {
        morphStatusMain = vt('devMorphStatusResult', {
            replaced: viewerDevMorphLastRun.replaced,
            skipped: viewerDevMorphLastRun.skipped
        });
        if (viewerDevMorphLastRun.skipped > 0) {
            morphStatusMain += ` ${vt('devMorphStatusHint')}`;
        }
    }
    if (viewerDevMorph && !viewerDevMorphLastRun.pending && viewerDevMorphLastRun.skipped > 0 && viewerDevMorphLastRun.lastErr) {
        morphStatusErrHtml = viewerDevMorphLastRun.lastErr.slice(0, 160);
    }
    const metricEnabled = shouldTrackMetrics();
    const metricLast = metricDeliveryState.lastEvent;
    const metricStatus = metricLast
        ? `${metricLast.status} ${metricLast.eventType}${metricLast.reason ? `:${metricLast.reason}` : ''}`
        : (metricEnabled ? 'waiting' : 'disabled');
    const metricLastPage = metricLast?.pageCount
        ? `${metricLast.pageIndex + 1}/${metricLast.pageCount} ${Math.round(metricLast.progress * 100)}%`
        : '—';
    const metricLastAt = metricLast?.at || '—';
    const metricLastId = metricLast?.eventId || '';
    const metricDisabledReason = !metricEnabled
        ? (viewerProjectMeta.source !== 'shared' ? 'not shared viewer' : 'missing workId')
        : '';

    panel.hidden = false;
    panel.innerHTML = `
        <div class="viewer-dev-metrics-title">Developer mode</div>
        <div class="viewer-dev-smooth-row">
            <label class="viewer-dev-smooth-label" for="viewer-dev-smooth-input">
                <input type="checkbox" id="viewer-dev-smooth-input" ${viewerDevSmoothing ? 'checked' : ''} />
                <span>${esc(vt('devSmoothing'))}</span>
            </label>
            <div class="viewer-dev-smooth-note">${esc(vt('devSmoothingNote'))}</div>
        </div>
        <div class="viewer-dev-morph-row">
            <label class="viewer-dev-smooth-label" for="viewer-dev-morph-input">
                <input type="checkbox" id="viewer-dev-morph-input" ${viewerDevMorph ? 'checked' : ''} />
                <span>${esc(vt('devMorph'))}</span>
            </label>
            <div class="viewer-dev-smooth-note">${esc(vt('devMorphNote'))}</div>
            <div class="viewer-dev-morph-status">${esc(morphStatusMain)}</div>
            ${morphStatusErrHtml ? `<div class="viewer-dev-morph-status-err">${esc(morphStatusErrHtml)}</div>` : ''}
        </div>
        <div class="viewer-dev-events-row">
            <div class="viewer-dev-events-title">Metric events</div>
            <div class="viewer-dev-events-grid">
                <span>State</span><strong class="viewer-dev-event-status viewer-dev-event-status-${esc(metricLast?.status || (metricEnabled ? 'waiting' : 'disabled'))}">${esc(metricStatus)}</strong>
                <span>Queue</span><strong>P ${esc(String(metricDeliveryState.pending))} / S ${esc(String(metricDeliveryState.sent))} / F ${esc(String(metricDeliveryState.failed))}</strong>
                <span>Page</span><strong>${esc(metricLastPage)}</strong>
                <span>Session</span><strong>${esc(metricSessionId.slice(-10))}</strong>
                <span>Last</span><strong>${esc(metricLastAt)}</strong>
                ${metricLastId ? `<span>Event ID</span><strong>${esc(metricLastId.slice(0, 10))}…</strong>` : ''}
            </div>
            ${metricDisabledReason ? `<div class="viewer-dev-events-note">${esc(metricDisabledReason)}</div>` : ''}
            ${metricDeliveryState.lastError ? `<div class="viewer-dev-events-error">${esc(metricDeliveryState.lastError)}</div>` : ''}
        </div>
        <div class="viewer-dev-metrics-grid">
            <span>Lang</span><strong>${esc(String(lang || '').toUpperCase())}</strong>
            <span>Pages</span><strong>${esc(pageSummary)}</strong>
            <span>Total pages</span><strong>${esc(String(totalPages || '—'))}</strong>
            <span>Avg/page</span><strong>${formatBytes(avgBytes)}</strong>
            <span>Total</span><strong>${formatBytes(totalBytes)}</strong>
            <span>Res</span><strong>${esc(viewerProjectMeta.resolution || '—')}</strong>
            <span>Q(img)</span><strong>${esc(quality)}</strong>
        </div>
        <div class="viewer-dev-metrics-pages">
            ${pageEntries.map((entry) => `
                <div class="viewer-dev-page-card">
                    <div class="viewer-dev-page-card-title">${esc(entry.label)} ${esc(entry.pageRef)}</div>
                    <div class="viewer-dev-page-card-meta">
                        <span>${esc(entry.pageType)}</span>
                        <strong>${formatBytes(entry.bytes)}</strong>
                    </div>
                    ${entry.imageUrl ? `<div class="viewer-dev-metrics-url">${esc(entry.imageUrl)}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    panel.querySelector('#viewer-dev-smooth-input')?.addEventListener('change', (e) => {
        viewerDevSmoothing = !!e.target?.checked;
        localStorage.setItem(VIEWER_DEV_SMOOTHING_KEY, viewerDevSmoothing ? '1' : '0');
        applyViewerDevSmoothingClass();
    });
    panel.querySelector('#viewer-dev-morph-input')?.addEventListener('change', (e) => {
        viewerDevMorph = !!e.target?.checked;
        localStorage.setItem(VIEWER_DEV_MORPH_KEY, viewerDevMorph ? '1' : '0');
        refresh();
    });
}

function getViewerDevMetricEntries(lang) {
    if (spreadMode && hasBookModel()) {
        return getBookMetricEntries(lang);
    }
    if (spreadMode) {
        return getRegularSpreadMetricEntries(lang);
    }
    const page = getPages()[getIndex()];
    return page ? [buildViewerDevMetricEntry('Page', page, lang)] : [];
}

function getBookMetricEntries(lang) {
    const unit = getCurrentBookUnit();
    if (!unit) return [];
    if (unit.type === 'single') {
        return unit.center ? [buildViewerDevMetricEntry(unit.role || 'Page', unit.center, lang)] : [];
    }
    return [
        buildViewerDevMetricEntry('Left', unit.left, lang),
        buildViewerDevMetricEntry('Right', unit.right, lang)
    ].filter(Boolean);
}

function getRegularSpreadMetricEntries(lang) {
    const pages = getPages();
    const idx = getIndex();
    const current = pages[idx];
    if (!current) return [];
    const dir = getPageDirection();
    const adjIdx = dir === 'rtl' ? idx - 1 : idx + 1;
    const adjacent = (adjIdx >= 0 && adjIdx < pages.length) ? pages[adjIdx] : null;
    if (dir === 'rtl') {
        return [
            buildViewerDevMetricEntry('Left', adjacent, lang),
            buildViewerDevMetricEntry('Right', current, lang)
        ].filter(Boolean);
    }
    return [
        buildViewerDevMetricEntry('Left', current, lang),
        buildViewerDevMetricEntry('Right', adjacent, lang)
    ].filter(Boolean);
}

function buildViewerDevMetricEntry(label, page, lang) {
    if (!page) return null;
    if (page.virtualBlank) {
        return {
            label,
            pageRef: 'blank',
            pageType: 'blank',
            bytes: 0,
            imageUrl: ''
        };
    }
    const sourcePageIndex = Number.isInteger(page?.sourcePageIndex) && page.sourcePageIndex >= 0
        ? page.sourcePageIndex + 1
        : null;
    return {
        label,
        pageRef: sourcePageIndex ? `#${sourcePageIndex}` : (page?.bookRole || '—'),
        pageType: page?.devMeta?.pageType || page?.pageType || 'page',
        bytes: Number(page?.devMeta?.bytesByLang?.[lang])
            || Number(page?.devMeta?.bytesByLang?.__all)
            || Number(page?.devMeta?.totalBytes)
            || 0,
        imageUrl: getPageAssetUrl(page, lang)
    };
}

function formatBytes(bytes) {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num <= 0) return '—';
    if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    return `${Math.round(num / 1024)} KB`;
}

function createTransitionLayer(contentHtml, bubblesHtml) {
    const layer = document.createElement('div');
    layer.className = 'viewer-transition-layer';
    layer.innerHTML = `
        <div class="viewer-transition-media">${contentHtml}</div>
        <div class="viewer-transition-bubbles">${bubblesHtml}</div>
    `;
    return layer;
}

function clearTransitionLayers() {
    document.querySelectorAll('.viewer-transition-layer').forEach((node) => node.remove());
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    if (contentEl) contentEl.style.visibility = '';
    if (bubblesEl) bubblesEl.style.visibility = '';
}

function animatePageTransition(fromPage, toPage, lang, motionDir) {
    const stage = document.getElementById('content-stage');
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    if (!stage || !contentEl || !bubblesEl || !fromPage || !toPage) {
        renderDisplayIndexIntoDom(getIndex(), lang);
        return;
    }

    clearTransitionLayers();

    const outgoing = createTransitionLayer(contentEl.innerHTML, bubblesEl.innerHTML);
    const incoming = createTransitionLayer(renderPageContentHTML(toPage, lang), renderPageBubblesHTML(toPage, lang));
    const outgoingMedia = outgoing.querySelector('.viewer-transition-media');
    const outgoingBubbles = outgoing.querySelector('.viewer-transition-bubbles');
    const incomingMedia = incoming.querySelector('.viewer-transition-media');
    const incomingBubbles = incoming.querySelector('.viewer-transition-bubbles');
    const startX = motionDir > 0 ? '100%' : '-100%';
    const endX = motionDir > 0 ? '-100%' : '100%';
    const duration = 260;
    const token = ++pageAnimationToken;

    [incomingMedia, incomingBubbles].forEach((node) => {
        if (node) node.style.transform = `translateX(${startX})`;
    });

    contentEl.style.visibility = 'hidden';
    bubblesEl.style.visibility = 'hidden';
    stage.appendChild(outgoing);
    stage.appendChild(incoming);

    requestAnimationFrame(() => {
        [outgoingMedia, outgoingBubbles].forEach((node) => {
            node?.animate(
                [{ transform: 'translateX(0%)', opacity: 1 }, { transform: `translateX(${endX})`, opacity: 1 }],
                { duration, easing: 'ease-in-out', fill: 'forwards' }
            );
        });
        [incomingMedia, incomingBubbles].forEach((node) => {
            node?.animate(
                [{ transform: `translateX(${startX})`, opacity: 1 }, { transform: 'translateX(0%)', opacity: 1 }],
                { duration, easing: 'ease-in-out', fill: 'forwards' }
            );
        });
    });

    window.setTimeout(() => {
        outgoing.remove();
        incoming.remove();
        if (token !== pageAnimationToken) return;
        renderDisplayIndexIntoDom(getIndex(), lang);
        contentEl.style.visibility = '';
        bubblesEl.style.visibility = '';
    }, duration + 30);
}

function transitionToIndex(nextIndex, kind = 'jump') {
    const pages = getPages();
    const currentIndex = getIndex();
    if (nextIndex < 0 || nextIndex >= pages.length || nextIndex === currentIndex) return;
    const dir = getPageDirection();
    const motionDir = kind === 'next'
        ? (dir === 'rtl' ? -1 : 1)
        : kind === 'prev'
            ? (dir === 'rtl' ? 1 : -1)
            : (nextIndex > currentIndex ? 1 : -1);

    const fromPage = pages[currentIndex];
    const toPage = pages[nextIndex];
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: nextIndex });
    collapseViewerInfoPanelForNavigation();
    resetZoom();
    animatePageTransition(fromPage, toPage, state.activeLang, motionDir);
    refreshChrome();
    if (spreadMode) renderSpreadPage();
    preloadNearbyViewerImages();
    queueBookmarkSave();
    trackPageView(kind === 'jump' ? 'jump' : 'navigation');
}

function transitionToBookUnit(nextIndex) {
    const units = getBookUnits();
    if (!units.length) return;
    if (nextIndex < 0) nextIndex = units.length - 1;
    if (nextIndex >= units.length) nextIndex = 0;
    if (nextIndex === bookSpreadIndex) return;
    bookSpreadIndex = nextIndex;
    const pageIndex = getBookUnitPrimaryPageIndex(units[bookSpreadIndex]);
    if (pageIndex >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });
    }
    collapseViewerInfoPanelForNavigation();
    resetZoom();
    refresh();
    queueBookmarkSave();
    trackPageView('book_navigation');
}

function goNext() {
    if (spreadMode && hasBookModel()) {
        transitionToBookUnit(bookSpreadIndex + 1);
        return;
    }
    const i = getIndex();
    if (i < getTotal() - 1) transitionToIndex(i + 1, 'next');
}

function goPrev() {
    if (spreadMode && hasBookModel()) {
        transitionToBookUnit(bookSpreadIndex - 1);
        return;
    }
    const i = getIndex();
    if (i > 0) transitionToIndex(i - 1, 'prev');
}

function isZoneClickSuppressed() {
    return Date.now() <= suppressZoneClickUntil;
}

// RTL（右→左）: 右タップ = 前ページ、左タップ = 次ページ
window.viewerNavRight = () => {
    if (isZoneClickSuppressed()) return;
    getPageDirection() === 'rtl' ? goPrev() : goNext();
};
window.viewerNavLeft  = () => {
    if (isZoneClickSuppressed()) return;
    getPageDirection() === 'rtl' ? goNext() : goPrev();
};

window.jumpToPage = (val) => {
    const page = parseInt(val, 10);
    if (spreadMode && hasBookModel()) {
        const units = getBookUnits();
        if (page >= 1 && page <= units.length) {
            transitionToBookUnit(page - 1);
        }
        return;
    }
    const total = getTotal();
    if (page >= 1 && page <= total) {
        transitionToIndex(page - 1, page - 1 > getIndex() ? 'next' : 'prev');
    }
};

// ── Render ────────────────────────────────────────────────────
function refresh() {
    const pages = getPages();
    if (pages.length === 0) return;

    if (spreadMode && hasBookModel()) {
        renderCurrentBookUnit();
        refreshChrome();
        preloadNearbyViewerImages();
        return;
    }

    const index = getIndex();
    const page = pages[index];
    const lang = state.activeLang;
    const spreadStage = document.getElementById('viewer-spread-stage');
    const spreadContent = document.getElementById('viewer-spread-content');
    if (spreadContent) spreadContent.innerHTML = '';
    if (spreadStage) spreadStage.style.display = 'none';
    renderDisplayIndexIntoDom(index, lang);
    refreshChrome();
    preloadNearbyViewerImages();
}

function isViewerCoverRole(role) {
    return /^C[1-4]$/i.test(String(role || '').trim());
}

function getViewerSurfaceRoleForSourceIndex(sourcePageIndex) {
    if (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0 || !viewerBookModel) return '';
    const coverSurfaces = viewerBookModel.covers
        ? [viewerBookModel.covers.c1, viewerBookModel.covers.c2, viewerBookModel.covers.c3, viewerBookModel.covers.c4]
        : [];
    const bodySurfaces = Array.isArray(viewerBookModel.bodyPages) ? viewerBookModel.bodyPages : [];
    const matched = [...coverSurfaces, ...bodySurfaces]
        .find((surface) => surface?.sourcePageIndex === sourcePageIndex);
    return String(matched?.bookRole || matched?.role || '').trim().toUpperCase();
}

function getViewerSurfaceForDisplayIndex(displayIndex) {
    const pages = getPages();
    const page = pages[displayIndex];
    if (!page || !viewerBookModel) return page || null;

    const coverSurfaces = viewerBookModel.covers
        ? [viewerBookModel.covers.c1, viewerBookModel.covers.c2, viewerBookModel.covers.c3, viewerBookModel.covers.c4]
        : [];
    const bodySurfaces = Array.isArray(viewerBookModel.bodyPages) ? viewerBookModel.bodyPages : [];
    const mappedBySource = [...coverSurfaces, ...bodySurfaces]
        .find((surface) => surface?.sourcePageIndex === displayIndex);
    if (mappedBySource) return mappedBySource;

    const orderedSurfaces = [
        viewerBookModel.covers?.c1,
        viewerBookModel.covers?.c2,
        ...bodySurfaces,
        viewerBookModel.covers?.c3,
        viewerBookModel.covers?.c4
    ].filter(Boolean);
    if (orderedSurfaces.length === pages.length) {
        return orderedSurfaces[displayIndex] || page;
    }

    return page;
}

function getViewerBodyOrdinalForSourceIndex(sourcePageIndex) {
    if (!Number.isInteger(sourcePageIndex) || sourcePageIndex < 0) return '';
    if (Array.isArray(viewerBookModel?.bodyPages)) {
        const bookBodyIndex = viewerBookModel.bodyPages.findIndex((surface) => surface?.sourcePageIndex === sourcePageIndex);
        if (bookBodyIndex >= 0) return String(bookBodyIndex + 1);
    }
    let ordinal = 0;
    const pages = getPages();
    for (let i = 0; i < pages.length; i++) {
        const role = pages[i]?.bookRole || pages[i]?.role || '';
        if (!isViewerCoverRole(role)) ordinal++;
        if (i === sourcePageIndex) return String(ordinal);
    }
    return '';
}

function formatViewerSurfaceSliderLabel(surface) {
    if (!surface) return '';
    const role = String(
        surface.bookRole ||
        surface.role ||
        getViewerSurfaceRoleForSourceIndex(surface.sourcePageIndex) ||
        ''
    ).trim().toUpperCase();
    if (/^C[1-4]$/.test(role)) return role;
    if (Number.isInteger(surface.sourcePageIndex) && surface.sourcePageIndex >= 0) {
        return getViewerBodyOrdinalForSourceIndex(surface.sourcePageIndex);
    }
    const bodyMatch = role.match(/^P(\d+)$/);
    if (bodyMatch) return bodyMatch[1];
    return role || '';
}

function getViewerSliderLabel(isBook, displayIndex) {
    if (!isBook) return formatViewerSurfaceSliderLabel(getViewerSurfaceForDisplayIndex(displayIndex)) || String(displayIndex + 1);
    const unit = normalizeSpreadUnitForLang(getBookUnits()[displayIndex], state.activeLang);
    if (!unit) return String(displayIndex + 1);
    if (unit.type === 'single') {
        return formatViewerSurfaceSliderLabel(unit.center) || String(displayIndex + 1);
    }
    const left = formatViewerSurfaceSliderLabel(unit.left);
    const right = formatViewerSurfaceSliderLabel(unit.right);
    return [left, right].filter(Boolean).join(' | ') || String(displayIndex + 1);
}

function updateViewerSliderLabel(slider, labelEl, total, displayIndex, isBook) {
    if (!slider || !labelEl) return;
    labelEl.value = getViewerSliderLabel(isBook, displayIndex);
    labelEl.textContent = labelEl.value;
    const percent = total > 1 ? displayIndex / (total - 1) : 0.5;
    const visualPercent = getPageDirection() === 'rtl' ? 1 - percent : percent;
    labelEl.style.left = `${Math.max(0, Math.min(1, visualPercent)) * 100}%`;
    updateViewerSliderProgress(visualPercent);
}

function setViewerSliderTrackToPhysicalPosition(track, physicalRatio) {
    if (!track) return;
    const ratio = Math.max(0, Math.min(1, physicalRatio));
    const dir = getPageDirection();
    if (dir === 'rtl') {
        track.style.left = 'auto';
        track.style.right = '0';
        track.style.width = `${(1 - ratio) * 100}%`;
    } else {
        track.style.left = '0';
        track.style.right = 'auto';
        track.style.width = `${ratio * 100}%`;
    }
}

function updateViewerSliderProgress(visualPercent) {
    setViewerSliderTrackToPhysicalPosition(
        document.getElementById('page-slider-progress-track'),
        visualPercent
    );
}

function updateViewerSliderHoverProgress(visualPercent) {
    setViewerSliderTrackToPhysicalPosition(
        document.getElementById('page-slider-hover-track'),
        visualPercent
    );
}

function clearViewerSliderHoverProgress() {
    const hoverTrack = document.getElementById('page-slider-hover-track');
    if (hoverTrack) {
        hoverTrack.style.left = '0';
        hoverTrack.style.right = 'auto';
        hoverTrack.style.width = '0';
    }
}

function getViewerBodyPageTotal(isBook) {
    if (Array.isArray(viewerBookModel?.bodyPages)) {
        return viewerBookModel.bodyPages.length;
    }
    return getPages().filter((page) => !isViewerCoverRole(page?.bookRole || page?.role || '')).length;
}

function refreshChrome() {
    const pages = getPages();
    if (pages.length === 0) return;
    const index = getIndex();
    const dir = getPageDirection();
    const bookUnits = spreadMode && hasBookModel() ? getBookUnits() : [];
    const isBook = bookUnits.length > 0;
    const total = isBook ? bookUnits.length : pages.length;
    const displayIndex = isBook ? bookSpreadIndex : index;

    // スライダー・ページ番号
    const slider = document.getElementById('page-slider');
    const sliderLabel = document.getElementById('page-slider-label');
    const sliderTotal = document.getElementById('page-slider-total');
    const leftBtn = document.getElementById('viewer-nav-left');
    const rightBtn = document.getElementById('viewer-nav-right');
    const footer = document.getElementById('viewer-footer');
    const zonePrev = document.getElementById('zone-prev');
    const zoneNext = document.getElementById('zone-next');
    if (slider) {
        slider.max = total;
        slider.value = displayIndex + 1;
        slider.style.transform = '';
        slider.style.direction = dir === 'rtl' ? 'rtl' : 'ltr';
    }
    const sliderDisplayLabel = getViewerSliderLabel(isBook, displayIndex);
    updateViewerSliderLabel(slider, sliderLabel, total, displayIndex, isBook);
    const bodyTotal = getViewerBodyPageTotal(isBook);
    if (sliderTotal) sliderTotal.textContent = String(bodyTotal);
    if (leftBtn) {
        leftBtn.textContent = '◀';
        leftBtn.title = dir === 'rtl' ? vt('nextPage') : vt('prevPage');
    }
    if (rightBtn) {
        rightBtn.textContent = '▶';
        rightBtn.title = dir === 'rtl' ? vt('prevPage') : vt('nextPage');
    }
    if (footer) footer.classList.toggle('dir-rtl', dir === 'rtl');
    if (zonePrev) zonePrev.title = dir === 'rtl' ? vt('nextPage') : vt('prevPage');
    if (zoneNext) zoneNext.title = dir === 'rtl' ? vt('prevPage') : vt('nextPage');
    renderViewerLanguagePicker();
    renderViewerAuthSlot(state.user || null);
    renderViewerInfoPanel();
}

// ── UI ───────────────────────────────────────────────────────
let isUiVisible = true;

window.toggleUi = (force) => {
    isUiVisible = typeof force === 'boolean' ? force : !isUiVisible;
    updateUiVisibility();
};

function updateUiVisibility() {
    const ui = document.getElementById('viewer-ui');
    ui?.classList.toggle('visible', isUiVisible);
    document.body.classList.toggle('viewer-ui-visible', isUiVisible);
    syncViewerInfoChromeState();
}

function usesPointerHoverChrome() {
    return window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true;
}

function clearViewerUiAutoHide() {
    if (viewerUiAutoHideTimer) {
        clearTimeout(viewerUiAutoHideTimer);
        viewerUiAutoHideTimer = null;
    }
}

function scheduleViewerUiAutoHide() {
    if (!usesPointerHoverChrome()) return;
    clearViewerUiAutoHide();
    viewerUiAutoHideTimer = setTimeout(() => {
        window.toggleUi(false);
    }, 5000);
}

function revealViewerUiForPointer() {
    if (!usesPointerHoverChrome()) return;
    if (!isUiVisible) {
        window.toggleUi(true);
    } else {
        updateUiVisibility();
    }
    scheduleViewerUiAutoHide();
}

function bindViewerHoverChrome() {
    document.addEventListener('pointermove', (event) => {
        if (!usesPointerHoverChrome()) return;
        const canvas = document.getElementById('viewer-canvas');
        const ui = document.getElementById('viewer-ui');
        const target = event.target;
        const overViewer = !!(canvas?.contains(target) || ui?.contains(target) || target.closest?.('.viewer-side-nav'));
        if (overViewer) {
            revealViewerUiForPointer();
        } else if (isUiVisible) {
            scheduleViewerUiAutoHide();
        }
    });
    document.addEventListener('pointerleave', () => {
        if (!usesPointerHoverChrome()) return;
        scheduleViewerUiAutoHide();
    });
    scheduleViewerUiAutoHide();
}

function getViewerDisplayTotal() {
    return spreadMode && hasBookModel() ? getBookUnits().length : getPages().length;
}

function getViewerDisplayIndex() {
    return spreadMode && hasBookModel() ? bookSpreadIndex : getIndex();
}

function getViewerPreviewSurfaces(isBook, displayIndex) {
    if (isBook) {
        const unit = getBookUnits()[displayIndex];
        const normalized = normalizeSpreadUnitForLang(unit, state.activeLang);
        if (normalized?.type === 'spread') {
            return {
                spread: true,
                left: normalized.left,
                right: normalized.right
            };
        }
        return { spread: false, single: normalized?.center };
    }
    return { spread: false, single: getViewerSurfaceForDisplayIndex(displayIndex) };
}

function getViewerSurfacePreviewUrl(surface) {
    return surface && !surface.virtualBlank ? getPageAssetUrl(surface, state.activeLang) : '';
}

function getViewerPreviewData(displayIndex) {
    const isBook = spreadMode && hasBookModel();
    const total = getViewerDisplayTotal();
    const clamped = Math.max(0, Math.min(total - 1, displayIndex));
    const surfaces = getViewerPreviewSurfaces(isBook, clamped);
    return {
        label: isBook ? getViewerSliderLabel(true, clamped) : getViewerSliderLabel(false, clamped),
        spread: !!surfaces.spread,
        singleUrl: getViewerSurfacePreviewUrl(surfaces.single),
        singleRole: getSurfacePhysicalSpreadRole(surfaces.single, state.activeLang),
        leftUrl: getViewerSurfacePreviewUrl(surfaces.left),
        leftRole: getSurfacePhysicalSpreadRole(surfaces.left, state.activeLang),
        rightUrl: getViewerSurfacePreviewUrl(surfaces.right),
        rightRole: getSurfacePhysicalSpreadRole(surfaces.right, state.activeLang)
    };
}

function getSliderPointerIndex(slider, event) {
    const total = getViewerDisplayTotal();
    if (!slider || total <= 1) return 0;
    if (!Number.isFinite(event?.clientX)) {
        return Math.max(0, Math.min(total - 1, parseInt(slider.value, 10) - 1 || 0));
    }
    const rect = slider.getBoundingClientRect();
    const physicalRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const logicalRatio = getPageDirection() === 'rtl' ? 1 - physicalRatio : physicalRatio;
    return Math.max(0, Math.min(total - 1, Math.round(logicalRatio * (total - 1))));
}

function getSliderPreviewPhysicalRatio(slider, event) {
    const total = getViewerDisplayTotal();
    if (!slider || total <= 1) return 0.5;
    if (Number.isFinite(event?.clientX)) {
        const rect = slider.getBoundingClientRect();
        return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    }
    const logicalRatio = (Math.max(1, Math.min(total, parseInt(slider.value, 10) || 1)) - 1) / Math.max(1, total - 1);
    return getPageDirection() === 'rtl' ? 1 - logicalRatio : logicalRatio;
}

function updateSliderPreview(event) {
    const slider = document.getElementById('page-slider');
    const preview = document.getElementById('page-slider-preview');
    if (!slider || !preview) return;
    const total = getViewerDisplayTotal();
    if (total <= 0) return;
    const physicalRatio = getSliderPreviewPhysicalRatio(slider, event);
    const displayIndex = getSliderPointerIndex(slider, event);
    const data = getViewerPreviewData(displayIndex);
    const single = preview.querySelector('.page-slider-preview-single');
    const left = preview.querySelector('.page-slider-preview-left');
    const right = preview.querySelector('.page-slider-preview-right');
    const label = preview.querySelector('.page-slider-preview-label');
    setSliderPreviewSurface(single, data.singleUrl, data.singleRole);
    setSliderPreviewSurface(left, data.leftUrl, data.leftRole);
    setSliderPreviewSurface(right, data.rightUrl, data.rightRole);
    if (label) label.textContent = data.label;
    preview.dataset.spread = data.spread ? 'true' : 'false';
    preview.style.left = `${physicalRatio * 100}%`;
    updateViewerSliderHoverProgress(physicalRatio);
    preview.hidden = false;
}

function setSliderPreviewSurface(surfaceEl, url, spreadRole = '') {
    if (!surfaceEl) return;
    const image = surfaceEl.querySelector('.page-slider-preview-image');
    if (image && url && image.getAttribute('src') !== url) image.setAttribute('src', url);
    if (image && !url) image.removeAttribute('src');
    surfaceEl.dataset.empty = url ? 'false' : 'true';
    if (spreadRole === 'left' || spreadRole === 'right') {
        surfaceEl.dataset.spreadRole = spreadRole;
    } else {
        delete surfaceEl.dataset.spreadRole;
    }
}

function hideSliderPreview() {
    const preview = document.getElementById('page-slider-preview');
    if (preview) preview.hidden = true;
    clearViewerSliderHoverProgress();
}

function bindViewerSliderPreview() {
    const slider = document.getElementById('page-slider');
    if (!slider) return;
    slider.addEventListener('pointermove', updateSliderPreview);
    slider.addEventListener('pointerenter', updateSliderPreview);
    slider.addEventListener('pointerleave', hideSliderPreview);
    slider.addEventListener('input', (event) => updateSliderPreview(event));
}

document.addEventListener('click', (e) => {
    if (!isUiVisible) {
        if (Date.now() <= suppressZoneClickUntil) return;
        if (e.target.closest?.('#viewer-ui')) return;
        if (e.target.closest?.('#viewer-info-panel')) return;
        if (e.target.closest?.('.viewer-side-nav')) return;
        if (e.target.closest?.('#zone-prev, #zone-menu, #zone-next')) return;
        window.toggleUi(true);
        return;
    }
    const id = e.target.id;
    if (id === 'zone-prev' || id === 'zone-next' || id === 'zone-menu') return;
    const picker = document.getElementById('viewer-lang-picker');
    if (picker && !picker.contains(e.target)) closeViewerLangMenu();
    const authSlot = document.getElementById('viewer-auth-slot');
    if (authSlot && !authSlot.contains(e.target)) closeViewerAuthDropdown();
    const header = document.getElementById('viewer-header');
    const footer = document.getElementById('viewer-footer');
    const infoPanel = document.getElementById('viewer-info-panel');
    if (!(header?.contains(e.target) || footer?.contains(e.target) || infoPanel?.contains(e.target) || e.target.closest?.('.viewer-side-nav'))) {
        window.toggleUi(false);
    }
});

// ── Canvas Resize ─────────────────────────────────────────────
function canUseViewerAutoSpread() {
    return hasBookModel()
        && window.innerWidth >= VIEWER_AUTO_SPREAD_MIN_WIDTH
        && window.innerWidth > window.innerHeight;
}

function syncViewerAutoSpreadMode() {
    if (viewerSpreadManualOverride || !hasBookModel()) return false;
    const shouldSpread = canUseViewerAutoSpread();
    if (spreadMode === shouldSpread) return false;
    spreadMode = shouldSpread;
    const btn = document.getElementById('viewer-spread-btn');
    if (btn) btn.classList.toggle('active', spreadMode);
    if (spreadMode) {
        bookSpreadIndex = findBookUnitIndexForPage(getIndex());
    } else {
        const pageIndex = getBookUnitPrimaryPageIndex(getCurrentBookUnit());
        if (pageIndex >= 0) {
            dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });
        }
    }
    return true;
}

function handleViewerResize() {
    if (syncViewerAutoSpreadMode()) {
        refresh();
    } else {
        resizeCanvas();
    }
}

/**
 * 外枠 `#viewer-canvas` をウィンドウ内に収めた 9:16 の箱にし、内側 `#content-stage` を
 * 論理ページ（CANONICAL_PAGE_*）へ等倍スケールでセンタリングする。
 * 高さは `innerHeight` 基準（`100dvh` は body 側で扱い、将来 visualViewport に差し替え可能）。
 */
function resizeCanvas() {
    updateViewerInfoPanelLayout();
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;
    const drawerOpen = viewerInfoLayoutMode === 'drawer' && viewerInfoPanelState !== 'closed';
    const W = Math.max(280, window.innerWidth - (drawerOpen ? VIEWER_DRAWER_WIDTH + VIEWER_DRAWER_GAP : 0));
    const H = window.innerHeight;
    const aspect = CANONICAL_PAGE_ASPECT;
    const bookSingle = spreadMode && hasBookModel() && getCurrentBookUnit()?.type === 'single';
    const showSpread = spreadMode && !bookSingle;
    let w, h;

    if (showSpread) {
        // 見開き: 横幅 2 ページ分のアスペクト
        const daspect = aspect * 2;
        if (W / H < daspect) { w = W; h = Math.round(W / daspect); }
        else { h = H; w = Math.round(H * daspect); }
    } else {
        if (W / H < aspect) { w = W; h = Math.round(W / aspect); }
        else { h = H; w = Math.round(H * aspect); }
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const rawScale = showSpread
        ? Math.min(w / (CANONICAL_PAGE_WIDTH * 2), h / CANONICAL_PAGE_HEIGHT)
        : Math.min(w / CANONICAL_PAGE_WIDTH, h / CANONICAL_PAGE_HEIGHT);
    const displayPageWidth = Math.max(1, Math.floor(CANONICAL_PAGE_WIDTH * rawScale));
    const displayScale = displayPageWidth / CANONICAL_PAGE_WIDTH;
    const displayPageHeight = CANONICAL_PAGE_HEIGHT * displayScale;
    const spreadLeftX = showSpread ? Math.floor((w - displayPageWidth * 2) / 2) : 0;
    const singleLeftX = Math.floor((w - displayPageWidth) / 2);
    const pageY = Math.floor((h - displayPageHeight) / 2);

    const stage = document.getElementById('content-stage');
    if (stage) {
        const ox = showSpread ? spreadLeftX : singleLeftX;
        stage.style.transform = `translate(${ox}px,${pageY}px) scale(${displayScale})`;
    }

    // 見開きページ（隣）のステージ配置
    const spreadStage = document.getElementById('viewer-spread-stage');
    if (spreadStage) {
        if (showSpread) {
            const ox = spreadLeftX + displayPageWidth;
            spreadStage.style.transform = `translate(${ox}px,${pageY}px) scale(${displayScale})`;
            spreadStage.style.display = 'block';
        } else {
            spreadStage.style.display = 'none';
        }
    }

    updateViewerSliderPlacement(canvas, w);
    updateViewerSideNavPlacement(canvas, w);
    applyTransform();
}

function updateViewerSliderPlacement(canvas, canvasWidth) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sliderWidth = Math.max(220, Math.min(720, window.innerWidth * 0.46));
    document.documentElement.style.setProperty('--viewer-slider-center-x', `${Math.round(rect.left + rect.width / 2)}px`);
    document.documentElement.style.setProperty('--viewer-slider-width', `${Math.round(sliderWidth)}px`);
}

function updateViewerSideNavPlacement(canvas, canvasWidth) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const buttonWidth = 44;
    const edgeGap = 14;
    const marginGap = 18;
    const leftMargin = rect.left;
    const rightMargin = window.innerWidth - rect.right;
    const leftX = leftMargin >= buttonWidth + marginGap * 2
        ? Math.max(edgeGap, rect.left - marginGap - buttonWidth)
        : rect.left + edgeGap;
    const rightX = rightMargin >= buttonWidth + marginGap * 2
        ? Math.min(window.innerWidth - edgeGap - buttonWidth, rect.right + marginGap)
        : rect.left + canvasWidth - edgeGap - buttonWidth;
    document.documentElement.style.setProperty('--viewer-nav-left-x', `${Math.round(leftX)}px`);
    document.documentElement.style.setProperty('--viewer-nav-right-x', `${Math.round(rightX)}px`);
}

// ── Spread View ────────────────────────────────────────────────

function renderCurrentBookUnit() {
    const unit = getCurrentBookUnit();
    const spreadStage = document.getElementById('viewer-spread-stage');
    const spreadContent = document.getElementById('viewer-spread-content');
    if (!unit) return;

    const lang = state.activeLang;
    if (unit.type === 'single') {
        renderPageIntoDom(unit.center, lang);
        if (spreadContent) spreadContent.innerHTML = '';
        if (spreadStage) spreadStage.style.display = 'none';
        resizeCanvas();
        return;
    }

    renderPageIntoDom(unit.left, lang);
    if (spreadContent) spreadContent.innerHTML = renderSurfaceContentHTML(unit.right, lang);
    if (spreadStage) spreadStage.style.display = 'block';
    resizeCanvas();
}

function renderSpreadPage() {
    const spreadStage = document.getElementById('viewer-spread-stage');
    const spreadContent = document.getElementById('viewer-spread-content');
    if (!spreadStage || !spreadContent || !spreadMode) return;

    if (hasBookModel()) {
        renderCurrentBookUnit();
        return;
    }

    const pages = getPages();
    const idx = getIndex();
    const lang = state.activeLang;
    const dir = getPageDirection();

    // RTL（日本語等）: 右が現在、左が次 → spread は左に次ページ
    // LTR（英語等）: 左が現在、右が次 → spread は右に次ページ
    const adjIdx = dir === 'rtl' ? idx - 1 : idx + 1;

    if (adjIdx < 0 || adjIdx >= pages.length) {
        spreadStage.style.display = 'none';
        return;
    }

    spreadStage.style.display = 'block';
    const adjPage = pages[adjIdx];
    spreadContent.innerHTML = renderPageContentHTML(adjPage, lang);
    scheduleViewerDevMorphPipeline();
    if (viewerDevMode) renderViewerDevMetrics();
}

window.toggleViewerSpread = () => {
    viewerSpreadManualOverride = true;
    spreadMode = !spreadMode;
    const btn = document.getElementById('viewer-spread-btn');
    if (btn) btn.classList.toggle('active', spreadMode);
    if (hasBookModel()) {
        if (spreadMode) {
            bookSpreadIndex = findBookUnitIndexForPage(getIndex());
        } else {
            const pageIndex = getBookUnitPrimaryPageIndex(getCurrentBookUnit());
            if (pageIndex >= 0) {
                dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });
            }
        }
    }
    resizeCanvas();
    refresh();
};

// ── Zoom / Pan ────────────────────────────────────────────────
function resetZoom() {
    viewScale = 1; viewX = 0; viewY = 0;
    applyTransform();
}

/**
 * ピンチ／ホイール／ダブルタップで viewScale>1 のとき、パンを論理ページ周りにクランプする。
 * `#viewer-stage` は transform-origin:center で scale するため、許容パンはキャンバス寸法と倍率から概算する。
 * 仕様: ページ全体がキャンバス外へ「永続的に」消えないよう余白方向へのオーバーパンを抑える（一時的な軽いはみ出しは許容しつつ強い飛び出しを防ぐ）。
 */
function clampViewPan() {
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    if (!vw || !vh) return;

    if (viewScale <= 1.001) {
        viewScale = 1;
        viewX = 0;
        viewY = 0;
        return;
    }

    const limX = 0.5 * vw * Math.min(viewScale - 1, 4);
    const limY = 0.5 * vh * Math.min(viewScale - 1, 4);
    viewX = Math.max(-limX, Math.min(limX, viewX));
    viewY = Math.max(-limY, Math.min(limY, viewY));
}

function applyTransform() {
    clampViewPan();
    const stage = document.getElementById('viewer-stage');
    if (stage) stage.style.transform = `translate(${viewX}px,${viewY}px) scale(${viewScale})`;
}

function resetSingleSpreadSwipe() {
    singleSpreadSwipe = {
        active: false,
        dragging: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        basePercent: 0,
        currentPercent: 0,
        pair: null
    };
    document.querySelectorAll('.viewer-single-spread-strip.is-snapping')
        .forEach((node) => node.classList.remove('is-snapping'));
}

function setSingleSpreadStripOffset(percent, animate = false) {
    const clamped = Math.max(-50, Math.min(0, percent));
    document.querySelectorAll('.viewer-single-spread-strip').forEach((node) => {
        node.classList.toggle('is-snapping', Boolean(animate));
        node.style.setProperty('--viewer-single-spread-offset', `${clamped}%`);
    });
}

function beginSingleSpreadSwipe(e) {
    if (spreadMode || viewScale > 1.05 || isViewerBottomSwipeStart(e.clientX, e.clientY)) {
        resetSingleSpreadSwipe();
        return;
    }
    const pair = getSingleModeSpreadPair(getIndex(), state.activeLang);
    if (!pair) {
        resetSingleSpreadSwipe();
        return;
    }
    singleSpreadSwipe = {
        active: true,
        dragging: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        basePercent: pair.currentRole === 'right' ? -50 : 0,
        currentPercent: pair.currentRole === 'right' ? -50 : 0,
        pair
    };
}

function updateSingleSpreadSwipe(e) {
    if (!singleSpreadSwipe.active || singleSpreadSwipe.pointerId !== e.pointerId || isPinching || isPanning) {
        return false;
    }
    const dx = e.clientX - singleSpreadSwipe.startX;
    const dy = e.clientY - singleSpreadSwipe.startY;
    if (!singleSpreadSwipe.dragging) {
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return false;
        singleSpreadSwipe.dragging = true;
        pointerGestureConsumed = true;
        suppressZoneClickUntil = Date.now() + 900;
    }

    const stage = document.getElementById('content-stage');
    const width = stage?.getBoundingClientRect?.().width || 1;
    const deltaPercent = (dx / width) * 50;
    singleSpreadSwipe.currentPercent = Math.max(-50, Math.min(0, singleSpreadSwipe.basePercent + deltaPercent));
    setSingleSpreadStripOffset(singleSpreadSwipe.currentPercent, false);
    e.preventDefault();
    e.stopPropagation();
    return true;
}

function finishSingleSpreadSwipe(e) {
    if (!singleSpreadSwipe.active || singleSpreadSwipe.pointerId !== e.pointerId) return false;
    const dx = e.clientX - singleSpreadSwipe.startX;
    const dy = e.clientY - singleSpreadSwipe.startY;
    if (!singleSpreadSwipe.dragging) {
        if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 40) {
            resetSingleSpreadSwipe();
            return false;
        }
        singleSpreadSwipe.dragging = true;
        const stage = document.getElementById('content-stage');
        const width = stage?.getBoundingClientRect?.().width || 1;
        singleSpreadSwipe.currentPercent = Math.max(-50, Math.min(0, singleSpreadSwipe.basePercent + (dx / width) * 50));
    }

    const pair = singleSpreadSwipe.pair;
    const snapPercent = singleSpreadSwipe.currentPercent <= -25 ? -50 : 0;
    const targetIndex = snapPercent === -50 ? pair.rightIndex : pair.leftIndex;

    setSingleSpreadStripOffset(snapPercent, true);
    pointerGestureConsumed = true;
    suppressZoneClickUntil = Date.now() + 900;
    e.preventDefault();
    e.stopPropagation();

    if (Number.isInteger(targetIndex) && targetIndex !== getIndex()) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: targetIndex });
        refreshChrome();
        queueBookmarkSave();
        trackPageView('spread_pan');
    }
    window.setTimeout(() => resetSingleSpreadSwipe(), 170);
    return true;
}

function getPinchDist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onPointerDown(e) {
    if (!pointerCache.some(p => p.pointerId === e.pointerId)) {
        pointerCache.push(e);
    }
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
    if (pointerCache.length === 2) {
        isPinching = true;
        isPanning = false;
        pinchStartDist = getPinchDist(pointerCache[0], pointerCache[1]);
        pinchStartScale = viewScale;
    } else {
        activeGesturePointerId = e.pointerId;
        pointerGestureConsumed = false;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        if (viewScale > 1.05) {
            isPanning = true;
            resetSingleSpreadSwipe();
        } else {
            beginSingleSpreadSwipe(e);
        }
    }
}

function onPointerMove(e) {
    const idx = pointerCache.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointerCache[idx] = e;

    if (isPinching && pointerCache.length === 2) {
        e.preventDefault();
        const dist = getPinchDist(pointerCache[0], pointerCache[1]);
        if (pinchStartDist > 0) {
            viewScale = Math.min(5, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
            applyTransform();
        }
    } else if (updateSingleSpreadSwipe(e)) {
        return;
    } else if (isPanning) {
        e.preventDefault();
        viewX += e.clientX - lastPanX;
        viewY += e.clientY - lastPanY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        applyTransform();
    }
}

function onPointerUp(e) {
    const idx = pointerCache.findIndex(p => p.pointerId === e.pointerId);
    const knownPointer = idx !== -1 || e.pointerId === activeGesturePointerId;
    if (!knownPointer) return;
    if (idx !== -1) pointerCache.splice(idx, 1);

    if (isPinching && pointerCache.length < 2) {
        isPinching = false;
        if (viewScale < 1.05) resetZoom();
        else applyTransform();
        if (pointerCache.length === 0) activeGesturePointerId = null;
        return;
    }

    if (pointerCache.length === 0) {
        try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
        if (isPanning) {
            isPanning = false;
            applyTransform();
            activeGesturePointerId = null;
            return;
        }

        if (finishSingleSpreadSwipe(e)) {
            activeGesturePointerId = null;
            return;
        }

        if (!pointerGestureConsumed && viewScale <= 1.05) {
            const dx = e.clientX - pointerStartX;
            const dy = e.clientY - pointerStartY;
            const fromBottom = isViewerBottomSwipeStart(pointerStartX, pointerStartY);

            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
                // ダブルタップでズームトグル（モバイルのみ）
                if (e.pointerType !== 'mouse') {
                    const now = Date.now();
                    const gap = now - lastTapTime;
                    lastTapTime = now;
                    if (gap < 300 && gap > 0) {
                        viewScale = viewScale > 1.05 ? 1 : 2;
                        if (viewScale === 1) { viewX = 0; viewY = 0; }
                        applyTransform();
                        e.preventDefault();
                    }
                }
                // シングルタップはゾーンの onclick に委任
            } else if (
                e.pointerType !== 'mouse'
                && fromBottom
                && Math.abs(dy) > Math.abs(dx)
                && dy < -VIEWER_INFO_SWIPE_OPEN_MIN
            ) {
                pointerGestureConsumed = true;
                suppressZoneClickUntil = Date.now() + 900;
                e.preventDefault();
                e.stopPropagation();
                if (dy < -VIEWER_INFO_SWIPE_OPEN_FULL) {
                    window.setViewerInfoPanelState('summary');
                } else {
                    window.setViewerInfoPanelState('peek');
                }
            } else if (e.pointerType !== 'mouse' && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
                // 横スワイプでページ送り
                pointerGestureConsumed = true;
                suppressZoneClickUntil = Date.now() + 900;
                e.preventDefault();
                e.stopPropagation();
                const dir = getPageDirection();
                if (dx > 0) { dir === 'rtl' ? goNext() : goPrev(); }
                else        { dir === 'rtl' ? goPrev() : goNext(); }
            }
        }
        activeGesturePointerId = null;
    }
}

function suppressClickAfterSwipe(e) {
    if (Date.now() > suppressZoneClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

function onPointerCancel(e) {
    const idx = pointerCache.findIndex(p => p.pointerId === e.pointerId);
    if (idx !== -1) pointerCache.splice(idx, 1);
    try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
    if (pointerCache.length === 0) {
        isPinching = false;
        isPanning = false;
        activeGesturePointerId = null;
        pointerGestureConsumed = false;
        resetSingleSpreadSwipe();
    }
}

function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        viewScale = Math.min(5, Math.max(1, viewScale * factor));
        if (viewScale <= 1.01) {
            viewScale = 1;
            viewX = 0;
            viewY = 0;
        }
    } else if (viewScale > 1.05) {
        viewX -= e.deltaX;
        viewY -= e.deltaY;
    } else {
        const isTrackpad = e.deltaMode === 0;
        const mostlyHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.25;
        const enoughSwipe = Math.abs(e.deltaX) > 36;
        const now = Date.now();
        if (isTrackpad && mostlyHorizontal && enoughSwipe && now - lastWheelNavTime > 380) {
            lastWheelNavTime = now;
            if (e.deltaX > 0) window.viewerNavRight();
            else window.viewerNavLeft();
            return;
        }
    }
    applyTransform();
}

function onKeydown(e) {
    if (e.key === 'ArrowRight') window.viewerNavRight();
    else if (e.key === 'ArrowLeft') window.viewerNavLeft();
    else if (e.key === 'Escape') window.toggleUi(false);
}

// ── Utilities ─────────────────────────────────────────────────
function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────
void init().catch((e) => console.warn('[Viewer] init failed:', e));
