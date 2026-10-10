/** Private authoring references. Number text is a generated cache, never the target identity. */
import { formatPageReference, PAGE_REFERENCE_FORMATS } from './page-link-draft.js';
import { segmentGraphemes } from './grapheme.js';
import { getPageDisplayLabel } from './page-labels.js';
import { replaceAnnotatedText } from './flow-annotations.js';
import { remapPlacementText } from './flow-page-placement.js';
import {captureFlowTranslationUnitBeforeSourceEdit,recordFlowManualTranslationUnitEdit} from './flow-translation-state.js';

export const NAVIGATION_PROJECT_VERSION = 7;
const formats = new Set(PAGE_REFERENCE_FORMATS.map(([id]) => id));
const copy = value => structuredClone(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const integer = n => Number.isSafeInteger(n) && n >= 0;
const id = s => typeof s === 'string' && s.length > 0 && s.length <= 200;

export function validatePageNavigation(nav) {
    if (nav == null) return;
    if (!record(nav) || nav.version !== 1 || !Array.isArray(nav.anchors) || !Array.isArray(nav.links)
        || nav.anchors.length + nav.links.length > 10000) fail('PAGE_NAVIGATION_INVALID');
    const ids = new Set();
    const target = t => {
        if (!record(t) || !id(t.ownerId) || !id(t.objectId) || !id(t.language)
            || !['flow-text', 'graphic'].includes(t.scope) || !['text', 'image'].includes(t.kind)) fail('PAGE_TARGET_INVALID');
        if (t.scope === 'flow-text' && (!id(t.sectionId) || t.kind !== 'text')) fail('PAGE_TARGET_INVALID');
        if (t.kind === 'text' && (typeof t.text !== 'string' || !integer(t.start) || !integer(t.end)
            || t.start >= t.end || t.end > t.text.length)) fail('PAGE_TARGET_RANGE_INVALID');
        if (t.kind === 'text') {
            const boundaries = new Set([0, ...segmentGraphemes(t.text, t.language).map(g => g.end)]);
            if (!boundaries.has(t.start) || !boundaries.has(t.end)) fail('PAGE_TARGET_RANGE_INVALID');
        }
    };
    for (const a of [...nav.anchors, ...nav.links]) {
        if (!record(a) || !id(a.id) || ids.has(a.id)) fail('PAGE_NAVIGATION_ID_INVALID');
        ids.add(a.id);
    }
    for (const a of nav.anchors) {
        if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 100) fail('ANCHOR_NAME_INVALID');
        target(a.target);
    }
    for (const l of nav.links) {
        target(l.source);
        const d = l.destination, r = l.reference;
        if (!record(d) || !(d.kind === 'anchor' && id(d.anchorId) || d.kind === 'page' && integer(d.pageNumber) && d.pageNumber > 0)) fail('PAGE_DESTINATION_INVALID');
        if (!record(r) || !formats.has(r.format) || !integer(r.start) || !integer(r.end) || r.start >= r.end
            || typeof r.text !== 'string' || r.text.length > 100 || r.end - r.start !== r.text.length
            || typeof r.contextText !== 'string' || r.end > r.contextText.length) fail('PAGE_REFERENCE_INVALID');
    }
}

