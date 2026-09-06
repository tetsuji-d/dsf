/** Visual keyboard navigation over measured Flow DOM; never edits semantic text. */
import { segmentGraphemes } from './grapheme.js';
import {
    advanceFlowVerticalLineBreakClientRect,
    getFlowFragmentDomPosition,
    isFlowCaretMeasurementRect,
    resolveFlowCaretClientGeometry,
} from './flow-source-mapping.js';

const MODES = new Set(['horizontal-tb', 'vertical-rl']);
const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
const LINE_BREAK = /^(?:\r\n|[\r\n\u2028\u2029])$/u;

function snapshotRect(rect) {
    if (!rect) return null;
    const { left, top, width, height } = rect;
    if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) return null;
    return Object.freeze({ left, top, width, height, right: left + width, bottom: top + height });
}

function measureRange(range, writingMode) {
    const rect = [...(range.getClientRects?.() || [])].find((item) => isFlowCaretMeasurementRect(item, writingMode));
    if (rect) return snapshotRect(rect);
    const bounds = range.getBoundingClientRect?.();
    return bounds && isFlowCaretMeasurementRect(bounds, writingMode) ? snapshotRect(bounds) : null;
}

function samePoint(left, right) {
    return left?.sectionId === right?.sectionId && left?.blockId === right?.blockId
        && left?.languageKey === right?.languageKey && left?.utf16Offset === right?.utf16Offset
        && left?.graphemeOffset === right?.graphemeOffset;
}

function sameRect(left, right) {
    return ['left', 'top', 'width', 'height'].every((key) => Math.abs(left[key] - right[key]) < 0.01);
}

/**
 * pages = [{pageElement, page: paginationPage, pageIndex}]. Supply DOM rendered
 * by renderFlowGeneratedPage, in a connected/measurable viewport or measure host.
 * Only these pages are measured; callers may extend their window at an edge.
 * Graphemes and glyph ranges are measured once per fragment, not once per caret.
 */
