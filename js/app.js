/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state, dispatch, actionTypes } from './state.js';
import { saveProject, loadProject, uploadToStorage, uploadCoverToStorage, uploadStructureToStorage, triggerAutoSave, flushSave, generateCroppedThumbnail, signInWithGoogle, signOutUser, onAuthChanged, consumeRedirectResult } from './firebase.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag, startTailDrag, startSpikeDrag } from './bubbles.js';
import { addSection, changeSection, changeBlock, insertStructureBlock, renderThumbs, deleteActive, insertSectionAt, duplicateSectionAt, moveSection, insertPageNearBlock, duplicateBlockAt, moveBlockAt, getOptimizedImageUrl } from './sections.js';
import { pushState, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal } from './projects.js';
import { getLangProps } from './lang.js';
import { getBlockIndexFromPageIndex, getPageIndexFromBlockIndex, migrateSectionsToBlocks, syncBlocksWithSections } from './blocks.js';
import { blocksToPages, normalizeProjectDataV5 } from './pages.js';
import { buildDSP, buildDSF, parseAndLoadDSP } from './export.js';
import { get as idbGet } from 'idb-keyval';

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


function syncBlocksFromState() {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: syncBlocksWithSections(state.blocks, state.sections, state.languages) } });
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

function updateAuthUI() {
    const signedIn = !!state.uid;
    const authBtn = document.getElementById('btn-auth');
    const authBtnMobile = document.getElementById('btn-auth-mobile');
    const authStatus = document.getElementById('auth-status');
    const saveStatus = document.getElementById('save-status');

    if (authBtn) {
        authBtn.textContent = signedIn ? 'Sign out' : 'Sign in with Google';
        authBtn.title = signedIn ? 'ログアウト' : 'Googleでログイン';
    }
    if (authBtnMobile) {
        authBtnMobile.textContent = signedIn ? 'Sign out' : 'Sign in';
    }
    if (authStatus) {
        authStatus.textContent = signedIn
            ? `${state.user?.displayName || state.user?.email || 'Signed in'}`
            : 'ゲスト';
    }
    if (!signedIn && saveStatus && !saveStatus.textContent.trim()) {
        saveStatus.textContent = 'ログインでクラウド保存';
        saveStatus.style.color = '#8a5d00';
    }
    document.body.classList.toggle('auth-guest', !signedIn);
    document.querySelectorAll('[data-auth-required]').forEach((el) => {
        el.disabled = !signedIn;
        if (!signedIn) {
            el.title = 'ログインすると利用できます';
        }
    });
}

const THUMB_COLUMN_OPTIONS = [8, 5, 4, 2, 1];

function getDeviceKey() {
    return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}

function sanitizeThumbColumns(value) {
    const n = Number(value);
    if (THUMB_COLUMN_OPTIONS.includes(n)) return n;
    return 2;
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
}

function setCurrentDeviceThumbColumns(cols) {
    ensureUiPrefs();
    const key = getDeviceKey();
    dispatch({ type: actionTypes.SET_THUMB_COLUMNS, payload: { columns: cols, device: key } });
}



