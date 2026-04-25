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
import { db, auth as firebaseAuth } from './firebase.js';
import { initGIS, renderGISButton, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
import { getOptimizedImageUrl } from './sections.js';
import { applyTheme, bindThemePreferenceListener, getThemeMode, setThemeMode } from './theme.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

// 見開き表示フラグ
let spreadMode = false;
let requestedBookMode = '';
let viewerBookModel = null;
let bookSpreadIndex = 0;

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
const VIEWER_UI_LANG_KEY = 'dsf_viewer_ui_lang';
const VIEWER_DEV_MODE_KEY = 'dsf_viewer_dev_mode';
const VIEWER_DEV_SMOOTHING_KEY = 'dsf_viewer_dev_smoothing';
const VIEWER_DEV_MORPH_KEY = 'dsf_viewer_dev_morph';
const VIEWER_DEV_HOLD_MS = 1200;
/** インク判定（輝度しきい値・低いほど「濃い部分だけがインク」）。高すぎるとアンチエイリアスまで膨張して潰れる。 */
const VIEWER_DEV_MORPH_LUM_THRESHOLD = 168;
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
    rootTitle: ''
};
const VIEWER_INFO_STATES = ['closed', 'peek', 'summary', 'full'];
let viewerInfoPanelState = 'closed';
let viewerInfoLayoutMode = 'sheet';

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
        infoReviewsPending: 'レビュー表示は今後追加します。',
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
        infoReviewsPending: 'Reviews will be added later.',
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
    window.addEventListener('resize', resizeCanvas);
    setupStandaloneFileDrop();

    await initAuth().catch((e) => console.warn('[Viewer] initAuth failed:', e));
    applyViewerUiLanguage();
    updateViewerInfoPanelLayout();
    renderViewerInfoPanel();
    applyViewerDevSmoothingClass();

    const params = new URLSearchParams(window.location.search);
    const pid = params.get('project') || params.get('id');
    const uid = params.get('author') || params.get('uid');
    const src = params.get('src') || params.get('file') || params.get('url');
    requestedBookMode = String(params.get('bookMode') || params.get('book') || '').toLowerCase();
    if (pid) {
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
                privateLoginRequested = false;
                privateLoginDeclined = false;
                closePrivateLoginModal();
            }
            renderViewerAuthSlot(user || null);
            if (firstState) {
                firstState = false;
                resolve(user || null);
                return;
            }
            if (sharedProjectRef && (!projectLoaded || lastLoadErrorCode === 'permission-denied')) {
                attemptLoad();
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
        const ok = await loadFromFirestore(sharedProjectRef.pid, sharedProjectRef.uid);
        if (ok) { projectLoaded = true; lastLoadErrorCode = ''; }
    } finally {
        isProjectLoading = false;
    }
}

// ── Firestore ─────────────────────────────────────────────────
async function loadFromFirestore(pid, uid) {
    if (!uid) { alert(vt('uidRequired')); return false; }
    try {
        const snap = await getDoc(doc(db, 'users', uid, 'projects', pid));
        if (!snap.exists()) { alert(vt('projectNotFound', { pid })); return false; }
        const data = snap.data();
        data.projectId = pid;
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
    bookSpreadIndex = 0;
    viewerInfoPanelState = 'closed';

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'title', value: raw.title || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: pages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: languages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: defaultLang } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: languageConfigs } });
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: defaultLang });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });

    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = raw.title || '';

    projectLoaded = true;
    lastLoadErrorCode = '';
    hideStandaloneEmpty();
    renderViewerLanguagePicker();
    updateViewerInfoPanelLayout();
    renderViewerInfoPanel();

    refresh();
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
        rootTitle: String(raw?.title || '').trim()
    };
}

function getViewerInfoLayoutMode() {
    return window.innerWidth >= 1024 ? 'drawer' : 'sheet';
}

function updateViewerInfoPanelLayout() {
    viewerInfoLayoutMode = getViewerInfoLayoutMode();
    const panel = document.getElementById('viewer-info-panel');
    if (!panel) return;
    panel.dataset.layout = viewerInfoLayoutMode;
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
    return viewerInfoPanelState === 'full';
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
    panel.dataset.state = viewerInfoPanelState;
    panel.hidden = viewerInfoPanelState === 'closed';
    updateViewerInfoPanelLayout();
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
    const reviewSection = document.getElementById('viewer-info-review-section');
    const reviewEl = document.getElementById('viewer-info-reviews');
    const expandBtn = document.getElementById('viewer-info-expand-btn');
    const peekBtn = document.getElementById('viewer-info-peek-btn');

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

    if (reviewSection) reviewSection.hidden = !shouldShowViewerInfoBody();
    if (reviewEl) reviewEl.textContent = vt('infoReviewsPending');
    if (expandBtn) expandBtn.hidden = viewerInfoPanelState === 'full';
    if (peekBtn) peekBtn.hidden = viewerInfoPanelState === 'peek';
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
    const reviewTitle = document.querySelector('#viewer-info-review-section .viewer-info-section-title');
    if (reviewTitle) reviewTitle.textContent = vt('infoReviews');
}

