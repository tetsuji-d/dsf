/**
 * utils.js — 共通ユーティリティ関数
 * blocks.js / pages.js / sections.js から共通で使用する純粋関数。
 * DOM・state・Firebase に依存しない。
 */

/**
 * 値のディープクローンを返す。
 * structuredClone が使える環境では使用し、そうでなければ JSON ラウンドトリップにフォールバック。
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * プレフィックス付きのユニーク ID を生成する。
 * 例: createId('page') → "page_lbmqz4_a3f7k2"
 * @param {string} prefix
 * @returns {string}
 */
export function createId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
