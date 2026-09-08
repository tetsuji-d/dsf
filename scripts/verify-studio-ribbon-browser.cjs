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
 state.projectAssets=[{id:'asset',name:'sample.webp',mimeType:'image/webp',width:120,height:180,byteLength:blob.size,background:url,thumbnail:url}];
 state.sections=(await import('/js/blocks.js')).extractSectionsFromBlocks(state.blocks);state.pages=[];state.version=6;state.activeLang='ja';state.defaultLang='ja';state.languages=['ja','en-GB','en-US','ko'];state.activeBlockIdx=0;state.projectName='リボン統合の操作確認';window.changeFlowSourceBlock(0);window.setStudioUILang('ja');
});
const thumb=()=>page.locator('#page-strip-thumbs [data-flow-page-index="0"]').first();
const read=()=>page.evaluate(async()=>JSON.stringify((await import('/js/state.js')).state.blocks[0]));
const settle=()=>page.waitForFunction(()=>!document.querySelector('.flow-indent-marker.start')?.disabled);
const edit=async()=>{await thumb().click();await page.locator('.flow-dom-block[data-flow-block-id="body"]').filter({visible:true}).first().click();await page.locator('.flow-indent-ruler').waitFor({state:'visible'});await settle()};
await edit();const baseline=await read();
// Ribbon numbers and the one-character shortcut use the same undoable operation.
const first=page.locator('#flow-ribbon-indent [data-indent-field=first]');
await first.fill('1'); await first.press('Tab'); await settle();
assert.equal(await page.locator('[data-indent-preset=first-one]').isChecked(),true);
await page.locator('[data-indent-preset=first-one]').uncheck(); await settle();
assert.equal(await first.inputValue(),'0');
await page.locator('#btn-undo').click(); await settle();
await page.locator('#btn-undo').click(); await settle();
assert.equal(await read(),baseline);

