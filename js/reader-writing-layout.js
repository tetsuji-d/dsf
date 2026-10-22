/** Bottom Writing rail. All coordinates inside the rail are local, never page-scaled. */
export function writingChromeLayout({width,height,penCount=0,controls=[],safe={left:0,right:0,top:0,bottom:0}}){
    const mobile=width<900,edge=Math.max(8,safe.left,safe.right),available=width-edge*2-(mobile?32:96);
    const size=mobile?48:available<800?44:available<830?48:54,gap=size===44?0:4,groupGap=size===44?12:24;
    const historyWidth=mobile?176:220,toolsLeft=historyWidth+groupGap,pensLeft=toolsLeft+264+groupGap;
    const pensWidth=size*penCount+gap*Math.max(0,penCount-1);
    const trackWidth=pensLeft+pensWidth+12,railHeight=116;
    // Compact screens keep the Reader's navigation row below the tools.
    const readerBottom=controls.filter(r=>r.width>r.height&&r.top>height*.6).reduce((n,r)=>Math.max(n,height-r.top+8),0);
    const bottom=Math.max(Math.max(8,safe.bottom)+(mobile?58:0),readerBottom);
    const railWidth=Math.min(trackWidth,available),left=edge+32+(available-railWidth)/2,top=Math.max(safe.top,height-bottom-railHeight);
    return {mode:mobile?'scroll':'full',short:height<520,size,gap,top,trackWidth,
        rail:{left,top,width:railWidth,height:railHeight},
        dock:{left:left-32,top,width:railWidth+32,height:railHeight,shift:Math.max(0,width-safe.right-16-(left-32))},
        pens:{left:pensLeft,top:64,width:pensWidth,height:44},
        tools:{left:toolsLeft,top:64,width:264,height:44,columns:6},
        history:{left:8,top:64,width:historyWidth,height:44},
        context:{left,top,width:railWidth,height:44}};
}

/** Pan, never shrink, a page-aligned text box into the area above the keyboard. */
export function writingTextPan({box,viewport,toolbarBottom}){
    const left=viewport.left+20,right=viewport.left+viewport.width-20;
    const top=Math.max(viewport.top+20,toolbarBottom+24),bottom=viewport.top+viewport.height-24;
    const fit=(start,size,min,max)=>size>max-min?min-start:Math.max(min-start,Math.min(0,max-start-size));
    return {x:fit(box.left,box.width,left,right),y:fit(box.top,box.height,top,Math.max(top+44,bottom))};
}

/** Anchor the inspector immediately above its tool, with viewport clamping. */
export function writingInspectorPlacement({width,height,anchor,offsetLeft=0,offsetTop=0,panel='settings',contentHeight=680,canvas,headerBottom=0}){
    const edge=8,leftEdge=Math.max(offsetLeft,canvas?.left??offsetLeft)+edge;
    const rightEdge=Math.min(offsetLeft+width,canvas?.right??offsetLeft+width)-edge;
    const topEdge=Math.max(offsetTop,canvas?.top??offsetTop,headerBottom)+edge;
    const bottomEdge=Math.min(offsetTop+height,canvas?.bottom??offsetTop+height)-edge;
    const w=Math.min(['layers','history'].includes(panel)||width>=640?420:360,Math.max(1,rightEdge-leftEdge));
    const bottom=Math.min(bottomEdge,Math.max(topEdge+1,anchor.top-edge));
    const h=Math.min(contentHeight,Math.max(1,bottom-topEdge));
    return {left:Math.max(leftEdge,Math.min(anchor.left+anchor.width/2-w/2,rightEdge-w)),
        top:Math.max(topEdge,bottom-h),width:w,height:h};
}
