const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5198';
  const proof=async()=> (await page.request.get(base+'/fixture/proof')).json();
  const before=await proof();
  await page.goto(base+'/workspace');await page.locator('#home-space-launcher [data-space-trigger]').click();await page.locator('[data-space-choice="all"]:visible').click();await page.locator('[data-fixture-work]').first().waitFor();
  const nav=view=>page.locator('.home-management-sidebar [data-home-nav="'+view+'"]');
  const choose=async view=>{await nav(view).click();assert.equal(await page.locator('#home-room').getAttribute('data-home-view'),view);assert(await page.locator('[data-home-title]').evaluate(e=>e===document.activeElement),await page.evaluate(()=>document.activeElement.outerHTML));};
  assert.equal(await page.locator('#home-cloud-grid .home-project-entry:visible').count(),3);
  assert.equal(await page.locator('#home-publishing-spaces').isVisible(),false);
  await page.locator('[data-fixture-work="book_1"]').click();assert.match(await page.locator('#fixture-workspace-action').innerText(),/book_1/);
  await page.locator('.home-room-actions [data-home-label="create"]').click();assert.match(await page.locator('#fixture-workspace-action').innerText(),/作品の作成/);
  const chooser=page.waitForEvent('filechooser');await page.locator('.home-room-actions [data-home-label="import"]').click();await chooser;
  await page.locator('[data-home-label="all"]').click();assert.equal(await page.locator('#home-cloud-grid .home-project-entry:visible').count(),4);
  await choose('settings');await page.locator('[data-space-settings="profile"]').click();assert(await page.locator('#home-publishing-spaces').isVisible());assert.equal(await page.locator('#home-cloud-grid').isVisible(),false);
  await choose('activity');assert(await page.locator('#home-work-grid').isVisible());await page.locator('#home-work-grid [data-home-nav="projects"]').click();
  await choose('local');assert(await page.locator('.home-browser-copies').evaluate(e=>e.open));assert.equal(await page.locator('#home-cloud-grid').isVisible(),false);
  await choose('overview');await page.locator('#fixture-language').click();assert.equal(await page.locator('[data-home-title]').innerText(),'Dashboard');assert.equal(await nav('settings').locator('[data-home-label]').innerText(),'Space settings');
  await page.locator('#fixture-empty').click();assert(await page.getByRole('button',{name:'Create your first work',exact:true}).isVisible());await page.locator('#fixture-empty').click();
  await page.locator('#fixture-language').click();await page.screenshot({path:'outputs/home-workspace-fixture-desktop.png'});
  for(const width of [390,760,820]){
   await page.setViewportSize({width,height:844});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not overflow horizontally');
   const rects=await page.locator('#home-cloud-grid .home-project-card').first().evaluate(e=>{const a=e.querySelector('.home-project-thumb').getBoundingClientRect(),b=e.querySelector('.home-project-info').getBoundingClientRect();return {thumbRight:a.right,textLeft:b.left};});
   assert(rects.thumbRight<=rects.textLeft,'thumbnail must not overlap the work title');
   if(width===390)await page.screenshot({path:'outputs/home-workspace-fixture-mobile.png'});
  }
  await page.locator('#fixture-account').click();await page.waitForFunction(()=>document.querySelector('#home-space-identity').textContent.includes('個人の作業スペース'));
  assert.equal(await page.locator('[data-fixture-work]').count(),0);
  assert.deepEqual(await proof(),before,'navigation must not change project/space data');assert.deepEqual(errors,[]);
  // The following mutations create only memory-fixture sample data.
  const headers={Authorization:'Bearer fixture-owner'},spaceId='space_home-workspace-0001';
  let catalogue=await (await page.request.get(base+'/api/publishing-spaces',{headers})).json();
  if(!catalogue.spaces.some(s=>s.id===spaceId)){
   const result=await page.request.post(base+'/api/publishing-spaces',{headers,data:{kind:'create',spaceId,name:'灯台出版',baseRevision:catalogue.revision}});assert(result.ok());catalogue=await result.json();
  }
  for(const projectId of ['book_1','book_2']){
   const result=await page.request.post(base+'/api/publishing-spaces',{headers,data:{kind:'assign',projectId,spaceId,baseRevision:catalogue.revision,expectedSpaceId:catalogue.assignments[projectId]||null}});assert(result.ok(),await result.text());catalogue=await result.json();
  }
  const assigned=await proof();await page.reload();await page.locator('#home-space-launcher [data-space-trigger]').click();await page.locator('[data-space-choice="'+spaceId+'"]:visible').click();
  assert.match(await page.locator('#home-space-identity').innerText(),/灯台出版/);assert.equal(await page.locator('#home-cloud-grid .home-project-entry:visible').count(),2);
  await choose('settings');await page.locator('[data-space-settings="profile"]').click();assert(await page.getByRole('button',{name:'基本情報を設定',exact:true}).isVisible());
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();await page.locator('textarea[name="description"]').waitFor();await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await choose('overview');assert.equal(await page.locator('[data-space-preview]').isVisible(),false);
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'outputs/home-workspace-space-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/home-workspace-space-mobile.png'});
  assert.deepEqual(await proof(),assigned,'space navigation and canceled settings do not write data');assert.deepEqual(errors,[]);
  console.log('Home workspace: recent/all works, navigation, creation/import/edit entry points, locale, empty/account states, mobile geometry and read-only navigation passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
