/** Presentation only. Never changes edition identity, contents or permissions. */
export function normalizeEmbedDisplay(value = {}) {
    const page=Number(value.startPage);
    return { layout: ['auto', 'single', 'spread'].includes(value.layout) ? value.layout : 'auto', bookEdges: value.bookEdges !== false && value.bookEdges !== '0', view:value.view==='book'?'book':'flat', startPage:Number.isSafeInteger(page)&&page>=1?Math.min(page,100000):1 };
}
export function embedStartIndex(page,total){return Math.max(0,Math.min(normalizeEmbedDisplay({startPage:page}).startPage-1,Math.max(0,total-1)));}
export function resolveEmbedStart({page,total,intent,groups=[],spread=false}){
    const initial=embedStartIndex(page,total);
    if(intent?.type==='seek')return Math.max(0,Math.min(intent.index,total-1));
    if(intent?.type!=='step')return initial;
    if(spread&&groups.length){const at=groups.findIndex(g=>g.includes(initial));return groups[Math.max(0,Math.min(groups.length-1,at+intent.delta))]?.[0]??initial;}
    return Math.max(0,Math.min(total-1,initial+intent.delta));
}
export function useEmbedSpread(width, height, layout = 'auto', wasSpread = false) {
    if (layout === 'single') return false;
    // Hysteresis prevents repeated flips around the breakpoint. A page must
    // remain at least 280px wide after fitting the available height.
    const minimum = wasSpread ? 624 : 640;
    return width >= minimum && Math.min((width - 16) / 2, height * 9 / 16) >= 280;
}
