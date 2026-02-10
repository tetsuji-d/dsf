/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { uploadToStorage, triggerAutoSave, saveAsProject, loadProject } from './firebase.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML } from './bubbles.js';
import { addSection, changeSection, renderThumbs, deleteActive } from './sections.js';
import { pushState, undo, redo, getHistoryInfo, clearHistory } from './history.js';
import { openProjectModal, closeProjectModal } from './projects.js';

/**
 * 画面全体を再描画する
 */
function refresh() {
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');

    // メインキャンバスの描画切り替え
    if (s.type === 'image') {
        render.innerHTML = `<img id="main-img" src="${s.background}">`;
        document.getElementById('image-only-props').style.display = 'block';
    } else {
        render.innerHTML = `<div class="text-layer ${s.writingMode === 'vertical-rl' ? 'v-text' : ''}">${s.text}</div>`;
        document.getElementById('image-only-props').style.display = 'none';
    }

    // 吹き出し描画（統一パス）
    document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
        renderBubbleHTML(b, i, i === state.activeBubbleIdx, s.writingMode)
    ).join('');

    // activeBubbleIdxが無効な場合はリセット
    if (state.activeBubbleIdx !== null && (!s.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        state.activeBubbleIdx = null;
    }

    // パネルUIの同期
    document.getElementById('prop-type').value = s.type;
    document.getElementById('prop-mode').value = s.writingMode;
    document.getElementById('prop-text').value = (state.activeBubbleIdx !== null) ? s.bubbles[state.activeBubbleIdx].text : s.text;

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
    if (titleEl) {
        titleEl.textContent = state.projectId || '新規プロジェクト';
    }

    // Undo/Redo ボタン状態更新
    updateHistoryButtons();

    renderThumbs();
}

/**
 * Undo/Redoボタンの有効/無効を更新
 */
function updateHistoryButtons() {
    const info = getHistoryInfo();
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !info.canUndo;
    if (redoBtn) redoBtn.disabled = !info.canRedo;
}

/**
 * セクションのプロパティを更新する
 */
function update(k, v) {
    const s = state.sections[state.activeIdx];

    // タイプを「テキスト」に切り替える際、吹き出しがあれば確認する
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
    triggerAutoSave();
}

/**
 * アクティブなテキスト（吹き出し or セクションテキスト）を更新する
 */
let textPushTimer = null;
function updateActiveText(v) {
    const s = state.sections[state.activeIdx];

    // テキスト入力は連続するため、500msのデバウンスでpushState
    if (!textPushTimer) {
        pushState();
    } else {
        clearTimeout(textPushTimer);
    }
    textPushTimer = setTimeout(() => { textPushTimer = null; }, 500);

    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx].text = v;
    } else {
        s.text = v;
    }
    refresh();
    triggerAutoSave();
}

/**
 * 選択中の吹き出しの形状を変更する
 */
function updateBubbleShape(shapeName) {
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        pushState();
        s.bubbles[state.activeBubbleIdx].shape = shapeName;
        refresh();
        triggerAutoSave();
    }
}

/**
 * サムネイルサイズを変更する
 */
function resizeThumbs(value) {
    const thumbs = document.querySelectorAll('.thumb-wrap');
    thumbs.forEach(t => t.style.width = value + '%');
}

/**
 * プロジェクトを読み込んだ時の処理
 */
function onLoadProject(pid, sections) {
    state.projectId = pid;
    state.sections = sections;
    state.activeIdx = 0;
    state.activeBubbleIdx = null;
    clearHistory();
    refresh();
}

// --- キーボードショートカット ---
document.addEventListener('keydown', (e) => {
    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo(refresh);
        triggerAutoSave();
    }
    // Ctrl+Shift+Z or Ctrl+Y: Redo
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
window.resizeThumbs = resizeThumbs;
window.uploadToStorage = (input) => { pushState(); uploadToStorage(input, refresh); };
window.saveAsProject = saveAsProject;

// Undo/Redo
window.performUndo = () => { undo(refresh); triggerAutoSave(); };
window.performRedo = () => { redo(refresh); triggerAutoSave(); };

// プロジェクトモーダル
window.openProjectModal = () => openProjectModal(onLoadProject);
window.closeProjectModal = closeProjectModal;

// 新規プロジェクト
window.newProject = () => {
    if (state.projectId && !confirm('現在のプロジェクトを閉じて新しいプロジェクトを作成しますか？')) return;
    state.projectId = null;
    state.sections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        writingMode: 'horizontal-tb',
        bubbles: [],
        text: ''
    }];
    state.activeIdx = 0;
    state.activeBubbleIdx = null;
    clearHistory();
    refresh();
    closeProjectModal();
};

// --- 初回描画 ---
refresh();
