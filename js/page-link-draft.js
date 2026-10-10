/** Review-only commands. This state is deliberately separate from persisted authoring data. */
import { segmentGraphemes } from './grapheme.js';

export const PAGE_REFERENCE_FORMATS = Object.freeze([
    ['plain', '123'], ['lower', 'p.123'], ['paren', '(p.123)'],
    ['upper', 'P. 123'], ['suffix', '123頁'], ['kanji', '縦書き漢数字'],
]);

export function formatPageReference(number, format = 'paren') {
    if (!Number.isSafeInteger(number) || number < 1) throw Error('PAGE_NUMBER_INVALID');
    switch (format) {
        case 'plain': return String(number);
        case 'lower': return `p.${number}`;
        case 'paren': return `(p.${number})`;
        case 'upper': return `P. ${number}`;
        case 'suffix': return `${number}頁`;
        case 'kanji': return String(number).replace(/[0-9]/g, d => '〇一二三四五六七八九'[Number(d)]);
        default: throw Error('PAGE_FORMAT_INVALID');
    }
}

export function validatePageLinkSelection(target) {
    if (!target || !['text', 'image'].includes(target.kind) || !target.ownerId || !target.objectId || !target.language) throw Error('SELECT_TARGET');
    if (target.kind === 'image') return;
    const boundaries = new Set([0, ...segmentGraphemes(target.text, target.language).map(g => g.end)]);
    if (!boundaries.has(target.start) || !boundaries.has(target.end) || target.start >= target.end) throw Error('SELECT_TEXT_RANGE');
}

export function createPageLinkDraft({ readTarget, resolvePage, pages, id = () => crypto.randomUUID() }) {
    const anchors = [], links = [];
    function current(target) {
        validatePageLinkSelection(target);
        const value = readTarget(target);
        if (!value || (target.kind === 'text' && value.text !== target.text)) throw Error('TARGET_CHANGED');
        return value;
    }
    function resolveAnchor(anchor) {
        try { current(anchor.target); return resolvePage(anchor.target); } catch { return null; }
    }
    return {
        anchors: () => anchors.map(a => ({ ...structuredClone(a), page: resolveAnchor(a) })),
        links: () => structuredClone(links),
        register(target, name) {
            current(target);
            if (!name.trim() || name.trim().length > 100) throw Error('ANCHOR_NAME_INVALID');
            const anchor = { id: id(), name: name.trim(), target: structuredClone(target) };
            anchors.push(anchor); return anchor;
        },
        preview(target, destination, format) {
            const value = current(target);
            if (target.kind === 'image' && (!value.caption || !value.visible)) throw Error('CAPTION_REQUIRED');
            let page;
            if (destination.kind === 'anchor') {
                const a = anchors.find(a => a.id === destination.anchorId && a.target.language === target.language);
                page = a && resolveAnchor(a);
            } else if (destination.kind === 'page' && Number.isSafeInteger(destination.pageNumber)) {
                page = pages().find(p => p.number === destination.pageNumber);
            }
            if (!page || !Number.isSafeInteger(page.number) || page.number < 1) throw Error('DESTINATION_UNRESOLVED');
            const reference = formatPageReference(page.number, format);
            const text = target.kind === 'text' ? target.text.slice(target.start, target.end) : value.caption;
            return { page, reference, text };
        },
        setLink(target, destination, format) {
            this.preview(target, destination, format);
            const link = { id: id(), source: structuredClone(target), destination: structuredClone(destination), format };
            links.push(link); return link;
        },
    };
}
