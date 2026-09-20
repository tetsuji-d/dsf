const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const manuscript='AI updated manuscript '+Date.now(); const p=await browser.newPage(); await p.goto('http://127.0.0.1:8797'); await p.waitForFunction(()=>window.saveFixture);await p.request.post('http://127.0.0.1:8797/fixture/new-run');
 await p.evaluate(()=>{window.call=async(name,args)=>saveFixture.tools().find(t=>t.name===name).execute(args);
 window.edit=async text=>{const ctx=await call('dsf_get_editor_context',{});const read=await call('dsf_read_flow_paragraph',{workToken:ctx.workToken,groupId:'flow_1',sectionId:'chapter',blockId:'paragraph',languageKey:'ja'});return call('dsf_replace_flow_paragraph',{workToken:ctx.workToken,editToken:read.editToken,text});};});
 for(const [id,backend] of [['project_1','r2-private'],['legacy_1','firestore']]){
  await p.evaluate(id=>saveFixture.load(id),id);
  assert.equal(await p.evaluate(()=>saveFixture.readStatus().state),'unknown');
  const before=await p.evaluate(()=>saveFixture.state.blocks[0].flow.document.sections[0].blocks[0].texts.ja);
  const result=await p.evaluate(text=>edit(text),manuscript);
  assert.equal(result.changed,true,JSON.stringify(result));
  assert.equal(await p.evaluate(()=>saveFixture.readStatus().state),'pending');
  assert.equal(await p.evaluate(()=>saveFixture.readStatus().cloudCurrent),false);
  await p.evaluate(()=>saveFixture.flushSave());
  const saved=await p.evaluate(()=>call('dsf_get_editor_context',{}));
  assert.equal(saved.persistence.backend,backend); assert.equal(saved.persistence.cloudCurrent,true);assert.equal(saved.persistence.localCurrent,true);
  await p.evaluate(()=>saveFixture.undo()); await p.evaluate(()=>saveFixture.flushSave());
  assert.equal(await p.evaluate(()=>saveFixture.state.blocks[0].flow.document.sections[0].blocks[0].texts.ja),before);
  await p.evaluate(()=>saveFixture.redo());await p.evaluate(()=>saveFixture.flushSave());
  await p.evaluate(id=>saveFixture.load(id),id);
  assert.equal(await p.evaluate(()=>saveFixture.state.blocks[0].flow.document.sections[0].blocks[0].texts.ja),manuscript);
 }
 await p.evaluate(()=>saveFixture.load('project_1'));
 await p.evaluate(()=>fetch('/fixture/mode/lost',{method:'POST'}));
 const beforeLost=await (await p.request.get('http://127.0.0.1:8797/fixture/status')).json();
 await p.evaluate(text=>edit(text),manuscript+' recovered');
 const lost=await p.evaluate(async()=>{try{await saveFixture.flushSave();return null;}catch(e){return e.code;}});assert.equal(lost,'AUTHORING_UNAVAILABLE');
 assert.equal(await p.evaluate(()=>saveFixture.readStatus().cloudCurrent),false);
 await p.evaluate(()=>saveFixture.flushSave());
 assert.equal(await p.evaluate(()=>saveFixture.readStatus().cloudCurrent),true);
 const afterLost=await (await p.request.get('http://127.0.0.1:8797/fixture/status')).json();assert.equal(afterLost.puts,beforeLost.puts+1);
 // A second edit while the first cloud save is delayed must stay unsaved.
 await p.evaluate(()=>fetch('/fixture/mode/delay',{method:'POST'}));
 await p.evaluate(text=>edit(text),manuscript+' delayed');
 await p.evaluate(()=>{window.inFlight=saveFixture.flushSave();});
 await p.waitForFunction(()=>saveFixture.readStatus().localCurrent && saveFixture.readStatus().state==='saving');
 await p.evaluate(text=>edit(text),manuscript+' newest');
 const pending=await p.evaluate(()=>saveFixture.readStatus());assert.equal(pending.localCurrent,false);assert.equal(pending.cloudCurrent,false);
 await p.evaluate(()=>window.inFlight);assert.equal(await p.evaluate(()=>saveFixture.readStatus().cloudCurrent),true);
 await p.evaluate(()=>saveFixture.load('project_1'));
 assert.equal(await p.evaluate(()=>saveFixture.state.blocks[0].flow.document.sections[0].blocks[0].texts.ja),manuscript+' newest');
 await p.evaluate(()=>fetch('/fixture/mode/conflict',{method:'POST'}));await p.evaluate(()=>edit('Local conflict copy'));
 const failure=await p.evaluate(async()=>{try{await saveFixture.flushSave();return null;}catch(e){return e.code||e.message;}});assert.equal(failure,'AUTHORING_REVISION_CONFLICT');
 const failed=await p.evaluate(()=>saveFixture.readStatus());assert.equal(failed.state,'error');assert.equal(failed.errorCode,'AUTHORING_REVISION_CONFLICT');assert.equal(failed.cloudCurrent,false);assert.equal(failed.localCurrent,true);
 const final=await (await p.request.get('http://127.0.0.1:8797/fixture/status')).json();assert.equal(final.directProjectWrites,0);assert.ok(final.legacyBatches>=3);
 console.log('Real save module + WebMCP services: private R2/legacy Firestore edit, backup, save, Undo/Redo, reload, lost reply deduplication and conflict without fallback passed.',JSON.stringify({failed,legacyBatches:final.legacyBatches}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
