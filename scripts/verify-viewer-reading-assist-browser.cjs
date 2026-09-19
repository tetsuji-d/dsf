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
 const pageRectBefore=await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox();
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-enabled').check();await v.locator('#reading-guide-mode').selectOption('focus');
 const first=v.locator('#viewer-stage [data-reading-line]').nth(language==='ja'?0:2);await v.waitForTimeout(150);let r=await first.boundingBox();await v.mouse.click(r.x+r.width/2,r.y+r.height*.3);
 await v.locator('#viewer-stage .reader-line-focused').first().waitFor();assert.ok(await v.locator('#viewer-stage .reader-line-muted').count()>0);
 assert.deepEqual(await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox(),pageRectBefore,'Focus must not shrink or move the page');
 const styles=await first.getAttribute('style');if(language==='ja'){assert.ok(await v.locator('#viewer-stage [data-reading-annotation=ruby].reader-line-focused').count()>0);assert.ok(await v.locator('#viewer-stage [data-reading-annotation=emphasis].reader-line-focused').count()>0);}
 if(language==='en-GB'){await v.setViewportSize({width:900,height:950});await v.waitForTimeout(180);}
 const ordinaryFrame=await v.locator('#viewer-canvas').boundingBox();
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-mode').selectOption('lens');await v.locator('#reader-assist-lens .viewer-fixed-text-page').waitFor();
 assert.deepEqual(await v.locator('#viewer-canvas').boundingBox(),ordinaryFrame,'Lens must not shrink or shift the original page');
 assert.equal(await v.locator('#viewer-stage').evaluate(e=>getComputedStyle(e).visibility),'visible');
 assert.equal(await v.locator('#viewer-stage .reader-line-muted').count(),0);assert.equal(await first.getAttribute('style'),styles);
 assert.equal(await v.locator('#reader-assist-lens [data-reading-line]').count(),1);if(language==='ja')assert.ok(await v.locator('#reader-assist-lens [data-reading-annotation=ruby]').count()>0);
 const z=await v.locator('#reader-assist-lens .viewer-fixed-text-page').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);await v.locator('#reading-guide-zoom').selectOption('3');
 assert.ok(Math.abs((await v.locator('#reader-assist-lens .viewer-fixed-text-page').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a))/z-1.5)<.01);
 // Drag the magnifier itself; check actual text movement, not just its presence.
 await v.locator('#viewer-reading-guide summary').click();
 const lens=v.locator('#reader-assist-lens'), lensPage=lens.locator('.viewer-fixed-text-page');
 let lr=await lens.boundingBox();const axis=language==='ja'?'f':'e';
 const offset=()=>lensPage.evaluate((e,axis)=>new DOMMatrix(getComputedStyle(e).transform)[axis],axis);
 const dragLens=async(distance)=>{lr=await lens.boundingBox();const x=lr.x+lr.width*.6,y=lr.y+lr.height*.6;await v.mouse.move(x,y);await v.mouse.down();await v.mouse.move(x-(language==='ja'?0:distance),y-(language==='ja'?distance:0),{steps:8});await v.mouse.up();};
 let start=await offset();await dragLens(60);assert.ok(await offset()<start-20,'Dragging inside the lens must advance text');
 start=await offset();await dragLens(-30);assert.ok(await offset()>start+10,'Reverse dragging must immediately move back');
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-zoom').selectOption('2');await v.locator('#viewer-reading-guide summary').click();

 // Continue advances a viewport first, then the next composed line.
 let prev=await v.locator('#reader-assist-prev').boundingBox(),next=await v.locator('#reader-assist-next').boundingBox();assert.ok(language==='ja'?next.x<prev.x:prev.y<next.y);
 const selectedText=()=>v.locator('#viewer-stage .reading-line-active').textContent();
 const originalText=await selectedText();let clicks=0;
 while(await selectedText()===originalText&&clicks++<30)await v.locator('#reader-assist-next').click();
 assert.notEqual(await selectedText(),originalText);await v.locator('#reader-assist-prev').click();assert.equal(await selectedText(),originalText);
 await v.evaluate(()=>window.toggleUi(false));assert.equal(await v.locator('#viewer-bottom-navigation').isVisible(),false,'Hidden chrome must also hide bottom navigation');
 await v.evaluate(()=>window.toggleUi(true));await v.locator('#reader-assist-next').click();
 await v.evaluate(()=>window.toggleUi(true));await v.locator('#reader-assist-prev').click();await v.waitForTimeout(5200);assert.equal(await v.locator('#viewer-ui').evaluate(e=>e.classList.contains('visible')),true);
 // Phone layout reserves an inert zone ABOVE the OS home indicator too.
 await v.setViewportSize({width:390,height:844});
 await v.evaluate(()=>document.documentElement.style.setProperty('--viewer-safe-bottom','34px'));
 await v.waitForTimeout(200);
 let footer=v.locator('#viewer-bottom-navigation');
 const checkFooter=async()=>{
   const fr=await footer.boundingBox();assert.ok(fr.y+fr.height<=845);
   for(const id of ['viewer-nav-left','viewer-nav-right','reader-assist-prev','reader-assist-next']){const r=await v.locator('#'+id).boundingBox();assert(r.height>=44);assert(r.y+r.height<=844-50+.5,'Home indicator + 16px must be inert');}
   const lr=await lens.boundingBox();assert(lr.y+lr.height<=fr.y+.5,'Footer must not cover magnified text '+JSON.stringify({lr,fr,info:await v.locator('#reader-assist-panel').evaluate(e=>({bottom:getComputedStyle(e).bottom,height:getComputedStyle(e).height,vars:document.body.style.cssText}))}));
 };
 await checkFooter();
 // Actual background taps hide and restore mobile chrome without resizing the page.
 const beforeChromeToggle=await v.locator('#viewer-canvas').boundingBox();
 await v.locator('#viewer-mobile-page-count').click();assert.equal(await footer.isVisible(),false);
 assert.equal(await footer.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 await v.mouse.click(2,2);assert.equal(await footer.isVisible(),true);
 assert.deepEqual(await v.locator('#viewer-canvas').boundingBox(),beforeChromeToggle);
 // Changing magnification resets to the first window without altering the page.
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-zoom').selectOption('1.5');await v.locator('#reading-guide-zoom').selectOption('2');await v.locator('#viewer-reading-guide summary').click();
 const textBefore=await selectedText(),tBefore=await offset();await v.locator('#reader-assist-next').click();
 assert.equal(await selectedText(),textBefore);assert.notEqual(await offset(),tBefore,'Continue must move the magnified viewport');
 await v.locator('#reader-assist-prev').click();assert.ok(Math.abs((await offset())-tBefore)<1,'Back restores the preceding window');
 const cdp=await v.context().newCDPSession(v);
 lr=await lens.boundingBox();let tx=lr.x+lr.width*.6,ty=lr.y+lr.height*.6;
 start=await offset();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx-(language==='ja'?0:50),y:ty-(language==='ja'?50:0)}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok(await offset()<start-10);
 await v.screenshot({path:require('node:os').tmpdir()+`/viewer-window-mobile-${language}.png`});
 // Narrow phones and landscape keep a usable lens and controls above the home band.
 for(const size of [{width:320,height:568},{width:844,height:390}]){
   await v.setViewportSize(size);await v.waitForTimeout(180);
   const panelBox=await v.locator('#reader-assist-panel').boundingBox(),lensBox=await lens.boundingBox(),footerBox=await footer.boundingBox();
   assert(panelBox.x>=0&&panelBox.x+panelBox.width<=size.width+.5);
   assert(lensBox.width>90&&lensBox.height>40,JSON.stringify({size,lensBox}));
   assert(lensBox.y+lensBox.height<=footerBox.y+.5);
   for(const id of ['viewer-nav-left','viewer-nav-right','reader-assist-next','reader-assist-prev']){const r=await v.locator('#'+id).boundingBox();assert(r.y+r.height<=size.height-50+.5);}
   await v.screenshot({path:require('node:os').tmpdir()+`/viewer-window-${language}-${size.width}.png`});
 }
 await v.setViewportSize({width:390,height:844});await v.waitForTimeout(180);
 // Tapping the reserved home-bar band must not turn a page or toggle chrome.
 const beforePage=await v.locator('#page-slider').inputValue(),chrome=await v.locator('#viewer-ui').getAttribute('class');
 await v.mouse.click(195,830);assert.equal(await v.locator('#page-slider').inputValue(),beforePage);assert.equal(await v.locator('#viewer-ui').getAttribute('class'),chrome);
 await v.waitForTimeout(950);await first.evaluate(e=>window.previousAssistLine=e);
 await v.locator(language==='ja'?'#viewer-nav-left':'#viewer-nav-right').click();
 await v.waitForFunction(()=>!document.querySelector('#viewer-stage').contains(window.previousAssistLine));
 await v.locator('#reader-assist-lens [data-reading-line]').waitFor();
 assert.equal((await v.locator('#reader-assist-status').innerText()).startsWith('1 / '),true,'New page starts at its first line');
 // Reader UI translations and a non-text page fallback do not trap navigation.
 await v.evaluate(()=>document.documentElement.lang='en');
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-zoom').selectOption('1.5');await v.locator('#viewer-reading-guide summary').click();
 assert.equal(await v.locator('#reader-assist-next').innerText(),'Continue');assert.equal(await v.locator('#reader-assist-prev').innerText(),'Back');
 await v.evaluate(()=>document.documentElement.lang='ja');
 // Simulate the next projection being an image surface; only the reader DOM changes.
 await v.evaluate(()=>{const content=document.querySelector('#viewer-content');window.readerSavedProjection=content.innerHTML;content.innerHTML='<img alt="Image page" style="width:100%;height:100%" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22360%22 height=%22640%22/%3E">';});
 await v.waitForFunction(()=>!document.body.classList.contains('reader-primary-lens'));
 assert.equal(await v.locator('#reader-page-count').isVisible(),false,'Mobile page count must not be duplicated');
 await v.locator('#viewer-mobile-page-count').click();await v.waitForTimeout(2300);
 assert.equal(await v.locator('#viewer-mobile-page-count').evaluate(e=>getComputedStyle(e).opacity),'0','Image page count fades after two seconds');
 await v.locator('#viewer-mobile-page-count').click();
 assert.equal(await v.locator('#viewer-mobile-page-count').evaluate(e=>e.classList.contains('is-faded')),false);
 assert.equal(await v.locator('#reader-assist-lens .viewer-fixed-text-page').count(),0);assert.equal(await v.locator('#reader-assist-next').isVisible(),false);assert.equal(await v.locator('#viewer-nav-left').isVisible(),true);
 await v.evaluate(()=>document.querySelector('#viewer-content').innerHTML=window.readerSavedProjection);
 await v.locator('#reader-assist-lens .viewer-fixed-text-page').waitFor();
 // Normal/focus have identical page dimensions on mobile, with footer always reserved.
 await v.locator('#viewer-reading-guide summary').click();await v.locator('#reading-guide-enabled').uncheck();await v.waitForTimeout(180);
 const mobilePageBefore=await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox();
 await v.locator('#reading-guide-enabled').check();await v.locator('#reading-guide-mode').selectOption('focus');await v.waitForTimeout(180);
 const mobileFocus=await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox();
 assert.deepEqual(mobileFocus,mobilePageBefore,'Focus keeps the ordinary mobile page dimensions');
 // The guide-only mode keeps the same reserved footer as well.
 await v.locator('#reading-guide-mode').selectOption('active');await v.waitForTimeout(180);
 assert.deepEqual(await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox(),mobileFocus);
 await v.locator('#reading-guide-enabled').uncheck();await v.locator('#viewer-reading-guide summary').click();
 const shrunk=await v.locator('#viewer-canvas').boundingBox();
 assert(Math.abs(shrunk.x+shrunk.width/2-195)<1&&Math.abs(shrunk.y+shrunk.height/2-422)<1,'Menu page stays at viewport center');
 await v.locator('#viewer-mobile-page-count').click();
 const canvas=await v.locator('#viewer-canvas').boundingBox();assert(canvas.height>shrunk.height,'Closing menu restores maximum page');
 assert(Math.abs(canvas.y+canvas.height/2-422)<1,'Reading page stays centered');
 const countBox=await v.locator('#viewer-mobile-page-count').boundingBox();assert(Math.abs(countBox.y+await v.locator('#viewer-mobile-page-count').evaluate(e=>parseFloat(e.style.getPropertyValue('--count-label-y')))-(canvas.y+canvas.height+844-50)/2)<1,'Page count centered between page and home-safe edge');
 await v.mouse.click(canvas.x+canvas.width/2,canvas.y+canvas.height/2);assert.equal(await footer.isVisible(),false,'Body tap must not reveal mobile menus');
 const metrics=await v.evaluate(()=>({width:innerWidth,height:innerHeight,safe:34,padding:getComputedStyle(document.querySelector('#viewer-layout')).paddingBottom}));assert.equal(metrics.padding,'0px');assert(canvas.width>=388,'Page fills available portrait width');
 // Existing pinch/pan remains available after leaving the magnified window.
 const stage=v.locator('#viewer-stage'),beforePinch=await stage.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);
 const box=await v.locator('#viewer-stage .viewer-fixed-text-page').first().boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:cx-25,y:cy},{id:2,x:cx+25,y:cy}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:cx-50,y:cy},{id:2,x:cx+50,y:cy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await v.waitForTimeout(150);
 assert.ok(await stage.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)>beforePinch*1.4);
 const beforePan=await stage.getAttribute('style');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx,y:cy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-20,y:cy-20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.notEqual(await stage.getAttribute('style'),beforePan);
 await v.emulateMedia({media:'print'});assert.equal(await footer.isVisible(),false);assert.equal(await v.locator('#reader-assist-panel').isVisible(),false);await v.emulateMedia({media:'screen'});
 assert.equal(await p.evaluate(()=>JSON.stringify(window.assistTestState.blocks)),snapshot);
 await v.evaluate(()=>window.toggleUi(true));await v.setViewportSize({width:1440,height:950});await v.waitForTimeout(180);assert.equal(await footer.isVisible(),false);assert.equal(await v.locator('#viewer-footer #page-slider').count(),1);
 assert.deepEqual(errors,[]);await v.close();await p.close();console.log(language,'focus/annotations/lens/zoom/line navigation/touch/mobile/paging/pinch/pan/print/disable and unchanged authoring passed');
}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
