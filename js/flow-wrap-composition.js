import {resolveFlowAnchoredObjects} from './flow-anchored-objects.js';
/** Anchored Flow composition. Generated region geometry is runtime-only.
 * Reuses Flow's checkpoint iterator and DOM renderer for every free rectangle.
 */
import { createFlowPaginationIterator, normalizeFlowPageBox, paginateFlowDocument } from './flow-pagination.js';
import { assertValidFlowDocument, isFlowTextBlock, getFlowBlockText } from './flow-document.js';
import { segmentGraphemes } from './grapheme.js';
import { createFlowDomPageMeasurer, renderFlowGeneratedPage } from './flow-dom-measurer.js';

export class FlowWrapCompositionError extends Error {
    constructor(code) { super(code); this.name = 'FlowWrapCompositionError'; this.code = code; }
}
const fail = code => { throw new FlowWrapCompositionError(code); };

/** Physical coordinates. Use only the wider inline side at an obstruction. */
export function createWrapRegions(pageBox, object, writingMode, typography) {
    const { contentBox: box } = normalizeFlowPageBox(pageBox);
    const { x, y, width, height, gap, wrap } = object;
    if (![x,y,width,height,gap].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0
        || x < box.x || y < box.y || x + width > box.x + box.width || y + height > box.y + box.height
        || !['square','band'].includes(wrap)) fail('INVALID_OBJECT_GEOMETRY');
    const left = Math.max(box.x, x-gap), right = Math.min(box.x+box.width, x+width+gap);
    const top = Math.max(box.y, y-gap), bottom = Math.min(box.y+box.height, y+height+gap);
    const regions = [];
    const add = (x,y,width,height) => { if(width > 0.5 && height > 0.5) regions.push({x,y,width,height}); };
    // Snap the excluded block-axis band outwards to the existing line/column grid.
    const advance = typography.fontSize * typography.lineHeight;
    if (writingMode === 'horizontal-tb') {
        const start = box.y + Math.floor((top-box.y)/advance)*advance;
        const end = Math.min(box.y+box.height, box.y+Math.ceil((bottom-box.y)/advance)*advance);
        add(box.x,box.y,box.width,start-box.y);
        if (wrap === 'square') {
            const before = left-box.x, after = box.x+box.width-right;
            if (Math.max(before,after) >= typography.fontSize*3) {
                add(before >= after ? box.x : right,start,Math.max(before,after),end-start);
            }
        }
        add(box.x,end,box.width,box.y+box.height-end);
    } else if (writingMode === 'vertical-rl') {
        const edge = box.x+box.width;
        const start = edge-Math.floor((edge-right)/advance)*advance;
        const end = Math.max(box.x,edge-Math.ceil((edge-left)/advance)*advance);
        add(start,box.y,edge-start,box.height);
        if (wrap === 'square') {
            const before = top-box.y, after = box.y+box.height-bottom;
            if (Math.max(before,after) >= typography.fontSize*3) {
                add(end,before >= after ? box.y : bottom,start-end,Math.max(before,after));
            }
        }
        add(box.x,box.y,end-box.x,box.height);
    } else fail('UNSUPPORTED_WRITING_MODE');
    return regions;
}
function combineObjects(objects){
 if(objects.length===1)return objects[0];
 const x=Math.min(...objects.map(o=>o.x)),y=Math.min(...objects.map(o=>o.y));
 return {id:objects[0].id,anchorBlockId:objects[0].anchorBlockId,objects,x,y,width:Math.max(...objects.map(o=>o.x+o.width))-x,height:Math.max(...objects.map(o=>o.y+o.height))-y,gap:Math.max(...objects.map(o=>o.gap)),wrap:objects.some(o=>o.wrap==='band')?'band':'square',graphic:{members:objects.flatMap(o=>o.graphic.members||[o.graphic])}};
}
function regionPageBox(pageBox, rect) {
    return normalizeFlowPageBox({width:pageBox.width,height:pageBox.height,padding:{
        left:rect.x,top:rect.y,right:pageBox.width-rect.x-rect.width,bottom:pageBox.height-rect.y-rect.height,
    }});
}
const done = checkpoint => checkpoint?.cursor.atEnd && !checkpoint.manualBreakBefore;
const containsStart = (page, id) => page.fragments.some(f=>f.blockId===id && f.isBlockStart);

