/**
 * state.js — アプリケーション共有ステート
 * 全モジュールがこのオブジェクトを参照・変更する
 */
export const state = {
    projectId: null,
    title: '',               // 作品タイトル（ヘッダー表示用）
    languages: ['ja'],       // プロジェクトの対応言語
    languageConfigs: {
        ja: { writingMode: 'vertical-rl' }
    },
    activeLang: 'ja',        // エディタで表示中の言語
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
    activeBubbleIdx: null,
    thumbSize: 'M'
};
