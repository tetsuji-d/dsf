/**
 * sections.js — page block operations + thumbnail rendering
 */
import { state } from './state.js';
import {
    createStructureBlock,
    getBlockIndexFromPageIndex,
    getPageBlockIndices,
    getPageIndexFromBlockIndex
} from './blocks.js';

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

function truncateText(v, max = 22) {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, max)}...`;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getLocalized(meta, key, lang) {
    if (!meta || !meta[key] || typeof meta[key] !== 'object') return '';
    return meta[key][lang] || '';
}

function getBlockSummary(block) {
    const lang = state.activeLang || 'ja';
    const kind = block?.kind || 'unknown';
    if (kind === 'cover_front') {
        const t = truncateText(getLocalized(block.meta, 'title', lang));
        const a = truncateText(getLocalized(block.meta, 'author', lang));
        return {
            badge: '表紙',
            title: t || 'Front Cover',
            subtitle: a || 'Author'
        };
    }
    if (kind === 'cover_back') {
        const c = truncateText(getLocalized(block.meta, 'colophon', lang));
        return {
            badge: '裏表紙',
            title: c || 'Colophon'
        };
    }
    if (kind === 'chapter' || kind === 'section' || kind === 'item') {
        const labels = { chapter: '章', section: '節', item: '項' };
        return {
            badge: labels[kind] || kind,
            title: truncateText(getLocalized(block.meta, 'title', lang)) || `${labels[kind] || kind}タイトル`
        };
    }
    if (kind === 'item_end') {
        return { badge: '項終端', title: 'Item End' };
    }
    if (kind === 'toc') {
        return { badge: '目次', title: truncateText(getLocalized(block.meta, 'title', lang)) || 'Table of Contents' };
    }
    return { badge: kind, title: '' };
}

/**
 * 新しいセクションを追加する
 * @param {function} refresh - 画面更新コールバック
 */
export function addSection(refresh) {
    state.sections.push(createDefaultSection());
    state.activeIdx = state.sections.length - 1;
    state.activeBlockIdx = null;
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
    state.activeBlockIdx = null;
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
    state.activeBlockIdx = null;
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

    // Keep page block ordering in sync with page DnD reorder.
    const pageBlockIndicesBefore = getPageBlockIndices(state.blocks || []);
    const fromBlockIdx = pageBlockIndicesBefore[from];
    if (Number.isInteger(fromBlockIdx) && (state.blocks || [])[fromBlockIdx]?.kind === 'page') {
        const movedBlock = state.blocks[fromBlockIdx];
        state.blocks.splice(fromBlockIdx, 1);

        const pageBlockIndicesAfter = getPageBlockIndices(state.blocks || []);
        let targetBlockIdx;
        if (to >= pageBlockIndicesAfter.length) {
            targetBlockIdx = state.blocks.findIndex((b) => b?.kind === 'cover_back');
            if (targetBlockIdx < 0) targetBlockIdx = state.blocks.length;
        } else {
            targetBlockIdx = pageBlockIndicesAfter[to];
        }
        state.blocks.splice(targetBlockIdx, 0, movedBlock);
        state.activeBlockIdx = targetBlockIdx;
    } else {
        state.activeBlockIdx = null;
    }

    state.activeBubbleIdx = null;
    refresh();
}

/**
 * 指定したセクションに切り替える
 * @param {number} i - セクションのインデックス
 * @param {function} refresh - 画面更新コールバック
 */
export function changeSection(i, refresh) {
    const idx = Number(i);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.sections.length) return;
    state.activeIdx = idx;
    const blockIdx = getBlockIndexFromPageIndex(state.blocks, idx);
    if (blockIdx >= 0) state.activeBlockIdx = blockIdx;
    state.activeBubbleIdx = null;
    refresh();
}

export function changeBlock(blockIndex, refresh) {
    const idx = Number(blockIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (state.blocks || []).length) return;
    state.activeBlockIdx = idx;
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, idx);
    if (pageIdx >= 0) {
        state.activeIdx = pageIdx;
    }
    state.activeBubbleIdx = null;
    refresh();
}

export function insertStructureBlock(kind, refresh) {
    const block = createStructureBlock(kind);
    if (!block) return;
    const list = state.blocks || [];
    const baseIndex = Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : (list.length - 2);
    const insertAt = Math.max(1, Math.min(baseIndex + 1, Math.max(1, list.length - 1)));
    list.splice(insertAt, 0, block);
    state.blocks = list;
    state.activeBlockIdx = insertAt;
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

    const blocks = state.blocks || [];
    const pageBlockIndices = getPageBlockIndices(blocks);
    const pageIndexByBlock = new Map(pageBlockIndices.map((bi, pageIdx) => [bi, pageIdx]));
    const context = { chapter: false, section: false, item: false };

    container.innerHTML = blocks.map((b, blockIdx) => {
        const selected = blockIdx === state.activeBlockIdx;
        if (b?.kind === 'page') {
            const pageIdx = pageIndexByBlock.get(blockIdx) ?? 0;
            const s = state.sections[pageIdx] || createDefaultSection();
            if (s.type === 'image') {
                const preview = (() => {
                    const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
                    const tx = (pos.x / 360) * 100;
                    const ty = (pos.y / 640) * 100;
                    const rot = Number.isFinite(Number(pos.rotation)) ? Number(pos.rotation) : 0;
                    const style = `transform: translate(${tx}%, ${ty}%) scale(${pos.scale}) rotate(${rot}deg); transform-origin: center center; width:100%; height:100%; object-fit:cover;`;
                    return `<div style="width:100%;height:100%;overflow:hidden;border-radius:4px;"><img class="thumb-canvas" src="${s.background}" style="${style}"></div>`;
                })();
                return `
                    <div class="thumb-wrap thumb-card ${selected ? 'active' : ''}" data-block-index="${blockIdx}"
                        data-section-index="${pageIdx}"
                        onclick="changeBlock(${blockIdx})"
                        ondragstart="startThumbDrag(event, ${pageIdx})"
                        ondragover="onThumbDragOver(event, ${pageIdx})"
                        ondragleave="onThumbDragLeave(event, ${pageIdx})"
                        ondrop="onThumbDrop(event, ${pageIdx})"
                        ondragend="endThumbDrag()"
                        ontouchstart="startThumbTouchDrag(event, ${pageIdx})"
                        aria-current="${selected ? 'true' : 'false'}"
                        draggable="true">
                        ${preview}
                        <button class="thumb-insert-btn before" title="ここにページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx}, event)">＋</button>
                        <button class="thumb-insert-btn after" title="この下にページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx + 1}, event)">＋</button>
                        <button class="thumb-duplicate-btn" title="ページを複製" ontouchstart="event.stopPropagation()" onclick="duplicateSectionByIndex(${pageIdx}, event)">⧉</button>
                        <div style="position:absolute; top:5px; left:5px; background:white; font-size:10px; padding:2px; border:1px solid #ddd;">#${pageIdx + 1}</div>
                    </div>
                `;
            }

            const depth = context.item ? 3 : (context.section ? 2 : (context.chapter ? 1 : 0));
            const textLabel = truncateText(s.texts?.[state.activeLang] || s.text || '', 54) || 'テキストページ';
            return `
                <div class="thumb-wrap thumb-row thumb-row-page ${selected ? 'active' : ''}" data-block-index="${blockIdx}"
                    data-section-index="${pageIdx}"
                    data-tree-depth="${depth}"
                    onclick="changeBlock(${blockIdx})"
                    ondragstart="startThumbDrag(event, ${pageIdx})"
                    ondragover="onThumbDragOver(event, ${pageIdx})"
                    ondragleave="onThumbDragLeave(event, ${pageIdx})"
                    ondrop="onThumbDrop(event, ${pageIdx})"
                    ondragend="endThumbDrag()"
                    ontouchstart="startThumbTouchDrag(event, ${pageIdx})"
                    aria-current="${selected ? 'true' : 'false'}"
                    draggable="true">
                    <div class="thumb-row-main">
                        <span class="thumb-tree-indent" style="--tree-depth:${depth};"></span>
                        <span class="thumb-row-badge">Text #${pageIdx + 1}</span>
                        <span class="thumb-row-title">${escapeHtml(textLabel)}</span>
                    </div>
                    <div class="thumb-row-actions">
                        <button class="thumb-row-btn" title="ここにページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx}, event)">＋</button>
                        <button class="thumb-row-btn" title="下にページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx + 1}, event)">＋</button>
                        <button class="thumb-row-btn" title="ページを複製" ontouchstart="event.stopPropagation()" onclick="duplicateSectionByIndex(${pageIdx}, event)">⧉</button>
                    </div>
                </div>
            `;
        }

        const info = getBlockSummary(b);
        let depth = 0;
        if (b?.kind === 'chapter') {
            depth = 0;
            context.chapter = true;
            context.section = false;
            context.item = false;
        } else if (b?.kind === 'section') {
            depth = 1;
            context.section = true;
            context.item = false;
        } else if (b?.kind === 'item') {
            depth = 2;
            context.item = true;
        } else if (b?.kind === 'item_end') {
            depth = 2;
            context.item = false;
        } else {
            depth = 0;
        }
        return `
            <div class="thumb-wrap thumb-row ${selected ? 'active' : ''}" data-block-index="${blockIdx}"
                data-tree-depth="${depth}"
                onclick="changeBlock(${blockIdx})"
                draggable="false">
                <div class="thumb-row-main">
                    <span class="thumb-tree-indent" style="--tree-depth:${depth};"></span>
                    <span class="thumb-row-badge">${escapeHtml(info.badge)}</span>
                    <span class="thumb-row-title">${escapeHtml(info.title || '')}</span>
                    ${info.subtitle ? `<span class="thumb-row-subtitle">${escapeHtml(info.subtitle)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * アクティブな要素（吹き出し or セクション/ブロック）を削除する
 * @param {function} refresh - 画面更新コールバック
 */
export function deleteActive(refresh) {
    const activeBlock = (state.blocks || [])[state.activeBlockIdx];
    if (state.activeBubbleIdx !== null) {
        state.sections[state.activeIdx].bubbles.splice(state.activeBubbleIdx, 1);
        state.activeBubbleIdx = null;
        refresh();
        return;
    }

    if (activeBlock && activeBlock.kind !== 'page') {
        if (activeBlock.kind === 'cover_front' || activeBlock.kind === 'cover_back') {
            refresh();
            return;
        }
        state.blocks.splice(state.activeBlockIdx, 1);
        state.activeBlockIdx = Math.max(0, state.activeBlockIdx - 1);
        refresh();
        return;
    }

    if (state.sections.length > 1) {
        state.sections.splice(state.activeIdx, 1);
        state.activeIdx = Math.max(0, state.activeIdx - 1);
    }
    refresh();
}
