/** Development-only composition experiment. No authoring schema or Studio imports.
 * Reuses Flow's checkpoint iterator and DOM renderer for every free rectangle.
 */
import { createFlowPaginationIterator, normalizeFlowPageBox } from '../flow-pagination.js';
import { assertValidFlowDocument, isFlowTextBlock, getFlowBlockText } from '../flow-document.js';
import { segmentGraphemes } from '../grapheme.js';
import { createFlowDomPageMeasurer, renderFlowGeneratedPage } from '../flow-dom-measurer.js';

export class FlowWrapExperimentError extends Error {
    constructor(code) { super(code); this.name = 'FlowWrapExperimentError'; this.code = code; }
}
const fail = code => { throw new FlowWrapExperimentError(code); };

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

export function composeAnchoredFlowExperiment(document, options) {
    assertValidFlowDocument(document);
    const { object, languageKey = document.sourceLanguage, writingMode = 'vertical-rl', maxPages = 100 } = options;
    const pageBox = normalizeFlowPageBox(options.pageBox);
    if (!Number.isInteger(maxPages) || maxPages < 1) fail('INVALID_PAGE_LIMIT');
    const blocks = document.sections.flatMap(s=>s.blocks);
    if (!blocks.some(b=>b.id===object.anchorBlockId && b.type==='paragraph')) fail('ANCHOR_MISSING');
    // Title regions still need an explicit shared placement policy.
    if (blocks.some(b=>b.titleRegion)) fail('UNSUPPORTED_COMPOSITION_FEATURE');
    if (options.typography?.blockAlign && options.typography.blockAlign!=='start') fail('UNSUPPORTED_COMPOSITION_FEATURE');
    const original = JSON.stringify(document);
    const measurer = createFlowDomPageMeasurer({languageKey,writingMode,typography:options.typography,hyphenation:'none'});
    const annotationHost = globalThis.document.createElement('div');
    annotationHost.className='flow-wrap-annotation-measure-host';
    const annotationSurface = globalThis.document.createElement('div');
    Object.assign(annotationHost.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none'});
    annotationHost.append(annotationSurface);globalThis.document.body.append(annotationHost);
    const annotated = blocks.some(b=>b.annotations?.[languageKey]?.length);
    // Annotation ink is out of flow. Reserve one em around each free region,
    // then measure actual annotation rectangles as well (long ruby can exceed it).
    const annotationGuard = annotated ? measurer.typography.fontSize : 0;
    const insetRegion = rect => ({x:rect.x+annotationGuard,y:rect.y+annotationGuard,
        width:rect.width-annotationGuard*2,height:rect.height-annotationGuard*2});
    const annotationFits = context => {
        const body = measurer.measurePage(context);
        if (!body.fits || !context.fragments.some(f=>f.annotations?.length)) return body;
        renderFlowGeneratedPage(annotationSurface,{page:{fragments:context.fragments},pageBox:context.pageBox,
            languageKey,writingMode,typography:measurer.typography,hyphenation:'none'});
        const root = annotationSurface.getBoundingClientRect();
        const content = context.pageBox.contentBox;
        for(const glyph of annotationSurface.querySelectorAll('[data-annotation-text]')) {
            const rect=glyph.getBoundingClientRect();
            // The guard belongs to this region; annotations cannot enter a neighbour.
            if(rect.left-root.left < content.x-annotationGuard-0.5
                || rect.right-root.left > content.x+content.width+annotationGuard+0.5
                || rect.top-root.top < content.y-annotationGuard-0.5
                || rect.bottom-root.top > content.y+content.height+annotationGuard+0.5) return {fits:false};
        }
        return body;
    };
    try {
        const regions = createWrapRegions(pageBox,object,writingMode,measurer.typography);
        if(!regions.length) fail('OBJECT_LEAVES_NO_TEXT_ROOM');
        let attempts = 0;
        const composePage = (checkpoint, rectangles, stopBeforeAnchor = false) => {
            let cursor=checkpoint; const parts=[];
            for (const rect of rectangles) {
                if(done(cursor)) break;
                attempts++;
                const textRect=insetRegion(rect);
                if(textRect.width<=0 || textRect.height<=0) continue;
                const box=regionPageBox(pageBox,textRect);
                const iterator=createFlowPaginationIterator(document,{languageKey,writingMode,pageBox:box,startCheckpoint:cursor,maxPages:1,
                    measurePage:ctx=>stopBeforeAnchor && ctx.fragments.some(f=>f.blockId===object.anchorBlockId)
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
        const pages=[]; let checkpoint; let placed=false;
        while(!done(checkpoint)) {
            if(pages.length>=maxPages) fail('PAGE_LIMIT_EXCEEDED');
            let candidate=composePage(checkpoint,[pageBox.contentBox]);
            if(!placed && containsStart(candidate,object.anchorBlockId)) {
                const wrapped=composePage(checkpoint,regions);
                if(containsStart(wrapped,object.anchorBlockId)) {
                    candidate=wrapped; candidate.object={...object}; placed=true;
                } else {
                    // Preserve a prefix with no image. Move the anchor/object pair forward once;
                    // never backtrack previously emitted pages in this pass.
                    candidate=composePage(checkpoint,[pageBox.contentBox],true);
                    if(!candidate.parts.length) fail('ANCHOR_CANNOT_FIT_WITH_OBJECT');
                }
            }
            if(!candidate.parts.length || JSON.stringify(candidate.nextCheckpoint)===JSON.stringify(checkpoint)) fail('COMPOSITION_NO_PROGRESS');
            pages.push({...candidate,index:pages.length}); checkpoint=candidate.nextCheckpoint;
        }
        if(!placed) fail('ANCHOR_NOT_PLACED');
        const coverage=verifyWrapSourceCoverage(document,languageKey,pages);
        if(JSON.stringify(document)!==original) fail('SOURCE_MUTATED');
        return {documentId:document.id,languageKey,writingMode,pageBox,typography:measurer.typography,pages,
            coverage,attempts,metrics:measurer.getMetrics(),experimental:true};
    } finally { measurer.dispose(); annotationHost.remove(); }
}

export function renderAnchoredFlowExperiment(pageElement, result, page, imageUrl) {
    const doc=pageElement.ownerDocument;
    Object.assign(pageElement.style,{position:'relative',width:result.pageBox.width+'px',height:result.pageBox.height+'px',
        background:result.typography.paperColor,overflow:'hidden'});
    pageElement.replaceChildren();
    for(const part of page.parts) {
        const surface=doc.createElement('div');
        surface.className='wrap-region';
        renderFlowGeneratedPage(surface,{page:part.page,pageBox:part.pageBox,languageKey:result.languageKey,
            writingMode:result.writingMode,typography:result.typography,hyphenation:'none'});
        Object.assign(surface.style,{position:'absolute',inset:'0',background:'transparent',pointerEvents:'none'});
        surface.querySelector('.flow-dom-content').style.pointerEvents='auto';
        pageElement.append(surface);
    }
    if(page.object) {
        const object=doc.createElement('img'); object.className='wrap-image'; object.alt='段落に紐づいた港の画像'; object.src=imageUrl;
        Object.assign(object.style,{position:'absolute',left:page.object.x+'px',top:page.object.y+'px',
            width:page.object.width+'px',height:page.object.height+'px',objectFit:'cover'});
        pageElement.append(object);
    }
}
