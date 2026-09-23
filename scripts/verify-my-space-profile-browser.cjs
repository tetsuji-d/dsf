const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5244',b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage({viewport:{width:1280,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const read=async(token='fixture-owner')=> (await p.request.get(base+'/api/publishing-spaces',{headers:{Authorization:'Bearer '+token}})).json();
 const original=await (await p.request.get(base+'/fixture/proof')).json();
 await p.goto(base+'/workspace');
 const settings=async()=>{await p.locator('.home-management-sidebar [data-home-nav="settings"]').click();await p.locator('[data-space-settings="profile"]').click();await p.locator('[data-space-settings]:not([aria-pressed])').waitFor();};
 await settings();assert.equal(await p.locator('[data-space-create]').count(),0);
 await p.locator('[data-space-trigger]:visible').click();await p.locator('[data-switcher-create]:visible').click();await p.locator('.space-opening-dialog').waitFor();await p.getByRole('button',{name:'キャンセル',exact:true}).click();
 await p.locator('[data-space-settings]:not([aria-pressed])').click();
 assert.equal(await p.locator('input[name="name"]').count(),0);assert.equal(await p.locator('input[name="website"]').count(),0);
 await p.locator('textarea[name="description"]').fill('私のノートと写真集');
 const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=700;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,1600,700);g.addColorStop(0,'#075985');g.addColorStop(1,'#fbbf24');x.fillStyle=g;x.fillRect(0,0,1600,700);x.fillStyle='#fff';x.font='90px sans-serif';x.fillText('My space',550,400);return c.toDataURL('image/png').split(',')[1];});
 for(const slot of ['icon','banner']){await p.locator('[data-space-image="'+slot+'"]').setInputFiles({name:slot+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await p.waitForFunction(slot=>document.querySelector('[data-profile-image="'+slot+'"] img')?.src.startsWith('data:image/webp'),slot);}
 await p.locator('[data-space-submit]').click();await p.locator('[data-space-form]').waitFor({state:'detached'});
 const saved=await read();assert.match(saved.mySpaceProfile.icon,/^[a-f0-9]{64}$/);assert.match(saved.mySpaceProfile.banner,/^[a-f0-9]{64}$/);assert.deepEqual(saved.spaces,[]);
 await p.reload();await settings();await p.waitForFunction(()=>[...document.querySelectorAll('[data-profile-image] img')].length===2&&[...document.querySelectorAll('[data-profile-image] img')].every(i=>i.naturalWidth>0));
 assert.equal(await p.locator('.space-profile-description').innerText(),'私のノートと写真集');await p.waitForFunction(()=>document.querySelector('#home-space-identity img')?.naturalWidth===256);
 assert.equal(await p.locator('[data-profile-image="banner"] img').evaluate(e=>e.naturalWidth),1536);
 await p.screenshot({path:'outputs/my-space-profile-desktop.png'});
 await p.locator('[data-space-settings]:not([aria-pressed])').click();await p.locator('textarea[name="description"]').fill('取り消す');await p.locator('[data-space-remove="icon"]').click();await p.locator('[data-space-cancel]').click();assert.deepEqual(await read(),saved);
 // Simulate a response lost after a successful save, then retry without a duplicate write.
 await p.locator('[data-space-settings]:not([aria-pressed])').click();await p.locator('textarea[name="description"]').fill('応答消失後も保存');
 await p.route('**/api/publishing-spaces',async r=>{if(r.request().method()==='POST'&&r.request().postDataJSON()?.kind==='myProfile'){await r.fetch();await r.abort();}else await r.continue();});
 await p.locator('[data-space-submit]').click();await p.getByText('保存できませんでした。接続を確認して再試行してください。',{exact:true}).waitFor();await p.unroute('**/api/publishing-spaces');const once=await read();await p.locator('[data-space-submit]').click();await p.locator('[data-space-form]').waitFor({state:'detached'});assert.equal((await read()).revision,once.revision);
 await p.locator('[data-space-settings]:not([aria-pressed])').click();await p.locator('[data-space-remove="icon"]').click();await p.locator('[data-space-submit]').click();await p.locator('[data-space-form]').waitFor({state:'detached'});await p.reload();await settings();assert.equal(await p.locator('[data-profile-image="icon"] img').count(),0);await p.waitForFunction(()=>document.querySelector('[data-profile-image="banner"] img')?.naturalWidth>0);
 await p.locator('#fixture-language').click();assert.equal(await p.locator('[data-space-settings="profile"]').innerText(),'My space settings');
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:'outputs/my-space-profile-mobile.png'});
 assert.equal((await read('fixture-other')).mySpaceProfile.icon,null);
 const otherImage=await p.request.post(base+'/api/publishing-spaces',{headers:{Authorization:'Bearer fixture-other'},data:{kind:'readImage',spaceId:null,slot:'banner'}});assert.equal(otherImage.status(),404);
 const after=new Map(await (await p.request.get(base+'/fixture/proof')).json());for(const [path,value] of original.filter(([path])=>path!=='users/owner_1/publishing/catalogue'))assert.deepEqual(after.get(path),value,'existing accounts, manuscripts and publications unchanged');assert.equal([...after.keys()].some(k=>k.startsWith('publishing_spaces/')),false);
 assert.deepEqual(errors,[]);console.log('My space profile browser: creation entry, private WebP save/reload, header icon, cancellation, lost response retry, removal, EN/mobile and account isolation passed.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