export function findPageNavigationObject(project, target) {
    const owner = project.blocks?.find(b => b.id === target.ownerId);
    if (!owner) return null;
    if (target.scope === 'flow-text') {
        const block = owner.flow?.document.sections.find(s => s.id === target.sectionId)?.blocks.find(b => b.id === target.objectId);
        return ['paragraph', 'heading'].includes(block?.type) && typeof block.texts?.[target.language] === 'string' ? block : null;
    }
    return owner.kind === 'flow' ? owner.flow.layout.anchoredObjects?.find(e => e.graphic.id === target.objectId)?.graphic
        : owner.content?.graphicObjects?.find(o => o.id === target.objectId) || null;
}
export function readPageNavigationText(project, target) {
    const object = findPageNavigationObject(project, target);
    return target.kind === 'image' ? object?.caption?.texts?.[target.language] : object?.texts?.[target.language];
}
function writeText(project, target, text) {
    const object = findPageNavigationObject(project, target);
    if (!object) fail('PAGE_TARGET_MISSING');
    if (target.kind === 'image') object.caption.texts[target.language] = text;
    else if (target.scope === 'flow-text') {
        const owner = project.blocks.find(b => b.id === target.ownerId);
        const original=target.language===owner.flow.document.sourceLanguage;
        if(original){const result=captureFlowTranslationUnitBeforeSourceEdit(owner,{unitMap:'blocks',unitId:object.id});if(result.changed)owner.flow.translationState=result.translationState;}
        remapPlacementText(owner, object.id, target.language, object.texts[target.language], text);
        replaceAnnotatedText(object, target.language, text);
        object.texts[target.language] = text;
        if(!original){const result=recordFlowManualTranslationUnitEdit(owner,target.language,{unitMap:'blocks',unitId:object.id});if(result.changed)owner.flow.translationState=result.translationState;}
    } else object.texts[target.language] = text;
}
function same(a, b) { return ['scope', 'ownerId', 'sectionId', 'objectId', 'language', 'kind'].every(k => a[k] === b[k]); }

export function textChange(before, after) {
    let start = 0, tail = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    return { start, end: before.length - tail, count: after.length - tail - start };
}
function shiftRange(range, change, strict = false) {
    const { start, end, count } = change, delta = count - (end - start);
    if (range.end <= start) return true;
    if (range.start >= end) { range.start += delta; range.end += delta; return true; }
    if (strict || (start <= range.start && end >= range.end)) return false;
    range.start = Math.min(range.start, start);
    range.end = Math.max(range.start, range.end + delta);
    return range.end > range.start;
}

/** Apply a known reference-cache replacement, shifting every affected anchor/range together. */
function replaceManagedReference(project, link, start, end, replacement) {
    const previous = readPageNavigationText(project, link.source);
    const next = previous.slice(0, start) + replacement + previous.slice(end);
    const change = { start, end, count: replacement.length };
    for (const anchor of project.pageNavigation.anchors) {
        if (anchor.target.kind === 'text' && same(anchor.target, link.source)) {
            if (!shiftRange(anchor.target, change)) anchor.target.unresolved = true;
            anchor.target.text = next;
        }
    }
    for (const other of project.pageNavigation.links) {
        if (!same(other.source, link.source)) continue;
        if (other.source.kind === 'text') {
            if (!shiftRange(other.source, change)) other.source.unresolved = true;
            other.source.text = next;
        }
        if (other !== link && !shiftRange(other.reference, change, true)) other.unresolved = true;
        other.reference.contextText = next;
    }
    writeText(project, link.source, next);
    link.reference = { ...link.reference, start, end: start + replacement.length, text: replacement, contextText: next };
}

/** Rebase ordinary text edits. Reference edits become unresolved, never silently click somewhere else. */
export function reconcilePageNavigation(project) {
    if (!project.pageNavigation) return false;
    const before = JSON.stringify(project.pageNavigation);
    for (const item of [...project.pageNavigation.anchors.map(a => ({ target: a.target })), ...project.pageNavigation.links.map(l => ({ target: l.source, link: l }))]) {
        const { target, link } = item;
        if (target.unresolved || link?.unresolved) continue;
        const text = readPageNavigationText(project, target);
        if (target.kind === 'image' && !link) {
            if (!findPageNavigationObject(project, target)) target.unresolved = true;
            continue;
        }
        if (typeof text !== 'string') { target.unresolved = true; continue; }
        if (target.kind === 'text' && text !== target.text) {
            const change = textChange(target.text, text);
            if (!shiftRange(target, change)) target.unresolved = true;
            // Keep the old valid snapshot for broken ranges so the manuscript can still be saved.
            if (!target.unresolved) target.text = text;
        }
        if (link && text !== link.reference.contextText) {
            if (!shiftRange(link.reference, textChange(link.reference.contextText, text), true)
                || text.slice(link.reference.start, link.reference.end) !== link.reference.text) link.unresolved = true;
            if (!link.unresolved) link.reference.contextText = text;
        }
    }
    return before !== JSON.stringify(project.pageNavigation);
}

