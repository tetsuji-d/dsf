const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
for(const language of ['ja','en-GB']){
 const p=await b.newPage({viewport:{width:1440,height:950}});await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeFlowGeneratedPage&&!document.body.hasAttribute('data-booting'));
 await p.evaluate(async language=>{const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js');
 const g=createFlowGroupBlock({id:'assist',sourceLanguage:language,writingMode:language==='ja'?'vertical-rl':'horizontal-tb',document:{sourceLanguage:language,sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{[language]:language==='ja'?'灯台と海辺の約束。朝の光が窓から差し込んだ。'.repeat(35):'The quiet harbour welcomed the morning light. We read the letter once again. '.repeat(20)}}]}]}});
 if(language==='ja'){g.flow.document.schemaVersion=2;g.flow.document.sections[0].blocks[0].annotations={ja:[{id:'r',type:'ruby',start:0,end:2,reading:'とうだい'},{id:'e',type:'emphasis',start:3,end:5,mark:'sesame'}]};}
 Object.assign(state,{blocks:[g],version:6,sections:[],pages:[],projectAssets:[],projectId:null,localProjectId:'reader-assist-test',activeLang:language,defaultLang:language,languages:[language],languageConfigs:{[language]:{pageDirection:language==='ja'?'rtl':'ltr'}},activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,bookMode:'none',book:{mode:'none'}});window.assistTestState=state;window.changeFlowGeneratedPage(0,0);},language);
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();const snapshot=await p.evaluate(()=>JSON.stringify(window.assistTestState.blocks));
 const pending=p.waitForEvent('popup');await p.locator('#btn-editor-preview').click();const v=await pending;const errors=[];v.on('pageerror',e=>errors.push(e.message));await v.locator('#viewer-stage [data-reading-line]').first().waitFor();
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-enabled').check();await v.locator('#reading-guide-mode').selectOption('focus');
 const first=v.locator('#viewer-stage [data-reading-line]').nth(language==='ja'?0:2);await v.waitForTimeout(150);let r=await first.boundingBox();await v.mouse.click(r.x+r.width/2,r.y+r.height*.3);
 await v.locator('#viewer-stage .reader-line-focused').first().waitFor();assert.ok(await v.locator('#viewer-stage .reader-line-muted').count()>0);
 const styles=await first.getAttribute('style');if(language==='ja'){assert.ok(await v.locator('#viewer-stage [data-reading-annotation=ruby].reader-line-focused').count()>0);assert.ok(await v.locator('#viewer-stage [data-reading-annotation=emphasis].reader-line-focused').count()>0);}
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-mode').selectOption('lens');await v.locator('#reader-assist-lens .viewer-fixed-text-page').waitFor();
 assert.equal(await v.locator('#viewer-stage .reader-line-muted').count(),0);assert.equal(await first.getAttribute('style'),styles);
 assert.equal(await v.locator('#reader-assist-lens [data-reading-line]').count(),1);if(language==='ja')assert.ok(await v.locator('#reader-assist-lens [data-reading-annotation=ruby]').count()>0);
 const z=await v.locator('#reader-assist-lens .viewer-fixed-text-page').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);await v.locator('#reading-guide-zoom').selectOption('3');
 assert.ok(Math.abs((await v.locator('#reader-assist-lens .viewer-fixed-text-page').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a))/z-1.5)<.01);
 await v.locator('#reading-guide-zoom').selectOption('2');
 let prev=await v.locator('#reader-assist-prev').boundingBox(),next=await v.locator('#reader-assist-next').boundingBox();assert.ok(language==='ja'?next.x<prev.x:prev.y<next.y);
 await v.locator('#reader-assist-next').click();assert.match(await v.locator('#reader-assist-status').innerText(),language==='ja'?/^2 \/ /:/^4 \/ /);await v.locator('#reader-assist-prev').click();
 await v.screenshot({path:require('node:os').tmpdir()+`/viewer-assist-${language}.png`});
 await v.setViewportSize({width:390,height:844});await v.waitForTimeout(200);r=await first.boundingBox();
 const cdp=await v.context().newCDPSession(v);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width/2,y:r.y+Math.min(90,r.height-2)}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(await v.locator('#reader-assist-lens .viewer-fixed-text-page').count());const dock=await v.locator('#reader-assist-panel').boundingBox();assert.ok(dock.x>=0&&dock.x+dock.width<=390&&dock.y+dock.height<=844);
 await v.screenshot({path:require('node:os').tmpdir()+`/viewer-assist-mobile-${language}.png`});
 // Paging must discard the old line and lens, and remain available in assistance mode.
 await v.waitForTimeout(950);await first.evaluate(e=>window.previousAssistLine=e);
 await v.locator(language==='ja'?'#viewer-nav-left':'#viewer-nav-right').click();
 await v.waitForFunction(()=>!document.querySelector('#viewer-stage').contains(window.previousAssistLine));
 await v.waitForFunction(()=>!document.querySelector('#reader-assist-lens .viewer-fixed-text-page'));
 await first.evaluate(e=>window.previousAssistLine=e);await v.locator(language==='ja'?'#viewer-nav-right':'#viewer-nav-left').click();await v.waitForFunction(()=>!document.querySelector('#viewer-stage').contains(window.previousAssistLine));await first.waitFor();await v.waitForTimeout(250);
 r=await first.boundingBox();await v.mouse.click(r.x+r.width/2,r.y+r.height*.3);
 await v.locator('#reader-assist-lens .viewer-fixed-text-page').waitFor();
 // Two-finger pinch retains Viewer zoom; a subsequent drag pans the zoomed page.
 const stage=v.locator('#viewer-stage');const beforePinch=await stage.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);
 const box=await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:cx-25,y:cy},{id:2,x:cx+25,y:cy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:cx-50,y:cy},{id:2,x:cx+50,y:cy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await v.waitForTimeout(120);
 assert.ok(await stage.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)>beforePinch*1.4);
 const beforePan=await stage.getAttribute('style');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-20,y:cy-20}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.notEqual(await stage.getAttribute('style'),beforePan);
 await v.emulateMedia({media:'print'});assert.equal(await v.locator('#reader-assist-panel').isVisible(),false);await v.emulateMedia({media:'screen'});
 assert.equal(await p.evaluate(()=>JSON.stringify(window.assistTestState.blocks)),snapshot);
 await v.locator('#reader-assist-close').click();assert.equal(await v.locator('body').getAttribute('data-reading-assist-dock'),'0');assert.equal(await v.locator('#viewer-stage .reader-line-muted').count(),0);assert.equal(await v.locator('#reader-assist-panel').isVisible(),false);
 assert.deepEqual(errors,[]);await v.close();await p.close();console.log(language,'focus/annotations/lens/zoom/line navigation/touch/mobile/paging/pinch/pan/print/disable and unchanged authoring passed');
}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
