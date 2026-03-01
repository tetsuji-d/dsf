/**
 * viewer.js — DSF Viewer Logic
 */
import { state, dispatch, actionTypes } from './state.js';
import { renderBubbleHTML } from './bubbles.js';
import { getLangProps } from './lang.js';
import { db, signInWithGoogle, signOutUser, onAuthChanged, consumeRedirectResult } from './firebase.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { composeText } from './layout.js';
import { normalizeProjectDataV5, buildOutlineFromPages } from './pages.js';
import { getThemePalette, getThemeTemplate } from './theme-presets.js';
import { parseAndLoadDSF } from './export.js';

let currentProject = null;
let sharedProjectRef = null;
let isProjectLoading = false;
let projectLoaded = false;
let lastLoadErrorCode = '';
let requestedViewerLang = '';

function normalizeLangCode(value, fallback = 'ja') {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return fallback;
    return trimmed.split('-')[0] || fallback;
}

// ──────────────────────────────────────
//  Zoom & Pan State
// ──────────────────────────────────────
let viewState = {
    scale: 1,
    panning: false,
    startX: 0,
    startY: 0,
    currX: 0,
    currY: 0,
    lastX: 0,
    lastY: 0
};

function resetZoom() {
    viewState = { scale: 1, panning: false, startX: 0, startY: 0, currX: 0, currY: 0, lastX: 0, lastY: 0 };
    updateTransform();
}

function updateTransform() {
    const stage = document.getElementById('viewer-stage');
    if (stage) {
        stage.style.transform = `translate(${viewState.currX}px, ${viewState.currY}px) scale(${viewState.scale})`;
    }
}

// ──────────────────────────────────────
//  Initialization
// ──────────────────────────────────────
function init() {
    const layer = document.getElementById('click-layer');
    if (layer) {
        layer.addEventListener('click', handleClick);
        // Touchevents are now handled by LongPress wrappers which delegate to _Fixed functions
    }
    document.addEventListener('keydown', handleKeydown);

    initAuthHandlers();

    // Check URL Param
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('project') || params.get('id');
    const uid = params.get('author') || params.get('uid');
    requestedViewerLang = normalizeLangCode(params.get('lang') || '', '');
    if (pid) {
        sharedProjectRef = { pid, uid };
        attemptLoadSharedProject();
    }

    // Resize & Wheel
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('wheel', handleWheel, { passive: false });

    // UI Toggle Listeners
    // UI Toggle Listeners
    // Removed body click handler, replaced with explicit triggers

    // Mobile / Touch / Mouse Unified Pointer Events
    if (layer) {
        layer.addEventListener('pointerdown', handlePointerDown);
        layer.addEventListener('pointermove', handlePointerMove);
        layer.addEventListener('pointerup', handlePointerUp);
        layer.addEventListener('pointercancel', handlePointerUp);
        layer.addEventListener('pointerleave', handlePointerUp);
    }

    updateUiVisibility();
    resizeCanvas();
}

function isPermissionDeniedError(code) {
    return code === 'permission-denied' || code === 'firestore/permission-denied';
}

function updateViewerAuthUI(user) {
    const btn = document.getElementById('viewer-auth-btn');
    const status = document.getElementById('viewer-auth-status');
    const signedIn = !!user;

    if (btn) {
        btn.textContent = signedIn ? 'Sign out' : 'Sign in';
        btn.title = signedIn ? 'ログアウト' : 'Googleでログイン';
    }
    if (status) {
        status.textContent = signedIn
            ? (user.displayName || user.email || 'Signed in')
            : 'ゲスト';
    }
}

function initAuthHandlers() {
    consumeRedirectResult().catch((e) => {
        console.warn('[Viewer] Redirect result failed:', e);
        const code = e?.code || 'no-code';
        alert(`ログイン復帰に失敗しました (${code}): ${e?.message || 'unknown error'}`);
    });

    onAuthChanged((user) => {
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'user', value: user || null } });
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'uid', value: user?.uid || null } });
        updateViewerAuthUI(user);

        const shouldRetryLoad = sharedProjectRef
            && (!projectLoaded || isPermissionDeniedError(lastLoadErrorCode));
        if (shouldRetryLoad) {
            attemptLoadSharedProject();
        }
    });
}

window.viewerToggleAuth = async () => {
    try {
        if (state.uid) {
            await signOutUser();
            return;
        }
        await signInWithGoogle();
    } catch (e) {
        const code = e?.code || 'no-code';
        let msg = e?.message || 'unknown error';
        if (code === 'auth/redirect-state-lost') {
            msg = 'リダイレクト後にログイン状態が復元できませんでした。iPhoneのCookie/トラッキング設定を確認してください。';
        } else if (code === 'auth/persistence-unavailable') {
            msg = 'ブラウザ設定によりログイン状態を保持できません。プライベートブラウズOFF/すべてのCookieをブロックOFFを確認してください。';
        }
        alert(`認証に失敗しました (${code}): ${msg}`);
    }
};

async function attemptLoadSharedProject() {
    if (!sharedProjectRef || isProjectLoading) return;

    isProjectLoading = true;
    try {
        const ok = await loadFromFirestore(sharedProjectRef.pid, sharedProjectRef.uid);
        if (ok) {
            projectLoaded = true;
            lastLoadErrorCode = '';
        }
    } finally {
        isProjectLoading = false;
    }
}

// ──────────────────────────────────────
//  UI Visibility
// ──────────────────────────────────────
// ──────────────────────────────────────
//  UI Visibility
// ──────────────────────────────────────
let isUiVisible = true;

window.toggleUi = function (forceState) {
    if (typeof forceState === 'boolean') {
        isUiVisible = forceState;
    } else {
        isUiVisible = !isUiVisible;
    }
    updateUiVisibility();
};

function updateUiVisibility() {
    const ui = document.getElementById('viewer-ui');
    if (ui) {
        if (isUiVisible) ui.classList.add('visible');
        else ui.classList.remove('visible');
    }
}