/** Track split/merge identity from the actual before/after semantic blocks before ordinary rebasing. */
export function trackPageNavigationStructure(nav, beforeBlocks, afterBlocks) {
    if (!nav) return;
    const flatten = blocks => blocks.flatMap(owner => (owner.flow?.document.sections || []).flatMap(section => section.blocks
        .filter(b => ['paragraph', 'heading'].includes(b.type)).map(block => ({ owner, section, block }))));
    const before = flatten(beforeBlocks), after = flatten(afterBlocks);
    for (const a of [...nav.anchors.map(a => ({ target: a.target })), ...nav.links.map(l => ({ target: l.source, link: l }))]) {
        const t = a.target;
        if (t.scope !== 'flow-text' || t.unresolved) continue;
        const old = before.find(e => e.owner.id === t.ownerId && e.block.id === t.objectId);
        if (!old) continue;
        const previousText = old.block.texts[t.language];
        const exact = after.find(e => e.owner.id === t.ownerId && e.block.id === t.objectId);
        let destination = exact, offset = 0;
        if (exact && exact.block.texts[t.language] !== previousText) {
            const index = after.indexOf(exact), head = exact.block.texts[t.language];
            const tail = after[index + 1];
            if (typeof head === 'string' && tail && head + (tail.block.texts[t.language] || '') === previousText) {
                if (t.start >= head.length) { destination = tail; offset = -head.length; }
                else if (t.end > head.length) { t.unresolved = true; continue; }
                else if (a.link && a.link.reference.end > head.length) { a.link.unresolved = true; continue; }
            }
        } else if (!exact) {
            // Move to a new Flow group only if the stable block ID is unique and its text matches.
            const moved = after.filter(e => e.block.id === t.objectId && e.block.texts[t.language] === previousText);
            if (moved.length === 1) destination = moved[0];
            else {
                const oldIndex = before.indexOf(old), prev = before[oldIndex - 1];
                const merged = prev && after.find(e => e.owner.id === prev.owner.id && e.block.id === prev.block.id);
                if (merged && merged.block.texts[t.language] === (prev.block.texts[t.language] || '') + previousText) {
                    destination = merged; offset = (prev.block.texts[t.language] || '').length;
                }
            }
        }
        if (destination && (destination !== exact || offset)) {
            t.ownerId = destination.owner.id; t.sectionId = destination.section.id; t.objectId = destination.block.id;
            t.start += offset; t.end += offset; t.text = destination.block.texts[t.language];
            if (a.link) { a.link.reference.start += offset; a.link.reference.end += offset; a.link.reference.contextText = t.text; }
        }
    }
}

export function numberedNavigationPages(pages, project) {
    return pages.map((page, index) => {
        const label = getPageDisplayLabel(index, pages.length, project.book, project.bookMode);
        return { ...page, index, number: /^[1-9][0-9]*$/.test(label) ? Number(label) : null };
    });
}
export function resolveNavigationTarget(project, target, pages) {
    if (target.unresolved || !findPageNavigationObject(project, target)) return null;
    return pages.find(p => p.blockId === target.ownerId && !p.isSourceFallback && (p.kind === 'fixed'
        || (target.scope === 'flow-text' ? p.languageKey === target.language && p.page.fragments.some(f => f.blockId === target.objectId && f.sourceRange.start <= target.start && target.start < f.sourceRange.end)
        : p.page.anchoredObject && (p.page.anchoredObject.graphic.members || [p.page.anchoredObject.graphic]).some(o => o.id === target.objectId)))) || null;
}
export function resolveNavigationLink(project, link, pages) {
    if (link.unresolved || link.source.unresolved) return null;
    let page;
    if (link.destination.kind === 'page') page = pages.find(p => p.number === link.destination.pageNumber);
    else {
        const anchor = project.pageNavigation.anchors.find(a => a.id === link.destination.anchorId && a.target.language === link.source.language);
        page = anchor && resolveNavigationTarget(project, anchor.target, pages);
    }
    return page?.number ? page : null;
}
export function syncNavigationReferences(project, pages, language) {
    reconcilePageNavigation(project);
    let changed = false;
    for (const link of project.pageNavigation?.links || []) {
        if (link.source.language !== language) continue;
        const destination = resolveNavigationLink(project, link, pages);
        if (!destination) continue;
        const next = ' ' + formatPageReference(destination.number, link.reference.format);
        if (link.reference.text !== next) {
            replaceManagedReference(project, link, link.reference.start, link.reference.end, next);
            changed = true;
        }
    }
    return changed;
}

