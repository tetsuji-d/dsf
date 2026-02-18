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
    activeBlockIdx: 1,
    activeBubbleIdx: null,
    thumbColumns: 2,
    uiPrefs: {
        desktop: { thumbColumns: 2 },
        mobile: { thumbColumns: 2 }
    }
};
