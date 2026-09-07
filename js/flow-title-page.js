import { deepClone, createId } from './utils.js';
import { assertValidFlowProjectData } from './flow-project-model.js';
import { applyFlowAuthoringOperation } from './flow-authoring.js';

function fail(code) { const error=new Error('Cannot isolate the selected Flow page.');error.code=code;throw error; }
/** Isolate a verified source page without persisting generated page indices. */
export function isolateFlowTitlePage(blocks, groupId, page, {idFactory=createId}={}) {
    assertValidFlowProjectData({version:6,blocks});
    const index=blocks.findIndex(b=>b.id===groupId), group=blocks[index];
    const language=group?.flow?.document?.sourceLanguage;
    const fragments=page?.fragments;
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
    const ranges=[entries.slice(0,start),entries.slice(start,end+1),entries.slice(end+1)];
    const parts=[];let titleIndex;
    for(let part=0;part<3;part++) {
        if(!ranges[part].length)continue;
        const output=deepClone(source);
        if(parts.length){output.id=idFactory('flow');output.flow.document.id=idFactory('flow_document');}
        output.flow.document.sections=source.flow.document.sections.flatMap(section=>{
            const ids=new Set(ranges[part].filter(e=>e.section.id===section.id).map(e=>e.block.id));
            return ids.size?[{...deepClone(section),blocks:deepClone(section.blocks.filter(b=>ids.has(b.id)))}]:[];
        });
        if(part===1){titleIndex=parts.length;output.flow.pageRole='title';Object.assign(output.flow.layout.typographyByLanguage[language],{textAlign:'center',blockAlign:'center'});}
        const blockIds=new Set(output.flow.document.sections.flatMap(s=>s.blocks.map(b=>b.id)));
        const sectionIds=new Set(output.flow.document.sections.map(s=>s.id));
        const allBlockIds=new Set(entries.map(e=>e.block.id)),allSectionIds=new Set(entries.map(e=>e.section.id));
        for(const state of Object.values(output.flow.translationState?.languages||{})) {
            for(const [map,ids,all] of [['blocks',blockIds,allBlockIds],['sectionTitles',sectionIds,allSectionIds]]) {
                state.sourceFingerprints[map]=Object.fromEntries(Object.entries(state.sourceFingerprints[map]).filter(([id])=>ids.has(id)||(!parts.length&&!all.has(id))));
            }
            if(state.lockedUnitIds)state.lockedUnitIds=state.lockedUnitIds.filter(id=>blockIds.has(id)||sectionIds.has(id)||(!parts.length&&!allBlockIds.has(id)&&!allSectionIds.has(id)));
        }
        parts.push(output);
    }
    next.splice(index,1,...parts);
    if(new Set(next.map(b=>b.id)).size!==next.length)fail('stale');
    assertValidFlowProjectData({version:6,blocks:next});
    return {blocks:next,activeBlockIndex:index+titleIndex};
}
