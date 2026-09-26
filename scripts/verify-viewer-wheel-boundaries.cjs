const {chromium,webkit}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275',engine=process.env.DSF_TEST_ENGINE||'chromium';
(async()=>{const b=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));try{
for(const [count,lang] of [[6,'ja'],[5,'ja'],[6,'en'],[5,'en']]){
 const p=await b.newPage({viewport:engine==='webkit'?{width:390,height:844}:{width:1280,height:900},hasTouch:true}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const raw=JSON.parse(fs.readFileSync('outputs/book-edges-24.json','utf8'));raw.defaultLang=lang;raw.pages=raw.pages.slice(0,count+4);raw.book.mode='full';raw.book.covers={c1:{pageIndex:3},c2:{pageIndex:0},c3:{pageIndex:count+2},c4:{pageIndex:2}};
 await p.route(base+'/wheel-boundaries-test.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(raw)}));await p.goto(base+'/viewer?bookEdges=1&src=/wheel-boundaries-test.json');await p.waitForFunction(()=>+document.querySelector('#page-slider')?.max>1&&!document.body.classList.contains('viewer-empty'));await p.evaluate(()=>jumpToPage(3));await p.waitForTimeout(700);
 const wait=async s=>{try{await p.waitForFunction(s=>document.querySelector('#viewer-reader-controls').dataset.bookState===s&&!document.querySelector('.viewer-pose-transition')&&!document.querySelector('body.viewer-fan-preparing'),s);}catch(e){console.error('Expected',s,await p.evaluate(()=>({state:document.querySelector('#viewer-reader-controls').dataset.bookState,transition:document.querySelector('.viewer-pose-transition')?.dataset,classes:document.body.className})));throw e;}};
 const settled=()=>p.waitForFunction(()=>!document.querySelector('#viewer-edge-peek button').disabled&&!document.querySelector('.edge-fan-turn'));
 async function wheel(x,y,background=true){
  const center=p.viewportSize().width/2;await p.mouse.move(background?10:center,440);
  if(engine==='webkit'){
   // The Windows WebKit driver waits for scrolling after each wheel command;
   // schedule a continuous trackpad stream in the page instead.
   await p.evaluate(async({x,y,background,center})=>{for(let i=0;i<12;i++){document.elementFromPoint(background?10:center,440).dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:x/12,deltaY:y/12}));await new Promise(r=>setTimeout(r,22));}},{x,y,background,center});
  }else for(let i=0;i<12;i++){await p.mouse.wheel(x/12,y/12);if(!background)await p.mouse.move(640+(i%3),440+(i%2));await p.waitForTimeout(22);}
  await p.waitForTimeout(1000);
 }
 // Real trackpads send a stream of small deltas, not one large wheel event.
 await p.evaluate(()=>toggleUi(false));
 for(const s of ['peek','edge','spine']){await wheel(0,-120);await wait(s);}
 for(const s of ['edge','peek']){await wheel(0,120);await wait(s);}
 await settled();await p.evaluate(()=>toggleUi(true));const slider=p.locator('#viewer-edge-peek input');
 await slider.fill('2');await settled();await p.mouse.move(p.viewportSize().width/2,440);await settled();const before=+await slider.inputValue();
 await wheel(lang==='ja'?-120:120,0,false);assert.equal(+await slider.inputValue(),before+1,'trackpad selection is retained');
 await p.evaluate(()=>toggleUi(false));assert.equal(await p.locator('#viewer-reader-controls').isVisible(),false);await p.mouse.move(643,441);assert.equal(await p.locator('#viewer-reader-controls').isVisible(),false);
 const towardStart=lang==='ja'?'ArrowRight':'ArrowLeft',towardEnd=lang==='ja'?'ArrowLeft':'ArrowRight';
 const active=()=>p.locator('.edge-fan-sheet[data-active=true]').evaluateAll(ns=>ns.map(n=>n.dataset.pageLabel));
 async function fill(n){await p.evaluate(()=>toggleUi(true));await slider.fill(String(n));await settled();await p.locator('#viewer-edge-peek input').blur();}
 // Arrival stops on the endpaper, even while the key repeats.
 await fill(1);await p.keyboard.down(towardStart);await settled();assert.ok((await active()).includes('C2'));
 await p.keyboard.down(towardStart);await p.waitForTimeout(200);await wait('peek');await p.keyboard.up(towardStart);
 await p.keyboard.press(towardStart);await wait('reading');assert.ok((await p.locator('.reader-page-number').allTextContents()).includes('C1'));
 await p.keyboard.press('ArrowUp');await wait('peek');await settled();
 const last=+await slider.getAttribute('max');await fill(last-1);await p.keyboard.down(towardEnd);await settled();assert.ok((await active()).includes('C3'),'C3 also gets its own stop for an odd body count');
 await p.keyboard.down(towardEnd);await p.waitForTimeout(200);await wait('peek');await p.keyboard.up(towardEnd);
 // One full wheel stream exits once and absorbs its momentum on the cover.
 await wheel(lang==='ja'?-120:120,0);await wait('reading');assert.ok((await p.locator('.reader-page-number').allTextContents()).includes('C4'));
 await p.keyboard.press('ArrowUp');await wait('peek');await settled();assert.ok((await active()).includes('C3'),'reopening C4 keeps the back boundary even with interleaved source indexes');await fill(0);
 await p.locator(lang==='ja'?'#viewer-nav-right':'#viewer-nav-left').click();await wait('reading');assert.ok((await p.locator('.reader-page-number').allTextContents()).includes('C1'),'button exits boundary');
 // A drag reaching a boundary stops there; a new outward drag closes the cover.
 await p.keyboard.press('ArrowUp');await wait('peek');await settled();await fill(1);
 async function swipe(){
 if(engine==='chromium'){
  const r=await p.locator('.edge-peek-leaf').boundingBox(),x=r.x+r.width/2,y=r.y+r.height*.6,dx=(lang==='ja'?-1:1)*r.width*.7,cdp=await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/6,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 }else await p.locator('.edge-peek-leaf').evaluate((el,rtl)=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height*.6,dx=rtl?-r.width*.7:r.width*.7;const send=(type,n)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:77,pointerType:'touch',isPrimary:true,buttons:type==='pointerup'?0:1,clientX:x+n,clientY:y}));send('pointerdown',0);send('pointermove',dx);send('pointerup',dx);},lang==='ja');await p.waitForTimeout(800);}
 await swipe();await wait('peek');await settled();assert.ok((await active()).includes('C2'));await swipe();await wait('reading');assert.ok((await p.locator('.reader-page-number').allTextContents()).includes('C1'));
 assert.deepEqual(errors,[]);console.log(engine,count,lang,'streamed wheel, hover ownership, C2/C3 stop, C1/C4 key/button/wheel/touch passed');await p.close();
}
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
