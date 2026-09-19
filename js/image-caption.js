/** Shared caption geometry for authoring, wrapping and publication. */
import {segmentGraphemes} from './grapheme.js';
export function validateImageCaption(o) {
 const c=o.caption;if(c===undefined)return;
 if(o.kind!=='image'||!c||!['top','bottom','left','right'].includes(c.position)||!c.texts||typeof c.texts!=='object'||Array.isArray(c.texts)||Object.values(c.texts).some(t=>typeof t!=='string')||!Number.isFinite(c.fontSize)||c.fontSize<6||c.fontSize>48||!Number.isFinite(c.gap)||c.gap<0||c.gap>48||!/^#[0-9a-f]{6}$/i.test(c.color)||!['left','center','right'].includes(c.align))throw Error('INVALID_IMAGE_CAPTION');
}
export function layoutImageCaption(o,language,defaultLanguage=language,context) {
 if(!o.caption)return null;validateImageCaption(o);
 const c=o.caption,text=c.texts[language]??c.texts[defaultLanguage]??'';
 if(!text)return null;
 const f=o.frames?.[language]||o.frame,vertical=['left','right'].includes(c.position),size=c.fontSize,line=size*1.4;
 const ctx=context||document.createElement('canvas').getContext('2d');ctx.font=`${size}px sans-serif`;
 const limit=vertical?f.height:f.width,lines=[];
 if(limit<size)throw Error('CAPTION_FRAME_TOO_SMALL');
 for(const paragraph of text.split('\n')){let current='',used=0;for(const {segment:ch} of segmentGraphemes(paragraph,language)){const advance=vertical?size:ctx.measureText(ch).width;if(current&&used+advance>limit){lines.push(current);current='';used=0;}current+=ch;used+=advance;}lines.push(current);}
 const width=vertical?lines.length*line:f.width,height=vertical?f.height:lines.length*line;
 const x=c.position==='left'?-c.gap-width:c.position==='right'?f.width+c.gap:0;
 const y=c.position==='top'?-c.gap-height:c.position==='bottom'?f.height+c.gap:0;
 return {x,y,width,height,lines,vertical,size,line,align:c.align,color:c.color};
}
export function drawImageCaption(ctx,o,language,defaultLanguage) {
 const c=layoutImageCaption(o,language,defaultLanguage,ctx);if(!c)return;
 const f=o.frames?.[language]||o.frame;
 ctx.save();ctx.translate(f.x+f.width/2,f.y+f.height/2);ctx.rotate(f.rotation*Math.PI/180);ctx.translate(-f.width/2,-f.height/2);
 ctx.font=`${c.size}px sans-serif`;ctx.fillStyle=c.color;ctx.textBaseline='middle';ctx.globalAlpha=1;
 c.lines.forEach((text,i)=>{const chars=segmentGraphemes(text,language);const length=c.vertical?chars.length*c.size:ctx.measureText(text).width;const available=c.vertical?c.height:c.width;const offset=c.align==='center'?(available-length)/2:c.align==='right'?available-length:0;
 if(c.vertical)chars.forEach(({segment:text},j)=>ctx.fillText(text,c.x+c.width-(i+1)*c.line+(c.line-c.size)/2,c.y+offset+(j+.5)*c.size));
 else ctx.fillText(text,c.x+offset,c.y+(i+.5)*c.line);
 });ctx.restore();
}
export function imageCaptionBounds(o,language) {
 const f=o.frame,c=layoutImageCaption(o,language);if(!c)return null;
 const points=[[0,0],[f.width,0],[0,f.height],[f.width,f.height],[c.x,c.y],[c.x+c.width,c.y],[c.x,c.y+c.height],[c.x+c.width,c.y+c.height]];
 const a=f.rotation*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);
 const transformed=points.map(([x,y])=>({x:f.x+f.width/2+(x-f.width/2)*cs-(y-f.height/2)*sn,y:f.y+f.height/2+(x-f.width/2)*sn+(y-f.height/2)*cs}));
 const x=Math.min(...transformed.map(p=>p.x)),y=Math.min(...transformed.map(p=>p.y));return {x,y,width:Math.max(...transformed.map(p=>p.x))-x,height:Math.max(...transformed.map(p=>p.y))-y};
}
