const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});let p;try{
 p=await browser.newPage({viewport:{width:1500,height:1000}});const errors=[],dialogs=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'||m.text().includes('[Editor preview]'))console.log('console',m.text());});p.on('dialog',async d=>{dialogs.push(d.message());console.log('dialog',d.message());await d.dismiss();});
 await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeFlowGeneratedPage);
 await p.evaluate(async()=>{
  const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js'),{ensureFlowLanguageTypography}=await import('/js/flow-multilingual-authoring.js');
  const g=createFlowGroupBlock({id:'placement',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{ja:'灯台の光を見ていた。'.repeat(5),'en-GB':'We watched the lighthouse. '.repeat(5)}}]}]}});
  Object.assign(state,{blocks:ensureFlowLanguageTypography([g],{groupId:g.id,languageKey:'en-GB',writingMode:'horizontal-tb'}).blocks,projectAssets:[],version:6,activeLang:'ja',defaultLang:'ja',languages:['ja','en-GB'],activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,sections:[],pages:[],projectId:null,localProjectId:'placement-acceptance',bookMode:'none',book:{mode:'none'}});
  window.placementState=state;window.setStudioUILang('en');window.changeFlowGeneratedPage(0,0);
 });
 const text=()=>p.locator('.flow-editor-page-surface .flow-dom-block[data-flow-block-id=p]').first();
 await text().click({position:{x:5,y:5}});
 const before=await p.evaluate(()=>structuredClone(window.placementState.blocks));
 const choose=value=>p.locator(`#flow-ribbon-placement [data-ribbon-original=flow-placement-block][data-ribbon-value=${value}]`).click();
 const readOffset=()=>p.evaluate(()=>document.querySelector('.flow-editor-page-surface')._flowPageEntry.page.placementOffset);
 await choose('center');await p.waitForFunction(()=>document.querySelector('.flow-editor-page-surface')?._flowPageEntry.page.placementOffset?.blockAlign==='center');
 assert.ok((await readOffset()).x<-40,JSON.stringify(await readOffset()));
 assert.deepEqual(await p.evaluate(()=>window.placementState.blocks[0].flow.document),before[0].flow.document);
 assert.equal(await p.evaluate(()=>window.placementState.blocks[0].flow.layout.pagePlacements.length),1);
 await p.locator('#btn-undo').click();assert.deepEqual(await p.evaluate(()=>window.placementState.blocks),before);
 await text().click({position:{x:5,y:5}});await choose('end');await p.waitForFunction(()=>document.querySelector('.flow-editor-page-surface')?._flowPageEntry.page.placementOffset?.blockAlign==='end');
 const ja=await p.evaluate(()=>structuredClone(window.placementState.blocks[0].flow.layout.pagePlacements[0]));
 // Open translated text through the real split canvas.
 await p.locator('#flow-compare-split').click();
 await p.locator('[data-compare-side=target] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
 await p.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.lang==='en-GB');
 await choose('center');await p.waitForFunction(()=>window.placementState.blocks[0].flow.layout.pagePlacements.some(a=>a.languageKey==='en-GB'));
 assert.deepEqual(await p.evaluate(()=>window.placementState.blocks[0].flow.layout.pagePlacements.find(a=>a.languageKey==='ja')),ja);
 await p.locator('#flow-compare-normal').click();
 await p.getByRole('button',{name:'Add shape',exact:true}).click();await p.getByRole('button',{name:'Rectangle',exact:true}).click();
 await p.waitForSelector('.flow-graphic-layer .graphic-hit');
 await p.waitForFunction(()=>document.querySelector('.flow-editor-page-surface')?._flowPageEntry.page.placementOffset?.y>50);
 assert.deepEqual(await p.evaluate(()=>window.placementState.blocks[0].flow.document),before[0].flow.document);
 const data=await p.evaluate(async()=>{
   const {state}=await import('/js/state.js'),{serializeProject,deserializeProject}=await import('/js/project-persistence.js');
   const restored=deserializeProject(serializeProject({version:6,blocks:state.blocks,languages:state.languages,defaultLang:state.defaultLang}));
   return {saved:restored.blocks,live:state.blocks,offset:document.querySelector('.flow-editor-page-surface')._flowPageEntry.page.placementOffset,transform:document.querySelector('.flow-graphic-layer').style.transform};
 });assert.deepEqual(data.saved,data.live);assert.ok(data.transform.includes(String(data.offset.y)));
 // Reflow can collect different anchors on one page. Keep them visible until explicitly resolved.
 await p.evaluate(()=>{const g=window.placementState.blocks[0],a=g.flow.layout.pagePlacements.find(a=>a.languageKey==='en-GB');g.flow.layout.pagePlacements.push({...a,id:'conflicting-placement',utf16Offset:a.utf16Offset+1,blockAlign:'end'});window.changeFlowGeneratedPage(0,0);});
 await p.waitForFunction(()=>document.querySelector('#flow-placement-status')?.textContent.includes('conflict'));
 assert.equal(await p.evaluate(()=>window.placementState.blocks[0].flow.layout.pagePlacements.filter(a=>a.languageKey==='en-GB').length),2);
 await choose('center');await p.waitForFunction(()=>!document.querySelector('#flow-placement-status')?.textContent);
 assert.equal(await p.evaluate(()=>window.placementState.blocks[0].flow.layout.pagePlacements.filter(a=>a.languageKey==='en-GB').length),1);
 // Preview must move text and graphics together and pass publication validation.
 const popup=p.waitForEvent('popup');await p.locator('#btn-editor-preview').click();const viewer=await popup;
 viewer.on('dialog',async d=>{dialogs.push(d.message());console.log('dialog',d.message());await d.dismiss();});
 await viewer.waitForSelector('.viewer-fixed-text-page',{timeout:60000});await viewer.waitForSelector('.viewer-fixed-text-background');
 const boxes=await viewer.locator('.viewer-fixed-text-line[data-reading-line]').evaluateAll(lines=>lines.map(e=>({y:parseFloat(e.style.top),height:parseFloat(e.style.height)})));
 assert.ok(Math.min(...boxes.map(r=>r.y))>100,JSON.stringify(boxes));
 await viewer.screenshot({path:require('node:os').tmpdir()+'/flow-placement-viewer.png'});
 await p.screenshot({path:require('node:os').tmpdir()+'/flow-page-placement.png'});
 // Isolate the pure reflow check from the editor's autosave/cache invalidations.
 const harness=await browser.newPage();
 await harness.route('**/placement-verification',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'}));
 await harness.goto('http://127.0.0.1:5178/placement-verification');
 const reflow=await harness.evaluate(async()=>{
   const {createFlowGroupBlock}=await import('/js/flow-project-model.js'),{createFlowRuntimePageProjection}=await import('/js/flow-runtime-pages.js');
   const {setFlowPagePlacement}=await import('/js/flow-page-placement.js'),{applyFlowAuthoringOperation}=await import('/js/flow-authoring.js');
   let project={version:6,defaultLang:'ja',blocks:[createFlowGroupBlock({id:'long-placement',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{ja:'夜の灯台が光っていた。'.repeat(120),en:'Keep this translation intact.'}}]}]}})]};
   const paginate=()=>createFlowRuntimePageProjection(project,{languageKey:'ja',sessionScope:'placement-reflow-test'});
   const original=await paginate(),target=original.pages.at(-1),doc=structuredClone(project.blocks[0].flow.document);
   project.blocks=setFlowPagePlacement(project.blocks,'long-placement',target.page,'ja','center').blocks;
   const placed=await paginate(),anchor=structuredClone(project.blocks[0].flow.layout.pagePlacements[0]);
   const unchanged=JSON.stringify(project.blocks[0].flow.document)===JSON.stringify(doc)&&JSON.stringify(placed.pages.map(p=>p.page.fragments))===JSON.stringify(original.pages.map(p=>p.page.fragments));
   const prefix='新しい前文を追加する。'.repeat(120);
   project.blocks=applyFlowAuthoringOperation(project.blocks,{type:'setText',groupId:'long-placement',sectionId:'s',blockId:'p',languageKey:'ja',text:prefix+doc.sections[0].blocks[0].texts.ja});
   const changed=await paginate(),newAnchor=project.blocks[0].flow.layout.pagePlacements[0];
   return {unchanged,oldCount:original.pages.length,newCount:changed.pages.length,oldPage:placed.pages.findIndex(p=>p.page.placementOffset),newPage:changed.pages.findIndex(p=>p.page.placementOffset),oldOffset:anchor.utf16Offset,newOffset:newAnchor.utf16Offset,prefixLength:prefix.length,translation:project.blocks[0].flow.document.sections[0].blocks[0].texts.en};
 });
 assert.ok(reflow.unchanged);assert.ok(reflow.oldCount>1);assert.ok(reflow.newPage>reflow.oldPage,JSON.stringify(reflow));
 assert.equal(reflow.newOffset,reflow.oldOffset+reflow.prefixLength);assert.equal(reflow.translation,'Keep this translation intact.');
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 console.log('Reflow follows the same semantic position; conflict UI and explicit resolution passed',reflow);
 console.log('Page placement: real JA/EN ribbon, no splitting, language isolation, Undo, wrapped shape group movement, persistence and Viewer publication passed',data.offset);
 }catch(e){if(p)await p.screenshot({path:require('node:os').tmpdir()+'/flow-page-placement-failure.png'});throw e;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
