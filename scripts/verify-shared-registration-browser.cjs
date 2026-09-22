const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SHARED_STUDIO_URL||'http://127.0.0.1:5220';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/scripts/fixtures/shared-registration-ui.html');
 await page.locator('#prepare').click();await page.locator('#register').waitFor({state:'visible'});
 assert.match(await page.locator('#status').textContent(),/潮騒の図書館/);
 await page.screenshot({path:'outputs/shared-registration-confirm.png'});
 await page.locator('#register').click();await page.locator('#open').waitFor({state:'visible'});
 await page.locator('#open').click();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
 await page.locator('[data-shared-lock-action=acquire]').click();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');
 const input=page.locator('[data-testid=flow-paragraph-input]');await input.fill((await input.inputValue())+' 共有登録後の検証です。');await input.blur();
 await page.locator('[data-shared-lock-action=release]').click();await page.locator('[data-shared-lock-action=acquire]').waitFor();
 await page.reload();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');assert.match(await input.inputValue(),/共有登録後の検証/);
 await page.screenshot({path:'outputs/shared-registration-studio.png'});assert.deepEqual(errors,[]);
 console.log('Shared registration browser passed: prepare, confirmation, registration, owner read-only, acquire/edit/save/release, reload preservation.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
