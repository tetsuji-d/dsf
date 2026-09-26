import {getBookSpinePresentation,renderBookSpine} from './book-spine-design.js';

/** Closed covers are rigid planes, with a real side face and a visible paper head. */
export function createViewerPeekCover({layout,snapshot,renderSurface,project}) {
    const group=document.createElement('div');group.className='edge-fan-closed';group.dataset.cover=layout.role;
    const side=snapshot.rtl?1:-1,depth=Math.max(2,Math.min(64,snapshot.thickness||8));
    const dx=side*depth*.8,dy=-Math.min(14,3+depth*.2);
    const front=[{x:225,y:48},{x:575,y:30},{x:575,y:652},{x:225,y:670}].map(p=>({x:p.x-dx/2,y:p.y+10-dy/2}));
    const rear=front.map(p=>({x:p.x+dx,y:p.y+dy}));
    const color=snapshot.design?.backgroundColor||'#173d42';
    const ns='http://www.w3.org/2000/svg',head=document.createElementNS(ns,'svg');head.setAttribute('viewBox','0 0 800 720');head.classList.add('edge-cover-head');
    const polygon=document.createElementNS(ns,'polygon');polygon.setAttribute('points',[rear[0],rear[1],front[1],front[0]].map(p=>`${p.x},${p.y}`).join(' '));polygon.setAttribute('fill','#ded8c5');polygon.setAttribute('stroke',color);polygon.setAttribute('stroke-width','1');head.append(polygon);
    for(let i=1;i<Math.min(16,Math.ceil(depth));i++){
        const t=i/Math.min(16,Math.ceil(depth)),line=document.createElementNS(ns,'path');line.setAttribute('d',`M${front[0].x+dx*t} ${front[0].y+dy*t} L${front[1].x+dx*t} ${front[1].y+dy*t}`);line.setAttribute('stroke','#ada58f');line.setAttribute('stroke-width','.45');head.append(line);
    }
    group.append(head);
    const make=(points,width,cls)=>{
        const sheet=document.createElement('div');sheet.className='edge-fan-sheet '+cls;
        const strip=document.createElement('div');strip.className='edge-fan-strip';strip.dataset.sourceStart=0;
        strip.dataset.rasterScale=matchMedia('(pointer:coarse)').matches?Math.max(1,Math.min(2,3/(devicePixelRatio||1))):2;
        const content=document.createElement('div');content.className='edge-peek-content';content.style.width=width+'px';strip.append(content);sheet.append(strip);group.append(sheet);
        return {sheet,strip,content,paint:()=>project(strip,points,width)};
    };
    const points=side>0?[front[1],rear[1],rear[2],front[2]]:[rear[0],front[0],front[3],rear[3]];
    const edge=make(points,depth,layout.role==='C1'?'edge-cover-spine':'edge-cover-fore-edge');
    if(layout.role==='C1')renderBookSpine(edge.content,getBookSpinePresentation(snapshot.design,{title:snapshot.title,author:snapshot.author,publisherName:snapshot.publisher,width:360,thickness:depth}));
    else edge.content.style.background='repeating-linear-gradient(90deg,#b8b09a 0px,#efe9d8 1px,#efe9d8 2px)';
    edge.paint();
    const cover=make(front,360,'edge-fan-rigid');cover.sheet.dataset.sourceIndex=layout.surface.sourcePageIndex;cover.sheet.dataset.active='true';cover.sheet.dataset.selected='true';cover.sheet.dataset.side=side>0?'right':'left';cover.sheet.dataset.cover=layout.role;
    cover.content.innerHTML=renderSurface(layout.surface);cover.strip.style.setProperty('--shade-start','.015');cover.strip.style.setProperty('--shade-end','.045');cover.paint();
    return group;
}