// ──────────────────────────────────────
//  refresh — 画面全体を再描画する (Gen3: image pages only)
// ──────────────────────────────────────
function refresh() {
    const visSelect = document.getElementById('prop-visibility');
    if (visSelect && document.activeElement !== visSelect) {
        visSelect.value = state.visibility || 'private';
    }

    syncBlocksFromState();
    const activeBlock = getActiveBlock();
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // Normalize stale bubble selection
    if (state.activeBubbleIdx !== null && (!s?.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    }

    // メインキャンバスの描画 — image pages only
    if (s && s.type === 'image') {
        if (!s.imagePosition) s.imagePosition = {};
        const toNum = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        s.imagePosition.x = toNum(s.imagePosition.x, 0);
        s.imagePosition.y = toNum(s.imagePosition.y, 0);
        s.imagePosition.scale = Math.max(0.1, toNum(s.imagePosition.scale, 1));
        s.imagePosition.rotation = toNum(s.imagePosition.rotation, 0);
        const pos = s.imagePosition;
        if (!s.imageBasePosition) {
            s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
        }
        const targetStyle = `transform: translate(${pos.x}px, ${pos.y}px) scale(${pos.scale}) rotate(${pos.rotation}deg);`;

        const invScale = 1 / Math.max(pos.scale || 1, 0.1);

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
                <div id="image-adjust-target" style="${targetStyle}">
                    <img id="main-img" src="${getOptimizedImageUrl(s.backgrounds?.[state.activeLang] || s.background || '')}">
                    ${overlayInTarget}
                </div>
            </div>`;
        document.getElementById('image-only-props').style.display = 'block';
        document.getElementById('bubble-layer').style.display = 'block';
    } else if (s) {
        render.innerHTML = '';
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
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
        propType.disabled = false;
        propType.value = s?.type || 'image';
    }
    const deleteBtn = document.getElementById('btn-delete-active');
    if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.title = '';
    }
    const genericTextEditor = document.getElementById('generic-text-editor');
    if (genericTextEditor) genericTextEditor.style.display = 'block';

    // テキストエリア: バブル選択時のテキスト表示
    const propTextEl = document.getElementById('prop-text');
    if (propTextEl) {
        if (state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
            propTextEl.value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
        } else {
            propTextEl.value = '';
        }
        propTextEl.style.display = 'block';
        propTextEl.readOnly = false;
    }

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) {
        textLabel.textContent = `テキスト入力 [${langProps.label}]`;
    }

    // 吹き出し形状＆カラーセレクタの同期
    const shapeProps = document.getElementById('bubble-shape-props');
    if (state.activeBubbleIdx !== null && s?.bubbles?.[state.activeBubbleIdx]) {
        if (shapeProps) shapeProps.style.display = 'block';
        updateBubblePropPanel(s.bubbles[state.activeBubbleIdx]);
    } else {
        if (shapeProps) shapeProps.style.display = 'none';
        updateBubblePropPanel(null);
    }

    // プロジェクト名表示
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = state.projectId || '新規プロジェクト';
    }

    // 作品タイトル同期
    const propTitle = document.getElementById('prop-title');
    if (propTitle && document.activeElement !== propTitle) {
        propTitle.value = state.title || '';
    }
    // ヘッダーガイドにタイトル表示
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) {
        headerGuideTitle.textContent = state.title || 'タイトル未設定';
    }

    // 言語タブの更新
    renderLangTabs();

    // AR設定パネルの同期
    syncArPanel();
    // 言語パネルの同期
    syncLangPanel();

    updateHistoryButtons();
    renderThumbs();
    syncThumbColumnButtons();
}

// ──────────────────────────────────────
//  言語UI
// ──────────────────────────────────────
function renderLangTabs() {
    const html = state.languages.map(code => {
        const props = getLangProps(code);
        const active = code === state.activeLang ? 'active' : '';
        return `<button class="lang-tab ${active}" onclick="switchLang('${code}')">${props.label}</button>`;
    }).join('');
    ['lang-tabs', 'lang-tabs-project', 'lang-tabs-mobile'].forEach((id) => {
        const container = document.getElementById(id);
        if (container) container.innerHTML = html;
    });
}

function renderLangSettings() {
    const list = document.getElementById('lang-list');
    if (!list) return;
    list.innerHTML = state.languages.map(code => {
        const props = getLangProps(code);
        const canRemove = state.languages.length > 1;
        const removeBtn = canRemove
            ? `<button class="btn-sm" onclick="removeLang('${code}')">✕</button>`
            : '';
        return `<div class="lang-item"><span>${props.label}</span>${removeBtn}</div>`;
    }).join('');
}

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
        el.classList.remove('drop-before', 'drop-after', 'drag-source');
    });
}

function getThumbElement(index) {
    return document.querySelector(`.thumb-wrap[data-section-index="${index}"]`);
}

function markThumbDropHint(index, position) {
    clearThumbDropHints();
    const sourceEl = getThumbElement(thumbDragSourceIdx);
    if (sourceEl) sourceEl.classList.add('drag-source');
    const el = getThumbElement(index);
    if (!el) return;
    el.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
}

function getDropPositionByPoint(el, clientY) {
    const rect = el.getBoundingClientRect();
    return clientY < (rect.top + rect.height / 2) ? 'before' : 'after';
}

function moveSectionWithHistory(fromIndex, targetIndex, position) {
    const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
    const from = Number(fromIndex);
    let to = Math.max(0, Math.min(insertIndex, state.sections.length));
    if (to === from || to === from + 1) return false;
    pushState();
    moveSection(from, to, refresh);
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

    const dx = touch.clientX - thumbTouchState.startX;
    const dy = touch.clientY - thumbTouchState.startY;

    if (!thumbTouchState.active && Math.hypot(dx, dy) > 10) {
        clearTimeout(thumbTouchState.timerId);
        thumbTouchState.timerId = null;
        thumbTouchState = null;
        unbindTouchDragListeners();
        clearThumbDropHints();
        return;
    }

    if (!thumbTouchState.active) return;

    e.preventDefault();
    const hit = document.elementFromPoint(touch.clientX, touch.clientY);
    const wrap = hit ? hit.closest('.thumb-wrap') : null;
    if (!wrap) return;

    const targetIndex = Number(wrap.dataset.sectionIndex);
    if (!Number.isInteger(targetIndex)) return;
    const position = getDropPositionByPoint(wrap, touch.clientY);
    thumbTouchState.targetIndex = targetIndex;
    thumbTouchState.position = position;
    markThumbDropHint(targetIndex, position);

    const container = document.getElementById('thumb-container');
    if (container) {
        const cRect = container.getBoundingClientRect();
        if (touch.clientY < cRect.top + 40) container.scrollBy({ top: -20, behavior: 'auto' });
        if (touch.clientY > cRect.bottom - 40) container.scrollBy({ top: 20, behavior: 'auto' });
    }
}

function onThumbTouchEnd() {
    if (!thumbTouchState) return;
    clearTimeout(thumbTouchState.timerId);
    if (thumbTouchState.active && Number.isInteger(thumbTouchState.targetIndex)) {
        moveSectionWithHistory(thumbTouchState.sourceIndex, thumbTouchState.targetIndex, thumbTouchState.position || 'after');
        suppressThumbClickUntil = Date.now() + 350;
    }
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    thumbDragSourceIdx = null;
}

function onThumbTouchCancel() {
    if (!thumbTouchState) return;
    clearTimeout(thumbTouchState.timerId);
    thumbTouchState = null;
    unbindTouchDragListeners();
    clearThumbDropHints();
    thumbDragSourceIdx = null;
}

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const activeBlock = getActiveBlock();
    if (activeBlock && activeBlock.kind !== 'page') return;
    const s = state.sections[state.activeIdx];
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
    const cw = view.clientWidth || 360;
    const ch = view.clientHeight || 640;
    const visibilityFactor = Math.max(
        1,
        pos?.scale || 1,
        1 + Math.abs(pos?.x || 0) / 180,
        1 + Math.abs(pos?.y || 0) / 320
    );
    const needW = 360 * visibilityFactor;
    const needH = 640 * visibilityFactor;
    const s = Math.min(cw / needW, ch / needH) * 0.82;
    return Math.min(Math.max(s, 0.22), 0.9);
}

function getActiveImagePosition() {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return null;
    if (!s.imagePosition) s.imagePosition = {};
    const toNum = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    s.imagePosition.x = toNum(s.imagePosition.x, 0);
    s.imagePosition.y = toNum(s.imagePosition.y, 0);
    s.imagePosition.scale = Math.max(0.1, toNum(s.imagePosition.scale, 1));
    s.imagePosition.rotation = toNum(s.imagePosition.rotation, 0);
    if (!s.imageBasePosition) s.imageBasePosition = { x: 0, y: 0, scale: 1, rotation: 0 };
    return s.imagePosition;
}

function getPointerClientPoint(e) {
    if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

window.adjustImageZoom = (delta) => {
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !pos) return;
    pushState();
    pos.scale = Math.max(0.1, pos.scale + delta);
    refresh();
    triggerAutoSave();
};

window.resetImageTransform = () => {
    const s = state.sections[state.activeIdx];
    const pos = getActiveImagePosition();
    if (!isImageAdjusting || !s || !pos) return;
    const base = s.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 };
    pushState();
    pos.x = base.x || 0;
    pos.y = base.y || 0;
    pos.scale = base.scale || 1;
    pos.rotation = base.rotation || 0;
    refresh();
    triggerAutoSave();
};

window.startImageHandleDrag = (e, handleType) => {
    if (!isImageAdjusting) return;
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
    if (!isImageAdjusting || !imageHandleDrag) return;
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
    refresh();
}

function onImageHandleDragEnd() {
    if (!imageHandleDrag) return;
    imageHandleDrag = null;
    window.removeEventListener('mousemove', onImageHandleDragMove);
    window.removeEventListener('mouseup', onImageHandleDragEnd);
    const s = state.sections[state.activeIdx];
    if (s && s.background && state.uid) {
        generateCroppedThumbnail(
            s.background,
            s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
            refresh
        ).catch(e => console.warn('[DSF] Thumbnail update skipped (onImageHandleDragEnd):', e));
    }
    triggerAutoSave();
}

window.toggleImageAdjustment = () => {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return;

    isImageAdjusting = !isImageAdjusting;

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
        const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
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

    // 調整モード終了時に値を確定して保存＋サムネイル再生成
    if (!isImageAdjusting) {
        triggerAutoSave();
        refresh(); // Ensure handles disappear immediately
        // サムネイル更新
        if (s.background && state.uid) {
            generateCroppedThumbnail(
                s.background,
                s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
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

    // Helper to get image transform state
    const getImgState = () => {
        const s = state.sections[state.activeIdx];
        if (!s.imagePosition) s.imagePosition = { x: 0, y: 0, scale: 1 };
        return s.imagePosition;
    };

    // Events
    const onMove = (clientX, clientY) => {
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;
        const pos = getImgState();
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;
        refresh(); // Re-render transform
    };

    const onMoveWrap = (e) => onMove(e.clientX, e.clientY);

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            const s = state.sections[state.activeIdx];
            if (s && s.background && state.uid) {
                generateCroppedThumbnail(
                    s.background,
                    s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
                    refresh
                ).catch(e => console.warn('[DSF] Thumbnail update skipped (onEnd):', e));
            }
            triggerAutoSave();
        }
        window.removeEventListener('mousemove', onMoveWrap);
        window.removeEventListener('mouseup', onEnd);
    };

    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getImgState();
        startTransform = { x: pos.x, y: pos.y };
        window.addEventListener('mousemove', onMoveWrap);
        window.addEventListener('mouseup', onEnd);
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        const inAdjustTarget = !!(e.target && e.target.closest && e.target.closest('#image-adjust-target'));
        if (isImageAdjusting && (e.target.id === 'main-img' || inAdjustTarget)) {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });

    // Touch
    view.addEventListener('touchstart', (e) => {
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
                const pos = getImgState();
                startScale = pos.scale || 1;
            }
        }
    }, { passive: false });

    view.addEventListener('touchmove', (e) => {
        onImageHandleDragMove(e);
        if (!isImageAdjusting) return;
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
            const pos = getImgState();
            pos.scale = Math.max(0.1, startScale * scale);
            refresh();
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
            const pos = getActiveImagePosition() || getImgState();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            pos.scale = Math.max(0.1, (pos.scale || 1) * delta);
            refresh();
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
    const s = state.sections[state.activeIdx];
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

function updateBubbleShape(shapeName) {
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
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
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx][prop] = value;
        addRecentColor(value);
        refresh();
        triggerAutoSave();
    }
}
window.updateBubbleColor = updateBubbleColor;

// ─── AR 設定パネル ───────────────────────────────────────────────────────────

function _getActiveAr() {
    const s = state.sections[state.activeIdx];
    if (!s) return null;
    if (!s.ar || typeof s.ar !== 'object') s.ar = { mode: 'none', scale: 1.0, anchor: { x: 0, y: 0, z: -1.5 } };
    return s.ar;
}

function syncArPanel() {
    const group = document.getElementById('ar-settings-group');
    if (!group) return;
    const s = state.sections[state.activeIdx];
    // AR パネルは通常ページ（type:image / type:text）のみ表示
    if (!s || state.activeIdx === null) { group.style.display = 'none'; return; }
    group.style.display = '';

    const ar = _getActiveAr();
    const modeEl = document.getElementById('ar-mode-select');
    const scaleRow = document.getElementById('ar-scale-row');
    const anchorRow = document.getElementById('ar-anchor-row');
    if (modeEl) modeEl.value = ar.mode;
    scaleRow.style.display = ar.mode !== 'none' ? '' : 'none';
    anchorRow.style.display = ar.mode === 'webxr' ? '' : 'none';
    if (ar.mode !== 'none') {
        const scaleEl = document.getElementById('ar-scale-input');
        if (scaleEl) scaleEl.value = ar.scale ?? 1.0;
    }
    if (ar.mode === 'webxr') {
        const ax = document.getElementById('ar-anchor-x');
        const ay = document.getElementById('ar-anchor-y');
        const az = document.getElementById('ar-anchor-z');
        if (ax) ax.value = ar.anchor?.x ?? 0;
        if (ay) ay.value = ar.anchor?.y ?? 0;
        if (az) az.value = ar.anchor?.z ?? -1.5;
    }
}

function updateArMode(mode) {
    const ar = _getActiveAr();
    if (!ar) return;
    ar.mode = mode;
    syncArPanel();
    triggerAutoSave();
}
window.updateArMode = updateArMode;

function updateArScale(value) {
    const ar = _getActiveAr();
    if (!ar || !Number.isFinite(value) || value <= 0) return;
    ar.scale = value;
    triggerAutoSave();
}
window.updateArScale = updateArScale;

function updateArAnchor(axis, value) {
    const ar = _getActiveAr();
    if (!ar || !['x', 'y', 'z'].includes(axis) || !Number.isFinite(value)) return;
    if (!ar.anchor) ar.anchor = { x: 0, y: 0, z: -1.5 };
    ar.anchor[axis] = value;
    triggerAutoSave();
}
window.updateArAnchor = updateArAnchor;

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


function onLoadProject(pid, sections, languages, defaultLang, languageConfigs, title, uiPrefs, pages, blocks, version) {
    const normalized = normalizeProjectDataV5({
        version,
        pages,
        blocks,
        sections,
        languages,
        defaultLang,
        languageConfigs,
        title,
        uiPrefs
    });

    state.projectId = pid;
    state.title = normalized.title || '';
    state.pages = normalized.pages || [];
    state.blocks = normalized.blocks;
    state.sections = normalized.sections;
    state.languages = normalized.languages;
    state.defaultLang = normalized.defaultLang || normalized.languages[0] || 'ja';

    // languageConfigs Migration
    state.languageConfigs = normalized.languageConfigs || {};
    state.languages.forEach(lang => {
        if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};
        const cfg = state.languageConfigs[lang];
        // Gen3: pageDirection が未設定なら旧 writingMode から変換、またはデフォルト値を設定
        if (!cfg.pageDirection) {
            if (cfg.writingMode === 'vertical-rl') {
                cfg.pageDirection = 'rtl';
            } else if (cfg.writingMode === 'horizontal-tb') {
                cfg.pageDirection = 'ltr';
            } else {
                cfg.pageDirection = lang === 'ja' ? 'rtl' : 'ltr';
            }
        }
    });

    state.uiPrefs = normalized.uiPrefs || state.uiPrefs || {};
    ensureUiPrefs();
    applyThumbColumnsFromPrefs();

    state.activeLang = state.defaultLang || state.languages[0];
    state.activeIdx = 0;
    state.activePageIdx = 0;
    state.activeBlockIdx = Math.max(0, getBlockIndexFromPageIndex(state.blocks, 0));
    state.activeBubbleIdx = null;
    clearHistory();
    refresh();
    renderLangSettings();
}

// --- キーボードショートカット ---
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo(refresh);
        triggerAutoSave();
    }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        redo(refresh);
        triggerAutoSave();
    }
});

// --- グローバル関数の登録 ---
window.handleCanvasClick = (e) => { pushState(); handleCanvasClick(e, refresh); triggerAutoSave(); };
window.selectBubble = (e, i) => selectBubble(e, i, refresh);
window.addSection = () => { pushState(); addSection(refresh); triggerAutoSave(); };
window.changeSection = (i) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeSection(i, refresh);
};
window.changeBlock = (idx) => {
    if (Date.now() < suppressThumbClickUntil) return;
    changeBlock(idx, refresh);
};
window.insertSectionAtIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    pushState();
    insertSectionAt(idx, refresh);
    triggerAutoSave();
};
window.duplicateSectionByIndex = (idx, e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
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
    const el = getThumbElement(idx);
    if (el) el.classList.add('drag-source');
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
    const position = getDropPositionByPoint(el, e.clientY);
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
    const position = getDropPositionByPoint(el, e.clientY);
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
    thumbTouchState = {
        sourceIndex: idx,
        targetIndex: null,
        position: 'after',
        startX: touch.clientX,
        startY: touch.clientY,
        active: false,
        timerId: null
    };
    thumbTouchState.timerId = setTimeout(() => {
        if (!thumbTouchState) return;
        thumbTouchState.active = true;
        const sourceEl = getThumbElement(idx);
        if (sourceEl) sourceEl.classList.add('drag-source');
    }, 320);
    bindTouchDragListeners();
};
window.deleteActive = () => { pushState(); deleteActive(refresh); triggerAutoSave(); };
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.changeBubbleShapeFromMenu = (idx, shapeName) => {
    const s = state.sections[state.activeIdx];
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
    dispatch({ type: actionTypes.SET_TITLE, payload: v });
    const headerGuideTitle = document.getElementById('header-guide-title');
    if (headerGuideTitle) headerGuideTitle.textContent = v || 'タイトル未設定';
    triggerAutoSave();
};
window.setThumbColumns = (cols) => {
    setCurrentDeviceThumbColumns(cols);
    refresh();
    triggerAutoSave();
};
window.setThumbSize = window.setThumbColumns;
window.uploadToStorage = (input) => { pushState(); uploadToStorage(input, refresh); };

window.performUndo = () => { undo(refresh); triggerAutoSave(); };
window.performRedo = () => { redo(refresh); triggerAutoSave(); };

// FAB用
window.addBubbleFab = () => {
    pushState();
    addBubbleAtCenter(refresh);
    triggerAutoSave();
};

// バブル移動ハンドル用
window.onHandleDown = (e, i) => {
    startDrag(e, i, refresh);
};

// しっぽ移動ハンドル用
window.onTailHandleDown = (e, i) => {
    startTailDrag(e, i, refresh);
};

// ウニ・スパイク長ハンドル用
window.onSpikeHandleDown = (e, i) => {
    startSpikeDrag(e, i, refresh);
};

// ズーム・パン機能
let canvasScale = 1;
let canvasTranslate = { x: 0, y: 0 };

const CANVAS_ZOOM_PRESETS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 300, 400];

function syncCanvasZoomUI() {
    const select = document.getElementById('canvas-zoom-select');
    if (!select) return;
    const percent = Math.round(canvasScale * 100);
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

window.setCanvasZoomPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return;
    canvasScale = Math.min(Math.max(num / 100, 0.1), 5);
    updateCanvasTransform();
};

function updateCanvasTransform() {
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        layer.style.transform = `translate(-50%, -50%) translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasScale})`;
    }
    syncCanvasZoomUI();
}

// キャンバスリセット（中央寄せ・初期サイズ）
window.resetCanvasView = () => {
    canvasTranslate = { x: 0, y: 0 };

    // 画面サイズに合わせて自動スケール
    const container = document.getElementById('canvas-view');
    if (container) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // 9:16 (360x640) base
        const targetW = 360;
        const targetH = 640;

        let s = Math.min(cw / targetW, ch / targetH) * 0.9;
        if (s > 1.2) s = 1.0; // あまり大きすぎないように
        canvasScale = s;
    } else {
        canvasScale = 1;
    }

    updateCanvasTransform();
};

function initCanvasZoom() {
    const view = document.getElementById('canvas-view');
    if (!view) return;

    // 初期化時にリセット
    resetCanvasView();

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
        if (name && name !== '新規プロジェクト') {
            dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: name } });
        }
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
        if (name && name !== '新規プロジェクト') {
            state.projectId = name;
            triggerAutoSave();
        }
    }
};
window.saveProject = () => {
    if (!state.projectId) {
        const name = (document.getElementById('project-title').textContent || '').trim();
        if (!name || name === '新規プロジェクト') {
            const input = prompt('プロジェクト名を入力してください:');
            if (!input) return;
            state.projectId = input;
            document.getElementById('project-title').textContent = input;
        } else {
            state.projectId = name;
        }
    }
    triggerAutoSave();
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
        const loadedState = await parseAndLoadDSP(file);

        dispatch({
            type: actionTypes.LOAD_PROJECT,
            payload: loadedState
        });

        // Update title UI
        const pt = document.getElementById('project-title');
        if (pt) pt.textContent = state.title || 'Untitled';
        const inputTitle = document.getElementById('prop-title');
        if (inputTitle) inputTitle.value = state.title || '';

        refresh();
        alert("プロジェクトを読み込みました (ローカル)");
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

window.exportDSF = async () => {
    const btnDataList = document.querySelectorAll('button[onclick="exportDSF()"]');
    btnDataList.forEach(btn => btn.textContent = '⏳ ZIP生成中...');
    try {
        await buildDSF();
    } catch (e) {
        console.error("Export DSF failed:", e);
        alert("エクスポート中にエラーが発生しました。\n" + e.message);
    } finally {
        btnDataList.forEach(btn => btn.textContent = '⬇ 配信データ出力 (.dsf)');
    }
};

window.shareProject = async () => {
    if (!state.projectId) {
        alert("プロジェクトが保存されていません。");
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
        alert('現在の状態は「🔒 非公開」です。\nこのままでは作品を共有できません。上部メニューから「🔗 限定公開」か「🌍 公開」に変更してください。');
        return;
    }
    const url = `${window.location.protocol}//${host}/viewer.html?project=${encodeURIComponent(state.projectId)}&author=${encodeURIComponent(state.uid)}`;

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
        'private': '🔒 非公開（自分だけの状態）',
        'unlisted': '🔗 限定公開（URLを知っている人のみ閲覧可能）',
        'public': '🌍 公開（ポータルに掲載され誰でも閲覧可能）'
    };
    console.log(`[DSF] Visibility updated to ${val}`);
};

