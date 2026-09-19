const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});let p;try{
 p=await b.newPage({viewport:{width:1500,height:950}});const errors=[],dialogs=[];p.on('pageerror',e=>{errors.push(e.message);console.log(e.message)});p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
 await p.goto('http://127.0.0.1:5178/studio?room=editor');await p.waitForFunction(()=>window.changeBlock);
 await p.evaluate(async()=>{
 const {state}=await import('/js/state.js'),{createFlowGroupBlock}=await import('/js/flow-project-model.js'),{confirmFlowTranslationAgainstCurrentSource}=await import('/js/flow-translation-state.js');window.replaceState=state;
 const make=(id,ja,en)=>createFlowGroupBlock({id,sourceLanguage:'ja',writingMode:'vertical-rl',document:{sourceLanguage:'ja',sections:[{id:'s'+id,blocks:[{id:'p'+id,type:'paragraph',texts:{ja,'en-GB':en}}]}]}});
 state.blocks=[make('a','海X海。','Sea by the sea.'),make('b','遠くの海。','A distant sea.')];
 for(const g of state.blocks){g.flow.layout.typographyByLanguage['en-GB']={...g.flow.layout.typographyByLanguage.ja,writingMode:'horizontal-tb'};g.flow.translationState=confirmFlowTranslationAgainstCurrentSource(g,'en-GB').translationState;}
 Object.assign(state,{projectAssets:[],version:6,activeLang:'ja',defaultLang:'ja',languages:['ja','en-GB'],activeBlockIdx:0,activeIdx:0,activeBubbleIdx:null,sections:[],pages:[],projectId:null,localProjectId:'replace-test',bookMode:'none',book:{mode:'none'}});
 window.setStudioUILang('en');window.changeFlowGeneratedPage(0,0);
 });
 await p.locator('[data-testid=flow-editor-generated-page]').first().waitFor();
 const original=await p.evaluate(()=>structuredClone(window.replaceState.blocks));
 await p.keyboard.press('Control+h');const bar=p.locator('#flow-search-bar');await bar.locator('.search-replacement').waitFor();
 await bar.getByRole('searchbox').fill('海');await bar.locator('.search-replacement').fill('湖');
 await bar.locator('.search-scope').selectOption('all');
 await p.waitForFunction(()=>document.querySelector('.search-replace-all').textContent==='Replace all (3)');
 await bar.locator('.search-next').click();await p.waitForFunction(()=>!document.querySelector('.search-replace-one').disabled);
 await bar.locator('.search-replace-one').click();
 await p.waitForFunction(()=>window.replaceState.blocks[0].flow.document.sections[0].blocks[0].texts.ja==='湖X海。');
 await p.locator('#btn-undo').click();await p.waitForFunction(()=>window.replaceState.blocks[0].flow.document.sections[0].blocks[0].texts.ja==='海X海。');
 assert.deepEqual(await p.evaluate(()=>window.replaceState.blocks),original);
 await bar.locator('.search-replace-all').click();
 await p.waitForFunction(()=>window.replaceState.blocks[1].flow.document.sections[0].blocks[0].texts.ja==='遠くの湖。');
 assert.equal(await p.evaluate(()=>window.replaceState.blocks[0].flow.document.sections[0].blocks[0].texts.ja),'湖X湖。');
 await p.locator('#btn-undo').click();assert.deepEqual(await p.evaluate(()=>window.replaceState.blocks),original);
 // Source mode and translated text use the same atomic command and remain in source mode.
 await p.evaluate(async()=>{const {selectFlowSource}=await import('/js/flow-editor-session.js');window.replaceState.activeLang='en-GB';selectFlowSource('a',{languageKey:'en-GB'});window.changeBlock(0);});
 await p.waitForFunction(()=>[...document.querySelectorAll('[data-flow-field=block-text]')].some(e=>e.getClientRects().length&&e.value==='Sea by the sea.'));
 await bar.locator('.search-language').selectOption('en-GB');await bar.getByRole('searchbox').fill('sea');await bar.locator('.search-replacement').fill('lake');
 await p.waitForFunction(()=>document.querySelector('.search-replace-all').textContent==='Replace all (3)');
 await bar.locator('.search-replace-all').click();
 await p.waitForFunction(()=>[...document.querySelectorAll('[data-flow-field=block-text]')].some(e=>e.getClientRects().length&&e.value==='lake by the lake.'));
 assert.equal(await p.evaluate(()=>window.replaceState.blocks[0].flow.document.sections[0].blocks[0].texts.ja),'海X海。');
 await p.locator('#btn-undo').click();assert.deepEqual(await p.evaluate(()=>window.replaceState.blocks),original);
 await p.evaluate(()=>window.setStudioUILang('ja'));await p.waitForFunction(()=>document.querySelector('.search-replace-all').textContent==='すべて置換 (3件)');
 await p.screenshot({path:require('node:os').tmpdir()+'/flow-replace-ui.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 console.log('Real replace UI: Ctrl+H, single/all, all-Flow atomic Undo, translated source mode, JA/EN passed');
 }catch(e){if(p)await p.screenshot({path:require('node:os').tmpdir()+'/flow-replace-failure.png'});throw e;}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