// Close UI if clicking outside of header/footer elements
document.addEventListener('click', (e) => {
    // Only process if UI is visible
    if (!isUiVisible) return;

    // Ignore clicks on specific touch zones as they have their own handlers
    if (e.target.id === 'zone-prev' || e.target.id === 'zone-next' || e.target.id === 'zone-menu') {
        return;
    }

    const header = document.getElementById('viewer-header');
    const footer = document.getElementById('viewer-footer');
    const isInsideUi = (header && header.contains(e.target)) || (footer && footer.contains(e.target));

    // If the click is not inside the UI bars, close the UI
    if (!isInsideUi) {
        window.toggleUi(false);
    }
});

// ──────────────────────────────────────
//  Page Navigation (Slider)
// ──────────────────────────────────────
window.jumpToPage = function (val) {
    let page = parseInt(val, 10);
    const total = getViewerPageTotal();
    const dir = typeof getNextPageDirection === 'function' ? getNextPageDirection() : 'right';

    // If RTL mode is active, the slider is visually flipped via CSS `scaleX(-1)`.
    // The visual "left" edge actually maps to the native slider's `max` value, 
    // and the visual "right" edge maps to the native slider's `min` value.
    if (dir === 'left') {
        page = (total + 1) - page;
    }

    if (page >= 1 && page <= total) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: page - 1 });
        refresh();
    }
};

function getViewerPages() {
    return Array.isArray(state.pages) ? state.pages : [];
}

function getViewerPageTotal() {
    const pages = getViewerPages();
    return pages.length;
}

async function loadFromFirestore(pid, uid) {
    try {
        if (!uid) {
            alert('URLにuidが必要です。');
            return false;
        }
        const docRef = doc(db, "users", uid, "projects", pid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
            const data = snap.data();
            data.projectId = pid; // Ensure ID is set
            loadProjectData(data);
            return true;
        } else {
            alert('プロジェクトが見つかりませんでした: ' + pid);
            return false;
        }
    } catch (e) {
        console.error(e);
        lastLoadErrorCode = e?.code || '';
        if (isPermissionDeniedError(lastLoadErrorCode)) {
            alert('読み込みエラー: この作品は「非公開」に設定されているか、閲覧権限がありません。');
            isUiVisible = true;
            updateUiVisibility();
            return false;
        }
        alert('読み込みエラー: ' + e.message);
        return false;
    }
}

// ──────────────────────────────────────
//  File Loading
// ──────────────────────────────────────
window.loadDsf = async (input) => {
    const file = input.files[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.dsf') || file.name.toLowerCase().endsWith('.dsp') || file.name.toLowerCase().endsWith('.zip')) {
        const originalCursor = document.body.style.cursor;
        document.body.style.cursor = 'wait';
        try {
            const data = await parseAndLoadDSF(file);
            loadProjectData(data);
        } catch (err) {
            console.error(err);
            alert('DSFファイルの読み込みに失敗しました: ' + err.message);
        } finally {
            document.body.style.cursor = originalCursor;
            input.value = ''; // Reset
        }
    } else {
        // Fallback for old .json files
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                loadProjectData(data);
            } catch (err) {
                alert('JSONの読み込みに失敗しました: ' + err.message);
            }
        };
        reader.readAsText(file);
        input.value = ''; // Reset
    }
};

function loadProjectData(data) {
    const normalized = normalizeProjectDataV5(data || {});
    if (!normalized.languageConfigs) {
        normalized.languageConfigs = {};
        (normalized.languages || ['ja']).forEach(lang => {
            normalized.languageConfigs[lang] = {
                writingMode: (lang === 'ja') ? 'vertical-rl' : 'horizontal-tb',
                fontPreset: 'gothic'
            };
        });
    }
    (normalized.languages || ['ja']).forEach((lang) => {
        if (!normalized.languageConfigs[lang]) normalized.languageConfigs[lang] = {};
        if (!normalized.languageConfigs[lang].writingMode) {
            normalized.languageConfigs[lang].writingMode = (lang === 'ja') ? 'vertical-rl' : 'horizontal-tb';
        }
        if (!normalized.languageConfigs[lang].fontPreset) {
            normalized.languageConfigs[lang].fontPreset = 'gothic';
        }
    });

    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: normalized.projectId } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'title', value: normalized.title || '' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: normalized.pages || [] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: normalized.blocks || [] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: normalized.sections || [] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: normalized.languages || ['ja'] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: normalized.defaultLang || normalized.languages[0] || 'ja' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: normalized.languageConfigs } });
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: state.defaultLang || state.languages[0] });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: 0 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: 0 });

    currentProject = data;

    // Set Title
    const titleEl = document.getElementById('ui-title');
    if (titleEl) titleEl.textContent = state.title || state.projectId || 'Untitled';

    // Populate Lang Select
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.innerHTML = state.languages.map(code => {
            const props = getLangProps(code);
            return `<option value="${code}">${props.label}</option>`;
        }).join('');
        const nextLang = (requestedViewerLang && state.languages.includes(requestedViewerLang))
            ? requestedViewerLang
            : state.activeLang;
        if (nextLang && nextLang !== state.activeLang) {
            dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: nextLang });
        }
        langSelect.value = state.activeLang;
        langSelect.style.display = state.languages.length > 1 ? 'inline-block' : 'none';
    }

    refresh();
}

window.switchViewerLang = (code) => {
    dispatch({ type: actionTypes.SET_ACTIVE_LANG, payload: code });
    refresh();
};

// ──────────────────────────────────────
//  Rendering
// ──────────────────────────────────────
function getWritingMode(lang) {
    if (state.languageConfigs && state.languageConfigs[lang]) {
        return state.languageConfigs[lang].writingMode;
    }
    const props = getLangProps(lang);
    return props.defaultWritingMode || 'horizontal-tb';
}

function getComposedLayoutForViewerSection(section, lang) {
    // This function is kept temporarily to avoid breaking changes if there are lingering references,
    // although `refresh()` will no longer pass legacy sections to it.
    if (!section.layout || typeof section.layout !== 'object') section.layout = {};
    const cached = section.layout[lang];
    if (cached) return cached;

    const mode = getWritingMode(lang);
    const fontPreset = state.languageConfigs?.[lang]?.fontPreset || 'gothic';
    if (!section.layout[lang]) {
        const raw = (section.texts && section.texts[lang] !== undefined) ? section.texts[lang] : (section.text || '');
        section.layout[lang] = composeText(raw, lang, mode, fontPreset);
    }
    return section.layout[lang];
}

