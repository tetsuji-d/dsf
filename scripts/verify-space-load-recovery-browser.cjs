const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await browser.newPage();let calls=0,fail=true;const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/api/publishing-spaces',async route=>{calls++;if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'UPSTREAM_UNAVAILABLE'})});else await route.continue();});
 await p.goto('http://127.0.0.1:5238');await p.locator('[data-space-retry]').waitFor();assert.equal(calls,2,'one automatic retry');
 fail=false;await p.locator('[data-space-trigger]').click();await p.locator('[data-switcher-create]').waitFor();assert.equal(calls,3,'opening the switcher recovers without reload');
 const q=await browser.newPage();let inboxCalls=0,failInbox=true;
 await q.route('**/api/invitations',async route=>{const c=route.request().postDataJSON();if(c.kind==='inbox'){inboxCalls++;if(failInbox){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'UPSTREAM_UNAVAILABLE'})});return;}}await route.continue();});
 await q.goto('http://127.0.0.1:5239/settings');await q.locator('#actor').selectOption('reader_1');await q.getByRole('button',{name:'再読み込み',exact:true}).waitFor();const before=inboxCalls;assert(before>=2);
 failInbox=false;await q.getByRole('button',{name:'再読み込み',exact:true}).click();await q.getByText('ベルマークから招待のお知らせを確認できます。',{exact:true}).waitFor();assert.equal(inboxCalls,before+1);assert.equal(await q.getByRole('button',{name:'再読み込み',exact:true}).isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Browser recovery passed: failed space load retries once; reopening switcher recovers; inbox retry recovers without page reload.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
