import {transformWritingErasures} from './reader-writing-eraser.js';
import {makeFormat, validateWritingEnvelope, validateWritingPages, canonicalBytes, WRITING_LIMITS} from './dsf-writing-contract.js';
import {WRITING_HISTORY_OPERATIONS,writingPageKey,writingPageDelta,applyWritingDelta,upgradeWritingHistory} from './reader-writing-history.js';
import {arrowHeadGeometry} from './reader-writing-format.js';

const clone = value => structuredClone(value);
export const writingId = () => crypto.randomUUID();
export function reorderWritingObjectAt(objects,id,index){
    const next=[...objects],from=next.findIndex(o=>o.id===id);if(from<0||next[from].locked||!Number.isInteger(index))return next;
    const [o]=next.splice(from,1);next.splice(Math.max(0,Math.min(next.length,index)),0,o);return next;
}

/** Array order is paint order: last object is in front. Original content is separate. */
export function reorderWritingObject(objects,id,direction){
    const next=[...objects],from=next.findIndex(o=>o.id===id);if(from<0||next[from].locked)return next;
    const to={front:next.length-1,back:0,up:Math.min(next.length-1,from+1),down:Math.max(0,from-1)}[direction];
    if(to===undefined||to===from)return next;
    const [object]=next.splice(from,1);next.splice(to,0,object);return next;
}

