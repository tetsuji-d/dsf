/** Shared safety gate for lossless direct paragraph joins. */
export function inspectFlowParagraphMerge(left, right) {
    if (JSON.stringify(left.titleRegion || null) !== JSON.stringify(right.titleRegion || null)) return 'TITLE_BOUNDARY';
    for (const key of Object.keys(right)) {
        if (['id', 'type', 'texts', 'annotations', 'titleRegion'].includes(key)) continue;
        if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return 'METADATA_CONFLICT';
    }
    return null;
}