// 吹き出し直接編集（多言語対応）
let directEditPushTimer = null;
window.onBubbleTextInput = (e, i) => {
    const text = (e.target.innerText || '').replace(/\n+$/, '');
    const s = state.sections[state.activeIdx];
    if (s.bubbles && s.bubbles[i]) {
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

// 言語追加
window.addLang = () => {
    const select = document.getElementById('lang-add-select');
    if (!select) return;
    const code = select.value;
    if (!code || state.languages.includes(code)) return;
    state.languages.push(code);
    if (!state.languageConfigs) state.languageConfigs = {};
    state.languageConfigs[code] = {
        pageDirection: code === 'ja' ? 'rtl' : 'ltr'
    };
    renderLangSettings();
    renderLangTabs();
    triggerAutoSave();
};

// 言語削除
window.removeLang = (code) => {
    if (state.languages.length <= 1) return;
    if (!confirm(`${getLangProps(code).label} を削除しますか？\nこの言語のテキストは保持されます。`)) return;
    state.languages = state.languages.filter(c => c !== code);
    if (state.defaultLang === code) {
        state.defaultLang = state.languages[0] || 'ja';
    }
    if (state.activeLang === code) {
        state.activeLang = state.defaultLang || state.languages[0];
    }
    renderLangSettings();
    refresh();
    triggerAutoSave();
};

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal(onLoadProject);
window.closeProjectModal = closeProjectModal;

// 新規プロジェクト
window.newProject = () => {
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return;
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'projectId', value: null } });
    dispatch({ type: actionTypes.SET_TITLE, payload: '' });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languages', value: ['ja'] } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'defaultLang', value: 'ja' } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'languageConfigs', value: { ja: { pageDirection: 'rtl' } } } });
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
    const leftCollapsed = document.body.classList.contains('left-collapsed');
    const rightCollapsed = document.body.classList.contains('right-collapsed');
    const leftBtn = document.getElementById('btn-toggle-sidebar');
    const rightBtn = document.getElementById('btn-toggle-panel');
    if (leftBtn) leftBtn.textContent = leftCollapsed ? '📚 Pagesを開く' : '📚 Pages';
    if (rightBtn) rightBtn.textContent = rightCollapsed ? '⚙ Editを開く' : '⚙ Edit';
}

