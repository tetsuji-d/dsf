/**
 * Pure adapter between the temporary continuous-text preview UI and the
 * semantic FlowDocument introduced in Commit 2.
 *
 * This module is intentionally unaware of Studio state, persistence, and DOM.
 */

import { FLOW_DOCUMENT_SCHEMA_VERSION, FLOW_LAYOUT_TYPE } from './flow-document.js';
import { countGraphemes } from './grapheme.js';

export const FLOW_PREVIEW_PAGE_BREAK_MARKER = '[[PAGE_BREAK]]';

function normalizeNewlines(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n');
}

function createParagraph(id, languageKey, text) {
    return {
        id,
        type: 'paragraph',
        texts: { [languageKey]: text },
    };
}

function tokenizeFlowPreviewBody(body, marker) {
    return normalizeNewlines(body).split('\n').map((line) => (
        line === marker
            ? { type: 'pageBreak' }
            : { type: 'paragraph', text: line }
    ));
}

function getPreviewBlockText(block, languageKey) {
    return block?.type === 'paragraph' && typeof block.texts?.[languageKey] === 'string'
        ? block.texts[languageKey]
        : '';
}

function tokenMatchesBlock(token, block, languageKey) {
    return token.type === block?.type
        && (token.type !== 'paragraph' || token.text === getPreviewBlockText(block, languageKey));
}

function freezePreviewBlock(block) {
    if (block.type === 'paragraph') Object.freeze(block.texts);
    return Object.freeze(block);
}

function freezePreviewSourceState(state) {
    return Object.freeze({
        ...state,
        blocks: Object.freeze([...state.blocks]),
    });
}

/**
 * Convert the preview textarea into semantic paragraph/pageBreak blocks.
 * Each entered line is one paragraph, including empty lines. The marker is a
 * UI-only notation and is converted into an actual pageBreak block.
 */
export function parseFlowPreviewBody(body, options = {}) {
    const languageKey = String(options.languageKey || 'ja');
    const marker = String(options.pageBreakMarker || FLOW_PREVIEW_PAGE_BREAK_MARKER);
    const tokens = tokenizeFlowPreviewBody(body, marker);
    const blocks = [];
    let paragraphIndex = 0;
    let pageBreakIndex = 0;

    for (const token of tokens) {
        if (token.type === 'pageBreak') {
            pageBreakIndex += 1;
            blocks.push({
                id: `flow_preview_page_break_${pageBreakIndex}`,
                type: 'pageBreak',
            });
            continue;
        }
        paragraphIndex += 1;
        blocks.push(createParagraph(
            `flow_preview_paragraph_${paragraphIndex}`,
            languageKey,
            token.text,
        ));
    }
    return blocks;
}

/** Create an in-memory textarea source whose block IDs survive later edits. */
export function createFlowPreviewSourceState(body, options = {}) {
    const languageKey = String(options.languageKey || 'ja');
    const marker = String(options.pageBreakMarker || FLOW_PREVIEW_PAGE_BREAK_MARKER);
    const normalizedBody = normalizeNewlines(body);
    const tokens = tokenizeFlowPreviewBody(normalizedBody, marker);
    let nextParagraphOrdinal = 1;
    let nextPageBreakOrdinal = 1;
    const blocks = tokens.map((token) => {
        if (token.type === 'pageBreak') {
            const id = `flow_preview_page_break_${nextPageBreakOrdinal}`;
            nextPageBreakOrdinal += 1;
            return freezePreviewBlock({ id, type: 'pageBreak' });
        }
        const id = `flow_preview_paragraph_${nextParagraphOrdinal}`;
        nextParagraphOrdinal += 1;
        return freezePreviewBlock(createParagraph(id, languageKey, token.text));
    });
    return freezePreviewSourceState({
        languageKey,
        pageBreakMarker: marker,
        body: normalizedBody,
        blocks,
        nextParagraphOrdinal,
        nextPageBreakOrdinal,
    });
}

/**
 * Reconcile textarea lines while retaining semantic identity.
 *
 * Exact prefix/suffix blocks keep their objects. In the changed middle, blocks
 * of the same type keep their IDs by position: editing keeps an ID, splitting
 * keeps the left ID, and merging keeps the first ID. Only genuinely new or
 * type-changed blocks receive a new ID.
 */