function getComposedLayoutForViewerPage(page, lang) {
    if (!page.content || typeof page.content !== 'object') page.content = {};
    if (!page.content.layout || typeof page.content.layout !== 'object') page.content.layout = {};
    const cached = page.content.layout[lang];
    if (cached) return cached;

    const mode = getWritingMode(lang);
    const fontPreset = state.languageConfigs?.[lang]?.fontPreset || 'gothic';
    const raw = page.content?.texts?.[lang] !== undefined ? page.content.texts[lang] : (page.content?.text || '');
    page.content.layout[lang] = composeText(raw, lang, mode, fontPreset);
    return page.content.layout[lang];
}

function getVerticalTextPadding(layout) {
    if (!layout || layout.writingMode !== 'vertical-rl') return 0;
    const frameH = Number(layout?.frame?.h) || 0;
    const fontSize = Number(layout?.font?.size) || 16;
    const letterSpacing = Number(layout?.font?.letterSpacing) || 0;
    const lines = Array.isArray(layout?.lines) ? layout.lines : [];
    let maxChars = 0;
    for (const line of lines) {
        const count = Array.from(String(line || '')).length;
        if (count > maxChars) maxChars = count;
    }
    if (maxChars <= 0 || frameH <= 0) return 0;
    const usedH = maxChars * Math.max(1, fontSize + letterSpacing);
    const pad = Math.floor((frameH - usedH) / 2);
    return Math.max(0, Math.min(40, pad));
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getPageMetaText(page, lang) {
    const type = page?.pageType;
    if (type === 'cover_front') return page?.meta?.title?.[lang] || '';
    if (type === 'cover_back') return page?.meta?.colophon?.[lang] || '';
    if (type === 'chapter' || type === 'section' || type === 'item' || type === 'toc') {
        return page?.meta?.title?.[lang] || '';
    }
    return '';
}

function renderStructurePage(contentEl, page, lang) {
    const labels = {
        cover_front: '表紙',
        cover_back: '裏表紙',
        chapter: '章',
        section: '節',
        item: '項',
        toc: '目次'
    };
    const label = labels[page?.pageType] || 'ページ';
    const text = escapeHtml(getPageMetaText(page, lang) || `${label}ページ`);
    contentEl.innerHTML = `<div class="viewer-text-page">
        <div class="viewer-text-block"
             style="left:20px; top:32px; width:320px; height:576px; display:flex; align-items:center; justify-content:center; border:2px dashed #cfd7e3; background:#f8fafc; color:#2f3e52; text-align:center; padding:20px;">
            <div>
                <div style="font-size:12px; margin-bottom:8px;">${escapeHtml(label)}</div>
                <div style="font-size:18px; font-weight:700; line-height:1.5;">${text}</div>
            </div>
        </div>
    </div>`;
}

function renderCoverThemePage(contentEl, page, lang) {
    const theme = page?.content?.theme || {};
    const palette = getThemePalette(theme.paletteId);
    const template = getThemeTemplate(theme.templateId);
    const title = page?.meta?.title?.[lang] || 'Title';
    const subtitle = page?.meta?.subtitle?.[lang] || '';
    const author = page?.meta?.author?.[lang] || '';
    const supervisor = page?.meta?.supervisor?.[lang] || '';
    const publisher = page?.meta?.publisher?.[lang] || '';
    const edition = page?.meta?.edition?.[lang] || '';
    const contacts = Array.isArray(page?.meta?.contacts) ? page.meta.contacts : [];
    const contactText = contacts.map((c) => c?.value || '').filter(Boolean).join(' / ');
    const templateId = template.id || 'classic';

    if (page?.role === 'cover_back') {
        if (templateId === 'minimal') {
            contentEl.innerHTML = `<div class="viewer-text-page">
                <div class="viewer-text-block"
                     style="left:20px; top:32px; width:320px; height:576px; background:${palette.bg}; color:${palette.fg}; border-left:10px solid ${palette.accent}; padding:28px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                    <div style="font-size:15px; line-height:1.8; margin-top:8px;">${escapeHtml(edition || '')}</div>
                    <div style="font-size:12px; line-height:1.7; margin-top:14px; color:${palette.sub};">${escapeHtml(contactText || '連絡先未入力')}</div>
                </div>
            </div>`;
            return;
        }
        if (templateId === 'bold') {
            contentEl.innerHTML = `<div class="viewer-text-page">
                <div class="viewer-text-block"
                     style="left:20px; top:32px; width:320px; height:576px; border-radius:10px; background:${palette.accent}; color:#fff; padding:18px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                    <div style="height:100%; border:2px solid rgba(255,255,255,.8); border-radius:8px; padding:18px; background:linear-gradient(160deg, ${palette.accent}, ${palette.fg});">
                        <div style="font-size:16px; line-height:1.7; margin-top:12px;">${escapeHtml(edition || '')}</div>
                        <div style="font-size:12px; line-height:1.8; margin-top:14px; opacity:.9;">${escapeHtml(contactText || '連絡先未入力')}</div>
                    </div>
                </div>
            </div>`;
            return;
        }
        if (templateId === 'novel') {
            contentEl.innerHTML = `<div class="viewer-text-page">
                <div class="viewer-text-block"
                     style="left:20px; top:32px; width:320px; height:576px; border-radius:6px; background:${palette.bg}; color:${palette.fg}; border:1px solid ${palette.sub}; padding:26px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                    <div style="border-top:1px solid ${palette.sub}; margin:12px 0 16px;"></div>
                    <div style="font-size:14px; line-height:1.9; font-family:'Noto Serif JP',serif;">${escapeHtml(edition || '')}</div>
                    <div style="font-size:12px; line-height:1.9; margin-top:12px; color:${palette.sub};">${escapeHtml(contactText || '連絡先未入力')}</div>
                </div>
            </div>`;
            return;
        }
        contentEl.innerHTML = `<div class="viewer-text-page">
            <div class="viewer-text-block"
                 style="left:20px; top:32px; width:320px; height:576px; border-radius:8px; border:2px solid ${palette.accent}; background:${palette.bg}; color:${palette.fg}; padding:22px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                <div style="font-size:15px; line-height:1.7; margin-top:8px;">${escapeHtml(edition || '')}</div>
                <div style="font-size:13px; line-height:1.6; margin-top:12px; color:${palette.sub};">${escapeHtml(contactText || '連絡先未入力')}</div>
            </div>
        </div>`;
        return;
    }

    if (templateId === 'minimal') {
        contentEl.innerHTML = `<div class="viewer-text-page">
            <div class="viewer-text-block"
                 style="left:20px; top:32px; width:320px; height:576px; background:${palette.bg}; color:${palette.fg}; border-left:10px solid ${palette.accent}; padding:28px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                <div style="font-size:34px; font-weight:900; line-height:1.2; margin:26px 0 12px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${escapeHtml(title || 'タイトル未入力')}</div>
                <div style="font-size:16px; color:${palette.sub}; margin-bottom:16px;">${escapeHtml(subtitle || '')}</div>
                <div style="position:absolute; left:28px; right:28px; bottom:24px; font-size:13px; color:${palette.sub}; line-height:1.6;">
                    <div>${escapeHtml(author || '')}</div><div>${escapeHtml(supervisor || '')}</div><div>${escapeHtml(publisher || '')}</div>
                </div>
            </div>
        </div>`;
        return;
    }
    if (templateId === 'bold') {
        contentEl.innerHTML = `<div class="viewer-text-page">
            <div class="viewer-text-block"
                 style="left:20px; top:32px; width:320px; height:576px; border-radius:10px; background:${palette.accent}; color:#fff; padding:18px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                <div style="height:100%; border:2px solid rgba(255,255,255,.8); border-radius:8px; padding:18px; background:linear-gradient(160deg, ${palette.accent}, ${palette.fg});">
                    <div style="font-size:36px; font-weight:900; line-height:1.15; margin:28px 0 10px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${escapeHtml(title || 'タイトル未入力')}</div>
                    <div style="font-size:17px; opacity:.9; margin-bottom:18px;">${escapeHtml(subtitle || '')}</div>
                    <div style="position:absolute; left:36px; right:36px; bottom:30px; font-size:13px; line-height:1.6; opacity:.9;">
                        <div>${escapeHtml(author || '')}</div><div>${escapeHtml(supervisor || '')}</div><div>${escapeHtml(publisher || '')}</div>
                    </div>
                </div>
            </div>
        </div>`;
        return;
    }
    if (templateId === 'novel') {
        contentEl.innerHTML = `<div class="viewer-text-page">
            <div class="viewer-text-block"
                 style="left:20px; top:32px; width:320px; height:576px; border-radius:6px; background:${palette.bg}; color:${palette.fg}; border:1px solid ${palette.sub}; padding:26px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
                <div style="font-size:34px; font-family:'Noto Serif JP',serif; line-height:1.3; margin:24px 0 12px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${escapeHtml(title || 'タイトル未入力')}</div>
                <div style="font-size:15px; color:${palette.sub}; margin-bottom:20px; font-family:'Noto Serif JP',serif;">${escapeHtml(subtitle || '')}</div>
                <div style="border-top:1px solid ${palette.sub}; margin-bottom:14px;"></div>
                <div style="position:absolute; left:26px; right:26px; bottom:24px; font-size:13px; color:${palette.sub}; line-height:1.8; font-family:'Noto Serif JP',serif;">
                    <div>${escapeHtml(author || '')}</div><div>${escapeHtml(supervisor || '')}</div><div>${escapeHtml(publisher || '')}</div>
                </div>
            </div>
        </div>`;
        return;
    }

    contentEl.innerHTML = `<div class="viewer-text-page">
        <div class="viewer-text-block"
             style="left:20px; top:32px; width:320px; height:576px; border-radius:8px; border:2px solid ${palette.accent}; background:${palette.bg}; color:${palette.fg}; padding:24px; box-sizing:border-box; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
            <div style="font-size:30px; font-weight:800; line-height:1.25; margin-bottom:10px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${escapeHtml(title || 'タイトル未入力')}</div>
            <div style="font-size:16px; color:${palette.sub}; margin-bottom:20px;">${escapeHtml(subtitle || '')}</div>
            <div style="position:absolute; left:24px; right:24px; bottom:24px;">
                <div style="font-size:14px; margin-bottom:6px;">${escapeHtml(author || '')}</div>
                <div style="font-size:13px; color:${palette.sub}; margin-bottom:6px;">${escapeHtml(supervisor || '')}</div>
                <div style="font-size:13px; color:${palette.sub};">${escapeHtml(publisher || '')}</div>
            </div>
        </div>
    </div>`;
}

function getOptimizedImageUrl(originalUrl) {
    if (!originalUrl || typeof originalUrl !== 'string') return '';

    // --- Cloudflare Integration ---
    // Feature flag for CDN Delivery (can be toggled via config in the future)
    // ⚠️ NOTE: Cloudflare Image Resizingがdsf.inkで有効化されるまでは false にしておく
    const ENABLE_CLOUDFLARE_IMAGE_DELIVERY = false;
    const CF_DOMAIN = 'https://dsf.ink';

    if (ENABLE_CLOUDFLARE_IMAGE_DELIVERY && originalUrl.includes('firebasestorage.googleapis.com')) {
        // Calculate optimized width based on device screen and pixel ratio
        const screenWidth = window.innerWidth || window.screen?.width || 800;
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = screenWidth * dpr;

        // Snap to standard breakpoints for better CDN cache hit ratios
        let targetWidth = 400;
        if (logicalWidth > 1600) targetWidth = 2000;
        else if (logicalWidth > 1200) targetWidth = 1600;
        else if (logicalWidth > 800) targetWidth = 1200;
        else if (logicalWidth > 400) targetWidth = 800;

        // Note: For this to work, Cloudflare Image Resizing must be enabled on dsf.ink
        // and configured to allow fetching from Firebase Storage origins.
        return `${CF_DOMAIN}/cdn-cgi/image/width=${targetWidth},format=auto,quality=80/${originalUrl}`;
    }

    return originalUrl;
}

function renderCoverImagePage(contentEl, page) {
    const bg = page?.content?.background || '';
    if (!bg) {
        renderStructurePage(contentEl, page, state.activeLang);
        return;
    }
    contentEl.innerHTML = `<img src="${escapeHtml(getOptimizedImageUrl(bg))}" style="width:100%; height:100%; object-fit:cover;">`;
}

function renderStructureImagePage(contentEl, page, lang) {
    const bg = page?.content?.background || '';
    if (!bg) {
        renderStructurePage(contentEl, page, lang);
        return;
    }
    const title = escapeHtml(page?.meta?.title?.[lang] || '');
    const badge = page?.role === 'chapter' ? '章' : (page?.role === 'section' ? '節' : '項');
    contentEl.innerHTML = `<div style="position:relative; width:100%; height:100%;">
        <img src="${escapeHtml(getOptimizedImageUrl(bg))}" style="width:100%; height:100%; object-fit:cover;">
        <div style="position:absolute; left:20px; right:20px; bottom:20px; background:rgba(0,0,0,.45); color:#fff; border-radius:8px; padding:10px 12px;">
            <div style="font-size:11px; opacity:.85;">${badge}</div>
            <div style="font-size:20px; font-weight:700; line-height:1.35; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">${title || ''}</div>
        </div>
    </div>`;
}

function renderStructureTextPage(contentEl, page, lang) {
    const title = escapeHtml(page?.meta?.title?.[lang] || '');
    const richDoc = page?.content?.richTextLangs?.[lang] || page?.content?.richText || null;
    const renderRichInline = (child) => {
        let out = escapeHtml(child?.text || '').replace(/\n/g, '<br>');
        if (child?.strike) out = `<s>${out}</s>`;
        if (child?.underline) out = `<u>${out}</u>`;
        if (child?.italic) out = `<i>${out}</i>`;
        if (child?.bold) out = `<b>${out}</b>`;
        return out;
    };
    const bodyHtml = Array.isArray(richDoc?.blocks) && richDoc.blocks.length
        ? richDoc.blocks.map((b) => {
            const tag = b?.type === 'h1' ? 'h1' : (b?.type === 'h2' ? 'h2' : 'p');
            const children = Array.isArray(b?.children) && b.children.length ? b.children : [{ text: '' }];
            return `<${tag}>${children.map(renderRichInline).join('') || '<br>'}</${tag}>`;
        }).join('')
        : `<p>${escapeHtml(page?.content?.texts?.[lang] ?? page?.content?.text ?? '')}</p>`;
    const badge = page?.role === 'chapter' ? '章' : (page?.role === 'section' ? '節' : '項');
    contentEl.innerHTML = `<div class="viewer-text-page">
        <div class="viewer-text-block"
             style="left:20px; top:32px; width:320px; height:576px; box-sizing:border-box; border:2px solid #d8e0ec; border-radius:8px; background:#f9fbff; color:#22314a; padding:20px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;">
            <div style="font-size:11px; color:#6a7b96; margin-bottom:8px;">${badge}</div>
            <div style="font-size:26px; font-weight:800; line-height:1.3; margin-bottom:16px;">${title || ''}</div>
            <div style="font-size:15px; line-height:1.7; color:#334b6d;">${bodyHtml || ''}</div>
        </div>
    </div>`;
}

function renderRichDocHtml(doc) {
    const renderInline = (child) => {
        let out = escapeHtml(child?.text || '').replace(/\n/g, '<br>');
        if (child?.strike) out = `<s>${out}</s>`;
        if (child?.underline) out = `<u>${out}</u>`;
        if (child?.italic) out = `<i>${out}</i>`;
        if (child?.bold) out = `<b>${out}</b>`;
        return out;
    };
    return (doc?.blocks || []).map((b) => {
        const tag = b?.type === 'h1' ? 'h1' : (b?.type === 'h2' ? 'h2' : 'p');
        const children = Array.isArray(b?.children) && b.children.length ? b.children : [{ text: '' }];
        return `<${tag}>${children.map(renderInline).join('') || '<br>'}</${tag}>`;
    }).join('');
}

function renderTocPage(contentEl, pages, lang, pageIndex = 0) {
    const outline = buildOutlineFromPages(pages, lang, 'item');
    const tocPageIndices = [];
    for (let i = 0; i < pages.length; i += 1) {
        if (pages[i]?.role === 'toc') tocPageIndices.push(i);
    }
    const tocPos = Math.max(0, tocPageIndices.indexOf(pageIndex));
    const rowsPerPage = 18;
    const start = tocPos * rowsPerPage;
    const end = start + rowsPerPage;
    const rows = outline.slice(start, end).map((it) => {
        const indent = it.depth === 1 ? 0 : (it.depth === 2 ? 16 : 32);
        return `<div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px; margin-left:${indent}px;">
            <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(it.title)}</span>
            <span style="opacity:.7;">${it.pageNumber}</span>
        </div>`;
    }).join('');
    contentEl.innerHTML = `<div class="viewer-text-page">
        <div class="viewer-text-block"
             style="left:20px; top:32px; width:320px; height:576px; box-sizing:border-box; border:2px solid #d8e0ec; border-radius:8px; background:#fff; color:#22314a; padding:16px; white-space:normal; overflow:hidden;">
            <div style="font-size:20px; font-weight:800; margin-bottom:12px;">${lang === 'ja' ? '目次' : 'Contents'}</div>
            <div style="font-size:13px; line-height:1.5;">${rows || '<div style="opacity:.6;">No headings</div>'}</div>
        </div>
    </div>`;
}

function refresh() {
    const pages = getViewerPages();
    const hasPages = pages.length > 0;
    const totalPages = getViewerPageTotal();
    if (totalPages <= 0) return;

    const pageIndexRaw = Number.isInteger(state.activePageIdx) ? state.activePageIdx : state.activeIdx;
    const pageIndex = Math.max(0, Math.min(pageIndexRaw || 0, totalPages - 1));
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIndex });

    const p = pages[pageIndex];
    if (!p) return;

    const contentEl = document.getElementById('viewer-content');
    const bubblesEl = document.getElementById('viewer-bubbles');
    const lang = state.activeLang;
    const mode = getWritingMode(lang);

    // Reset Zoom on page change
    resetZoom();

    // 1. Content
    if (p.role === 'cover_front' && p.bodyKind === 'theme') {
        renderCoverThemePage(contentEl, p, lang);
    } else if (p.role === 'cover_back' && p.bodyKind === 'theme') {
        renderCoverThemePage(contentEl, p, lang);
    } else if (p.role === 'cover_front' && p.bodyKind === 'image') {
        renderCoverImagePage(contentEl, p);
    } else if (p.role === 'cover_back' && p.bodyKind === 'image') {
        renderCoverImagePage(contentEl, p);
    } else if (p.role === 'toc') {
        renderTocPage(contentEl, pages, lang, pageIndex);
    } else if ((p.role === 'chapter' || p.role === 'section' || p.role === 'item') && p.bodyKind === 'image') {
        renderStructureImagePage(contentEl, p, lang);
    } else if ((p.role === 'chapter' || p.role === 'section' || p.role === 'item') && p.bodyKind === 'text') {
        renderStructureTextPage(contentEl, p, lang);
    } else if (p.pageType !== 'normal_image' && p.pageType !== 'normal_text') {
        renderStructurePage(contentEl, p, lang);
    } else if (p.pageType === 'normal_image') {
        const toNum = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        const pos = p.content?.imagePosition || {};
        const x = toNum(pos.x, 0);
        const y = toNum(pos.y, 0);
        const scale = Math.max(0.1, toNum(pos.scale, 1));
        const rotation = toNum(pos.rotation, 0);
        const imgStyle = `width:100%; height:100%; object-fit:cover; transform: translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg); transform-origin: center center;`;
        contentEl.innerHTML = `<img src="${escapeHtml(getOptimizedImageUrl(p.content?.background || ''))}" style="${imgStyle}">`;
    } else if (p.pageType === 'normal_text') {
        const richDoc = p.content?.richTextLangs?.[lang] || p.content?.richText || null;
        if (Array.isArray(richDoc?.blocks) && richDoc.blocks.length) {
            const vtClass = mode === 'vertical-rl' ? 'v-text' : '';
            const langProps = getLangProps(lang);
            const align = langProps.sectionAlign;
            const layout = getComposedLayoutForViewerPage(p, lang);
            const frame = layout?.frame || { x: 20, y: 32, w: 320, h: 576 };
            const font = layout?.font || {};
            const fontFamily = font.family || '"Noto Sans","Segoe UI",sans-serif';
            const fontSize = Number(font.size) || 16;
            const lineHeight = Number(font.lineHeight) || 1.8;
            const letterSpacing = Number.isFinite(Number(font.letterSpacing)) ? Number(font.letterSpacing) : 0;
            const verticalPad = getVerticalTextPadding(layout);
            const richHtml = renderRichDocHtml(richDoc);
            contentEl.innerHTML = `<div class="viewer-text-page">
                <div class="viewer-text-block ${vtClass}"
                    style="left:${frame.x}px; top:${frame.y}px; width:${frame.w}px; height:${frame.h}px; box-sizing:border-box; overflow:hidden; white-space:normal; overflow-wrap:anywhere; word-break:break-word; padding:${verticalPad}px 0; text-align:${align}; font-family:${fontFamily}; font-size:${fontSize}px; line-height:${lineHeight}; letter-spacing:${letterSpacing}px;">
                    ${richHtml}
                </div>
            </div>`;
            bubblesEl.innerHTML = '';
        }
        const vtClass = mode === 'vertical-rl' ? 'v-text' : '';
        const langProps = getLangProps(lang);
        const align = langProps.sectionAlign;
        const layout = getComposedLayoutForViewerPage(p, lang);
        const text = escapeHtml((layout?.lines || []).join('\n'));
        const frame = layout?.frame || { x: 20, y: 32, w: 320, h: 576 };
        const font = layout?.font || {};
        const fontFamily = font.family || '"Noto Sans","Segoe UI",sans-serif';
        const fontSize = Number(font.size) || 16;
        const lineHeight = Number(font.lineHeight) || 1.8;
        const letterSpacing = Number.isFinite(Number(font.letterSpacing)) ? Number(font.letterSpacing) : 0;
        const verticalPad = getVerticalTextPadding(layout);

        contentEl.innerHTML = `<div class="viewer-text-page">
            <div class="viewer-text-block ${vtClass}"
                 style="left:${frame.x}px; top:${frame.y}px; width:${frame.w}px; height:${frame.h}px; padding:${verticalPad}px 0; text-align:${align}; font-family:${fontFamily}; font-size:${fontSize}px; line-height:${lineHeight}; letter-spacing:${letterSpacing}px;">${text}</div>
        </div>`;
    }

    // 2. Bubbles
    const bubbleSource = (p.pageType === 'normal_image') ? (p.content?.bubbles || []) : [];
    if (bubbleSource.length > 0) {
        bubblesEl.innerHTML = bubbleSource.map((b, i) =>
            renderBubbleHTML(b, i, false, mode)
        ).join('');
    } else {
        bubblesEl.innerHTML = '';
    }

    // 3. Update Footer Info
    const total = totalPages;
    const current = pageIndex + 1;
    const slider = document.getElementById('page-slider');
    const label = document.getElementById('page-count');

    if (slider) {
        slider.min = 1;
        slider.max = total;
        slider.value = current;
    }
    if (label) {
        label.textContent = `${current} / ${total}`;
    }

    updateNavigationUI();
}

