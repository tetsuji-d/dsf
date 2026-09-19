import {removePlacementAnchors} from './flow-page-placement.js';
import { deepClone, createId } from './utils.js';
import { assertValidFlowProjectData } from './flow-project-model.js';
import { applyFlowAuthoringOperation } from './flow-authoring.js';

function fail(code) { const error=new Error('Cannot isolate the selected Flow page.');error.code=code;throw error; }
/** Isolate a verified source page without persisting generated page indices. */
export function isolateFlowTitlePage(blocks, groupId, page, {idFactory=createId, initialAlignment=null}={}) {
    assertValidFlowProjectData({version:6,blocks});
    const index=blocks.findIndex(b=>b.id===groupId), group=blocks[index];
    const language=group?.flow?.document?.sourceLanguage;
    // Wrapping can split one semantic paragraph into several adjacent regions.
    // Rejoin only contiguous ranges; never mistake these for changed source.
    const fragments=[];
    for(const fragment of page?.fragments || []) {
        const previous=fragments.at(-1);
        if(previous?.sectionId===fragment.sectionId && previous.blockId===fragment.blockId
            && previous.languageKey===fragment.languageKey && previous.sourceRange?.end===fragment.sourceRange?.start) {
            previous.text+=fragment.text;previous.sourceRange.end=fragment.sourceRange.end;
        } else fragments.push({...fragment,sourceRange:{...fragment.sourceRange}});
    }
    if (!group || !fragments?.length || fragments.some(f=>f.languageKey!==language)) fail('source');
    const flat=group.flow.document.sections.flatMap(s=>s.blocks.map(b=>({section:s,block:b})));
    let previous=-1;
    for (const f of fragments) {
        const i=flat.findIndex(e=>e.section.id===f.sectionId && e.block.id===f.blockId);
        const text=flat[i]?.block.texts?.[language];
        if(i<=previous || typeof text!=='string' || !Number.isInteger(f.sourceRange?.start) || !Number.isInteger(f.sourceRange?.end)
            || f.sourceRange.start<0 || f.sourceRange.end>text.length || f.sourceRange.end<f.sourceRange.start
            || text.slice(f.sourceRange.start,f.sourceRange.end)!==f.text) fail('stale');
        if(previous>=0 && i!==previous+1) fail('stale');
        previous=i;
    }
    if(group.flow.layout.anchoredObjects?.some(o=>o.graphic.visible && fragments.some(f=>f.blockId===o.anchorBlockId)))fail('wrap');
    const first=fragments[0],last=fragments.at(-1);
    for(const f of fragments) {
        const text=flat.find(e=>e.block.id===f.blockId).block.texts[language];
        if(f!==first && f.sourceRange.start!==0 || f!==last && f.sourceRange.end!==text.length) fail('stale');
    }
    let next=deepClone(blocks), startId=first.blockId,endId=last.blockId;
    const split=(fragment,offset)=>{
        const target=next[index].flow.document.sections.find(s=>s.id===fragment.sectionId).blocks.find(b=>b.id===fragment.blockId);
        if(offset===0 || offset===target.texts[language].length) return null;
        if(Object.keys(target.texts).some(key=>key!==language)) fail('translation');
        const newBlockId=idFactory('flow_text');
        next=applyFlowAuthoringOperation(next,{type:'splitTextBlock',groupId,sectionId:fragment.sectionId,
            blockId:fragment.blockId,languageKey:language,utf16Offset:offset,utf16EndOffset:offset,newBlockId});
        return newBlockId;
    };
    split(last,last.sourceRange.end);
    const newStart=split(first,first.sourceRange.start);
    if(newStart){startId=newStart;if(endId===first.blockId)endId=newStart;}
    const source=next[index], entries=source.flow.document.sections.flatMap(s=>s.blocks.map(b=>({section:s,block:b})));
    const start=entries.findIndex(e=>e.block.id===startId),end=entries.findIndex(e=>e.block.id===endId);
    const region = deepClone(fragments[0].titleRegion || {id:idFactory('flow_title'),languageKey:language,textAlign:initialAlignment?.textAlign || 'center',blockAlign:initialAlignment?.blockAlign || 'center'});
    removePlacementAnchors(source,new Set(entries.slice(start,end+1).map(e=>e.block.id)));
    for (const entry of entries.slice(start,end+1)) entry.block.titleRegion=deepClone(region);
    source.flow.document.schemaVersion=Math.max(3,source.flow.document.schemaVersion);
    assertValidFlowProjectData({version:6,blocks:next});
    return {blocks:next,activeBlockIndex:index,regionId:region.id};
}

export function updateFlowTitleRegion(blocks,groupId,regionId,{field,value,remove=false}={}) {
    const next=deepClone(blocks),index=next.findIndex(b=>b.id===groupId);
    if(index<0)fail('stale');
    let found=false;
    for(const section of next[index].flow.document.sections) for(const block of section.blocks) {
        if(block.titleRegion?.id!==regionId)continue;
        found=true;
        if(remove)delete block.titleRegion;
        else if(['textAlign','blockAlign'].includes(field))block.titleRegion[field]=value;
    }
    if(!found)fail('stale');
    assertValidFlowProjectData({version:6,blocks:next});
    return {blocks:next,activeBlockIndex:index};
}
