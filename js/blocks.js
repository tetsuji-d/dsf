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
        headings: {},
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
            ...(src.graphicObjects ? {graphicObjects:deepClone(src.graphicObjects),objectOrder:deepClone(src.objectOrder)} : {}),
            background: src.background || '',
            backgrounds: deepClone(src.backgrounds || {}),
            thumbnail: src.thumbnail || '',
            bubbles: deepClone(src.bubbles || []),
            text: src.text || '',
            texts: deepClone(src.texts || {}),
            headings: deepClone(src.headings || {}),
            textAlign: src.textAlign || 'start',
            paperPreset: src.paperPreset || '',
            backgroundColor: src.backgroundColor || '',
            textColor: src.textColor || '',
            richText: deepClone(src.richText || { blocks: [{ type: 'paragraph', children: [{ text: src.text || '' }] }] }),
            richTextLangs: deepClone(src.richTextLangs || {}),
            layout: deepClone(src.layout || {}),
            imagePosition: deepClone(src.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imageBasePosition: deepClone(src.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imagePositions: deepClone(src.imagePositions || {}),
            spreadImage: deepClone(src.spreadImage || null)
        }
    };
}

export function createSectionFromPageBlock(block) {
    const c = block?.content || {};
    return {
        type: c.pageKind === 'text' ? 'text' : 'image',
        ...(c.graphicObjects ? {graphicObjects:deepClone(c.graphicObjects),objectOrder:deepClone(c.objectOrder)} : {}),
        background: c.background || '',
        backgrounds: deepClone(c.backgrounds || {}),
        thumbnail: c.thumbnail || '',
        writingMode: 'horizontal-tb',
        bubbles: deepClone(c.bubbles || []),
        text: c.text || '',
        texts: deepClone(c.texts || {}),
        headings: deepClone(c.headings || {}),
        textAlign: c.textAlign || 'start',
        paperPreset: c.paperPreset || '',
        backgroundColor: c.backgroundColor || '',
        textColor: c.textColor || '',
        richText: deepClone(c.richText || { blocks: [{ type: 'paragraph', children: [{ text: c.text || '' }] }] }),
        richTextLangs: deepClone(c.richTextLangs || {}),
        layout: deepClone(c.layout || {}),
        imagePosition: deepClone(c.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imageBasePosition: deepClone(c.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imagePositions: deepClone(c.imagePositions || {}),
        spreadImage: deepClone(c.spreadImage || null)
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

export function syncBlocksWithSections(existingBlocks, sections, _languages = ['ja'], options = {}) {
    const sourceBlocks = Array.isArray(existingBlocks) ? deepClone(existingBlocks) : [];
    const hasFlowGroup = sourceBlocks.some((block) => block?.kind === 'flow');
    const strictSpine = options.strictSpine === true || hasFlowGroup;
    const blocks = strictSpine ? sourceBlocks : ensureBoundaryBlocks(sourceBlocks);
    const srcSections = strictSpine
        ? (Array.isArray(sections) ? deepClone(sections) : [])
        : (Array.isArray(sections) && sections.length ? deepClone(sections) : [createDefaultSection()]);
    const fixedPageCount = blocks.filter((block) => block?.kind === 'page').length;

    // A mixed spine cannot infer whether an added/removed legacy Section belongs
    // before or after a Flow group. Stop instead of silently moving authoring data.
    if (strictSpine && fixedPageCount !== srcSections.length) {
        const error = new Error('Fixed page count and Section compatibility count differ in a mixed Project v6 spine.');
        error.name = 'MixedAuthoringSyncError';
        error.code = 'MIXED_SPINE_FIXED_PAGE_COUNT_MISMATCH';
        error.fixedPageCount = fixedPageCount;
        error.sectionCount = srcSections.length;
        throw error;
    }
    let sectionIdx = 0;

    const synced = [];
    for (const block of blocks) {
        if (!block) {
            if (strictSpine) synced.push(block);
            continue;
        }
        if (block.kind === 'page') {
            if (sectionIdx < srcSections.length) {
                const nextPage = createPageBlockFromSection(srcSections[sectionIdx]);
                if (strictSpine) nextPage.id = block.id;
                else nextPage.id = block.id || nextPage.id;
                // Fixed blocks are opaque in Project v6. Preserve extension fields
                // (for example graphic layers) while updating known Section fields.
                const mergedPage = {
                    ...deepClone(block),
                    ...nextPage,
                    content: {
                        ...deepClone(block.content || {}),
                        ...nextPage.content,
                    },
                };
                synced.push(mergedPage);
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

    return strictSpine ? synced : ensurePageBlocks(synced);
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
