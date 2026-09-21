const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5196';
  const proof=async()=> (await page.request.get(base+'/fixture/proof')).json();
  await page.goto(base);await page.locator('[data-space-create]').waitFor();
  const before=await proof(),title='灯台出版 '+Date.now();
  await page.getByRole('button',{name:'スペースを開設',exact:true}).click();
  const modal=page.getByRole('dialog');
  assert.equal(await modal.locator('.space-opening-payment').isVisible(),true);
  await modal.getByLabel('出版スペース名',{exact:true}).fill(title);
  await page.screenshot({path:'outputs/space-opening-desktop.png'});
  assert.deepEqual(await proof(),before,'opening and typing are read-only');
  await modal.getByRole('button',{name:'内容を確認',exact:true}).click();
  assert.equal(await modal.locator('.space-opening-review-name').isVisible(),true);
  await modal.getByRole('button',{name:'戻る',exact:true}).click();
  assert.equal(await modal.getByLabel('出版スペース名',{exact:true}).inputValue(),title);
  await modal.getByRole('button',{name:'内容を確認',exact:true}).click();
  await page.screenshot({path:'outputs/space-opening-review.png'});
  await modal.getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.deepEqual(await proof(),before,'cancel never creates a space');
  assert.equal(await page.locator('[data-space-trigger]').evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'スペースを開設',exact:true}).click();
  await modal.getByLabel('出版スペース名',{exact:true}).fill(title);
  await page.screenshot({path:'outputs/space-opening-mobile.png'});
  assert(await modal.evaluate(el=>el.getBoundingClientRect().right<=innerWidth && el.getBoundingClientRect().left>=0));
  await modal.getByRole('button',{name:'内容を確認',exact:true}).click();
  let lose=true;
  await page.route('**/api/publishing-spaces',async route=>{
    const cmd=route.request().postDataJSON();if(lose&&cmd?.kind==='create'){lose=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await modal.getByRole('button',{name:'この内容で開設',exact:true}).click();
  await modal.getByRole('status').filter({hasText:'再試行'}).waitFor();
  await modal.getByRole('button',{name:'この内容で開設',exact:true}).click();
  await page.waitForFunction(title=>document.querySelector('[data-space-trigger]')?.title.endsWith(': '+title),title);
  await page.unroute('**/api/publishing-spaces');
  const after=await proof();assert.equal(after.filter(([path,value])=>path.startsWith('publishing_spaces/')&&value.name===title).length,1);
  for(const [path,value] of before.filter(([path])=>!path.includes('/publishing/')&&!path.startsWith('publishing_spaces/')))assert.deepEqual(after.find(row=>row[0]===path)?.[1],value);
  await page.locator('#language').click();await page.getByRole('button',{name:'Create a space',exact:true}).click();
  await modal.getByLabel('Publishing space name',{exact:true}).fill('English Press');
  await modal.getByRole('button',{name:'Review details',exact:true}).click();await modal.locator('dd').filter({hasText:'No payment or paid subscription'}).waitFor();
  await page.keyboard.press('Escape');assert.equal(await modal.count(),0);
  assert.deepEqual(errors,[]);console.log('Space opening: two-step review, cancel/back, focus return, responsive layout, ambiguous retry without duplicates, source preservation and EN passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
