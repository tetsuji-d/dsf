const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const p=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.setStudioUILang&&document.querySelector('#studio-help-panel'));
const snapshot=()=>p.evaluate(async()=>JSON.stringify((await import('/js/state.js')).state.blocks));const before=await snapshot();
await p.locator('#studio-help-open').click();const panel=p.locator('#studio-help-panel');await panel.waitFor({state:'visible'});
await panel.getByRole('searchbox').fill('英語だけ');await panel.locator('nav').getByRole('button',{name:'本文言語',exact:true}).click();assert((await panel.locator('article').innerText()).includes('EN-GB'));
await p.evaluate(()=>window.setStudioUILang('en'));assert.equal(await panel.locator('h2').innerText(),'Operation help');
await panel.getByRole('searchbox').fill('save');await panel.locator('nav').getByRole('button',{name:'Save project',exact:true}).click();
await panel.getByRole('button',{name:'Show control',exact:true}).click();await p.locator('.studio-help-spot').waitFor({state:'visible'});
await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await p.locator('#studio-help-open').evaluate(e=>e===document.activeElement),true);
// Inspect a disabled action through the shield; no editor click may fire.
await p.evaluate(()=>{const b=document.querySelector('#btn-save');window.helpSaveClicks=0;b.addEventListener('click',()=>window.helpSaveClicks++);});
await p.locator('#studio-help-open').click();await panel.getByRole('button',{name:'Choose a control to inspect'}).click();const box=await p.locator('#btn-save').boundingBox();assert(box);await p.mouse.click(box.x+box.width/2,box.y+box.height/2);await panel.waitFor({state:'visible'});assert.equal(await panel.locator('h3').innerText(),'Save project');assert.equal(await p.evaluate(()=>window.helpSaveClicks),0);
await panel.getByRole('button',{name:'Choose a control to inspect'}).click();await p.keyboard.press('Escape');await panel.waitFor({state:'visible'});await p.keyboard.press('Escape');
// Recreated profile entry opens the same panel.
await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();await p.locator('[data-auth-dropdown].open [data-open-studio-help]').click();await panel.waitFor({state:'visible'});
await p.setViewportSize({width:390,height:844});const rect=await panel.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390);await panel.getByRole('searchbox').fill('zzzzzz');assert((await panel.locator('nav').innerText()).includes('No matches'));
await panel.getByRole('button',{name:'Close help',exact:true}).click();assert.equal(await snapshot(),before);assert.deepEqual(errors,[]);console.log('H1 help browser checks passed: JA/EN search, locate, disabled control inspection, Escape, profile, mobile width, unchanged manuscript.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
