/**
 * pages.js - v5 page model helpers and compatibility adapters.
 */

import { deepClone, createId } from './utils.js';

const DEFAULT_BG = 'https://picsum.photos/id/10/600/1066';
export const PAGE_SCHEMA_VERSION = 5;

const ROLE_SET = new Set(['cover_front', 'cover_back', 'chapter', 'section', 'item', 'toc', 'normal']);
const BODY_KIND_SET = new Set(['image', 'text', 'theme']);

function createDefaultImageSection() {
    return {
        type: 'image',
        background: DEFAULT_BG,
        writingMode: 'horizontal-tb',
        bubbles: [],
        text: '',
        texts: {},
        layout: {},
        imagePosition: { x: 0, y: 0, scale: 1, rotation: 0 },
        imageBasePosition: { x: 0, y: 0, scale: 1, rotation: 0 }
    };
}

function createEmptyRichText() {
    return { blocks: [{ type: 'paragraph', children: [{ text: '' }] }] };
}

function normalizeLocalizedTextMap(value) {
    return value && typeof value === 'object' ? deepClone(value) : {};
}

function ensureLanguages(data) {
    return Array.isArray(data.languages) && data.languages.length ? data.languages : ['ja'];
}

function inferRoleFromLegacyPageType(pageType) {
    if (pageType === 'cover_front') return 'cover_front';
    if (pageType === 'cover_back') return 'cover_back';
    if (pageType === 'chapter') return 'chapter';
    if (pageType === 'section') return 'section';
    if (pageType === 'item') return 'item';
    if (pageType === 'toc') return 'toc';
    return 'normal';
}

function inferBodyKindFromLegacyPageType(pageType, content) {
    if (pageType === 'normal_text') return 'text';
    if (pageType === 'normal_image') return 'image';
    if (content?.theme?.templateId || content?.theme?.paletteId) return 'theme';
    if (content?.richText) return 'text';
    if (content?.text || (content?.texts && Object.keys(content.texts).length > 0)) return 'text';
    return 'image';
}

function inferPageTypeFromRoleBody(role, bodyKind) {
    if (role === 'normal') return bodyKind === 'text' ? 'normal_text' : 'normal_image';
    return role;
}

function normalizeRole(rawRole, rawPageType) {
    const role = ROLE_SET.has(rawRole) ? rawRole : inferRoleFromLegacyPageType(rawPageType);
    return ROLE_SET.has(role) ? role : 'normal';
}

function normalizeBodyKind(role, rawBodyKind, rawPageType, content) {
    let bodyKind = BODY_KIND_SET.has(rawBodyKind)
        ? rawBodyKind
        : inferBodyKindFromLegacyPageType(rawPageType, content);

    // Strict role x bodyKind rules.
    if (role === 'cover_front' || role === 'cover_back') {
        if (bodyKind !== 'image' && bodyKind !== 'theme') bodyKind = 'image';
    } else if (role === 'chapter' || role === 'section' || role === 'item') {
        if (bodyKind !== 'image' && bodyKind !== 'text') bodyKind = 'text';
    } else if (role === 'toc') {
        bodyKind = 'text';
    } else if (role === 'normal') {
        if (bodyKind !== 'image' && bodyKind !== 'text') bodyKind = 'image';
    }
    return bodyKind;
}

function normalizeContacts(contacts) {
    if (!Array.isArray(contacts)) return [];
    return contacts
        .map((c) => ({
            type: (c?.type === 'url' || c?.type === 'email' || c?.type === 'other') ? c.type : 'other',
            value: String(c?.value || '').trim(),
            label: c?.label ? String(c.label).trim() : ''
        }))
        .filter((c) => c.value);
}

