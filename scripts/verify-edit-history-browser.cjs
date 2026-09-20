const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-experimental-web-platform-features']});try{
 const p=await browser.newPage({viewport:{width:1400,height:960}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto((process.env.DSF_TEST_ORIGIN || 'http://127.0.0.1:5178') + '/studio?room=editor');await p.waitForFunction(()=>document.querySelector('[data-ai-status]')?.textContent==='オフ');
 await p.evaluate(async()=>{
  const app=await(await fetch('/js/app.js')).text(),path=app.match(/from ["']([^"']*state\.js[^"']*)["']/)[1];
  const m=await import(new URL(path,location.origin+'/js/app.js').href);window.historyTestState=m;
  const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
  const group=createFlowGroupBlock({id:'history-test-flow',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{ja:'海辺の灯台。灯台の光。','en-GB':'Lighthouse by the sea.'}}]}]}});
  const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;const paint=canvas.getContext('2d');paint.fillStyle='#28798e';paint.fillRect(0,0,90,160);const art=URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve,'image/webp')));
  const fixed={id:'history-test-image',kind:'page',content:{pageKind:'image',background:art,thumbnail:art,backgrounds:{ja:art},bubbles:[],graphicObjects:[]}};
  const {extractSectionsFromBlocks}=await import('/js/blocks.js'),{blocksToPages}=await import('/js/pages.js');
  m.dispatch({type:m.actionTypes.LOAD_PROJECT,payload:{blocks:[group,fixed],version:6,languages:['ja','en-GB'],defaultLang:'ja',activeLang:'ja',activeBlockIdx:0,projectId:null,localProjectId:'history-synthetic-only',projectAssets:[],sections:extractSectionsFromBlocks([group,fixed]),pages:blocksToPages([group,fixed]),bookMode:'none',book:{mode:'none'}}});
  window.changeFlowGeneratedPage(0,0);
  window.historyTestCall=async(name,args)=>{const api=document.modelContext,tool=(await api.getTools()).find(t=>t.name===name);if(!tool)throw Error('Missing '+name);const raw=await api.executeTool(tool,JSON.stringify(args));return typeof raw==='string'?JSON.parse(raw):raw;};
 });
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();
 await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();
 await p.locator('[data-auth-dropdown].open [data-ai-read]').check();
 await p.locator('[data-auth-dropdown].open [data-ai-access]').selectOption('edit');
 await p.waitForFunction(async()=> (await document.modelContext.getTools()).some(t=>t.name==='dsf_apply_history_step'));
 await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();
 const ready=()=>p.waitForFunction(async()=>!(await historyTestCall('dsf_get_editor_context',{})).busy);
 await ready();
 const result=await p.evaluate(async()=>{
  const ctx=await historyTestCall('dsf_get_editor_context',{});window.historyTestToken=ctx.workToken;
  const read=await historyTestCall('dsf_read_flow_paragraph',{workToken:ctx.workToken,groupId:'history-test-flow',sectionId:'s',blockId:'p',languageKey:'ja'});
  const edit=await historyTestCall('dsf_replace_flow_paragraph',{workToken:ctx.workToken,editToken:read.editToken,text:'海辺の灯台。灯台の明かり。'});return {read,edit};
 });assert.equal(result.edit.changed,true,JSON.stringify(result));assert.equal(result.edit.persistence.cloudCurrent,false);assert.match(result.edit.saveCheck,/editor update only/);await ready();
 await p.locator('[data-edit-history]').filter({visible:true}).first().click();
 const panel=p.locator('#edit-history-panel');await panel.waitFor();
 await panel.locator('.history-list button').first().click();
 assert.match(await panel.innerText(),/AI/);assert.match(await panel.innerText(),/灯台の光/);assert.match(await panel.innerText(),/灯台の明かり/);
 await panel.getByRole('button',{name:/^元に戻す/}).click();await ready();
 assert.equal(await p.evaluate(()=>historyTestState.state.blocks[0].flow.document.sections[0].blocks[0].texts.ja),'海辺の灯台。灯台の光。');
 await panel.getByRole('button',{name:/^やり直す/}).click();await ready();
 const cycle=await p.evaluate(async()=>{
  const base={workToken:historyTestToken};let list=await historyTestCall('dsf_list_edit_history',base);
  const prepared=await historyTestCall('dsf_prepare_history_step',{...base,direction:'undo',entryId:list.nextUndoId});
  const changed=await historyTestCall('dsf_apply_history_step',{...base,historyToken:prepared.historyToken});return {list,prepared,changed};
 });assert.equal(cycle.changed.changed,true,JSON.stringify(cycle));await ready();
 const redone=await p.evaluate(async()=>{const base={workToken:historyTestToken},list=await historyTestCall('dsf_list_edit_history',base),plan=await historyTestCall('dsf_prepare_history_step',{...base,direction:'redo',entryId:list.nextRedoId});return historyTestCall('dsf_apply_history_step',{...base,historyToken:plan.historyToken});});assert.equal(redone.changed,true);await ready();
 const retry=await p.evaluate(()=>historyTestCall('dsf_apply_history_step',{workToken:historyTestToken,historyToken:''+''}));assert.equal(retry.error.code,'INVALID_ARGUMENTS');
 const deletion=await p.evaluate(async()=>{
  const base={workToken:historyTestToken};const prepared=await historyTestCall('dsf_prepare_page_deletion',{...base,unitId:'history-test-image'});
  const changed=await historyTestCall('dsf_apply_page_change',{...base,pageChangeToken:prepared.pageChangeToken});return {prepared,changed};
 });assert.equal(deletion.changed.changed,true,JSON.stringify(deletion));await ready();
 assert.equal(await p.evaluate(()=>historyTestState.state.blocks.some(b=>b.id==='history-test-image')),false);
 await panel.getByRole('button',{name:/^元に戻す/}).click();await ready();
 assert.equal(await p.evaluate(()=>historyTestState.state.blocks.some(b=>b.id==='history-test-image')),true);
 await panel.locator('.history-list button').first().click();
 assert.equal(await panel.locator('.history-images img').count(),1);
 await p.evaluate(()=>window.setStudioUILang('en'));assert.match(await panel.innerText(),/Edit history/);assert.match(await panel.innerText(),/Undone/);
 await p.screenshot({path:process.env.TEMP+'/dsf-edit-history-desktop.png'});
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:process.env.TEMP+'/dsf-edit-history-mobile.png'});
 assert.equal(await panel.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
 await panel.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await panel.isVisible(),false);
 assert.deepEqual(errors,[]);console.log('Native Chrome + real Studio: AI text edit, history diff/origin, panel Undo/Redo, WebMCP Undo, fixed-page delete/restore, English/mobile and no runtime errors passed.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
