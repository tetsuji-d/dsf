// Isolated local-browser acceptance. Does not access the user's browser profile.
// Set DSF_PLAYWRIGHT_MODULE if Playwright is supplied outside this checkout.
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
const {tmpdir}=require('node:os');
const baseURL=process.env.DSF_TEST_BASE_URL || 'http://127.0.0.1:5178';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(baseURL).hostname)) throw new Error('This fixture runs only against a local development server.');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let page;try{
page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.stack));
await page.goto(baseURL+'/studio?room=editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.changeFlowGeneratedPage==='function');
await page.evaluate(async()=>{
 const {state}=await import('/js/state.js'); const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
 const canvas=document.createElement('canvas');canvas.width=120;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#537c96';ctx.fillRect(0,0,120,180);const blob=await new Promise(r=>canvas.toBlob(r,'image/webp'));const url=URL.createObjectURL(blob);
 state.blocks=[createFlowGroupBlock({id:'ribbon',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',title:{ja:'第一章'},blocks:[{id:'heading',type:'heading',level:1,texts:{ja:'第一章　朝の光','en-GB':'Morning Light',ko:'아침 햇살'}},{id:'body',type:'paragraph',texts:{ja:'朝の光が、窓辺に置いた一冊の本を照らしていた。'.repeat(110),'en-GB':'The morning light fell on a book by the window. '.repeat(30),ko:'아침 햇살이 책을 비추었습니다.'.repeat(30)}}]}]}}),{id:'picture',kind:'page',content:{pageKind:'image',background:url,bubbles:[],headings:{ja:'画像の章'}}},{id:'fixed',kind:'page',content:{pageKind:'text',texts:{ja:'固定本文を保持'},bubbles:[]}}];
 for(const languageKey of ['en-GB','en-US','ko']) state.blocks=(await import('/js/flow-multilingual-authoring.js')).ensureFlowLanguageTypography(state.blocks,{groupId:'ribbon',languageKey,writingMode:'horizontal-tb'}).blocks;
 state.projectAssets=[{id:'asset',name:'sample.webp',mimeType:'image/webp',width:120,height:180,byteLength:blob.size,background:url,thumbnail:url}];
 state.sections=(await import('/js/blocks.js')).extractSectionsFromBlocks(state.blocks);state.pages=[];state.version=6;state.activeLang='ja';state.defaultLang='ja';state.languages=['ja','en-GB','en-US','ko'];state.activeBlockIdx=0;state.projectName='リボン統合の操作確認';state.localProjectId='local_ribbon_test';window.changeFlowSourceBlock(0);window.setStudioUILang('ja');
});



// Mark the existing heading as a shared title region, without splitting translations.
await page.evaluate(async()=>{
 const {state}=await import('/js/state.js');
 const {isolateFlowTitlePage}=await import('/js/flow-title-page.js');
 const b=state.blocks[0].flow.document.sections[0].blocks[0];
 state.blocks=isolateFlowTitlePage(state.blocks,'ribbon',{fragments:[{sectionId:'s',blockId:b.id,languageKey:'ja',text:b.texts.ja,sourceRange:{start:0,end:b.texts.ja.length}}]}).blocks;
 window.changeFlowGeneratedPage(0,0);
});
await page.locator('#flow-compare-split').click();
const target=page.locator('[data-compare-side=target] .flow-dom-block[data-flow-block-id=heading]').first();
await target.click();
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='en-GB');

const read=()=>page.evaluate(async()=>JSON.parse(JSON.stringify((await import('/js/state.js')).state.blocks[0].flow.document)));
const before=await read();
const geometry=()=>target.evaluate(el=>{
 const content=el.closest('.flow-dom-content');const c=content.getBoundingClientRect(),b=el.getBoundingClientRect();
 const range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();
 return {align:getComputedStyle(el).textAlign,justify:getComputedStyle(content).justifyContent,dy:Math.abs((b.top+b.bottom-c.top-c.bottom)/2),dx:Math.abs((text.left+text.right-c.left-c.right)/2)};
});
let g=await geometry();assert.equal(g.align,'center');assert.equal(g.justify,'center');assert.ok(g.dy<3,JSON.stringify(g));assert.ok(g.dx<3,JSON.stringify(g));
const choice=(field,value)=>page.locator(`#flow-ribbon-placement [data-ribbon-original=flow-placement-${field}][data-ribbon-value=${value}]`);
assert.equal(await choice('inline','end').isEnabled(),true);
assert.equal(await page.locator('#flow-ribbon-placement [data-ribbon-original=flow-make-title]').isDisabled(),true);
assert.equal(await page.locator('#flow-ribbon-placement [data-ribbon-original=flow-restore-body]').isDisabled(),true);
assert.match(await page.locator('#ribbon-flow-scope').textContent(),/全言語共通/);
await choice('inline','end').click();
await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-compare-side=target] [data-flow-block-id=heading]')).textAlign==='end');
let after=await read();assert.equal(after.sections[0].blocks[0].textAlignByLanguage['en-GB'],'end');assert.equal(after.sections[0].blocks[0].titleRegion.textAlign,'center');
assert.deepEqual(after.sections.map(s=>s.blocks.map(b=>b.texts)),before.sections.map(s=>s.blocks.map(b=>b.texts)));
await page.locator('#btn-undo').click();assert.deepEqual(await read(),before);
await choice('block','end').click();
await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-compare-side=target] [data-flow-block-id=heading]').closest('.flow-dom-content')).justifyContent==='flex-end');
await page.locator('#btn-undo').click();assert.deepEqual(await read(),before);
// Source still has the shared centered title, while ordinary target body remains start aligned.
assert.equal(await page.locator('[data-compare-side=source] [data-flow-block-id=heading]').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
await page.locator('[data-compare-side=target] [data-flow-block-id=body]').first().click();
await page.waitForFunction(()=>!document.querySelector('#flow-placement-inline').disabled);
assert.equal(await choice('inline','center').isEnabled(),true);
assert.equal(await page.locator('[data-compare-side=target] [data-flow-block-id=body]').first().evaluate(el=>getComputedStyle(el).textAlign),'start');
await choice('inline','center').click();
await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-compare-side=target] [data-flow-block-id=body]')).textAlign==='center');
const bodyAfter=await read();assert.equal(bodyAfter.sections[0].blocks[1].textAlignByLanguage['en-GB'],'center');
assert.equal(bodyAfter.sections[0].blocks[1].textAlignByLanguage.ja,undefined);
assert.equal(bodyAfter.sections[0].blocks[1].titleRegion,undefined);
assert.deepEqual(bodyAfter.sections[0].blocks[1].texts,before.sections[0].blocks[1].texts);
await page.locator('#btn-undo').click();assert.deepEqual(await read(),before);
// Normal mode has the same alignment as split mode.
await page.locator('#flow-compare-normal').click();
await page.locator('#page-strip-thumbs [data-flow-page-index="0"]').first().click();
assert.equal(await page.locator('.flow-editor-page-surface [data-flow-block-id=heading]').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
assert.deepEqual(errors,[]);console.log('Translated title: centered geometry, real ribbon alignment, shared scope, structural guard, Undo, body and normal-mode regression passed');
} catch(e){if(page)await page.screenshot({path:tmpdir()+'/flow-title-translation-failure.png'});throw e}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