window.setViewerInfoPanelState = (nextState) => {
    if (!VIEWER_INFO_STATES.includes(nextState)) return;
    viewerInfoPanelState = nextState;
    renderViewerInfoPanel();
};

window.toggleViewerInfoPanel = () => {
    if (viewerInfoPanelState === 'closed' || viewerInfoPanelState === 'peek') {
        window.setViewerInfoPanelState('summary');
        return;
    }
    window.setViewerInfoPanelState('closed');
};

window.stepUpViewerInfoPanel = () => {
    const from = viewerInfoPanelState === 'closed' ? 'peek' : viewerInfoPanelState;
    window.setViewerInfoPanelState(stepViewerInfoState(from, 1));
};

window.stepDownViewerInfoPanel = () => {
    const from = viewerInfoPanelState === 'closed' ? 'peek' : viewerInfoPanelState;
    window.setViewerInfoPanelState(stepViewerInfoState(from, -1));
};

window.advanceViewerInfoPanel = () => {
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
    return dsfPages.map((p, i) => ({
        id: `dsf_${p.pageNum || i + 1}`,
        devMeta: {
            pageType: p.pageType || '',
            bytesByLang: { ...(p.bytesByLang || {}) },
            totalBytes: Number(p.totalBytes) || 0
        },
        content: {
            backgrounds: { ...(p.urls || {}) },
            thumbnail: '',
            bubbles: {}
        }
    }));
}

/**
 * Gen3 ページ正規化。
 * 旧フォーマット（content.background 単一文字列）も受け入れる。
 */
function normalizePagesGen3(rawPages) {
    return rawPages.map((p, i) => {
        const c = p.content || {};
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
            content: { backgrounds, thumbnail: c.thumbnail || '', bubbles }
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
    return units[bookSpreadIndex];
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
    // Never set crossOrigin on the displayed img: without media CORS the image fails to decode (broken image).
    // Morph uses fetch() + createImageBitmap so pixels are readable when R2 CORS allows the viewer origin.
    return `<img class="viewer-page-image" src="${esc(url)}" loading="eager">`;
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
    if (contentEl) contentEl.innerHTML = renderSurfaceContentHTML(page, lang);
    if (bubblesEl) bubblesEl.innerHTML = renderSurfaceBubblesHTML(page, lang);
    scheduleViewerDevMorphPipeline();
    renderViewerDevMetrics();
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
        renderPageIntoDom(toPage, lang);
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
        renderPageIntoDom(toPage, lang);
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
        return;
    }

    const index = getIndex();
    const page = pages[index];
    const lang = state.activeLang;
    renderPageIntoDom(page, lang);
    refreshChrome();
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
    const countEl = document.getElementById('page-count');
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
    if (countEl) countEl.textContent = `${displayIndex + 1} / ${total}`;
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
    document.getElementById('viewer-ui')?.classList.toggle('visible', isUiVisible);
}

document.addEventListener('click', (e) => {
    if (!isUiVisible) {
        if (Date.now() <= suppressZoneClickUntil) return;
        if (e.target.closest?.('#viewer-ui')) return;
        if (e.target.closest?.('#viewer-info-panel')) return;
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
    if (!(header?.contains(e.target) || footer?.contains(e.target) || infoPanel?.contains(e.target))) {
        window.toggleUi(false);
    }
});

// ── Canvas Resize ─────────────────────────────────────────────
/**
 * 外枠 `#viewer-canvas` をウィンドウ内に収めた 9:16 の箱にし、内側 `#content-stage` を
 * 論理ページ（CANONICAL_PAGE_*）へ等倍スケールでセンタリングする。
 * 高さは `innerHeight` 基準（`100dvh` は body 側で扱い、将来 visualViewport に差し替え可能）。
 */
function resizeCanvas() {
    updateViewerInfoPanelLayout();
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;
    const W = window.innerWidth;
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

    const stage = document.getElementById('content-stage');
    if (stage) {
        const pagesWide = showSpread ? 2 : 1;
        const s = Math.min(w / (CANONICAL_PAGE_WIDTH * pagesWide), h / CANONICAL_PAGE_HEIGHT);
        const ox = showSpread ? 0 : (w - CANONICAL_PAGE_WIDTH * s) / 2;
        const oy = (h - CANONICAL_PAGE_HEIGHT * s) / 2;
        stage.style.transform = `translate(${ox}px,${oy}px) scale(${s})`;
    }

    // 見開きページ（隣）のステージ配置
    const spreadStage = document.getElementById('viewer-spread-stage');
    if (spreadStage) {
        if (showSpread) {
            const s = Math.min(w / (CANONICAL_PAGE_WIDTH * 2), h / CANONICAL_PAGE_HEIGHT);
            const oy = (h - CANONICAL_PAGE_HEIGHT * s) / 2;
            const ox = CANONICAL_PAGE_WIDTH * s; // main ステージの右隣
            spreadStage.style.transform = `translate(${ox}px,${oy}px) scale(${s})`;
            spreadStage.style.display = 'block';
        } else {
            spreadStage.style.display = 'none';
        }
    }

    applyTransform();
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

        if (!pointerGestureConsumed && viewScale <= 1.05) {
            const dx = e.clientX - pointerStartX;
            const dy = e.clientY - pointerStartY;

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
