const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE), assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5192/');
  const selector=page.locator('[data-space-select]');
  await selector.waitFor();
  const suffix=Date.now(), title='灯台出版 '+suffix;
  await page.getByRole('button',{name:'スペースを開設'}).click();
  await page.locator('input[name=name]').fill(title);
  await page.locator('[data-space-form]').getByRole('button',{name:'開設',exact:true}).click();
  await page.waitForFunction(title=>document.querySelector('[data-space-select]')?.selectedOptions[0]?.textContent===title,title);
  const spaceId=await selector.inputValue();
  assert.equal(await page.locator('[data-project-id]').count(),0,'empty new space must not implicitly migrate works');
  await selector.selectOption('all');
  await page.locator('[data-space-project="book_1"]').selectOption(spaceId);
  await page.waitForFunction(id=>document.querySelector('[data-space-project="book_1"]')?.value===id,spaceId);
  await selector.selectOption(spaceId);
  assert.equal(await page.locator('[data-project-id="book_1"]').count(),1);
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('input[name=name]').fill('新しい出版名 '+suffix);
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.publishing-space-status')?.textContent==='保存しました。');
  await page.reload();await selector.waitFor();assert.equal(await selector.inputValue(),spaceId,'selection survives reload');
  assert.equal(await page.locator('[data-project-id="book_1"]').count(),1);

  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('textarea[name=description]').fill('海辺の物語を届ける出版スペースです。\n短編小説と写真集を制作しています。');
  await page.locator('input[name=website]').fill('https://example.com/books');
  const png = await page.evaluate(() => {
    const c=document.createElement('canvas');c.width=1536;c.height=512;
    const x=c.getContext('2d'),g=x.createLinearGradient(0,0,1536,512);
    g.addColorStop(0,'#0e4259');g.addColorStop(1,'#efc88a');x.fillStyle=g;x.fillRect(0,0,1536,512);
    x.fillStyle='#fff3cd';x.fillRect(1080,170,34,230);x.fillRect(1064,150,66,24);
    return c.toDataURL('image/png').split(',')[1];
  });
  for(const slot of ['icon','banner']) {
    await page.locator('[data-space-image="'+slot+'"]').setInputFiles({name:slot+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(slot=>document.querySelector('[data-profile-image="'+slot+'"] img')?.src.startsWith('data:image/webp'),slot);
  }
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.publishing-space-status')?.textContent==='保存しました。');
  await page.reload();await selector.waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-profile-image] img')].length===2 && [...document.querySelectorAll('[data-profile-image] img')].every(i=>i.complete && i.naturalWidth>0));
  assert.ok((await page.locator('.space-profile-description').textContent()).includes('短編小説'));
  const profile = await (await page.request.get('http://127.0.0.1:5192/api/publishing-spaces',{headers:{Authorization:'Bearer fixture-owner'}})).json();
  const saved = profile.spaces.find(s=>s.id===spaceId);
  assert.match(saved.profile.icon,/^[a-f0-9]{64}$/);
  assert.match(saved.profile.banner,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(saved).includes('data:image'),false,'Firestore stores references only');
  const forbidden = await page.request.post('http://127.0.0.1:5192/api/publishing-spaces',{headers:{Authorization:'Bearer fixture-other'},data:{kind:'readImage',spaceId,slot:'icon'}});
  assert.equal(forbidden.status(),403);
  // Cancel keeps the saved profile. Removing an image is explicit and persistent.
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('textarea[name=description]').fill('キャンセルする説明');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.ok((await page.locator('.space-profile-description').textContent()).includes('短編小説'));
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('[data-space-remove="icon"]').click();
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.publishing-space-status')?.textContent==='保存しました。');
  await page.reload();await selector.waitFor();
  assert.equal(await page.locator('[data-profile-image="icon"] img').count(),0);
  await page.waitForFunction(()=>document.querySelector('[data-profile-image="banner"] img')?.naturalWidth>0);
  // Restore the icon for the preview left open for review.
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('[data-space-image="icon"]').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>document.querySelector('[data-profile-image="icon"] img')?.src.startsWith('data:image/webp'));
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.publishing-space-status')?.textContent==='保存しました。');

  await page.locator('#account').click();
  await page.waitForFunction(()=>document.querySelector('[data-space-select]')?.options.length===2);
  assert.equal(await page.locator('[data-project-id]').count(),0,'other account cannot see first account works');
  await page.locator('#account').click();
  await page.waitForFunction(id=>document.querySelector('[data-space-select]')?.value===id,spaceId);
  await page.locator('#language').click();
  await page.getByRole('button',{name:'Create a space',exact:true}).waitFor();
  assert.equal(await page.locator('[data-project-id="book_1"]').count(),1);
  await page.getByRole('button',{name:'Edit space profile',exact:true}).click();
  await page.getByLabel('About',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('#language').click();
  await page.locator('summary').click();assert.equal(await page.locator('#open-file').isVisible(),true);
  await page.screenshot({path:'outputs/publishing-spaces-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'outputs/publishing-spaces-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.screenshot({path:'outputs/publishing-spaces-settings-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile settings fit');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile fits');
  const docs=await (await page.request.get('http://127.0.0.1:5192/fixture/proof')).json();
  const book=docs.find(x=>x[0]==='users/owner_1/projects/book_1')[1];
  assert.deepEqual(book.blocks,[{text:'本文を変更しない'}]);
  assert.equal(docs.find(x=>x[0]==='public_projects/work_1')[1].releaseId,'release_1');

  // The backend applied the change, but the browser lost the response.
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('textarea[name=description]').fill('通信切断後も保存された概要');
  await page.route('**/api/publishing-spaces',async route=>{
    if(route.request().postDataJSON()?.kind==='profile'){await route.fetch();await route.abort('failed');}
    else await route.continue();
  });
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.getByText('保存できませんでした。接続を確認して再試行してください。',{exact:true}).waitFor();
  await page.unroute('**/api/publishing-spaces');
  const readCatalogue=async()=> (await page.request.get('http://127.0.0.1:5192/api/publishing-spaces',{headers:{Authorization:'Bearer fixture-owner'}})).json();
  const afterLost=await readCatalogue();
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.publishing-space-status')?.textContent==='保存しました。');
  assert.equal((await readCatalogue()).revision,afterLost.revision);
  // Another editor updates after this form was opened: retain their latest change.
  await page.getByRole('button',{name:'基本情報を設定',exact:true}).click();
  await page.locator('textarea[name=description]').fill('古い画面からの内容');
  await page.request.post('http://127.0.0.1:5192/api/publishing-spaces',{headers:{Authorization:'Bearer fixture-owner'},data:{
    kind:'profile',spaceId,name:afterLost.spaces.find(s=>s.id===spaceId).name,baseRevision:afterLost.revision,
    profile:{description:'他の画面で更新した概要',website:''}}});
  await page.getByRole('button',{name:'変更を保存',exact:true}).click();
  await page.getByText('別の画面で更新されています。最新の一覧を確認して、もう一度操作してください。',{exact:true}).waitFor();
  assert.equal(await page.locator('.space-profile-description').textContent(),'他の画面で更新した概要');
  await page.route('**/api/publishing-spaces',route=>route.request().postDataJSON()?.kind==='readImage'
    ?route.fulfill({status:503,contentType:'application/json',body:'{"error":"SPACE_MEDIA_UNAVAILABLE"}'}):route.continue());
  await page.reload();await page.locator('[data-space-retry-images]').waitFor();
  await page.unroute('**/api/publishing-spaces');
  await page.locator('[data-space-retry-images]').click();
  await page.waitForFunction(()=>document.querySelector('[data-profile-image="banner"] img')?.naturalWidth>0);

  // Backend outage retains access to cloud list and provides an explicit retry.
  await page.route('**/api/publishing-spaces',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"SPACES_UNAVAILABLE"}'}));
  await page.reload();await page.getByRole('button',{name:'再読み込み',exact:true}).waitFor();
  assert.equal(await page.locator('[data-project-id]').count(),2);
  await page.unroute('**/api/publishing-spaces');await page.getByRole('button',{name:'再読み込み',exact:true}).click();await selector.waitFor();
  assert.deepEqual(errors,[]);
  console.log('Chrome: create, switch, assign, rename, reload, account isolation, English, local copies, mobile, profile editing, image conversion/persistence/removal, cancellation, private image access and outage/retry passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
