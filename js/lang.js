/**
 * lang.js — 言語プロパティレジストリ
 *
 * directions: サポートするページ送り方向
 *   複数ある場合、追加時・チップ内で選択可能
 *   label が null の場合は方向名を表示しない（1択）
 *
 * placeholders: Project Settings の基本情報テーブル用サンプルテキスト
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
        ],
        placeholders: {
            title:       '例: 我が家のヒーロー',
            author:      '例: 山田 太郎',
            description: '作品の概要...',
            copyright:   '© 2025 山田 太郎'
        }
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
        ],
        placeholders: {
            title:       'e.g. My Hero Next Door',
            author:      'e.g. John Smith',
            description: 'Story overview...',
            copyright:   '© 2025 John Smith'
        }
    },
    'zh-cn': {
        label: '简体中文',
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'break-all',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [
            { value: 'ltr', label: null }
        ],
        placeholders: {
            title:       '例如: 我家的英雄',
            author:      '例如: 张 三',
            description: '作品简介...',
            copyright:   '© 2025 张 三'
        }
    },
    'zh-tw': {
        label: '繁體中文',
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'break-all',
        writingModes: ['horizontal-tb', 'vertical-rl'],
        defaultWritingMode: 'vertical-rl',
        directions: [
            { value: 'rtl', label: '縱排' },
            { value: 'ltr', label: '橫排' }
        ],
        placeholders: {
            title:       '例如: 我家的英雄',
            author:      '例如: 張 三',
            description: '作品概要...',
            copyright:   '© 2025 張 三'
        }
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
        ],
        placeholders: {
            title:       '예: 우리 집 영웅',
            author:      '예: 홍길동',
            description: '작품 개요...',
            copyright:   '© 2025 홍길동'
        }
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
        ],
        placeholders: {
            title:       'Ex: Mon héros d\'à côté',
            author:      'Ex: Jean Dupont',
            description: 'Résumé de l\'œuvre...',
            copyright:   '© 2025 Jean Dupont'
        }
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
        ],
        placeholders: {
            title:       'Ej: Mi héroe vecino',
            author:      'Ej: Juan García',
            description: 'Resumen de la obra...',
            copyright:   '© 2025 Juan García'
        }
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
        ],
        placeholders: {
            title:       'Z.B. Mein Held nebenan',
            author:      'Z.B. Max Mustermann',
            description: 'Zusammenfassung...',
            copyright:   '© 2025 Max Mustermann'
        }
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
        ],
        placeholders: {
            title:       'Ex: Meu herói vizinho',
            author:      'Ex: João Silva',
            description: 'Resumo da obra...',
            copyright:   '© 2025 João Silva'
        }
    }
};

/**
 * 言語プロパティを取得する
 * 未登録コードはコードをラベルにした汎用プロパティを返す
 */
export function getLangProps(code) {
    return LANGS[code] || {
        label: code.toUpperCase(),
        align: 'left',
        sectionAlign: 'left',
        wordBreak: 'normal',
        writingModes: ['horizontal-tb'],
        defaultWritingMode: 'horizontal-tb',
        directions: [{ value: 'ltr', label: null }],
        placeholders: { title: '', author: '', description: '', copyright: '' }
    };
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