function updateNavigationUI() {
    const nextDir = getNextPageDirection();
    const slider = document.getElementById('page-slider');

    // Preload next and previous assets (images and fonts)
    preloadSurroundingAssets();

    const leftBtn = document.getElementById('viewer-nav-left');
    const rightBtn = document.getElementById('viewer-nav-right');
    if (slider) {
        // We use a CSS transform to visually flip the slider.
        // We handle the mathematical coordinate inversion directly in jumpToPage().
        if (nextDir === 'left') {
            slider.style.direction = 'ltr';
            slider.style.transform = 'scaleX(-1)';
        } else {
            slider.style.direction = 'ltr';
            slider.style.transform = 'none';
        }
        slider.style.background = ''; // Clear custom background
    }
    if (leftBtn) {
        leftBtn.title = nextDir === 'left' ? '次へ' : '前へ';
    }
    if (rightBtn) {
        rightBtn.title = nextDir === 'left' ? '前へ' : '次へ';
    }
}

// ──────────────────────────────────────
//  Image & Font Preloading
// ──────────────────────────────────────
function extractImageUrlFromPage(pageObj) {
    if (pageObj) {
        if (pageObj.content?.background) return pageObj.content.background;
        if (pageObj.bodyKind === 'image' || pageObj.pageType === 'normal_image') return pageObj.content?.background;
    }
    return null;
}