// Select real proxy text with keyboard and open ribbon dialogs with real clicks.
let proxy=page.locator('.flow-direct-input-proxy');await proxy.press('Control+Home');await proxy.press('Shift+ArrowDown');await proxy.press('Shift+ArrowDown');
await page.locator('#flow-ribbon-home [data-flow-annotation-focus="reading"]').click();await page.locator('dialog[open]').waitFor();assert.equal(await page.locator('dialog [data-parent]').textContent(),'第一');assert.equal(await page.locator('dialog input[name=reading]').evaluate(e=>document.activeElement===e),true);
await page.locator('dialog input[name=reading]').fill('あさの');await page.locator('dialog [data-apply]').click();await settle();assert.ok((await read()).includes('あさの'));
await page.locator('#btn-undo').click();await settle();assert.equal(await read(),baseline);
proxy=page.locator('.flow-direct-input-proxy');await proxy.press('Control+Home');await proxy.press('Shift+ArrowDown');await proxy.press('Shift+ArrowDown');
await page.locator('#flow-ribbon-home [data-flow-annotation-focus="mark"]').click();assert.equal(await page.locator('dialog select[name=mark]').evaluate(e=>document.activeElement===e),true);await page.locator('dialog select[name=mark]').selectOption('dot');await page.locator('dialog [data-apply]').click();await settle();assert.ok((await read()).includes('emphasis'));await page.locator('#btn-undo').click();await settle();assert.equal(await read(),baseline);
console.log('Selection, ruby/emphasis and real Undo passed');
// Source navigation reuses the existing same-location behavior.
await page.locator('#flow-ribbon-home [data-ribbon-original="flow-open-source"]').click();await page.locator('.flow-authoring-input').first().waitFor({state:'visible'});await page.locator('#flow-ribbon-home [data-ribbon-original="flow-open-source"]').click();await page.locator('.flow-editor-page-surface').first().waitFor({state:'visible'});assert.equal(await read(),baseline);await edit();
// Actual heading selection through the ribbon, then undo.
await page.locator('#ribbon-flow-direct-block-format').selectOption('heading-2');await page.waitForFunction(async()=> (await import('/js/state.js')).state.blocks[0].flow.document.sections[0].blocks[1].type==='heading');await page.locator('#btn-undo').click();await settle();assert.equal(await read(),baseline);
// A separate source-only fixture exercises title placement (translated text is protected by the existing gate).
await page.evaluate(async()=>{const {state}=await import('/js/state.js');for(const b of state.blocks[0].flow.document.sections[0].blocks)for(const k of Object.keys(b.texts))if(k!=='ja')delete b.texts[k];window.changeFlowGeneratedPage(0,0)});await edit();
// Title-region placement and removal preserve the Flow group.
await page.locator('[data-ribbon-tab=arrange]').click();await page.locator('#ribbon-flow-placement-scope').selectOption('page');await page.locator('[data-ribbon-original=flow-make-title]').click();await page.waitForFunction(()=>!document.querySelector('#flow-restore-body').hidden);assert.equal(await page.evaluate(async()=> (await import('/js/state.js')).state.blocks.filter(b=>b.kind==='flow').length),1);
await page.locator('#btn-undo').click();await edit();
await page.locator('[data-ribbon-tab=home]').click();
// Page break remains a semantic edit and undoable.
proxy=page.locator('.flow-direct-input-proxy');await proxy.press('Control+Home');await proxy.press('ArrowRight');await page.locator('#flow-ribbon-home [data-ribbon-original=flow-direct-page-break]').click();await page.waitForFunction(async()=> (await import('/js/state.js')).state.blocks[0].flow.document.sections[0].blocks.some(b=>b.type==='pageBreak'));await page.locator('#btn-undo').click();await edit();
console.log('Source return, heading, title region and page-break passed');
const beforeDisplay=await read();
for(const key of ['ruler','guides','line','ruled']){const b=page.locator('#flow-ribbon-home [data-ribbon-display='+key+']');const old=await b.getAttribute('aria-pressed');await b.click();assert.notEqual(await b.getAttribute('aria-pressed'),old);await page.locator('[data-ribbon-tab=view]').click();assert.equal(await page.locator('#flow-ribbon-view [data-ribbon-display='+key+']').getAttribute('aria-pressed'),old==='true'?'false':'true');await page.locator('#flow-ribbon-view [data-ribbon-display='+key+']').click();await page.locator('[data-ribbon-tab=home]').click()}
assert.equal(await read(),beforeDisplay);
// Popovers use actual lists and don't shrink canvas. Escape and outside click close.
const mainWidth=await page.locator('#editor-main').evaluate(e=>e.clientWidth);await page.locator('#ribbon-bar [data-drawer=toc]').click();await page.locator('#sidebar .sidebar-toc').waitFor({state:'visible'});assert.equal(await page.locator('#editor-main').evaluate(e=>e.clientWidth),mainWidth);await page.keyboard.press('Escape');assert.equal(await page.locator('#sidebar').isVisible(),false);
await page.locator('#btn-toggle-sidebar').click();await page.locator('.project-asset-card').first().waitFor({state:'visible'});await page.locator('#asset-search').fill('missing');assert.equal(await page.locator('.project-asset-card').count(),0);await page.locator('#asset-search').fill('sample');await page.locator('.project-asset-card').first().click({button:'right'});assert.equal(await page.locator('.project-asset-menu [role=menuitem]').count(),3);await page.keyboard.press('Escape');await page.locator('#btn-toggle-sidebar').click();assert.equal(await page.locator('#sidebar').isVisible(),false);
await page.locator('#ribbon-bar [data-drawer=toc]').click();await page.locator('#sidebar .toc-preview-item').first().click();assert.equal(await page.locator('#sidebar').isVisible(),false);assert.equal(await page.evaluate(async()=> (await import('/js/state.js')).state.blocks[(await import('/js/state.js')).state.activeBlockIdx].id),'picture');await edit();
// Settings, fullscreen and JA/EN preserve document content.
await page.locator('#ribbon-project-settings').click();await page.locator('#project-settings-modal').waitFor({state:'visible'});await page.locator('.ps-close-btn').click();
await page.locator('#ribbon-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.locator('#ribbon-fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement);
const beforeLanguage=await read();await page.locator('.ui-lang-btn[data-lang=en]').filter({visible:true}).first().click();assert.equal(await page.locator('[data-ribbon-tab=view]').textContent(),'View');assert.equal(await page.evaluate(async()=> (await import('/js/state.js')).state.activeLang),'ja');assert.equal(await read(),beforeLanguage);
await page.locator('#lang-tabs-top .lang-tab').filter({hasText:'EN-GB'}).click();
assert.equal(await page.evaluate(async()=> (await import('/js/state.js')).state.activeLang),'en-GB');
assert.equal(await page.locator('html').getAttribute('lang'),'en');
await page.locator('#lang-tabs-top .lang-tab').filter({hasText:'JA'}).click(); await edit();
console.log('Guide state, real asset library, settings, fullscreen and independent UI/content languages passed');
// Flow leaves existing fixed-page editing available; returning restores ribbon.
await page.locator('#page-strip-thumbs [data-editor-unit-id=picture]').click();assert.equal(await page.locator('#panel-right').isVisible(),true);assert.equal(await page.locator('#image-only-props').isVisible(),true);assert.equal(await page.locator('#flow-ribbon-home').isVisible(),false);await edit();
assert.equal(await page.evaluate(async()=> (await import('/js/state.js')).state.blocks.find(b=>b.id==='fixed').content.texts.ja),'固定本文を保持');
// Dimensions, themes, language and tooltip exposure. Every input must remain in the visible ribbon.
for(const theme of ['dark','light']){await page.evaluate(theme=>document.body.dataset.theme=theme,theme);for(const width of [1440,1280,1024]){await page.setViewportSize({width,height:800});for(const tab of ['home','arrange','insert','view','export']){await page.locator('[data-ribbon-tab='+tab+']').click();const layout=await page.locator('.ribbon-panel-row').evaluate(e=>{const r=e.getBoundingClientRect();return {width:e.clientWidth,scroll:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,escaped:[...e.querySelectorAll('input,button,select')].filter(n=>n.getClientRects().length&&!n.hidden&&getComputedStyle(n).visibility!=='hidden').filter(n=>{const b=n.getBoundingClientRect();return b.top<r.top-1||b.bottom>r.bottom+1}).map(n=>n.id||n.getAttribute('aria-label'))}});assert.equal(layout.escaped.length,0,JSON.stringify({theme,width,tab,layout}));assert.ok(layout.scrollHeight<=layout.height+1,JSON.stringify({theme,width,tab,layout}));if(width>=1280)assert.ok(layout.scroll<=layout.width+1,JSON.stringify({theme,width,tab,layout}));}}}
await page.setViewportSize({width:1440,height:900});await page.locator('[data-ribbon-tab=home]').click();await page.evaluate(()=>window.setStudioUILang('ja'));await edit();const icon=page.locator('#flow-ribbon-home [data-flow-annotation-focus=reading]');await icon.hover();await page.locator('#studio-ribbon-tooltip').waitFor({state:'visible'});assert.match(await page.locator('#studio-ribbon-tooltip').textContent(),/ルビ/);await page.mouse.move(1200,820);await icon.focus();assert.equal(await page.locator('#studio-ribbon-tooltip').isVisible(),true);await page.mouse.move(1200,820);await page.keyboard.press('Escape');await page.evaluate(()=>document.body.dataset.theme='dark');await page.waitForFunction(()=>getComputedStyle(document.getElementById('ribbon-project-settings')).backgroundColor==='rgb(17, 24, 39)');await page.screenshot({path:tmpdir()+'/flow-ribbon-integrated.png'});
await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('#flow-indent-controls')?.parentElement.id==='flow-direct-format-props');assert.equal(await page.locator('#ribbon-bar').isVisible(),false);await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('#flow-indent-controls')?.parentElement.id==='flow-ribbon-indent');assert.deepEqual(errors,[]);
console.log('Fixed page, theme/size layout, tooltips and mobile controls passed');
} catch(e){if(page)await page.screenshot({path:tmpdir()+'/flow-ribbon-failure.png'});throw e}finally{await browser.close()}})().catch(e=>{if(typeof e.actual==='string'&&typeof e.expected==='string'){let i=0;while(e.actual[i]===e.expected[i]&&i<e.actual.length)i++;console.error('Difference:',i,e.actual.slice(Math.max(0,i-80),i+180),e.expected.slice(Math.max(0,i-80),i+180))}console.error(e.name,typeof e.actual==='undefined'?e.message:String(e.actual===e.expected));console.error(e.stack?.split('\n').filter(l=>l.includes(' at ')||l.includes('Call log')).join('\n')||e.message);process.exit(1)});