window.toggleDesktopPanel = (side) => {
    if (side === 'left') {
        document.body.classList.toggle('left-collapsed');
    }
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
    toggleDesktopPanel('left');
};

window.toggleEditPanel = () => {
    if (window.innerWidth < 1024) {
        closeMobileSheet();
        return;
    }
    toggleDesktopPanel('right');
};

let activeMobileSheet = null;
let lastDeviceKey = getDeviceKey();

function setBottomBarActive(actionName) {
    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.mobileAction === actionName);
    });
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
        home: 'mobile-sheet-home',
        add: 'mobile-sheet-add',
        export: 'mobile-sheet-export',
        lang: 'mobile-sheet-lang'
    };
    openMobileActionSheet(map[sheetName] || 'mobile-sheet-home');
};

function initUIChrome() {
    document.querySelectorAll('.ribbon-tab').forEach((tab) => {
        tab.addEventListener('click', () => setRibbonTab(tab.dataset.ribbonTab));
    });

    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => toggleDesktopPanel('left'));
    document.getElementById('btn-toggle-panel')?.addEventListener('click', () => toggleDesktopPanel('right'));

    document.querySelectorAll('.bottom-item').forEach((item) => {
        item.addEventListener('click', () => openMobileSheet(item.dataset.mobileAction));
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 1024) {
            closeMobileSheet();
        }
        const currentDeviceKey = getDeviceKey();
        if (currentDeviceKey !== lastDeviceKey) {
            lastDeviceKey = currentDeviceKey;
            applyThumbColumnsFromPrefs();
            refresh();
        }
    });

    setRibbonTab('home');
    syncDesktopToggleButtons();
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
            await signOutUser();
        } else {
            await signInWithGoogle();
        }
    } catch (e) {
        const code = e?.code || '';
        let msg = e?.message || 'unknown error';
        if (code === 'auth/unauthorized-domain') {
            msg = 'このアクセス元ドメインはFirebase Authで未許可です。Firebase Console > Authentication > Settings > Authorized domains に現在のホストを追加してください。';
        } else if (code === 'auth/popup-blocked') {
            msg = 'ポップアップがブロックされました。iPhoneではリダイレクトログインを使用してください。';
        } else if (code === 'auth/persistence-unavailable') {
            msg = 'Safariでログイン状態を保持できません。プライベートブラウズOFF・すべてのCookieをブロックOFFを確認してください。';
        } else if (code === 'auth/redirect-state-lost') {
            msg = 'リダイレクト後にログイン状態が消えています。iPhoneの「サイト越えトラッキングを防ぐ」を一時的にOFFにして再試行してください。';
        }
        alert(`認証に失敗しました (${code || 'no-code'}): ${msg}`);
    }
};

