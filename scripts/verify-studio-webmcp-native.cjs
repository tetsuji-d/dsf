const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-experimental-web-platform-features']});try{
 const p=await browser.newPage({viewport:{width:1400,height:960}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>document.querySelector('[data-ai-status]')?.textContent==='オフ');
 assert.equal(await p.evaluate(()=>typeof document.modelContext?.registerTool),'function');
 await p.evaluate(async()=>{
  const appSource=await(await fetch('/js/app.js')).text();const path=appSource.match(/from ["']([^"']*state\.js[^"']*)["']/)[1];
  const m=await import(new URL(path,location.origin+'/js/app.js').href);window.nativeState=m;
  const {createFlowGroupBlock}=await import('/js/flow-project-model.js');
  const group=createFlowGroupBlock({id:'native-test',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{ja:'海辺の灯台。灯台の光。','en-GB':'Lighthouse by the sea.'}}]}]}});
  m.dispatch({type:m.actionTypes.LOAD_PROJECT,payload:{blocks:[group],version:6,languages:['ja','en-GB'],defaultLang:'ja',activeLang:'ja',activeBlockIdx:0,projectId:null,localProjectId:'native-synthetic',projectAssets:[],sections:[],pages:[],bookMode:'none',book:{mode:'none'}}});
  window.changeFlowGeneratedPage(0,0);
 });
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();
 const before=await p.evaluate(()=>JSON.stringify(nativeState.state.blocks));
 await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();const toggle=p.locator('[data-auth-dropdown].open [data-studio-ai] [data-ai-read]');
 await toggle.check();await p.waitForFunction(()=>document.querySelector('[data-ai-status]').textContent==='ツール提供中');
 const result=await p.evaluate(async()=>{
  const api=document.modelContext,tools=await api.getTools();const mine=tools.filter(t=>t.name.startsWith('dsf_'));
  // Chrome 153 uses JSON strings for caller arguments/results. This is the
  // test caller, not DSF's registered execute callback (which receives an object).
  window.callNative = async (tool,args) => {
   const raw=await api.executeTool(tool,JSON.stringify(args));return typeof raw==='string'?JSON.parse(raw):raw;
  };
  const context=await callNative(mine.find(t=>t.name==='dsf_get_editor_context'),{});
  const search=await callNative(mine.find(t=>t.name==='dsf_search_flow_text'),{workToken:context.workToken,query:'灯台',languageKey:'ja',scope:'work'});
  window.nativeOldTool=mine[0];return {names:mine.map(t=>t.name),context,search};
 });
 assert.equal(result.names.length,3);assert.equal(result.context.target.groupId,'native-test');assert.equal(result.search.matches.length,2);
 const invalidIndex=await p.evaluate(async()=>{const previous=nativeState.state.activeBlockIdx;nativeState.state.activeBlockIdx=-1;try{const tool=(await document.modelContext.getTools()).find(t=>t.name==='dsf_get_editor_context');const value=await callNative(tool,{});return {target:value.target,index:nativeState.state.activeBlockIdx};}finally{nativeState.state.activeBlockIdx=previous;}});
 assert.deepEqual(invalidIndex,{target:null,index:-1});
 // The UI search selects actual text; context reports only verified source offsets.
 await p.keyboard.press('Escape');await p.keyboard.press('Control+f');const bar=p.locator('#flow-search-bar');await bar.getByRole('searchbox').fill('灯台');
 await p.waitForFunction(()=>document.querySelector('#flow-search-bar [role=status]').textContent==='0 / 2');
 await bar.getByRole('button',{name:/次|Next/}).click();
 await p.waitForFunction(()=>{const e=document.querySelector('.flow-direct-input-proxy');return e&&e.value.slice(e.selectionStart,e.selectionEnd)==='灯台'});
 const selected=await p.evaluate(async()=>{const api=document.modelContext;const tool=(await api.getTools()).find(t=>t.name==='dsf_get_editor_context');return callNative(tool,{});});
 assert.equal(selected.selection.ranges[0].end-selected.selection.ranges[0].start,2);
 assert.equal('text' in selected.selection,false);
 await p.keyboard.press('Escape');if(!await p.locator('[data-auth-dropdown].open').count())await p.locator('[data-auth-trigger]').filter({visible:true}).first().click();
 await toggle.uncheck();
 assert.equal(await p.evaluate(async()=>(await document.modelContext.getTools()).filter(t=>t.name.startsWith('dsf_')).length),0);
 const old=await p.evaluate(async()=>{try{await callNative(nativeOldTool,{});return false}catch{return true}});assert.equal(old,true);
 assert.equal(await p.evaluate(()=>JSON.stringify(nativeState.state.blocks)),before);assert.deepEqual(errors,[]);
 await p.screenshot({path:require('node:os').tmpdir()+'/dsf-webmcp-native.png'});
 console.log('Native Chrome WebMCP passed: profile enable, getTools, executeTool context/search, real editor selection, abort/unregister, old-tool rejection and unchanged manuscript. This is browser API verification, not an external AI-client test.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
