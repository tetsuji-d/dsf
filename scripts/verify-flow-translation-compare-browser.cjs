// Isolated local-browser acceptance. Does not access the user's browser profile.
// Set DSF_PLAYWRIGHT_MODULE if Playwright is supplied outside this checkout.
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
const {tmpdir}=require('node:os');
const baseURL=process.env.DSF_TEST_BASE_URL || 'http://127.0.0.1:5178';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(baseURL).hostname)) throw new Error('This fixture runs only against a local development server.');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let page;try{
page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
await page.goto(baseURL+'/studio?room=editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.changeFlowGeneratedPage==='function');
await page.evaluate(async()=>{
 const {state}=await import('/js/state.js'); const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
 const canvas=document.createElement('canvas');canvas.width=120;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#537c96';ctx.fillRect(0,0,120,180);const blob=await new Promise(r=>canvas.toBlob(r,'image/webp'));const url=URL.createObjectURL(blob);
 state.blocks=[createFlowGroupBlock({id:'ribbon',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',title:{ja:'第一章'},blocks:[{id:'heading',type:'heading',level:1,texts:{ja:'第一章　朝の光','en-GB':'Morning Light',ko:'아침 햇살'}},{id:'body',type:'paragraph',texts:{ja:'朝の光が、窓辺に置いた一冊の本を照らしていた。'.repeat(110),'en-GB':'The morning light fell on a book by the window. '.repeat(30),ko:'아침 햇살이 책을 비추었습니다.'.repeat(30)}}]}]}}),{id:'picture',kind:'page',content:{pageKind:'image',background:url,bubbles:[],headings:{ja:'画像の章'}}},{id:'fixed',kind:'page',content:{pageKind:'text',texts:{ja:'固定本文を保持'},bubbles:[]}}];
 for(const languageKey of ['en-GB','en-US','ko']) state.blocks=(await import('/js/flow-multilingual-authoring.js')).ensureFlowLanguageTypography(state.blocks,{groupId:'ribbon',languageKey,writingMode:'horizontal-tb'}).blocks;
 state.projectAssets=[{id:'asset',name:'sample.webp',mimeType:'image/webp',width:120,height:180,byteLength:blob.size,background:url,thumbnail:url}];
 state.sections=(await import('/js/blocks.js')).extractSectionsFromBlocks(state.blocks);state.pages=[];state.version=6;state.activeLang='ja';state.defaultLang='ja';state.languages=['ja','en-GB','en-US','ko'];state.activeBlockIdx=0;state.projectName='リボン統合の操作確認';state.localProjectId='local_ribbon_test';window.changeFlowSourceBlock(0);window.setStudioUILang('ja');
});


await page.locator('#page-strip-thumbs [data-flow-page-index="0"]').first().click();
await page.locator('#flow-compare-split').click();
const sourcePane=page.locator('[data-compare-side=source]'),targetPane=page.locator('[data-compare-side=target]');
await targetPane.locator('.flow-dom-block[data-flow-block-id=body]').first().waitFor({state:'visible'});
const read=()=>page.evaluate(async()=>JSON.parse(JSON.stringify((await import('/js/state.js')).state.blocks)));
const before=await read();
console.log('split visible',await page.locator('#flow-translation-compare').boundingBox());
await targetPane.locator('.flow-dom-block[data-flow-block-id=body]').first().click();
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='en-GB');
await page.locator('.flow-direct-input-proxy').pressSequentially('Edited ');
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.dataset.flowReflowPending!=='true');
let after=await read();assert.match(after[0].flow.document.sections[0].blocks[1].texts['en-GB'],/Edited /);assert.equal(after[0].flow.document.sections[0].blocks[1].texts.ja,before[0].flow.document.sections[0].blocks[1].texts.ja);
console.log('target edit preserved source');
await page.locator('#btn-undo').click();await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.dataset.flowReflowPending!=='true');assert.deepEqual(await read(),before);
await sourcePane.locator('.flow-dom-block[data-flow-block-id=body]').first().click();
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='ja');
await page.locator('.flow-direct-input-proxy').pressSequentially('変更');
await page.waitForFunction(()=>document.querySelector('.flow-compare-stale'));
after=await read();assert.equal(after[0].flow.document.sections[0].blocks[1].texts['en-GB'],before[0].flow.document.sections[0].blocks[1].texts['en-GB']);
assert.equal(await targetPane.locator('[data-flow-direct-capability=editable]').count()>0,true);
const fallback=await page.evaluate(async()=>{const {state}=await import('/js/state.js');const runtime=await import('/js/flow-runtime-pages.js');const projection=await runtime.createFlowRuntimePageProjection(state,{languageKey:'en-GB',fixedPages:state.sections});return runtime.resolveFlowRuntimeLanguage(state.blocks[0],'en-GB').isSourceFallback && projection.pages.filter(p=>p.kind==='flow').every(p=>p.isSourceFallback && p.languageKey==='ja')});assert.equal(fallback,true);
console.log('source edit retains stale translation; normal/public resolver remains fail closed');

// Confirm only the selected unit, without changing a byte of either manuscript.
await page.locator('#flow-compare-confirm').click();
await page.waitForFunction(()=>!document.querySelector('.flow-compare-stale'));
let reviewed=await read();assert.deepEqual(reviewed[0].flow.document,after[0].flow.document);
await page.locator('#btn-undo').click();await page.waitForFunction(()=>document.querySelector('.flow-compare-stale'));
const visibleViewport=pane=>pane.locator('.flow-canvas-viewport:not([hidden])');
const offset=pane=>visibleViewport(pane).evaluate(e=>e.scrollLeft);
const targetStart=await offset(targetPane);
await visibleViewport(sourcePane).hover();await page.mouse.wheel(0,450);
await page.waitForFunction(x=>{const e=document.querySelector('[data-compare-side=target] .flow-canvas-viewport:not([hidden])');return Math.abs(e.scrollLeft-x)>1},targetStart);
const sourceScrolled=await offset(sourcePane);
await visibleViewport(targetPane).hover();await page.mouse.wheel(0,-180);
await page.waitForFunction(x=>{const e=document.querySelector('[data-compare-side=source] .flow-canvas-viewport:not([hidden])');return Math.abs(e.scrollLeft-x)>1},sourceScrolled);
await page.locator('#flow-compare-sync').click();const independent=await offset(targetPane);
await visibleViewport(sourcePane).hover();await page.mouse.wheel(0,120);await page.waitForTimeout(100);assert.equal(await offset(targetPane),independent);
await page.locator('#flow-compare-sync').click();
const divider=page.locator('.flow-compare-divider');await divider.focus();await divider.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'52');
await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(100);const paneBox=await targetPane.boundingBox();assert.ok(paneBox.x+paneBox.width<=1100);
await page.setViewportSize({width:1440,height:900});
console.log('selected review/Undo, bidirectional wheel sync, independent scroll and resize passed');
await page.locator('#flow-compare-language').selectOption('ko');
await targetPane.locator('.flow-canvas-viewport:not([hidden]) [data-flow-language-key=ko]').first().waitFor({state:'visible'});
assert.equal((await page.evaluate(async()=>(await import('/js/state.js')).state.activeLang)),'ko');
await page.locator('#flow-compare-language').selectOption('en-US');
await page.waitForFunction(()=>document.querySelector('[data-compare-side=target] .flow-canvas-viewport:not([hidden]) .flow-compare-missing'));
assert.deepEqual((await read())[0].flow.document.sections[0].blocks.map(b=>b.texts['en-US']),[undefined,undefined]);
console.log('language switch and missing translation placeholders do not create saved translations');
// Empty target paragraphs can be filled directly; merely focusing saves nothing.
const missing=targetPane.locator('.flow-canvas-viewport:not([hidden]) [data-flow-block-id=body]');
await missing.click();
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='en-US');
assert.equal((await read())[0].flow.document.sections[0].blocks[1].texts['en-US'],undefined);
await page.locator('.flow-direct-input-proxy').pressSequentially('New translation');
await page.waitForFunction(async()=>(await import('/js/state.js')).state.blocks[0].flow.document.sections[0].blocks[1].texts['en-US']==='New translation');
await page.locator('#btn-undo').click();
await page.waitForFunction(async()=>!Object.hasOwn((await import('/js/state.js')).state.blocks[0].flow.document.sections[0].blocks[1].texts,'en-US'));
await page.evaluate(()=>window.__flowAuthoringLab.installDeterministicTranslationProvider());
await page.locator('#flow-compare-translation-settings').click();
await page.locator('#flow-canvas-translation-panel [data-flow-action=start-translation]').click();
await page.waitForFunction(()=>window.__flowAuthoringLab.getTranslationJob()?.state==='success');
assert.equal(await page.locator('#flow-translation-compare').isVisible(),true);
assert.match((await read())[0].flow.document.sections[0].blocks[1].texts['en-US'],/en-US/);
await page.locator('#flow-canvas-translation-panel > button').click();
await page.locator('#btn-undo').click();
console.log('missing translation direct input/Undo and canvas automatic translation passed');

