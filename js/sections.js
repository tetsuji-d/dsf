/**
 * sections.js — セクション管理（追加・切替・サムネイル・削除）
 */
import { state } from './state.js';

function createDefaultSection() {
    return {
        type: 'image',
        background: 'https://picsum.photos/600/1066',
        writingMode: 'horizontal-tb',
        bubbles: [],
        text: '',
        texts: {},
        imagePosition: { x: 0, y: 0, scale: 1, rotation: 0 },
        imageBasePosition: { x: 0, y: 0, scale: 1, rotation: 0 }
    };
}

function deepCloneSection(section) {
    if (typeof structuredClone === 'function') {
        return structuredClone(section);
    }
    return JSON.parse(JSON.stringify(section));
}

/**
 * 新しいセクションを追加する
 * @param {function} refresh - 画面更新コールバック
 */
export function addSection(refresh) {
    state.sections.push(createDefaultSection());
    state.activeIdx = state.sections.length - 1;
    state.activeBubbleIdx = null;
    refresh();
}

/**
 * 指定位置に新しいセクションを挿入する
 * @param {number} insertIndex - 挿入位置
 * @param {function} refresh - 画面更新コールバック
 */
export function insertSectionAt(insertIndex, refresh) {
    const idx = Math.max(0, Math.min(Number(insertIndex) || 0, state.sections.length));
    state.sections.splice(idx, 0, createDefaultSection());
    state.activeIdx = idx;
    state.activeBubbleIdx = null;
    refresh();
}

/**
 * 指定セクションを複製して直後に挿入する
 * @param {number} sourceIndex - 複製元インデックス
 * @param {function} refresh - 画面更新コールバック
 */
export function duplicateSectionAt(sourceIndex, refresh) {
    const idx = Number(sourceIndex);
    if (!Number.isInteger(idx) || !state.sections[idx]) return;
    const cloned = deepCloneSection(state.sections[idx]);
    state.sections.splice(idx + 1, 0, cloned);
    state.activeIdx = idx + 1;
    state.activeBubbleIdx = null;
    refresh();
}

/**
 * セクション順を移動する
 * @param {number} fromIndex - 元のインデックス
 * @param {number} insertIndex - 移動先の挿入インデックス
 * @param {function} refresh - 画面更新コールバック
 */
export function moveSection(fromIndex, insertIndex, refresh) {
    const from = Number(fromIndex);
    let to = Number(insertIndex);
    if (!Number.isInteger(from) || !Number.isFinite(to)) return;
    if (from < 0 || from >= state.sections.length) return;

    to = Math.max(0, Math.min(to, state.sections.length));
    if (to === from || to === from + 1) return;

    const moved = state.sections[from];
    state.sections.splice(from, 1);
    if (to > from) to -= 1;
    state.sections.splice(to, 0, moved);
    state.activeIdx = to;
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
    const cols = Number(state.thumbColumns) || 2;
    container.setAttribute('data-cols', String(cols));
    container.innerHTML = state.sections.map((s, i) => `
        <div class="thumb-wrap ${i === state.activeIdx ? 'active' : ''}" data-section-index="${i}"
            onclick="changeSection(${i})"
            ondragstart="startThumbDrag(event, ${i})"
            ondragover="onThumbDragOver(event, ${i})"
            ondragleave="onThumbDragLeave(event, ${i})"
            ondrop="onThumbDrop(event, ${i})"
            ondragend="endThumbDrag()"
            ontouchstart="startThumbTouchDrag(event, ${i})"
            aria-current="${i === state.activeIdx ? 'true' : 'false'}"
            draggable="true">
            ${(() => {
            if (s.type === 'image') {
                const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
                const tx = (pos.x / 360) * 100;
                const ty = (pos.y / 640) * 100;
                const rot = Number.isFinite(Number(pos.rotation)) ? Number(pos.rotation) : 0;
                const style = `transform: translate(${tx}%, ${ty}%) scale(${pos.scale}) rotate(${rot}deg); transform-origin: center center; width:100%; height:100%; object-fit:cover;`;
                return `<div style="width:100%;height:100%;overflow:hidden;border-radius:4px;"><img class="thumb-canvas" src="${s.background}" style="${style}"></div>`;
            } else {
                return `<div class="thumb-canvas" style="display:flex;align-items:center;justify-content:center;font-size:10px;padding:5px;background:#fff;">${s.text}</div>`;
            }
        })()}
            <button class="thumb-insert-btn before" title="ここに新規挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${i}, event)">＋</button>
            <button class="thumb-insert-btn after" title="この下に新規挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${i + 1}, event)">＋</button>
            <button class="thumb-duplicate-btn" title="ページを複製" ontouchstart="event.stopPropagation()" onclick="duplicateSectionByIndex(${i}, event)">⧉</button>
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
