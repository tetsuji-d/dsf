const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());
 await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeFlowGeneratedPage);
 await p.evaluate(async()=>{const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js');window.alignmentState=state;
 state.blocks=[createFlowGroupBlock({id:'a',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'h',type:'heading',level:1,texts:{ja:'第一章'}},{id:'p',type:'paragraph',texts:{ja:'海辺を歩く。'.repeat(130)}}]}]}})];
 Object.assign(state,{version:6,activeLang:'ja',defaultLang:'ja',languages:['ja'],activeBlockIdx:0,activeBubbleIdx:null,sections:[],pages:[],projectAssets:[],projectId:null,localProjectId:'alignment-test',bookMode:'none',book:{mode:'none'}});window.changeFlowGeneratedPage(0,0);});
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();
 const snapshot=()=>p.evaluate(()=>JSON.stringify(window.alignmentState.blocks));let initial=await snapshot();
 await p.locator('.flow-dom-block[data-flow-block-id=h]').first().click({position:{x:5,y:5}});
 await p.locator('.flow-direct-input-proxy').press('Control+Shift+End');
 assert.equal(await snapshot(),initial,'Selecting multiple paragraphs must not modify alignment or source');
 const choice=(axis,value)=>p.locator(`#flow-ribbon-placement [data-ribbon-original=flow-placement-${axis}][data-ribbon-value=${value}]`);
 await choice('inline','start').click();
 assert.equal(await snapshot(),initial,'Clicking the already active alignment must be a no-op');
 await p.locator('.flow-dom-block[data-flow-block-id=h]').first().click({position:{x:5,y:5}});
 await choice('inline','end').click();
 await p.waitForFunction(()=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.some(b=>b.textAlignByLanguage?.ja==='end'));
 assert.equal(await p.evaluate(()=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.some(b=>b.titleRegion)),false,'Paragraph alignment must not isolate a page');
 let region;
 await p.locator('#btn-undo').click();assert.equal(await snapshot(),initial);
 await p.locator('.flow-dom-block[data-flow-block-id=h]').first().click({position:{x:5,y:5}});
 await choice('block','end').click();
 await p.waitForFunction(()=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.some(b=>b.titleRegion?.blockAlign==='end'));
 region=await p.evaluate(()=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.find(b=>b.titleRegion).titleRegion);
 assert.equal(region.textAlign,'start','Changing block placement must preserve text alignment');
 await p.locator('#btn-undo').click();assert.equal(await snapshot(),initial);
 // A translated paragraph spanning generated pages must never be split by alignment.
 await p.evaluate(()=>{window.alignmentState.blocks[0].flow.document.sections[0].blocks[1].texts['en-GB']='Walking by the sea. '.repeat(130);window.changeFlowGeneratedPage(0,0);});initial=await snapshot();
 await p.locator('.flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
 for (const value of ['end','center','justify','start']) {
  await choice('inline',value).click();
  await p.waitForFunction(v=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.find(b=>b.id==='p').textAlignByLanguage?.ja===v,value);
  await p.waitForFunction(v=>[...document.querySelectorAll('.flow-dom-block[data-flow-block-id=p]')].every(e=>getComputedStyle(e).textAlign===v),value);
 }
 let doc=await p.evaluate(()=>window.alignmentState.blocks[0].flow.document);
 assert.equal(doc.sections[0].blocks.length,2);assert.ok(doc.sections[0].blocks.every(b=>!b.titleRegion));
 assert.equal(doc.sections[0].blocks[1].texts['en-GB'],'Walking by the sea. '.repeat(130));
 await p.screenshot({path:require('node:os').tmpdir()+'/flow-paragraph-alignment.png'});
 for(let n=0;n<4;n++){await p.locator('#btn-undo').click();}
 assert.equal(await snapshot(),initial);
 // The source editor uses the same paragraph command.
 await p.evaluate(()=>window.changeFlowSourceBlock(0));
 const input=p.locator('[data-flow-field=block-text]:visible').last();await input.click();
 await choice('inline','center').click();
 await p.waitForFunction(()=>window.alignmentState.blocks[0].flow.document.sections[0].blocks.find(b=>b.id==='p').textAlignByLanguage?.ja==='center');
 await p.locator('#btn-undo').click();assert.equal(await snapshot(),initial);
 assert.deepEqual(errors,[]);console.log('Alignment intent: selection/no-op unchanged, independent axes and atomic Undo passed');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
