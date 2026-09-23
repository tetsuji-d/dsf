const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5196';
  const headers={Authorization:'Bearer fixture-owner'};
  const read=async()=> (await page.request.get(base+'/api/publishing-spaces',{headers})).json();
  let catalogue=await read();
  // Seed only isolated fixture data; do not touch live cloud accounts.
  for(let i=0;i<2;i++){
   const id='space_switcher-test-000'+i;
   if(!catalogue.spaces.some(s=>s.id===id)){
    const response=await page.request.post(base+'/api/publishing-spaces',{headers,data:{kind:'create',spaceId:id,name:i?'海辺の写真室':'灯台出版',baseRevision:catalogue.revision}});
    assert(response.ok());catalogue=await response.json();
   }
  }
  const id='space_switcher-test-0000';
  await page.goto(base);await page.locator('[data-space-settings]').waitFor();
  assert.equal(await page.locator('[data-space-select]').count(),0,'inline switcher is removed');
  const trigger=page.locator('[data-space-trigger]'),popup=page.locator('.space-switcher-popup');
  const proof=async()=> (await page.request.get(base+'/fixture/proof')).json();
  const before=await proof();
  const choose=async value=>{await trigger.click();await popup.locator('[data-space-choice="'+value+'"]').click();};
  await choose(id);assert((await trigger.getAttribute('title')).endsWith('灯台出版'));
  assert.equal(await popup.isVisible(),false);assert(await trigger.evaluate(e=>e===document.activeElement));
  await choose('all');assert.equal(await page.locator('[data-project-id]').count(),2);
  await choose('unassigned');assert.equal(await page.locator('[data-project-id]').count(),2-Object.keys(catalogue.assignments).filter(id=>['book_1','book_2'].includes(id)).length);
  await choose(id);await page.reload();await page.locator('[data-space-settings]').waitFor();assert((await trigger.getAttribute('title')).endsWith('灯台出版'));
  await trigger.click();await page.waitForFunction(()=>document.querySelector('.space-switcher-popup')?.contains(document.activeElement));await page.keyboard.press('End');assert(await popup.locator('[data-switcher-create]').evaluate(e=>e===document.activeElement));
  await page.keyboard.press('Escape');assert.equal(await popup.isVisible(),false);assert(await trigger.evaluate(e=>e===document.activeElement));
  await trigger.click();await page.locator('h1').click();assert.equal(await popup.isVisible(),false,'outside click dismisses');
  await trigger.click();await popup.locator('[data-switcher-create]').click();await page.locator('.space-opening-dialog').waitFor();
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();assert(await trigger.evaluate(e=>e===document.activeElement));
  await page.locator('#account').click();await page.locator('[data-space-settings]').waitFor();await trigger.click();assert.equal(await popup.locator('[data-space-choice="'+id+'"]').count(),0);await page.keyboard.press('Escape');
  await page.locator('#account').click();await page.waitForFunction(()=>document.querySelector('[data-space-trigger]')?.title.endsWith('灯台出版'));
  await page.locator('#language').click();assert((await trigger.getAttribute('aria-label')).startsWith('Space to display'));
  await trigger.click();await popup.getByRole('button',{name:'All cloud manuscripts',exact:true}).waitFor();await page.keyboard.press('Escape');await page.locator('#language').click();
  const imageSpace=catalogue.spaces.find(s=>s.profile?.icon);
  if(imageSpace){await choose(imageSpace.id);await page.waitForFunction(()=>document.querySelector('[data-space-trigger] img')?.naturalWidth>0);}
  await trigger.click();await page.screenshot({path:'outputs/space-switcher-desktop.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await trigger.click();
  assert(await popup.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
  await page.screenshot({path:'outputs/space-switcher-mobile.png'});await popup.locator('[data-space-choice="all"]').click();
  assert.equal(await page.locator('[data-project-id]').count(),2);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(await proof(),before,'switching, cancellation and reload never change cloud data');assert.deepEqual(errors,[]);
  console.log('Header switcher: selection, filtering, restore, icons, keyboard, dismiss, creation cancel, account isolation, EN and mobile passed; cloud data unchanged.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
