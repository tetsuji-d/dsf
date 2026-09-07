import { resolveFlowDomTypography } from './flow-dom-measurer.js';
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

const typographyKeys = ['writingMode','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','paragraphSpacing','headingSpacing','textColor','paperColor'];

/** Compare effective known settings; never discard unknown layout metadata. */
export function getFlowJoinLayoutDifferences(left, right, options = {}) {
    compatible(left, right, ['padding','typographyByLanguage']);
    compatible(left.padding, right.padding, ['top','right','bottom','left']);
    const differences = [];
    for (const side of ['top','right','bottom','left']) {
        if (!same(left.padding[side],right.padding[side])) differences.push({field:'padding_' + side,language:''});
    }
    const a = left.typographyByLanguage, b = right.typographyByLanguage;
    // Missing language profiles affect fallback routing as well as typography.
    if (!same(Object.keys(a).sort(),Object.keys(b).sort())) fail('metadata');
    for (const language of Object.keys(a)) {
        compatible(a[language],b[language],typographyKeys);
        const before = resolveFlowDomTypography(language,a[language],a[language].writingMode,options);
        const after = resolveFlowDomTypography(language,b[language],b[language].writingMode,options);
        for (const field of typographyKeys) {
            if (!same(before[field],after[field])) differences.push({field,language});
        }
    }
    return differences;
}

/** Immutable authoring transaction. No page snapshots, assets, or schema additions. */
export function joinFlowWithPrevious(blocks, groupId, {mergeParagraphs=false, usePreviousLayout=false, languageConfigs}={}) {
    assertValidFlowProjectData({version:6,blocks});
    const index = blocks.findIndex(b=>b.id===groupId);
    const right = blocks[index], left = blocks[index-1];
    if (right?.kind!=='flow' || left?.kind!=='flow') fail('adjacent');
    if (left.flow.document.sourceLanguage!==right.flow.document.sourceLanguage) fail('language');
    const differences = getFlowJoinLayoutDifferences(left.flow.layout,right.flow.layout,{languageConfigs});
    if (differences.length && !usePreviousLayout) fail('layout');
    compatible(left,right,['id','flow']);
    compatible(left.flow,right.flow,['document','translationState','layout']);
    compatible(left.flow.document,right.flow.document,['id','sections','schemaVersion']);
    const joined = deepClone(left);
    joined.flow.document.schemaVersion = Math.max(left.flow.document.schemaVersion, right.flow.document.schemaVersion);
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
        compatible(before,after,['id','texts','annotations']);
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
