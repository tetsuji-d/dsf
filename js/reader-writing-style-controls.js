import {ARROW_HEADS,LINE_STYLES} from './reader-writing-format.js';
import {renderWritingLayer} from './reader-writing-renderer.js';
import {brushGeometry} from './reader-writing-tools.js';
import {writingBounds} from './reader-writing-model.js';

function draw(container,object,width=360,height=110){
    renderWritingLayer(container,[object],{preview:'sans-serif'});
    const svg=container.querySelector('svg');if(svg)svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
}
const line=(overrides={})=>({id:'preview',type:'line',from:[25,55],to:[335,55],color:'#234d47',width:2,arrow:'end',arrowHead:'open',...overrides});
export function installStyleChoices(root,onHead,onLineStyle){
    for(const [id,entries,callback] of [['arrow-head-choices',ARROW_HEADS,onHead],['line-style-choices',LINE_STYLES,onLineStyle]]){
        const group=root.querySelector('#'+id);
        for(const [value,label] of entries){
            const button=document.createElement('button');button.type='button';button.dataset.value=value;button.setAttribute('aria-pressed','false');
            const icon=document.createElement('span');icon.className='style-choice-icon';icon.setAttribute('aria-hidden','true');
            draw(icon,line({from:[12,18],to:[108,18],...(id==='arrow-head-choices'?{arrowHead:value}:{arrow:'none',lineStyle:value})}),120,36);
            const text=document.createElement('span');text.textContent=label;button.append(icon,text);button.onclick=()=>callback(value);group.append(button);
        }
    }
}
export function syncStyleChoices(root,config){
    for(const [id,value] of [['arrow-head-choices',config.arrowHead||'open'],['line-style-choices',config.lineStyle||'solid']])
        for(const button of root.querySelector('#'+id).children)button.setAttribute('aria-pressed',button.dataset.value===value);
}
/** The inspector uses the same renderer as the page and layer thumbnails. */
export function renderStyleSample(container,{key,tool,object,config,textSize=20}){
    container.dataset.kind=key;
    if(key==='eraser'){
        const radius=Math.max(2,Math.min(40,config.width/2));
        container.innerHTML='<svg viewBox="0 0 360 60" aria-hidden="true"><path d="M25 30H'+(180-radius)+'M'+(180+radius)+' 30H335" fill="none" stroke="#2363bc" stroke-width="8"/><circle cx="180" cy="30" r="'+radius+'" fill="none" stroke="#687982" stroke-dasharray="3 3"/></svg>';return;
    }
    let sample;
    if(key==='geometry'){
        const shape=object?.type==='shape'?object.shape:['rect','ellipse'].includes(tool)?tool:null;
        sample=shape?{id:'preview',type:'shape',shape,rect:[45,12,270,36],fill:object?.fill||null,opacity:object?.opacity??1,...config}:line({...config,from:[25,30],to:[335,30]});
    }else if(key==='text'){
        const size=Math.min(44,textSize),text='Aa 123';
        sample={id:'preview',type:'text',text,rect:[25,22,310,66],writingMode:'horizontal-tb',runs:[{start:0,end:text.length,fontId:'preview',size,weight:400,color:config.color}],layout:[{start:0,end:text.length,x:30,y:30}]};
    }else{
        const raw=Array.from({length:90},(_,i)=>({x:22+i*3.5,y:30+Math.sin(i/14)*12,time:i<30?i*18:i<60?540+(i-30)*3:630+(i-60)*18,pressure:.5,pen:false}));
        const points=key==='brush'?brushGeometry(raw,config.width,true,true):raw.map(p=>({x:p.x,y:p.y,width:config.width,pressure:.5}));
        sample={id:'preview',type:'stroke',tool:key,geometryVersion:key==='brush'?4:1,inkAmount:config.inkAmount,color:config.color,baseWidth:config.width,opacity:key==='highlighter'?.48:1,points};
    }
    draw(container,sample,360,60);
    // Keep broad nibs and large arrowheads inside the compact preview as well.
    const [,y,,h]=writingBounds(sample),inkWidth=sample.points?Math.max(...sample.points.map(p=>p.width)):sample.width||0;
    const height=Math.max(60,h+inkWidth+12),svg=container.querySelector('svg');
    if(svg)svg.setAttribute('viewBox',`0 ${y+h/2-height/2} 360 ${height}`);
}
