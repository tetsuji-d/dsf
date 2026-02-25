/**
 * sections.js — page block operations + thumbnail rendering
 */
import { state, dispatch, actionTypes } from './state.js';
import { deepClone, createId } from './utils.js';

// ──────────────────────────────────────────────────────────────
//  画像 URL 最適化（将来の Cloudflare CDN 配信に対応）
//  app.js・sections.js 両方で使用するため、ここで定義してエクスポート
// ──────────────────────────────────────────────────────────────
export function getOptimizedImageUrl(originalUrl) {
    if (!originalUrl || typeof originalUrl !== 'string') return '';
    // ⚠️ NOTE: Cloudflare Image Resizing が dsf.ink で有効化されるまでは false
    const ENABLE_CLOUDFLARE_IMAGE_DELIVERY = false;
    const CF_DOMAIN = 'https://dsf.ink';
    if (ENABLE_CLOUDFLARE_IMAGE_DELIVERY && originalUrl.includes('firebasestorage.googleapis.com')) {
        const screenWidth = window.innerWidth || window.screen?.width || 800;
        const dpr = window.devicePixelRatio || 1;
        const logicalWidth = screenWidth * dpr;
        let targetWidth = 400;
        if (logicalWidth > 1600) targetWidth = 2000;
        else if (logicalWidth > 1200) targetWidth = 1600;
        else if (logicalWidth > 800) targetWidth = 1200;
        else if (logicalWidth > 400) targetWidth = 800;
        return `${CF_DOMAIN}/cdn-cgi/image/width=${targetWidth},format=auto,quality=80/${originalUrl}`;
    }
    return originalUrl;
}
import {
    createStructureBlock,
    createPageBlockFromSection,
    extractSectionsFromBlocks,
    getBlockIndexFromPageIndex,
    getPageBlockIndices,
    getPageIndexFromBlockIndex,
    syncBlocksWithSections
} from './blocks.js';
import { blocksToPages } from './pages.js';

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
        return {
            badge: '目次',
            title: truncateText(getLocalized(block.meta, 'title', lang)) || 'Table of Contents',
            subtitle: block?.meta?.systemGenerated ? '自動生成' : ''
        };
    }
    return { badge: kind, title: '' };
}

function isCoverKind(kind) {
    return kind === 'cover_front' || kind === 'cover_back';
}

function isLockedBlock(block) {
    if (!block) return false;
    if (isCoverKind(block.kind)) return true;
    return block.kind === 'toc' && block.meta?.systemGenerated === true;
}

function canManualMoveBlock(block) {
    if (!block || isLockedBlock(block)) return false;
    return block.kind === 'chapter' || block.kind === 'section' || block.kind === 'item' || block.kind === 'toc';
}

function findMovableTargetIndex(blocks, fromIndex, direction) {
    const list = Array.isArray(blocks) ? blocks : [];
    const step = direction === 'up' ? -1 : 1;
    let i = Number(fromIndex) + step;
    while (i >= 0 && i < list.length) {
        const b = list[i];
        if (isCoverKind(b?.kind)) return -1;
        if (b?.kind === 'toc' && b?.meta?.systemGenerated) {
            i += step;
            continue;
        }
        return i;
    }
    return -1;
}

function canInsertNearBlock(block, position) {
    const pos = position === 'before' ? 'before' : 'after';
    const kind = block?.kind;
    if (block?.kind === 'toc' && block?.meta?.systemGenerated) return false;
    if (kind === 'cover_front' && pos === 'before') return false;
    if (kind === 'cover_back' && pos === 'after') return false;
    return true;
}

function syncModelsFromLegacy() {
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: syncBlocksWithSections(state.blocks, state.sections, state.languages) } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'pages', value: blocksToPages(state.blocks) } });
    if (!Number.isInteger(state.activePageIdx)) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: Number.isInteger(state.activeIdx) ? state.activeIdx : 0 });
    }
}

/**
 * 新しいセクションを追加する
 * @param {function} refresh - 画面更新コールバック
 */
export function addSection(refresh) {
    const list = [...state.sections, createDefaultSection()];
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: list.length - 1 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: null });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
    refresh();
}

/**
 * 指定位置に新しいセクションを挿入する
 * @param {number} insertIndex - 挿入位置
 * @param {function} refresh - 画面更新コールバック
 */
