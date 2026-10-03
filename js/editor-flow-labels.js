/** UI labels only; never translates or changes manuscript content. */
export function formatFlowPageStatus({ index, count, pageLabel, sourceLanguage = '', mapping = '' }, language) {
    const en = language === 'en';
    const source = sourceLanguage ? (en ? ` / Original ${sourceLanguage.toUpperCase()}` : ` / 原文 ${sourceLanguage.toUpperCase()}`) : '';
    const messages = en ? { editing: ' · Editing directly', editable: ' · Click text to edit', source: ' · Click text to open source' }
        : { editing: '・直接編集中', editable: '・本文クリックで直接編集', source: '・本文クリックで原稿位置へ' };
    return en ? `Flow manuscript ${index + 1} / ${count} (Work page ${pageLabel}${source}${messages[mapping] || ''})`
        : `Flow原稿 ${index + 1} / ${count}（作品内 ${pageLabel}ページ${source}${messages[mapping] || ''}）`;
}
