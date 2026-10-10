import { findPageNavigationObject, readPageNavigationText, validatePageNavigation, numberedNavigationPages, reconcilePageNavigation } from './page-navigation.js';
import { formatPageReference } from './page-link-draft.js';
import { segmentGraphemes } from './grapheme.js';
import { imageCaptionBounds } from './image-caption.js';
import { graphicTextRegions } from './graphic-text-layout.js';

const fail=code=>{throw Object.assign(Error(code),{code});};
function textRegions(page,target,start,end) {
    if(page.sourceAnchor?.flowGroupId!==target.ownerId)return [];
    const segments=segmentGraphemes(target.text,target.language),regions=[];
    (page.lines||[]).forEach((line,lineIndex)=>{
        if(/-(ruby|emphasis)$/.test(line.styleRef||''))return;
        line.runs.forEach((run,runIndex)=>{
            if(run.source?.blockId!==target.objectId)return;
            const from=segments[run.source.startGrapheme]?.index??target.text.length;
            const to=run.source.endGrapheme?segments[run.source.endGrapheme-1]?.end:0;
            const a=Math.max(start,from),b=Math.min(end,to);
            if(a<b){if(run.text!==target.text.slice(from,to))fail('PAGE_LINK_TEXT_MISMATCH');regions.push({lineIndex,runIndex,start:a-from,end:b-from});}
        });
    });return regions;
}
function placedObject(project,target,page,backgrounds) {
    if(page.sourceAnchor?.kind==='fixed'&&page.sourceAnchor.blockId===target.ownerId)return findPageNavigationObject(project,target);
    const placed=backgrounds.get(page.id)?.graphic;
    return (placed?.members||[placed]).find(o=>o?.id===target.objectId);
}
/** Only resolved public geometry leaves this function; never private text snapshots or offsets. */
export function attachDeliveryPageLinks(pages,project,language,backgrounds=new Map(),context) {
    if(!project?.pageNavigation)return;
    validatePageNavigation(project.pageNavigation);reconcilePageNavigation(project);
    const numbered=numberedNavigationPages(pages,project);
    const resolve=target=>target&&!target.unresolved&&findPageNavigationObject(project,target)&&target.language===language?numbered.find(p=>target.scope==='flow-text'
        ?textRegions(p,target,target.start,target.start+1).length:placedObject(project,target,p,backgrounds)):null;
    for(const link of project.pageNavigation.links.filter(l=>l.source.language===language)) {
        const anchor=link.destination.kind==='anchor'?project.pageNavigation.anchors.find(a=>a.id===link.destination.anchorId):null;
        const destination=anchor?resolve(anchor.target):link.destination.kind==='page'?numbered.find(p=>p.number===link.destination.pageNumber):null;
        const source=link.source,ref=link.reference,text=readPageNavigationText(project,source);
        if(link.unresolved||source.unresolved||!destination?.number||!resolve(source)
            ||text?.slice(ref.start,ref.end)!==ref.text||ref.text!==' '+formatPageReference(destination.number,ref.format))fail('PAGE_LINK_UNRESOLVED');
        let referenceCoverage=0,sourceCoverage=0;
        for(const page of pages) {
            const base={id:link.id,targetPageId:destination.id,number:destination.number,format:ref.format,label:anchor?.name||''};
            let item;
            if(source.scope==='flow-text') {
                const selected=textRegions(page,source,source.start,source.end),reference=textRegions(page,source,ref.start,ref.end);
                sourceCoverage+=selected.reduce((n,r)=>n+r.end-r.start,0);referenceCoverage+=reference.reduce((n,r)=>n+r.end-r.start,0);
                if(selected.length||reference.length)item={...base,textRegions:[...selected,...reference],rects:[]};
            } else {
                const object=placedObject(project,source,page,backgrounds);if(!object)continue;
                if(!object.visible)fail('PAGE_LINK_HIDDEN');
                const ctx=context||document.createElement('canvas').getContext('2d');
                const rects=source.kind==='image'?[imageCaptionBounds({...object,frame:object.frames?.[language]||object.frame},language)]:[
                    ...graphicTextRegions(ctx,object,language,source.start,source.end),...graphicTextRegions(ctx,object,language,ref.start,ref.end)];
                if(rects.some(r=>!r||r.x<0||r.y<0||r.x+r.width>360.01||r.y+r.height>640.01))fail('PAGE_LINK_CLIPPED');
                if(!rects.length)fail('PAGE_LINK_HIDDEN');
                item={...base,textRegions:[],rects};referenceCoverage=ref.text.length;sourceCoverage=source.kind==='text'?source.end-source.start:1;
            }
            if(item)(page.pageLinks||=[]).push(item);
        }
        // Line breaks have no painted glyph; all other source/reference characters must be present.
        if(referenceCoverage!==ref.text.length||sourceCoverage<(source.kind==='text'?text.slice(source.start,source.end).replaceAll('\n','').length:1))fail('PAGE_LINK_INCOMPLETE');
    }
}
