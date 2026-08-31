/** Explicit, source-preserving whitespace rendering for fixed delivery lines. */
export const FIXED_TEXT_WHITE_SPACE_MODE = 'preserve-v1';
export const FIXED_TEXT_TAB_SIZE = 8;

function assertMode(mode) {
    if (mode !== undefined && mode !== FIXED_TEXT_WHITE_SPACE_MODE) {
        const error = new RangeError('Unsupported fixed-text whitespace mode.');
        error.code = 'UNSUPPORTED_FIXED_TEXT_WHITE_SPACE_MODE';
        throw error;
    }
}

export function applyFixedTextWhiteSpaceStyle(element, mode) {
    assertMode(mode);
    if (mode === undefined) return;
    element.style.whiteSpace = 'pre';
    element.style.tabSize = String(FIXED_TEXT_TAB_SIZE);
    element.style.textWrap = 'nowrap';
    // preserve-v1 captures LTR inline progression in either writing mode.
    element.style.direction = 'ltr';
}

/**
 * Return Text-node ranges in the original run's UTF-16 offsets (end exclusive).
 * Hidden CR/LF nodes preserve source text without introducing another fixed line.
 * An omitted mode preserves the legacy textContent-only DOM exactly.
 */
export function renderFixedTextRunText(element, text, mode, documentRef = element?.ownerDocument) {
    assertMode(mode);
    if (typeof text !== 'string') throw new TypeError('Fixed-text run text must be a string.');
    if (mode === undefined || !/[\r\n]/.test(text)) {
        element.textContent = text;
        return element.firstChild?.nodeType === 3
            ? [{ node: element.firstChild, start: 0, end: text.length, lineBreak: false }]
            : [];
    }
    if (!documentRef?.createTextNode || !documentRef?.createElement) {
        throw new TypeError('Whitespace rendering requires a DOM document.');
    }
    element.textContent = '';
    const ranges = [];
    for (const match of text.matchAll(/[^\r\n]+|[\r\n]+/g)) {
        const value = match[0];
        const lineBreak = /^[\r\n]/.test(value);
        const node = documentRef.createTextNode(value);
        if (lineBreak) {
            const hidden = documentRef.createElement('span');
            hidden.style.display = 'none';
            hidden.append(node);
            element.append(hidden);
        } else {
            element.append(node);
        }
        ranges.push({ node, start: match.index, end: match.index + value.length, lineBreak });
    }
    return ranges;
}
