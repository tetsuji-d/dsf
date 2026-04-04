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
import { initGIS, signInWithGoogle, signOutUser, onAuthChanged } from './gis-auth.js';
import { getOptimizedImageUrl } from './sections.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { parseAndLoadDSF } from './export.js';

// ── Module State ──────────────────────────────────────────────
let sharedProjectRef = null;
let isProjectLoading = false;
let projectLoaded = false;
let lastLoadErrorCode = '';

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
        imageMissing: '画像未設定',
        authError: '認証エラー: {message}',
        uidRequired: 'URLにuidが必要です。',
        projectNotFound: 'プロジェクトが見つかりません: {pid}',
        privatePrompt: 'この作品は非公開です。\n作者の方はログインすると閲覧できます。\nログインしますか？',
        privateProject: 'この作品は非公開です。',
        loadError: '読み込みエラー: {message}'
    },
    en: {
        close: 'Close',
        openFile: 'Open file',
        prevPage: 'Previous page',
        nextPage: 'Next page',
        toggleUi: 'Show/hide menu',
        imageMissing: 'No image',
        authError: 'Authentication error: {message}',
        uidRequired: 'The URL requires a uid parameter.',
        projectNotFound: 'Project not found: {pid}',
        privatePrompt: 'This work is private.\nIf you are the author, sign in to view it.\nSign in now?',
        privateProject: 'This work is private.',
        loadError: 'Load error: {message}'
    }
};

if (!VIEWER_UI[viewerUiLang]) viewerUiLang = 'ja';

// ── Init ──────────────────────────────────────────────────────
function init() {
    const layer = document.getElementById('click-layer');
    if (layer) {
        layer.addEventListener('pointerdown', onPointerDown);
        layer.addEventListener('pointermove', onPointerMove);
        layer.addEventListener('pointerup', onPointerUp);
        layer.addEventListener('pointercancel', onPointerUp);
        layer.addEventListener('pointerleave', onPointerUp);
    }

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', resizeCanvas);

    initAuth();

    const params = new URLSearchParams(window.location.search);
    const pid = params.get('project') || params.get('id');
    const uid = params.get('author') || params.get('uid');
    if (pid) {
        sharedProjectRef = { pid, uid };
        attemptLoad();
    }

    resizeCanvas();
    applyViewerUiLanguage();
    updateUiVisibility();
}

// ── Auth ─────────────────────────────────────────────────────
function initAuth() {
    initGIS();
    onAuthChanged(user => {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'user', value: user || null } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uid', value: user?.uid || null } });
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

// ── File Loading ──────────────────────────────────────────────
window.loadDsf = async (input) => {
    const file = input.files[0];
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
    } finally {
        document.body.style.cursor = '';
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

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'title', value: raw.title || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: pages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: languages } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: defaultLang } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: languageConfigs } });
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: defaultLang });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });

    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = raw.title || '';

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

function renderPageIntoDom(page, lang) {
    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    if (contentEl) contentEl.innerHTML = renderPageContentHTML(page, lang);
    if (bubblesEl) bubblesEl.innerHTML = renderPageBubblesHTML(page, lang);
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
}

function goNext() {
    const i = getIndex();
    if (i < getTotal() - 1) transitionToIndex(i + 1, 'next');
}

function goPrev() {
    const i = getIndex();
    if (i > 0) transitionToIndex(i - 1, 'prev');
}

// RTL（右→左）: 右タップ = 前ページ、左タップ = 次ページ
window.viewerNavRight = () => getPageDirection() === 'rtl' ? goPrev() : goNext();
window.viewerNavLeft  = () => getPageDirection() === 'rtl' ? goNext() : goPrev();

window.jumpToPage = (val) => {
    const page = parseInt(val, 10);
    const total = getTotal();
    if (page >= 1 && page <= total) {
        transitionToIndex(page - 1, page - 1 > getIndex() ? 'next' : 'prev');
    }
};

// ── Render ────────────────────────────────────────────────────
function refresh() {
    const pages = getPages();
    if (pages.length === 0) return;

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
    const total = pages.length;

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
        slider.value = index + 1;
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
    if (countEl) countEl.textContent = `${index + 1} / ${total}`;
    renderViewerLanguagePicker();
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
    if (!isUiVisible) return;
    const id = e.target.id;
    if (id === 'zone-prev' || id === 'zone-next' || id === 'zone-menu') return;
    const picker = document.getElementById('viewer-lang-picker');
    if (picker && !picker.contains(e.target)) closeViewerLangMenu();
    const header = document.getElementById('viewer-header');
    const footer = document.getElementById('viewer-footer');
    if (!(header?.contains(e.target) || footer?.contains(e.target))) {
        window.toggleUi(false);
    }
});

// ── Canvas Resize ─────────────────────────────────────────────
function resizeCanvas() {
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const aspect = 360 / 640;
    let w, h;
    if (W / H < aspect) { w = W; h = Math.round(W / aspect); }
    else { h = H; w = Math.round(H * aspect); }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const stage = document.getElementById('content-stage');
    if (stage) {
        const s = Math.min(w / 360, h / 640);
        const ox = (w - 360 * s) / 2;
        const oy = (h - 640 * s) / 2;
        stage.style.transform = `translate(${ox}px,${oy}px) scale(${s})`;
    }
}

// ── Zoom / Pan ────────────────────────────────────────────────
function resetZoom() {
    viewScale = 1; viewX = 0; viewY = 0;
    applyTransform();
}

function applyTransform() {
    const stage = document.getElementById('viewer-stage');
    if (stage) stage.style.transform = `translate(${viewX}px,${viewY}px) scale(${viewScale})`;
}

function getPinchDist(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function onPointerDown(e) {
    pointerCache.push(e);
    if (pointerCache.length === 2) {
        isPinching = true;
        isPanning = false;
        pinchStartDist = getPinchDist(pointerCache[0], pointerCache[1]);
        pinchStartScale = viewScale;
    } else {
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        if (viewScale > 1.05) {
            isPanning = true;
            e.target.setPointerCapture(e.pointerId);
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
    if (idx !== -1) pointerCache.splice(idx, 1);

    if (isPinching && pointerCache.length < 2) {
        isPinching = false;
        if (viewScale < 1.05) resetZoom();
        return;
    }

    if (pointerCache.length === 0) {
        if (isPanning) { isPanning = false; return; }

        if (viewScale <= 1.05) {
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
                const dir = getPageDirection();
                if (dx > 0) { dir === 'rtl' ? goNext() : goPrev(); }
                else        { dir === 'rtl' ? goPrev() : goNext(); }
            }
        }
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