export function measureFlowDirectNavigationStops(pages, options = {}) {
    const writingMode = options.writingMode;
    if (!MODES.has(writingMode) || !Array.isArray(pages)) return Object.freeze([]);
    const stops = [];
    const entries = pages.map((entry, index) => ({ ...entry, pageIndex: entry.pageIndex ?? index }))
        .sort((left, right) => left.pageIndex - right.pageIndex);
    for (const { pageElement, page, pageIndex } of entries) {
        const ownerDocument = pageElement?.ownerDocument;
        const pageRect = snapshotRect(pageElement?.getBoundingClientRect?.());
        if (!ownerDocument?.createRange || !pageRect || pageRect.width <= 0 || pageRect.height <= 0
            || !Number.isInteger(pageIndex) || pageIndex < 0) continue;
        const scaleX = Number(pageElement.offsetWidth) / pageRect.width;
        const scaleY = Number(pageElement.offsetHeight) / pageRect.height;
        if (![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)) continue;
        for (const [fragmentIndex, fragment] of (page?.fragments || []).entries()) {
            if (!['heading', 'paragraph'].includes(fragment.blockType)) continue;
            const element = pageElement.querySelector(`.flow-dom-block[data-flow-fragment-index="${fragmentIndex}"]`);
            const node = element?.firstChild;
            const text = String(fragment.text ?? '');
            const sourceRange = fragment.sourceRange;
            const segments = segmentGraphemes(text, fragment.languageKey);
            if (!node || (!fragment.annotations?.length && (node.nodeType !== 3 || node.textContent !== (text || '\u200B')))
                || !fragment.sectionId || !fragment.blockId || !fragment.languageKey
                || !Number.isInteger(sourceRange?.start) || sourceRange.start < 0
                || !Number.isInteger(sourceRange?.startGrapheme) || sourceRange.startGrapheme < 0
                || sourceRange.end !== sourceRange.start + text.length
                || sourceRange.endGrapheme !== sourceRange.startGrapheme + segments.length) continue;
            const range = ownerDocument.createRange();
            const fragmentRect = element.getBoundingClientRect?.();
            const style = ownerDocument.defaultView?.getComputedStyle?.(element);
            const glyphRects = segments.map((segment) => {
                const begin = getFlowFragmentDomPosition(element, fragment, segment.index);
                const finish = getFlowFragmentDomPosition(element, fragment, segment.end, 'backward');
                range.setStart(begin.node, begin.offset);
                range.setEnd(finish.node, finish.offset);
                return measureRange(range, writingMode);
            });
            const afterGlyphRects = glyphRects.map((measured, index) => {
                const segment = segments[index];
                if (writingMode !== 'vertical-rl' || !LINE_BREAK.test(segment.segment) || !measured) return measured;
                return advanceFlowVerticalLineBreakClientRect({
                    lineBreakRect: measured, fragmentRect,
                    contentRect: element.parentElement?.getBoundingClientRect?.(),
                    lineAdvance: Number.parseFloat(style?.lineHeight) / scaleX,
                    textAlign: style?.textAlign, direction: style?.direction,
                }) || measured;
            });
            for (let index = 0; index <= segments.length; index += 1) {
                const offset = index < segments.length ? segments[index].index : text.length;
                const caret = getFlowFragmentDomPosition(element, fragment, offset);
                range.setStart(caret.node, caret.offset);
                range.collapse(true);
                const collapsedRect = measureRange(range, writingMode);
                const boundaryStops = [];
                for (const affinity of ['backward', 'forward']) {
                    const clientRect = resolveFlowCaretClientGeometry({
                        writingMode, affinity, collapsedRect, fragmentRect,
                        previousRect: afterGlyphRects[index - 1], nextRect: glyphRects[index],
                    });
                    if (!clientRect) continue;
                    const rect = snapshotRect({
                        left: (clientRect.left - pageRect.left) * scaleX,
                        top: (clientRect.top - pageRect.top) * scaleY,
                        width: clientRect.width * scaleX, height: clientRect.height * scaleY,
                    });
                    if (!rect) continue;
                    const sourcePoint = Object.freeze({
                        sectionId: fragment.sectionId, blockId: fragment.blockId, blockType: fragment.blockType,
                        languageKey: fragment.languageKey, utf16Offset: sourceRange.start + offset,
                        graphemeOffset: sourceRange.startGrapheme + index, affinity,
                    });
                    const stop = Object.freeze({ pageIndex, sourcePoint, rect });
                    // At an ordinary boundary both affinities occupy the same
                    // spot. At a wrap keep both visual sides of the same offset.
                    if (boundaryStops.length && sameRect(boundaryStops[0].rect, rect)) {
                        // A fragment end must resolve to this page, not the next
                        // page carrying the same source offset with forward affinity.
                        if (index < segments.length || index === 0) boundaryStops[0] = stop;
                    }
                    else boundaryStops.push(stop);
                }
                stops.push(...boundaryStops);
            }
            range.detach?.();
        }
    }
    return Object.freeze(stops);
}

function axes(stop, vertical) {
    const rect = stop.rect;
    return vertical
        ? { inline: rect.top, cross: rect.left + rect.width / 2, breadth: rect.width }
        : { inline: rect.left, cross: rect.top + rect.height / 2, breadth: rect.height };
}

function buildLines(stops, vertical) {
    const lines = [];
    for (const stop of stops) {
        const position = axes(stop, vertical);
        // Font fallback can change the Range box without changing its line.
        // Substantial cross-axis overlap groups those boxes, never a guessed
        // character count or a fixed column/line pitch.
        const line = lines.find((candidate) => candidate.pageIndex === stop.pageIndex
            && Math.abs(candidate.cross - position.cross) <= Math.max(0.5, Math.min(candidate.breadth, position.breadth) * 0.2));
        if (line) line.stops.push(stop);
        else lines.push({ pageIndex: stop.pageIndex, cross: position.cross, breadth: position.breadth, stops: [stop] });
    }
    return lines.sort((left, right) => left.pageIndex - right.pageIndex
        || (vertical ? right.cross - left.cross : left.cross - right.cross));
}

/**
 * Resolve plain arrows / visual Home and End. The caller owns selection,
 * Shift/Ctrl modifiers, session mounting, history, and IME exclusion.
 * preferredInlinePosition is page-local x (horizontal) or y (vertical); retain
 * it only across cross-axis arrows. edge tells a windowed caller which neighbor
 * page to mount before retrying. No result changes document data.
 */