await page.locator('#flow-compare-language').selectOption('en-GB');
await targetPane.locator('.flow-canvas-viewport:not([hidden]) [data-flow-language-key="en-GB"]').first().waitFor({state:'visible'});
await page.locator('#flow-compare-translation-settings').click();
await page.locator('#flow-canvas-translation-panel').waitFor({state:'visible'});
assert.equal(await page.locator('#flow-translation-compare').isVisible(),true);
await page.locator('#flow-canvas-translation-panel > button').click();

await page.locator('#flow-ribbon-home [data-ribbon-original=flow-open-source]').click();
await page.locator('.flow-authoring-input').first().waitFor({state:'visible'});
const originalRoot=page.locator('#flow-authoring-surface .flow-authoring-editor').first();
await originalRoot.evaluate(e=>e.scrollTop=0);await originalRoot.hover();await page.mouse.wheel(0,400);
await page.waitForFunction(()=>document.querySelector('#flow-authoring-surface .flow-authoring-editor').scrollTop>0);
console.log('manuscript wheel scroll passed');
await page.locator('#flow-manuscript-split').click();
const ms=page.locator('[data-manuscript-side=source]'),mt=page.locator('[data-manuscript-side=target]');
await mt.waitFor({state:'visible'});
const originalText=(await read())[0].flow.document.sections[0].blocks[1].texts.ja;
const translationBefore=(await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'];
const input=mt.locator('[data-flow-block-id=body] .flow-authoring-input');
await input.fill('Manuscript split translation');
assert.equal((await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'],'Manuscript split translation');
assert.equal((await read())[0].flow.document.sections[0].blocks[1].texts.ja,originalText);
await page.locator('#btn-undo').click();
assert.equal((await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'],translationBefore);
const sourceInput=ms.locator('[data-flow-block-id=body] .flow-authoring-input');
await sourceInput.focus();await sourceInput.press('Home');await sourceInput.pressSequentially('原稿比較');
assert.match((await read())[0].flow.document.sections[0].blocks[1].texts.ja,/原稿比較/);
assert.equal((await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'],translationBefore);
await page.locator('#btn-undo').click();
await ms.evaluate(e=>e.scrollTop=0);await mt.evaluate(e=>e.scrollTop=0);await page.waitForTimeout(50);
await ms.hover();await page.mouse.wheel(0,400);await page.waitForFunction(()=>document.querySelector('[data-manuscript-side=target]').scrollTop>0);
await page.locator('#flow-manuscript-sync').click();const independentTop=await mt.evaluate(e=>e.scrollTop);
await ms.hover();await page.mouse.wheel(0,100);await page.waitForTimeout(100);assert.equal(await mt.evaluate(e=>e.scrollTop),independentTop);
await page.screenshot({path:tmpdir()+'/flow-manuscript-split.png'});
await page.locator('#flow-manuscript-normal').click();assert.equal(await mt.isVisible(),false);
console.log('manuscript split edits/Undo, semantic wheel sync, independent scroll and normal mode passed');


assert.equal(await page.locator('#flow-translation-compare').isVisible(),false);
await page.locator('#flow-compare-split').click();await targetPane.locator('.flow-canvas-viewport:not([hidden]) .flow-dom-block').first().waitFor({state:'visible'});

console.log('existing translation settings and split re-entry passed');
await targetPane.locator('.flow-canvas-viewport:not([hidden]) [data-flow-block-id=body]').first().click();
await page.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='en-GB');
await page.locator('.flow-direct-input-proxy').evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''})));
await page.locator('#flow-compare-normal').click();assert.equal(await page.locator('#flow-translation-compare').isVisible(),true);
await page.locator('#flow-compare-language').selectOption('ko');assert.equal(await page.locator('#flow-compare-language').inputValue(),'en-GB');
await page.locator('.flow-direct-input-proxy').evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''})));
console.log('composition prevents mode/language switch');
await page.waitForFunction(async()=>{
 const {state}=await import('/js/state.js'); const {getCachedFlowRuntimePageProjection}=await import('/js/flow-runtime-pages.js');
 const projection=getCachedFlowRuntimePageProjection(state,state.activeLang,state.sections,document,'editor-compare');
 return projection && document.querySelectorAll('#page-strip-thumbs [data-flow-page-index]').length === projection.flowPageCount;
});
console.log('thumbnail page count follows the active comparison language');

