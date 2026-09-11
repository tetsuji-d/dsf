/** FlowLayout v2 anchored graphics. Source paragraphs and generated pages stay separate. */
import { validateGraphicObjects } from './graphic-object-model.js';
import {imageCaptionBounds} from './image-caption.js';
const failure=code=>Object.assign(new Error(code),{code});

export function validateFlowAnchoredObjects(layout, assets) {
    if (layout.anchoredObjects === undefined) return;
    if (![2,3].includes(layout.schemaVersion) || !Array.isArray(layout.anchoredObjects)) throw failure('FLOW_OBJECT_COLLECTION_INVALID');
    const ids = new Set(), graphicIds = new Set();
    for (const entry of layout.anchoredObjects) {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || entry.id !== entry.id.trim() || ids.has(entry.id)
            || typeof entry.anchorBlockId !== 'string' || !entry.anchorBlockId.trim()
            || entry.anchorBlockId !== entry.anchorBlockId.trim() || !['square','band'].includes(entry.wrap)
            || !Number.isFinite(entry.gapEm) || entry.gapEm < 0 || entry.gapEm > 4
            || !['image','shape'].includes(entry.graphic?.kind)) throw failure('FLOW_OBJECT_INVALID');
        if(entry.graphic.caption && layout.schemaVersion!==3)throw failure('FLOW_CAPTION_REQUIRES_V3');
        ids.add(entry.id);
        if(graphicIds.has(entry.graphic.id))throw failure('FLOW_GRAPHIC_ID_DUPLICATE');
        graphicIds.add(entry.graphic.id);
        const graphic=entry.graphic;
        validateGraphicObjects({projectAssets:assets || (graphic.assetId?[{id:graphic.assetId}]:[]),blocks:[{
            kind:'page',content:{graphicObjects:[graphic],objectOrder:[graphic.id]},
        }]});
    }
}
export function resolveFlowAnchoredObjects(group, language, typography) {
    const layout=group.flow.layout;
    validateFlowAnchoredObjects(layout);
    const paragraphs=new Set(group.flow.document.sections.flatMap(s=>s.blocks.filter(b=>b.type==='paragraph').map(b=>b.id)));
    const seen=new Set();
    const resolved=(layout.anchoredObjects || []).filter(e=>e.graphic.visible).map(entry=>{
        if(!paragraphs.has(entry.anchorBlockId)) throw failure('FLOW_OBJECT_ANCHOR_MISSING');
        if(layout.schemaVersion!==3 && seen.has(entry.anchorBlockId)) throw failure('FLOW_OBJECT_ANCHOR_CONFLICT');
        seen.add(entry.anchorBlockId);
        const graphic=structuredClone(entry.graphic);
        if(graphic.caption && graphic.caption.texts[language]===undefined)graphic.caption.texts[language]=graphic.caption.texts[group.flow.document.sourceLanguage] || '';
        const f=graphic.frames?.[language] || graphic.frame;
        graphic.frame={...f,x:f.x+layout.padding.left,y:f.y+layout.padding.top};delete graphic.frames;
        const a=f.rotation*Math.PI/180, width=Math.abs(f.width*Math.cos(a))+Math.abs(f.height*Math.sin(a)),
            height=Math.abs(f.width*Math.sin(a))+Math.abs(f.height*Math.cos(a));
        const stroke=graphic.kind==='shape'?graphic.style.lineWidth/2:0;
        return {id:entry.id,anchorBlockId:entry.anchorBlockId,graphic,wrap:entry.wrap,gap:entry.gapEm*typography.fontSize,
            x:graphic.frame.x+(f.width-width)/2-stroke,y:graphic.frame.y+(f.height-height)/2-stroke,
            width:width+stroke*2,height:height+stroke*2,...(imageCaptionBounds(graphic,language)||{})};
    });
    if(layout.schemaVersion!==3)return resolved;
    const bundles=[];
    for(const object of resolved){let bundle=bundles.find(b=>b.anchorBlockId===object.anchorBlockId);if(!bundle){bundle={...object,items:[]};bundles.push(bundle);}bundle.items.push(object);}
    return bundles.map(bundle=>{if(bundle.items.length===1){const {items,...single}=bundle;return single;}
      const items=bundle.items,x=Math.min(...items.map(o=>o.x)),y=Math.min(...items.map(o=>o.y));
      return {...bundle,x,y,width:Math.max(...items.map(o=>o.x+o.width))-x,height:Math.max(...items.map(o=>o.y+o.height))-y,gap:Math.max(...items.map(o=>o.gap)),wrap:items.some(o=>o.wrap==='band')?'band':'square',graphic:{members:items.map(o=>o.graphic)}};
    });
}
export function retargetFlowObjects(group, oldId, newId) {
    for(const entry of group.flow.layout.anchoredObjects || []) if(entry.anchorBlockId===oldId)entry.anchorBlockId=newId;
}
export function partitionFlowObjects(leading,trailing,trailingIds) {
    const all=leading.flow.layout.anchoredObjects;
    if(!all)return;
    trailing.flow.layout.anchoredObjects=structuredClone(all.filter(e=>trailingIds.has(e.anchorBlockId)));
    leading.flow.layout.anchoredObjects=all.filter(e=>!trailingIds.has(e.anchorBlockId));
}
