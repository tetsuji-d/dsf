/** Runtime-only IME preedit geometry; semantic text is never modified here. */
import { segmentGraphemes } from './grapheme.js';

function finiteRect(rect) {
    if (!rect) return null;
    const values = ['left', 'top', 'width', 'height'].map((key) => Number(rect[key]));
    if (!values.every(Number.isFinite) || values[2] < 0 || values[3] < 0) return null;
    const [left, top, width, height] = values;
    return { left, top, width, height };
}

/**
 * Align measured glyph boxes, not CSS line-box edges. The source caret uses a
 * Range font box, whereas a preedit element also contains line-height leading.
 * scaleX/Y convert viewport pixels into the page's unscaled CSS coordinates.
 */
export function resolveFlowDirectCompositionTranslation(options = {}) {
    const { writingMode } = options;
    if (writingMode !== 'vertical-rl' && writingMode !== 'horizontal-tb') return null;
    const caret = finiteRect(options.caretRect);
    const composition = finiteRect(options.compositionRect);
    const scaleX = Number(options.scaleX ?? 1);
    const scaleY = Number(options.scaleY ?? 1);
    if (!caret || !composition || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)
        || scaleX <= 0 || scaleY <= 0) return null;
    const vertical = writingMode === 'vertical-rl';
    if (vertical ? caret.width <= 0 || composition.width <= 0
        : caret.height <= 0 || composition.height <= 0) return null;
    const leftDelta = vertical
        ? (caret.left + caret.width / 2 - composition.left - composition.width / 2) * scaleX
        : (caret.left - composition.left) * scaleX;
    const topDelta = vertical
        ? (caret.top - composition.top) * scaleY
        : (caret.top + caret.height / 2 - composition.top - composition.height / 2) * scaleY;
    if (!Number.isFinite(leftDelta) || !Number.isFinite(topDelta)) return null;
    return Object.freeze({ leftDelta, topDelta });
}

/**
 * Call after appending an absolutely positioned, single-text-node preedit
 * element to the page. Invalid/empty measurements keep the caller's position.
 * Only the temporary overlay moves; the input proxy and OS candidate window
 * remain the caller/browser's responsibility.
 */
export function alignFlowDirectCompositionElement(options = {}) {
    const { pageElement, compositionElement, caretRect, writingMode, languageKey } = options;
    const ownerDocument = pageElement?.ownerDocument;
    const textNode = compositionElement?.firstChild;
    const text = textNode?.nodeType === 3 ? String(textNode.textContent || '') : '';
    if (!text || !ownerDocument?.createRange || !pageElement.contains?.(compositionElement)) return null;
    const first = segmentGraphemes(text, languageKey || 'und')[0];
    if (!first) return null;
    const pageRect = finiteRect(pageElement.getBoundingClientRect?.());
    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return null;
    const scaleX = Number(pageElement.offsetWidth) / pageRect.width;
    const scaleY = Number(pageElement.offsetHeight) / pageRect.height;
    const left = Number.parseFloat(compositionElement.style?.left);
    const top = Number.parseFloat(compositionElement.style?.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

    let range;
    let translation;
    try {
        range = ownerDocument.createRange();
        range.setStart(textNode, first.index);
        range.setEnd(textNode, first.end);
        const rects = [...(range.getClientRects?.() || [])];
        if (!rects.length && range.getBoundingClientRect) rects.push(range.getBoundingClientRect());
        for (const compositionRect of rects) {
            translation = resolveFlowDirectCompositionTranslation({
                writingMode, caretRect, compositionRect, scaleX, scaleY,
            });
            if (translation) break;
        }
    } catch (_) {
        return null;
    } finally {
        range?.detach?.();
    }
    if (!translation) return null;
    const alignedLeft = left + translation.leftDelta;
    const alignedTop = top + translation.topDelta;
    if (!Number.isFinite(alignedLeft) || !Number.isFinite(alignedTop)) return null;
    compositionElement.style.left = `${alignedLeft}px`;
    compositionElement.style.top = `${alignedTop}px`;
    return Object.freeze({ ...translation, left: alignedLeft, top: alignedTop });
}