function extractFontsFromPage(pageObj) {
    const fontsToLoad = new Set();
    if (!pageObj) return fontsToLoad;

    // Check text lines
    const texts = pageObj.content?.texts;
    if (Array.isArray(texts)) {
        texts.forEach(t => {
            if (t.font?.fontFamily) fontsToLoad.add(t.font.fontFamily);
        });
    }

    // Check bubbles
    const bubbles = pageObj.content?.bubbles;
    if (Array.isArray(bubbles)) {
        bubbles.forEach(b => {
            if (b.textInfo?.fontFamily) fontsToLoad.add(b.textInfo.fontFamily);
        });
    }

    return Array.from(fontsToLoad);
}

function preloadSurroundingAssets() {
    const pages = getViewerPages();
    const hasPages = pages.length > 0;
    const totalPages = getViewerPageTotal();
    const pageIndexRaw = Number.isInteger(state.activePageIdx) ? state.activePageIdx : state.activeIdx;
    const currentIndex = Math.max(0, Math.min(pageIndexRaw || 0, totalPages - 1));

    // Define which indices to preload: Next 2 pages, Prev 1 page
    const indicesToLoad = [currentIndex + 1, currentIndex + 2, currentIndex - 1].filter(i => i >= 0 && i < totalPages);

    indicesToLoad.forEach(idx => {
        const p = pages[idx];

        // 1. Preload Images
        const originalUrl = extractImageUrlFromPage(p);
        if (originalUrl && typeof originalUrl === 'string' && originalUrl.trim() !== '') {
            // Initiate background load with the same optimized URL used for display
            const optimizedUrl = getOptimizedImageUrl(originalUrl);
            const img = new Image();
            img.src = optimizedUrl;
        }

        // 2. Preload Fonts (Prevent FOUT)
        const fonts = extractFontsFromPage(p);
        fonts.forEach(fontFamily => {
            // Use CSS Font Loading API if available. e.g. "16px 'Noto Sans JP'"
            if (document.fonts && document.fonts.load) {
                // If the font string doesn't contain quotes and has spaces, wrap it
                const safeFontStr = fontFamily.includes('-') || fontFamily.includes(' ')
                    ? `16px "${fontFamily.replace(/["']/g, '')}"`
                    : `16px ${fontFamily}`;

                document.fonts.load(safeFontStr).catch(err => {
                    // Ignore font load errors (e.g., system fonts or already loaded)
                    console.debug('[Viewer] Font preload info:', err);
                });
            }
        });
    });
}

