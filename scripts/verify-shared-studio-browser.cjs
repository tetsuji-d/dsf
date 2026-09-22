const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.SHARED_STUDIO_URL||'http://127.0.0.1:5210';
const route=base+'/studio.html?room=editor&sharedSpace=space_demo&sharedWork=work_library';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>d.dismiss());
  await page.addInitScript(()=>{
   localStorage.setItem('dsf_studio_ai_access_v1',JSON.stringify({enabled:true,access:'edit'}));
   const tools=new Map();window.fixtureTools=tools;
   Object.defineProperty(document,'modelContext',{value:{registerTool(tool,{signal}){tools.set(tool.name,tool);signal.addEventListener('abort',()=>{if(tools.get(tool.name)===tool)tools.delete(tool.name)});}}});
  });
  const until=async(fn)=>{const deadline=Date.now()+30000;while(!await fn()){if(Date.now()>deadline)throw Error('Timed out waiting for async condition');await page.waitForTimeout(50);}};
  const state=()=>page.evaluate(async()=>JSON.parse(JSON.stringify(window.fixtureStudio.state)));
  const saved=()=>until(()=>page.evaluate(async()=> window.fixtureStudio.persistence.getEditorSaveStatus().cloudCurrent));
  const open=async()=>{await page.goto(route);await page.locator('[data-shared-lock-action=acquire]').click();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');await page.locator('[data-testid=flow-paragraph-input]').waitFor();};
  await page.request.post(base+'/fixture/role',{data:{role:'editor'}});
  await open();
  assert.equal((await state()).uid,'reader_1');assert.equal((await state()).projectId,'book_library');
  const input=page.locator('[data-testid=flow-paragraph-input]'),original=await input.inputValue(),edited=original+' 新しい共有編集。';
  await input.fill(edited);await input.blur();await page.locator('#btn-save').click();await saved();
  await page.locator('#btn-undo').click();await saved();assert.equal(await input.inputValue(),original);
  await page.locator('#btn-redo').click();await saved();assert.equal(await input.inputValue(),edited);
  await page.locator('[data-shared-lock-action=release]').click();await page.locator('[data-shared-lock-action=acquire]').waitFor();await page.reload();await page.locator('[data-shared-lock-action=acquire]').click();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');await input.waitFor();assert.equal(await input.inputValue(),edited);
  // Real paste event -> same importer, canvas WebP encoding and private image path.
  await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=40;canvas.height=60;canvas.getContext('2d').fillRect(0,0,40,60);
   const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'clipboard.png',{type:'image/png'}));
   document.querySelector('#canvas-view').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  });
  await until(()=>page.evaluate(async()=> window.fixtureStudio.state.blocks.some(b=>b.kind==='page'&&b.content.background?.startsWith('blob:'))));
  await page.locator('#btn-save').click();await saved();const beforeImageReload=await state();
  assert.equal(beforeImageReload.blocks.find(b=>b.kind==='flow').flow.document.sections[0].blocks[0].texts.ja,edited);
  await page.locator('[data-shared-lock-action=release]').click();await page.locator('[data-shared-lock-action=acquire]').waitFor();await page.reload();await page.locator('[data-shared-lock-action=acquire]').click();await page.waitForFunction(()=>document.body.dataset.sharedStudio==='editing');
  await until(()=>page.evaluate(async()=> window.fixtureStudio.state.blocks.some(b=>b.kind==='page'&&b.content.background?.startsWith('blob:'))));
  const evidence=await page.evaluate(async()=>{
   const s=window.fixtureStudio.state,f=window.fixtureStudio.persistence;
   const image=s.blocks.find(b=>b.kind==='page').content.background,blob=await(await fetch(image)).blob();
   return {type:blob.type,size:blob.size,backup:await window.fixtureStudio.getBackup(),localRecent:await f.listLocalRecentProjects()};
  });
  assert.equal(evidence.type,'image/webp');assert(evidence.size>0);assert.equal(evidence.backup,undefined);assert.deepEqual(evidence.localRecent,[]);
  // Stale AI handles cannot write after a permission downgrade.
  await page.waitForFunction(()=>window.fixtureTools.has('dsf_replace_flow_paragraph'));
  await page.evaluate(()=>{window.fixtureOldWrite=window.fixtureTools.get('dsf_replace_flow_paragraph')});
  await page.request.post(base+'/fixture/role',{data:{role:'viewer'}});
  await page.evaluate(async()=>{await window.fixtureStudio.persistence.checkSharedStudioAccess()});
  await page.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
  assert.match(await page.locator('#shared-studio-status').textContent(),/閲覧のみ/);
  const readonlyBefore=JSON.stringify((await state()).blocks);
  const denial=await page.evaluate(async()=>{
   const f=window.fixtureStudio.persistence,h=window.fixtureStudio.history,s=window.fixtureStudio;const result={undo:h.undo(()=>{}),redo:h.redo(()=>{})};
   for(const [key,fn] of [['save',()=>f.flushSave()],['image',()=>f.prepareAuthoringImage(new Blob())],['dispatch',()=>s.dispatch({type:s.actionTypes.SET_TITLE,payload:'forbidden'})],['ai',()=>window.fixtureOldWrite.execute({})]])try{await fn();result[key]='allowed'}catch(e){result[key]=e.code||e.message}
   return result;
  });
  assert.equal(denial.undo,false);assert.equal(denial.redo,false);for(const key of ['save','image','dispatch'])assert.equal(denial[key],'EDIT_FORBIDDEN');assert.notEqual(denial.ai,'allowed');
  assert.equal(JSON.stringify((await state()).blocks),readonlyBefore);
  assert(!await page.evaluate(()=>window.fixtureTools.has('dsf_replace_flow_paragraph')));
  // Viewer can still navigate the page strip and change zoom.
  await page.locator('#canvas-zoom-select').selectOption('50');
  await page.locator('#btn-page-next').click({force:true});
  await page.screenshot({path:'outputs/shared-studio-readonly.png'});
  await page.request.post(base+'/fixture/role',{data:{role:'revoked'}});
  await page.evaluate(async()=>{try{await window.fixtureStudio.persistence.checkSharedStudioAccess()}catch{}});
  await page.waitForFunction(()=>document.querySelector('#shared-studio-status').textContent.includes('閲覧権限'));
  assert.deepEqual((await state()).blocks,[]);assert.deepEqual((await state()).projectAssets,[]);
  assert.equal(await page.evaluate(()=>window.fixtureTools.size),0);
  // Clean viewer account + narrow viewport.
  const mobile=await browser.newPage({viewport:{width:390,height:844}});mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(route+'&actor=viewer');await mobile.waitForFunction(()=>document.body.dataset.sharedStudio==='readonly');
  assert.equal(await mobile.locator('#flow-authoring-surface').getAttribute('inert'),'');
  await mobile.screenshot({path:'outputs/shared-studio-mobile.png'});
  await mobile.evaluate(()=>window.fixtureStudio.dispatch({type:window.fixtureStudio.actionTypes.SET_AUTH_STATE,payload:{uid:null,user:null}}));
  assert.equal(await mobile.evaluate(()=>window.fixtureStudio.state.blocks.length),0);
  assert.equal(await mobile.evaluate(()=>window.fixtureStudio.history.getHistoryInfo().canUndo),false);
  await mobile.close();
  const stats=await(await page.request.get(base+'/fixture/status')).json();assert.equal(stats.publicWrites,0);assert.equal(stats.personalWrites,0);assert.equal(stats.participantProject,false);assert.deepEqual(errors,[]);
  await page.request.post(base+'/fixture/role',{data:{role:'editor'}});
  console.log('Shared real Studio passed: Flow edit/save/reload, Undo/Redo, PNG paste to private WebP, private-only persistence, read-only UI, stale AI denial, revocation cleanup, mobile reading. No public or participant-owned writes.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
