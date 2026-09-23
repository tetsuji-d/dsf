const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SHARED_STUDIO_URL||'http://127.0.0.1:5222';
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await b.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const before=await(await page.request.get(base+'/fixture/status')).json();
 await page.goto(base+'/scripts/fixtures/shared-registration-ui.html');await page.locator('#prepare').click();
 await page.locator('#images').waitFor({state:'visible'});assert.match(await page.locator('#image-summary').textContent(),/3点／確認済み 1点/);
 assert.equal(await page.locator('#image-list li').count(),3);const text=await page.locator('#image-list').textContent();
 assert.match(text,/コピー準備可能/);assert.match(text,/画像が見つかりません/);assert.match(text,/管理対象外/);
 assert.equal(await page.locator('#register').isVisible(),false);await page.screenshot({path:'outputs/shared-image-preflight-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/shared-image-preflight-mobile.png'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const after=await(await page.request.get(base+'/fixture/status')).json();assert.deepEqual(after,before);
 assert.deepEqual(errors,[]);console.log('Image preflight browser passed: counts/statuses, no registration, unchanged source, desktop/mobile.');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
