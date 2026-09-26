const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const [mode,bodyCount,lang] of [['full',6,'ja'],['full',6,'en'],['full',5,'ja'],['simple',5,'en']]){
  const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.emulateMedia({reducedMotion:'reduce'});
  const raw=JSON.parse(fs.readFileSync('outputs/book-edges-24.json','utf8'));raw.defaultLang=lang;
  // Cover indexes are deliberately interleaved with the body to reject index/parity shortcuts.
  raw.pages=raw.pages.slice(0,bodyCount+(mode==='full'?4:2));
  raw.book.mode=mode;raw.book.covers=mode==='full'?{c1:{pageIndex:3},c2:{pageIndex:0},c3:{pageIndex:bodyCount+2},c4:{pageIndex:2}}:{c1:{pageIndex:2},c4:{pageIndex:bodyCount}};
  await p.goto(base+'/viewer?bookEdges=1');await p.waitForFunction(()=>typeof loadDsf==='function');await p.locator('#file-input').setInputFiles({name:'cover-order.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);
  const wait=state=>p.waitForFunction(state=>document.querySelector('#viewer-reader-controls').dataset.bookState===state&&!document.querySelector('.viewer-pose-transition')&&!document.querySelector('body.viewer-fan-preparing'),state);
  const pairs=new Map(),max=+(await p.locator('#page-slider').getAttribute('max'));
  for(let unit=2;unit<max;unit++){
   await p.evaluate(unit=>jumpToPage(unit),unit);await p.waitForTimeout(80);
   const labels=await p.locator('.reader-page-number').allTextContents();for(const label of labels)if(/^\d+$/.test(label))pairs.set(label,labels);
  }
  assert.equal(pairs.size,bodyCount);
  await p.keyboard.press('ArrowUp');await wait('peek');
  const peek=p.locator('#viewer-edge-peek'),slider=peek.locator('input');
  for(let i=0;i<bodyCount;i++){
   await p.evaluate(()=>toggleUi(true));await slider.fill(String(i));await p.waitForFunction(i=>+document.querySelector('#viewer-edge-peek input').value===i&&!document.querySelector('#viewer-edge-peek button').disabled,i);
   const active=await p.locator('.edge-fan-sheet[data-active=true]').evaluateAll(ns=>ns.map(n=>n.dataset.pageLabel));
   const expected=pairs.get(String(i+1));assert.deepEqual(active.filter(Boolean),expected.filter(label=>label!=='BODY'),`${mode} ${lang} body ${i+1}`);
   const boards=await p.locator('.edge-fan-cover').evaluateAll(ns=>ns.map(n=>({side:n.dataset.side,role:n.dataset.cover,outside:+n.dataset.outsideSourceIndex,inside:n.dataset.insideCover,faces:n.querySelectorAll('.edge-cover-outside').length})));
   assert.deepEqual(boards.map(b=>b.role),['C1','C4']);assert.equal(boards[0].outside,raw.book.covers.c1.pageIndex);assert.equal(boards[1].outside,raw.book.covers.c4.pageIndex);
   assert.equal(boards[0].side,lang==='ja'?'right':'left');assert.ok(boards.every(b=>b.faces===16));
   const visible=await p.locator('.edge-fan-sheet[data-source-index]').evaluateAll(ns=>ns.map(n=>({source:+n.dataset.sourceIndex,side:n.dataset.side,label:n.dataset.pageLabel})));
   assert.equal(new Set(visible.map(n=>n.source)).size,visible.length,'no duplicate face in fan');assert.ok(!visible.some(n=>[raw.book.covers.c1.pageIndex,raw.book.covers.c4.pageIndex].includes(n.source)),'exterior covers never become body leaves');
   for(const face of visible){if(!/^\d+$/.test(face.label))continue;const pair=pairs.get(face.label);assert.equal(face.side,pair.indexOf(face.label)===0?'left':'right','neighbours retain physical side');}
   await p.locator('[data-book-direction=down]').click();await wait('reading');assert.deepEqual(await p.locator('.reader-page-number').allTextContents(),expected,'confirmation opens the same spread');
   await p.keyboard.press('ArrowUp');await wait('peek');
  }
  assert.deepEqual(errors,[]);console.log(mode,bodyCount,lang,'all body positions match reading, real cover backs, neighbours and confirmation passed');await p.close();
 }
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
