/** Shared canvas line layout. Offsets are UTF-16 offsets into the source text. */
export function layoutGraphicText(ctx, text, style, frame) {
    const s=style, w=frame.width, h=frame.height, pad=s.padding, step=s.fontSize*1.4;
    ctx.font=`${s.italic?'italic ':''}${s.bold?'bold ':''}${s.fontSize}px ${s.fontFamily}`;
    const lines=[]; let offset=0;
    if(s.writingMode==='vertical-rl') {
        const count=Math.max(1,Math.floor((h-pad*2)/s.fontSize));
        for(const paragraph of text.split('\n')) {
            let chars=Array.from(paragraph); if(!chars.length)lines.push({text:'',start:offset});
            while(chars.length){const value=chars.splice(0,count).join('');lines.push({text:value,start:offset});offset+=value.length;}
            offset++;
        }
        const used=lines.length*step;
        let x=s.valign==='center'?(w+used)/2-step:s.valign==='bottom'?pad+used-step:w-pad-step;
        return lines.map(line=>{const space=h-pad*2-Array.from(line.text).length*s.fontSize;
            const result={...line,x,y:pad+(s.align==='center'?space/2:s.align==='right'?space:0),vertical:true};x-=step;return result;});
    }
    for(const paragraph of text.split('\n')) {
        let line='',start=offset;
        const flush=()=>{lines.push({text:line,start});start+=line.length;line='';};
        for(const token of paragraph.split(/(\s+)/)) {
            if(line&&ctx.measureText(line+token).width>w-2*pad)flush();
            for(const ch of token){if(line&&ctx.measureText(line+ch).width>w-2*pad)flush();line+=ch;}
        }
        flush();offset+=paragraph.length+1;
    }
    const total=lines.length*step;
    let y=s.valign==='center'?(h-total)/2:s.valign==='bottom'?h-pad-total:pad;
    return lines.map(line=>{const width=ctx.measureText(line.text).width;
        const result={...line,x:s.align==='center'?(w-width)/2:s.align==='right'?w-pad-width:pad,y,vertical:false};y+=step;return result;});
}
export function transformedRect(rect,frame) {
    const a=frame.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const points=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>({x:frame.x+frame.width/2+(x-frame.width/2)*c-(y-frame.height/2)*s,y:frame.y+frame.height/2+(x-frame.width/2)*s+(y-frame.height/2)*c}));
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
export function graphicTextRegions(ctx,object,language,start,end) {
    const frame=object.frames?.[language]||object.frame,s=object.style,text=object.texts[language],rects=[];
    for(const line of layoutGraphicText(ctx,text,s,frame)) {
        const a=Math.max(start,line.start),b=Math.min(end,line.start+line.text.length);if(a>=b)continue;
        const before=text.slice(line.start,a),part=text.slice(a,b);
        const rect=line.vertical?{x:line.x,y:line.y+Array.from(before).length*s.fontSize,width:s.fontSize,height:Array.from(part).length*s.fontSize}:
            {x:line.x+ctx.measureText(before).width,y:line.y,width:ctx.measureText(before+part).width-ctx.measureText(before).width,height:s.fontSize*1.4};
        if(rect.x<s.padding-.01||rect.y<s.padding-.01||rect.x+rect.width>frame.width-s.padding+.01||rect.y+rect.height>frame.height-s.padding+.01)throw Error('PAGE_LINK_CLIPPED');
        rects.push(transformedRect(rect,frame));
    }
    return rects;
}
