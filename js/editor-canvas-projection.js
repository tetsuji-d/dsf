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
