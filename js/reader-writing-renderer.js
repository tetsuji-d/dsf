import {writingBounds} from './reader-writing-model.js';
import {arrowHeadGeometry,arrowShaftGeometry,lineStrokeAttributes} from './reader-writing-format.js';
import {writingControlPoints,strokeOutline,highlighterPolygons,brushInkPaths,naturalBrushInkPaths} from './reader-writing-tools.js';
const NS = 'http://www.w3.org/2000/svg';
let selectionSerial=0;
const renderedLayers=new WeakMap();
const liveStrokes=new WeakMap();
function svg(name, attrs) {const el = document.createElementNS(NS, name); for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v); return el;}

/** Live ink is separate from saved objects. Constant-width pens need only two nodes. */
export function renderWritingStrokePreview(layer,stroke) {
    if(stroke.tool==='brush'||stroke.tool==='highlighter'){
        liveStrokes.delete(layer);renderWritingLayer(layer,[stroke],{});return;
    }
    let live=liveStrokes.get(layer);
    if(!live||live.id!==stroke.id||live.item.parentNode!==layer){
        const item=document.createElement('div');item.className='rw-object';item.dataset.objectId=stroke.id;
        const root=svg('svg',{viewBox:'0 0 360 640','aria-hidden':'true'}),group=svg('g',{opacity:stroke.opacity});
        const line=svg('polyline',{fill:'none',stroke:stroke.color,'stroke-width':stroke.baseWidth,'stroke-linecap':'round','stroke-linejoin':'round'});
        const dot=svg('circle',{r:stroke.baseWidth/2,fill:stroke.color});group.append(line,dot);root.append(group);item.append(root);layer.replaceChildren(item);
        live={id:stroke.id,item,line,dot};liveStrokes.set(layer,live);
    }
    live.line.setAttribute('points',stroke.points.map(p=>`${p.x},${p.y}`).join(' '));
    live.dot.setAttribute('cx',stroke.points[0].x);live.dot.setAttribute('cy',stroke.points[0].y);
}

