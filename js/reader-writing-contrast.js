/** Small, local backdrop samples; never serialize or retain manuscript pixels. */
export function writingBackdropStyle(rgba,previous='light') {
    const values=[];
    const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
    for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>0)values.push(.2126*linear(rgba[i])+.7152*linear(rgba[i+1])+.0722*linear(rgba[i+2]));
    if(!values.length)return {tone:'dark',mixed:true};
    values.sort((a,b)=>a-b);
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    // Hysteresis avoids switching repeatedly near the boundary when panning.
    return {tone:mean<(previous==='dark'?.36:.26)?'dark':'light',
        mixed:values[Math.floor((values.length-1)*.9)]-values[Math.floor((values.length-1)*.1)]>.3};
}

export function writingImageRect(box,naturalWidth,naturalHeight,fit='fill',position='50% 50%') {
    if(!naturalWidth||!naturalHeight)return box;
    const scale=fit==='cover'?Math.max(box.width/naturalWidth,box.height/naturalHeight)
        :fit==='contain'?Math.min(box.width/naturalWidth,box.height/naturalHeight)
        :fit==='scale-down'?Math.min(1,box.width/naturalWidth,box.height/naturalHeight):1;
    if(fit==='fill')return box;
    const width=naturalWidth*scale,height=naturalHeight*scale,parts=position.split(/\s+/);
    const offset=(value,space)=>value?.endsWith('%')?parseFloat(value)*space/100:value==='right'||value==='bottom'?space:value==='center'?space/2:parseFloat(value)||0;
    return {left:box.left+offset(parts[0],box.width-width),top:box.top+offset(parts[1]||'50%',box.height-height),width,height};
}

const intersect=(a,b)=>{const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top),right=Math.min(a.right,b.right),bottom=Math.min(a.bottom,b.bottom);return right>left&&bottom>top?{left,top,right,bottom,width:right-left,height:bottom-top}:null;};
const pagesSelector='#viewer-content [data-writing-page],#viewer-spread-content [data-writing-page]';

export function createWritingContrast({documentRef=document,groups,rail,isVisible}) {
    const win=documentRef.defaultView,canvas=documentRef.createElement('canvas');
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    let timer,disposed=false;
    function sample(box) {
        if(!ctx)return new Uint8ClampedArray();
        // Reset also clears a tainted canvas from a cross-origin image.
        canvas.width=24;canvas.height=6;
        ctx.setTransform(24/box.width,0,0,6/box.height,-box.left*24/box.width,-box.top*6/box.height);
        ctx.fillStyle='#f4f7fb';ctx.fillRect(box.left,box.top,box.width,box.height);
        const background=element=>{const style=win.getComputedStyle(element);ctx.fillStyle=style.backgroundColor;ctx.fillRect(box.left,box.top,box.width,box.height);if(style.backgroundImage!=='none')throw Error('UNSAMPLED_BACKGROUND');};
        background(documentRef.documentElement);background(documentRef.body);
        for(const page of documentRef.querySelectorAll(pagesSelector)){
            const bounds=page.getBoundingClientRect();if(!intersect(box,bounds))continue;
            ctx.save();
            try {
                ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.width,bounds.height);ctx.clip();
                const ancestors=[];for(let el=page;el&&el!==documentRef.body;el=el.parentElement)ancestors.unshift(el);
                for(const el of ancestors)background(el);
                const images=page.matches('img')?[page]:page.querySelectorAll('img');
                for(const image of images){
                    const r=image.getBoundingClientRect(),style=win.getComputedStyle(image);
                    if(!intersect(box,r)||style.visibility==='hidden'||style.display==='none')continue;
                    if(!image.complete||!image.naturalWidth)throw Error('IMAGE_NOT_READY');
                    const target=writingImageRect(r,image.naturalWidth,image.naturalHeight,style.objectFit,style.objectPosition);
                    ctx.save();
                    try{ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();ctx.globalAlpha=Number(style.opacity);
                        ctx.drawImage(image,target.left,target.top,target.width,target.height);
                    }finally{ctx.restore();}
                }
            }finally{ctx.restore();}
        }
        return ctx.getImageData(0,0,24,6).data;
    }
    function update(){
        timer=null;if(disposed||!isVisible())return;
        const viewport={left:0,top:0,right:win.innerWidth,bottom:win.innerHeight};
        const clip=intersect(viewport,rail.getBoundingClientRect());if(!clip)return;
        // A scrolling rail is one stable surface: update hidden tools too, before
        // they enter the viewport. Scrolling changes tools, not the backdrop area.
        const shared=rail.scrollWidth>rail.clientWidth+1;
        const frame=groups[0]?.getBoundingClientRect();
        const sharedBox=shared&&frame?intersect(clip,{...clip,top:frame.top,bottom:frame.bottom}):null;
        const classify=(box,previous)=>{try{return writingBackdropStyle(sample(box),previous);}catch{return {tone:'dark',mixed:true};}};
        const sharedStyle=sharedBox?classify(sharedBox,groups[0].dataset.backdrop):null;
        for(const group of groups){
            const box=sharedBox||intersect(clip,group.getBoundingClientRect());if(!box)continue;
            const result=sharedStyle||classify(box,group.dataset.backdrop);
            group.dataset.backdrop=result.tone;group.dataset.backdropMixed=String(result.mixed);
        }
    }
    function invalidate(){if(disposed)return;clearTimeout(timer);timer=win.setTimeout(update,80);}
    const onImage=e=>{if(e.target?.matches?.('img')&&e.target.closest('[data-writing-page]'))invalidate();};
    documentRef.addEventListener('load',onImage,true);documentRef.addEventListener('error',onImage,true);
    const theme=new win.MutationObserver(invalidate);theme.observe(documentRef.body,{attributes:true,attributeFilter:['data-theme']});
    return {invalidate,dispose(){disposed=true;clearTimeout(timer);theme.disconnect();documentRef.removeEventListener('load',onImage,true);documentRef.removeEventListener('error',onImage,true);canvas.width=canvas.height=0;}};
}
