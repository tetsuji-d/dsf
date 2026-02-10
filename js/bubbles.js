/**
 * bubbles.js — 吹き出し管理（追加・選択・ドラッグ）
 */
import { state } from './state.js';

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
        tailX: 10, tailY: 20, text: "新しいセリフ"
    });
    state.activeBubbleIdx = state.sections[state.activeIdx].bubbles.length - 1;
    refresh();
}

/**
 * 吹き出しを選択し、ドラッグを開始する
 * @param {MouseEvent} e
 * @param {number} i - 吹き出しのインデックス
 * @param {function} refresh - 画面更新コールバック
 */
export function selectBubble(e, i, refresh) {
    e.stopPropagation();
    state.activeBubbleIdx = i;
    refresh();
    startDrag(e, i, refresh);
}

/**
 * 吹き出しのドラッグ処理
 * @param {MouseEvent} e
 * @param {number} i - 吹き出しのインデックス
 * @param {function} refresh - 画面更新コールバック
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