/** Render only saved Writing geometry. Parent surface is always 360 x 640. */
export function renderWritingLayer(layer, objects, families, selected) {
    const fontKey=JSON.stringify(families),old=renderedLayers.get(layer),cache=new Map();
    layer.replaceChildren();
    for (const o of objects) {
        const previous=old?.fontKey===fontKey?old.objects.get(o.id):null;
        const reusable=previous?.object===o&&Object.isFrozen(o);
        const item = reusable?previous.item:document.createElement('div'); item.className = 'rw-object'; item.dataset.objectId = o.id;
        item.style.visibility='';
        if(!reusable){
        if (o.type === 'text') {
            if(o.boxStyle){const [x,y,width,height]=o.rect,frame=svg('svg',{viewBox:'0 0 360 640','aria-hidden':'true'});
                frame.append(svg('rect',{x,y,width,height,fill:o.boxStyle.fill||'none',stroke:o.boxStyle.stroke||'none','stroke-width':o.boxStyle.width}));item.append(frame);}
            for (const p of o.layout) {
                const run = o.runs.find(r => r.start <= p.start && r.end >= p.end), span = document.createElement('span');
                span.textContent = o.text.slice(p.start, p.end); span.className = 'rw-text';
                Object.assign(span.style, {left: `${p.x}px`, top: `${p.y}px`, fontFamily: `"${families[run.fontId]}"`,
                    fontSize: `${run.size}px`, fontWeight: run.weight, color: run.color, writingMode: o.writingMode});
                item.append(span);
            }
        } else {
            const root = svg('svg', {viewBox: '0 0 360 640', 'aria-hidden': 'true'});
            if (o.type === 'stroke') {
                // One group opacity prevents translucent strokes darkening at every segment joint.
                const group = svg('g', {opacity: o.opacity});
                if(o.tool==='highlighter')for(const polygon of highlighterPolygons(o.points))group.append(svg('polygon',{points:polygon.map(p=>p.join(',')).join(' '),fill:o.color}));
                else if(o.tool==='brush'&&o.geometryVersion>=2)for(const path of (o.geometryVersion>=3?naturalBrushInkPaths:brushInkPaths)(o.points,o.inkAmount,o.geometryVersion===4))group.append(svg('path',{...path,fill:o.color}));
                else if(o.tool==='brush'&&o.points.length>1)group.append(svg('path',{d:strokeOutline(o.points),fill:o.color}));
                else o.points.forEach((p,i) => {const a = o.points[Math.max(0, i-1)];
                    group.append(svg('line', {x1:a.x, y1:a.y, x2:p.x, y2:p.y, stroke:o.color, 'stroke-width':p.width, 'stroke-linecap':'round'}));
                    group.append(svg('circle', {cx:p.x, cy:p.y, r:p.width/2, fill:o.color}));
                }); root.append(group);
            } else if (o.type === 'line') {
                const shaft=arrowShaftGeometry(o);
                if(shaft)root.append(svg('line', {x1:shaft.from[0], y1:shaft.from[1], x2:shaft.to[0], y2:shaft.to[1], stroke:o.color, 'stroke-width':o.width,...lineStrokeAttributes(o.lineStyle,o.width)}));
                for(const head of arrowHeadGeometry(o))root.append(head.kind==='circle'
                    ?svg('circle',{cx:head.center[0],cy:head.center[1],r:head.radius,fill:o.color})
                    :svg(head.kind==='open'?'polyline':'polygon',{points:head.points.map(p=>p.join(',')).join(' '),fill:head.kind==='open'?'none':o.color,stroke:o.color,'stroke-width':o.width,'stroke-linejoin':'round'}));
            } else {
                const [x,y,w,h] = o.rect;
                root.append(svg(o.shape === 'ellipse' ? 'ellipse' : 'rect', {...(o.shape === 'ellipse' ? {cx:x+w/2,cy:y+h/2,rx:w/2,ry:h/2} : {x,y,width:w,height:h}),
                    stroke:o.color, fill:o.fill||'none', 'stroke-width':o.width, opacity:o.opacity,...lineStrokeAttributes(o.lineStyle,o.width)}));
            }
            item.append(root);
        }
        }
        cache.set(o.id,{object:o,item});layer.append(item);
        if (selected instanceof Set ? selected.has(o.id) : selected === o.id) {
            if(o.type==='text'){const [x,y,w,h]=writingBounds(o),box=document.createElement('div');box.className='rw-selection';
                Object.assign(box.style,{left:`${x-4}px`,top:`${y-4}px`,width:`${w+8}px`,height:`${h+8}px`});layer.append(box);
            }else{
                // Trace the actual ink (including arrows and variable-width strokes), never its bounding box.
                const outline=svg('svg',{viewBox:'0 0 360 640',class:'rw-contour','aria-hidden':'true'}),id=`rw-contour-${++selectionSerial}`;
                const defs=svg('defs',{}),filter=svg('filter',{id,filterUnits:'userSpaceOnUse',x:0,y:0,width:360,height:640});
                filter.append(svg('feMorphology',{in:'SourceAlpha',operator:'dilate',radius:3,result:'outer'}),svg('feMorphology',{in:'SourceAlpha',operator:'dilate',radius:1,result:'inner'}),
                    svg('feComposite',{in:'outer',in2:'inner',operator:'out',result:'ring'}),svg('feFlood',{'flood-color':'#1687ae'}),svg('feComposite',{in2:'ring',operator:'in'}));
                defs.append(filter);outline.append(defs);const ink=svg('g',{filter:`url(#${id})`});
                for(const child of item.querySelector('svg').children){const copy=child.cloneNode(true);copy.removeAttribute('opacity');for(const node of copy.querySelectorAll('[opacity]'))node.removeAttribute('opacity');ink.append(copy);}
                outline.append(ink);layer.append(outline);
            }
            for(const p of o.locked||selected instanceof Set&&selected.size>1?[]:writingControlPoints(o)){const knob=document.createElement('span');knob.className='rw-handle';knob.dataset.handle=p.key;
                Object.assign(knob.style,{left:`${p.x}px`,top:`${p.y}px`});layer.append(knob);}}
    }
    renderedLayers.set(layer,{fontKey,objects:cache});
}
