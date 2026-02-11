/**
 * sections.js — セクション管理（追加・切替・サムネイル・削除）
 */
import { state } from './state.js';

/**
 * 新しいセクションを追加する
 * @param {function} refresh - 画面更新コールバック
 */
export function addSection(refresh) {
    state.sections.push({
        type: 'image',
        background: 'https://picsum.photos/600/1066',
        writingMode: 'horizontal-tb',
        bubbles: [],
        text: ''
    });
    state.activeIdx = state.sections.length - 1;
    state.activeBubbleIdx = null;
    refresh();
}

/**
 * 指定したセクションに切り替える
 * @param {number} i - セクションのインデックス
 * @param {function} refresh - 画面更新コールバック
 */
export function changeSection(i, refresh) {
    state.activeIdx = i;
    state.activeBubbleIdx = null;
    refresh();
}

/**
 * サムネイル一覧を描画する
 */
export function renderThumbs() {
    const container = document.getElementById('thumb-container');
    container.setAttribute('data-size', state.thumbSize || 'M');
    container.innerHTML = state.sections.map((s, i) => `
        <div class="thumb-wrap ${i === state.activeIdx ? 'active' : ''}" onclick="changeSection(${i})">
            ${s.type === 'image'
            ? `<img class="thumb-canvas" src="${s.background}">`
            : `<div class="thumb-canvas" style="display:flex;align-items:center;justify-content:center;font-size:10px;padding:5px;background:#fff;">${s.text}</div>`}
            <div style="position:absolute; top:5px; left:5px; background:white; font-size:10px; padding:2px; border:1px solid #ddd;">#${i + 1}</div>
        </div>
    `).join('');
}

/**
 * アクティブな要素（吹き出し or セクション）を削除する
 * @param {function} refresh - 画面更新コールバック
 */
export function deleteActive(refresh) {
    if (state.activeBubbleIdx !== null) {
        state.sections[state.activeIdx].bubbles.splice(state.activeBubbleIdx, 1);
        state.activeBubbleIdx = null;
    } else if (state.sections.length > 1) {
        state.sections.splice(state.activeIdx, 1);
        state.activeIdx = Math.max(0, state.activeIdx - 1);
    }
    refresh();
}