export function verifyWrapSourceCoverage(document, languageKey, pages) {
    const fragments = pages.flatMap(p=>p.fragments);
    let index = 0;
    for (const section of document.sections) for (const block of section.blocks) {
        if (!isFlowTextBlock(block)) continue;
        const source = getFlowBlockText(block,languageKey), graphemes = segmentGraphemes(source,languageKey);
        let offset = 0, gOffset = 0, count = 0;
        while (fragments[index]?.blockId === block.id) {
            const f = fragments[index++], range = f.sourceRange;
            if (f.sectionId!==section.id || range.start!==offset || range.startGrapheme!==gOffset
                || range.end < range.start || range.endGrapheme < range.startGrapheme
                || range.endGrapheme > graphemes.length
                || range.start !== (graphemes[range.startGrapheme]?.index ?? source.length)
                || range.end !== (range.endGrapheme ? graphemes[range.endGrapheme-1]?.end : 0)
                || f.text!==source.slice(range.start,range.end)) fail('SOURCE_COVERAGE_MISMATCH');
            offset=range.end; gOffset=range.endGrapheme; count++;
        }
        if (!count || offset!==source.length || gOffset!==graphemes.length) fail('SOURCE_COVERAGE_MISMATCH');
        if (!source.length && count!==1) fail('EMPTY_PARAGRAPH_DUPLICATED');
    }
    if(index!==fragments.length) fail('SOURCE_COVERAGE_MISMATCH');
    return {blockCount:document.sections.reduce((n,s)=>n+s.blocks.filter(isFlowTextBlock).length,0),fragmentCount:fragments.length};
}