after=await read();
await page.screenshot({path:tmpdir()+'/flow-compare-real.png'});

await page.locator('#flow-compare-normal').click();await page.waitForFunction(()=>document.getElementById('flow-translation-compare').hidden);
assert.deepEqual((await read())[0],after[0]);

// Image selection retains comparison and mounts the existing live image editor.
await page.locator('#flow-compare-split').click();await targetPane.locator('.flow-canvas-viewport:not([hidden]) .flow-dom-block').first().waitFor({state:'visible'});
await page.locator('#page-strip-thumbs [data-editor-unit-id=picture]').click();
assert.equal(await page.locator('#flow-translation-compare').isVisible(),true);

await page.locator('#image-ribbon-home').waitFor({state:'visible'});

await page.waitForFunction(()=>document.querySelector('[data-compare-side=target] #canvas-stage'));
await page.locator('#ribbon-image-adjust').click();await page.locator('#ribbon-image-transform button[title="画像を拡大"]').click();
assert.ok(await page.evaluate(async()=>{const {state}=await import('/js/state.js');return state.sections[state.activeIdx].imagePositions['en-GB'].scale>1}));
await page.locator('#btn-undo').click();
await page.locator('#ribbon-image-transform button[title="画像調整を完了"]').click();
// Select the same image in the other language pane.
const leftImage=sourcePane.locator('.flow-canvas-viewport:not([hidden]) [data-testid=editor-fixed-page]').first();
await leftImage.click();
await page.waitForFunction(()=>document.querySelector('[data-compare-side=source] #canvas-stage'));
assert.equal(await page.evaluate(async()=>(await import('/js/state.js')).state.activeLang),'ja');
assert.equal(await page.locator('#flow-translation-compare').isVisible(),true);
console.log('image thumbnail selection, transform/Undo and opposite-pane image selection retain split');
assert.deepEqual(errors,[]);console.log('comparison acceptance passed');


} catch(e){if(page)await page.screenshot({path:tmpdir()+'/flow-compare-failure.png'});throw e}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