export function reconcileFlowPreviewSourceState(previousState, body, options = {}) {
    if (!previousState || !Array.isArray(previousState.blocks)) {
        return createFlowPreviewSourceState(body, options);
    }
    const languageKey = String(options.languageKey || previousState.languageKey || 'ja');
    const marker = String(options.pageBreakMarker || previousState.pageBreakMarker || FLOW_PREVIEW_PAGE_BREAK_MARKER);
    const normalizedBody = normalizeNewlines(body);
    if (
        previousState.languageKey === languageKey
        && previousState.pageBreakMarker === marker
        && previousState.body === normalizedBody
    ) {
        return previousState;
    }

    if (previousState.languageKey !== languageKey || previousState.pageBreakMarker !== marker) {
        return createFlowPreviewSourceState(normalizedBody, { languageKey, pageBreakMarker: marker });
    }

    const tokens = tokenizeFlowPreviewBody(normalizedBody, marker);
    const oldBlocks = previousState.blocks;
    let prefixLength = 0;
    while (
        prefixLength < oldBlocks.length
        && prefixLength < tokens.length
        && tokenMatchesBlock(tokens[prefixLength], oldBlocks[prefixLength], languageKey)
    ) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    while (
        suffixLength < oldBlocks.length - prefixLength
        && suffixLength < tokens.length - prefixLength
        && tokenMatchesBlock(
            tokens[tokens.length - 1 - suffixLength],
            oldBlocks[oldBlocks.length - 1 - suffixLength],
            languageKey,
        )
    ) {
        suffixLength += 1;
    }

    let nextParagraphOrdinal = Number(previousState.nextParagraphOrdinal) || 1;
    let nextPageBreakOrdinal = Number(previousState.nextPageBreakOrdinal) || 1;
    const allocateBlock = (token) => {
        if (token.type === 'pageBreak') {
            const id = `flow_preview_page_break_${nextPageBreakOrdinal}`;
            nextPageBreakOrdinal += 1;
            return freezePreviewBlock({ id, type: 'pageBreak' });
        }
        const id = `flow_preview_paragraph_${nextParagraphOrdinal}`;
        nextParagraphOrdinal += 1;
        return freezePreviewBlock(createParagraph(id, languageKey, token.text));
    };
    const updateBlock = (oldBlock, token) => {
        if (!oldBlock || oldBlock.type !== token.type) return allocateBlock(token);
        if (token.type === 'pageBreak') return oldBlock;
        if (getPreviewBlockText(oldBlock, languageKey) === token.text) return oldBlock;
        return freezePreviewBlock(createParagraph(oldBlock.id, languageKey, token.text));
    };

    const blocks = oldBlocks.slice(0, prefixLength);
    const oldMiddleEnd = oldBlocks.length - suffixLength;
    const newMiddleEnd = tokens.length - suffixLength;
    const oldMiddle = oldBlocks.slice(prefixLength, oldMiddleEnd);
    const newMiddle = tokens.slice(prefixLength, newMiddleEnd);
    for (let index = 0; index < newMiddle.length; index += 1) {
        blocks.push(updateBlock(oldMiddle[index], newMiddle[index]));
    }
    if (suffixLength > 0) blocks.push(...oldBlocks.slice(oldMiddleEnd));

    return freezePreviewSourceState({
        languageKey,
        pageBreakMarker: marker,
        body: normalizedBody,
        blocks,
        nextParagraphOrdinal,
        nextPageBreakOrdinal,
    });
}

export function countFlowPreviewSourceGraphemes(heading, body, languageKey = 'ja') {
    return countGraphemes(String(heading ?? ''), languageKey)
        + countGraphemes(normalizeNewlines(body), languageKey);
}

/** Build a deterministic in-memory FlowDocument for the preview harness. */
export function createFlowPreviewDocument(options = {}) {
    const languageKey = String(options.languageKey || 'ja');
    const heading = String(options.heading ?? '');
    const sourceState = options.sourceState;
    const blocks = [];
    if (heading) {
        blocks.push({
            id: 'flow_preview_heading',
            type: 'heading',
            level: 1,
            texts: { [languageKey]: heading },
        });
    }
    if (sourceState && Array.isArray(sourceState.blocks) && sourceState.languageKey === languageKey) {
        blocks.push(...sourceState.blocks);
    } else {
        blocks.push(...parseFlowPreviewBody(options.body, {
            languageKey,
            pageBreakMarker: options.pageBreakMarker,
        }));
    }

    return {
        schemaVersion: FLOW_DOCUMENT_SCHEMA_VERSION,
        layoutType: FLOW_LAYOUT_TYPE,
        id: 'flow_preview_document',
        sourceLanguage: languageKey,
        sections: [{
            id: 'flow_preview_section',
            title: { [languageKey]: heading },
            blocks,
        }],
    };
}

/** Insert the UI marker as its own line without deleting selected source text. */
export function insertFlowPreviewPageBreak(value, selectionStart, selectionEnd, options = {}) {
    const text = normalizeNewlines(value);
    const marker = String(options.pageBreakMarker || FLOW_PREVIEW_PAGE_BREAK_MARKER);
    const start = Math.max(0, Math.min(text.length, Number(selectionStart) || 0));
    const before = text.slice(0, start);
    const selectionLimit = Number.isFinite(Number(selectionEnd)) ? Number(selectionEnd) : start;
    const end = Math.max(start, Math.min(text.length, selectionLimit));
    const after = text.slice(start);
    const leadingNewline = before && !before.endsWith('\n') ? '\n' : '';
    const trailingNewline = !after.startsWith('\n') ? '\n' : '';
    const insertion = `${leadingNewline}${marker}${trailingNewline}`;
    const nextValue = `${before}${insertion}${after}`;
    const cursor = before.length + insertion.length;
    return {
        value: nextValue,
        selectionStart: cursor,
        selectionEnd: cursor + (end - start),
        selectionDirection: ['forward', 'backward'].includes(options.selectionDirection)
            ? options.selectionDirection
            : 'none',
    };
}
