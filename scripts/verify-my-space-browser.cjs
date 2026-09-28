const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const base=process.env.DSF_SPACES_FIXTURE_URL||'http://127.0.0.1:5242',b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const headers={Authorization:'Bearer fixture-owner'};
 const read=async()=> (await p.request.get(base+'/api/publishing-spaces',{headers})).json();let data=await read();
 const write=async command=>{const r=await p.request.post(base+'/api/publishing-spaces',{headers,data:{...command,baseRevision:data.revision}});assert(r.ok(),await r.text());data=await r.json();};
 const id='space_personal-test-0001';if(!data.spaces.some(s=>s.id===id))await write({kind:'create',spaceId:id,name:'灯台出版'});
 if(data.assignments.book_1!==id)await write({kind:'assign',projectId:'book_1',spaceId:id,expectedSpaceId:data.assignments.book_1||null});
 const proof=async()=> (await p.request.get(base+'/fixture/proof')).json(),before=await proof();
 await p.goto(base+'/workspace');await p.locator('[data-fixture-work="book_2"]').waitFor();
 assert.equal(await p.locator('#home-space-identity strong').innerText(),'マイスペース');assert.equal(await p.locator('[data-fixture-work="book_1"]').count(),0);
 await p.getByRole('button',{name:'新規作成',exact:true}).waitFor();
 const choose=async value=>{await p.locator('#home-space-launcher [data-space-trigger]').click();await p.locator('[data-space-choice="'+value+'"]:visible').click();};
 await p.locator('#home-space-launcher [data-space-trigger]').click();assert.equal(await p.locator('.space-switcher-list button:visible').first().getAttribute('data-space-choice'),'unassigned');await p.keyboard.press('Escape');
 await p.getByRole('button',{name:'設定・招待',exact:true}).click();await p.getByRole('button',{name:'マイスペースの設定',exact:true}).click();
 await p.getByText('試作、ノート、写真集を作る個人の制作場所です。新しい原稿が自動で公開されることはありません。',{exact:true}).waitFor();assert.equal(await p.locator('[data-space-settings-panel="profile"] input').count(),0);
 await choose(id);assert.equal(await p.locator('[data-fixture-work="book_1"]').count(),1);assert.equal(await p.locator('[data-fixture-work="book_2"]').count(),0);await p.getByRole('button',{name:'このスペースで新規作成',exact:true}).waitFor();
 await choose('all');assert.equal(await p.locator('[data-fixture-work]').count(),4);await choose('unassigned');await p.reload();await p.locator('[data-fixture-work="book_2"]').waitFor();assert.equal(await p.locator('#home-space-identity strong').innerText(),'マイスペース');
 await p.getByRole('button',{name:'作品',exact:true}).click();await p.getByText(/既存の公開済み作品は公開が続きます/).waitFor();
 await p.screenshot({path:'outputs/my-space-desktop.png'});
 await p.locator('#fixture-language').click();assert.equal(await p.locator('#home-space-identity strong').innerText(),'My space');await p.getByRole('button',{name:'New project',exact:true}).waitFor();
 await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:'outputs/my-space-mobile.png'});
 await p.locator('#fixture-language').click();
 // Real copy/move dialogs retain null as the personal destination and do not mutate permissions or publications.
 await p.evaluate(async()=>{const {openProjectCopyDialog}=await import('/js/project-copy-ui.js');openProjectCopyDialog({name:'試作',spaces:[{id:'space_other',name:'別の出版'}],createJob:()=>({run:async(name,spaceId)=>{window.copyTarget=spaceId;return {};}}),onCreated:()=>{}});});
 assert.equal(await p.getByLabel('保存先',{exact:true}).inputValue(),'');assert.equal(await p.getByLabel('保存先',{exact:true}).locator('option:checked').innerText(),'マイスペース');await p.getByRole('button',{name:'コピーを作成',exact:true}).click();assert.equal(await p.evaluate(()=>window.copyTarget),null);
 await p.evaluate(async()=>{const {openProjectSpaceDialog}=await import('/js/project-actions-ui.js');openProjectSpaceDialog({name:'公開済み作品',spaces:[{id:'space_other',name:'別の出版'}],currentSpaceId:'space_other',onSave:async id=>{window.moveTarget=id;}});});
 await p.getByLabel('保存先',{exact:true}).selectOption('');await p.getByText(/公開済み作品の公開停止や、他の人への共有は行いません/).waitFor();await p.getByRole('button',{name:'変更を保存',exact:true}).click();assert.equal(await p.evaluate(()=>window.moveTarget),null);
 assert.deepEqual(await proof(),before,'view changes and dialogs must not mutate fixture source, public release, or membership');
 // Fail closed when a fresh catalogue fails: never show a publishing-space work under My space.
 await p.route('**/api/publishing-spaces',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"SPACES_UNAVAILABLE"}'}));await p.reload();await p.locator('#home-space-launcher [data-space-trigger]').click();await p.locator('[data-switcher-retry]:visible').waitFor();assert.equal(await p.locator('[data-fixture-work]').count(),0);
 await p.unroute('**/api/publishing-spaces');await p.locator('[data-switcher-retry]:visible').click();await p.locator('[data-fixture-work="book_2"]').waitFor();assert.equal(await p.locator('[data-fixture-work="book_1"]').count(),0);
 assert.deepEqual(errors,[]);console.log('My space passed: default, first switcher entry, private/owned/all filtering, reload, settings, EN/mobile, copy/move null destination, publication preservation, failure and retry.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
