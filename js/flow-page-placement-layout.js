import {resolvePagePlacement} from './flow-page-placement.js';
import {renderFlowGeneratedPage} from './flow-dom-measurer.js';
/** Apply placement after pagination; text fragments and canonical wrap regions are unchanged. */
export function applyFlowPagePlacements(group,pagination,{ownerDocument=globalThis.document,typography}={}){
    if(!group.flow.layout.pagePlacements?.length)return pagination;
    const pages=pagination.pages.map(p=>({...p})),host=ownerDocument.createElement('div');
    Object.assign(host.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',pointerEvents:'none'});ownerDocument.body.append(host);
    try{for(const page of pages){
        const r=resolvePagePlacement(group,page,pagination.languageKey);if(!r.anchors.length)continue;
        const offset={x:0,y:0,blockAlign:r.blockAlign};page.placementOffset=offset;
        if(r.conflict){offset.conflict=true;continue;}
        const surface=ownerDocument.createElement('div');host.replaceChildren(surface);
        renderFlowGeneratedPage(surface,{page,pageBox:pagination.pageBox,languageKey:pagination.languageKey,writingMode:pagination.writingMode,typography});
        const origin=surface.getBoundingClientRect(),rects=[];
        for(const block of surface.querySelectorAll('.flow-dom-block')){
            const walker=ownerDocument.createTreeWalker(block,4);
            for(let node=walker.nextNode();node;node=walker.nextNode()){
                if(!node.textContent.length)continue;const range=ownerDocument.createRange();range.selectNodeContents(node);
                for(const rect of range.getClientRects())if(rect.width&&rect.height)rects.push({x:rect.x-origin.x,y:rect.y-origin.y,width:rect.width,height:rect.height});
            }
        }
        if(page.anchoredObject)rects.push(page.anchoredObject);
        if(!rects.length)continue;
        const box=pagination.pageBox.contentBox,vertical=pagination.writingMode==='vertical-rl',axis=vertical?'x':'y',size=vertical?'width':'height';
        const start=Math.min(...rects.map(b=>b[axis])),end=Math.max(...rects.map(b=>b[axis]+b[size]));
        // start is right for vertical text, top for horizontal text.
        const position=r.blockAlign==='center'?box[axis]+(box[size]-(end-start))/2:
            ((r.blockAlign==='start')===vertical?box[axis]+box[size]-(end-start):box[axis]);
        const delta=position-start;
        if(end-start>box[size]+.5){offset.blocked=true;continue;}
        offset[axis]=Math.round(delta*1000)/1000;
    }}finally{host.remove();}
    return {...pagination,pages};
}
