/**
 * blocks.js — v3 block model helpers and compatibility adapters.
 */

export const BLOCK_SCHEMA_VERSION = 3;

import { deepClone, createId } from './utils.js';

function createDefaultSection() {
    return {
        type: 'image',
        background: 'https://picsum.photos/id/10/600/1066',
        writingMode: 'horizontal-tb',
        bubbles: [],
        text: '',
        texts: {},
        imagePosition: { x: 0, y: 0, scale: 1, rotation: 0 },
        imageBasePosition: { x: 0, y: 0, scale: 1, rotation: 0 }
    };
}

export function createCoverFrontBlock(languages = ['ja']) {
    return {
        id: createId('cover_front'),
        kind: 'cover_front',
        meta: {
            title: {},
            author: {},
            langs: Array.isArray(languages) && languages.length ? [...languages] : ['ja']
        }
    };
}

export function createCoverBackBlock() {
    return {
        id: createId('cover_back'),
        kind: 'cover_back',
        meta: {
            colophon: {}
        }
    };
}

export function createStructureBlock(kind) {
    if (kind === 'chapter' || kind === 'section' || kind === 'item') {
        return {
            id: createId(kind),
            kind,
            meta: { title: {} }
        };
    }
    if (kind === 'item_end') {
        return {
            id: createId(kind),
            kind
        };
    }
    if (kind === 'toc') {
        return {
            id: createId(kind),
            kind,
            meta: { title: {} }
        };
    }
    return null;
}

export function createPageBlockFromSection(section) {
    const src = section || createDefaultSection();
    return {
        id: createId('page'),
        kind: 'page',
        content: {
            pageKind: src.type === 'text' ? 'text' : 'image',
            background: src.background || '',
            backgrounds: deepClone(src.backgrounds || {}),
            thumbnail: src.thumbnail || '',
            bubbles: deepClone(src.bubbles || []),
            text: src.text || '',
            texts: deepClone(src.texts || {}),
            richText: deepClone(src.richText || { blocks: [{ type: 'paragraph', children: [{ text: src.text || '' }] }] }),
            richTextLangs: deepClone(src.richTextLangs || {}),
            layout: deepClone(src.layout || {}),
            imagePosition: deepClone(src.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imageBasePosition: deepClone(src.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 })
        }
    };
}

export function createSectionFromPageBlock(block) {
    const c = block?.content || {};
    return {
        type: c.pageKind === 'text' ? 'text' : 'image',
        background: c.background || '',
        backgrounds: deepClone(c.backgrounds || {}),
        thumbnail: c.thumbnail || '',
        writingMode: 'horizontal-tb',
        bubbles: deepClone(c.bubbles || []),
        text: c.text || '',
        texts: deepClone(c.texts || {}),
        richText: deepClone(c.richText || { blocks: [{ type: 'paragraph', children: [{ text: c.text || '' }] }] }),
        richTextLangs: deepClone(c.richTextLangs || {}),
        layout: deepClone(c.layout || {}),
        imagePosition: deepClone(c.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imageBasePosition: deepClone(c.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 })
    };
}

export function ensureBoundaryBlocks(blocks, _languages = ['ja']) {
    const inBlocks = Array.isArray(blocks) ? deepClone(blocks) : [];
    // Gen3: no cover_front/cover_back — return page blocks only
    return inBlocks.filter((b) => b && b.kind !== 'cover_front' && b.kind !== 'cover_back');
}

export function ensurePageBlocks(blocks) {
    const hasPage = (blocks || []).some((b) => b?.kind === 'page');
    if (hasPage) return blocks;
    const out = [...(blocks || [])];
    const coverBackIdx = Math.max(0, out.length - 1);
    out.splice(coverBackIdx, 0, createPageBlockFromSection(createDefaultSection()));
    return out;
}

export function extractSectionsFromBlocks(blocks) {
    const pages = (Array.isArray(blocks) ? blocks : []).filter((b) => b?.kind === 'page');
    if (!pages.length) return [createDefaultSection()];
    return pages.map(createSectionFromPageBlock);
}

export function getPageBlockIndices(blocks) {
    const out = [];
    const list = Array.isArray(blocks) ? blocks : [];
    for (let i = 0; i < list.length; i += 1) {
        if (list[i]?.kind === 'page') out.push(i);
    }
    return out;
}

export function getBlockIndexFromPageIndex(blocks, pageIndex) {
    const indices = getPageBlockIndices(blocks);
    const idx = Number(pageIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= indices.length) return -1;
    return indices[idx];
}

export function getPageIndexFromBlockIndex(blocks, blockIndex) {
    const bi = Number(blockIndex);
    if (!Number.isInteger(bi) || bi < 0) return -1;
    const indices = getPageBlockIndices(blocks);
    return indices.indexOf(bi);
}

export function migrateSectionsToBlocks(sections, _languages = ['ja']) {
    const src = Array.isArray(sections) && sections.length ? sections : [createDefaultSection()];
    return src.map(createPageBlockFromSection);
}

export function syncBlocksWithSections(existingBlocks, sections, _languages = ['ja']) {
    const blocks = ensureBoundaryBlocks(existingBlocks);
    const srcSections = Array.isArray(sections) && sections.length ? sections : [createDefaultSection()];
    let sectionIdx = 0;

    const synced = [];
    for (const block of blocks) {
        if (!block) continue;
        if (block.kind === 'page') {
            if (sectionIdx < srcSections.length) {
                const nextPage = createPageBlockFromSection(srcSections[sectionIdx]);
                nextPage.id = block.id || nextPage.id;
                synced.push(nextPage);
                sectionIdx += 1;
            }
            continue;
        }
        synced.push(block);
    }

    if (sectionIdx < srcSections.length) {
        const tail = srcSections.slice(sectionIdx).map(createPageBlockFromSection);
        synced.push(...tail);
    }

    return ensurePageBlocks(synced);
}

export function normalizeProjectData(data = {}) {
    const languages = Array.isArray(data.languages) && data.languages.length ? data.languages : ['ja'];
    let blocks = [];

    if (Array.isArray(data.blocks) && data.blocks.length) {
        blocks = ensurePageBlocks(ensureBoundaryBlocks(data.blocks, languages));
    } else {
        blocks = migrateSectionsToBlocks(data.sections || [], languages);
    }

    const sections = extractSectionsFromBlocks(blocks);
    return {
        ...data,
        version: Math.max(Number(data.version) || 0, BLOCK_SCHEMA_VERSION),
        languages,
        blocks,
        sections
    };
}