export function insertSectionAt(insertIndex, refresh) {
    const idx = Math.max(0, Math.min(Number(insertIndex) || 0, state.sections.length));
    const list = [...state.sections];
    list.splice(idx, 0, createDefaultSection());
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: idx });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: null });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
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
    const cloned = deepClone(state.sections[idx]);
    const list = [...state.sections];
    list.splice(idx + 1, 0, cloned);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: idx + 1 });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: null });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
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
    const newSections = [...state.sections];
    newSections.splice(from, 1);
    if (to > from) to -= 1;
    newSections.splice(to, 0, moved);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: to });

    // Keep page block ordering in sync with page DnD reorder.
    const pageBlockIndicesBefore = getPageBlockIndices(state.blocks || []);
    const fromBlockIdx = pageBlockIndicesBefore[from];
    if (Number.isInteger(fromBlockIdx) && (state.blocks || [])[fromBlockIdx]?.kind === 'page') {
        const movedBlock = state.blocks[fromBlockIdx];
        const newBlocks = [...state.blocks];
        newBlocks.splice(fromBlockIdx, 1);

        const pageBlockIndicesAfter = getPageBlockIndices(newBlocks);
        let targetBlockIdx;
        if (to >= pageBlockIndicesAfter.length) {
            targetBlockIdx = newBlocks.findIndex((b) => b?.kind === 'cover_back');
            if (targetBlockIdx < 0) targetBlockIdx = newBlocks.length;
        } else {
            targetBlockIdx = pageBlockIndicesAfter[to];
        }
        newBlocks.splice(targetBlockIdx, 0, movedBlock);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: targetBlockIdx });
    } else {
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: null });
    }

    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
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
    dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: idx });
    const blockIdx = getBlockIndexFromPageIndex(state.blocks, idx);
    if (blockIdx >= 0) dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: blockIdx });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    refresh();
}

export function changeBlock(blockIndex, refresh) {
    const idx = Number(blockIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (state.blocks || []).length) return;
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: idx });
    const pageIdx = getPageIndexFromBlockIndex(state.blocks, idx);
    if (pageIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx });
    }
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    refresh();
}

export function insertStructureBlock(kind, refresh) {
    const block = createStructureBlock(kind);
    if (!block) return;
    const list = [...(state.blocks || [])];
    const baseIndex = Number.isInteger(state.activeBlockIdx) ? state.activeBlockIdx : (list.length - 2);
    const insertAt = Math.max(1, Math.min(baseIndex + 1, Math.max(1, list.length - 1)));
    list.splice(insertAt, 0, block);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: insertAt });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
    refresh();
}

export function insertPageNearBlock(blockIndex, position, refresh) {
    const idx = Number(blockIndex);
    const list = [...(state.blocks || [])];
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
    const pos = position === 'before' ? 'before' : 'after';
    const target = list[idx];
    if (!canInsertNearBlock(target, pos)) return;

    let insertAt = pos === 'before' ? idx : idx + 1;
    insertAt = Math.max(1, Math.min(insertAt, Math.max(1, list.length - 1)));

    const pageBlock = createPageBlockFromSection(createDefaultSection());
    list.splice(insertAt, 0, pageBlock);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: list } });
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: extractSectionsFromBlocks(list) } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: insertAt });
    const pageIdx = getPageIndexFromBlockIndex(list, insertAt);
    if (pageIdx >= 0) {
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx });
    }
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
    refresh();
}

export function duplicateBlockAt(blockIndex, refresh) {
    const idx = Number(blockIndex);
    const list = [...(state.blocks || [])];
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
    const target = list[idx];
    if (!target || target.kind === 'cover_front' || target.kind === 'cover_back') return;

    if (target.kind === 'page') {
        const pageIdx = getPageIndexFromBlockIndex(state.blocks, idx);
        if (!Number.isInteger(pageIdx) || pageIdx < 0 || !state.sections[pageIdx]) return;
        const clonedSection = deepClone(state.sections[pageIdx]);
        const newSections = [...state.sections];
        newSections.splice(pageIdx + 1, 0, clonedSection);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
        syncModelsFromLegacy();
        const nextBlockIdx = getBlockIndexFromPageIndex(state.blocks, pageIdx + 1);
        if (nextBlockIdx >= 0) dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: nextBlockIdx });
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: pageIdx + 1 });
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
        refresh();
        return;
    }

    const cloned = deepClone(target);
    cloned.id = createId(target.kind || 'block');
    list.splice(idx + 1, 0, cloned);
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: idx + 1 });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
    refresh();
}

export function moveBlockAt(blockIndex, direction, refresh) {
    const idx = Number(blockIndex);
    const list = state.blocks || [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return false;
    const block = list[idx];
    if (!canManualMoveBlock(block)) return false;
    const targetIdx = findMovableTargetIndex(list, idx, direction);
    if (targetIdx < 0 || targetIdx === idx) return false;

    [list[idx], list[targetIdx]] = [list[targetIdx], list[idx]];
    dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: list } });
    dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: targetIdx });
    dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
    syncModelsFromLegacy();
    refresh();
    return true;
}

