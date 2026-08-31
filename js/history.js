/**
 * history.js — Undo/Redo 履歴管理
 * sections/blocks の deep copy スナップショットをスタックで管理する
 */
import { state } from './state.js';

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let activeHistoryGroup = null;

function clone(value, fallback) {
    return JSON.parse(JSON.stringify(value ?? fallback));
}

export function createHistorySnapshot(source = state, options = {}) {
    return {
        version: source.version,
        blocks: clone(source.blocks, []),
        sections: clone(source.sections, []),
        pages: clone(source.pages, []),
        activeIdx: source.activeIdx,
        activePageIdx: source.activePageIdx,
        activeBlockIdx: source.activeBlockIdx,
        activeBubbleIdx: source.activeBubbleIdx,
        // Optional editor focus belongs to the runtime history, never the saved project.
        ...(options.editorFocus !== undefined ? { editorFocus: clone(options.editorFocus, null) } : {}),
    };
}

function restoreHistorySnapshot(snapshot) {
    if (Number.isInteger(snapshot.version)) state.version = snapshot.version;
    state.blocks = snapshot.blocks || state.blocks || [];
    state.sections = snapshot.sections || [];
    state.pages = snapshot.pages || [];
    state.activeIdx = snapshot.activeIdx;
    state.activePageIdx = Number.isInteger(snapshot.activePageIdx) ? snapshot.activePageIdx : snapshot.activeIdx;
    state.activeBlockIdx = Number.isInteger(snapshot.activeBlockIdx) ? snapshot.activeBlockIdx : state.activeBlockIdx;
    state.activeBubbleIdx = snapshot.activeBubbleIdx;
}

/**
 * 現在の状態をundoスタックに保存する（変更前に呼ぶ）
 */
export function pushState(options = {}) {
    const groupKey = typeof options.groupKey === 'string' && options.groupKey
        ? options.groupKey
        : '';
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const mergeWindowMs = Number.isFinite(options.mergeWindowMs)
        ? Math.max(0, options.mergeWindowMs)
        : 900;
    if (
        groupKey
        && activeHistoryGroup?.key === groupKey
        && now - activeHistoryGroup.lastAt <= mergeWindowMs
    ) {
        activeHistoryGroup.lastAt = now;
        return false;
    }

    const snapshot = createHistorySnapshot(state, options);
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    // 新しい操作をしたらredoスタックはクリア
    redoStack = [];
    activeHistoryGroup = groupKey ? { key: groupKey, lastAt: now } : null;
    return true;
}

/** End a grouped typing session (blur, cursor change, structural edit, etc.). */
export function endHistoryGroup(groupKey = '') {
    if (!activeHistoryGroup) return;
    if (!groupKey || activeHistoryGroup.key === groupKey) activeHistoryGroup = null;
}

/**
 * Undo — 前の状態に戻す
 * @param {function} refresh - 画面更新コールバック（保存済みeditorFocusを受け取る）
 * @param {object} options - 現在のeditorFocusを渡すと、Redo時に復元できる
 * @returns {boolean} undoが実行されたか
 */
export function undo(refresh, options = {}) {
    if (undoStack.length === 0) return false;
    activeHistoryGroup = null;

    // 現在の状態をredoスタックに保存
    redoStack.push(createHistorySnapshot(state, options));

    // undoスタックから復元
    const snapshot = undoStack.pop();
    restoreHistorySnapshot(snapshot);

    refresh(snapshot.editorFocus);
    return true;
}

/**
 * Redo — undoした操作をやり直す
 * @param {function} refresh - 画面更新コールバック（保存済みeditorFocusを受け取る）
 * @param {object} options - 現在のeditorFocusを渡すと、Undo時に復元できる
 * @returns {boolean} redoが実行されたか
 */
export function redo(refresh, options = {}) {
    if (redoStack.length === 0) return false;
    activeHistoryGroup = null;

    // 現在の状態をundoスタックに保存
    undoStack.push(createHistorySnapshot(state, options));

    // redoスタックから復元
    const snapshot = redoStack.pop();
    restoreHistorySnapshot(snapshot);

    refresh(snapshot.editorFocus);
    return true;
}

/**
 * 履歴のサイズを返す（UI表示用）
 */
export function getHistoryInfo() {
    return {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoCount: undoStack.length,
        redoCount: redoStack.length
    };
}

/**
 * 履歴をクリアする（プロジェクト読み込み時などに使用）
 */
export function clearHistory() {
    undoStack = [];
    redoStack = [];
    activeHistoryGroup = null;
}
