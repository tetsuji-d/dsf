const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 for(const surface of ['portal','viewer']){
  const p=await b.newPage({viewport:{width:1440,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const url='http://127.0.0.1:5178/'+(surface==='portal'?'':'viewer.html');
  await p.goto(url);
  const trigger=surface==='portal'?'#btn-avatar':'.viewer-auth-trigger';
  const menu=surface==='portal'?'#auth-dropdown':'.viewer-auth-dropdown';
  const root=surface==='portal'?'#auth-dropdown':'.viewer-auth';
  const attr=surface==='portal'?'data-lang':'data-ui-lang';
  await p.locator(trigger).waitFor();
  assert.equal(await p.locator(surface==='portal'?'#lang-switcher-brand':'.viewer-toolbar > .viewer-ui-lang-switcher').count(),0);
  await p.locator(trigger).click();await p.locator(`${menu} [${attr}=en]`).click();
  assert.equal(await p.locator('html').getAttribute('lang'),'en');
  assert.equal(await p.locator(`${menu} [${attr}=en]`).getAttribute('aria-pressed'),'true');
  assert.ok(await p.locator(root).evaluate(e=>e.classList.contains('open')));
  await p.keyboard.press('Escape');assert.ok(!(await p.locator(root).evaluate(e=>e.classList.contains('open'))));
  assert.ok(await p.locator(trigger).evaluate(e=>e===document.activeElement));
  await p.reload();await p.locator(trigger).waitFor();assert.equal(await p.locator('html').getAttribute('lang'),'en');
  await p.setViewportSize({width:390,height:844});await p.locator(trigger).click();
  await p.locator(`${menu} [${attr}=ja]`).click();assert.equal(await p.locator('html').getAttribute('lang'),'ja');
  const rect=await p.locator(menu).boundingBox();assert.ok(rect.x>=0 && rect.x+rect.width<=391 && rect.y+rect.height<=844,JSON.stringify({surface,rect}));
  await p.screenshot({path:require('node:os').tmpdir()+`/${surface}-profile-language.png`});
  assert.deepEqual(errors,[]);console.log(`${surface}: signed-out language switch, open/focus retention, Escape, reload, mobile bounds passed`);await p.close();
 }
 // Real horizontal Flow -> fixed-text Viewer preview, then tap and compare geometry/paint.
 const p=await b.newPage({viewport:{width:1500,height:950}});await p.goto('http://127.0.0.1:5178/studio?room=editor');
 await p.waitForFunction(()=>window.changeFlowGeneratedPage&&!document.body.hasAttribute('data-booting'));
 await p.evaluate(async()=>{
  const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js');
  const g=createFlowGroupBlock({id:'horizontal-guide',sourceLanguage:'en-GB',writingMode:'horizontal-tb',document:{sourceLanguage:'en-GB',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{'en-GB':'A quiet morning beside the sea. The light returns to the harbour. '.repeat(15)}}]}]}});
  Object.assign(state,{blocks:[g],version:6,sections:[],pages:[],projectAssets:[],projectId:null,localProjectId:'horizontal-guide-test',activeLang:'en-GB',defaultLang:'en-GB',languages:['en-GB'],languageConfigs:{'en-GB':{pageDirection:'ltr'}},activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,bookMode:'none',book:{mode:'none'}});window.changeFlowGeneratedPage(0,0);
 });
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();
 const pending=p.waitForEvent('popup');await p.locator('#btn-editor-preview').click();const v=await pending;
 await v.locator('#viewer-stage [data-reading-line=horizontal]').first().waitFor();
 const lines=v.locator('#viewer-stage [data-reading-line=horizontal]'),line=lines.nth(2),other=lines.nth(3);
 const before=await line.boundingBox();const color=await line.evaluate(e=>getComputedStyle(e).color);
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-enabled').check();
 await v.mouse.click(before.x+before.width/2,before.y+before.height/2);
 assert.ok(await line.evaluate(e=>e.classList.contains('reading-line-active')));
 assert.deepEqual(await line.boundingBox(),before);
 assert.equal(await line.evaluate(e=>getComputedStyle(e).color),color);
 assert.equal(await line.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await other.evaluate(e=>getComputedStyle(e).boxShadow),'none');
 const guide=v.locator('.reader-line-overlay line[data-active=true]').first();
 assert.ok(await guide.evaluate(g=>{const a=g.closest('.viewer-fixed-text-page').querySelector('.reading-line-active');const r=document.createRange();r.selectNodeContents(a.firstChild);return g.getBoundingClientRect().top>r.getBoundingClientRect().bottom;}));
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-mode').selectOption('all');
 assert.ok(await v.locator('.reader-line-overlay line[data-active=false]').count()>0);
 await v.locator('#reading-guide-mode').selectOption('active');
 await v.screenshot({path:require('node:os').tmpdir()+'/viewer-horizontal-reading-marker.png'});
 await v.reload();await v.locator('#reading-guide-enabled').waitFor({state:'attached'});
 assert.equal(await v.locator('#reading-guide-mode').inputValue(),'active');assert.equal(await v.locator('#reading-guide-enabled').isChecked(),true);
 console.log('Horizontal: text tap marks only selected line, no tint/layout change, all-lines option and preferences survive reload');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
