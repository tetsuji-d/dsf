/** Ephemeral replacement proposals. No DOM, storage, history or external tool registration. */
import {iterateFlowTextMatches} from './flow-search.js';
import {assertValidFlowProjectData} from './flow-project-model.js';
import {replaceAnnotatedText,validateFlowAnnotations} from './flow-annotations.js';
import {remapPlacementText} from './flow-page-placement.js';
import {captureFlowTranslationUnitBeforeSourceEdit,recordFlowManualTranslationUnitEdit} from './flow-translation-state.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const proposals=new WeakSet();
const snapshot=(blocks,groupId)=>JSON.stringify(blocks.filter(b=>b.kind==='flow'&&(!groupId||b.id===groupId)));
const identity=m=>JSON.stringify([m.groupId,m.sectionId,m.blockId,m.languageKey,m.start,m.end]);

export function createFlowReplacePlan(blocks, options = {}) {
    const {query='',replacement='',languageKey,groupId=null,caseSensitive=false,match=null}=options;
    if(typeof replacement!=='string'||replacement.length>4096||/[\r\n\u2028\u2029]/u.test(replacement))fail('REPLACE_TEXT_INVALID');
    if(!query)fail('REPLACE_QUERY_REQUIRED');
    const targets=[],byBlock=new Map();let count=0,rubyReviewCount=0,found=!match;
    for(const hit of iterateFlowTextMatches(blocks,{query,languageKey,groupId,caseSensitive})){
        if(match && (identity(hit)!==identity(match)||hit.expectedText!==match.expectedText))continue;
        found=true;
        if(hit.expectedText.slice(hit.start,hit.end)===replacement)continue;
        if(++count>50000)fail('REPLACE_TOO_MANY');
        const key=JSON.stringify([hit.groupId,hit.sectionId,hit.blockId]);
        let target=byBlock.get(key);
        if(!target){target={...hit,ranges:[]};delete target.start;delete target.end;byBlock.set(key,target);targets.push(target);}
        target.ranges.push(Object.freeze({start:hit.start,end:hit.end}));
        if(match)break;
    }
    if(!found)fail('REPLACE_STALE');
    for(const target of targets){
        const block=blocks.find(g=>g.id===target.groupId).flow.document.sections.find(s=>s.id===target.sectionId).blocks.find(b=>b.id===target.blockId);
        rubyReviewCount+=(block.annotations?.[languageKey]||[]).filter(a=>a.type==='ruby'&&target.ranges.some(r=>a.start<r.end&&r.start<a.end)).length;
        Object.freeze(target.ranges);Object.freeze(target);
    }
    const plan=Object.freeze({groupId,languageKey,replacement,targets:Object.freeze(targets),count,rubyReviewCount,expectedSnapshot:snapshot(blocks,groupId)});
    proposals.add(plan);return plan;
}

export function applyFlowReplacePlan(blocks, plan) {
    // Only a proposal prepared in this session can be applied; callers never supply arbitrary coordinates.
    if(!proposals.has(plan))fail('REPLACE_PLAN_INVALID');
    if(snapshot(blocks,plan.groupId)!==plan.expectedSnapshot)fail('REPLACE_STALE');
    assertValidFlowProjectData({version:6,blocks});
    if(!plan.count)return {blocks,count:0};
    const next=structuredClone(blocks);
    for(const target of plan.targets){
        const group=next.find(g=>g.id===target.groupId),block=group.flow.document.sections.find(s=>s.id===target.sectionId).blocks.find(b=>b.id===target.blockId);
        const language=plan.languageKey,source=language===group.flow.document.sourceLanguage;
        if(source){const captured=captureFlowTranslationUnitBeforeSourceEdit(group,{unitMap:'blocks',unitId:block.id});if(captured.changed)group.flow.translationState=captured.translationState;}
        // Descending exact ranges preserve annotations and anchors between repeated matches.
        for(const range of [...target.ranges].reverse()){
            const before=block.texts[language],after=before.slice(0,range.start)+plan.replacement+before.slice(range.end);
            replaceAnnotatedText(block,language,after,range);
            remapPlacementText(group,block.id,language,before,after,range);
            block.texts[language]=after;
            validateFlowAnnotations(block);
        }
        if(!source){const recorded=recordFlowManualTranslationUnitEdit(group,language,{unitMap:'blocks',unitId:block.id});if(recorded.changed)group.flow.translationState=recorded.translationState;}
    }
    assertValidFlowProjectData({version:6,blocks:next});
    proposals.delete(plan);
    return {blocks:next,count:plan.count};
}
