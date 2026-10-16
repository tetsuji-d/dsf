/** Bottom Writing rail. All coordinates inside the rail are local, never page-scaled. */
export function writingChromeLayout({width,height,controls=[],safe={left:0,right:0,top:0,bottom:0}}){
    const mobile=width<900,edge=Math.max(8,safe.left,safe.right),available=width-edge*2-(mobile?0:64);
    const size=mobile?48:available<800?44:available<830?48:54,gap=size===44?0:4,groupGap=size===44?12:24;
    const historyWidth=mobile?176:220,toolsLeft=historyWidth+groupGap,pensLeft=toolsLeft+264+groupGap;
    const trackWidth=pensLeft+size*5+gap*4+12,railHeight=116;
    // Compact screens keep the Reader's navigation row below the tools.
    const readerBottom=controls.filter(r=>r.width>r.height&&r.top>height*.6).reduce((n,r)=>Math.max(n,height-r.top+8),0);
    const bottom=Math.max(Math.max(8,safe.bottom)+(mobile?58:0),readerBottom);
    const railWidth=Math.min(trackWidth,available),left=edge+(available-railWidth)/2,top=Math.max(safe.top,height-bottom-railHeight);
    return {mode:mobile?'scroll':'full',short:height<520,size,gap,top,trackWidth,
        rail:{left,top,width:railWidth,height:railHeight},
        pens:{left:pensLeft,top:8,width:size*5+gap*4,height:108},
        tools:{left:toolsLeft,top:60,width:264,height:52,columns:6},
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

/** Keep an inspector close to the control that opened it, clamped to the visible viewport. */
export function writingInspectorPlacement({width,height,anchor,offsetLeft=0,offsetTop=0,panel='settings'}){
    const edge=8,leftEdge=offsetLeft+edge,topEdge=offsetTop+edge,right=offsetLeft+width-edge,bottom=offsetTop+height-edge;
    const listPanel=['layers','history'].includes(panel),w=Math.min(listPanel||width>=640?420:360,width-2*edge),below=anchor.bottom+8,above=anchor.top-8-topEdge;
    let top,left=anchor.left+anchor.width/2-w/2;
    if(listPanel){const h=Math.min(720,height-2*edge);top=Math.max(topEdge,Math.min(below,bottom-h));return {left:Math.max(leftEdge,Math.min(left,right-w)),top,width:w,height:h};}
    // The heading and Apply/Cancel footer need about 160px themselves. Do not
    // accept a small gap near the trigger that leaves only a sliver for settings.
    const maxHeight=Math.min(680,height-2*edge),usefulHeight=Math.min(560,maxHeight);
    let h=maxHeight;
    if(bottom-below>=usefulHeight){top=below;h=Math.min(maxHeight,bottom-below);}
    else if(width>=640&&right-anchor.right>=w+8){left=anchor.right+8;top=anchor.top;}
    else if(width>=640&&anchor.left-leftEdge>=w+8){left=anchor.left-w-8;top=anchor.top;}
    else if(above>=usefulHeight){h=Math.min(maxHeight,above);top=anchor.top-8-h;}
    else top=below;
    top=Math.max(topEdge,Math.min(top,bottom-h));
    return {left:Math.max(leftEdge,Math.min(left,right-w)),top,width:w,height:h};
}
