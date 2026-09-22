const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SHARED_STUDIO_URL||'http://127.0.0.1:5210';
const route=base+'/studio.html?room=editor&sharedSpace=space_demo&sharedWork=work_library';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const errors=[];
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});ctx.setDefaultTimeout(20000);
  async function open(actor=''){const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(route+actor);await p.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');await p.locator('[data-testid=flow-paragraph-input]').waitFor();return p;}
  const poll=p=>p.evaluate(()=>window.fixtureStudio.persistence.checkSharedStudioAccess());
  const editing=p=>p.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');
  const readonly=p=>p.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
  const click=(p,action)=>p.locator('[data-shared-lock-action='+action+']').click();
  const until=async fn=>{const end=Date.now()+30000;while(!await fn()){if(Date.now()>end)throw Error('Condition timed out');await new Promise(r=>setTimeout(r,50));}};
  await ctx.request.post(base+'/fixture/advance',{data:{ms:91000}});
  console.log('Opening editor');const a=await open();await click(a,'acquire');await editing(a);
  console.log('Opening other tabs');const b=await open('&actor=second'),same=await open();
  assert(await b.locator('[data-shared-lock-action=request]').isVisible());
  assert(await same.locator('[data-shared-lock-action=request]').isVisible());
  assert.equal(await same.evaluate(async()=>{try{await window.fixtureStudio.persistence.sharedStudioLockAction('acquire',()=>{});return 'allowed'}catch(e){return e.code}}),'EDIT_LOCK_HELD');
  console.log('Requesting handover');await b.locator('[data-shared-lock-action=request]').focus();await b.keyboard.press('Enter');await b.locator('[data-shared-lock-action=cancel]').waitFor();
  await poll(a);await a.locator('[data-shared-lock-action=grant]').waitFor();
  const input=a.locator('[data-testid=flow-paragraph-input]');const text=await input.inputValue()+' 交代直前の追記。';
  console.log('Saving and granting');await input.fill(text);await input.blur();await click(a,'grant');await readonly(a);
  console.log('Reloading recipient');await poll(b);await readonly(b);assert.match(await b.locator('[data-shared-lock-action=acquire]').textContent(),/最新原稿/);
  await click(b,'acquire');await editing(b);assert.equal(await b.locator('[data-testid=flow-paragraph-input]').inputValue(),text);
  assert.equal(await a.evaluate(async()=>{try{await window.fixtureStudio.persistence.flushSave();return 'allowed'}catch(e){return e.code}}),'EDIT_FORBIDDEN');
  console.log('Releasing editor');const next=text+' 次の編集者の追記。';await b.locator('[data-testid=flow-paragraph-input]').fill(next);await b.locator('[data-testid=flow-paragraph-input]').blur();
  await click(b,'release');await b.locator('[data-shared-lock-action=acquire]').waitFor();
  await poll(a);await click(a,'acquire');await editing(a);assert.equal(await a.locator('[data-testid=flow-paragraph-input]').inputValue(),next);
  // Force a connection failure while a draft is still unsaved. Its text remains visible.
  console.log('Testing connection loss');await a.bringToFront();await poll(a);
  const draft=next+' 未保存の下書き。';await a.locator('[data-testid=flow-paragraph-input]').fill(draft);await a.locator('[data-testid=flow-paragraph-input]').blur();
  assert.equal(await a.evaluate(()=>window.fixtureStudio.state.blocks.find(b=>b.kind==='flow').flow.document.sections[0].blocks[0].texts.ja),draft);
  await a.route('**/api/spaces/**',r=>r.abort('internetdisconnected'));
  await poll(a).catch(()=>{});await readonly(a);assert.match(await a.locator('#shared-studio-status').textContent(),/未保存の変更/);
  assert.equal(await a.locator('[data-testid=flow-paragraph-input]').inputValue(),draft);
  await b.request.post(base+'/fixture/advance',{data:{ms:91000}});
  await poll(b);await click(b,'acquire');await editing(b);
  await a.unroute('**/api/spaces/**');await click(a,'refresh');await readonly(a);
  assert.equal(await a.locator('[data-testid=flow-paragraph-input]').inputValue(),draft);
  assert.equal(await b.locator('[data-testid=flow-paragraph-input]').inputValue(),next);
  await b.screenshot({path:'outputs/shared-lock-editor.png'});await a.screenshot({path:'outputs/shared-lock-reader.png'});
  await click(b,'release');await b.locator('[data-shared-lock-action=acquire]').waitFor();
  // Old tab must confirm before discarding its draft to load the latest saved work.
  await poll(a);let prompted=false;a.once('dialog',d=>{prompted=true;void d.dismiss()});await click(a,'acquire');await until(()=>prompted);await readonly(a);
  assert.equal(await a.locator('[data-testid=flow-paragraph-input]').inputValue(),draft);
  const stats=await(await b.request.get(base+'/fixture/status')).json();assert.equal(stats.publicWrites,0);assert.equal(stats.personalWrites,0);
  assert.deepEqual(errors,[]);
  console.log('Shared lock browser passed: two accounts, same-account tabs, request/save/handover, latest snapshot reload, old editor denied, release, connection loss, lease expiry, preserved draft and discard confirmation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
