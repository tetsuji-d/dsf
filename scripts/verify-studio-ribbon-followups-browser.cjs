// Isolated local-browser acceptance. Does not access the user's browser profile.
// Set DSF_PLAYWRIGHT_MODULE if Playwright is supplied outside this checkout.
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
const {tmpdir}=require('node:os');
const baseURL=process.env.DSF_TEST_BASE_URL || 'http://127.0.0.1:5178';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(baseURL).hostname)) throw new Error('This fixture runs only against a local development server.');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let page;try{
page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.log(e.stack)});
await page.goto(baseURL+'/studio?room=editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.changeFlowGeneratedPage==='function'&&!document.body.hasAttribute('data-booting'));
await page.evaluate(async()=>{
 const {state}=await import('/js/state.js'); const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
 const {ensureFlowLanguageTypography}=await import('/js/flow-multilingual-authoring.js');const {extractSectionsFromBlocks}=await import('/js/blocks.js');
 const canvas=document.createElement('canvas');canvas.width=120;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#537c96';ctx.fillRect(0,0,120,180);const blob=await new Promise(r=>canvas.toBlob(r,'image/webp'));const url=URL.createObjectURL(blob);
 state.blocks=[createFlowGroupBlock({id:'ribbon',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',title:{ja:'第一章'},blocks:[{id:'heading',type:'heading',level:1,texts:{ja:'第一章　朝の光','en-GB':'Morning Light',ko:'아침 햇살'}},{id:'body',type:'paragraph',texts:{ja:'朝の光が、窓辺に置いた一冊の本を照らしていた。'.repeat(110),'en-GB':'The morning light fell on a book by the window. '.repeat(30),ko:'아침 햇살이 책을 비추었습니다.'.repeat(30)}}]}]}}),{id:'picture',kind:'page',content:{pageKind:'image',background:url,bubbles:[],headings:{ja:'画像の章'}}},{id:'fixed',kind:'page',content:{pageKind:'text',texts:{ja:'固定本文を保持'},bubbles:[]}}];
 for(const languageKey of ['en-GB','en-US','ko']) state.blocks=ensureFlowLanguageTypography(state.blocks,{groupId:'ribbon',languageKey,writingMode:'horizontal-tb'}).blocks;
 state.projectAssets=[{id:'asset',name:'sample.webp',mimeType:'image/webp',width:120,height:180,byteLength:blob.size,background:url,thumbnail:url}];
 state.sections=extractSectionsFromBlocks(state.blocks);state.pages=[];state.version=6;state.activeLang='ja';state.defaultLang='ja';state.languages=['ja','en-GB','en-US','ko'];state.activeBlockIdx=0;state.projectName='リボン統合の操作確認';state.localProjectId='local_ribbon_test';window.changeFlowSourceBlock(0);window.setStudioUILang('ja');
});

const settle=()=>page.waitForFunction(()=>!!document.querySelector('.flow-direct-input-proxy') && document.querySelector('.flow-direct-input-proxy').dataset.flowReflowPending!=='true');
const read=()=>page.evaluate(async()=>JSON.parse(JSON.stringify((await import('/js/state.js')).state.blocks)));
const source=await read();
await page.locator('#lang-tabs-top .lang-tab').filter({hasText:'EN-GB'}).click();
await page.locator('#page-strip-thumbs [data-flow-page-index="0"]').first().click();
await page.locator('.flow-dom-block[data-flow-block-id=body]').filter({visible:true}).first().click();await settle();
assert.equal(await page.locator('.flow-direct-input-proxy').getAttribute('lang'),'en-GB');
const baseline=await read();
let proxy=page.locator('.flow-direct-input-proxy');await proxy.press('Home');await proxy.press('Shift+ArrowRight');await proxy.press('Delete');await settle();
let changed=await read();assert.notEqual(changed[0].flow.document.sections[0].blocks[1].texts['en-GB'],baseline[0].flow.document.sections[0].blocks[1].texts['en-GB']);
assert.equal(changed[0].flow.document.sections[0].blocks[1].texts.ja,baseline[0].flow.document.sections[0].blocks[1].texts.ja);
assert.equal(changed[0].flow.document.sections[0].blocks[1].texts.ko,baseline[0].flow.document.sections[0].blocks[1].texts.ko);
await page.locator('#btn-undo').click();await settle();assert.deepEqual(await read(),baseline);
await page.locator('#btn-redo').click();await settle();assert.deepEqual(await read(),changed);await page.locator('#btn-undo').click();await settle();
proxy=page.locator('.flow-direct-input-proxy');await proxy.press('Enter');await settle();assert.ok((await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'].includes('\n'));await page.locator('#btn-undo').click();await settle();assert.deepEqual(await read(),baseline);
await page.locator('.flow-direct-input-proxy').pressSequentially('Edited ');await settle();assert.match((await read())[0].flow.document.sections[0].blocks[1].texts['en-GB'],/Edited /);await page.locator('#btn-undo').click();await settle();
assert.equal(await page.locator('#ribbon-flow-direct-block-format').isDisabled(),true);assert.equal(await page.locator('#flow-ribbon-home [data-ribbon-original=flow-direct-page-break]').isDisabled(),true);
console.log('Translated canvas selection/Delete, input, Enter, Undo/Redo and source preservation passed');
// Missing translations are editable placeholders in the editor, without seeding saved text.
await page.locator('#lang-tabs-top .lang-tab').filter({hasText:'EN-US'}).click();await page.locator('#page-strip-thumbs [data-flow-page-index="0"]').first().click();await page.locator('.flow-dom-block').filter({visible:true}).first().click();assert.equal(await page.locator('.flow-direct-input-proxy').getAttribute('lang'),'en-US');assert.deepEqual((await read())[0].flow.document.sections[0].blocks.map(b=>b.texts['en-US']),[undefined,undefined]);
console.log('Missing translation placeholder focus does not seed target or edit source');
await page.locator('#lang-tabs-top .lang-tab').filter({hasText:'JA'}).click();await page.locator('#page-strip-thumbs [data-editor-unit-id=picture]').click();await page.locator('#image-ribbon-home').waitFor({state:'visible'});assert.equal(await page.locator('#panel-right').isVisible(),false);
const imagePos=()=>page.evaluate(async()=>{const s=(await import('/js/state.js')).state;return {...s.sections[s.activeIdx].imagePositions.ja}});
await page.locator('#ribbon-image-adjust').click();await page.locator('#ribbon-image-transform').waitFor({state:'visible'});const pos=await imagePos();
await page.locator('#ribbon-image-transform button[title="画像を拡大"]').click();await page.waitForFunction(async()=>{const s=(await import('/js/state.js')).state;return s.sections[s.activeIdx].imagePositions.ja.scale>1});assert.ok((await imagePos()).scale>pos.scale);
await page.locator('#btn-undo').click();assert.equal((await imagePos()).scale,pos.scale);
await page.locator('#ribbon-image-transform button[title="画像を左右反転"]').click();assert.equal((await imagePos()).flipX,!pos.flipX);await page.locator('#btn-undo').click();assert.equal((await imagePos()).flipX,pos.flipX);
const rotation=page.locator('#ribbon-image-rotation');await rotation.fill('30');await rotation.press('Tab');assert.equal((await imagePos()).rotation,30);await page.locator('#btn-undo').click();assert.equal((await imagePos()).rotation,pos.rotation);
await page.locator('#ribbon-image-transform button[title="画像調整を完了"]').click();assert.equal(await page.locator('#ribbon-image-transform').isVisible(),false);
// File chooser uses the existing image input, with no upload to cloud.
const chooserPromise=page.waitForEvent('filechooser');await page.locator('#image-ribbon-home button[title="画像変更"]').click();const chooser=await chooserPromise;assert.ok(chooser);
// Fixed text keeps all existing detailed controls.
await page.locator('#page-strip-thumbs [data-editor-unit-id=fixed]').click();assert.equal(await page.locator('#panel-right').isVisible(),true);assert.equal(await page.locator('#image-ribbon-home').isVisible(),false);
// Tail addition uses the real menu, appends a new source group and supports Undo.
const beforeTail=await read();await page.locator('[onclick="showTailPageAddMenu(event)"]').click();await page.locator('.context-menu-item').filter({hasText:'Flow原稿を追加'}).click();await page.locator('#source-language-dialog [value=create]').click();await page.locator('.flow-authoring-input').first().waitFor({state:'visible'});const afterTail=await read();assert.equal(afterTail.length,beforeTail.length+1);assert.equal(afterTail.at(-1).kind,'flow');assert.deepEqual(afterTail.slice(0,-1),beforeTail);await page.locator('#btn-undo').click();assert.deepEqual(await read(),beforeTail);
console.log('Image ribbon controls/Undo, image chooser, Fixed panel and real tail menu/Undo passed');
await page.locator('#page-strip-thumbs [data-editor-unit-id=picture]').click();await page.locator('#ribbon-image-adjust').click();
for(const width of [1440,1280,1024]){await page.setViewportSize({width,height:800});const rect=await page.locator('#image-ribbon-home > .flow-ribbon-group').first().boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);}
await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>document.body.dataset.theme='dark');await page.waitForFunction(()=>getComputedStyle(document.getElementById('ribbon-project-settings')).backgroundColor==='rgb(17, 24, 39)');await page.screenshot({path:tmpdir()+'/image-ribbon-integrated.png'});
await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#ribbon-bar').isVisible(),false);assert.equal(await page.locator('#image-zoom-controls-floating').evaluate(e=>e.parentElement.id),'canvas-view');
assert.deepEqual(errors,[]);console.log('Image ribbon widths, mobile fallback and no browser errors passed');
} catch(e){if(page)await page.screenshot({path:tmpdir()+'/studio-three-followups-failure.png'});throw e}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