function normalizeContentByBodyKind(content, bodyKind) {
    const src = content && typeof content === 'object' ? content : {};
    const out = {
        background: src.background || '',
        backgrounds: deepClone(src.backgrounds || {}),
        thumbnail: src.thumbnail || '',
        bubbles: deepClone(src.bubbles || []),
        imagePosition: deepClone(src.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imageBasePosition: deepClone(src.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imagePositions: deepClone(src.imagePositions || {}),
        theme: {
            templateId: src.theme?.templateId || '',
            paletteId: src.theme?.paletteId || ''
        },
        richText: deepClone(src.richText || createEmptyRichText()),
        richTextLangs: deepClone(src.richTextLangs || {}),
        interactions: Array.isArray(src.interactions) ? deepClone(src.interactions) : [],
        // Transitional compatibility fields.
        text: src.text || '',
        texts: deepClone(src.texts || {}),
        paperPreset: src.paperPreset || '',
        backgroundColor: src.backgroundColor || '',
        textColor: src.textColor || '',
        layout: deepClone(src.layout || {})
    };

    if (bodyKind === 'theme') {
        out.background = '';
        out.bubbles = [];
    }
    if (bodyKind === 'image') {
        out.richText = createEmptyRichText();
    }
    return out;
}

function normalizePageV5(page) {
    const p = page && typeof page === 'object' ? deepClone(page) : {};
    const role = normalizeRole(p.role, p.pageType);
    const bodyKind = normalizeBodyKind(role, p.bodyKind, p.pageType, p.content);

    const out = {
        id: p.id || createId('page'),
        role,
        bodyKind,
        // Compatibility until consumers move fully to role/bodyKind.
        pageType: inferPageTypeFromRoleBody(role, bodyKind)
    };

    out.meta = {
        title: normalizeLocalizedTextMap(p.meta?.title),
        subtitle: normalizeLocalizedTextMap(p.meta?.subtitle),
        author: normalizeLocalizedTextMap(p.meta?.author),
        supervisor: normalizeLocalizedTextMap(p.meta?.supervisor),
        publisher: normalizeLocalizedTextMap(p.meta?.publisher),
        edition: normalizeLocalizedTextMap(p.meta?.edition),
        contacts: normalizeContacts(p.meta?.contacts),
        colophon: normalizeLocalizedTextMap(p.meta?.colophon)
    };

    out.content = normalizeContentByBodyKind(p.content, bodyKind);

    // AR fields — optional, defaults to mode:'none' (backward compatible)
    const AR_MODES = new Set(['none', 'gyro', 'webxr']);
    const rawAr = p.ar && typeof p.ar === 'object' ? p.ar : {};
    out.ar = {
        mode:   AR_MODES.has(rawAr.mode) ? rawAr.mode : 'none',
        scale:  typeof rawAr.scale === 'number' && rawAr.scale > 0 ? rawAr.scale : 1.0,
        anchor: {
            x: typeof rawAr.anchor?.x === 'number' ? rawAr.anchor.x : 0,
            y: typeof rawAr.anchor?.y === 'number' ? rawAr.anchor.y : 0,
            z: typeof rawAr.anchor?.z === 'number' ? rawAr.anchor.z : -1.5
        }
    };

    return out;
}

function ensureCoverBoundaries(pages) {
    // Gen3: no cover pages — filter out any legacy cover_front/cover_back
    const list = Array.isArray(pages) ? pages.map(normalizePageV5) : [];
    return list.filter((p) => p.role !== 'cover_front' && p.role !== 'cover_back');
}

function sectionToNormalPage(section) {
    const src = section || createDefaultImageSection();
    return normalizePageV5({
        id: createId('page'),
        role: 'normal',
        bodyKind: src.type === 'text' ? 'text' : 'image',
        content: {
            background: src.background || '',
            backgrounds: deepClone(src.backgrounds || {}),
            thumbnail: src.thumbnail || '',
            bubbles: deepClone(src.bubbles || []),
            text: src.text || '',
            texts: deepClone(src.texts || {}),
            paperPreset: src.paperPreset || '',
            backgroundColor: src.backgroundColor || '',
            textColor: src.textColor || '',
            layout: deepClone(src.layout || {}),
            imagePosition: deepClone(src.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imageBasePosition: deepClone(src.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imagePositions: deepClone(src.imagePositions || {})
        },
        ar: src.ar ? deepClone(src.ar) : undefined
    });
}

function pageToSection(page) {
    const c = page?.content || {};
    const isText = page?.role === 'normal' && page?.bodyKind === 'text';
    return {
        type: isText ? 'text' : 'image',
        background: c.background || '',
        backgrounds: deepClone(c.backgrounds || {}),
        thumbnail: c.thumbnail || '',
        writingMode: 'horizontal-tb',
        bubbles: deepClone(c.bubbles || []),
        text: c.text || '',
        texts: deepClone(c.texts || {}),
        paperPreset: c.paperPreset || '',
        backgroundColor: c.backgroundColor || '',
        textColor: c.textColor || '',
        layout: deepClone(c.layout || {}),
        imagePosition: deepClone(c.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imageBasePosition: deepClone(c.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
        imagePositions: deepClone(c.imagePositions || {}),
        ...(page?.ar ? { ar: deepClone(page.ar) } : {})
    };
}

function blockToPage(block) {
    if (!block || typeof block !== 'object') return null;
    if (block.kind === 'cover_front') {
        return normalizePageV5({
            id: block.id || createId('cover_front'),
            role: 'cover_front',
            bodyKind: block.meta?.bodyKind || block.meta?.renderMode || 'image',
            meta: {
                title: block.meta?.title || {},
                subtitle: block.meta?.subtitle || {},
                author: block.meta?.author || {},
                supervisor: block.meta?.supervisor || {},
                publisher: block.meta?.publisher || {}
            },
            content: {
                background: block.content?.background || '',
                thumbnail: block.content?.thumbnail || '',
                imagePosition: deepClone(block.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(block.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                theme: block.content?.theme || block.meta?.theme || {}
            }
        });
    }
    if (block.kind === 'cover_back') {
        return normalizePageV5({
            id: block.id || createId('cover_back'),
            role: 'cover_back',
            bodyKind: block.meta?.bodyKind || block.meta?.renderMode || 'image',
            meta: {
                colophon: block.meta?.colophon || {},
                edition: block.meta?.edition || {},
                contacts: block.meta?.contacts || []
            },
            content: {
                background: block.content?.background || '',
                thumbnail: block.content?.thumbnail || '',
                imagePosition: deepClone(block.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(block.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                theme: block.content?.theme || block.meta?.theme || {}
            }
        });
    }
    if (block.kind === 'chapter' || block.kind === 'section' || block.kind === 'item') {
        const bodyKindRaw = block.meta?.bodyKind || block.meta?.renderMode || 'text';
        const bodyKind = bodyKindRaw === 'image' ? 'image' : 'text';
        return normalizePageV5({
            id: block.id || createId(block.kind),
            role: block.kind,
            bodyKind,
            meta: {
                title: block.meta?.title || {}
            },
            content: {
                background: block.content?.background || '',
                thumbnail: block.content?.thumbnail || '',
                imagePosition: deepClone(block.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(block.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                text: block.content?.text || '',
                texts: deepClone(block.content?.texts || {}),
                richText: deepClone(block.content?.richText || createEmptyRichText()),
                richTextLangs: deepClone(block.content?.richTextLangs || {})
            }
        });
    }
    if (block.kind === 'toc') {
        return normalizePageV5({
            id: block.id || createId('toc'),
            role: 'toc',
            bodyKind: 'text',
            meta: {
                title: block.meta?.title || {}
            }
        });
    }
    if (block.kind === 'page') {
        return normalizePageV5({
            id: block.id || createId('page'),
            role: 'normal',
            bodyKind: block.content?.pageKind === 'text' ? 'text' : 'image',
            content: block.content || {}
        });
    }
    return null;
}

function pageToBlock(page, languages = ['ja']) {
    if (!page) return null;
    if (page.role === 'cover_front') {
        return {
            id: page.id || createId('cover_front'),
            kind: 'cover_front',
            meta: {
                bodyKind: page.bodyKind || 'image',
                renderMode: page.bodyKind || 'image',
                title: normalizeLocalizedTextMap(page.meta?.title),
                subtitle: normalizeLocalizedTextMap(page.meta?.subtitle),
                author: normalizeLocalizedTextMap(page.meta?.author),
                supervisor: normalizeLocalizedTextMap(page.meta?.supervisor),
                publisher: normalizeLocalizedTextMap(page.meta?.publisher),
                theme: deepClone(page.content?.theme || {}),
                langs: Array.isArray(languages) && languages.length ? [...languages] : ['ja']
            },
            content: {
                background: page.content?.background || '',
                thumbnail: page.content?.thumbnail || '',
                imagePosition: deepClone(page.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(page.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                theme: deepClone(page.content?.theme || {})
            }
        };
    }
    if (page.role === 'cover_back') {
        return {
            id: page.id || createId('cover_back'),
            kind: 'cover_back',
            meta: {
                bodyKind: page.bodyKind || 'image',
                renderMode: page.bodyKind || 'image',
                colophon: normalizeLocalizedTextMap(page.meta?.colophon),
                edition: normalizeLocalizedTextMap(page.meta?.edition),
                contacts: deepClone(page.meta?.contacts || []),
                theme: deepClone(page.content?.theme || {})
            },
            content: {
                background: page.content?.background || '',
                thumbnail: page.content?.thumbnail || '',
                imagePosition: deepClone(page.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(page.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                theme: deepClone(page.content?.theme || {})
            }
        };
    }
    if (page.role === 'chapter' || page.role === 'section' || page.role === 'item' || page.role === 'toc') {
        const isStructure = page.role === 'chapter' || page.role === 'section' || page.role === 'item';
        const safeBodyKind = isStructure ? (page.bodyKind === 'image' ? 'image' : 'text') : 'text';
        return {
            id: page.id || createId(page.role),
            kind: page.role,
            meta: {
                bodyKind: safeBodyKind,
                renderMode: safeBodyKind,
                title: normalizeLocalizedTextMap(page.meta?.title)
            },
            content: {
                background: page.content?.background || '',
                thumbnail: page.content?.thumbnail || '',
                imagePosition: deepClone(page.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                imageBasePosition: deepClone(page.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
                text: page.content?.text || '',
                texts: deepClone(page.content?.texts || {}),
                richText: deepClone(page.content?.richText || createEmptyRichText()),
                richTextLangs: deepClone(page.content?.richTextLangs || {})
            }
        };
    }
    return {
        id: page.id || createId('page'),
        kind: 'page',
        content: {
            pageKind: page.bodyKind === 'text' ? 'text' : 'image',
            background: page.content?.background || '',
            backgrounds: deepClone(page.content?.backgrounds || {}),
            thumbnail: page.content?.thumbnail || '',
            bubbles: deepClone(page.content?.bubbles || []),
                text: page.content?.text || '',
                texts: deepClone(page.content?.texts || {}),
                paperPreset: page.content?.paperPreset || '',
                backgroundColor: page.content?.backgroundColor || '',
                textColor: page.content?.textColor || '',
                layout: deepClone(page.content?.layout || {}),
            imagePosition: deepClone(page.content?.imagePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imageBasePosition: deepClone(page.content?.imageBasePosition || { x: 0, y: 0, scale: 1, rotation: 0 }),
            imagePositions: deepClone(page.content?.imagePositions || {})
        }
    };
}

export function migrateSectionsToPages(sections) {
    const src = Array.isArray(sections) && sections.length ? sections : [createDefaultImageSection()];
    const body = src.map(sectionToNormalPage);
    return ensureCoverBoundaries(body);
}

export function extractSectionsFromPages(pages) {
    const list = Array.isArray(pages) ? pages.map(normalizePageV5) : [];
    const normalPages = list.filter((p) => p?.role === 'normal' && (p?.bodyKind === 'image' || p?.bodyKind === 'text'));
    if (!normalPages.length) return [createDefaultImageSection()];
    return normalPages.map(pageToSection);
}

export function pagesToLegacyData(pages, languages = ['ja']) {
    const list = ensureCoverBoundaries(pages || []);
    const blocks = list.map((p) => pageToBlock(p, languages)).filter(Boolean);
    const sections = extractSectionsFromPages(list);
    return { blocks, sections };
}

export function blocksToPages(blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    const pages = list.map(blockToPage).filter(Boolean);
    return ensureCoverBoundaries(pages);
}

/**
 * Normalize project payloads into the current runtime contract.
 *
 * Canonical authoring source:
 *   1. `blocks`
 * Fallback compatibility sources:
 *   2. `sections`
 *   3. `pages`
 *
 * Returned `sections` / `pages` are compatibility/consumer surfaces derived from
 * canonical authoring data, not the source of truth for new edits.
 */
export function normalizeProjectDataV5(data = {}) {
    const languages = ensureLanguages(data);
    const defaultLang = (typeof data.defaultLang === 'string' && languages.includes(data.defaultLang))
        ? data.defaultLang
        : languages[0];

    let pages = [];
    // Authoring data is canonical in blocks. `pages` may contain stale viewer/export
    // output, so only use it when blocks/sections are unavailable.
    if (Array.isArray(data.blocks) && data.blocks.length) {
        pages = blocksToPages(data.blocks);
    } else if (Array.isArray(data.sections) && data.sections.length) {
        pages = migrateSectionsToPages(data.sections || []);
    } else if (Array.isArray(data.pages) && data.pages.length) {
        pages = ensureCoverBoundaries(data.pages);
    } else {
        pages = migrateSectionsToPages([]);
    }
    if (!pages.length) pages = migrateSectionsToPages(data.sections || []);

    const legacy = pagesToLegacyData(pages, languages);

    // 旧プロジェクトは pages に backgrounds が含まれていない場合がある。
    // Firestore に保存された sections には backgrounds が入っているので、
    // legacy.sections[i].backgrounds が空なら data.sections[i].backgrounds で補完する。
    const savedSections = Array.isArray(data.sections) ? data.sections : [];
    const mergedSections = legacy.sections.map((s, i) => {
        const saved = savedSections[i];
        let merged = s;

        // Merge backgrounds from saved sections if derived section has none
        const hasBg = s.backgrounds && Object.keys(s.backgrounds).length > 0;
        const savedHasBg = saved?.backgrounds && Object.keys(saved.backgrounds).length > 0;
        if (!hasBg && savedHasBg) {
            merged = { ...merged, backgrounds: deepClone(saved.backgrounds) };
        }

        // Merge imagePositions from saved sections (not persisted through pages chain in older saves)
        const hasPos = s.imagePositions && Object.keys(s.imagePositions).length > 0;
        const savedHasPos = saved?.imagePositions && Object.keys(saved.imagePositions).length > 0;
        if (!hasPos && savedHasPos) {
            merged = { ...merged, imagePositions: deepClone(saved.imagePositions) };
        }

        return merged;
    });

    return {
        ...data,
        version: Math.max(Number(data.version) || 0, PAGE_SCHEMA_VERSION),
        languages,
        defaultLang,
        pages,
        blocks: legacy.blocks,
        sections: mergedSections
    };
}

export function buildOutlineFromPages(pages, lang, level = 'item') {
    const list = Array.isArray(pages) ? pages : [];
    const maxDepth = level === 'chapter' ? 1 : (level === 'section' ? 2 : 3);
    const depthByRole = { chapter: 1, section: 2, item: 3 };
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        const depth = depthByRole[p?.role];
        if (!depth || depth > maxDepth) continue;
        const title = p?.meta?.title?.[lang] || '';
        if (!title) continue;
        out.push({
            role: p.role,
            depth,
            title,
            pageNumber: i + 1
        });
    }
    return out;
}

// Compatibility export for existing callers during migration.
export function normalizeProjectDataV4(data = {}) {
    return normalizeProjectDataV5(data);
}