export function composeFlowWithAnchoredObjects(group, options) {
    const document=group.flow.document;
    assertValidFlowDocument(document);
    const { languageKey = document.sourceLanguage, writingMode = 'vertical-rl', maxPages = 2000 } = options;
    const pageBox = normalizeFlowPageBox(options.pageBox);
    if (!Number.isInteger(maxPages) || maxPages < 1) fail('INVALID_PAGE_LIMIT');
    const blocks = document.sections.flatMap(s=>s.blocks);

    const original = JSON.stringify(document);
    const measurer = createFlowDomPageMeasurer({ownerDocument:options.ownerDocument,languageKey,writingMode,typography:options.typography,hyphenation:'none'});
    const ownerDocument=options.ownerDocument || globalThis.document;
    const annotationHost = ownerDocument.createElement('div');
    annotationHost.className='flow-wrap-annotation-measure-host';
    const annotationSurface = ownerDocument.createElement('div');
    Object.assign(annotationHost.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none'});
    annotationHost.append(annotationSurface);ownerDocument.body.append(annotationHost);
    let activeObject=null;
    const annotationFits = context => {
        const body = measurer.measurePage(context);
        if (!body.fits || !activeObject || !context.fragments.some(f=>f.annotations?.length)) return body;
        renderFlowGeneratedPage(annotationSurface,{page:{fragments:context.fragments},pageBox:context.pageBox,
            languageKey,writingMode,typography:measurer.typography,hyphenation:'none'});
        const root=annotationSurface.getBoundingClientRect(), o=activeObject;
        for(const glyph of annotationSurface.querySelectorAll('[data-annotation-text]')) {
            const r=glyph.getBoundingClientRect(), x=r.left-root.left,y=r.top-root.top;
            if(x < -0.5 || y < -0.5 || x+r.width>pageBox.width+0.5 || y+r.height>pageBox.height+0.5
                || (x<o.x+o.width+o.gap && x+r.width>o.x-o.gap && y<o.y+o.height+o.gap && y+r.height>o.y-o.gap)) return {fits:false};
        }
        return body;
    };
    try {
        const objects=resolveFlowAnchoredObjects(group,languageKey,measurer.typography);
        if(!objects.length) return paginateFlowDocument(document,{...options,measurePage:measurer.measurePage});
        for(const object of objects){
            if(blocks.find(b=>b.id===object.anchorBlockId)?.titleRegion)fail('FLOW_OBJECT_TITLE_REGION');
            if(!createWrapRegions(pageBox,object,writingMode,measurer.typography).length)fail('OBJECT_LEAVES_NO_TEXT_ROOM');
        }
        const composePage = (checkpoint, rectangles, blockedIds = new Set()) => {
            let cursor=checkpoint; const parts=[];
            for (const rect of rectangles) {
                if(done(cursor)) break;
                const textRect=rect;
                if(textRect.width<=0 || textRect.height<=0) continue;
                const box=regionPageBox(pageBox,textRect);
                const iterator=createFlowPaginationIterator(document,{languageKey,writingMode,pageBox:box,startCheckpoint:cursor,maxPages:1,
                    measurePage:ctx=>ctx.fragments.some(f=>blockedIds.has(f.blockId))
                        ? {fits:false} : annotationFits(ctx)});
                let result;
                try { result=iterator.next(); }
                catch(error) { if(error.code==='FRAGMENT_DOES_NOT_FIT') continue; throw error; }
                if(result.done) break;
                const step=result.value;
                parts.push({rect,pageBox:box,page:step.page}); cursor=step.nextCheckpoint;
                // A semantic page break always ends the physical page, not just a free rectangle.
                if(cursor.manualBreakBefore) break;
            }
            return {parts,fragments:parts.flatMap(p=>p.page.fragments),nextCheckpoint:cursor,
                manualBreakBefore:checkpoint?.manualBreakBefore || null};
        };
        const pages=[]; let checkpoint; const placed=new Set();
        while(!done(checkpoint)) {
            if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
            if(pages.length>=maxPages) fail('PAGE_LIMIT_EXCEEDED');
            activeObject=null;
            let candidate=composePage(checkpoint,[pageBox.contentBox]);
            const targets=objects.filter(o=>!placed.has(o.id)&&containsStart(candidate,o.anchorBlockId));
            const target=targets[0];
            if(target) {
                if(group.flow.layout.schemaVersion===3 && targets.length>1){
                  for(let count=targets.length;count>1;count--){
                    const batch=targets.slice(0,count),combined=combineObjects(batch);activeObject=combined;
                    const regions=createWrapRegions(pageBox,combined,writingMode,measurer.typography);
                    const excluded=new Set(objects.filter(o=>!placed.has(o.id)&&!batch.includes(o)).map(o=>o.anchorBlockId));
                    const wrapped=composePage(checkpoint,regions,excluded);
                    if(batch.every(o=>containsStart(wrapped,o.anchorBlockId))){candidate=wrapped;candidate.object=combined;batch.forEach(o=>placed.add(o.id));break;}
                  }
                }
                if(!candidate.object){
                activeObject=target;
                const regions=createWrapRegions(pageBox,target,writingMode,measurer.typography);
                const targetIndex=blocks.findIndex(b=>b.id===target.anchorBlockId);
                const laterIds=new Set(objects.filter(o=>!placed.has(o.id)&&blocks.findIndex(b=>b.id===o.anchorBlockId)>targetIndex).map(o=>o.anchorBlockId));
                const wrapped=composePage(checkpoint,regions,laterIds);
                if(containsStart(wrapped,target.anchorBlockId)) {
                    candidate=wrapped; candidate.object=target; placed.add(target.id);
                } else {
                    activeObject=null;
                    candidate=composePage(checkpoint,[pageBox.contentBox],new Set([target.anchorBlockId]));
                    if(!candidate.parts.length) fail('ANCHOR_CANNOT_FIT_WITH_OBJECT');
                }
                }
            }
            if(!candidate.parts.length || JSON.stringify(candidate.nextCheckpoint)===JSON.stringify(checkpoint)) fail('COMPOSITION_NO_PROGRESS');
            let start=0;
            pages.push({index:pages.length,manualBreakBefore:candidate.manualBreakBefore,fragments:candidate.fragments,
                ...(candidate.object?{anchoredObject:candidate.object,wrapRegions:candidate.parts.map(part=>{
                    const value={pageBox:part.pageBox,fragmentStart:start,fragmentCount:part.page.fragments.length};start+=value.fragmentCount;return value;
                })}:{})});
            checkpoint=candidate.nextCheckpoint;
        }
        if(placed.size!==objects.length) fail('ANCHOR_NOT_PLACED');
        verifyWrapSourceCoverage(document,languageKey,pages);
        if(JSON.stringify(document)!==original) fail('SOURCE_MUTATED');
        return {documentId:document.id,languageKey,writingMode,pageBox,pages};
    } finally { measurer.dispose(); annotationHost.remove(); }
}

/** Fail closed when a captured background is stale, duplicated, or detached from its paragraph. */
export function validateFlowWrapPagination(group,pagination,typography) {
    const objects=resolveFlowAnchoredObjects(group,pagination.languageKey,typography), seen=new Set();
    const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const page of pagination.pages) {
        if(!page.anchoredObject){if(page.wrapRegions)fail('FLOW_WRAP_REGIONS_UNEXPECTED');continue;}
        const ids=(page.anchoredObject.objects || [page.anchoredObject]).map(o=>o.id);
        const batch=ids.map(id=>objects.find(o=>o.id===id));
        if(batch.some(o=>!o || seen.has(o.id) || !containsStart(page,o.anchorBlockId)) || new Set(ids).size!==ids.length)fail('FLOW_WRAP_ANCHOR_MISMATCH');
        const object=combineObjects(batch);
        if(!equal(object,page.anchoredObject))fail('FLOW_WRAP_ANCHOR_MISMATCH');
        batch.forEach(o=>seen.add(o.id));
        const allowed=createWrapRegions(pagination.pageBox,object,pagination.writingMode,typography);
        let offset=0, previous=-1;
        if(!Array.isArray(page.wrapRegions)||!page.wrapRegions.length)fail('FLOW_WRAP_REGIONS_MISSING');
        for(const region of page.wrapRegions){
            const index=allowed.findIndex(r=>equal(regionPageBox(pagination.pageBox,r),region.pageBox));
            if(index<=previous || region.fragmentStart!==offset || !Number.isInteger(region.fragmentCount)
                || region.fragmentCount<1)fail('FLOW_WRAP_REGIONS_MISMATCH');
            previous=index;offset+=region.fragmentCount;
        }
        if(offset!==page.fragments.length)fail('FLOW_WRAP_REGIONS_MISMATCH');
    }
    if(seen.size!==objects.length)fail('FLOW_WRAP_OBJECT_MISSING');
}
