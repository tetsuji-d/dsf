import assert from 'node:assert/strict';
import { createFlowGroupBlock, validateFlowLayoutSettings } from '../js/flow-project-model.js';
import { resolveFlowDomTypography } from '../js/flow-dom-measurer.js';
import { serializeProject, deserializeProject } from '../js/project-persistence.js';
import { getFlowJoinLayoutDifferences } from '../js/flow-group-join.js';
const group=createFlowGroupBlock({sourceLanguage:'ja',writingMode:'vertical-rl'});
const original=structuredClone(group.flow.document);
assert.equal(resolveFlowDomTypography('ja',{},'vertical-rl').blockAlign,'start');
for(const blockAlign of ['start','center','end']) {
 group.flow.layout.typographyByLanguage.ja.blockAlign=blockAlign;
 assert.equal(validateFlowLayoutSettings(group.flow.layout).valid,true);
 assert.equal(resolveFlowDomTypography('ja',group.flow.layout.typographyByLanguage.ja,'vertical-rl').blockAlign,blockAlign);
 const saved=deserializeProject(serializeProject({version:6,blocks:[group],languages:['ja'],defaultLang:'ja'}));
 assert.deepEqual(saved.blocks[0],group);
}
assert.deepEqual(group.flow.document,original);
const other=structuredClone(group.flow.layout);other.typographyByLanguage.ja.blockAlign='center';
assert.deepEqual(getFlowJoinLayoutDifferences(group.flow.layout,other),[{field:'blockAlign',language:'ja'}]);
group.flow.layout.typographyByLanguage.ja.blockAlign='invalid';
assert.equal(validateFlowLayoutSettings(group.flow.layout).valid,false);
assert.throws(()=>resolveFlowDomTypography('ja',group.flow.layout.typographyByLanguage.ja,'vertical-rl'));
console.log('Flow placement: defaults, alignment validation, source preservation, persistence and join differences passed.');
