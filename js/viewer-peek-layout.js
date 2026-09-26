import {PEEK_PAGE_WIDTH} from './viewer-peek-geometry.js';
// Keep the source sheet at 360 x 640; separation comes from bending, not stretching.
export const VIEWER_PEEK_OPEN_EXTENT = .48;
export const VIEWER_PEEK_PAGE_REACH = PEEK_PAGE_WIDTH;

/** Share the reading spread order; never infer physical sides from a body index. */
export function getViewerPeekLayout({units, covers, sourceIndex, rtl, bodyPageCount}) {
    const spreads = units.filter(unit => unit.type === 'spread');
    const position = spreads.findIndex(unit => [unit.left, unit.right].some(surface => surface?.sourcePageIndex === sourceIndex));

    const frontSide = rtl ? 1 : -1;
    const boundary = position === 0 ? 'start' : position === spreads.length - 1 ? 'end' : '';
    const boards = [
        {side:frontSide, outside:covers.c1, inside:covers.c2, role:'C1', insideRole:'C2'},
        {side:-frontSide, outside:covers.c4, inside:covers.c3, role:'C4', insideRole:'C3'},
    ];
    const exterior=Number.isInteger(sourceIndex)&&boards.find(board=>board.outside?.sourcePageIndex===sourceIndex&&!board.outside?.virtualBlank);
    if(exterior)return {exterior:true,role:exterior.role,surface:exterior.outside,position:exterior.role==='C1'?-1:spreads.length,ratio:exterior.role==='C1'?0:1,boards,layers:[],boundary:exterior.role};
    if (position < 0) return null;
    const layers = [];
    // Back-to-front painter order, with every neighbour on its original physical side.
    for (let distance = boundary ? 0 : 2; distance >= 0; distance--) {
        for (const side of [-1, 1]) {
            const unit = spreads[position + distance * (side === frontSide ? -1 : 1)];
            if (!unit) continue;
            const surface = side < 0 ? unit.left : unit.right;
            layers.push({surface, side, extent:boundary ? 1 : [VIEWER_PEEK_OPEN_EXTENT,.74,1][distance],
                active:distance === 0, selected:distance === 0 && surface?.sourcePageIndex === sourceIndex});
        }
    }
    const isBody = surface => surface && !surface.virtualBlank && /^P\d+$/i.test(surface.bookRole || '');
    const before = spreads.slice(0,position).reduce((n,unit) => n + [unit.left,unit.right].filter(isBody).length,0)
        + Number(isBody(rtl ? spreads[position].right : spreads[position].left));
    return {position, boundary, boards, layers, ratio:Math.min(1,before/Math.max(1,bodyPageCount))};
}

/** Every selectable face, including rigid exterior covers at the two ends. */
export function getViewerPeekItems({units, bodyPages}) {
    const body=bodyPages.filter(s=>!s.virtualBlank&&Number.isInteger(s.sourcePageIndex));
    const ends={};
    for(const unit of units.filter(u=>u.type==='spread')){
        const faces=[unit.left,unit.right];
        for(const s of faces)if(/^C[23]$/.test(s?.bookRole||s?.role||'')&&Number.isInteger(s.sourcePageIndex)&&!s.virtualBlank)ends[s.bookRole||s.role]=s;
    }
    const exterior=units.filter(unit=>unit.type==='single').map(unit=>unit.center);
    const cover=role=>exterior.find(s=>(s?.bookRole||s?.role)===role&&!s.virtualBlank&&Number.isInteger(s.sourcePageIndex));
    return [cover('C1'),ends.C2,...body,ends.C3,cover('C4')].filter(Boolean);
}
