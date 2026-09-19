const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
for(const language of ['ja','en-GB']){
 const p=await b.newPage({viewport:{width:1440,height:950}});await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeFlowGeneratedPage&&!document.body.hasAttribute('data-booting'));
 await p.evaluate(async language=>{const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js');
 const g=createFlowGroupBlock({id:'assist',sourceLanguage:language,writingMode:language==='ja'?'vertical-rl':'horizontal-tb',document:{sourceLanguage:language,sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{[language]:language==='ja'?'灯台と海辺の約束。朝の光が窓から差し込んだ。'.repeat(200):'The quiet harbour welcomed the morning light. We read the letter once again. '.repeat(120)}}]}]}});
 if(language==='ja'){g.flow.document.schemaVersion=2;g.flow.document.sections[0].blocks[0].annotations={ja:[{id:'r',type:'ruby',start:0,end:2,reading:'とうだい'},{id:'e',type:'emphasis',start:3,end:5,mark:'sesame'}]};}
 Object.assign(state,{blocks:[g],version:6,sections:[],pages:[],projectAssets:[],projectId:null,localProjectId:'reader-assist-test',activeLang:language,defaultLang:language,languages:[language],languageConfigs:{[language]:{pageDirection:language==='ja'?'rtl':'ltr'}},activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,bookMode:'none',book:{mode:'none'}});window.assistTestState=state;window.changeFlowGeneratedPage(0,0);},language);
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();const snapshot=await p.evaluate(()=>JSON.stringify(window.assistTestState.blocks));
 const pending=p.waitForEvent('popup');await p.locator('#btn-editor-preview').click();const v=await pending;const errors=[];v.on('pageerror',e=>errors.push(e.message));await v.locator('#viewer-stage [data-reading-line]').first().waitFor();

 await v.setViewportSize({width:390,height:844});await v.waitForTimeout(250);
 const next=language==='ja'?'viewerNavLeft':'viewerNavRight',prev=language==='ja'?'viewerNavRight':'viewerNavLeft';
 const index=()=>v.locator('#page-slider').inputValue();const firstIndex=await index();
 await v.evaluate(next=>window[next](),next);await v.locator('.viewer-page-curl').waitFor();
 assert.equal(await index(),firstIndex,'Index stays unchanged until animation commits');
 await v.waitForTimeout(150);await v.screenshot({path:require('node:os').tmpdir()+`/viewer-curl-${language}.png`});
 await v.locator('.viewer-page-curl').waitFor({state:'detached'});assert.notEqual(await index(),firstIndex);
 await v.evaluate(prev=>window[prev](),prev);await v.waitForTimeout(550);assert.equal(await index(),firstIndex);
 // Start/cancel and commit the same edge drag with touch events.
 const cdp=await v.context().newCDPSession(v);const r=await v.locator('#viewer-canvas').boundingBox();
 const x=language==='ja'?r.x+8:r.x+r.width-8,y=r.y+r.height*.5,sign=language==='ja'?1:-1;
 async function drag(distance){await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+sign*distance,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await v.waitForTimeout(550);}
 await drag(35);assert.equal(await index(),firstIndex,'Cancelled drag must not navigate');await v.waitForTimeout(500);
 await drag(r.width*.65);assert.notEqual(await index(),firstIndex,'Drag past threshold commits');await v.waitForTimeout(950);
 await v.emulateMedia({reducedMotion:'reduce'});await v.evaluate(prev=>window[prev](),prev);assert.equal(await v.locator('.viewer-page-curl').count(),0);assert.equal(await index(),firstIndex);
 await v.emulateMedia({reducedMotion:'no-preference'});
 await v.evaluate(()=>window.toggleViewerSpread());await v.waitForTimeout(200);
 const spreadBefore=await index();await v.evaluate(next=>window[next](),next);await v.locator('.viewer-page-curl').waitFor();await v.waitForTimeout(550);assert.notEqual(await index(),spreadBefore);
 await v.evaluate(prev=>window[prev](),prev);await v.waitForTimeout(550);assert.equal(await index(),spreadBefore);
 assert.equal(await p.evaluate(()=>JSON.stringify(window.assistTestState.blocks)),snapshot);assert.deepEqual(errors,[]);
 await v.close();await p.close();console.log(language,'button/touch commit/cancel/reduced motion/data preservation passed');
}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
