import { mapFlowFragmentDomOffsetToSource, mapFlowTextUtf16OffsetToGrapheme } from './flow-source-mapping.js';
/** Runtime presentation helpers. Never mutate or serialize generated pages into authoring data. */
export function findEditorCanvasFlowPageIndex(pages, groupId, flowPageIndex) {
    return pages.findIndex(page => page.kind === 'flow' && page.groupId === groupId
        && page.flowPageIndex === flowPageIndex);
}

export function getEditorCanvasSpreadJoins(pages) {
    const joins = [];
    for (let index = 1; index < pages.length; index += 1) {
        const a = pages[index - 1], b = pages[index];
        if (a.kind === 'fixed' && b.kind === 'fixed' && a.section?.spreadImage?.groupId
            && a.section.spreadImage.groupId === b.section?.spreadImage?.groupId) joins.push(index);
    }
    return joins;
}

/** Resolve the current editing caret, otherwise the selected page's first semantic fragment. */
export function resolveEditorFlowSourcePoint(group, page, session = null, selection = {}) {
    if (!group || group.kind !== 'flow') return null;
    const language = page?.languageKey || group.flow.document.sourceLanguage;
    if (session?.groupId === group.id && session.languageKey === language) {
        const block = group.flow.document.sections.find(s => s.id === session.sectionId)
            ?.blocks.find(b => b.id === session.blockId);
        const text = block?.texts?.[language] || '';
        if (block && text === session.expectedText) {
            const offset = selection.direction === 'backward' ? selection.start : selection.end;
            const mapped = mapFlowTextUtf16OffsetToGrapheme(text, offset ?? session.sourcePoint.utf16Offset, language);
            return { ...session.sourcePoint, ...mapped };
        }
    }
    const fragment = page?.page?.fragments?.find(f => ['paragraph', 'heading'].includes(f.blockType));
    if (fragment) return mapFlowFragmentDomOffsetToSource(fragment, 0, { affinity: 'forward' });
    for (const section of group.flow.document.sections) {
        const block = section.blocks.find(b => ['paragraph', 'heading'].includes(b.type));
        if (block) return { sectionId: section.id, blockId: block.id, blockType: block.type,
            languageKey: language, utf16Offset: 0, graphemeOffset: 0, affinity: 'forward' };
    }
    return null;
}

/** A displayed page boundary maps to source text, never a generated page ID. */
export function resolveEditorFlowPageBoundary(page, position) {
    if (!page || page.isSourceFallback) return null;
    const fragments = page.page?.fragments?.filter(f => ['paragraph', 'heading'].includes(f.blockType)) || [];
    const fragment = position === 'before' ? fragments[0] : fragments.at(-1);
    return fragment ? mapFlowFragmentDomOffsetToSource(fragment,
        position === 'before' ? 0 : fragment.text.length,
        { affinity: position === 'before' ? 'forward' : 'backward' }) : null;
}