// ──────────────────────────────────────
//  Resize Logic
// ──────────────────────────────────────
function resizeCanvas() {
    const canvas = document.getElementById('viewer-canvas');
    if (!canvas) return;

    // Target constraints
    const targetRatio = 9 / 16;
    const maxWidth = 500;

    // Available space
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Calculate best fit
    let finalW = w;
    let finalH = w / targetRatio;

    // Constrain by height
    if (finalH > h) {
        finalH = h;
        finalW = finalH * targetRatio;
    }

    // Constrain by max width (PC)
    if (finalW > maxWidth) {
        finalW = maxWidth;
        finalH = finalW / targetRatio;

        // Check height again after max-width
        if (finalH > h) {
            finalH = h;
            finalW = finalH * targetRatio;
        }
    }

    // Force full viewport dimensions if close match to avoid fractional gaps
    if (Math.abs(finalW - w) < 2) finalW = w;
    if (Math.abs(finalH - h) < 2) finalH = h;

    // For pixel perfect, just round, don't blindly ceil which can cause overflow
    canvas.style.width = `${Math.round(finalW)}px`;
    canvas.style.height = `${Math.round(finalH)}px`;

    // Scale `#content-stage` (360x640 base) to fit `#viewer-canvas`
    const stage = document.getElementById('content-stage');
    if (stage) {
        // We know canvas dimensions are finalW x finalH
        const baseW = 360;
        const baseH = 640;

        let fitScale;
        let tx = 0;
        let ty = 0;

        // Determine fitting strategy
        const scaleX = finalW / baseW;
        const scaleY = finalH / baseH;

        if (scaleX < scaleY) {
            // Fit Width (e.g. Phone Portrait)
            fitScale = scaleX;
            // tx is 0
            // Center vertically
            ty = (finalH - (baseH * fitScale)) / 2;
        } else {
            // Fit Height
            fitScale = scaleY;
            // Center horizontally
            tx = (finalW - (baseW * fitScale)) / 2;
            // ty is 0
        }

        // Let the browser handle subpixel anti-aliasing. Do not floor the translation
        // or artificially inflate the scale, which causes blurred edges and fractional gaps.
        fitScale = fitScale;

        // Recalculate offsets with precise scale
        tx = (finalW - (baseW * fitScale)) / 2;
        ty = (finalH - (baseH * fitScale)) / 2;

        stage.style.transform = `translate(${tx}px, ${ty}px) scale(${fitScale})`;
    }
}