/** Immutable page records are indexed once; only affected pages/objects enter an operation. */
export function createReaderWritingModel(handle, fontIds, draft) {
    const context = {baseHash: handle.baseHash, fontIds: new Set(fontIds),
        pageKeys: new Set(Object.entries(handle.bundle.manifests).flatMap(([lang, m]) => m.pages.map(p => `${lang}/${p.id}`)))};
    let envelope = draft ? clone(draft) : handle.envelope;
    if (handle.copyKind === 'writing-shared' && draft) throw new Error('DSF3_SHARED_LOCKED');
    if (envelope.format.copyKind === 'original') {
        const root = {id: writingId(), parentId: null, operation: '書き込み開始', createdAt: new Date().toISOString(), changes: []};
        envelope = {format: makeFormat('writing-editable', handle.baseHash),
            document: {schemaVersion: 1, documentId: writingId(), baseContentHash: handle.baseHash, headRevisionId: root.id, pages: []},
            history: {schemaVersion: 2, revisions: [root]}};
    }
    validateWritingEnvelope(envelope, context);
    envelope=upgradeWritingHistory(envelope);
    const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
    freeze(envelope);
    const pageMap=new Map(envelope.document.pages.map(p=>[writingPageKey(p),p]));
    let revisions=envelope.history?.revisions||[],cursor=revisions.findIndex(r=>r.id===envelope.document.headRevisionId),serial=0;
    const dirty=new Set(pageMap.keys()),stats=new Map(),objectOwners=new Map(),versions=new Map(),empty=Object.freeze([]);
    const pageStats=p=>({bytes:canonicalBytes(p).length,objects:p.objects.length,
        points:p.objects.reduce((n,o)=>n+(o.points?.length||0)+(o.erasures||[]).reduce((sum,m)=>sum+m.points.length,0),0),textUnits:p.objects.reduce((n,o)=>n+(o.text?.length||0),0)});
    for(const [key,p] of pageMap){stats.set(key,pageStats(p));for(const o of p.objects)objectOwners.set(o.id,key);}
    const revisionBytes=new WeakMap();
    const bytes=r=>{if(!revisionBytes.has(r))revisionBytes.set(r,canonicalBytes(r).length);return revisionBytes.get(r);};
    const locked = handle.copyKind === 'writing-shared';
    const editable = () => {if (locked) throw new Error('DSF3_SHARED_LOCKED');};
    const metadata=()=>({...envelope,document:{...envelope.document,headRevisionId:locked?null:revisions[cursor].id,pages:[]},history:locked?null:{schemaVersion:2,revisions}});
    function commit(changed,nextRevisions,nextCursor){
        validateWritingPages([...changed.values()],context.pageKeys,context.fontIds);
        const nextStats=new Map(stats),owners=new Map(objectOwners);
        for(const key of changed.keys())for(const o of pageMap.get(key)?.objects||[])owners.delete(o.id);
        for(const [key,p] of changed){nextStats.set(key,pageStats(p));for(const o of p.objects){if(owners.has(o.id))throw Error('WRITING_DUPLICATE_OBJECT');owners.set(o.id,key);}}
        for(const field of ['objects','points','textUnits'])if([...nextStats.values()].reduce((n,s)=>n+s[field],0)>WRITING_LIMITS[field])throw Error('WRITING_LIMIT');
        // Conservative JSON budget from cached unchanged pages and bounded deltas.
        if([...nextStats.values()].reduce((n,s)=>n+s.bytes+1,0)+nextRevisions.reduce((n,r)=>n+bytes(r)+1,0)+2048>WRITING_LIMITS.jsonBytes)throw Error('WRITING_LIMIT');
        for(const [key,p] of changed){if(p.objects.length)pageMap.set(key,freeze(p));else pageMap.delete(key);stats.set(key,nextStats.get(key));dirty.add(key);versions.set(key,++serial);}
        objectOwners.clear();for(const [id,key] of owners)objectOwners.set(id,key);
        revisions=freeze(nextRevisions);cursor=nextCursor;
    }
    return {
        locked,
        get envelope(){const e=metadata();e.document.pages=[...pageMap.values()];return clone(e);},
        objects(language,pageId){return clone(this.pageObjects(language,pageId));},
        pageObjects(language,pageId){return pageMap.get(`${language}/${pageId}`)?.objects||empty;},
        pageVersion(language,pageId){return versions.get(`${language}/${pageId}`)||0;},
        get revisions(){return revisions.map(({id,parentId,operation,createdAt,changes})=>({id,parentId,operation,createdAt,pages:changes.map(({language,pageId})=>({language,pageId}))}));},
        get head(){return locked?null:revisions[cursor].id;},
        get parent(){return cursor>0?revisions[cursor-1].id:null;},
        get children(){return cursor>=0&&cursor+1<revisions.length?[{id:revisions[cursor+1].id}]:[];},
        /** Capture changed pages before the asynchronous save queue advances to a later edit. */
        takeDraftUpdate(full=false){
            const keys=full?new Set([...pageMap.keys(),...dirty]):dirty;
            const pages=[...keys].map(key=>pageMap.get(key)||{language:key.split('/')[0],pageId:key.slice(key.indexOf('/')+1),objects:[]});
            dirty.clear();return {envelope:metadata(),pages};
        },
        restore(id) {
            editable();const target=revisions.findIndex(r=>r.id===id);if(target<0)throw Error('WRITING_HEAD');
            const changed=new Map(),traversed=[];
            const apply=(r,forward)=>{traversed.push(...r.changes);for(const c of r.changes){const key=writingPageKey(c),p=changed.get(key)||pageMap.get(key);
                changed.set(key,{language:c.language,pageId:c.pageId,objects:applyWritingDelta(p?.objects||[],c,forward)});}};
            if(target<cursor)for(let i=cursor;i>target;i--)apply(revisions[i],false);
            else for(let i=cursor+1;i<=target;i++)apply(revisions[i],true);
            commit(changed,revisions,target);const focus=traversed.at(-1);return focus?{language:focus.language,pageId:focus.pageId}:null;
        },
        change(language, pageId, operation, transform) {
            return this.changePages(language,operation,[{pageId,transform}]);
        },
        changePages(language, operation, changes) {
            editable();if(typeof operation!=='string'||!operation.length||operation.length>80)throw Error('WRITING_OPERATION');
            const changed=new Map(),deltas=[];
            for(const {pageId,transform} of changes){
            const key=`${language}/${pageId}`;if(!context.pageKeys.has(key)||changed.has(key))throw Error('WRITING_PAGE');
            const before=pageMap.get(key)?.objects||empty,after=transform(clone(before));
            validateWritingPages([{language,pageId,objects:after}],context.pageKeys,context.fontIds);
            for(const object of before.filter(o=>o.locked)){
                const replacement=after.find(o=>o.id===object.id);
                if(!replacement||JSON.stringify({...object,locked:false})!==JSON.stringify({...replacement,locked:false}))throw new Error('WRITING_OBJECT_LOCKED');
            }
            const delta=writingPageDelta(language,pageId,before,after);
            if(delta){const old=new Map(before.map(o=>[o.id,o])),modified=new Set(delta.objects.map(o=>o.id));
                changed.set(key,{language,pageId,objects:after.map(o=>modified.has(o.id)?o:old.get(o.id))});deltas.push(delta);}
            }
            if(!deltas.length)return false;
            const revision={id:writingId(),parentId:revisions[cursor].id,operation,createdAt:new Date().toISOString(),changes:deltas};
            let next=[...revisions.slice(0,cursor+1),revision];
            if(next.length>WRITING_HISTORY_OPERATIONS+1){next=next.slice(-WRITING_HISTORY_OPERATIONS-1);next[0]={...next[0],parentId:null,operation:'保持期間の開始',changes:[]};}
            commit(changed,next,next.length-1);return true;
        },
    };
}

export function moveWritingObject(object, dx, dy) {
    const o = transformWritingErasures(clone(object),1,1,dx,dy);
    if (o.type === 'stroke') o.points.forEach(p => {p.x += dx; p.y += dy;});
    else if (o.type === 'line') {o.from = [o.from[0] + dx, o.from[1] + dy]; o.to = [o.to[0] + dx, o.to[1] + dy];}
    else {o.rect[0] += dx; o.rect[1] += dy; if (o.type === 'text') o.layout.forEach(p => {p.x += dx; p.y += dy;});}
    return o;
}

