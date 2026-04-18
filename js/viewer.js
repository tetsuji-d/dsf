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
import { db } from './firebase.js';
import { initGIS, signInWithGoogle, signOutUser, onAuthChanged, handleRedirectResult } from './gis-auth.js';
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
let viewerUiLang = localStorage.getItem(VIEWER_UI_LANG_KEY)
    || (navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en');

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
        privatePrompt: 'この作品は非公開です。\n作者の方はログインすると閲覧できます。\nログインしますか？',
        privateProject: 'この作品は非公開です。',
        loadError: '読み込みエラー: {message}',
        standaloneTitle: 'DSFファイルを開く',
        standaloneBody: 'ローカルの .dsf / .dsp / .zip / .json をこのビューワーで表示できます。',
        standaloneOpen: 'ファイルを選択',
        standaloneHint: 'ファイルをここへドラッグして開くこともできます。'
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
        privatePrompt: 'This work is private.\nIf you are the author, sign in to view it.\nSign in now?',
        privateProject: 'This work is private.',
        loadError: 'Load error: {message}',
        standaloneTitle: 'Open a DSF file',
        standaloneBody: 'View a local .dsf, .dsp, .zip, or .json file in this viewer.',
        standaloneOpen: 'Choose file',
        standaloneHint: 'You can also drag a file here.'
    }
};

if (!VIEWER_UI[viewerUiLang]) viewerUiLang = 'ja';

// ── Init ──────────────────────────────────────────────────────
function init() {
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

    initAuth();
    applyViewerUiLanguage();

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
function initAuth() {
    handleRedirectResult();
    initGIS();
    onAuthChanged(user => {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'user', value: user || null } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uid', value: user?.uid || null } });
        renderViewerAuthSlot(user || null);
        if (sharedProjectRef && (!projectLoaded || lastLoadErrorCode === 'permission-denied')) {
            attemptLoad();
        }
    });
}

window.viewerToggleAuth = async () => {
    try {
        if (state.uid) await signOutUser();
        else await signInWithGoogle();
    } catch (e) {
        alert(vt('authError', { message: e.message }));
    }
};

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
        loadProjectData(data);
        return true;
    } catch (e) {
        lastLoadErrorCode = e?.code || '';
        if (lastLoadErrorCode === 'permission-denied') {
            if (!state.uid) {
                // 未ログイン → 作者本人かもしれないのでログインを促す
                const doLogin = confirm(vt('privatePrompt'));
                if (doLogin) {
                    try { await signInWithGoogle(); } catch (_) { /* onAuthChanged が retry する */ }
                }
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
            loadProjectData(await parseAndLoadDSF(file));
        } else {
            loadProjectData(JSON.parse(await file.text()));
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
            loadProjectData(await parseAndLoadDSF(new File([blob], name, { type: blob.type || 'application/zip' })));
        } else {
            loadProjectData(JSON.parse(await blob.text()));
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
function loadProjectData(raw) {
    const pages = raw.dsfPages?.length
        ? normalizeDsfPages(raw.dsfPages)
        : normalizePagesGen3(raw.pages || raw.sections || []);
    const languages = raw.languages?.length ? raw.languages : ['ja'];
    const defaultLang = raw.defaultLang || languages[0];
    const languageConfigs = normalizeLanguageConfigs(raw.languageConfigs, languages);
    viewerBookModel = buildViewerBookModel(raw, pages);
    bookSpreadIndex = 0;

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

    refresh();
}

/**
 * DSF ページ正規化（dsfPages: R2 WebP URLs）
 */
function normalizeDsfPages(dsfPages) {
    return dsfPages.map((p, i) => ({
        id: `dsf_${p.pageNum || i + 1}`,
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

function renderViewerAuthSlot(user = state.user || null) {
    const slot = document.getElementById('viewer-auth-slot');
    if (!slot) return;

    const themeMode = getThemeMode();
    const nameRaw = user?.displayName || user?.email || vt('guest');
    const initial = ((nameRaw || 'U').trim()[0] || 'U').toUpperCase();

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
                <button type="button" class="viewer-auth-action" data-auth-toggle>${esc(user ? vt('signOut') : vt('signIn'))}</button>
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
        await window.viewerToggleAuth();
    });
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
    renderViewerAuthSlot(state.user || null);
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

function renderPageContentHTML(page, lang) {
    const url = getPageAssetUrl(page, lang);
    return url
        ? `<img class="viewer-page-image" src="${esc(url)}" loading="eager">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;">${vt('imageMissing')}</div>`;
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
    if (!(header?.contains(e.target) || footer?.contains(e.target))) {
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
init();
