/**
 * state.js — アプリケーション共有ステート
 * 全モジュールがこのオブジェクトを参照・変更する
 */
export const state = {
    user: null,
    uid: null,
    projectId: null,
    title: '',               // 作品タイトル（ヘッダー表示用）
    languages: ['ja'],       // プロジェクトの対応言語
    defaultLang: 'ja',
    languageConfigs: {
        ja: { writingMode: 'vertical-rl', fontPreset: 'gothic' }
    },
    activeLang: 'ja',        // エディタで表示中の言語
    blocks: [
        {
            id: 'cover_front_default',
            kind: 'cover_front',
            meta: { title: {}, author: {}, langs: ['ja'] }
        },
        {
            id: 'page_default',
            kind: 'page',
            content: {
                pageKind: 'image',
                background: 'https://picsum.photos/id/10/600/1066',
                bubbles: [],
                text: '',
                texts: {}
            }
        },
        {
            id: 'cover_back_default',
            kind: 'cover_back',
            meta: { colophon: {} }
        }
    ],
    pages: [],
    sections: [
        {
            type: 'image',
            background: 'https://picsum.photos/id/10/600/1066',
            writingMode: 'horizontal-tb',
            bubbles: [],
            text: '',
            texts: {}        // { ja: "...", en: "..." }
        }
    ],
    activeIdx: 0,
    activePageIdx: 0,
    activeBlockIdx: 1,
    activeBubbleIdx: null,
    thumbColumns: 2,
    uiPrefs: {
        desktop: { thumbColumns: 2 },
        mobile: { thumbColumns: 2 }
    }
};

/**
 * Action Types
 */
export const actionTypes = {
    // Project loading
    LOAD_PROJECT: 'LOAD_PROJECT',
    SET_AUTH_STATE: 'SET_AUTH_STATE',

    // Global UI state
    SET_ACTIVE_LANG: 'SET_ACTIVE_LANG',
    SET_ACTIVE_INDEX: 'SET_ACTIVE_INDEX',
    SET_ACTIVE_BLOCK_INDEX: 'SET_ACTIVE_BLOCK_INDEX',
    SET_ACTIVE_BUBBLE_INDEX: 'SET_ACTIVE_BUBBLE_INDEX',
    SET_THUMB_COLUMNS: 'SET_THUMB_COLUMNS',

    // Content operations
    UPDATE_SECTION_TEXT: 'UPDATE_SECTION_TEXT',
    UPDATE_BLOCK_TEXT: 'UPDATE_BLOCK_TEXT',
    UPDATE_BUBBLE_TEXT: 'UPDATE_BUBBLE_TEXT',
    UPDATE_BUBBLE_POS: 'UPDATE_BUBBLE_POS',
    ADD_BUBBLE: 'ADD_BUBBLE',
    DELETE_ACTIVE_ITEM: 'DELETE_ACTIVE_ITEM',

    // Fallback manual mutation setter (use sparingly)
    SET_STATE_FIELD: 'SET_STATE_FIELD'
};

/**
 * Dispatch function to handle state mutations centrally
 */
export function dispatch(action) {
    const { type, payload } = action;

    switch (type) {
        case actionTypes.LOAD_PROJECT:
            Object.assign(state, payload);
            break;

        case actionTypes.SET_AUTH_STATE:
            state.user = payload.user;
            state.uid = payload.uid;
            break;

        case actionTypes.SET_ACTIVE_LANG:
            state.activeLang = payload;
            break;

        case actionTypes.SET_ACTIVE_INDEX:
            state.activeIdx = payload;
            state.activePageIdx = payload;
            break;

        case actionTypes.SET_ACTIVE_BLOCK_INDEX:
            state.activeBlockIdx = payload;
            break;

        case actionTypes.SET_ACTIVE_BUBBLE_INDEX:
            state.activeBubbleIdx = payload;
            break;

        case actionTypes.SET_THUMB_COLUMNS:
            state.thumbColumns = payload.columns;
            if (payload.device) {
                if (!state.uiPrefs) state.uiPrefs = { desktop: {}, mobile: {} };
                if (!state.uiPrefs[payload.device]) state.uiPrefs[payload.device] = {};
                state.uiPrefs[payload.device].thumbColumns = payload.columns;
            }
            break;

        case actionTypes.SET_STATE_FIELD:
            // Generic setter for simple root-level assignments
            state[payload.key] = payload.value;
            break;

        default:
            console.warn(`[State] Unknown action type: ${type}`);
            break;
    }
}

