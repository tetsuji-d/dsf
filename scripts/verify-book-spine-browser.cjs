const {chromium} = require(process.env.DSF_PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.DSF_VIEWER_TEST_ORIGIN || 'http://127.0.0.1:5260';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{if(d.type()==='prompt'&&d.message().includes('ファイル名')){await d.accept('spine-test.dsp');return;}errors.push(d.message());await d.dismiss();});
 await page.goto(base+'/studio?room=editor&id=book_library&actor=owner');
 await page.waitForFunction(()=>window.fixtureStudio?.state.projectId==='book_library'&&window.fixtureStudio?.persistence.getLoadedPrivateAuthoringHead()?.revision>0);
 const snapshot = () => page.evaluate(async()=>{
   async function normalize(v) {
    if(typeof v==='string'&&v.startsWith('blob:'))return Array.from(new Uint8Array(await (await fetch(v)).arrayBuffer()));
    if(Array.isArray(v))return Promise.all(v.map(normalize));
    if(v&&typeof v==='object')return Object.fromEntries(await Promise.all(Object.entries(v).map(async([k,x])=>[k,await normalize(x)])));
    return v;
   } return normalize(window.fixtureStudio.state.blocks);
 });
 const body=await snapshot();
 const settings=page.locator('button[onclick="openProjectSettings()"]');
 await settings.click();
 await page.locator('#ps-spine-title').fill('背表紙テスト');
 await page.locator('#ps-spine-author').fill('山口哲史');
 await page.locator('#ps-spine-publisherName').fill('山口出版');
 const icon = await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffcc00';ctx.fillRect(0,0,32,32);return canvas.toDataURL('image/png').split(',')[1];});
 await page.locator('#ps-spine-publisherIcon').setInputFiles({name:'publisher.png',mimeType:'image/png',buffer:Buffer.from(icon,'base64')});
 await page.waitForFunction(()=>!!document.querySelector('.ps-spine-preview .book-spine-publisher-icon img')?.naturalWidth);

 await page.locator('#ps-spine-backgroundColor').fill('#224466');
 await page.locator('#ps-spine-textColor').fill('#fffefe');
 await page.locator('#ps-spine-fontSize').fill('18');
 assert.equal(await page.locator('.ps-spine-preview .book-spine-title').textContent(),'背表紙テスト');
 await page.screenshot({path:'outputs/book-spine-editor.png'});
 await page.locator('#project-settings-modal .btn-primary').click();
 await page.locator('#project-settings-modal').waitFor({state:'hidden'});
 const design=await page.evaluate(()=>window.fixtureStudio.state.book.spineDesign);
 assert.equal(design.title,'背表紙テスト');
 assert.equal(design.publisherName,'山口出版');assert.ok(design.publisherIcon.startsWith('data:image/webp;base64,'));
 await page.reload();
 await page.waitForFunction(()=>window.fixtureStudio?.state.book?.spineDesign?.title==='背表紙テスト');
 assert.deepEqual(await snapshot(),body,'spine settings must not change manuscript or image bytes');
 await settings.click();await page.locator('#ps-spine-title').fill('キャンセル');
 await page.locator('#project-settings-modal .ps-footer .btn').first().click();
 assert.equal(await page.evaluate(()=>window.fixtureStudio.state.book.spineDesign.title),'背表紙テスト');
 console.log('Editor settings: preview, save, cloud reload, cancel and manuscript preservation passed');
 const downloadPromise=page.waitForEvent('download');
 await page.evaluate(async()=>{await (await import('/js/export.js')).buildDSP();});
 const download=await downloadPromise;
 const zip=await require('jszip').loadAsync(fs.readFileSync(await download.path()));
 assert.deepEqual(JSON.parse(await zip.file('project.json').async('text')).book.spineDesign,design);
 console.log('DSP archive retains spine design');

 const popupPromise=page.waitForEvent('popup');await page.locator('#btn-editor-preview').click();const preview=await popupPromise;
 preview.on('pageerror',e=>errors.push(e.message));
 await preview.waitForFunction(()=>Number(document.querySelector('#page-slider')?.max)>1,null,{timeout:120000});
 await preview.locator('#viewer-nav-right').click();
 await preview.waitForFunction(()=>document.querySelector('.viewer-cover-turn')?.dataset.progress==='0.500');
 assert.equal(await preview.locator('.vct-spine .book-spine-title').textContent(),'背表紙テスト');
 assert.equal(await preview.locator('.vct-spine .book-spine-author').textContent(),'山口哲史');
 assert.equal(await preview.locator('.viewer-cover-status').isVisible(),false);
 assert.equal(await preview.locator('.vct-spine').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 102)');
 assert.equal(await preview.locator('.book-spine-publisherName').textContent(),'山口出版');
 assert.ok(await preview.locator('.book-spine-publisher-icon img').evaluate(img=>img.complete&&img.naturalWidth>0));
 const layout=await preview.locator('.vct-spine').evaluate(el=>{
   const box=selector=>{const node=el.querySelector(selector);return {top:node.offsetTop,height:node.offsetHeight,font:parseFloat(getComputedStyle(node).fontSize)};};
   const title=box('.book-spine-title'),author=box('.book-spine-author'),publisher=box('.book-spine-publisherName'),icon=box('.book-spine-publisher-icon');
   return {title,author,publisher,icon,height:el.clientHeight};
 });
 assert.ok(layout.title.top < layout.author.top && layout.author.top < layout.publisher.top && layout.publisher.top < layout.icon.top,JSON.stringify(layout));
 assert.ok(layout.title.font > layout.author.font && layout.author.font > layout.publisher.font);
 assert.ok(layout.title.top < layout.height*.05 && layout.icon.top+layout.icon.height > layout.height*.94,JSON.stringify(layout));
 await preview.screenshot({path:'outputs/book-spine-viewer.png'});
 console.log('Actual editor → portable DSF → Viewer custom spine, colors and no hint passed');
 const fixture=JSON.parse(fs.readFileSync('scripts/fixtures/viewer-cover-loop-book.json','utf8'));
 async function load(raw){await page.goto(base+'/viewer');await page.waitForFunction(()=>typeof window.loadDsf==='function');await page.locator('#file-input').setInputFiles({name:'book.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await page.waitForFunction(()=>Number(document.querySelector('#page-slider')?.max)>1);}
 await preview.close();await page.bringToFront();await load(fixture);await page.waitForTimeout(300);
 const btn=page.locator('#viewer-spread-btn');
 assert.equal(await btn.getAttribute('data-mode'),'auto');assert.equal(await btn.evaluate(el=>el.classList.contains('active')),true);
 await page.locator('#viewer-nav-left').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#viewer-spread-stage')).display!=='none');
 assert.equal(await page.locator('#viewer-spread-stage').isVisible(),true);

 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 assert.equal(await btn.evaluate(el=>el.classList.contains('active')),false);assert.equal(await page.locator('#viewer-spread-stage').isVisible(),false);
 await page.evaluate(()=>window.jumpToPage(5));await page.waitForTimeout(300);
 await page.setViewportSize({width:844,height:390});await page.waitForTimeout(700);assert.equal(await btn.evaluate(el=>el.classList.contains('active')),true);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.equal(await page.locator('#page-slider').inputValue(),'5','rotation preserves the selected page');
 await page.evaluate(()=>window.toggleUi(true));await btn.click();assert.equal(await btn.getAttribute('data-mode'),'single');
 await page.setViewportSize({width:1600,height:900});await page.waitForTimeout(300);assert.equal(await btn.evaluate(el=>el.classList.contains('active')),false);
 await btn.click();assert.equal(await btn.getAttribute('data-mode'),'spread');await btn.click();assert.equal(await btn.getAttribute('data-mode'),'auto');
 const legacy=structuredClone(fixture);delete legacy.book;delete legacy.bookMode;
 await load(legacy);assert.equal(await btn.evaluate(el=>el.classList.contains('active')),true);
 await page.setViewportSize({width:700,height:1000});await page.waitForTimeout(300);assert.equal(await btn.evaluate(el=>el.classList.contains('active')),false);
 console.log('Automatic book + legacy layout, portrait/landscape rotation and manual override/auto return passed');
 await page.setViewportSize({width:1280,height:900});
 let publisherName='参照元出版社', failPublisher=false;
 const assigned='space_1111111111111111', other='space_2222222222222222';
 await page.route('**/api/publishing-spaces',route=>{
   if(failPublisher)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"SPACES_UNAVAILABLE"}'});
   const command=route.request().postDataJSON();
   return route.fulfill({contentType:'application/json',body:JSON.stringify(command?.kind==='readImage'
     ? {schemaVersion:1,uid:'owner_1',dataUrl:design.publisherIcon}
     : {schemaVersion:1,uid:'owner_1',revision:1,spaces:[{id:other,name:'無関係の出版社',ownerUid:'owner_1',role:'owner'},
        {id:assigned,name:publisherName,ownerUid:'owner_1',role:'owner',profile:{description:'',website:'',icon:'a'.repeat(64),banner:null}}],assignments:{book_library:assigned}})});
 });
 await page.goto(base+'/studio?room=editor&id=book_library&actor=owner');
 await page.waitForFunction(()=>window.fixtureStudio?.state.projectId==='book_library'&&window.fixtureStudio?.persistence.getLoadedPrivateAuthoringHead()?.revision>0);
 await settings.click();
 await page.locator('#ps-spine-title').fill(''); await page.locator('#ps-spine-author').fill('');
 await page.locator('.ps-meta-input[data-lang="ja"][data-key="title"]').fill('基本情報の題名');
 await page.locator('.ps-meta-input[data-lang="ja"][data-key="author"]').fill('基本情報の著者');
 assert.equal(await page.locator('.ps-spine-preview .book-spine-title').textContent(),'基本情報の題名');
 assert.equal(await page.locator('.ps-spine-preview .book-spine-author').textContent(),'基本情報の著者');
 await page.locator('#ps-spine-publisher-source').check();
 await page.waitForFunction(()=>document.querySelector('#ps-spine-publisherName')?.value==='参照元出版社');
 assert.equal(await page.locator('#ps-spine-publisherName').isDisabled(),true);
 assert.equal(await page.locator('.ps-spine-preview .book-spine-publisher-icon img').getAttribute('src'),design.publisherIcon);
 await page.locator('#project-settings-modal .btn-primary').click();
 await page.locator('#project-settings-modal').waitFor({state:'hidden'});
 await page.reload(); await page.waitForFunction(()=>window.fixtureStudio?.state.book?.spineDesign?.publisherSource==='space');
 publisherName='変更後の出版社';await settings.click();
 await page.waitForFunction(()=>document.querySelector('#ps-spine-publisherName')?.value==='変更後の出版社');
 await page.locator('#project-settings-modal .ps-footer .btn').first().click();
 assert.equal(await page.evaluate(()=>window.fixtureStudio.state.book.spineDesign.publisherName),'参照元出版社','cancel must not persist refreshed defaults');
 failPublisher=true;await settings.click();
 await page.waitForFunction(()=>document.querySelector('.ps-spine-editor [role=status]')?.textContent.includes('取得できません'),null,{timeout:30000});
 assert.equal(await page.locator('#project-settings-modal .btn-primary').isDisabled(),true);
 await page.locator('#ps-spine-publisher-source').uncheck();
 assert.equal(await page.locator('#project-settings-modal .btn-primary').isEnabled(),true);
 assert.equal(await page.locator('#ps-spine-publisherName').isEnabled(),true);
 await page.locator('#project-settings-modal .ps-footer .btn').first().click();
 console.log('Live title/author reference, assigned-space icon/name, save/reload, profile refresh, cancel and failure/custom fallback passed');
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
