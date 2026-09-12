/** Semantic annotations use grapheme-safe UTF-16 ranges in plain localized text. */
import { segmentGraphemes } from './grapheme.js';

export class FlowAnnotationError extends Error {
    constructor(code) { super(code); this.name = 'FlowAnnotationError'; this.code = code; }
}
const fail = code => { throw new FlowAnnotationError(code); };
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
export function validateFlowAnnotations(block) {
    if (block.annotations === undefined) return;
    if (!record(block.annotations) || !['paragraph', 'heading'].includes(block.type)) fail('ANNOTATIONS_INVALID');
    for (const [language, list] of Object.entries(block.annotations)) {
        const text = block.texts?.[language];
        if (typeof text !== 'string' || !Array.isArray(list)) fail('ANNOTATION_LANGUAGE_INVALID');
        const boundaries = new Set([0, ...segmentGraphemes(text, language).map(s => s.end)]);
        const ids = new Set();
        for (const a of list) {
            if (!record(a) || typeof a.id !== 'string' || !a.id || ids.has(a.id)) fail('ANNOTATION_ID_INVALID');
            ids.add(a.id);
            if (!boundaries.has(a.start) || !boundaries.has(a.end) || a.start >= a.end
                || /[\r\n\u2028\u2029]/u.test(text.slice(a.start, a.end))) fail('ANNOTATION_RANGE_INVALID');
            if (a.type === 'ruby') {
                if (typeof a.reading !== 'string' || !a.reading.trim() || /[\r\n\u2028\u2029]/u.test(a.reading)) fail('RUBY_READING_INVALID');
            } else if (a.type === 'emphasis') {
                if (!['sesame', 'dot'].includes(a.mark)) fail('EMPHASIS_MARK_INVALID');
            } else fail('ANNOTATION_TYPE_UNSUPPORTED');
            if (a.reviewState !== undefined && !['confirmed', 'needs-review'].includes(a.reviewState)) fail('ANNOTATION_REVIEW_INVALID');
            if (list.some(b => b !== a && b.type === a.type && overlaps(a, b))) fail('ANNOTATION_OVERLAP');
        }
    }
}

/** Unlike the legacy preview parser, never normalize surrounding whitespace or punctuation. */
export function convertLegacyRuby(text, idFactory) {
    const annotations = [];
    let plain = '', cursor = 0;
    const pattern = /[\{｛]([^{}｛｝|｜\r\n]+)[|｜]([^{}｛｝|｜\r\n]+)[\}｝]/gu;
    for (const match of text.matchAll(pattern)) {
        plain += text.slice(cursor, match.index);
        const start = plain.length;
        plain += match[1];
        annotations.push({ id: idFactory('ruby'), type: 'ruby', start, end: plain.length, reading: match[2] });
        cursor = match.index + match[0].length;
    }
    return { text: plain + text.slice(cursor), annotations };
}

export function replaceAnnotatedText(block, language, nextText) {
    validateFlowAnnotations(block);
    if (typeof nextText !== 'string') fail('ANNOTATION_TEXT_INVALID');
    const oldText = block.texts?.[language] ?? '';
    const annotations = block.annotations?.[language];
    if (!annotations?.length || oldText === nextText) return;
    const old = segmentGraphemes(oldText, language), next = segmentGraphemes(nextText, language);
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix].segment === next[prefix].segment) prefix++;
    while (suffix < old.length - prefix && suffix < next.length - prefix
        && old[old.length - 1 - suffix].segment === next[next.length - 1 - suffix].segment) suffix++;
    const start = old[prefix]?.index ?? oldText.length;
    const end = suffix ? old[old.length - suffix].index : oldText.length;
    const nextEnd = suffix ? next[next.length - suffix].index : nextText.length;
    const delta = nextEnd - end;
    block.annotations[language] = annotations.flatMap(a => {
        if (a.end <= start) return [{ ...a }];
        if (a.start >= end) return [{ ...a, start: a.start + delta, end: a.end + delta }];
        if (start <= a.start && end >= a.end && nextEnd === start) return [];
        const updated = { ...a, start: Math.min(a.start, start), end: a.end >= end ? a.end + delta : nextEnd };
        if (updated.start >= updated.end) return [];
        if (/[\r\n\u2028\u2029]/u.test(nextText.slice(updated.start, updated.end))) fail('ANNOTATION_CANNOT_CROSS_BREAK');
        if (a.type === 'ruby') updated.reviewState = 'needs-review';
        return [updated];
    });
}

export function splitAnnotatedText(block, language, start, end = start) {
    validateFlowAnnotations(block);
    const text = block.texts?.[language] ?? '';
    const boundaries = new Set([0, ...segmentGraphemes(text, language).map(s => s.end)]);
    if (!boundaries.has(start) || !boundaries.has(end) || start > end) fail('ANNOTATION_RANGE_INVALID');
    const list = block.annotations?.[language] || [];
    if (list.some(a => (a.start < start && start < a.end) || (a.start < end && end < a.end))) fail('ANNOTATION_SPLIT_INSIDE');
    const leading = list.filter(a => a.end <= start).map(a => ({ ...a }));
    const trailing = list.filter(a => a.start >= end).map(a => ({ ...a, start: a.start - end, end: a.end - end }));
    if (block.annotations) block.annotations[language] = leading;
    return trailing;
}

export function mergeAnnotatedText(target, source, language, offset) {
    validateFlowAnnotations(target);
    validateFlowAnnotations(source);
    if (offset !== (target.texts?.[language] ?? '').length) fail('ANNOTATION_RANGE_INVALID');
    const incoming = source.annotations?.[language] || [];
    if (!incoming.length) return;
    target.annotations ||= {};
    const ids = new Set((target.annotations[language] || []).map(a => a.id));
    const shifted = incoming.map(a => {
        let id = a.id, suffix = 1;
        while (ids.has(id)) id = a.id + '-merged-' + suffix++;
        ids.add(id);
        return { ...a, id, start: a.start + offset, end: a.end + offset };
    });
    target.annotations[language] = [...(target.annotations[language] || []), ...shifted];
}

/** Build a v2 annotation edit without mutating a document or calling persistence. */
export function createFlowAnnotationEdit(document, operation) {
    if (![1, 2, 3, 4, 5].includes(document?.schemaVersion)) fail('ANNOTATION_DOCUMENT_UNSUPPORTED');
    const next = structuredClone(document);
    const block = next.sections?.find(s => s.id === operation.sectionId)?.blocks?.find(b => b.id === operation.blockId);
    if (!block || !['heading', 'paragraph'].includes(block.type)) fail('ANNOTATION_BLOCK_REQUIRED');
    const language = operation.languageKey;
    if (typeof operation.expectedText !== 'string' || block.texts?.[language] !== operation.expectedText) fail('ANNOTATION_SOURCE_CHANGED');
    validateFlowAnnotations(block);
    const list = block.annotations?.[language] || [];
    if (operation.action === 'remove') {
        if (!list.some(a => a.id === operation.id)) fail('ANNOTATION_NOT_FOUND');
        block.annotations[language] = list.filter(a => a.id !== operation.id);
    } else if (operation.action === 'set') {
        const annotation = structuredClone(operation.annotation);
        block.annotations ||= {};
        block.annotations[language] = [...list.filter(a => a.id !== annotation?.id), annotation];
    } else fail('ANNOTATION_OPERATION_UNSUPPORTED');
    validateFlowAnnotations(block);
    next.schemaVersion = Math.max(2, next.schemaVersion);
    return next;
}
