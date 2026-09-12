const assert = require('node:assert/strict');
(async()=>{
const {searchFlowText,resolveFlowSearchTarget}=await import('../js/flow-search.js');
const group=(id,texts)=>({kind:'flow',id,flow:{document:{sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts}]}]}}});
const blocks=[group('a',{ja:'海。海。👩‍👩‍👧‍👦 é [.*]', 'en-GB':'Sea sea.'}),group('b',{ja:'海。'})];
assert.equal(searchFlowText(blocks,{query:'海',languageKey:'ja'}).matches.length,3);
assert.equal(searchFlowText(blocks,{query:'海',languageKey:'ja',groupId:'a'}).matches.length,2);
assert.equal(searchFlowText(blocks,{query:'[.*]',languageKey:'ja'}).matches.length,1);
assert.equal(searchFlowText(blocks,{query:'👩',languageKey:'ja'}).matches.length,0);
assert.equal(searchFlowText(blocks,{query:'e',languageKey:'ja'}).matches.length,0);
assert.equal(searchFlowText(blocks,{query:'sea',languageKey:'en-GB'}).matches.length,2);
assert.equal(searchFlowText(blocks,{query:'sea',languageKey:'en-GB',caseSensitive:true}).matches.length,1);
assert.equal(searchFlowText(blocks,{query:'海',languageKey:'en-US'}).matches.length,0);
assert.equal(searchFlowText(blocks,{query:'海',languageKey:'ja',limit:2}).truncated,true);
const hit=searchFlowText(blocks,{query:'海',languageKey:'ja'}).matches[0];
assert.ok(resolveFlowSearchTarget(blocks,hit));blocks[0].flow.document.sections[0].blocks[0].texts.ja+='変更';assert.equal(resolveFlowSearchTarget(blocks,hit),null);
console.log('Flow search: scope, language, literal characters, graphemes, limit and stale match passed');
})().catch(e=>{console.error(e);process.exitCode=1});
