/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { saveProject, loadProject, uploadToStorage, triggerAutoSave, generateCroppedThumbnail, signInWithGoogle, signOutUser, onAuthChanged, consumeRedirectResult } from './firebase.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText, addBubbleAtCenter, startDrag } from './bubbles.js';
import { addSection, changeSection, renderThumbs, deleteActive } from './sections.js';
import { pushState, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal } from './projects.js';
import { getLangProps, getAllLangs } from './lang.js';

// ──────────────────────────────────────
//  ヘルパー: セクションテキストの多言語取得・設定
// ──────────────────────────────────────
function getSectionText(s) {
    const lang = state.activeLang;
    if (s.texts && s.texts[lang] !== undefined) return s.texts[lang];
    return s.text || '';
}

function setSectionText(s, text) {
    const lang = state.activeLang;
    if (!s.texts) s.texts = {};
    s.texts[lang] = text;
    s.text = text;
}

// ──────────────────────────────────────
//  refresh — 画面全体を再描画する
// ──────────────────────────────────────
// ──────────────────────────────────────
//  ヘルパー: 書字方向の取得
// ──────────────────────────────────────
function getWritingMode(lang) {
    if (state.languageConfigs && state.languageConfigs[lang]) {
        return state.languageConfigs[lang].writingMode;
    }
    // Fallback / Default
    const props = getLangProps(lang);
    return props.defaultWritingMode || 'horizontal-tb';
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
    state.thumbColumns = sanitizeThumbColumns(state.uiPrefs[key].thumbColumns);
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
    const normalized = sanitizeThumbColumns(cols);
    state.uiPrefs[key].thumbColumns = normalized;
    state.thumbColumns = normalized;
}

