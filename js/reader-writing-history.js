/** One book-wide timeline. The current document is the checkpoint; deltas work in both directions. */
export const WRITING_HISTORY_OPERATIONS = 30;
export const writingPageKey = p => `${p.language}/${p.pageId}`;
export const sameWritingValue = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function writingPageDelta(language,pageId,before,after) {
    const a=new Map(before.map(o=>[o.id,o])),b=new Map(after.map(o=>[o.id,o]));
    const objects=[];
    for(const id of new Set([...a.keys(),...b.keys()]))if(!sameWritingValue(a.get(id),b.get(id)))
        objects.push({id,before:a.get(id)||null,after:b.get(id)||null});
    const beforeOrder=[...a.keys()],afterOrder=[...b.keys()];
    return objects.length||!sameWritingValue(beforeOrder,afterOrder)?{language,pageId,beforeOrder,afterOrder,objects}:null;
}

export function applyWritingDelta(current,change,forward=true) {
    const from=forward?'before':'after',to=forward?'after':'before';
    if(!sameWritingValue(current.map(o=>o.id),change[from+'Order']))throw Error('WRITING_HISTORY_STATE');
    const objects=new Map(current.map(o=>[o.id,o]));
    for(const entry of change.objects){
        if(!sameWritingValue(objects.get(entry.id)||null,entry[from]))throw Error('WRITING_HISTORY_STATE');
        if(entry[to])objects.set(entry.id,entry[to]);else objects.delete(entry.id);
    }
    const order=change[to+'Order'];
    if(objects.size!==order.length||order.some(id=>!objects.has(id)))throw Error('WRITING_HISTORY_STATE');
    return order.map(id=>objects.get(id));
}

/** Upgrade validated prototype snapshots once. Choose the active branch, retain current content. */
export function upgradeWritingHistory(envelope) {
    if(envelope.history?.schemaVersion!==1)return envelope;
    const old=envelope.history.revisions,byId=new Map(old.map(r=>[r.id,r])),chain=[];
    let r=byId.get(envelope.document.headRevisionId);
    while(r){chain.unshift(r);r=byId.get(r.parentId);}
    // Preserve a redo path when opening a prototype saved after Undo.
    while((r=old.findLast(r=>r.parentId===chain.at(-1).id)))chain.push(r);
    const head=chain.findIndex(r=>r.id===envelope.document.headRevisionId);
    const start=Math.max(0,head-WRITING_HISTORY_OPERATIONS),end=Math.min(chain.length,start+WRITING_HISTORY_OPERATIONS+1);
    const revisions=chain.slice(start,end).map((r,i)=>{
        const {pages,...meta}=r;if(!i)return {...meta,parentId:null,changes:[]};
        const previous=new Map(chain[start+i-1].pages.map(p=>[writingPageKey(p),p]));
        const next=new Map(pages.map(p=>[writingPageKey(p),p]));
        const changes=[];
        for(const key of new Set([...previous.keys(),...next.keys()])){
            const p=next.get(key)||previous.get(key),delta=writingPageDelta(p.language,p.pageId,previous.get(key)?.objects||[],next.get(key)?.objects||[]);
            if(delta)changes.push(delta);
        }
        return {...meta,changes};
    });
    return {...envelope,history:{schemaVersion:2,revisions}};
}

/** Include deleted/redo text only while its operation remains restorable. */
export function* writingRetainedObjects(envelope) {
    for(const p of envelope.document?.pages||[])yield* p.objects;
    for(const r of envelope.history?.revisions||[]){
        if(r.pages)for(const p of r.pages)yield* p.objects;
        for(const c of r.changes||[])for(const o of c.objects){if(o.before)yield o.before;if(o.after)yield o.after;}
    }
}
