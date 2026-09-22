const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1360,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5198';const proof=async()=>(await page.request.get(base+'/fixture/proof')).json(),before=await proof();
 await page.goto(base+'/members');await page.locator('.resource-section').waitFor();
 const targetButton=(scope,id)=>page.locator('[data-target-scope="'+scope+'"][data-target-id="'+id+'"]');
 const open=async(scope,id)=>{await targetButton(scope,id).locator('..').locator('summary').click();await targetButton(scope,id).click();await page.locator('.target-access-dialog').waitFor();};
 const row=uid=>page.locator('[data-target-member="'+uid+'"]');
 const limited=async()=>{
  assert.equal(await page.locator('dialog select').count(),1);
  assert.equal(await page.locator('dialog [data-grant-target],dialog [data-grant-scope],dialog #membership-role,dialog #add-grant,dialog [data-remove-grant]').count(),0);
  assert.equal(await page.locator('.read-only-permissions button,.read-only-permissions select,.read-only-permissions input,.read-only-permissions a').count(),0);
 };
 await open('work','work_library');assert.match(await row('editor').innerText(),/レーベルから継承 · 海辺文庫 · 編集可/);assert.equal(await page.locator('[data-source-uid]').count(),0);assert.equal(await row('manager').locator('button').count(),0);
 await row('editor').locator('[data-direct-uid]').click();await limited();assert.equal(await page.locator('#scoped-review').isDisabled(),true);
 assert(!((await page.locator('dialog').innerText()).includes('旅の写真集')));assert(!((await page.locator('dialog').innerText()).includes('灯台の手紙')));
 assert.match(await page.locator('.read-only-permissions').innerText(),/海辺文庫 · 編集可/);
 await page.locator('#scoped-role').selectOption('viewer');assert.match(await page.locator('#scoped-effective').innerText(),/潮騒の図書館: 編集可/);
 await page.locator('#scoped-review').click();assert.match(await page.locator('.confirmation-summary').innerText(),/直接設定なし → 閲覧のみ/);assert.match(await page.locator('dialog').innerText(),/現在の作品に対するアクセス変更はありません/);
 await page.keyboard.press('Escape');assert.equal(await row('editor').getByText(/この対象に直接設定/).count(),0);await page.locator('[data-close-target]').first().click();
 await open('work','work_notes');await row('reviewer').locator('[data-direct-uid]').click();await limited();assert.equal(await page.locator('.fixed-permission-target strong').innerText(),'夜明けのノート');assert(!((await page.locator('dialog').innerText()).includes('潮騒の図書館')));
 await page.locator('#scoped-role').selectOption('editor');await page.locator('#scoped-review').click();assert.match(await page.locator('.changes').innerText(),/夜明けのノート: アクセス不可 → 編集可/);
 await page.locator('#scoped-back').click();await limited();assert.equal(await page.locator('#scoped-role').inputValue(),'editor');await page.locator('#scoped-review').click();await page.locator('#scoped-apply').click();assert.match(await row('reviewer').innerText(),/この対象に直接設定 · 夜明けのノート · 編集可/);
 await page.locator('[data-close-target]').first().click();assert(await targetButton('work','work_notes').locator('..').locator('summary').evaluate(e=>e===document.activeElement));assert.equal(await page.locator('[data-visible-work]').count(),2);assert.match(await page.locator('[data-visible-work="work_library"]').innerText(),/閲覧のみ/);
 await open('label','label_photo');assert.match(await row('editor').innerText(),/一部の作品のみ/);await page.keyboard.press('Escape');
 await open('label','label_sea');await row('reviewer').locator('[data-direct-uid]').click();await limited();assert.equal(await page.locator('.fixed-permission-target strong').innerText(),'海辺文庫');assert(!((await page.locator('dialog').innerText()).includes('夜明けのノート')));
 await page.locator('#scoped-role').selectOption('viewer');await page.locator('#scoped-review').click();assert.match(await page.locator('.changes').innerText(),/灯台の手紙/);await page.locator('#scoped-apply').click();await page.keyboard.press('Escape');assert.match(await page.locator('[data-visible-work="work_notes"]').innerText(),/編集可/);
 // Global editing remains available only through the member entry point.
 await page.locator('[data-edit-member="editor"]').click();assert.equal(await page.locator('#membership-role').count(),1);assert.equal(await page.locator('[data-grant]').count(),2);await page.keyboard.press('Escape');
 await page.locator('#actor').selectOption('reviewer');assert.equal(await page.locator('.resource-section').count(),0);assert.equal(await page.locator('[data-edit-member]').count(),0);
 await page.locator('#actor').selectOption('manager');await page.locator('#language').click();await open('work','work_library');await row('editor').locator('[data-direct-uid]').click();await limited();assert.match(await page.locator('dialog').innerText(),/Only the direct assignment/);await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.locator('#language').click();
 await open('work','work_library');await row('editor').locator('[data-direct-uid]').click();await page.locator('#scoped-role').selectOption('viewer');await page.screenshot({path:'outputs/space-scoped-editor-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert(await page.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.screenshot({path:'outputs/space-scoped-editor-mobile.png'});
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.deepEqual(await proof(),before);assert.deepEqual(errors,[]);
 console.log('Scoped target menus: fixed target, one editable permission, read-only inheritance, no unrelated controls, limited confirmation, preservation, cancel/back/apply, roles, JA/EN and mobile passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
