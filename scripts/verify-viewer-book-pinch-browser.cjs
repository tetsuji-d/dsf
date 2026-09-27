const fs=require('node:fs'),assert=require('node:assert/strict'),pw=require(process.env.DSF_PLAYWRIGHT_MODULE);
const live=process.env.DSF_VERIFY_LIVE==='1';
(async()=>{for(const [engine,width,height,touch] of [['chromium',1600,1000,false],['chromium',820,1180,true],['chromium',390,844,true],['webkit',390,844,true]]){
 if(process.env.DSF_VERIFY_WIDTH&&Number(process.env.DSF_VERIFY_WIDTH)!==width)continue;
 const b=await pw[engine].launch(engine==='chromium'?{channel:'chrome'}:{});
 try{
  const p=await b.newPage({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:1}),errors=[];p.setDefaultTimeout(60000);
  p.on('pageerror',e=>errors.push(e.message));
  const url='https://staging.dsf-studio.pages.dev/viewer?work=work_mtmcqos4_bcjc5a&verify=book-pinch';
  if(!live){await p.route(url,r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('dist/viewer.html')}));await p.route('**/assets/**',r=>{const path='dist'+new URL(r.request().url()).pathname;return fs.existsSync(path)?r.fulfill({path}):r.continue()});}
  await p.goto(url);await p.mouse.move(1,1);await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);
  await p.evaluate(()=>jumpToPage(6));await p.waitForTimeout(800);
  const mode=()=>p.locator('#viewer-reader-controls').getAttribute('data-book-state');
  const waitMode=async m=>{try{await p.waitForFunction(m=>document.querySelector('#viewer-reader-controls').dataset.bookState===m&&!document.querySelector('.viewer-pose-transition,.edge-fan-turn,.edge-peek-cover-motion'),m,{timeout:10000});console.log(engine,width,'mode',m);}catch(e){console.log(await p.evaluate(()=>({state:document.querySelector('#viewer-reader-controls').dataset.bookState,peek:{...document.querySelector('#viewer-edge-peek').dataset},motion:document.querySelector('.viewer-pose-transition')?.outerHTML.slice(0,300),trace:window.pinchTrace,viewport:[innerWidth,document.documentElement.clientWidth,visualViewport.width,visualViewport.scale]})),errors);await p.screenshot({path:'outputs/book-pinch-failure.png'});throw e;}};
  const ready=()=>p.waitForFunction(()=>document.querySelector('#viewer-edge-peek').dataset.ready==='true'&&!document.querySelector('.viewer-pose-transition,.edge-fan-turn,.edge-peek-cover-motion'));
  await p.keyboard.press('ArrowUp');await waitMode(width>=700?'book':'peek');
  if(width>=700){await p.keyboard.press('ArrowUp');await waitMode('peek');}
  await ready();const baseline=await p.locator('.edge-fan-strip').evaluateAll(es=>JSON.stringify(es.map(e=>e.bookPoints)));await p.evaluate(()=>{window.pinchTrace=[];document.addEventListener('wheel',e=>pinchTrace.push([performance.now(),e.deltaY,e.ctrlKey,document.querySelector('#viewer-reader-controls').dataset.bookState]),true);});const source=await p.locator('#viewer-edge-peek').getAttribute('data-source-index');
  const cdp=engine==='chromium'&&touch?await p.context().newCDPSession(p):null;
  async function pointer(type,distance,ids=[1,2],offset=0){
   const y=height*.5,cx=width*.5+offset;
   if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:type==='pointerdown'?'touchStart':type==='pointermove'?'touchMove':type==='pointercancel'?'touchCancel':'touchEnd',touchPoints:ids.map((id,i)=>({id,x:cx+(i?1:-1)*distance/2,y}))});}
   else{await p.evaluate(({type,distance,ids,width,height,offset})=>{const el=document.querySelector('.edge-peek-leaf:not([hidden])')||document.querySelector('#click-layer');for(const [i,id] of ids.entries())el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',bubbles:true,cancelable:true,clientX:width/2+offset+(i?1:-1)*distance/2,clientY:height/2,buttons:type==='pointerup'?0:1}));},{type,distance,ids,width,height,offset});}
  }
  async function pinch(ratio,{reverse=false,cancel=false,hold=false}={}){
   if(!touch){await p.mouse.move(width/2,height/2);await p.keyboard.down('Control');await p.mouse.wheel(0,-Math.log(ratio)*100);if(reverse){await p.mouse.wheel(0,Math.log(ratio)*100);}await p.keyboard.up('Control');await p.waitForTimeout(1000);return;}
   await pointer('pointerdown',120);
   for(let i=1;i<=7;i++)await pointer('pointermove',120*(1+(ratio-1)*i/7));
   if(hold){const a=await p.locator('#viewer-edge-peek').getAttribute('data-reading');await p.waitForTimeout(160);assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-reading'),a,'pinch hold freezes transition');}
   if(reverse)for(let i=6;i>=0;i--)await pointer('pointermove',120*(1+(ratio-1)*i/7));
   await pointer(cancel?'pointercancel':'pointerup',120*(reverse?1:ratio),cdp?[]:[1,2]);await p.waitForTimeout(1000);
  }
  await pinch(1.18,{reverse:true});await waitMode('peek');assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'),source,'cancel preserves page');assert.equal(await p.locator('.edge-fan-strip').evaluateAll(es=>JSON.stringify(es.map(e=>e.bookPoints))),baseline,'cancel restores the exact peek geometry');
  await pinch(1.4,{hold:width>=700&&touch});await waitMode(width>=700?'book':'reading');
  if(width>=700){
   assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'),source);
   assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-reading'),'1.0000');
   const visible=await p.locator('.edge-fan-sheet[data-active=false]').evaluateAll(es=>es.every(e=>getComputedStyle(e).opacity==='0'));assert.ok(visible,'neighbouring content is underneath A');
   await p.evaluate(()=>toggleUi(false));await p.screenshot({path:`outputs/book-reading-${live?'staging':'local'}-${engine}-${width}.png`});
   await p.keyboard.press('ArrowLeft');await ready();assert.notEqual(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'),source,'book mode pages turn');await waitMode('book');
   if(!touch){
    const before=await p.locator('#viewer-edge-peek').getAttribute('data-source-index');
    const edge=await p.locator('.edge-fan-sheet[data-active=true][data-side=left] .edge-fan-strip').first().boundingBox();
    await p.mouse.click(edge.x+Math.min(5,edge.width/2),height/2);await ready();
    assert.notEqual(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'),before,'clicking the page fore-edge turns it');
   }
   await pinch(.7);await waitMode('peek');
   await p.evaluate(()=>toggleUi(true));await p.locator('[data-book-direction=down]').click();await waitMode('book');
   if(!touch){const chosen=await p.locator('#page-slider').inputValue();await p.keyboard.press('Escape');await waitMode('reading');assert.equal(await p.locator('#page-slider').inputValue(),chosen);}
   if(touch){const chosen=+(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'));await p.setViewportSize({width:390,height:844});await waitMode('reading');assert.equal(+(await p.locator('#page-slider').inputValue()),chosen+1,'folding preserves selected page');}
  }else{
   await pinch(.7);await waitMode('peek');assert.equal(await p.locator('#viewer-edge-peek').getAttribute('data-source-index'),source,'phone return preserves selected page');
   await pinch(1.4);await waitMode('reading');
   await pinch(1.8);assert.ok(await p.locator('body').evaluate(e=>e.classList.contains('viewer-zoom-active')),'normal outward pinch still zooms');
   const beforePan=await p.locator('#viewer-stage').evaluate(e=>getComputedStyle(e).transform);
   await pointer('pointerdown',120);await pointer('pointermove',120,[1,2],25);await pointer('pointerup',120,cdp?[]:[1,2],25);
   assert.notEqual(await p.locator('#viewer-stage').evaluate(e=>getComputedStyle(e).transform),beforePan,'two-finger pan remains available while zoomed');
   await pinch(.5);await waitMode('reading');assert.ok(await p.locator('body').evaluate(e=>!e.classList.contains('viewer-zoom-active')),'zoom first returns to 1x');
   await pinch(.7);await waitMode('peek');
   await p.screenshot({path:`outputs/book-pinch-${live?'staging':'local'}-phone.png`});
  }
  assert.deepEqual(errors,[]);console.log(engine,width,height,'pinch cancellation, reading, return, navigation and width fallback passed');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
