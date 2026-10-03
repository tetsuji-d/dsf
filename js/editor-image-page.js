import { createPageBlockFromSection } from './blocks.js';
import { validateProjectAssets } from './project-assets.js';

/** Add a fixed image page at a spine boundary; never split Flow or a spread. */
export function createImagePagePlan(state, assetId, position = 'after') {
    const asset = (state.projectAssets || []).find(item => item.id === assetId);
    if (!asset || !validateProjectAssets([asset])) throw Error('INVALID_IMAGE_ASSET');
    if (!['start', 'end', 'before', 'after'].includes(position)) throw Error('INVALID_ARGUMENTS');
    const blocks = state.blocks || [];
    let index = blocks.findIndex(block => block.id === state.activeBlockId);
    if (position === 'start') index = 0;
    else if (position === 'end') index = blocks.length;
    else {
        if (index < 0) throw Error('INVALID_IMAGE_TARGET');
        const spread = blocks[index].content?.spreadImage?.groupId;
        if (spread) index = position === 'before'
            ? blocks.findIndex(block => block.content?.spreadImage?.groupId === spread)
            : blocks.findLastIndex(block => block.content?.spreadImage?.groupId === spread);
        if (position === 'after') index++;
    }
    const lang = state.languageKey;
    if (!lang || !(state.languageKeys || []).includes(lang)) throw Error('UNKNOWN_LANGUAGE');
    const page = createPageBlockFromSection({ type: 'image',
        background: state.languageKeys.length === 1 ? asset.background : '',
        backgrounds: { [lang]: asset.background }, thumbnail: asset.thumbnail,
        imagePositions: { [lang]: { x: 0, y: 0, scale: 1, rotation: 0, flipX: false } },
    });
    return { blocks: [...blocks.slice(0, index), page, ...blocks.slice(index)], activeBlockIndex: index, pageId: page.id };
}

export function imagePageSnapshot(state) {
    return JSON.stringify([state.blocks, state.projectAssets, state.activeBlockId, state.languageKey, state.languageKeys]);
}
