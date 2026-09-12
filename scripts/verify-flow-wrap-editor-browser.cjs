const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage({viewport:{width:1600,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{console.log('dialog',d.message());await d.dismiss()});p.on('console',m=>{if(m.type()==='error'||m.text().includes('[Editor preview]'))console.log('console',m.text().slice(0,400))});await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeBlock);await p.evaluate(async()=>{const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js');window.wrapTestState=state;state.blocks=[createFlowGroupBlock({id:'flow',sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s',blocks:[{id:'p',type:'paragraph',texts:{ja:'灯台と約束。'.repeat(80)}},{id:'q',type:'paragraph',texts:{ja:'海の向こうから手紙が届く。'.repeat(35)}}]}]}})];Object.assign(state,{projectAssets:[],version:6,activeLang:'ja',defaultLang:'ja',languages:['ja'],activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,sections:[],pages:[],projectId:null,localProjectId:'flow-wrap-integration-test',bookMode:'none',book:{mode:'none'}});window.setStudioUILang('en');window.changeFlowGeneratedPage(0,0);});await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();await p.getByRole('button',{name:'Add shape',exact:true}).click();await p.getByRole('button',{name:'Rectangle',exact:true}).click();await p.waitForFunction(()=>!!window.wrapTestState.blocks[0].flow.layout.anchoredObjects?.length);await p.locator('.flow-graphic-layer .graphic-hit').first().waitFor();console.log('shape inserted');
if(process.env.DSF_TEST_GUIDES==='1'){
 await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
 await p.locator('.flow-direct-input-proxy').waitFor();
 await p.getByRole('button',{name:'Show guides along text lines',exact:true}).click();
 await p.waitForSelector('.flow-line-guides line',{state:'attached'});
 const before=await p.evaluate(()=>JSON.stringify(window.wrapTestState.blocks));
 const hit=p.locator('.flow-graphic-layer .graphic-hit').first();await hit.click();
 await p.locator('.flow-zone-fence:visible').waitFor();
 const fence=await p.locator('.flow-zone-fence:visible').boundingBox(),box=await hit.boundingBox();
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();
 await p.mouse.move(fence.x+fence.width+30,box.y+box.height/2,{steps:5});
 assert.equal(await p.locator('.flow-zone-fence:visible').getAttribute('data-invalid'),'true');
 await p.mouse.up();
 assert.equal(await p.evaluate(()=>JSON.stringify(window.wrapTestState.blocks)),before);
 // A near-boundary move snaps the rotated/stroked outer bounds, not just the image origin.
 const fresh=await hit.boundingBox();await p.mouse.move(fresh.x+fresh.width/2,fresh.y+fresh.height/2);await p.mouse.down();
 await p.mouse.move(fence.x+fresh.width/2+1,fresh.y+fresh.height/2,{steps:5});await p.mouse.up();
 await p.waitForFunction(old=>JSON.stringify(window.wrapTestState.blocks)!==old,before);
 const snapped=await hit.boundingBox();assert.ok(Math.abs(snapped.x-fence.x)<2,JSON.stringify({snapped,fence}));
 await p.locator('#btn-undo').click();
 assert.equal(await p.evaluate(()=>JSON.stringify(window.wrapTestState.blocks)),before);
 await p.screenshot({path:require('node:os').tmpdir()+'/flow-zone-fence.png'});
 console.log('Image fence is visible, rejects outside drop, snaps near the text boundary; Undo restores');
}
const original=await p.evaluate(async()=>structuredClone((await import('/js/state.js')).state.blocks[0].flow.layout));const r=await p.locator('.flow-graphic-layer .graphic-hit').first().boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+8,r.y+r.height/2+8,{steps:5});await p.mouse.up();await p.waitForFunction(old=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects[0].graphic.frame.x!==old,original.anchoredObjects[0].graphic.frame.x);await p.locator('#btn-undo').click();assert.deepEqual(await p.evaluate(()=>window.wrapTestState.blocks[0].flow.layout),original);await p.screenshot({path:require('node:os').tmpdir()+'/flow-wrap-editor.png'});await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
await p.locator('.flow-direct-input-proxy').waitFor();
assert.equal(await p.locator('.graphic-hit.selected').count(),0);
if(process.env.DSF_TEST_GUIDES==='1')assert.equal(await p.locator('.flow-zone-fence:visible').count(),0);
assert.equal(await p.locator('.graphic-object-tools input').count(),0);
assert.equal(await p.locator('#flow-image-insert,#fab-add-bubble').count(),0);
await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({button:'right',position:{x:5,y:5}});
assert.equal(await p.locator('.graphic-context-menu').count(),1);
await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
assert.equal(await p.locator('.graphic-context-menu').count(),0);
console.log('Flow direct-edit click dismisses paste menu; floating add buttons absent');
await p.locator('.flow-direct-input-proxy').press('End');await p.keyboard.insertText('追記');
await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.document.sections[0].blocks[0].texts.ja.includes('追記'));
await p.locator('#btn-undo').click();
await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=q]').first().click({position:{x:5,y:5}});
await p.waitForFunction(()=>document.querySelector('.flow-direct-input-proxy')?.value.includes('海の向こう'));
const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=800;const x=c.getContext('2d');x.fillStyle='#148baf';x.fillRect(0,0,500,800);x.fillStyle='#fff';x.fillRect(180,100,70,600);return c.toDataURL('image/png').split(',')[1];});
const chooser=p.waitForEvent('filechooser');await p.getByRole('button',{name:'Place image',exact:true}).click();await (await chooser).setFiles({name:'lighthouse.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===2);
const imageState=await p.evaluate(async()=>{const {state}=await import('/js/state.js');return {asset:state.projectAssets[0],objects:state.blocks[0].flow.layout.anchoredObjects,anchor:state.blocks[0].flow.layout.anchoredObjects.find(e=>e.graphic.kind==='image')?.anchorBlockId};});
assert.equal(imageState.anchor,'q');assert.equal(imageState.asset.width,500);assert.equal(imageState.asset.height,800);assert.equal(imageState.asset.mimeType,'image/webp');
console.log('Wrapped text editing and paragraph-anchored full-resolution image upload passed');
await p.locator('.flow-graphic-layer .graphic-hit').last().click();
assert.equal(await p.locator('.graphic-hit.selected').count(),1);
await p.getByRole('spinbutton',{name:'Rotate °',exact:true}).fill('5');
await p.getByRole('spinbutton',{name:'Rotate °',exact:true}).press('Tab');
assert.equal(await p.locator('.graphic-hit.selected').count(),1);
await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
assert.equal(await p.locator('.graphic-hit.selected').count(),0);
assert.equal(await p.getByRole('spinbutton',{name:'Rotate °',exact:true}).count(),0);
const beforeSelection=await p.evaluate(()=>JSON.stringify(window.wrapTestState.blocks));
await p.locator('.flow-direct-input-proxy').press('Control+Shift+End');
assert.equal(await p.evaluate(()=>JSON.stringify(window.wrapTestState.blocks)),beforeSelection);
console.log('Wrapped multi-paragraph text selection leaves alignment and authoring data unchanged');
await p.locator('#flow-ribbon-placement [data-ribbon-original=flow-placement-inline][data-ribbon-value=center]').click();
await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.document.sections[0].blocks.every(b=>b.textAlignByLanguage?.ja==='center'));
await p.waitForFunction(()=>[...document.querySelectorAll('.flow-dom-block')].every(e=>getComputedStyle(e).textAlign==='center'));
const alignedWrap=await p.evaluate(()=>window.wrapTestState.blocks[0]);
assert.deepEqual(alignedWrap.flow.layout,JSON.parse(beforeSelection)[0].flow.layout);
console.log('Wrapped multi-paragraph alignment preserved anchors; aligned source will be used for Viewer preview');

console.log('Image ribbon selection is retained for controls and cleared on another text page');
if(process.env.DSF_TEST_CAPTIONS==='1'){
 const image=p.locator('.flow-graphic-layer .graphic-hit').last();
 // Leave room for the caption's rotated outer edge.
 const box=await image.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2+24,box.y+box.height/2,{steps:4});await p.mouse.up();
 await image.dblclick();
 const input=p.getByRole('textbox',{name:'Caption text',exact:true});await input.fill('灯台の記録\n海辺を歩く');await input.press('Control+Enter');
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.some(e=>e.graphic.caption?.texts.ja==='灯台の記録\n海辺を歩く'));
 await p.getByRole('button',{name:'Right, vertical',exact:true}).click();
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.some(e=>e.graphic.caption?.position==='right'));
 await p.getByRole('button',{name:'Duplicate',exact:true}).click();
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===3);
 const copied=await p.evaluate(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.filter(e=>e.graphic.kind==='image'));
 assert.equal(copied[0].graphic.assetId,copied[1].graphic.assetId);assert.equal(copied[0].anchorBlockId,copied[1].anchorBlockId);assert.deepEqual(copied[0].graphic.caption,copied[1].graphic.caption);
 await p.locator('#btn-undo').click();await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===2);
 await p.locator('.flow-graphic-layer .graphic-hit').last().click();await p.keyboard.press('Control+c');await p.keyboard.press('Control+v');
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===3);
 assert.equal(await p.evaluate(()=>window.wrapTestState.projectAssets.length),1);
 await p.locator('#btn-undo').click();await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===2);
 await p.locator('[data-testid=flow-editor-generated-page]').first().click({button:'right',position:{x:20,y:20}});
 await p.getByRole('menuitem',{name:'Paste',exact:true}).click();
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.anchoredObjects.length===3);

 await p.screenshot({path:require('node:os').tmpdir()+'/flow-caption-editor.png'});
 console.log('Caption canvas editing, vertical placement, duplicate/undo and clipboard retain original asset and caption');
}
if(process.env.DSF_TEST_PLACEMENT==='1'){
 await p.locator('[data-testid=flow-editor-generated-page] .flow-dom-block[data-flow-block-id=p]').first().click({position:{x:5,y:5}});
 const original=await p.evaluate(()=>structuredClone(window.wrapTestState.blocks[0].flow.document));
 await p.locator('#flow-ribbon-placement [data-ribbon-original=flow-placement-block][data-ribbon-value=center]').click();
 await p.waitForFunction(()=>window.wrapTestState.blocks[0].flow.layout.schemaVersion===4);
 assert.deepEqual(await p.evaluate(()=>window.wrapTestState.blocks[0].flow.document),original);
}
// Missing inactive translations must not block the displayed Japanese preview.
await p.evaluate(()=>window.wrapTestState.languages=['ja','en-GB']);
if(process.env.DSF_TEST_PAUSED_FRAMES==='1')await p.evaluate(()=>window.requestAnimationFrame=()=>0);
console.log('starting preview',await p.locator('#btn-editor-preview').isEnabled());const popup=p.waitForEvent('popup',{timeout:30000});await p.locator('#btn-editor-preview').click();console.log('clicked');const viewer=await popup;console.log('popup',viewer.url());viewer.on('dialog',async d=>{console.log('viewer dialog',d.message());await d.dismiss()});await viewer.waitForSelector('.viewer-fixed-text-page',{timeout:120000});await viewer.waitForSelector('.viewer-fixed-text-background');assert.ok(await viewer.locator('.viewer-fixed-text-run').count()>0);console.log('viewer ready with missing inactive translation');assert.deepEqual(await p.evaluate(()=>window.wrapTestState.languages),['ja','en-GB']);if(process.env.DSF_TEST_GUIDES==='1'){
 assert.equal(await viewer.locator('body').getAttribute('data-reading-guides'),'off');
 await viewer.locator('#viewer-reading-guide > summary').click();
 await viewer.locator('#reading-guide-enabled').check();
 assert.equal(await viewer.locator('body').getAttribute('data-reading-guides'),'on');
 const line=viewer.locator('#viewer-stage .viewer-fixed-text-line[data-reading-line]').first();
 const rect=await line.boundingBox();assert.ok(rect);
 const shadow=await line.evaluate(e=>getComputedStyle(e).boxShadow);assert.notEqual(shadow,'none');
 await viewer.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 await viewer.waitForSelector('#viewer-stage .reading-line-active');
 assert.deepEqual(await line.boundingBox(),rect);
 await viewer.locator('#viewer-reading-guide > summary').click();
 await viewer.locator('#reading-guide-strength').fill('45');
 assert.equal(await viewer.evaluate(()=>JSON.parse(localStorage.getItem('dsf-reader-line-guides')).strength),45);
 await viewer.locator('#reading-guide-strength').press('ArrowRight');
 assert.equal(await viewer.evaluate(()=>JSON.parse(localStorage.getItem('dsf-reader-line-guides')).strength),46);
 assert.deepEqual(await line.boundingBox(),rect);
 await viewer.screenshot({path:require('node:os').tmpdir()+'/viewer-reading-guides.png'});
 await viewer.locator('#reading-guide-enabled').uncheck();
 assert.equal(await line.evaluate(e=>getComputedStyle(e).boxShadow),'none');
 assert.equal(await viewer.evaluate(()=>JSON.parse(localStorage.getItem('dsf-reader-line-guides')).enabled),false);
 await viewer.setViewportSize({width:390,height:844});
 const menuBox=await viewer.locator('.reading-guide-popover').boundingBox();
 assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=390,JSON.stringify(menuBox));
 console.log('Viewer reading guide defaults OFF; tap highlights without page turn/reflow; strength and preference persist');
}
await viewer.close();
await p.evaluate(()=>window.wrapTestState.activeLang='en-GB');
const failure=p.waitForEvent('dialog');
await p.evaluate(()=>{import('/js/editor-viewer-preview.js').then(m=>m.openEditorViewerPreview());});
const message=(await failure).message();
assert.ok(message.includes('EN-GB / Flow manuscript 1'),message);
assert.ok(message.includes('Translation is missing'),message);
console.log('Selected missing translation reports language, manuscript and safe reason');
console.log(errors);assert.deepEqual(errors,[]);}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