export function addPageAnchor(project, target, name, anchorId = crypto.randomUUID()) {
    if (!name?.trim() || name.trim().length > 100) fail('ANCHOR_NAME_INVALID');
    const next = copy(project); next.version = 7; next.pageNavigation ||= { version: 1, anchors: [], links: [] };
    if (!findPageNavigationObject(next, target)) fail('PAGE_TARGET_MISSING');
    next.pageNavigation.anchors.push({ id: anchorId, name: name.trim(), target: copy(target) });
    validatePageNavigation(next.pageNavigation); return next;
}
export function addPageLink(project, source, destination, format, pages, linkId = crypto.randomUUID()) {
    const next = copy(project); next.version = 7; next.pageNavigation ||= { version: 1, anchors: [], links: [] };
    reconcilePageNavigation(next);
    const object = findPageNavigationObject(next, source), text = readPageNavigationText(next, source);
    if (!object || typeof text !== 'string' || source.kind === 'text' && source.text !== text) fail('TARGET_CHANGED');
    if (source.kind === 'image' && (!text.trim() || !object.visible)) fail('CAPTION_REQUIRED');
    if (next.pageNavigation.links.some(l => same(l.source, source) && (source.kind === 'image' || source.start < l.reference.end && l.source.start < source.end))) fail('PAGE_LINK_OVERLAP');
    const at = source.kind === 'image' ? text.length : source.end;
    const link = { id: linkId, source: copy(source), destination: copy(destination), reference: { format, start: at, end: at, text: '', contextText: text } };
    const page = resolveNavigationLink(next, link, pages);
    if (!page) fail('DESTINATION_UNRESOLVED');
    next.pageNavigation.links.push(link);
    replaceManagedReference(next, link, at, at, ' ' + formatPageReference(page.number, format));
    validatePageNavigation(next.pageNavigation); return next;
}
export function removePageLink(project, linkId) {
    const next = copy(project), link = next.pageNavigation?.links.find(l => l.id === linkId);
    if (!link) return next;
    const text = readPageNavigationText(next, link.source);
    if (!link.unresolved && typeof text === 'string' && text.slice(link.reference.start, link.reference.end) === link.reference.text)
        replaceManagedReference(next, link, link.reference.start, link.reference.end, '');
    next.pageNavigation.links = next.pageNavigation.links.filter(l => l.id !== linkId);
    return next;
}

export function assertNavigationReady(project, pages, language) {
    if (!project.pageNavigation) return;
    validatePageNavigation(project.pageNavigation);
    for (const link of project.pageNavigation.links.filter(l => l.source.language === language)) {
        const page = resolveNavigationLink(project, link, pages);
        const text = readPageNavigationText(project, link.source), object = findPageNavigationObject(project, link.source);
        if (!page || !resolveNavigationTarget(project, link.source, pages)
            || text?.slice(link.reference.start, link.reference.end) !== link.reference.text
            || link.reference.text !== ' ' + formatPageReference(page.number, link.reference.format)
            || link.source.kind === 'image' && !object.visible) fail('PAGE_LINK_UNRESOLVED');
    }
}
