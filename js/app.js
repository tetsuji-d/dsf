/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { uploadToStorage, triggerAutoSave, loadProject } from './firebase.js';
import { handleCanvasClick, selectBubble, renderBubbleHTML, getBubbleText, setBubbleText } from './bubbles.js';
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
function refresh() {
    const s = state.sections[state.activeIdx];
    const render = document.getElementById('content-render');
    const lang = state.activeLang;
    const langProps = getLangProps(lang);

    // writingMode: 言語が対応していない場合は横書きに強制
    const allowedModes = langProps.writingModes;
    const effectiveMode = allowedModes.includes(s.writingMode) ? s.writingMode : 'horizontal-tb';

    // メインキャンバスの描画切り替え
    if (s.type === 'image') {
        render.innerHTML = `<img id="main-img" src="${s.background}">`;
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

    // 吹き出し描画（テキストセクションの場合はスキップされるが念のため条件追加）
    const editingEl = document.activeElement;
    const isDirectEditing = editingEl && editingEl.classList.contains('bubble-text')
        && editingEl.getAttribute('contenteditable') === 'true';

    if (!isDirectEditing && s.type !== 'text') {
        document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) =>
            renderBubbleHTML(b, i, i === state.activeBubbleIdx, s.writingMode)
        ).join('');
    }

    // activeBubbleIdxが無効な場合はリセット
    if (state.activeBubbleIdx !== null && (!s.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        state.activeBubbleIdx = null;
    }

    // パネルUIの同期
    document.getElementById('prop-type').value = s.type;
    document.getElementById('prop-mode').value = s.writingMode;

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

    // writingMode: 言語が対応していない場合はUIを無効化
    const modeSelect = document.getElementById('prop-mode');
    const verticalOption = modeSelect.querySelector('option[value="vertical-rl"]');
    if (verticalOption) {
        verticalOption.disabled = !allowedModes.includes('vertical-rl');
    }

    // プロジェクト名表示 (contenteditable なので textContent を更新)
    const titleEl = document.getElementById('project-title');
    if (titleEl && document.activeElement !== titleEl) {
        titleEl.textContent = state.projectId || '新規プロジェクト';
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
    triggerAutoSave();
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



function onLoadProject(pid, sections, languages) {
    state.projectId = pid;
    state.sections = sections;
    state.languages = languages && languages.length > 0 ? languages : ['ja'];
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
window.setThumbSize = (size) => {
    state.thumbSize = size;
    refresh();
};
window.uploadToStorage = (input) => { pushState(); uploadToStorage(input, refresh); };

window.performUndo = () => { undo(refresh); triggerAutoSave(); };
window.performRedo = () => { redo(refresh); triggerAutoSave(); };

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
    state.languages = ['ja'];
    state.activeLang = 'ja';
    state.sections = [{
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        writingMode: 'horizontal-tb',
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

// --- 初回描画 ---
refresh();
renderLangSettings();