/**
 * サムネイル一覧を描画する
 */
export function renderThumbs() {
    const container = document.getElementById('thumb-container');
    const prevScrollTop = container ? container.scrollTop : 0;
    const cols = Number(state.thumbColumns) || 2;
    container.setAttribute('data-cols', String(cols));

    const blocks = state.blocks || [];
    const pageBlockIndices = getPageBlockIndices(blocks);
    const pageIndexByBlock = new Map(pageBlockIndices.map((bi, pageIdx) => [bi, pageIdx]));
    const context = { chapter: false, section: false, item: false };

    container.innerHTML = blocks.map((b, blockIdx) => {
        const selected = blockIdx === state.activeBlockIdx;
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
        } else if (b?.kind === 'page') {
            depth = context.item ? 3 : (context.section ? 2 : (context.chapter ? 1 : 0));
        } else {
            depth = 0;
        }

        if (b?.kind === 'page') {
            const pageIdx = pageIndexByBlock.get(blockIdx) ?? 0;
            const s = state.sections[pageIdx] || createDefaultSection();
            const dataAttrs = `data-block-index="${blockIdx}" data-section-index="${pageIdx}" data-tree-depth="${depth}"`;
            const dragHandlers = `
                ondragstart="startThumbDrag(event, ${pageIdx})"
                ondragover="onThumbDragOver(event, ${pageIdx})"
                ondragleave="onThumbDragLeave(event, ${pageIdx})"
                ondrop="onThumbDrop(event, ${pageIdx})"
                ondragend="endThumbDrag()"
                ontouchstart="startThumbTouchDrag(event, ${pageIdx})"
                draggable="true"
            `;

            if (s.type === 'image') {
                const pos = s.imagePosition || { x: 0, y: 0, scale: 1 };
                const tx = (pos.x / 360) * 100;
                const ty = (pos.y / 640) * 100;
                const rot = Number.isFinite(Number(pos.rotation)) ? Number(pos.rotation) : 0;
                const style = `transform: translate(${tx}%, ${ty}%) scale(${pos.scale}) rotate(${rot}deg); transform-origin: center center; width:100%; height:100%; object-fit:cover;`;
                return `
                    <div class="thumb-wrap thumb-card ${selected ? 'active' : ''}" ${dataAttrs}
                        onclick="changeBlock(${blockIdx})"
                        ${dragHandlers}
                        aria-current="${selected ? 'true' : 'false'}">
                        <div class="thumb-canvas">
                            <img class="thumb-canvas-image" src="${getOptimizedImageUrl(s.background)}" style="${style}">
                        </div>
                        <div class="thumb-card-top">
                            <span class="thumb-card-badge">Image #${pageIdx + 1}</span>
                            <span class="thumb-card-depth">L${depth}</span>
                        </div>
                        <button class="thumb-insert-btn before" title="ここにページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx}, event)">＋</button>
                        <button class="thumb-insert-btn after" title="この下にページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx + 1}, event)">＋</button>
                        <button class="thumb-duplicate-btn" title="ページを複製" ontouchstart="event.stopPropagation()" onclick="duplicateSectionByIndex(${pageIdx}, event)">⧉</button>
                    </div>
                `;
            }

            const textLabel = truncateText(s.texts?.[state.activeLang] || s.text || '', 96) || 'テキストページ';
            return `
                <div class="thumb-wrap thumb-card ${selected ? 'active' : ''}" ${dataAttrs}
                    onclick="changeBlock(${blockIdx})"
                    ${dragHandlers}
                    aria-current="${selected ? 'true' : 'false'}">
                    <div class="thumb-canvas thumb-canvas-meta">
                        <div class="thumb-card-meta">
                            <span class="thumb-card-badge">Text #${pageIdx + 1}</span>
                            <span class="thumb-card-title">${escapeHtml(textLabel)}</span>
                        </div>
                    </div>
                    <div class="thumb-card-top">
                        <span class="thumb-card-depth">L${depth}</span>
                    </div>
                    <button class="thumb-insert-btn before" title="ここにページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx}, event)">＋</button>
                    <button class="thumb-insert-btn after" title="この下にページ挿入" ontouchstart="event.stopPropagation()" onclick="insertSectionAtIndex(${pageIdx + 1}, event)">＋</button>
                    <button class="thumb-duplicate-btn" title="ページを複製" ontouchstart="event.stopPropagation()" onclick="duplicateSectionByIndex(${pageIdx}, event)">⧉</button>
                </div>
            `;
        }

        const info = getBlockSummary(b);
        const canInsertBefore = canInsertNearBlock(b, 'before');
        const canInsertAfter = canInsertNearBlock(b, 'after');
        const canMove = canManualMoveBlock(b);
        const canMoveUp = canMove && findMovableTargetIndex(blocks, blockIdx, 'up') >= 0;
        const canMoveDown = canMove && findMovableTargetIndex(blocks, blockIdx, 'down') >= 0;
        const coverLock = isLockedBlock(b)
            ? `<span class="thumb-card-lock" title="位置固定">LOCK</span>`
            : '';
        return `
            <div class="thumb-wrap thumb-card ${selected ? 'active' : ''}" data-block-index="${blockIdx}" data-tree-depth="${depth}"
                onclick="changeBlock(${blockIdx})"
                aria-current="${selected ? 'true' : 'false'}"
                draggable="false">
                <div class="thumb-canvas thumb-canvas-meta thumb-canvas-structure kind-${escapeHtml(b?.kind || 'unknown')}">
                    <div class="thumb-card-meta">
                        <span class="thumb-card-badge">${escapeHtml(info.badge)}</span>
                        <span class="thumb-card-title">${escapeHtml(info.title || '')}</span>
                        ${info.subtitle ? `<span class="thumb-card-subtitle">${escapeHtml(info.subtitle)}</span>` : ''}
                    </div>
                </div>
                <div class="thumb-card-top">
                    ${coverLock}
                    <span class="thumb-card-depth">L${depth}</span>
                </div>
                ${canInsertBefore ? `<button class="thumb-insert-btn before" title="ここにページ挿入" ontouchstart="event.stopPropagation()" onclick="insertPageNearBlock(${blockIdx}, 'before', event)">＋</button>` : ''}
                ${canInsertAfter ? `<button class="thumb-insert-btn after" title="この下にページ挿入" ontouchstart="event.stopPropagation()" onclick="insertPageNearBlock(${blockIdx}, 'after', event)">＋</button>` : ''}
                ${canMoveUp ? `<button class="thumb-move-btn up" title="上へ移動" ontouchstart="event.stopPropagation()" onclick="moveBlockByIndex(${blockIdx}, 'up', event)">↑</button>` : ''}
                ${canMoveDown ? `<button class="thumb-move-btn down" title="下へ移動" ontouchstart="event.stopPropagation()" onclick="moveBlockByIndex(${blockIdx}, 'down', event)">↓</button>` : ''}
                ${!isLockedBlock(b)
                ? `<button class="thumb-duplicate-btn" title="ブロックを複製" ontouchstart="event.stopPropagation()" onclick="duplicateBlockByIndex(${blockIdx}, event)">⧉</button>`
                : ''}
            </div>
        `;
    }).join('');

    // Keep sidebar position stable while typing/editing.
    if (container) {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.max(0, Math.min(prevScrollTop, maxScroll));
    }
}

