/**
 * history.js — Undo/Redo 履歴管理
 * sections の deep copy スナップショットをスタックで管理する
 */
import { state } from './state.js';

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];

/**
 * 現在の状態をundoスタックに保存する（変更前に呼ぶ）
 */
export function pushState() {
    const snapshot = {
        sections: JSON.parse(JSON.stringify(state.sections)),
        activeIdx: state.activeIdx,
        activeBubbleIdx: state.activeBubbleIdx
    };
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
    redoStack.push({
        sections: JSON.parse(JSON.stringify(state.sections)),
        activeIdx: state.activeIdx,
        activeBubbleIdx: state.activeBubbleIdx
    });

    // undoスタックから復元
    const snapshot = undoStack.pop();
    state.sections = snapshot.sections;
    state.activeIdx = snapshot.activeIdx;
    state.activeBubbleIdx = snapshot.activeBubbleIdx;

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
    undoStack.push({
        sections: JSON.parse(JSON.stringify(state.sections)),
        activeIdx: state.activeIdx,
        activeBubbleIdx: state.activeBubbleIdx
    });

    // redoスタックから復元
    const snapshot = redoStack.pop();
    state.sections = snapshot.sections;
    state.activeIdx = snapshot.activeIdx;
    state.activeBubbleIdx = snapshot.activeBubbleIdx;

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
