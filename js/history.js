/**
 * history.js — Undo/Redo 履歴管理
 * sections/blocks の deep copy スナップショットをスタックで管理する
 */
import { canEditSharedStudio, assertSharedStudioEdit } from './shared-studio-access.js';
import { state, subscribeProjectSession } from './state.js';
import { describeHistoryChange } from './history-details.js';

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];
let activeHistoryGroup = null;
let sequence = 0;
let revision = 0;
const listeners = new Set();
let notificationQueued = false;
function notifyHistory() {
    revision++;
    if (notificationQueued) return;
    notificationQueued = true;
    queueMicrotask(() => { notificationQueued = false; for (const fn of listeners) fn(); });
}
export function subscribeHistory(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function clone(value, fallback) {
    return JSON.parse(JSON.stringify(value ?? fallback));
}

export function createHistorySnapshot(source = state, options = {}) {
    return {
        version: source.version,
        projectAssets: clone(source.projectAssets, []),
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
    state.projectAssets = snapshot.projectAssets || [];
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
    assertSharedStudioEdit();
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
        notifyHistory();
        return false;
    }

    const snapshot = createHistorySnapshot(state, options);
    snapshot.historyEntry = { id: `history-${++sequence}`, timestamp: now, actor: options.actor === 'ai' ? 'ai' : 'manual' };
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    // 新しい操作をしたらredoスタックはクリア
    redoStack = [];
    activeHistoryGroup = groupKey ? { key: groupKey, lastAt: now } : null;
    notifyHistory();
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
    if (!canEditSharedStudio()) return false;
    if (undoStack.length === 0) return false;
    activeHistoryGroup = null;

    // 現在の状態をredoスタックに保存
    redoStack.push({ ...createHistorySnapshot(state, options), historyEntry: undoStack.at(-1).historyEntry });

    // undoスタックから復元
    const snapshot = undoStack.pop();
    restoreHistorySnapshot(snapshot);

    notifyHistory();
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
    if (!canEditSharedStudio()) return false;
    if (redoStack.length === 0) return false;
    activeHistoryGroup = null;

    // 現在の状態をundoスタックに保存
    undoStack.push({ ...createHistorySnapshot(state, options), historyEntry: redoStack.at(-1).historyEntry });

    // redoスタックから復元
    const snapshot = redoStack.pop();
    restoreHistorySnapshot(snapshot);

    notifyHistory();
    refresh(snapshot.editorFocus);
    return true;
}

/**
 * 履歴のサイズを返す（UI表示用）
 */
export function getHistoryInfo() {
    return {
        canUndo: canEditSharedStudio() && undoStack.length > 0,
        canRedo: canEditSharedStudio() && redoStack.length > 0,
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
    notifyHistory();
}

// Runtime-only inspection. Returned data is detached; snapshots never leave this module.
function transitions() {
    const current = createHistorySnapshot();
    return [
        ...undoStack.map((before, i) => ({ before, after: undoStack[i + 1] || current, entry: before.historyEntry, status: 'applied' })),
        ...[...redoStack].reverse().map((after, i, all) => ({ before: i ? all[i - 1] : current, after, entry: after.historyEntry, status: 'undone' })),
    ];
}
export function listHistoryEntries() {
    return { ...getHistoryInfo(), limit: MAX_HISTORY, persistent: false,
        nextUndoId: undoStack.at(-1)?.historyEntry.id || null, nextRedoId: redoStack.at(-1)?.historyEntry.id || null,
        entries: transitions().map(({before, after, entry, status}) => ({ ...entry, status, ...describeHistoryChange(before, after, false) })) };
}
export function readHistoryEntry(id, { includeImages = false } = {}) {
    const item = transitions().find(item => item.entry.id === id);
    return item ? { ...item.entry, status: item.status, ...describeHistoryChange(item.before, item.after, true, includeImages) } : null;
}
// Includes present data, not just stack size: catches grouped typing and edits without pushState.
export function getHistoryGuard() {
    return JSON.stringify([revision, undoStack.at(-1)?.historyEntry.id, redoStack.at(-1)?.historyEntry.id,
        state.version, state.blocks, state.sections, state.projectAssets]);
}

// A history snapshot must never cross a project boundary.
subscribeProjectSession(clearHistory);