// ──────────────────────────────────────
//  refresh — 画面全体を再描画する
// ──────────────────────────────────────
function refresh() {
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // Global Writing Mode
    const effectiveMode = getWritingMode(lang);

    // メインキャンバスの描画切り替え
    if (s.type === 'image') {
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
        // 画像自体にtransformを適用。
        // object-fit: cover とバッティングしないよう、width/heightを維持しつつCSS transformで動かす
        // ただし cover だと中心基準で切り取られるため、transform translate は中心からのオフセットとして機能する。
        // これで直感的な挙動になるはず。
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
                    <img id="main-img" src="${s.background}">
                    ${overlayInTarget}
                </div>
            </div>`;
        document.getElementById('image-only-props').style.display = 'block';
        document.getElementById('bubble-layer').style.display = 'block';
    } else {
        const sectionText = getSectionText(s);
        const vtClass = effectiveMode === 'vertical-rl' ? 'v-text' : '';
        const align = langProps.sectionAlign;

        // フォーカス維持判定
        const existing = document.getElementById('main-text-area');
        if (existing && document.activeElement === existing) {
            if (existing.value !== sectionText) existing.value = sectionText;
        } else {
            render.innerHTML = `<textarea id="main-text-area" class="text-layer ${vtClass}" 
                style="text-align:${align};" 
                oninput="updateActiveText(this.value)">${sectionText}</textarea>`;
        }
        document.getElementById('image-only-props').style.display = 'none';
        document.getElementById('bubble-layer').style.display = 'none';
        document.getElementById('bubble-shape-props').style.display = 'none';
    }

    // 吹き出し描画
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (!isDirectEditing && s.type !== 'text') {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, effectiveMode) // Pass effectiveMode
        ).join('');
    }

    // activeBubbleIdxが無効な場合はリセット
    if (state.activeBubbleIdx !== null && (!s.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        state.activeBubbleIdx = null;
    }

    // パネルUIの同期
    document.getElementById('prop-type').value = s.type;

    // 言語設定パネル内の書字方向同期
    const langModeSelect = document.getElementById('lang-writing-mode');
    if (langModeSelect) {
        langModeSelect.value = effectiveMode;
        // 言語が縦書き非対応なら無効化などの制御も可能だが、
        // lang.js の writingModes に従うべき
        const allowed = langProps.writingModes;
        Array.from(langModeSelect.options).forEach(opt => {
            opt.disabled = !allowed.includes(opt.value);
        });
    }

    // テキストエリア: 言語に応じたテキストを表示
    if (state.activeBubbleIdx !== null && s.bubbles[state.activeBubbleIdx]) {
        document.getElementById('prop-text').value = getBubbleText(s.bubbles[state.activeBubbleIdx]);
    } else {
        document.getElementById('prop-text').value = getSectionText(s);
    }

    // テキストラベルに現在の言語を表示
    const textLabel = document.getElementById('text-label');
    if (textLabel) textLabel.textContent = `テキスト入力 [${langProps.label}]`;

    // 吹き出し形状セレクタの同期
    const shapeProps = document.getElementById('bubble-shape-props');
    const shapeSelect = document.getElementById('prop-shape');
    if (state.activeBubbleIdx !== null && s.bubbles[state.activeBubbleIdx]) {
        shapeProps.style.display = 'block';
        shapeSelect.value = s.bubbles[state.activeBubbleIdx].shape || 'speech';
    } else {
        shapeProps.style.display = 'none';
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

// ──────────────────────────────────────
//  セクションプロパティ更新
// ──────────────────────────────────────
function update(k, v) {
    const s = state.sections[state.activeIdx];
    if (k === 'type' && v === 'text' && s.bubbles && s.bubbles.length > 0) {
        const ok = confirm(`このセクションには${s.bubbles.length}個の吹き出しがあります。\nテキストセクションに切り替えると吹き出しは削除されます。\nよろしいですか？`);
        if (!ok) {
            document.getElementById('prop-type').value = s.type;
            return;
        }
        pushState();
        s.bubbles = [];
        state.activeBubbleIdx = null;
    } else {
        pushState();
    }
    s[k] = v;
    refresh();
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
    const s = state.sections[state.activeIdx];
    if (s && s.background && state.uid) {
        generateCroppedThumbnail(
            s.background,
            s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
            refresh
        ).catch(() => { });
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
        // サムネイル更新
        if (s.background && state.uid) {
            generateCroppedThumbnail(
                s.background,
                s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
                refresh
            ).catch(() => { });
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
    const onStart = (clientX, clientY) => {
        if (!isImageAdjusting) return;
        isDraggingImg = true;
        startPos = { x: clientX, y: clientY };
        const pos = getImgState();
        startTransform = { x: pos.x, y: pos.y };
    };

    const onMove = (clientX, clientY) => {
        if (!isImageAdjusting || !isDraggingImg) return;
        const dx = clientX - startPos.x;
        const dy = clientY - startPos.y;

        // Canvasのズームレベルを考慮して移動量を補正
        // canvasScale is global from initCanvasZoom scope... wait, we need access to it.
        // It's defined below. We might need to move this logic or access it.
        // For now, let's assume we can access 'canvasScale' variable if it's in outer scope or module scope.
        // Actually canvasScale is defined in outer scope in this file. Good.

        const pos = getImgState();
        pos.x = startTransform.x + dx / canvasScale;
        pos.y = startTransform.y + dy / canvasScale;

        refresh(); // Re-render transform
    };

    const onEnd = () => {
        if (isDraggingImg) {
            isDraggingImg = false;
            const s = state.sections[state.activeIdx];
            if (s && s.background && state.uid) {
                generateCroppedThumbnail(
                    s.background,
                    s.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 },
                    refresh
                ).catch(() => { });
            }
            triggerAutoSave();
        }
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
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('mousemove', onImageHandleDragMove);
    window.addEventListener('mouseup', onImageHandleDragEnd);

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
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        setBubbleText(s.bubbles[state.activeBubbleIdx], v);
    } else {
        setSectionText(s, v);
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
//  グローバル書字方向更新
// ──────────────────────────────────────
function updateGlobalWritingMode(mode) {
    const lang = state.activeLang;
    if (!state.languageConfigs) state.languageConfigs = {};
    if (!state.languageConfigs[lang]) state.languageConfigs[lang] = {};

    state.languageConfigs[lang].writingMode = mode;
    pushState();
    refresh();
    triggerAutoSave();
}


function onLoadProject(pid, sections, languages, languageConfigs, title, uiPrefs) {
    state.projectId = pid;
    state.title = title || '';
    state.sections = sections;
    state.languages = languages && languages.length > 0 ? languages : ['ja'];

    // languageConfigs Migration
    if (languageConfigs) {
        state.languageConfigs = languageConfigs;
    } else {
        // Old format migration: create configs based on defaults
        state.languageConfigs = {};
        state.languages.forEach(lang => {
            const props = getLangProps(lang);
            state.languageConfigs[lang] = {
                writingMode: props.defaultWritingMode || 'horizontal-tb'
            };
        });
    }

    state.uiPrefs = uiPrefs || state.uiPrefs || {};
    ensureUiPrefs();
    applyThumbColumnsFromPrefs();

    state.activeLang = state.languages[0];
    state.activeIdx = 0;
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
window.changeSection = (i) => changeSection(i, refresh);
window.deleteActive = () => { pushState(); deleteActive(refresh); triggerAutoSave(); };
window.update = update;
window.updateActiveText = updateActiveText;
window.updateBubbleShape = updateBubbleShape;
window.updateGlobalWritingMode = updateGlobalWritingMode;
window.updateTitle = (v) => {
    state.title = v;
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

    view.addEventListener('mousedown', (e) => {
        // 画像調整中はCanvas全体のパンを無効化
        if (isImageAdjusting) return;

        // バブルやテキストレイヤー以外ならPan開始
        if (e.target.id === 'canvas-view' || e.target.id === 'content-render' || e.target.classList.contains('text-layer')) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            startTranslate = { ...canvasTranslate };
            view.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        const dx = e.clientX - startPan.x;
        const dy = e.clientY - startPan.y;
        canvasTranslate.x = startTranslate.x + dx;
        canvasTranslate.y = startTranslate.y + dy;
        updateCanvasTransform();
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            view.style.cursor = 'default';
        }
    });

    // Touch Pan & Pinch (Simplified)
    // Hammer.js or similar recommended for robust pinch, but implementing basic logic here
    // For now, support single touch pan (if not on bubble)
    view.addEventListener('touchstart', (e) => {
        // 画像調整中はCanvasパン無効
        if (isImageAdjusting) return;

        if (e.touches.length === 1 && (e.target.id === 'canvas-view' || e.target.classList.contains('text-layer'))) {
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
            state.projectId = name;
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

window.exportProject = () => {
    const data = {
        version: 2,
        projectId: state.projectId,
        title: state.title || '',
        sections: state.sections,
        languages: state.languages,
        languageConfigs: state.languageConfigs,
        lastUpdated: new Date().toISOString()
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectId || 'project'}.dsf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    // Ensure save
    await triggerAutoSave();

    // Construct URL
    const host = window.location.host;
    const url = `${window.location.protocol}//${host}/viewer.html?id=${encodeURIComponent(state.projectId)}&uid=${encodeURIComponent(state.uid)}`;

    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(url);
        alert(`スマホ用URLをコピーしました！\n\n${url}`);
    } catch (e) {
        prompt("ビューワー用URL (コピーしてください):", url);
    }
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
    renderLangSettings();
    renderLangTabs();
    triggerAutoSave();
};

// 言語削除
window.removeLang = (code) => {
    if (state.languages.length <= 1) return;
    if (!confirm(`${getLangProps(code).label} を削除しますか？\nこの言語のテキストは保持されます。`)) return;
    state.languages = state.languages.filter(c => c !== code);
    if (state.activeLang === code) {
        state.activeLang = state.languages[0];
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
    state.projectId = null;
    state.title = '';
    state.languages = ['ja'];
    state.languageConfigs = {
        ja: { writingMode: 'vertical-rl' }
    };
    state.uiPrefs = {
        desktop: { thumbColumns: 2 },
        mobile: { thumbColumns: 2 }
    };
    applyThumbColumnsFromPrefs();
    state.activeLang = 'ja';
    state.sections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        writingMode: 'horizontal-tb', // Legacy usage, ignored
        bubbles: [],
        text: '',
        texts: {}
    }];
    state.activeIdx = 0;
    state.activeBubbleIdx = null;
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
initUIChrome();
ensureUiPrefs();
applyThumbColumnsFromPrefs();
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
refresh();
renderLangSettings();
updateAuthUI();
initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
