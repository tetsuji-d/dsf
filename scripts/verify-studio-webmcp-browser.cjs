const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await browser.newPage({viewport:{width:1400,height:960}}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5178/studio?room=editor');
 await p.waitForFunction(()=>document.querySelector('[data-ai-status]')?.textContent!=='');
 const native=await p.evaluate(()=>typeof document.modelContext?.registerTool==='function');
 if(!native){assert.equal(await p.locator('[data-studio-ai] [data-ai-read]').first().isDisabled(),true);assert.match(await p.locator('[data-ai-status]').first().innerText(),/非対応|Unavailable/);}
 // Injected registry tests the real profile and application reader, not native compatibility.
 await p.addInitScript(()=>{
  const registry=new Map();window.testTools=registry;window.testMode='ok';window.testSaved=[];
  Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool:async(tool,{signal})=>{
   if(window.testMode==='fail'&&tool.name==='dsf_search_flow_text')throw Error('synthetic failure');
   registry.set(tool.name,tool);window.testSaved.push(tool);
   signal.addEventListener('abort',()=>{if(registry.get(tool.name)===tool)registry.delete(tool.name);},{once:true});
  }}});
 });
 await p.reload();await p.waitForFunction(()=>window.setStudioUILang&&document.querySelector('[data-ai-status]')?.textContent==='オフ');
 await p.evaluate(async()=>{
  const appSource=await (await fetch('/js/app.js')).text();
  const statePath=appSource.match(/from ["']([^"']*state\.js[^"']*)["']/)[1];
  window.testStateModule=await import(new URL(statePath,location.origin+'/js/app.js').href);
  const {state,dispatch,actionTypes}=window.testStateModule;
  const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
  const g=createFlowGroupBlock({id:'test-flow',sourceLanguage:'en-GB',writingMode:'horizontal-tb',document:{sourceLanguage:'en-GB',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{'en-GB':'Original sea. Original sea.',ja:'翻訳の海。'}}]}]}});
  dispatch({type:actionTypes.LOAD_PROJECT,payload:{blocks:[g],version:6,languages:['en-GB','ja'],defaultLang:'en-GB',activeLang:'en-GB',activeBlockIdx:0,projectId:null,localProjectId:'webmcp-synthetic',projectAssets:[],sections:[],pages:[],bookMode:'none',book:{mode:'none'}}});
  window.testState=state;window.changeFlowGeneratedPage(0,0);
 });
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor().catch(async e=>{console.log('DIAGNOSTICS',errors,await p.locator('body').innerText());throw e;});
 const before=await p.evaluate(()=>JSON.stringify(window.testState.blocks));
 const openProfile=async()=>{if(!await p.locator('[data-auth-dropdown].open').count())await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();};
 const toggle=()=>p.locator('[data-auth-dropdown].open [data-studio-ai] [data-ai-read]');
 await openProfile();await toggle().check();await p.waitForFunction(()=>document.querySelector('[data-ai-status]').textContent==='ツール提供中');
 assert.equal(await p.evaluate(()=>window.testTools.size),2);
 const output=await p.evaluate(async()=>{const context=await testTools.get('dsf_get_editor_context').execute({});const result=await testTools.get('dsf_search_flow_text').execute({workToken:context.workToken,query:'sea',languageKey:'en-GB',scope:'currentFlow'});return {context,result};});
 assert.equal(output.context.sourceLanguage,'en-GB');assert.equal(output.result.matches.length,2);
 assert.ok(!JSON.stringify(output).includes('expectedText'));
 await p.evaluate(()=>window.setStudioUILang('en'));await openProfile();assert.equal(await p.locator('[data-ai-title]').first().innerText(),'AI tools (read-only)');
 await toggle().uncheck();assert.equal(await p.evaluate(()=>testTools.size),0);
 assert.equal(await p.evaluate(async()=>{try{await testSaved[0].execute({});return 'bad'}catch(e){return e.message}}),'DSF_DISABLED');
 // Partial failure cleans the first registration. Other owners are preserved.
 await p.evaluate(()=>{testTools.set('other_owner',{});testMode='fail';});await toggle().click();await p.waitForFunction(()=>document.querySelector('[data-ai-status]').textContent.startsWith('Registration failed'));
 assert.deepEqual(await p.evaluate(()=>[...testTools.keys()]),['other_owner']);
 await p.evaluate(()=>testMode='ok');await toggle().check();await p.waitForFunction(()=>testTools.has('dsf_search_flow_text'));
 await p.evaluate(()=>window.switchRoom('home'));assert.equal(await p.evaluate(()=>testTools.has('dsf_get_editor_context')),false);
 await p.evaluate(()=>window.switchRoom('editor'));await openProfile();assert.equal(await toggle().isChecked(),false);
 await toggle().check();await p.waitForFunction(()=>testTools.has('dsf_search_flow_text'));
 await p.evaluate(async()=>{const m=window.testStateModule;m.dispatch({type:m.actionTypes.LOAD_PROJECT,payload:{blocks:m.state.blocks}});});
 assert.equal(await p.evaluate(()=>testTools.has('dsf_get_editor_context')),false);
 await toggle().check();await p.waitForFunction(()=>testTools.has('dsf_search_flow_text'));
 await p.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.equal(await p.evaluate(()=>testTools.has('dsf_get_editor_context')),false);
 assert.equal(await p.evaluate(()=>JSON.stringify(window.testState.blocks)),before);
 await p.setViewportSize({width:390,height:844});await openProfile();const box=await p.locator('[data-auth-dropdown].open [data-studio-ai]').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=390);
 await p.screenshot({path:require('node:os').tmpdir()+'/dsf-webmcp-profile.png'});
 assert.deepEqual(errors,[]);
 // Controller race: completing an old registration after disable must not re-enable.
 const race=await p.evaluate(async()=>{
  const {createStudioWebMCP}=await import('/js/studio-webmcp.js');
  let finish;const registered=new Map();let slow=true;
  const api={registerTool(tool,{signal}){registered.set(tool.name,tool);signal.addEventListener('abort',()=>{if(registered.get(tool.name)===tool)registered.delete(tool.name);});return slow?new Promise(r=>{finish=r;}):Promise.resolve();}};
  const c=createStudioWebMCP({readState:()=>({room:'editor',workIdentity:'test',blocks:[],languageKeys:['ja']}),getModelContext:()=>api});
  const first=c.enable();c.disable();slow=false;await c.enable();finish();await first;
  const on=c.getStatus(),count=registered.size;c.disable();return {on,count,after:registered.size};
 });assert.deepEqual(race,{on:'on',count:2,after:0});
 console.log('WebMCP browser checks passed: default support='+native+'; injected registry: JA/EN profile, English original search, read-only, abort, partial failure, other tools, room exit, reload same work, pagehide, mobile and registration race.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
