const {chromium,webkit}=require(process.env.DSF_PLAYWRIGHT_MODULE),fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275',engine=process.env.DSF_TEST_ENGINE||'chromium';
(async()=>{const b=await (engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));try{
for(const lang of ['ja','en']){
 const p=await b.newPage({viewport:{width:1280,height:900},hasTouch:true}),errors=[];p.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 const raw=JSON.parse(fs.readFileSync('outputs/book-edges-24.json','utf8'));raw.defaultLang=lang;
 await p.route(base+'/peek-motion.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(raw)}));await p.goto(base+'/viewer?bookEdges=1&src=/peek-motion.json');await p.waitForFunction(()=>document.querySelector('#page-slider')?.max>1);await p.evaluate(()=>jumpToPage(5));await p.waitForTimeout(500);
 const wait=s=>p.waitForFunction(s=>document.querySelector('#viewer-reader-controls').dataset.bookState===s&&!document.querySelector('.viewer-pose-transition')&&!document.querySelector('body.viewer-fan-preparing'),s);
 const settled=()=>p.waitForFunction(()=>document.querySelector('#viewer-edge-peek').dataset.ready==='true'&&!document.querySelector('.edge-fan-turn'));
 const position=()=>p.locator('#viewer-edge-peek').getAttribute('data-spread-position').then(Number);
 async function wheel(x,y){await p.mouse.move(30,440);if(engine==='webkit')await p.evaluate(({x,y})=>document.elementFromPoint(30,440).dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:x,deltaY:y})),{x,y});else await p.mouse.wheel(x,y);}
 await p.evaluate(()=>toggleUi(false));await wheel(24,-36);await wait('peek');await settled();
 await wheel(0,-36);await p.waitForTimeout(260);await wheel(0,-36);await wait('spine');
 for(const s of ['edge','peek']){await wheel(0,36);await wait(s);}await settled();
 let before=await position();await wheel(lang==='ja'?-36:36,0);await p.waitForFunction(n=>+document.querySelector('#viewer-edge-peek').dataset.spreadPosition===n+1,before);await settled();
 const slider=p.locator('#page-slider');await p.evaluate(()=>toggleUi(true));await slider.fill('6');await settled();await slider.blur();before=await position();await p.keyboard.press(lang==='ja'?'ArrowLeft':'ArrowRight');await settled();assert.equal(await position(),before+1,'one key advances one spread even from its first body page');
 await p.evaluate(()=>toggleUi(true));await slider.fill('7');await settled();await slider.blur();before=await position();await p.keyboard.press(lang==='ja'?'ArrowRight':'ArrowLeft');await settled();assert.equal(await position(),before-1,'one reverse key advances one spread');
 // Hold and reverse a real touch turn, so both halves of its animation can be inspected.
 const r=await p.locator('.edge-peek-leaf').boundingBox(),x=r.x+r.width/2,y=430,sign=lang==='ja'?1:-1;
 let cdp;if(engine==='chromium')cdp=await p.context().newCDPSession(p);
 async function touch(type,dx){if(cdp)await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:x+dx*sign,y,id:1}]});else await p.locator('.edge-peek-leaf').evaluate((el,{type,x,y,dx,sign})=>el.dispatchEvent(new PointerEvent({touchStart:'pointerdown',touchMove:'pointermove',touchEnd:'pointerup'}[type],{bubbles:true,pointerId:77,pointerType:'touch',isPrimary:true,buttons:type==='touchEnd'?0:1,clientX:x+dx*sign,clientY:y})),{type,x,y,dx,sign});}
 before=await position();await touch('touchStart',0);await touch('touchMove',60);await p.locator('.edge-fan-turn').waitFor();
 for(const dx of [60,126]){
  await touch('touchMove',dx);await p.waitForFunction(dx=>Math.abs(Number(document.querySelector('.edge-fan-turn')?.dataset.progress)-dx/180)<.02,dx,{timeout:5000});
  const labels=await p.locator('.edge-fan-sheet[data-page-label]').evaluateAll(ns=>ns.filter(n=>getComputedStyle(n).visibility!=='hidden').map(n=>n.dataset.pageLabel).filter(Boolean));assert.equal(new Set(labels).size,labels.length,'turning faces never duplicate a stationary face: '+labels);
  const progress=+await p.locator('.edge-fan-turn').getAttribute('data-progress');assert.ok(Math.abs(progress-dx/180)<.02,JSON.stringify({engine,dx,progress}));await p.waitForTimeout(80);assert.equal(+await p.locator('.edge-fan-turn').getAttribute('data-progress'),progress,'held turn remains still');
  await p.screenshot({path:`outputs/peek-turn-${engine}-${lang}-${dx}.png`});
 }
 await touch('touchMove',0);await touch('touchEnd',0);await settled();assert.equal(await position(),before,'reversed turn restores original spread');if(cdp)await cdp.detach();
 // Sample actual mesh geometry near the end of C1/C4 transitions.
 for(const [value,key,label] of [[2,lang==='ja'?'ArrowRight':'ArrowLeft','C1'],[+(await slider.getAttribute('max'))-1,lang==='ja'?'ArrowLeft':'ArrowRight','C4']]){
  await p.evaluate(()=>toggleUi(true));await slider.fill(String(value));await settled();await slider.blur();
  await p.evaluate(()=>{window.coverFrames=[];const observer=new MutationObserver(records=>{for(const record of records){const root=record.target;if(!root.matches('.viewer-pose-transition'))continue;const points=[...root.querySelectorAll('.pose-morph-strip')].flatMap(n=>n.bookPoints||[]);if(points.length)coverFrames.push({progress:+root.dataset.progress,width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))});}});observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-progress']});window.stopCoverFrames=()=>observer.disconnect();});
  await p.keyboard.press(key);await settled();assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-exterior'),label);assert.equal(await p.locator('#viewer-reader-controls').getAttribute('data-book-state'),'peek');await p.keyboard.press('ArrowDown');await wait('reading');await p.evaluate(()=>stopCoverFrames());const width=(await p.locator('#viewer-canvas').boundingBox()).width,frames=await p.evaluate(()=>coverFrames.filter(f=>f.progress>.95));assert.ok(frames.length>0);assert.ok(frames.every(f=>f.width<width*1.12),JSON.stringify({label,width,frames}));assert.ok((await p.locator('.reader-page-number').allTextContents()).includes(label));await p.keyboard.press('ArrowUp');await wait('peek');await settled();
 }
 assert.deepEqual(errors,[]);console.log(engine,lang,'short PC strokes, queued gestures, spread stepping, nonduplicated held/reversed turns and cover width passed');await p.close();
}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