// ──────────────────────────────────────
//  Navigation Helpers
// ──────────────────────────────────────
function next() {
    const total = getViewerPageTotal();
    if (total <= 0) return;
    if (state.activePageIdx < total - 1) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: state.activePageIdx + 1 });
        refresh();
    }
}

function prev() {
    const total = getViewerPageTotal();
    if (total <= 0) return;
    if (state.activePageIdx > 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: state.activePageIdx - 1 });
        refresh();
    }
}
window.next = next;
window.prev = prev;
window.viewerNavLeft = () => {
    const dir = getNextPageDirection();
    if (dir === 'left') next();
    else prev();
};
window.viewerNavRight = () => {
    const dir = getNextPageDirection();
    if (dir === 'left') prev();
    else next();
};

function getNextPageDirection() {
    const lang = state.activeLang;
    const mode = getWritingMode(lang);
    return mode === 'vertical-rl' ? 'left' : 'right';
}

// ──────────────────────────────────────
//  Event Handlers
// ──────────────────────────────────────

// Click (PC)
function handleClick(e) {
    // If zoomed, ignore navigation click
    if (viewState.scale > 1.05) return;
    const targetId = e?.target?.id || '';
    // zone 要素は onclick 側で処理済み。ここで重複してページ送りしない。
    if (targetId === 'zone-prev' || targetId === 'zone-next' || targetId === 'zone-menu') return;

    const w = window.innerWidth;
    const x = e.clientX;
    const nextDir = getNextPageDirection();

    // Center click -> Next
    if (x >= w * 0.3 && x <= w * 0.7) {
        next();
        return;
    }

    if (nextDir === 'left') {
        if (x < w * 0.3) next();
        else if (x > w * 0.7) prev();
    } else {
        if (x > w * 0.7) next();
        else if (x < w * 0.3) prev();
    }
}