/**
 * アクティブな要素（吹き出し or セクション/ブロック）を削除する
 * @param {function} refresh - 画面更新コールバック
 */
export function deleteActive(refresh) {
    const activeBlock = (state.blocks || [])[state.activeBlockIdx];
    if (state.activeBubbleIdx !== null) {
        const newSections = [...state.sections];
        newSections[state.activeIdx].bubbles.splice(state.activeBubbleIdx, 1);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
        dispatch({ type: actionTypes.SET_ACTIVE_BUBBLE_INDEX, payload: null });
        refresh();
        return;
    }

    if (activeBlock && activeBlock.kind !== 'page') {
        if (isLockedBlock(activeBlock)) {
            refresh();
            return;
        }
        const newBlocks = [...state.blocks];
        newBlocks.splice(state.activeBlockIdx, 1);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'blocks', value: newBlocks } });
        dispatch({ type: actionTypes.SET_ACTIVE_BLOCK_INDEX, payload: Math.max(0, state.activeBlockIdx - 1) });
        syncModelsFromLegacy();
        refresh();
        return;
    }

    if (state.sections.length > 1) {
        const newSections = [...state.sections];
        newSections.splice(state.activeIdx, 1);
        dispatch({ type: actionTypes.SET_STATE_FIELD, payload: { key: 'sections', value: newSections } });
        dispatch({ type: actionTypes.SET_ACTIVE_INDEX, payload: Math.max(0, state.activeIdx - 1) });
    }
    syncModelsFromLegacy();
    refresh();
}
