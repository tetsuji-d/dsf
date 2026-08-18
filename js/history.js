/**
 * history.js — Undo/Redo 履歴管理
 * sections/blocks の deep copy スナップショットをスタックで管理する
 */
import { state } from './state.js';

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];

function clone(value, fallback) {
    return JSON.parse(JSON.stringify(value ?? fallback));
}

export function createHistorySnapshot(source = state) {
    return {
        version: source.version,
        blocks: clone(source.blocks, []),
        sections: clone(source.sections, []),
        pages: clone(source.pages, []),
        activeIdx: source.activeIdx,
        activePageIdx: source.activePageIdx,
        activeBlockIdx: source.activeBlockIdx,
        activeBubbleIdx: source.activeBubbleIdx
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
export function pushState() {
    const snapshot = createHistorySnapshot(state);
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    // 新しい操作をしたらredoスタックはクリア
    redoStack = [];
}

/**
 * Undo — 前の状態に戻す
 * @param {function} refresh - 画面更新コールバック
 * @returns {boolean} undoが実行されたか
 */
export function undo(refresh) {
    if (undoStack.length === 0) return false;

    // 現在の状態をredoスタックに保存
    redoStack.push(createHistorySnapshot(state));

    // undoスタックから復元
    const snapshot = undoStack.pop();
    restoreHistorySnapshot(snapshot);

    refresh();
    return true;
}

/**
 * Redo — undoした操作をやり直す
 * @param {function} refresh - 画面更新コールバック
 * @returns {boolean} redoが実行されたか
 */
export function redo(refresh) {
    if (redoStack.length === 0) return false;

    // 現在の状態をundoスタックに保存
    undoStack.push(createHistorySnapshot(state));

    // redoスタックから復元
    const snapshot = redoStack.pop();
    restoreHistorySnapshot(snapshot);

    refresh();
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
}
