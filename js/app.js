/**
 * app.js — メインエントリポイント・描画・UI同期
 */
import { state } from './state.js';
import { uploadToStorage, saveToCloud, loadFromCloud } from './firebase.js';
import { handleCanvasClick, selectBubble } from './bubbles.js';
import { addSection, changeSection, renderThumbs, deleteActive } from './sections.js';

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

    // 吹き出し描画
    document.getElementById('bubble-layer').innerHTML = (s.bubbles || []).map((b, i) => `
        <div class="bubble-svg ${i === state.activeBubbleIdx ? 'selected' : ''}" style="top:${b.y}%; left:${b.x}%;" onmousedown="selectBubble(event, ${i})">
            <svg width="150" height="120" viewBox="0 0 150 120">
                <ellipse cx="75" cy="50" rx="65" ry="40" fill="white" stroke="black" stroke-width="2"/>
                <path d="M 75 90 L ${75 + (b.tailX || 10)} ${90 + (b.tailY || 20)} L 95 85" fill="white" stroke="black" stroke-width="2"/>
            </svg>
            <div class="bubble-text ${s.writingMode === 'vertical-rl' ? 'v-text' : ''}">${b.text}</div>
        </div>
    `).join('');

    // activeBubbleIdxが無効な場合はリセット
    if (state.activeBubbleIdx !== null && (!s.bubbles || !s.bubbles[state.activeBubbleIdx])) {
        state.activeBubbleIdx = null;
    }

    // パネルUIの同期
    document.getElementById('prop-type').value = s.type;
    document.getElementById('prop-mode').value = s.writingMode;
    document.getElementById('prop-text').value = (state.activeBubbleIdx !== null) ? s.bubbles[state.activeBubbleIdx].text : s.text;

    renderThumbs();
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
            // キャンセル時はドロップダウンを元に戻す
            document.getElementById('prop-type').value = s.type;
            return;
        }
        // 吹き出しを削除
        s.bubbles = [];
        state.activeBubbleIdx = null;
    }

    s[k] = v;
    refresh();
}

/**
 * アクティブなテキスト（吹き出し or セクションテキスト）を更新する
 */
function updateActiveText(v) {
    const s = state.sections[state.activeIdx];
    if (state.activeBubbleIdx !== null && s.bubbles && s.bubbles[state.activeBubbleIdx]) {
        s.bubbles[state.activeBubbleIdx].text = v;
    } else {
        s.text = v;
    }
    refresh();
}

/**
 * サムネイルサイズを変更する
 */
function resizeThumbs(value) {
    const thumbs = document.querySelectorAll('.thumb-wrap');
    thumbs.forEach(t => t.style.width = value + '%');
}

// --- グローバル関数の登録（HTMLのonclick属性から呼び出し可能にする） ---
window.handleCanvasClick = (e) => handleCanvasClick(e, refresh);
window.selectBubble = (e, i) => selectBubble(e, i, refresh);
window.addSection = () => addSection(refresh);
window.changeSection = (i) => changeSection(i, refresh);
window.deleteActive = () => deleteActive(refresh);
window.update = update;
window.updateActiveText = updateActiveText;
window.resizeThumbs = resizeThumbs;
window.uploadToStorage = (input) => uploadToStorage(input, refresh);
window.saveToCloud = saveToCloud;
window.loadFromCloud = () => loadFromCloud(refresh);

// --- 初回描画 ---
refresh();
