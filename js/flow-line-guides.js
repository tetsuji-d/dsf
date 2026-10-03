/** Paint-only guides derived from actual text runs, including wrapped regions. */
export function measureFlowLineGuides(surface, pageBox) {
    const page = surface.getBoundingClientRect(), sx = page.width/pageBox.width, sy=page.height/pageBox.height;
    if (!sx || !sy) return [];
    const lines=[];
    for (const block of surface.querySelectorAll('.flow-dom-block')) {
        const vertical=getComputedStyle(block).writingMode==='vertical-rl';
        const rows=[];const walker=surface.ownerDocument.createTreeWalker(block,NodeFilter.SHOW_TEXT);
        for(let node=walker.nextNode();node;node=walker.nextNode()) {
            if(!node.textContent.trim() || node.parentElement.closest('rt,[data-annotation-text]'))continue;
            const range=surface.ownerDocument.createRange();range.selectNodeContents(node);
            for(const rect of range.getClientRects()) {
                if(rect.width<.1 || rect.height<.1)continue;
                const r={x:(rect.left-page.left)/sx,y:(rect.top-page.top)/sy,width:rect.width/sx,height:rect.height/sy};
                const row=rows.find(a=>vertical ? Math.abs(a.x-r.x)<1 && Math.abs(a.width-r.width)<2 : Math.abs(a.y-r.y)<1 && Math.abs(a.height-r.height)<2);
                if(row){const x=Math.min(row.x,r.x),y=Math.min(row.y,r.y);row.width=Math.max(row.x+row.width,r.x+r.width)-x;row.height=Math.max(row.y+row.height,r.y+r.height)-y;row.x=x;row.y=y;}
                else rows.push(r);
            }
        }
        for(const r of rows)lines.push({...r,vertical,blockId:block.dataset.flowBlockId});
    }
    return lines;
}
export function paintFlowLineGuides(surface,pageBox,enabled) {
    surface.querySelector(':scope > .flow-line-guides')?.remove();
    if(!enabled || !surface.isConnected)return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.classList.add('flow-line-guides');svg.setAttribute('viewBox',`0 0 ${pageBox.width} ${pageBox.height}`);
    svg.setAttribute('aria-hidden','true');
    const active=document.querySelector('.flow-direct-input-proxy')?.dataset.flowBlockId;
    for(const r of measureFlowLineGuides(surface,pageBox)){
        const line=document.createElementNS(ns,'line');line.dataset.flowBlockId=r.blockId;
        line.classList.toggle('active',r.blockId===active);
        const x=r.vertical?r.x+r.width+1:r.x,y=r.vertical?r.y:r.y+r.height+1;
        for(const [key,value] of Object.entries({x1:x,y1:y,x2:r.vertical?x:x+r.width,y2:r.vertical?y+r.height:y}))line.setAttribute(key,String(value));
        svg.append(line);
    }
    surface.append(svg);
}
