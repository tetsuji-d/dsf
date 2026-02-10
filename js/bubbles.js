/**
 * bubbles.js — 吹き出し管理（追加・選択・ドラッグ・描画）
 */
import { state } from './state.js';
import { getShape, getShapeNames } from './shapes.js';

/**
 * テキスト量に応じてフォントサイズを計算する
 * @param {string} text - テキスト
 * @param {boolean} isVertical - 縦書きかどうか
 * @returns {number} フォントサイズ（px）
 */
function calcFontSize(text, isVertical) {
    const len = text.length;
    if (len <= 4) return 14;
    if (len <= 8) return 12;
    if (len <= 15) return 10;
    return 9;
}

/**
 * 吹き出し1つ分のHTMLを生成する
 * @param {object} b - バブルデータ
 * @param {number} i - インデックス
 * @param {boolean} isSelected - 選択中かどうか
 * @param {string} writingMode - 文字の向き
 * @returns {string} HTMLテンプレート
 */
export function renderBubbleHTML(b, i, isSelected, writingMode) {
    const shapeName = b.shape || 'speech';
    const shape = getShape(shapeName);
    const isVertical = writingMode === 'vertical-rl';
    const fontSize = calcFontSize(b.text, isVertical);
    const tb = shape.textBounds;

    const svgContent = shape.render(b, isSelected);

    return `
        <div class="bubble-svg"
             style="top:${b.y}%; left:${b.x}%;"
             onmousedown="selectBubble(event, ${i})">
            <svg width="${shape.svgWidth}" height="${shape.svgHeight}" viewBox="${shape.viewBox}">
                ${svgContent}
            </svg>
            <div class="bubble-text ${isVertical ? 'v-text' : ''}"
                 style="font-size:${fontSize}px; width:${tb.width}px; max-height:${tb.height}px; top:${tb.top};">
                ${b.text}
            </div>
        </div>
    `;
}

/**
 * 利用可能な形状名の一覧を返す
 */
export { getShapeNames };

/**
 * キャンバスクリック時に吹き出しを追加する
 * @param {MouseEvent} e
 * @param {function} refresh - 画面更新コールバック
 */
export function handleCanvasClick(e, refresh) {
    if (e.target.id !== 'main-img' && !e.target.classList.contains('text-layer')) return;
    const r = document.getElementById('canvas-view').getBoundingClientRect();
    state.sections[state.activeIdx].bubbles.push({
        x: ((e.clientX - r.left) / r.width * 100).toFixed(1),
        y: ((e.clientY - r.top) / r.height * 100).toFixed(1),
        tailX: 10, tailY: 25, text: "新しいセリフ",
        shape: 'speech'
    });
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;
    refresh();
}

/**
 * 吹き出しを選択し、ドラッグを開始する
 */
export function selectBubble(e, i, refresh) {
    e.stopPropagation();
    state.activeBubbleIdx = i;
    refresh();
    startDrag(e, i, refresh);
}

/**
 * 吹き出しのドラッグ処理
 */
export function startDrag(e, i, refresh) {
    const container = document.getElementById('canvas-view').getBoundingClientRect();
    const move = (me) => {
        state.sections[state.activeIdx].bubbles[i].x = ((me.clientX - container.left) / container.width * 100).toFixed(1);
        state.sections[state.activeIdx].bubbles[i].y = ((me.clientY - container.top) / container.height * 100).toFixed(1);
        refresh();
    };
    const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
}
