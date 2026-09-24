const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.NOTIFICATIONS_URL||'http://127.0.0.1:5259';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const context=await browser.newContext({viewport:{width:1280,height:960}});context.setDefaultTimeout(20000);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(kind,command,uid='owner_1')=>{const r=await context.request.post(base+'/api/'+kind,{headers:{Authorization:'Bearer fixture-'+uid},data:command});const data=await r.json();assert.equal(r.status(),200,JSON.stringify(data));return data;};
 const plan=await api('personal-sharing',{kind:'prepare',projectId:'book_library'});
 await api('personal-sharing',{kind:'invite',id:'personal_00000000-0000-4000-8000-000000000002',projectId:'book_library',recipientUid:'reader_1',revision:plan.revision,generationId:plan.generationId,expiresInDays:7});
 await page.goto(base+'/?actor=reader');const bell=page.locator('[data-account-notifications]');
 await page.waitForFunction(()=>document.querySelector('[data-notification-count]')?.textContent==='2');
 await bell.click();let dialog=page.getByRole('dialog',{name:'お知らせ',exact:true});await dialog.locator('.account-notification-row').nth(1).waitFor();
 assert.equal(new URL(page.url()).pathname,'/');await page.screenshot({path:'outputs/notifications-portal-list.png'});
 // Opening the list does not mark either notice read.
 assert.equal((await api('personal-sharing',{kind:'inbox'},'reader_1')).unreadCount,1);
 const projectRow=dialog.locator('.account-notification-row').filter({hasText:'作品への招待'});await projectRow.click();await dialog.getByRole('button',{name:'招待を承諾',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-notification-count]')?.textContent==='1');
 const unread=await api('personal-sharing',{kind:'inbox'},'reader_1');assert.equal(unread.unreadCount,0);assert.equal(unread.pendingCount,1);
 await dialog.getByRole('button',{name:'招待を承諾',exact:true}).click();await dialog.getByRole('link',{name:/作品を開く/}).waitFor();
 assert.equal(await dialog.getByRole('link',{name:/作品を開く/}).getAttribute('target'),'_blank');await page.screenshot({path:'outputs/notifications-project-detail.png'});
 await dialog.getByRole('button',{name:'一覧へ戻る'}).click();await dialog.locator('.account-notification-row').filter({hasText:'出版スペースへの招待'}).click();await dialog.getByRole('heading',{name:'灯台出版'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-notification-count]')?.textContent==='0');
 await dialog.getByRole('button',{name:'招待を承諾',exact:true}).click();await dialog.getByRole('button',{name:'共有作品を見る'}).click();await dialog.getByRole('link',{name:/夜明けのノート/}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);assert(await bell.evaluate(e=>e===document.activeElement));
 console.log('PASS Portal list/detail, persisted unread counts, both invitation acceptances, shared work links');
 // Every account surface exposes the same modal and persists read state across pages.
 for(const route of ['/mypage','/viewer','/studio?room=home','/studio?room=editor&id=book_library&actor=owner']){
  await page.goto(base+route);const notification=page.locator('button.account-notification-bell:visible').first();await notification.waitFor();
  if(route.includes('room=editor'))await page.waitForFunction(()=>window.fixtureStudio?.state.projectId==='book_library');
  const url=page.url(),before=await page.evaluate(()=>window.fixtureStudio?JSON.stringify(window.fixtureStudio.state):null);
  await notification.click();await page.locator('.account-notifications-dialog[open]').waitFor();await page.getByRole('heading',{name:'お知らせ',exact:true}).waitFor();
  assert.equal(page.url(),url);await page.keyboard.press('Escape');
  if(before)assert.equal(await page.evaluate(()=>JSON.stringify(window.fixtureStudio.state)),before);
  console.log('PASS unchanged surface '+route);
 }
 await page.goto(base+'/?actor=reader');await page.setViewportSize({width:390,height:844});await page.locator('[data-account-notifications]').click();await page.locator('.account-notification-row').nth(1).waitFor();
 await page.screenshot({path:'outputs/notifications-mobile.png'});
 await page.evaluate(()=>document.documentElement.lang='en');await page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor();
 // Closing a pending detail request must not replace a newly opened list.
 let held,started;const pendingRead=new Promise(resolve=>started=resolve);
 await page.route('**/api/personal-sharing',route=>{if(route.request().postDataJSON()?.kind==='read'){held=route;started();}else route.continue();});
 await page.locator('.account-notification-row').filter({hasText:'Project invitation'}).click();await pendingRead;
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('[data-account-notifications]').click();
 const readResponse=page.waitForResponse(r=>r.url().endsWith('/api/personal-sharing')&&r.request().postDataJSON()?.kind==='read');
 await held.continue();await readResponse;await page.unroute('**/api/personal-sharing');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.account-notification-row').nth(1).waitFor();
 // Lost connection must be visible, never silently report an empty inbox.
 await page.route('**/api/personal-sharing',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"TEST_OUTAGE"}'}));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Some notifications could not be loaded. Select Refresh to try again.').waitFor();
 await page.unroute('**/api/personal-sharing');await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.account-notification-row').nth(1).waitFor();
 // Signing out clears the modal and prevents old-account messages from being shown.
 await page.evaluate(async()=>{const {signOutUser}=await import('/js/gis-auth.js');await signOutUser();});await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 await page.locator('[data-account-notifications]').click();await page.getByText('Sign in to view invitations and notifications.').waitFor();assert.equal(await page.locator('.account-notification-row').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS mobile, English, retry, sign-out privacy and keyboard close/focus');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
