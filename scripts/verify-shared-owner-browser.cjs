const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SHARED_STUDIO_URL||'http://127.0.0.1:5217';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});ctx.setDefaultTimeout(20000);
  const errors=[],requests=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  ctx.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),method:r.method()})});
  const owner=await ctx.newPage();
  await owner.goto(base+'/studio?room=editor&id=book_library&actor=owner');
  await owner.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
  assert.equal(await owner.evaluate(()=>window.fixtureStudio.state.uid),'owner_1');
  await owner.locator('[data-shared-lock-action=acquire]').click();await owner.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');
  const reader=await ctx.newPage();await reader.goto(base+'/studio?room=editor&sharedSpace=space_demo&sharedWork=work_library');
  await reader.locator('[data-shared-lock-action=request]').waitFor();
  assert.match(await reader.locator('#shared-studio-status').textContent(),/山口/);
  await reader.locator('[data-shared-lock-action=request]').click();await reader.locator('[data-shared-lock-action=cancel]').waitFor();
  await owner.evaluate(()=>window.fixtureStudio.persistence.checkSharedStudioAccess());
  const input=owner.locator('[data-testid=flow-paragraph-input]'),text=(await input.inputValue())+' 所有者から引き継いだ原稿です。';
  await input.fill(text);await input.blur();await owner.locator('[data-shared-lock-action=grant]').click();
  await owner.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
  await reader.evaluate(()=>window.fixtureStudio.persistence.checkSharedStudioAccess());
  await reader.locator('[data-shared-lock-action=acquire]').click();await reader.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');
  assert.equal(await reader.locator('[data-testid=flow-paragraph-input]').inputValue(),text);
  // Opening the old personal URL again must not grant ownership a second editor slot.
  const oldUrl=await ctx.newPage();await oldUrl.goto(base+'/studio?room=editor&id=book_library&actor=owner');
  await oldUrl.locator('[data-shared-lock-action=request]').waitFor();
  assert.equal(await oldUrl.evaluate(()=>window.fixtureStudio.state.uid),'owner_1');
  assert.equal(await oldUrl.evaluate(async()=>{try{await window.fixtureStudio.persistence.sharedStudioLockAction('acquire',()=>{});return 'allowed'}catch(e){return e.code}}),'EDIT_LOCK_HELD');
  const r=await oldUrl.request.put(base+'/api/projects/book_library/authoring',{headers:{Authorization:'Bearer fixture-owner_1','X-Authoring-Generation':'fixture_generation','X-Authoring-Request-Id':'old_window','X-Authoring-Base-Revision':'2','Content-Type':'application/json'},data:{}});
  assert.equal(r.status(),409);assert.equal((await r.json()).error,'SHARED_AUTHORING_REQUIRED');
  assert(requests.some(r=>r.url.includes('/api/projects/book_library/authoring')&&r.method==='GET'));
  assert(requests.some(r=>r.url.includes('/api/spaces/')&&r.url.endsWith('/authoring')&&r.method==='PUT'));
  assert(!requests.some(r=>r.url.includes('/api/projects/')&&r.method==='PUT'));
  const status=await(await reader.request.get(base+'/fixture/status')).json();assert.equal(status.personalWrites,0);assert.equal(status.publicWrites,0);
  await oldUrl.screenshot({path:'outputs/shared-owner-readonly.png'});await reader.screenshot({path:'outputs/shared-owner-handover.png'});
  await reader.locator('[data-shared-lock-action=release]').click();await reader.locator('[data-shared-lock-action=acquire]').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Shared owner browser passed: old personal URL routes to shared read-only, explicit lock acquisition, handover to member, latest manuscript, old owner denied, shared-only saves.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
