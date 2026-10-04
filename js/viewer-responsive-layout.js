/** Positions use the visible viewport, including browser bars and OS safe areas. */
export function readerControlLayout(viewport, page) {
    const {left=0,top=0,width,height,safeTop=0,safeRight=0,safeBottom=0,safeLeft=0}=viewport;
    const x=left+safeLeft+12,y=top+safeTop+12;
    const right=left+width-safeRight-12,bottom=top+height-safeBottom-12;
    const available=right-x,portrait=height>=width;
    const dock=portrait&&available<700?'bottom':'side';
    const span=dock==='bottom'?available:bottom-y;
    const size=height<420||span<264?44:48,gap=Math.max(0,Math.min(6,(span-size*5)/4));
    const railWidth=dock==='bottom'?size*5+gap*4:size;
    const railHeight=dock==='bottom'?size:size*5+gap*4;
    // Stay beside the paper when the margin fits; otherwise overlay safely.
    const railX=dock==='bottom'?x+(available-railWidth)/2
        :Math.min(right-railWidth,Math.max(x,page.right+12));
    const railY=dock==='bottom'?bottom-railHeight
        :Math.max(y,Math.min(bottom-railHeight,page.top+(page.height-railHeight)/2));
    const progressWidth=Math.max(40,Math.min(page.width-28,available-(dock==='side'?size+20:0)));
    return {dock,size,gap,left:railX,top:railY,width:railWidth,height:railHeight,
        progressLeft:x+(available-progressWidth)/2,progressWidth,
        progressTop:dock==='bottom'?railY-38:bottom-30};
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
