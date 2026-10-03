// Bounded, human-readable changes. Never expose complete snapshots or image bytes to AI.
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const safeImage = value => typeof value === 'string' && /^(blob:|https:\/\/|assets\/)/.test(value) ? value : null;
function textFields(block) {
    const result = new Map();
    for (const section of block?.flow?.document?.sections || []) {
        for (const [lang,text] of Object.entries(section.title || {})) if (typeof text === 'string') result.set(`${section.id}/title/${lang}`, text);
        for (const paragraph of section.blocks || []) for (const [lang,text] of Object.entries(paragraph.texts || {}))
            if (typeof text === 'string') result.set(`${section.id}/${paragraph.id}/${lang}`, text);
    }
    const content=block?.content || block;
    if (typeof content?.text === 'string') result.set('text/default',content.text);
    for (const [lang,text] of Object.entries(content?.texts || {})) if (typeof text === 'string') result.set(`text/${lang}`,text);
    for (const [i,bubble] of (content?.bubbles || []).entries()) {
        if (typeof bubble.text === 'string') result.set(`bubble-${i+1}/default`,bubble.text);
        for (const [lang,text] of Object.entries(bubble.texts || {})) if(typeof text==='string') result.set(`bubble-${i+1}/${lang}`,text);
    }
    return result;
}
function targetInfo(id, map) {
    const block=map.get(id), content=block?.content || block;
    const firstSection=block?.flow?.document?.sections?.[0];
    const title=Object.values(firstSection?.title || {}).find(v=>typeof v==='string'&&v) || '';
    return {id, position:[...map.keys()].indexOf(id)+1, type:block?.kind==='flow'?'flow':content?.pageKind==='text'||content?.type==='text'?'text':block?.kind==='page'||content?.type==='image'?'image':'structure', title:title.slice(0,80)};
}
function excerptPair(before = '', after = '') {
    let start = 0;
    while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
    const from = Math.max(0, start - 100), limit = 1200;
    return { before: before.slice(from,from+limit), after: after.slice(from,from+limit), offset: from,
        truncated: from > 0 || before.length > from+limit || after.length > from+limit };
}
export function describeHistoryChange(before, after, details = false, includeImages = false) {
    const left = before.blocks?.length ? before.blocks : before.sections || [];
    const right = after.blocks?.length ? after.blocks : after.sections || [];
    const a = new Map(left.map((b,i)=>[b.id || `section-${i}`,b]));
    const b = new Map(right.map((b,i)=>[b.id || `section-${i}`,b]));
    const added = [...b.keys()].filter(id=>!a.has(id)), removed = [...a.keys()].filter(id=>!b.has(id));
    const edited = [...a.keys()].filter(id=>b.has(id)&&!same(a.get(id),b.get(id)));
    const orderChanged = !same([...a.keys()].filter(id=>b.has(id)),[...b.keys()].filter(id=>a.has(id)));
    const assetsChanged = !same(before.projectAssets,after.projectAssets);
    const targets = [...new Set([...added,...removed,...edited])];
    const result = { addedCount: added.length, removedCount: removed.length, editedCount: edited.length,
        orderChanged, assetsChanged, targetIds: targets.slice(0,50), targetsTruncated: targets.length > 50,
        kind: removed.length ? 'delete' : added.length ? 'add' : orderChanged ? 'move' : edited.length ? 'edit' : assetsChanged ? 'assets' : 'other' };
    result.targets=targets.slice(0,50).map(id=>targetInfo(id,b.has(id)?b:a));
    if (!details) return result;
    result.orderBefore = [...a.keys()].slice(0,100); result.orderAfter = [...b.keys()].slice(0,100);
    result.orderLabelsBefore=result.orderBefore.map(id=>targetInfo(id,a));
    result.orderLabelsAfter=result.orderAfter.map(id=>targetInfo(id,b));
    result.orderTruncated = a.size > 100 || b.size > 100;
    result.changes = []; result.changesTruncated = false;
    for (const targetId of targets) {
        const old = textFields(a.get(targetId)), next = textFields(b.get(targetId));
        for (const path of new Set([...old.keys(),...next.keys()])) {
            if (old.get(path) === next.get(path)) continue;
            if (result.changes.length >= 20) { result.changesTruncated = true; break; }
            result.changes.push({ targetId, field: path, ...excerptPair(old.get(path), next.get(path)) });
        }
    }
    if (includeImages) result.images = targets.slice(0,8).map(targetId => {
        const l = a.get(targetId)?.content || a.get(targetId), r = b.get(targetId)?.content || b.get(targetId);
        return { targetId, before: safeImage(l?.thumbnail || l?.background), after: safeImage(r?.thumbnail || r?.background) };
    }).filter(image=>image.before||image.after);
    return result;
}
