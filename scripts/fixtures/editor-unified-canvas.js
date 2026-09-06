// Import from the development Studio only. Builds data; performs no save, upload or state mutation.
import { createFlowGroupBlock } from '../../js/flow-project-model.js';
import { migrateSectionsToBlocks } from '../../js/blocks.js';

export function createUnifiedCanvasFixture({ direction = 'rtl', repetitions = 25 } = {}) {
    if (!import.meta.env.DEV) throw new Error('Development fixture only');
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="640"><rect width="360" height="640" fill="#277c91"/><rect x="360" width="360" height="640" fill="#dc9e48"/><text x="70" y="320" font-size="50" fill="white">LEFT</text><text x="420" y="320" font-size="50" fill="white">RIGHT</text></svg>')}`;
    const sections = [
        { type: 'image', background: image, backgrounds: {}, bubbles: [] },
        { type: 'text', texts: { ja: '固定テキストの本文です。\nこのページの本文は固定レイアウトを維持します。' }, bubbles: [] },
        { type: 'image', background: image, backgrounds: {}, bubbles: [] },
        ...['right', 'left'].map(role => ({ type: 'image', background: image, backgrounds: {}, bubbles: [],
            spreadImage: { groupId: 'fixture-spread', role } })),
        { type: 'image', background: image, backgrounds: {}, bubbles: [] },
    ];
    const fixed = migrateSectionsToBlocks(sections, ['ja']);
    const flow = id => createFlowGroupBlock({ id, sourceLanguage: 'ja',
        writingMode: direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb', document: {
            id: `${id}-document`, sourceLanguage: 'ja', sections: [{ id: `${id}-section`, title: {}, blocks: [
                { id: `${id}-heading`, type: 'heading', level: 1, texts: { ja: `見出し ${id}` } },
                { id: `${id}-paragraph`, type: 'paragraph', texts: { ja: '海辺の道を歩きながら、波の音を聞いていました。'.repeat(repetitions) } },
            ] }],
        } });
    const blocks = [fixed[0], fixed[1], flow('flow-a'), fixed[2], ...fixed.slice(3, 5), flow('flow-b'), fixed[5]];
    return { version: 6, projectName: '統合キャンバス検証', projectId: null, uid: null,
        activeIdx: 0, activeBlockIdx: 0, activeBubbleIdx: null, blocks, sections,
        languages: ['ja'], activeLang: 'ja', defaultLang: 'ja',
        languageConfigs: { ja: { pageDirection: direction, writingMode: direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb' } },
        bookMode: 'simple', uiPrefs: { spreadView: false, languageCompareView: false } };
}
