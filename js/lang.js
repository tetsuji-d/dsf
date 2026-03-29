/**
 * lang.js — 言語プロパティレジストリ
 * 各言語の表示ルール（揃え方・書字方向）を定義する
 *
 * directions: その言語がサポートするページ送り方向の配列
 *   複数ある場合、言語追加時にユーザーが選択する
 *   { value: 'ltr'|'rtl', label: '横書き'|'縦書き'|null }
 *   label が null の場合、方向名は表示しない（1択のみ）
 */

const LANGS = {
    ja: {
        label: '日本語',
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'break-all',
        writingModes: ['horizontal-tb', 'vertical-rl'],
        defaultWritingMode: 'vertical-rl',
        directions: [
            { value: 'rtl', label: '縦書き' },
            { value: 'ltr', label: '横書き' }
        ]
    },
    en: {
        label: 'English',
        align: 'center',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    zh: {
        label: '中文',
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'break-all',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    ko: {
        label: '한국어',
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'break-all',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    fr: {
        label: 'Français',
        align: 'center',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    es: {
        label: 'Español',
        align: 'center',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    de: {
        label: 'Deutsch',
        align: 'center',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    },
    pt: {
        label: 'Português',
        align: 'center',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ]
    }
};

/**
 * 言語プロパティを取得する
 * 未登録コードは英語フォールバック（日本語ではなく）
 */
export function getLangProps(code) {
    return LANGS[code] || { label: code.toUpperCase(), align: 'left', sectionAlign: 'left',
        wordBreak: 'normal', writingModes: ['horizontal-tb'], defaultWritingMode: 'horizontal-tb',
        directions: [{ value: 'ltr', label: null }] };
}

/**
 * 利用可能な全言語のリスト（code, label, directions）を返す
 */
export function getAllLangs() {
    return Object.entries(LANGS).map(([code, props]) => ({
        code,
        label: props.label,
        directions: props.directions
    }));
}
