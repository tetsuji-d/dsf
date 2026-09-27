const fs=require('node:fs'),assert=require('node:assert/strict'),pw=require(process.env.DSF_PLAYWRIGHT_MODULE);
const live=process.env.DSF_VERIFY_LIVE==='1';
(async()=>{for(const engine of (process.env.DSF_VERIFY_ENGINE?[process.env.DSF_VERIFY_ENGINE]:['chromium','webkit'])){
 const b=await pw[engine].launch(engine==='chromium'?{channel:'chrome'}:{});try{
 const p=await b.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true}),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(45000);
 const url='https://staging.dsf-studio.pages.dev/viewer?bookEdges=1&verify=edge-tap';
 if(!live){await p.route(url,r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('dist/viewer.html')}));await p.route('**/assets/**',r=>{const path='dist'+new URL(r.request().url()).pathname;return fs.existsSync(path)?r.fulfill({path}):r.continue()});}
 const cdp=engine==='chromium'?await p.context().newCDPSession(p):null;
 let pointers=[];
 async function touch(type,points){
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  else await p.evaluate(({type,points,previous})=>{
   const entries=type==='touchEnd'||type==='touchCancel'?previous.filter(a=>!points.some(b=>b.id===a.id)):points;
   for(const q of entries){const target=document.querySelector('.edge-peek-leaf:not([hidden])')||document.querySelector('#click-layer');target.dispatchEvent(new PointerEvent({touchStart:'pointerdown',touchMove:'pointermove',touchEnd:'pointerup',touchCancel:'pointercancel'}[type],{bubbles:true,cancelable:true,pointerType:'touch',pointerId:q.id,isPrimary:q.id===1,clientX:q.x,clientY:q.y,button:0,buttons:type==='touchEnd'?0:1}));}
  },{type,points,previous:pointers});
  pointers=points;
 }
 const pause=ms=>p.waitForTimeout(ms),pos=async()=>+(await p.locator('#page-slider').inputValue());
 async function settle(){await pause(450);await p.waitForFunction(()=>!document.querySelector('.viewer-page-curl,.edge-fan-turn,.viewer-pose-transition,.edge-peek-cover-motion'));}
 async function point(side){return p.locator('#viewer-canvas').evaluate((e,side)=>{const r=e.getBoundingClientRect();return {x:side==='left'?r.left+12:side==='right'?r.right-12:r.left+r.width/2,y:r.top+r.height*.45,id:1};},side);}
 async function tap(q,{hold=60,cancel=false,jitter=0}={}){await touch('touchStart',[q]);await pause(hold);if(jitter)await touch('touchMove',[{...q,x:q.x+jitter}]);await touch(cancel?'touchCancel':'touchEnd',[]);}
 async function load(lang){await p.goto(url);await p.waitForFunction(()=>typeof loadDsf==='function');const raw=await p.evaluate(lang=>{const c=document.createElement('canvas');c.width=360;c.height=640;const ctx=c.getContext('2d');ctx.fillStyle='#eee8d6';ctx.fillRect(0,0,360,640);ctx.fillStyle='#345';ctx.font='24px sans-serif';ctx.fillText('Edge tap test',80,300);const image=c.toDataURL('image/webp');return {title:'Edge tap fixture',languages:['ja','en'],defaultLang:lang,languageConfigs:{ja:{pageDirection:'rtl'},en:{pageDirection:'ltr'}},pages:Array.from({length:20},(_,i)=>({id:'tap-'+i,content:{backgrounds:{__all:image}}})),book:{mode:'full',covers:{c1:{pageIndex:0},c2:{pageIndex:1},c3:{pageIndex:18},c4:{pageIndex:19}}}};},lang);await p.locator('#file-input').setInputFiles({name:'edge-tap.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);await p.evaluate(()=>{jumpToPage(8);toggleUi(false);});await settle();}
 for(const lang of ['ja','en']){
  await load(lang);const sign=lang==='ja'?1:-1,start=await pos(),left=await point('left'),right=await point('right');
  await p.touchscreen.tap(left.x,left.y);await settle();assert.equal(await pos(),start+sign,'left tap turns exactly one page');
  await tap(right,{jitter:-3});await settle();assert.equal(await pos(),start,'right tap reverses');
  await tap(left);await settle();await tap(left);await settle();assert.equal(await pos(),start+2*sign,'successive taps survive compatibility-click suppression');assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('viewer-zoom-active')),false,'edge taps do not double-tap zoom');
  await p.emulateMedia({reducedMotion:'reduce'});let fastBefore=await pos();await tap(right,{hold:30});await pause(50);await tap(right,{hold:30});await settle();assert.equal(await pos(),fastBefore-2*sign,'fast successive taps turn twice');assert.equal(await p.locator('body').evaluate(e=>e.classList.contains('viewer-zoom-active')),false);await p.emulateMedia({reducedMotion:'no-preference'});
  let before=await pos();await tap(left,{hold:450});await settle();assert.equal(await pos(),before,'hold does not turn');await tap(left,{cancel:true});await settle();assert.equal(await pos(),before,'cancel does not turn');
  await touch('touchStart',[left]);await touch('touchMove',[{...left,x:left.x+22}]);await touch('touchMove',[left]);await touch('touchEnd',[]);await settle();assert.equal(await pos(),before,'returned swipe does not become a tap');
  // Slow complete swipe beginning inside the edge zone: one turn only, no extra click turn.
  await touch('touchStart',[left]);for(let i=1;i<=6;i++){await pause(100);await touch('touchMove',[{...left,x:left.x+260*i/6}]);}await touch('touchEnd',[]);await settle();assert.equal(await pos(),before+sign,'edge-origin swipe turns once');
  await pause(950);const center=await point('center');await p.touchscreen.tap(center.x,center.y);await p.waitForFunction(()=>document.body.classList.contains('viewer-ui-visible'));assert.ok(await p.locator('body').evaluate(e=>e.classList.contains('viewer-ui-visible')),'center opens menu');await p.evaluate(()=>toggleUi(false));
  before=await pos();await touch('touchStart',[left,{...left,id:2,x:left.x+80}]);await touch('touchEnd',[left]);await touch('touchEnd',[]);await settle();assert.equal(await pos(),before,'pinch tail cannot tap');
  await p.keyboard.press('ArrowUp');await p.waitForFunction(()=>document.querySelector('#viewer-reader-controls').dataset.bookState==='peek'&&document.querySelector('#viewer-edge-peek').dataset.ready==='true');await settle();
  const edge=await p.locator('.edge-fan-sheet[data-active=true][data-side=left] .edge-fan-strip').first().boundingBox(),q={x:edge.x+8,y:edge.y+edge.height*.5,id:1};
  const peekBefore=+(await p.locator('#viewer-edge-peek').getAttribute('data-spread-position'));await tap(q);await settle();assert.equal(+(await p.locator('#viewer-edge-peek').getAttribute('data-spread-position')),peekBefore+sign,'peek tap turns one spread');assert.equal(await p.locator('#viewer-reader-controls').getAttribute('data-book-state'),'peek','peek remains peek');
  console.log(engine,lang,'edge taps, reverse, repeats, hold/cancel, returned swipe, swipe, central menu, pinch tail and peek passed');
 }
 assert.deepEqual(errors,[]);
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
