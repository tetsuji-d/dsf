import {segmentGraphemes} from './grapheme.js';
/** FlowLayout v4: language-local page placement anchored to semantic text. */
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function validateFlowPagePlacements(layout,document) {
    if(layout.pagePlacements===undefined)return;
    if(layout.schemaVersion!==4 || !Array.isArray(layout.pagePlacements))fail('FLOW_PLACEMENT_INVALID');
    const ids=new Set();
    for(const a of layout.pagePlacements){
        if(!a || Object.keys(a).some(k=>!['id','blockId','languageKey','utf16Offset','blockAlign'].includes(k))
            || ['id','blockId','languageKey'].some(k=>typeof a[k]!=='string'||!a[k].trim()||a[k]!==a[k].trim())
            || ids.has(a.id)||!Number.isInteger(a.utf16Offset)||a.utf16Offset<0||!['start','center','end'].includes(a.blockAlign))fail('FLOW_PLACEMENT_INVALID');
        ids.add(a.id);
        if(document){const b=document.sections.flatMap(s=>s.blocks).find(b=>b.id===a.blockId),text=b?.texts?.[a.languageKey];
            if(typeof text!=='string'||a.utf16Offset>text.length||b.titleRegion)fail('FLOW_PLACEMENT_ANCHOR_INVALID');
            if(a.utf16Offset!==0 && !segmentGraphemes(text,a.languageKey).some(g=>g.end===a.utf16Offset))fail('FLOW_PLACEMENT_ANCHOR_INVALID');
        }
    }
}
export function pagePlacementAnchors(group,page,language) {
    return (group.flow.layout.pagePlacements||[]).filter(a=>a.languageKey===language && page.fragments.some(f=>f.blockId===a.blockId &&
        a.utf16Offset>=f.sourceRange.start && (a.utf16Offset<f.sourceRange.end || (f.isBlockEnd && a.utf16Offset===f.sourceRange.end))));
}
export function resolvePagePlacement(group,page,language){
    const anchors=pagePlacementAnchors(group,page,language),values=new Set(anchors.map(a=>a.blockAlign));
    return {anchors,conflict:values.size>1,blockAlign:values.size===1?anchors[0].blockAlign:null};
}
export function setFlowPagePlacement(blocks,groupId,page,language,value){
    if(!['start','center','end'].includes(value))fail('FLOW_PLACEMENT_INVALID');
    const next=structuredClone(blocks),index=next.findIndex(g=>g.id===groupId),group=next[index];
    if(group?.kind!=='flow' || !page?.fragments?.length || page.fragments.some(f=>f.languageKey!==language))fail('FLOW_PLACEMENT_STALE');
    if(![1,2,3,4].includes(group.flow.layout.schemaVersion))fail('FLOW_PLACEMENT_INVALID');
    validateFlowPagePlacements(group.flow.layout,group.flow.document);
    const flat=group.flow.document.sections.flatMap(s=>s.blocks);
    for(const f of page.fragments){const b=flat.find(b=>b.id===f.blockId);if(!b || !Number.isInteger(f.sourceRange?.start)||!Number.isInteger(f.sourceRange?.end)||f.sourceRange.start<0||f.sourceRange.end<f.sourceRange.start||f.sourceRange.end>(b.texts?.[language]?.length??-1)||b.texts?.[language]?.slice(f.sourceRange.start,f.sourceRange.end)!==f.text)fail('FLOW_PLACEMENT_STALE');if(b.titleRegion)fail('FLOW_PLACEMENT_TITLE_CONFLICT');}
    const old=pagePlacementAnchors(group,page,language),ids=new Set(old.map(a=>a.id)),f=page.fragments[0];
    group.flow.layout.schemaVersion=4;
    group.flow.layout.pagePlacements=[...(group.flow.layout.pagePlacements||[]).filter(a=>!ids.has(a.id)),
        {id:old[0]?.id||crypto.randomUUID(),blockId:f.blockId,languageKey:language,utf16Offset:f.sourceRange.start,blockAlign:value}];
    validateFlowPagePlacements(group.flow.layout,group.flow.document);
    return {blocks:next,activeBlockIndex:index};
}
export function remapPlacementText(group,blockId,language,before,after,range){
    let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
    let end=before.length,nextEnd=after.length;while(end>start&&nextEnd>start&&before[end-1]===after[nextEnd-1]){end--;nextEnd--;}
    if(range){start=range.start;end=range.end;nextEnd=end+after.length-before.length;}
    for(const a of group.flow.layout.pagePlacements||[])if(a.blockId===blockId&&a.languageKey===language){
        if(a.utf16Offset>=end)a.utf16Offset+=nextEnd-end;
        else if(a.utf16Offset>start)a.utf16Offset=nextEnd;
        if(a.utf16Offset>0)a.utf16Offset=segmentGraphemes(after,language).find(g=>g.end>=a.utf16Offset)?.end||after.length;
    }
}
export function splitPlacementAnchors(group,blockId,language,start,end,newId){
    for(const a of group.flow.layout.pagePlacements||[])if(a.blockId===blockId&&a.languageKey===language){
        if(a.utf16Offset>=end){a.blockId=newId;a.utf16Offset-=end;}else if(a.utf16Offset>start)a.utf16Offset=start;
    }
}
export function mergePlacementAnchors(group,from,to,offsets){
    for(const a of group.flow.layout.pagePlacements||[])if(a.blockId===from){a.blockId=to;a.utf16Offset+=offsets[a.languageKey]||0;}
}
export function removePlacementAnchors(group,ids){if(group.flow.layout.pagePlacements)group.flow.layout.pagePlacements=group.flow.layout.pagePlacements.filter(a=>!ids.has(a.blockId));}
/** Image coordinates used by the final background; canonical wrap data stays intact. */
export function placedFlowObject(page){
    if(!page.anchoredObject)return null;
    const result=structuredClone(page.anchoredObject),{x=0,y=0}=page.placementOffset||{};
    // Composite backgrounds may share graphic references with their object list.
    const shifted=new Set();
    const moveGraphic=graphic=>{
        if(shifted.has(graphic))return;
        shifted.add(graphic);
        if(graphic.members)graphic.members.forEach(moveGraphic);
        else {graphic.frame.x+=x;graphic.frame.y+=y;}
    };
    const shift=object=>{
        object.x+=x;object.y+=y;moveGraphic(object.graphic);
        object.objects?.forEach(shift);
    };
    shift(result);return result;
}
export function validatePlacementPagination(group,pagination){
    const seen=new Set();
    for(const p of pagination.pages){const r=resolvePagePlacement(group,p,pagination.languageKey),o=p.placementOffset;
        for(const a of r.anchors){if(seen.has(a.id))fail('FLOW_PLACEMENT_DUPLICATE');seen.add(a.id);}
        if(r.conflict)fail('FLOW_PLACEMENT_CONFLICT');
        if(r.blockAlign===null){if(o)fail('FLOW_PLACEMENT_UNEXPECTED');continue;}
        if(!o || Object.keys(o).some(k=>!['x','y','blockAlign'].includes(k)) || !Number.isFinite(o.x)||!Number.isFinite(o.y)||o.blockAlign!==r.blockAlign||o.conflict||o.blocked)fail('FLOW_PLACEMENT_UNRESOLVED');
        if(pagination.writingMode==='vertical-rl'?o.y!==0:o.x!==0)fail('FLOW_PLACEMENT_INVALID_OFFSET');
    }
    if((group.flow.layout.pagePlacements||[]).some(a=>a.languageKey===pagination.languageKey&&!seen.has(a.id)))fail('FLOW_PLACEMENT_MISSING');
}
