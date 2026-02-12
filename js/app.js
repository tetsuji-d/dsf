/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { uploadToStorage, triggerAutoSave, loadProject } from './firebase.js';
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
        const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
        // 画像自体にtransformを適用。
        // object-fit: cover とバッティングしないよう、width/heightを維持しつつCSS transformで動かす
        // ただし cover だと中心基準で切り取られるため、transform translate は中心からのオフセットとして機能する。
        // これで直感的な挙動になるはず。
        const imgStyle = `transform: translate(${pos.x}px, ${pos.y}px) scale(${pos.scale}); pointer-events: auto;`;

        render.innerHTML = `<img id="main-img" src="${s.background}" style="${imgStyle}">`;
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
}

// ──────────────────────────────────────
//  言語UI
// ──────────────────────────────────────
function renderLangTabs() {
    const container = document.getElementById('lang-tabs');
    if (!container) return;
    container.innerHTML = state.languages.map(code => {
        const props = getLangProps(code);
        const active = code === state.activeLang ? 'active' : '';
        return `<button class="lang-tab ${active}" onclick="switchLang('${code}')">${props.label}</button>`;
    }).join('');
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

window.toggleImageAdjustment = () => {
    const s = state.sections[state.activeIdx];
    if (!s || s.type !== 'image') return;

    isImageAdjusting = !isImageAdjusting;

    // UI更新
    const btn = document.getElementById('btn-adjust-img');
    if (btn) {
        btn.style.background = isImageAdjusting ? 'var(--primary)' : '#fff';
        btn.style.color = isImageAdjusting ? '#fff' : '#333';
    }

    // ガイド表示などの視覚的フィードバック
    const imgInfo = document.getElementById('text-label');
    if (imgInfo) {
        imgInfo.textContent = isImageAdjusting ? "画像をドラッグ/ピンチして調整" : "テキスト入力";
    }

    // 調整モード終了時に値を確定して保存（念のため）
    if (!isImageAdjusting) {
        triggerAutoSave();
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
            triggerAutoSave();
        }
    };

    // Mouse
    view.addEventListener('mousedown', (e) => {
        if (isImageAdjusting && e.target.id === 'main-img') {
            e.stopPropagation(); // Stop canvas pan
            e.preventDefault();
            onStart(e.clientX, e.clientY);
        }
    });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);

    // Touch
    view.addEventListener('touchstart', (e) => {
        if (isImageAdjusting && (e.target.id === 'main-img' || e.touches.length === 2)) {
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
    });

    // Wheel Zoom for Image
    view.addEventListener('wheel', (e) => {
        if (isImageAdjusting) {
            e.preventDefault();
            e.stopPropagation();
            const pos = getImgState();
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


function onLoadProject(pid, sections, languages, languageConfigs, title) {
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
window.setThumbSize = (size) => {
    state.thumbSize = size;
    refresh();
};
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

function updateCanvasTransform() {
    const layer = document.getElementById('canvas-transform-layer');
    if (layer) {
        layer.style.transform = `translate(-50%, -50%) translate(${canvasTranslate.x}px, ${canvasTranslate.y}px) scale(${canvasScale})`;
    }
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
    // Ensure save
    await triggerAutoSave();

    // Construct URL
    const host = window.location.host;
    const url = `${window.location.protocol}//${host}/viewer.html?id=${encodeURIComponent(state.projectId)}`;

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

// モバイルナビゲーション切り替え
window.toggleMobilePanel = (panelName) => {
    // 1. Update Nav Tabs
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));

    // Find the button that triggered this (based on onclick value is hard, so text search or just pass element? 
    // Easier: Map panelName to index or just update logic slightly.
    // For simplicity, let's look for the one with matching onclick
    const targetBtn = Array.from(navItems).find(b => b.getAttribute('onclick').includes(`'${panelName}'`));
    if (targetBtn) targetBtn.classList.add('active');

    // 2. Hide all panels first
    const sidebar = document.getElementById('sidebar');
    const rightPanel = document.getElementById('panel-right');
    if (sidebar) sidebar.classList.remove('active');
    if (rightPanel) rightPanel.classList.remove('active');

    // 3. Show target
    if (panelName === 'sidebar') {
        if (sidebar) sidebar.classList.add('active');
    } else if (panelName === 'properties') {
        if (rightPanel) rightPanel.classList.add('active');
    }
    // 'editor' just leaves panels hidden (showing main content)
};

// --- 初回描画 ---
refresh();
renderLangSettings();
initCanvasZoom(); // Initialize zoom/pan
initImageAdjustment(); // Initialize image adjustment events
