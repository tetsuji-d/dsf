/** Place Writing chrome around the Reader's actual paper and navigation rectangles. */
export function writingChromeLayout({width,height,paper,controls=[],header,safe={left:0,right:0,top:0,bottom:0}}){
    if(width<900){
        const top=Math.max(safe.top+4,header?.bottom+6||60),edge=Math.max(8,safe.left),size=48,gap=2;
        const end=Math.min(width-Math.max(8,safe.right),...controls.filter(r=>r.height>r.width&&r.left>300&&r.top<top+164).map(r=>r.left-12));
        return {mode:'scroll',short:height<520,size,gap,top,
            rail:{left:edge,top,width:end-edge,height:112},
            pens:{left:536,top:0,width:size*5+gap*4,height:108},
            tools:{left:204,top:24,width:308,height:52,columns:7},
            history:{left:4,top:28,width:176,height:44},
            context:{left:edge,top:top+112,width:Math.min(280,end-edge),height:44}};
    }
    const left=Math.max(50,safe.left+8),right=width-Math.max(50,safe.right+8);
    const short=height<520,availableLeft=paper.left-left-16;
    const historyWidth=220,historyGap=24;
    const side=availableLeft>=(short?246:332)+historyWidth+historyGap;
    const size=side?(availableLeft>=332&&!short?60:44):(width>=366&&!short?54:44);
    const gap=size===60?8:size===54?4:width<340?0:2,penWidth=size*5+gap*4,penHeight=Math.ceil(size*130/60)+4;
    // Preserve the Reader header. On a phone the tools need their own row below it.
    const top=!side&&header&&header.left-12-left<penWidth?Math.max(safe.top,header.bottom+8):safe.top;
    if(header)controls=[...controls,header];
    let mode='compact',pens,tools,history,context;
    if(side){
        mode='side';const zoneWidth=Math.min(332,availableLeft),x=paper.left-16-zoneWidth;
        // Below the menu, a six-tool rail can use the full gutter. Keep every row on
        // one axis instead of wrapping the same tools into an unrelated 3 x 2 grid.
        const toolWidth=308,center=Math.min(x+zoneWidth/2,paper.left-16-Math.max(toolWidth,penWidth)/2);
        pens={left:center-penWidth/2,top,width:penWidth,height:penHeight};
        context={left:center-penWidth/2,top:top+penHeight,width:penWidth,height:44};
        tools={left:center-toolWidth/2,top:context.top+context.height+12,width:toolWidth,height:52,columns:7};
        history={left:tools.left-historyWidth-historyGap,top:tools.top+4,width:historyWidth,height:44};
    }else{
        // A Reader control in the top band reserves that whole interval.
        const end=Math.min(right,...controls.filter(r=>r.top<top+160&&r.bottom>top).map(r=>r.left-12));
        const space=Math.max(0,end-left),allWidth=308+24+penWidth,topHistory=space>=allWidth+historyWidth+historyGap;
        mode=space>=allWidth?'inline':'compact';
        const groupLeft=left+(space-(mode==='inline'?allWidth+(topHistory?historyWidth+historyGap:0):penWidth))/2;
        const x=groupLeft+(topHistory?historyWidth+historyGap:0);
        pens={left:Math.max(left,x+(mode==='inline'?332:0)),top,width:penWidth,height:penHeight};
        const toolWidth=308;
        tools={left:mode==='inline'?x:Math.max(8,Math.min(width-toolWidth-8,left+(space-toolWidth)/2)),top:top+(mode==='inline'?Math.max(20,(penHeight-52)/2):space<toolWidth?56:8),width:toolWidth,height:52,columns:7};
        context={left:pens.left,top:top+penHeight,width:penWidth,height:44};
        const bottomControls=controls.filter(r=>r.top>height*.6&&r.width>r.height);
        const bottom=Math.min(height-safe.bottom,paper.bottom,...bottomControls.map(r=>r.top-8));
        history=topHistory?{left:groupLeft,top:tools.top+4,width:historyWidth,height:44}:{left:Math.max(10,Math.min(paper.left+12,width-historyWidth-10)),top:Math.max(180,bottom-52),width:historyWidth,height:44};
    }
    return {mode,short,size,gap,pens,tools,history,context,top};
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
