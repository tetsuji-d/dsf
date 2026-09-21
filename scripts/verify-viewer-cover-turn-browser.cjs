const {chromium} = require(process.env.DSF_PLAYWRIGHT_MODULE);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DSF_VIEWER_TEST_ORIGIN || 'http://127.0.0.1:5188';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/viewer-cover-loop-book.json'), 'utf8'));
(async () => {
 const browser = await chromium.launch({channel:'chrome', headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1200,height:900}});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
  async function load({rtl=true,book=true,none=false}={}) {
   await page.goto(base+'/viewer');
   await page.waitForFunction(() => typeof window.loadDsf === 'function');
   const raw = structuredClone(fixture); raw.defaultLang = rtl?'ja':'en';
   if (!book) delete raw.book;
   if (none) raw.bookMode='none';
   await page.locator('#file-input').setInputFiles({name:'cover-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
   await page.waitForFunction(() => Number(document.getElementById('page-slider').max)>1);
   await page.waitForTimeout(180);
  }
  const position=()=>page.locator('#page-slider').inputValue();
  const spine=async()=>{await page.waitForFunction(()=>document.querySelector('.viewer-cover-turn')?.dataset.progress==='0.500');await page.waitForTimeout(50);};
  const done=()=>page.locator('.viewer-cover-turn').waitFor({state:'detached'});
  async function nav(rtl,forward){await page.locator((rtl===forward)?'#viewer-nav-left':'#viewer-nav-right').click();}
  for(const rtl of [true,false]) for(const spread of [true,false]) {
   await load({rtl});
   if(!spread){await page.locator('#viewer-spread-btn').click();await page.waitForTimeout(180);}
   const max=await page.locator('#page-slider').getAttribute('max');
   await nav(rtl,false);await spine();assert.equal(await position(),'1','spine must not commit page/bookmark');
   await nav(rtl,true);await done();assert.equal(await position(),'1','opposite button returns to front');
   await nav(rtl,false);await spine();await nav(rtl,false);await done();assert.equal(await position(),max);
   await nav(rtl,false);await page.waitForTimeout(700);assert.notEqual(await position(),max,'back cover opens toward C3/body');
   await nav(rtl,true);await page.waitForTimeout(700);assert.equal(await position(),max);
   await nav(rtl,true);await spine();await nav(rtl,true);await done();assert.equal(await position(),'1');
   console.log(rtl?'RTL':'LTR',spread?'spread':'single','button detent/reverse/back opening passed');
  }
  await load();await nav(true,false);await spine();
  await page.locator('#viewer-fullscreen-btn').click();
  await page.waitForFunction(()=>!!document.fullscreenElement);
  await done();assert.equal(await position(),'1','fullscreen cancels half-turn');
  assert.equal(await page.locator('#viewer-fullscreen-btn').getAttribute('aria-pressed'),'true');
  await page.locator('#viewer-fullscreen-btn').click();await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.locator('#viewer-fullscreen-btn').getAttribute('aria-pressed'),'false');
  await nav(true,false);await spine();await page.keyboard.press('Escape');await done();assert.equal(await position(),'1');
  await nav(true,false);await spine();await page.evaluate(()=>window.switchViewerLang('en'));await done();
  await nav(false,false);await spine();await page.evaluate(()=>window.jumpToPage(3));await done();assert.equal(await position(),'3');
  console.log('fullscreen, Escape, language switch and slider cancellation passed');
  await load();
  const rect=await page.locator('#viewer-canvas').boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
  for(let i=0;i<12;i++)await page.mouse.wheel(60,0);
  await spine();await page.waitForTimeout(450);assert.equal(await position(),'1','same wheel burst cannot cross detent');
  for(let i=0;i<8;i++)await page.mouse.wheel(60,0);
  await done();assert.equal(await position(),await page.locator('#page-slider').getAttribute('max'));
  console.log('trackpad horizontal burst detent passed');
  await load({book:false});await nav(true,false);await spine();await nav(true,false);await done();assert.equal(await position(),'8','legacy even pages loop');
  await load({book:false,none:true});await nav(true,false);await page.waitForTimeout(100);assert.equal(await page.locator('.viewer-cover-turn').count(),0,'explicit coverless book does not loop');
  await load();await page.emulateMedia({reducedMotion:'reduce'});await nav(true,false);await spine();await nav(true,false);await done();assert.equal(await position(),await page.locator('#page-slider').getAttribute('max'));
  console.log('legacy, coverless and reduced motion passed');
  await load();
  const broken=structuredClone(fixture);broken.pages[7].content.backgrounds.__all=base+'/missing-cover.webp';
  await page.route('**/missing-cover.webp',route=>route.fulfill({status:404,body:'missing'}));
  await page.locator('#file-input').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(broken))});
  await page.waitForTimeout(200);await nav(true,false);await page.waitForTimeout(400);
  assert.equal(await page.locator('.viewer-cover-turn').count(),0);assert.equal(await position(),'1','image failure must not change page');
  assert.equal(await page.locator('#viewer-stage').evaluate(el=>el.style.opacity),'');
  await load();await page.emulateMedia({reducedMotion:'no-preference'});
  const r=await page.locator('#viewer-canvas').boundingBox();
  await page.mouse.move(r.x+r.width*.85,r.y+r.height*.5);await page.mouse.down();
  await page.mouse.move(r.x+r.width*.15,r.y+r.height*.5,{steps:12});await page.mouse.up();await spine();
  await page.keyboard.press('Escape');await done();
  console.log('failed image restoration and mouse drag passed');
  await page.close();
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  mobile.on('pageerror',e=>errors.push(e.message));
  await mobile.goto(base+'/viewer?src=/scripts/fixtures/viewer-cover-loop-book.json');
  await mobile.waitForFunction(()=>document.getElementById('page-slider').max==='8');await mobile.waitForTimeout(200);
  const cdp=await mobile.context().newCDPSession(mobile);
  async function swipe(direction,cancel=false) {
   const r=await mobile.locator('#viewer-canvas').boundingBox(),x=r.x+r.width*(direction<0?.85:.15),y=r.y+r.height*.5;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+direction*r.width*.7*i/12,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await mobile.waitForTimeout(600);
  }
  await swipe(-1);assert.equal(await mobile.locator('.viewer-cover-turn').getAttribute('data-progress'),'0.500');
  await swipe(1);assert.equal(await mobile.locator('.viewer-cover-turn').count(),0);assert.equal(await mobile.locator('#page-slider').inputValue(),'1');
  await swipe(-1,true);assert.equal(await mobile.locator('.viewer-cover-turn').getAttribute('data-progress'),'0.500');
  await swipe(-1);assert.equal(await mobile.locator('#page-slider').inputValue(),'8');
  await mobile.waitForTimeout(400);await swipe(-1);assert.equal(await mobile.locator('#page-slider').inputValue(),'7','swipe from back opens C3');
  await mobile.evaluate(()=>window.jumpToPage(1));await mobile.waitForTimeout(350);await swipe(-1);
  await mobile.setViewportSize({width:844,height:390});await mobile.waitForTimeout(200);assert.equal(await mobile.locator('.viewer-cover-turn').count(),0);assert.equal(await mobile.locator('#page-slider').inputValue(),'1');
  await mobile.setViewportSize({width:390,height:844});await mobile.waitForTimeout(200);
  const edge=await mobile.locator('#viewer-canvas').boundingBox(),ex=edge.x+8,ey=edge.y+edge.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ex,y:ey}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ex+edge.width*.25,y:ey}]});
  assert.equal(await mobile.locator('.viewer-page-curl').count(),1,'ordinary cover opening retains interactive page curl');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(600);
  assert.equal(await mobile.locator('#page-slider').inputValue(),'1','short opening drag cancels');
  console.log('mobile touch, reversal, cancellation, back opening and rotation passed');
  assert.deepEqual(errors,[]);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
