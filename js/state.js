/**
 * state.js — アプリケーション共有ステート
 * 全モジュールがこのオブジェクトを参照・変更する
 */
export const state = {
    projectId: null,
    sections: [
        {
            type: 'image',
            background: 'https://picsum.photos/id/10/600/1066',
            writingMode: 'horizontal-tb',
            bubbles: [],
            text: ''
        }
    ],
    activeIdx: 0,
    activeBubbleIdx: null
};