export function resolveFlowDirectNavigation(options = {}) {
    const { key, sourcePoint, writingMode } = options;
    if (!MODES.has(writingMode) || !KEYS.has(key) || !sourcePoint) return null;
    const vertical = writingMode === 'vertical-rl';
    const stops = (Array.isArray(options.stops) ? options.stops : []).filter((stop) => {
        const rect = snapshotRect(stop?.rect);
        return Number.isInteger(stop?.pageIndex) && stop.pageIndex >= 0 && rect
            && (vertical ? rect.width > 0 : rect.height > 0) && stop.sourcePoint;
    });
    let candidates = stops.filter((stop) => samePoint(stop.sourcePoint, sourcePoint));
    const onPage = candidates.filter((stop) => stop.pageIndex === options.pageIndex);
    if (onPage.length) candidates = onPage;
    const current = candidates.find((stop) => stop.sourcePoint.affinity === sourcePoint.affinity)
        || candidates.find((stop) => stop.sourcePoint.affinity === 'forward') || candidates[0];
    if (!current) return null;
    const result = (target, preferredInlinePosition, edge = null) => Object.freeze({
        sourcePoint: target.sourcePoint, pageIndex: target.pageIndex, preferredInlinePosition, edge,
        moved: target !== current && (!samePoint(target.sourcePoint, current.sourcePoint)
            || target.pageIndex !== current.pageIndex || !sameRect(target.rect, current.rect)),
    });
    const inlineKeys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (inlineKeys.includes(key)) {
        const forward = key === inlineKeys[1];
        const direction = forward ? 1 : -1;
        // Stops are semantic page/fragment/grapheme order, not screen order.
        // Skip the second visual side of one soft wrap: one key = one grapheme.
        let index = stops.indexOf(current) + direction;
        while (index >= 0 && index < stops.length && samePoint(stops[index].sourcePoint, current.sourcePoint)) index += direction;
        if (index < 0 || index >= stops.length) return result(current, null, forward ? 'end' : 'start');
        if (Math.abs(stops[index].pageIndex - current.pageIndex) > 1) {
            // A pinned editing page and a distant scrolled window can coexist.
            // Their DOM order must not turn a missing page into skipped text.
            return result(current, null, forward ? 'end' : 'start');
        }
        const nextPoint = stops[index].sourcePoint;
        const matches = stops.filter((stop) => samePoint(stop.sourcePoint, nextPoint));
        const preferredAffinity = forward ? 'forward' : 'backward';
        const orderedMatches = forward ? [...matches].reverse() : matches;
        const target = orderedMatches.find((stop) => stop.sourcePoint.affinity === preferredAffinity) || orderedMatches[0];
        return result(target, null);
    }

    const lines = buildLines(stops, vertical);
    const currentLineIndex = lines.findIndex((line) => line.stops.includes(current));
    const currentLine = lines[currentLineIndex];
    if (key === 'Home' || key === 'End') {
        const sorted = [...currentLine.stops].sort((left, right) => axes(left, vertical).inline - axes(right, vertical).inline);
        return result(key === 'Home' ? sorted[0] : sorted[sorted.length - 1], null);
    }
    const direction = key === (vertical ? 'ArrowLeft' : 'ArrowDown') ? 1 : -1;
    const preferred = Number.isFinite(options.preferredInlinePosition)
        ? options.preferredInlinePosition : axes(current, vertical).inline;
    const nextLine = lines[currentLineIndex + direction];
    if (!nextLine) return result(current, preferred, direction > 0 ? 'end' : 'start');
    if (Math.abs(nextLine.pageIndex - current.pageIndex) > 1) {
        return result(current, preferred, direction > 0 ? 'end' : 'start');
    }
    const target = [...nextLine.stops].sort((left, right) => {
        const distance = Math.abs(axes(left, vertical).inline - preferred) - Math.abs(axes(right, vertical).inline - preferred);
        return distance || axes(left, vertical).inline - axes(right, vertical).inline;
    })[0];
    return result(target, preferred);
}
