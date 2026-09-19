/** Semantic, read-only search. Shared by the UI and future tool adapters. */
export function resolveFlowSearchTarget(blocks, match) {
    const group = blocks?.find(b => b.kind === 'flow' && b.id === match?.groupId);
    const section = group?.flow.document.sections.find(s => s.id === match.sectionId);
    const block = section?.blocks.find(b => b.id === match.blockId);
    if (!block || block.texts?.[match.languageKey] !== match.expectedText) return null;
    return { group, section, block };
}

export function* iterateFlowTextMatches(blocks, { query = '', languageKey, groupId = null, caseSensitive = false } = {}) {
    if (typeof query !== 'string' || query.length > 512 || !languageKey) throw new Error('INVALID_SEARCH');
    if (!query) return;
    // Literal matching only. RegExp keeps offsets in the original string even for case folding.
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
    const segmenter = new Intl.Segmenter(languageKey, { granularity: 'grapheme' });
    for (const group of blocks || []) {
        if (group.kind !== 'flow' || groupId && group.id !== groupId) continue;
        for (const section of group.flow.document.sections) for (const block of section.blocks) {
            const text = block.texts?.[languageKey];
            if (!['heading', 'paragraph'].includes(block.type) || typeof text !== 'string') continue;
            // Never match half an emoji or a combining character; no source-language fallback.
            const boundaries = new Set([...segmenter.segment(text)].map(s => s.index));
            boundaries.add(text.length);
            pattern.lastIndex = 0;
            for (const found of text.matchAll(pattern)) {
                const start = found.index, end = start + found[0].length;
                if (!boundaries.has(start) || !boundaries.has(end)) continue;
                yield { groupId: group.id, sectionId: section.id, blockId: block.id,
                    languageKey, start, end, expectedText: text };
            }
        }
    }
}

export function searchFlowText(blocks, options = {}) {
    const matches = [], maximum = Math.min(1000, Math.max(1, Number(options.limit) || 1000));
    for (const match of iterateFlowTextMatches(blocks, options)) {
        if (matches.length >= maximum) return {matches, truncated:true};
        matches.push(match);
    }
    return {matches, truncated:false};
}