// Keydown (PC)
function handleKeydown(e) {
    if (e.key === 'ArrowDown') { next(); return; }
    if (e.key === 'ArrowUp') { prev(); return; }

    const nextDir = getNextPageDirection();

    if (nextDir === 'left') {
        if (e.key === 'ArrowLeft') next();
        if (e.key === 'ArrowRight') prev();
    } else {
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
    }
}

// Wheel (PC: Zoom & Nav)
let wheelTimer = null;
function handleWheel(e) {
    e.preventDefault();

    if (e.ctrlKey) {
        // ZOOM
        const delta = -e.deltaY;
        const speed = 0.002;
        let newScale = viewState.scale + delta * speed;
        newScale = Math.min(Math.max(1, newScale), 5); // Limit 1x to 5x
        viewState.scale = newScale;

        // If zooming out to 1, reset pan
        if (viewState.scale <= 1) {
            resetZoom();
        } else {
            updateTransform();
        }
    } else {
        // NAV (only if not zoomed)
        if (viewState.scale > 1.05) return;

        if (wheelTimer) return;
        wheelTimer = setTimeout(() => { wheelTimer = null; }, 200);

        if (e.deltaY > 0) next();
        else if (e.deltaY < 0) prev();
    }
}

// ──────────────────────────────────────
//  Pointer Events (Unified Touch/Mouse)
// ──────────────────────────────────────
const pointerCache = [];
let pinchStartDist = 0;
let pinchStartScale = 1;
let lastTapTime = 0;
let pointerStartX = 0;
let pointerStartY = 0;
let isPinching = false;
let isPanning = false;

function getPinchDist(p1, p2) {
    return Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
}

function handlePointerDown(e) {
    pointerCache.push(e);

    if (pointerCache.length === 2) {
        // PINCH Start
        isPinching = true;
        isPanning = false;
        pinchStartDist = getPinchDist(pointerCache[0], pointerCache[1]);
        pinchStartScale = viewState.scale;
    } else if (pointerCache.length === 1) {
        // PAN / SWIPE / CLICK Setup
        isPinching = false;
        isPanning = viewState.scale > 1.05;

        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;

        if (e.pointerType === 'mouse' && isPanning) {
            e.target.setPointerCapture(e.pointerId);
        }
    }
}

function handlePointerMove(e) {
    // Update cache
    const index = pointerCache.findIndex(p => p.pointerId === e.pointerId);
    if (index !== -1) {
        pointerCache[index] = e;
    }

    if (isPinching && pointerCache.length === 2) {
        e.preventDefault(); // Prevent native scroll while pinching
        const dist = getPinchDist(pointerCache[0], pointerCache[1]);
        if (pinchStartDist > 0) {
            const newScale = pinchStartScale * (dist / pinchStartDist);
            viewState.scale = Math.min(Math.max(1, newScale), 5); // 1x to 5x
            updateTransform();
        }
    } else if (isPanning && pointerCache.length === 1) {
        e.preventDefault(); // Prevent native scroll while panning zoomed image
        const dx = e.clientX - viewState.lastX;
        const dy = e.clientY - viewState.lastY;
        viewState.currX += dx;
        viewState.currY += dy;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        updateTransform();
    }
}

function handlePointerUp(e) {
    // Remove from cache
    const index = pointerCache.findIndex(p => p.pointerId === e.pointerId);
    if (index !== -1) {
        pointerCache.splice(index, 1);
    }

    if (isPinching && pointerCache.length < 2) {
        isPinching = false;
        if (viewState.scale < 1.05) {
            resetZoom();
        }
        return;
    }

    if (pointerCache.length === 0) {
        if (isPanning) {
            isPanning = false;
            return; // If we were panning, don't trigger clicks or swipes
        }

        // SWIPE / TAP Detection (only if NOT zoomed)
        if (viewState.scale <= 1.05) {
            const diffX = e.clientX - pointerStartX;
            const diffY = e.clientY - pointerStartY;

            // Tap Detection (< 10px move is considered a tap/click)
            if (Math.abs(diffX) < 10 && Math.abs(diffY) < 10) {
                const currentTime = new Date().getTime();
                const tapLength = currentTime - lastTapTime;
                lastTapTime = currentTime;

                // Double tap handling
                if (tapLength < 300 && tapLength > 0 && e.pointerType !== 'mouse') {
                    // Double Tap Detected (usually mobile). Zoom in slightly.
                    if (viewState.scale > 1.05) {
                        resetZoom();
                    } else {
                        viewState.scale = 2;
                        updateTransform();
                    }
                    e.preventDefault();
                } else {
                    // Let the standard click handler (`handleClick` or `onclick` on zones) handle normal taps.
                    // We DO NOT call UI toggle or next/prev here to avoid double-firing with native click events.
                }
            } else {
                // Swipe Detection
                if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 28) {
                    // Horizontal Swipe
                    const nextDir = getNextPageDirection();
                    if (diffX > 0) {
                        // Swiped Right
                        if (nextDir === 'left') next();
                        else prev();
                    } else {
                        // Swiped Left
                        if (nextDir === 'left') prev();
                        else next();
                    }
                }
            }
        }
    }
}

// Start
init();
