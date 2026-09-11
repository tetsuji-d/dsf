import template from './editor-print-template.html?raw';
import {localizePrintTemplate} from './editor-print-i18n.js';
import { state } from './state.js';
import { getUILang } from './i18n-studio.js';
import { prepareProjectForSave } from './project-persistence.js';
import { formatEditorPreviewFailure } from './editor-preview-diagnostics.js';
import { createDsfViewerPageContentElement } from './viewer-fixed-text.js';
let active = null;
const ns = 'http://www.w3.org/2000/svg';

export async function openEditorPrint() {
    if (active) return;
    const en = getUILang() === 'en';
    const overlay = document.createElement('dialog');
    overlay.style.cssText='padding:0;border:1px solid #45546b;width:98vw;height:96vh;max-width:none;max-height:none;background:#101827;';
    const frame = document.createElement('iframe'); frame.title=en?'Print settings':'印刷設定';
    frame.style.cssText='border:0;width:100%;height:100%;display:block';
    overlay.append(frame);document.body.append(overlay);active=overlay;
    let disposed=false,session=null,generation=0,controller=null,pages=[],images=new Map();
    const cleanup=()=>{if(disposed)return;disposed=true;generation++;controller?.abort();session?.dispose();overlay.remove();active=null;};
    overlay.addEventListener('cancel',cleanup);overlay.showModal();
    const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));frame.srcdoc=localizePrintTemplate(template,en);await loaded;
    if(disposed)return;
    const win=frame.contentWindow,doc=frame.contentDocument,$=id=>doc.getElementById(id);
    $('closePrint').onclick=cleanup;
    doc.addEventListener('input',()=>{$('printOutput').replaceChildren()});
    doc.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();if(!$('printNow').disabled)$('printNow').click()}});
    const languages=[...new Set(state.languages?.length?state.languages:[state.defaultLang||'ja'])];
    for(const language of languages){const o=doc.createElement('option');o.value=language;o.textContent=language.toUpperCase();$('lang').append(o)}
    $('lang').value=languages.includes(state.activeLang)?state.activeLang:languages[0];
    // This session is a read-only snapshot. Rebuilding never updates editor or publication metadata.
    const fields=()=>({version:state.version,blocks:state.blocks,sections:state.sections,projectAssets:state.projectAssets,languages:state.languages,defaultLang:state.defaultLang,languageConfigs:state.languageConfigs,book:state.book,bookMode:state.bookMode,title:state.title,meta:state.meta,projectId:state.projectId,localProjectId:state.localProjectId});
    const svgElement=(name,attrs)=>{const el=doc.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
    function mount(container){
        for(const slot of container.querySelectorAll('[data-print-page]')){
            const number=Number(slot.dataset.printPage);if(!number||!pages[number-1])continue;
            const page=pages[number-1],d=slot.dataset,x=+d.x,y=+d.y,w=+d.w,h=+d.h,bleed=+d.bleed;
            const context=session.contextsByLanguage.get($('lang').value),delivery=page.deliveryV2;
            const href=delivery.renderKind==='image'?delivery.image.href:delivery.background?.imageHref;
            const url=href?session.assetUrls.get(href):null;
            if(bleed){
                const left=d.left==='true'?bleed:0,right=d.right==='true'?bleed:0;
                const bg=svgElement('rect',{x:x-left,y:y-bleed,width:w+left+right,height:h+2*bleed,fill:delivery.background?.color||'#ffffff'});slot.append(bg);
                const image=images.get(href);
                if(image){
                    // Extend only the source border pixels. The original page remains at unchanged 9:16 bounds.
                    const c=doc.createElement('canvas'),factor=image.naturalWidth/w;
                    const l=Math.ceil(left*factor),r=Math.ceil(right*factor),b=Math.ceil(bleed*factor),iw=image.naturalWidth,ih=image.naturalHeight;
                    c.width=iw+l+r;c.height=ih+2*b;const ctx=c.getContext('2d');
                    ctx.drawImage(image,l,b);ctx.drawImage(image,0,0,iw,1,l,0,iw,b);ctx.drawImage(image,0,ih-1,iw,1,l,b+ih,iw,b);
                    if(l)ctx.drawImage(c,l,0,1,c.height,0,0,l,c.height);if(r)ctx.drawImage(c,l+iw-1,0,1,c.height,l+iw,0,r,c.height);
                    slot.append(svgElement('image',{x:x-left,y:y-bleed,width:w+left+right,height:h+bleed*2,href:c.toDataURL('image/png'),preserveAspectRatio:'none'}));
                }
            }
            const foreign=svgElement('foreignObject',{x,y,width:w,height:h});
            const node=createDsfViewerPageContentElement({documentRef:doc,page,context,imageUrl:url,resolveAssetHref:href=>session.assetUrls.get(href)||href});
            node.style.width='360px';node.style.height='640px';node.style.transformOrigin='0 0';node.style.transform=`scale(${w/360})`;
            if(delivery.renderKind==='image')node.style.objectFit='fill';
            foreign.append(node);slot.append(foreign);
        }
    }
    win.mountPrintPages=mount;
    win.mountPrintThumbnails=()=>{
        for(const b of doc.querySelectorAll('[data-choice]')){
            const preview=svgElement('svg',{viewBox:'0 0 36 64',width:23,height:40,'aria-hidden':'true'});
            const slot=svgElement('g',{'data-print-page':b.dataset.choice,'data-x':0,'data-y':0,'data-w':36,'data-h':64,'data-bleed':0});
            preview.append(slot);mount(preview);b.replaceChildren(preview,doc.createTextNode(b.dataset.choice));
        }
    };
    async function rebuild(){
        const priorLanguage=session?.project.defaultLang;const priorRange=$('range').value;const priorMode=$('rangeMode').value;
        const id=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
        win.printBusy=true;$('printNow').disabled=true;$('lang').disabled=true;$('paperColor').disabled=true;
        $('loadState').textContent=en?'Preparing pages…':'印刷ページを準備中…';
        const initial=JSON.stringify(fields()),language=$('lang').value;
        const check=()=>{if(disposed||id!==generation||signal.aborted){const e=new Error('PREVIEW_CANCELLED');e.name='AbortError';throw e;}if(JSON.stringify(fields())!==initial)throw new Error('PREVIEW_CHANGED');};
        let next=null;
        try{
            const project=prepareProjectForSave(JSON.parse(initial));
            // Selection and booklet padding define print composition, independently of cover publication parity.
            project.book={mode:'none'};project.bookMode='none';
            const omitPaperColor=!$('paperColor').checked;
            if(omitPaperColor)for(const block of project.blocks||[])if(block.kind==='flow'){
                block.flow.layout.typographyByLanguage ||= {};
                block.flow.layout.typographyByLanguage[language]={...block.flow.layout.typographyByLanguage[language],paperColor:'#ffffff'};
            }
            const {createEditorFlowPreview}=await import('./press.js');
            const blob=await createEditorFlowPreview({project,languages:[language],signal,check,onProgress:p=>{check();$('loadState').textContent=`${language.toUpperCase()} · Flow ${p.groupIndex+1}/${p.groupCount}`;},printOptions:{omitPaperColor}});check();
            const {loadDsfLocalViewerPackage}=await import('./dsf-local-viewer-package.js');
            next=await loadDsfLocalViewerPackage({file:blob,fontFaceSet:doc.fonts,FontFaceCtor:win.FontFace});check();
            if(!next)throw new Error('PREVIEW_EMPTY');
            const nextImages=new Map();
            await Promise.all([...next.assetUrls].map(async([href,url])=>{const image=new win.Image();image.src=url;await image.decode();nextImages.set(href,image);}));check();
            session?.dispose();session=next;next=null;images=nextImages;pages=session.pagesByLanguage.get(language)||[];
            if(priorLanguage!==language)win.setPrintDirection(session.index.languages[language].pageDirection);
            win.printBusy=false;win.setPrintCount(pages.length);
            if(priorLanguage===language){$('rangeMode').value=priorMode;$('range').value=priorRange;$('range').dispatchEvent(new win.Event('input'));}
            $('loadState').textContent=en?'Ready · print snapshot':'準備完了 · 印刷用スナップショット';
        }catch(error){next?.dispose();if(!disposed&&id===generation){pages=[];win.setPrintCount(0);$('loadState').textContent=formatEditorPreviewFailure(error,{project:JSON.parse(initial),language,en});}}
        finally{if(!disposed&&id===generation){$('lang').disabled=false;$('paperColor').disabled=false;win.printBusy=false;}}
    }
    $('lang').addEventListener('change',rebuild);$('paperColor').addEventListener('change',rebuild);
    $('printNow').onclick=async()=>{
        if(win.printBusy||!win.printGeometry?.valid)return;
        const button=$('printNow');button.disabled=true;
        try{
            const sheets=win.collectPrintSheets(),{w,h}=win.printGeometry;
            $('printOutput').replaceChildren(...sheets);
            let style=$('printPageSize');if(!style){style=doc.createElement('style');style.id='printPageSize';doc.head.append(style)}
            style.textContent=`@page{size:${w}mm ${h}mm;margin:0}`;
            await doc.fonts.ready;await Promise.all([...$('printOutput').querySelectorAll('img')].map(i=>i.decode()));
            win.focus();win.print();
        }catch{ $('loadState').textContent=en?'Could not prepare printing. Try again.':'印刷を準備できませんでした。もう一度お試しください。'; }
        finally{button.disabled=false;}
    };
    await rebuild();
}
