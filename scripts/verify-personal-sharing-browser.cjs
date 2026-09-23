const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PERSONAL_SHARING_URL||'http://127.0.0.1:5246';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const ctx=await browser.newContext({viewport:{width:1365,height:950}}),owner=await ctx.newPage(),reader=await ctx.newPage(),errors=[];
 for(const p of [owner,reader]){p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());}
 await owner.goto(base+'/scripts/fixtures/personal-sharing-ui.html?actor=owner');await owner.getByRole('button',{name:'共有',exact:true}).click();
 if(process.env.PERSONAL_PREPARATION==='true'){await owner.getByRole('button',{name:'個別共有の準備をする',exact:true}).click();await owner.getByPlaceholder('@horizon_id').waitFor({timeout:30000});await owner.screenshot({path:'outputs/personal-sharing-prepared.png',fullPage:true});}
 await owner.getByPlaceholder('@horizon_id').fill('@sato');await owner.getByRole('button',{name:'相手を確認'}).click();await owner.getByRole('button',{name:'閲覧のみで招待する'}).click();await owner.getByText('佐藤（招待先） · 承諾待ち').waitFor();
 await reader.goto(base+'/scripts/fixtures/personal-sharing-ui.html?actor=reader');await reader.getByRole('button',{name:'招待を承諾'}).click();await reader.getByRole('button',{name:'開く',exact:true}).waitFor();
 await reader.screenshot({path:'outputs/personal-sharing-inbox.png',fullPage:true});
 await reader.getByRole('button',{name:'開く',exact:true}).click();await reader.waitForFunction(()=>window.fixtureStudio?.state?.projectId==='book_library'&&document.body.dataset.sharedStudio==='readonly',{timeout:30000});
 const state=await reader.evaluate(()=>({uid:window.fixtureStudio.state.uid,text:JSON.stringify(window.fixtureStudio.state.blocks)}));assert.equal(state.uid,'reader_1');if(process.env.PERSONAL_PREPARATION==='true')assert.equal(await reader.evaluate(async()=>{const b=window.fixtureStudio.state.blocks.find(b=>b.kind==='page');const i=new Image();i.src=b.content.background;await i.decode();return i.naturalWidth;}),1);assert(state.text.includes('港の図書館'));
 assert.equal(await reader.locator('[data-shared-lock-action=acquire]:visible').count(),0);
 await reader.screenshot({path:'outputs/personal-sharing-reader.png',fullPage:true});
 await owner.getByRole('button',{name:'閉じる',exact:true}).click();await owner.getByRole('button',{name:'共有',exact:true}).click();await owner.getByText('佐藤（招待先） · 閲覧のみ').waitFor();
 await owner.getByRole('button',{name:'共有を解除'}).click();await owner.getByText('まだ共有していません。').waitFor();
 await reader.bringToFront();await reader.getByText('閲覧権限を確認できません。共有された作品の一覧から開き直してください。',{exact:true}).waitFor({timeout:20000});
 const result=await reader.request.get(base+'/api/spaces/personal/works/work_library/authoring',{headers:{Authorization:'Bearer fixture-reader_1'}});assert.equal(result.status(),403);
 const counts=await (await reader.request.get(base+'/fixture/status')).json();assert.equal(counts.publicWrites,0);assert.equal(counts.personalWrites,0);assert.equal(counts.participantProject,false);
 await owner.locator('summary').filter({hasText:'終了した招待'}).click();
 await owner.getByRole('button',{name:'終了した招待を一覧から整理'}).click();
 await owner.waitForFunction(()=>!document.querySelector('dialog details'));
 await reader.goto(base+'/scripts/fixtures/personal-sharing-ui.html?actor=reader');
 await reader.locator('summary').filter({hasText:'終了した招待'}).click();await reader.getByRole('button',{name:'終了した招待を一覧から整理'}).click();
 await reader.waitForFunction(()=>!document.querySelector('.personal-sharing-inbox details'));
 if(process.env.PERSONAL_READINESS_URL){
  const diagnosis=await ctx.newPage();diagnosis.on('pageerror',e=>errors.push(e.message));
  await diagnosis.goto(process.env.PERSONAL_READINESS_URL+'/scripts/fixtures/personal-sharing-ui.html?actor=owner');
  await diagnosis.getByRole('button',{name:'共有',exact:true}).click();await diagnosis.getByRole('heading',{name:'共有前の確認'}).waitFor();
  assert.equal(await diagnosis.getByRole('button',{name:'閲覧のみで招待する'}).count(),0);
  await diagnosis.getByText('この確認では原稿・画像・公開状態を変更していません。',{exact:true}).waitFor();
  assert((await diagnosis.getByRole('heading',{name:'共有前の確認'}).boundingBox()).width>200);
  await diagnosis.screenshot({path:'outputs/personal-sharing-readiness.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS UI invite, accept, real Studio read-only, revoke, no public or personal writes');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
