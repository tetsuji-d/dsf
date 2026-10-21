import {loadDsfV3} from './dsf-writing-package.js';
import {prepareDsfViewerFixedTextContext} from './viewer-fixed-text.js';
import {renderWritingLayer} from './reader-writing-renderer.js';

/** Verified portable v3 only. No remote release is promoted to a downloadable copy. */
export async function loadWritingReaderSession(file,{bytes=file,onProgress}={}) {
    const runtimeUrl='/writing/reader-runtime.mjs';
    const {createReaderWritingRuntime}=await import(/* @vite-ignore */ runtimeUrl);
    const runtime=await createReaderWritingRuntime(),faces=[],urls=[],assetUrls=new Map();
    const dispose=()=>{faces.forEach(f=>document.fonts.delete(f));urls.forEach(URL.revokeObjectURL);runtime.dispose();};
    runtime.options.onProgress=onProgress;
    try {
        const handle=await loadDsfV3(bytes,runtime.options),bundle=handle.bundle,meta=handle.meta,certifiedFonts={},families={};
        await onProgress?.('display','文字とページを表示しています…','Displaying text and pages…');
        for(const area of ['original','writing'])for(const resource of handle.resources[area]?.fonts||[]){
            const family=`ReaderWriting_${area}_${resource.sha256}`,face=await new FontFace(family,handle.readBytes(resource.path),{weight:'100 900'}).load();
            document.fonts.add(face);faces.push(face);
            if(area==='writing')families[resource.sourceFontId]=family;
            else {bundle.index.fonts[resource.sourceFontId].family=family;certifiedFonts[resource.sourceFontId]={...bundle.index.fonts[resource.sourceFontId]};}
        }
        for(const resource of handle.inventory.filter(r=>r.mimeType==='image/webp')){
            const url=URL.createObjectURL(new Blob([handle.readBytes(resource.path)],{type:resource.mimeType}));urls.push(url);assetUrls.set(resource.path,url);assetUrls.set('../'+resource.path,url);
        }
        const contextsByLanguage=new Map(),pagesByLanguage=new Map();
        for(const language of Object.keys(bundle.manifests)){
            const context=await prepareDsfViewerFixedTextContext({bundle,language,certifiedFonts,fontFaceSet:document.fonts});contextsByLanguage.set(language,context);
            pagesByLanguage.set(language,context.manifest.pages.map(p=>({id:p.id,deliveryV2:p,content:{backgrounds:p.renderKind==='image'?{'__all':p.image.href}:{},bubbles:{}}})));
        }
        const index=bundle.index,project={...meta,projectId:meta.projectId||'local-writing',languages:Object.keys(index.languages),defaultLang:index.defaultLang,
            languageConfigs:Object.fromEntries(Object.entries(index.languages).map(([l,d])=>[l,{pageDirection:d.pageDirection}])),pages:pagesByLanguage.get(index.defaultLang),
            bookMode:meta.presentation?.spread==='none'?'none':'simple',dsfResolution:'360x640',dsfTotalBytes:file.size};
        const writing=handle.envelope.document;
        return {project,index,manifests:bundle.manifests,contextsByLanguage,pagesByLanguage,assetUrls,dispose,writingLocked:handle.copyKind==='writing-shared',
            layer(pageId,language){const objects=writing?.pages.find(p=>p.pageId===pageId&&p.language===language)?.objects;if(!objects?.length)return '';
                const layer=document.createElement('div');layer.className='reader-writing-saved-layer';renderWritingLayer(layer,objects,families);return layer.outerHTML;}};
    }catch(error){dispose();throw error;}finally{runtime.dispose();}
}
