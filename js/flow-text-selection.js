/** Runtime-only, source-based selection. Generated page boundaries never add text. */
import { mapFlowTextUtf16OffsetToGrapheme } from './flow-source-mapping.js';

function sourceRows(group) {
    return group?.flow?.document?.sections?.flatMap(section => section.blocks.map(block => ({
        sectionId: section.id, blockId: block.id, blockType: block.type,
        text: block.texts?.[group.flow.document.sourceLanguage] ?? '',
    }))) ?? [];
}

export function createFlowTextSelection(group, anchor, focus) {
    const language = group?.flow?.document?.sourceLanguage;
    if (group?.kind !== 'flow' || !language || anchor?.languageKey !== language || focus?.languageKey !== language) return null;
    const rows = sourceRows(group);
    const resolve = point => {
        const index = rows.findIndex(row => row.sectionId === point.sectionId && row.blockId === point.blockId);
        const row = rows[index];
        if (!row || !['paragraph', 'heading'].includes(row.blockType)
            || !Number.isInteger(point.utf16Offset) || point.utf16Offset < 0 || point.utf16Offset > row.text.length) return null;
        const mapped = mapFlowTextUtf16OffsetToGrapheme(row.text, point.utf16Offset, language, point.affinity);
        if (mapped.utf16Offset !== point.utf16Offset) return null;
        return { index, point: { ...point, blockType: row.blockType, graphemeOffset: mapped.graphemeOffset } };
    };
    const a = resolve(anchor), f = resolve(focus);
    if (!a || !f) return null;
    const backward = a.index > f.index || (a.index === f.index && anchor.utf16Offset > focus.utf16Offset);
    const [start, end] = backward ? [f, a] : [a, f];
    const ranges = [];
    const parts = [];
    for (let i = start.index; i <= end.index; i++) {
        const row = rows[i];
        if (row.blockType === 'pageBreak') { parts.push(''); continue; }
        if (!['paragraph', 'heading'].includes(row.blockType)) return null;
        const from = i === start.index ? start.point.utf16Offset : 0;
        const to = i === end.index ? end.point.utf16Offset : row.text.length;
        ranges.push({ ...row, languageKey: language, start: from, end: to });
        parts.push(row.text.slice(from, to));
    }
    return Object.freeze({ groupId: group.id, anchor: a.point, focus: f.point,
        start: start.point, end: end.point, backward, ranges, text: parts.join('\n'),
        collapsed: a.index === f.index && anchor.utf16Offset === focus.utf16Offset,
        signature: JSON.stringify(rows), languageKey: language });
}

export function validateFlowTextSelection(group, selection) {
    if (!selection || group?.id !== selection.groupId
        || group.flow?.document?.sourceLanguage !== selection.languageKey
        || JSON.stringify(sourceRows(group)) !== selection.signature) return null;
    return selection;
}
