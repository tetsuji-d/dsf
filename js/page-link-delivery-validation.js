/** Untrusted release extension validation, independent of authoring state and the DOM. */
const formats=new Set(['plain','lower','paren','upper','suffix','kanji']);
export function validDeliveryPageLinks(page,pages) {
    if(page.pageLinks===undefined)return true;
    if(!Array.isArray(page.pageLinks)||page.pageLinks.length>1000)return false;
    const ids=new Set();
    return page.pageLinks.every(l=>{
        if(!l||typeof l.id!=='string'||!l.id||l.id.length>200||ids.has(l.id)||!pages.some(p=>p.id===l.targetPageId)
            ||!Number.isSafeInteger(l.number)||l.number<1||!formats.has(l.format)||typeof l.label!=='string'||l.label.length>100
            ||!Array.isArray(l.rects)||!Array.isArray(l.textRegions)||l.rects.length+l.textRegions.length<1||l.rects.length+l.textRegions.length>2000)return false;
        ids.add(l.id);
        return l.rects.every(r=>r&&Object.values(r).every(Number.isFinite)&&r.width>0&&r.height>0&&r.x>=0&&r.y>=0&&r.x+r.width<=360.01&&r.y+r.height<=640.01)
            &&l.textRegions.every(r=>{if(!r)return false;const text=page.lines?.[r.lineIndex]?.runs?.[r.runIndex]?.text;return r&&[r.lineIndex,r.runIndex,r.start,r.end].every(Number.isSafeInteger)&&r.lineIndex>=0&&r.runIndex>=0&&r.start>=0&&r.end>r.start&&typeof text==='string'&&r.end<=text.length;});
    });
}
