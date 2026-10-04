/** Stable, symmetric paper margins; independent of menu visibility. */
export function readerPageInsets({width,height,safeTop=0,safeRight=0,safeBottom=0,safeLeft=0}) {
    const phone=height>=width&&width-safeLeft-safeRight<700;
    const vertical=phone?Math.max(safeTop+52,Math.max(2,safeBottom-12)+78):Math.max(safeTop,safeBottom);
    return {safeTop:vertical,safeBottom:vertical,safeLeft,safeRight};
}

export function readerHeaderTop(viewport,pageTop,height=48) {
    const top=viewport.top+viewport.safeTop;
    return top+Math.max(0,(pageTop-top-height)/2);
}

/** Only exterior covers wrap; an outward gesture never skips a body page. */
export function readerBoundaryTarget(items,at,delta,getLayout) {
    if(at+delta>=0&&at+delta<items.length)return null;
    const opposite=delta<0?items.length-1:0;
    return getLayout(items[at]?.index)?.exterior&&getLayout(items[opposite]?.index)?.exterior?opposite:null;
}

/** Positions use the visible viewport, including browser bars and OS safe areas. */
export function readerControlLayout(viewport, page) {
    const {left=0,top=0,width,height,safeTop=0,safeRight=0,safeBottom=0,safeLeft=0}=viewport;
    const x=left+safeLeft+12,y=top+safeTop+12;
    const right=left+width-safeRight-12;
    const available=right-x,portrait=height>=width;
    const dock=portrait&&available<700?'bottom':'side';
    // On phones use the upper part of the home-indicator inset, retaining its lower area.
    const bottom=top+height-(dock==='bottom'?Math.max(2,safeBottom-12):safeBottom+2);
    const cornerInset=dock==='bottom'?Math.min(20,Math.max(0,(available-5*44)/2)):0;
    const span=dock==='bottom'?available-cornerInset*2:bottom-y;
    const size=height<420||span<264?44:48,gap=Math.max(0,Math.min(6,(span-size*5)/4));
    const railWidth=dock==='bottom'?span:size;
    const railHeight=dock==='bottom'?size:size*5+gap*4;
    // Stay beside the paper when the margin fits; otherwise overlay safely.
    const railX=dock==='bottom'?x+cornerInset
        :Math.min(right-railWidth,Math.max(x,page.right+12));
    const railY=dock==='bottom'?bottom-railHeight
        :Math.max(y,Math.min(bottom-railHeight,page.top+(page.height-railHeight)/2));
    const progressWidth=Math.max(40,Math.min(page.width-28,available-(dock==='side'?size+20:cornerInset*2)));
    return {dock,size,gap,left:railX,top:railY,width:railWidth,height:railHeight,
        progressLeft:x+(available-progressWidth)/2,progressWidth,
        progressTop:dock==='bottom'?railY-22:bottom-30};
}

/** Uniformly fit one curved sheet without changing its authored proportions. */
export function fitReaderSheet(points,width,height,{safeTop=0,safeRight=0,safeBottom=0,safeLeft=0}={}) {
    if(!points.length)return null;
    const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
    const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
    const w=maxX-minX,h=maxY-minY;
    if(!(w>0&&h>0))return null;
    const availableWidth=Math.max(1,width-safeLeft-safeRight-16);
    const availableHeight=Math.max(1,height-safeTop-safeBottom-16);
    const scale=Math.min(availableWidth/w,availableHeight/h);
    return {minX,maxX,minY,maxY,scale,
        offsetX:(safeLeft+8+(availableWidth-w*scale)/2)/scale-minX,
        offsetY:safeTop+8+(availableHeight-h*scale)/2-minY*scale};
}

/** Crop the complete book around one face, retaining its binding and block. */
export function fitReaderBookFace(points,structure,width,height,{side,hinge=405,bindingWidth=0,...safe}={}) {
    if(!points.length)return null;
    const gutter=bindingWidth/2+12;
    const half=structure.map(p=>({x:side<0?Math.min(p.x,hinge+gutter):Math.max(p.x,hinge-gutter),y:p.y}));
    return fitReaderSheet([...points,...half],width,height,safe);
}

export function adjacentReaderPage(items,at,delta,getPosition,single) {
    if(single){const next=at+delta;return next>=0&&next<items.length?next:null;}
    const position=getPosition(items[at]?.index);
    for(let i=at+delta;i>=0&&i<items.length;i+=delta){
        const other=getPosition(items[i].index);
        if(other!==undefined&&other!==position){
            while(i>0&&getPosition(items[i-1].index)===other)i--;
            return i;
        }
    }
    return null;
}

/** Place information beside full-size paper; optionally translate it into desktop left margin. */
export function readerInfoPlacement(viewport,page,{allowShift=false}={}) {
    const {left=0,top=0,width,height,safeTop=0,safeBottom=0,safeLeft=0,safeRight=0}=viewport;
    const right=left+width-safeRight-12, gap=16;
    let free=right-page.right-gap-60;
    let pageShift=0;
    const leftRoom=Math.max(0,page.left-(left+safeLeft+12));
    if(allowShift&&width>=1024&&free<320&&free+leftRoom>=320){
        pageShift=-(320-free);free=320;
    }
    const side=free>=320;
    const x=side?page.right+pageShift+gap+60:Math.max(left+safeLeft,page.left);
    const y=Math.max(top+safeTop+(side?64:0),page.top);
    return {layout:side?'side':'overlay',pageShift,left:x,top:y,
        width:side?Math.min(420,free):Math.max(1,Math.min(page.right,left+width-safeRight)-x),
        height:Math.max(1,Math.min(page.top+page.height,top+height-safeBottom)-y)};
}
