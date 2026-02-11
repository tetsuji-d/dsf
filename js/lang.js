/**
 * lang.js — 言語プロパティレジストリ
 * 各言語の表示ルール（揃え方・書字方向）を定義する
 */

const LANGS = {
    ja: {
        label: '日本語',
        align: 'left',           // バブル内テキスト揃え
        sectionAlign: 'left',    // テキストセクション揃え
        wordBreak: 'break-all',  // 文字単位で折り返し
        writingModes: ['horizontal-tb', 'vertical-rl'],
        defaultWritingMode: 'vertical-rl'
    },
    en: {
        label: 'English',
        align: 'center',         // バブル内テキスト揃え
        sectionAlign: 'left',    // テキストセクション揃え
        wordBreak: 'normal',     // 単語単位で折り返し
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb'
    }
};

/**
 * 言語プロパティを取得する
 * @param {string} code - 言語コード (ja, en, ...)
 * @returns {object} 言語プロパティ
 */
export function getLangProps(code) {
    return LANGS[code] || LANGS['ja'];
}

/**
 * 利用可能な全言語のリストを返す
 * @returns {{ code: string, label: string }[]}
 */
export function getAllLangs() {
    return Object.entries(LANGS).map(([code, props]) => ({ code, label: props.label }));
}