onAuthChanged((user) => {
    state.user = user || null;
    state.uid = user?.uid || null;
    updateAuthUI();
});

// --- 初回描画 ---
async function bootstrapApp() {
    initUIChrome();
    ensureUiPrefs();
    applyThumbColumnsFromPrefs();

    // Prevent local restore if we are explicitly loading a cloud project via URL
    const urlParams = new URLSearchParams(window.location.search);
    const hasCloudId = urlParams.has('id');

    consumeRedirectResult().catch((e) => {
        const code = e?.code || '';
        let detail = e?.message || 'unknown error';
        if (code === 'auth/unauthorized-domain') {
            detail = 'Firebase AuthのAuthorized domainsに現在のホストが未登録です。';
        } else if (code === 'auth/redirect-state-lost') {
            detail = 'iPhoneでリダイレクト後の認証状態が復元できませんでした。Cookie/トラッキング設定を確認してください。';
        }
        alert(`ログイン復帰に失敗しました (${code || 'no-code'}): ${detail}`);
    });

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
                const restoredState = JSON.parse(stateStr);

                // Only dispatch state keys that exist in our actual store
                dispatch({ type: actionTypes.LOAD_PROJECT, payload: restoredState });
                console.log("[DSF] Auto-save restored successfully.");
            }
        } catch (err) {
            console.warn("[DSF] Error restoring local auto-save:", err);
        }
    }

    refresh();
    renderLangSettings();
    updateAuthUI();
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
                    ['speech', '💬 角丸'], ['oval', '⭕ 楕円'], ['rect', '📄 四角'],
                    ['cloud', '☁️ 雲'], ['wave', '🌊 波'], ['thought', '💭 思考'],
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
                    <span class="material-icons">chat_bubble_outline</span> ここに吹き出しを追加
                </div>
            `;
            // ポインター座標を一時保存（addBubbleAtPointerで使う）
            contextMenu.dataset.pointerX = e.clientX;
            contextMenu.dataset.pointerY = e.clientY;
        }

        // メニューの表示位置を計算 (画面外にはみ出ないように調整)
        contextMenu.style.display = 'flex';
        const rect = contextMenu.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;

        if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
        if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
    });

    // 画面のどこかをクリックしたらコンテキストメニューを閉じる
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });
}

// Global functions for context menu actions
window.addBubbleAtPointer = function (e) {
    const contextMenu = document.getElementById('context-menu');
    if (!contextMenu) return;
    contextMenu.style.display = 'none';

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
        shape: 'speech',
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
    if (contextMenu) contextMenu.style.display = 'none';

    const section = state.sections[state.activeIdx];
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
    if (contextMenu) contextMenu.style.display = 'none';

    const section = state.sections[state.activeIdx];
    if (!section || !section.bubbles || !section.bubbles[bubbleIndex]) return;

    pushState();
    section.bubbles.splice(bubbleIndex, 1);
    state.activeBubbleIdx = null;

    refresh();
    triggerAutoSave();
};
