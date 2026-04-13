/**
 * state.js — アプリケーション共有ステート
 * 全モジュールがこのオブジェクトを参照・変更する
 */
export const state = {
    user: null,
    uid: null,
    projectId: null,
    localProjectId: null,
    projectName: '',
    title: '',               // 作品タイトル（ヘッダー表示用）
    dsfPages: [],
    languages: ['ja'],       // プロジェクトの対応言語
    defaultLang: 'ja',
    languageConfigs: {
        ja: { pageDirection: 'rtl' }
    },
    activeLang: 'ja',        // エディタで表示中の言語
    blocks: [
        {
            id: 'page_default',
            kind: 'page',
            content: {
                pageKind: 'image',
                background: 'https://picsum.photos/id/10/600/1066',
                backgrounds: {},
                bubbles: []
            }
        }
    ],
    pages: [],
    sections: [
        {
            type: 'image',
            background: 'https://picsum.photos/id/10/600/1066',
            backgrounds: {},
            bubbles: []
        }
    ],
    // Project metadata (language-independent)
    rating: 'all',
    license: 'all-rights-reserved',
    // Per-language metadata: { ja: { title, author, description, copyright }, en: { ... } }
    meta: {},

    activeIdx: 0,
    activePageIdx: 0,
    activeBlockIdx: 0,
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
    SET_TITLE: 'SET_TITLE',

    // Global UI state
    SET_ACTIVE_LANG: 'SET_ACTIVE_LANG',
    SET_ACTIVE_LANGUAGE: 'SET_ACTIVE_LANGUAGE',
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
        case actionTypes.SET_ACTIVE_LANGUAGE:
            state.activeLang = payload;
            break;

        case actionTypes.SET_TITLE:
            state.title = payload;
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

        case actionTypes.UPDATE_SECTION_TEXT: {
            const { idx, lang, text } = payload;
            const s = state.sections[idx];
            if (s) {
                state.sections[idx] = { ...s, texts: { ...s.texts, [lang]: text } };
            }
            break;
        }

        case actionTypes.SET_STATE_FIELD:
            // Generic setter for simple root-level assignments
            state[payload.key] = payload.value;
            break;

        default:
            console.warn(`[State] Unknown action type: ${type}`);
            break;
    }
}

