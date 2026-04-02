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
import {
    db,
    signInWithGoogle, signOutUser, onAuthChanged, consumeRedirectResult
} from './firebase.js';
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
    updateUiVisibility();
}

// ── Auth ─────────────────────────────────────────────────────
function initAuth() {
    consumeRedirectResult().catch(e => console.warn('[Viewer] redirect result:', e));
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
        alert(`認証エラー: ${e.message}`);
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
    if (!uid) { alert('URLにuidが必要です。'); return false; }
    try {
        const snap = await getDoc(doc(db, 'users', uid, 'projects', pid));
        if (!snap.exists()) { alert('プロジェクトが見つかりません: ' + pid); return false; }
        const data = snap.data();
        data.projectId = pid;
        loadProjectData(data);
        return true;
    } catch (e) {
        lastLoadErrorCode = e?.code || '';
        if (lastLoadErrorCode === 'permission-denied') {
            if (!state.uid) {
                // 未ログイン → 作者本人かもしれないのでログインを促す
                const doLogin = confirm('この作品は非公開です。\n作者の方はログインすると閲覧できます。\nログインしますか？');
                if (doLogin) {
                    try { await signInWithGoogle(); } catch (_) { /* onAuthChanged が retry する */ }
                }
            } else {
                alert('この作品は非公開です。');
            }
        } else {
            alert('読み込みエラー: ' + e.message);
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
        alert('読み込みエラー: ' + e.message);
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

    const sel = document.getElementById('lang-select');
    if (sel) {
        sel.innerHTML = languages.map(code => {
            const p = getLangProps(code);
            return `<option value="${code}">${p.label}</option>`;
        }).join('');
        sel.value = defaultLang;
        sel.style.display = languages.length > 1 ? 'inline-block' : 'none';
    }

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
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = code;
    refresh();
};

function getPageDirection() {
    return state.languageConfigs?.[state.activeLang]?.pageDirection || 'ltr';
}

// ── Navigation ────────────────────────────────────────────────
function getPages() { return Array.isArray(state.pages) ? state.pages : []; }
function getTotal() { return getPages().length; }
function getIndex() { return Math.max(0, Math.min(state.activeIdx || 0, getTotal() - 1)); }

function goNext() {
    const i = getIndex();
    if (i < getTotal() - 1) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: i + 1 });
        refresh();
    }
}

function goPrev() {
    const i = getIndex();
    if (i > 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: i - 1 });
        refresh();
    }
}

// RTL（右→左）: 右タップ = 前ページ、左タップ = 次ページ
window.viewerNavRight = () => getPageDirection() === 'rtl' ? goPrev() : goNext();
window.viewerNavLeft  = () => getPageDirection() === 'rtl' ? goNext() : goPrev();

window.jumpToPage = (val) => {
    let page = parseInt(val, 10);
    const total = getTotal();
    if (getPageDirection() === 'rtl') page = (total + 1) - page;
    if (page >= 1 && page <= total) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: page - 1 });
        refresh();
    }
};

// ── Render ────────────────────────────────────────────────────
function refresh() {
    const pages = getPages();
    if (pages.length === 0) return;

    const index = getIndex();
    const page = pages[index];
    const lang = state.activeLang;
    const dir = getPageDirection();

    resetZoom();

    // 画像表示
    const contentEl = document.getElementById('viewer-content');
    if (contentEl) {
        const bgs = page.content?.backgrounds || {};
        const rawUrl = bgs[lang] || bgs['__all'] || '';
        const url = rawUrl ? getOptimizedImageUrl(rawUrl) : '';
        contentEl.innerHTML = url
            ? `<img src="${esc(url)}" style="width:100%;height:100%;object-fit:contain;" loading="eager">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;">画像未設定</div>`;
    }

    // フキダシ
    const bubblesEl = document.getElementById('viewer-bubbles');
    if (bubblesEl) {
        const bubbles = page.content?.bubbles?.[lang]
            ?? page.content?.bubbles?.['__all']
            ?? [];
        bubblesEl.innerHTML = Array.isArray(bubbles)
            ? bubbles.map((b, i) => renderBubbleHTML(b, i, false)).join('')
            : '';
    }

    // スライダー・ページ番号
    const slider = document.getElementById('page-slider');
    const countEl = document.getElementById('page-count');
    const total = pages.length;
    if (slider) {
        slider.max = total;
        slider.value = dir === 'rtl' ? (total - index) : (index + 1);
        slider.style.transform = dir === 'rtl' ? 'scaleX(-1)' : '';
    }
    if (countEl) countEl.textContent = `${index + 1} / ${total}`;
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
            } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
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
    viewScale = Math.min(5, Math.max(1, viewScale * (e.deltaY > 0 ? 0.9 : 1.1)));
    if (viewScale <= 1) { viewX = 0; viewY = 0; }
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
