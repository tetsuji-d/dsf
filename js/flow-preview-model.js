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

/**
 * Convert the preview textarea into semantic paragraph/pageBreak blocks.
 * Each entered line is one paragraph, including empty lines. The marker is a
 * UI-only notation and is converted into an actual pageBreak block.
 */
export function parseFlowPreviewBody(body, options = {}) {
    const languageKey = String(options.languageKey || 'ja');
    const marker = String(options.pageBreakMarker || FLOW_PREVIEW_PAGE_BREAK_MARKER);
    const lines = normalizeNewlines(body).split('\n');
    const blocks = [];
    let paragraphIndex = 0;
    let pageBreakIndex = 0;

    for (const line of lines) {
        if (line === marker) {
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
            line,
        ));
    }
    return blocks;
}

export function countFlowPreviewSourceGraphemes(heading, body, languageKey = 'ja') {
    return countGraphemes(String(heading ?? ''), languageKey)
        + countGraphemes(normalizeNewlines(body), languageKey);
}

/** Build a deterministic in-memory FlowDocument for the preview harness. */
export function createFlowPreviewDocument(options = {}) {
    const languageKey = String(options.languageKey || 'ja');
    const heading = String(options.heading ?? '');
    const blocks = [];
    if (heading) {
        blocks.push({
            id: 'flow_preview_heading',
            type: 'heading',
            level: 1,
            texts: { [languageKey]: heading },
        });
    }
    blocks.push(...parseFlowPreviewBody(options.body, {
        languageKey,
        pageBreakMarker: options.pageBreakMarker,
    }));

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
    };
}
