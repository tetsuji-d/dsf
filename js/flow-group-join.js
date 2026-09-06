import { deepClone } from './utils.js';
import { assertValidFlowProjectData } from './flow-project-model.js';
import { applyFlowAuthoringOperation } from './flow-authoring.js';

const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const omit = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));
const same = (a,b) => canonical(a) === canonical(b);
function fail(code) { const error = new Error('Flow groups cannot be joined safely.'); error.code = code; throw error; }
function compatible(a,b,keys=[]) { if (!same(omit(a,keys),omit(b,keys))) fail('metadata'); }
function union(a={},b={}) {
    const out = deepClone(a);
    for (const [id,value] of Object.entries(b)) {
        if (Object.hasOwn(out,id) && !same(out[id],value)) fail('metadata');
        out[id] = deepClone(value);
    }
    return out;
}
function mergeTranslation(a,b) {
    if (!a) return deepClone(b);
    if (!b) return deepClone(a);
    compatible(a,b,['languages']);
    const result = deepClone(a);
    for (const [language,right] of Object.entries(b.languages)) {
        const left = result.languages[language];
        if (!left) { result.languages[language] = deepClone(right); continue; }
        compatible(left,right,['sourceFingerprints','lockedUnitIds']);
        compatible(left.sourceFingerprints,right.sourceFingerprints,['blocks','sectionTitles']);
        for (const map of ['blocks','sectionTitles']) left.sourceFingerprints[map] = union(left.sourceFingerprints[map],right.sourceFingerprints[map]);
        if (left.lockedUnitIds || right.lockedUnitIds) left.lockedUnitIds = [...new Set([...(left.lockedUnitIds||[]),...(right.lockedUnitIds||[])])];
    }
    return result;
}

/** Immutable authoring transaction. No page snapshots, assets, or schema additions. */
export function joinFlowWithPrevious(blocks, groupId, {mergeParagraphs=false}={}) {
    assertValidFlowProjectData({version:6,blocks});
    const index = blocks.findIndex(b=>b.id===groupId);
    const right = blocks[index], left = blocks[index-1];
    if (right?.kind!=='flow' || left?.kind!=='flow') fail('adjacent');
    if (left.flow.document.sourceLanguage!==right.flow.document.sourceLanguage) fail('language');
    if (!same(left.flow.layout,right.flow.layout)) fail('layout');
    compatible(left,right,['id','flow']);
    compatible(left.flow,right.flow,['document','translationState']);
    compatible(left.flow.document,right.flow.document,['id','sections']);
    const joined = deepClone(left);
    const sections = joined.flow.document.sections, incoming = deepClone(right.flow.document.sections);
    const last = sections.at(-1), first = incoming[0];
    const sharedBoundary = last && first && last.id === first.id;
    const leftTailId = last?.blocks.at(-1)?.id;
    const rightHeadId = first?.blocks[0]?.id;
    if (sharedBoundary) {
        compatible(last,first,['blocks']);
        last.blocks.push(...first.blocks);
        incoming.shift();
    }
    sections.push(...incoming);
    const state = mergeTranslation(left.flow.translationState,right.flow.translationState);
    if (state) joined.flow.translationState = state;
    let next = [...blocks]; next.splice(index-1,2,joined);
    // Duplicate sections/blocks elsewhere are rejected instead of silently reidentifying translations.
    try { assertValidFlowProjectData({version:6,blocks:next}); } catch { fail('ids'); }
    let focusPoint = {sectionId:first?.id,blockId:rightHeadId,utf16Offset:0};
    if (mergeParagraphs) {
        if (!sharedBoundary) fail('paragraph');
        const before = last.blocks.find(b=>b.id===leftTailId), after = last.blocks.find(b=>b.id===rightHeadId);
        if (before?.type!=='paragraph' || after?.type!=='paragraph') fail('paragraph');
        compatible(before,after,['id','texts']);
        const language = joined.flow.document.sourceLanguage;
        if (Object.keys(after.texts||{}).some(k=>k!==language)) fail('translation');
        // The removed block must not carry locks or translation records.
        if (Object.values(state?.languages||{}).some(s=>s.lockedUnitIds?.includes(after.id)
            || Object.hasOwn(s.sourceFingerprints.blocks,after.id))) fail('translation');
        focusPoint = {sectionId:last.id,blockId:before.id,utf16Offset:(before.texts?.[language]||'').length};
        next = applyFlowAuthoringOperation(next,{type:'mergeParagraphBackward',groupId:left.id,
            sectionId:last.id,blockId:after.id,languageKey:language});
    }
    assertValidFlowProjectData({version:6,blocks:next});
    return {blocks:next,activeBlockIndex:index-1,groupId:left.id,focusPoint};
}

export function inspectFlowJoin(blocks,groupId,options={}) {
    try { joinFlowWithPrevious(blocks,groupId,options); return {eligible:true,reason:''}; }
    catch(error) { return {eligible:false,reason:['adjacent','language','layout','metadata','ids','paragraph','translation'].includes(error.code)?error.code:'invalid'}; }
}