export function writingBounds(o) {
    if (o.rect) return [...o.rect];
    const pts = o.type === 'line' ? [o.from, o.to] : o.points.map(p => [p.x, p.y]);
    if(o.type==='line')for(const h of arrowHeadGeometry(o))pts.push(...(h.kind==='circle'?[[h.center[0]-h.radius,h.center[1]-h.radius],[h.center[0]+h.radius,h.center[1]+h.radius]]:h.points));
    const bounds = pts.reduce((b,p) => [Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])], [Infinity,Infinity,-Infinity,-Infinity]);
    return [bounds[0],bounds[1],Math.max(1,bounds[2]-bounds[0]),Math.max(1,bounds[3]-bounds[1])];
}

/** In-document clipboard copy: keep geometry and text runs, assign a new identity, stay on the page. */
export function duplicateWritingObject(object, dx=12, dy=12) {
    const [x,y,w,h]=writingBounds(object);
    const next=moveWritingObject(object,Math.max(-x,Math.min(360-x-w,dx)),Math.max(-y,Math.min(640-y-h,dy)));
    next.id=writingId();return next;
}

/** Rectangle selection includes fully enclosed, unlocked objects on the active page. */
export function writingMarqueeObjects(objects,rect){
    const [x,y,w,h]=rect;
    return objects.filter(o=>{const [a,b,c,d]=writingBounds(o);return !o.locked&&a>=x&&b>=y&&a+c<=x+w&&b+d<=y+h;});
}

/** Apply only explicitly edited common properties; keep text layout and tool-specific style. */
export function styleWritingSelection(objects,ids,patch){
    const selected=new Set(ids);
    return objects.map(object=>{
        if(!selected.has(object.id)||object.locked)return object;
        const o=clone(object);
        if(patch.color!==undefined){
            if(o.type==='text')o.runs.forEach(run=>{run.color=patch.color;});
            else o.color=patch.color;
        }
        if(Number.isFinite(patch.width)&&patch.width>0&&o.type!=='text'){
            if(o.type==='stroke'){const factor=patch.width/o.baseWidth;o.baseWidth=patch.width;o.points.forEach(p=>{p.width*=factor;});}
            else o.width=patch.width;
        }
        return o;
    });
}

/** Clamp one shared displacement, preserving the spacing of a multiple selection. */
export function moveWritingSelection(objects,dx,dy){
    if(!objects.length)return [];
    const bounds=objects.map(writingBounds),left=Math.min(...bounds.map(b=>b[0])),top=Math.min(...bounds.map(b=>b[1])),right=Math.max(...bounds.map(b=>b[0]+b[2])),bottom=Math.max(...bounds.map(b=>b[1]+b[3]));
    dx=Math.max(Math.min(0,-left),Math.min(Math.max(0,360-right),dx));dy=Math.max(Math.min(0,-top),Math.min(Math.max(0,640-bottom),dy));
    return objects.map(o=>moveWritingObject(o,dx,dy));
}

/** Prototype fixed layout: horizontal wrapping by measured advances, vertical grapheme cells. */
export function createWritingText({id = writingId(), text, x, y, fontId, size, weight, color, vertical, measure,box}) {
    text = text.replace(/\r\n?/g, '\n');
    if (!text.trim() || text.length > 2000) throw new Error('TEXT_LENGTH');
    const step = size * 1.4, layout = [], right = box?box[0]+box[2]:344, bottom = box?box[1]+box[3]:624,minLeft=box?box[0]:4;
    if(box){if(box[2]<size||box[3]<size)throw new Error('TEXT_OVERFLOW');x=vertical?right-size*1.2:box[0];y=box[1]+(vertical?0:size*.2);}
    else {x = Math.max(8, Math.min(x, right - size)); y = Math.max(8, Math.min(y, bottom - size));}
    let px = x, py = y, maxX = x, maxY = y;
    for (const {segment, index} of new Intl.Segmenter('ja', {granularity: 'grapheme'}).segment(text)) {
        const width = vertical ? size : measure(segment);
        if (segment !== '\n') {
            if (!vertical && px + width > right && px > x) {px = x; py += step;}
            if (vertical && py + size > bottom && py > y) {py = y; px -= step;}
            if (px < minLeft-.01 || py + size > bottom+.01||px+width>right+.01) throw new Error('TEXT_OVERFLOW');
        }
        layout.push({start: index, end: index + segment.length, x: px, y: py});
        maxX = Math.max(maxX, px + width); maxY = Math.max(maxY, py + size);
        if (segment === '\n') {if (vertical) {px -= step; py = y;} else {px = x; py += step;}}
        else if (vertical) py += size; else px += width;
    }
    const left = Math.min(x, ...layout.map(p => p.x));
    return {id, type: 'text', text, rect: box?[...box]:[left, y, Math.max(size, maxX - left), Math.max(size, maxY - y)],
        writingMode: vertical ? 'vertical-rl' : 'horizontal-tb', align: 'start',
        runs: [{start: 0, end: text.length, fontId, size, weight, color}], layout};
}
