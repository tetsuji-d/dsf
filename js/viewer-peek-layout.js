/** Share the reading spread order; never infer physical sides from a body index. */
export function getViewerPeekLayout({units, covers, sourceIndex, rtl, bodyPageCount}) {
    const spreads = units.filter(unit => unit.type === 'spread');
    const position = spreads.findIndex(unit => [unit.left, unit.right].some(surface => surface?.sourcePageIndex === sourceIndex));
    if (position < 0) return null;
    const frontSide = rtl ? 1 : -1;
    const boundary = position === 0 ? 'start' : position === spreads.length - 1 ? 'end' : '';
    const boards = [
        {side:frontSide, outside:covers.c1, inside:covers.c2, role:'C1', insideRole:'C2'},
        {side:-frontSide, outside:covers.c4, inside:covers.c3, role:'C4', insideRole:'C3'},
    ];
    const layers = [];
    // Back-to-front painter order, with every neighbour on its original physical side.
    for (let distance = boundary ? 0 : 2; distance >= 0; distance--) {
        for (const side of [-1, 1]) {
            const unit = spreads[position + distance * (side === frontSide ? -1 : 1)];
            if (!unit) continue;
            const surface = side < 0 ? unit.left : unit.right;
            layers.push({surface, side, extent:boundary ? 1 : [.57,.82,1][distance],
                active:distance === 0, selected:distance === 0 && surface?.sourcePageIndex === sourceIndex});
        }
    }
    const isBody = surface => surface && !surface.virtualBlank && /^P\d+$/i.test(surface.bookRole || '');
    const before = spreads.slice(0,position).reduce((n,unit) => n + [unit.left,unit.right].filter(isBody).length,0)
        + Number(isBody(rtl ? spreads[position].right : spreads[position].left));
    return {position, boundary, boards, layers, ratio:Math.min(1,before/Math.max(1,bodyPageCount))};
}
