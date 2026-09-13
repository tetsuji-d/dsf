const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:5178/scripts/fixtures/viewer-reading-assist-ui.html');
 const body=p.locator('#paper'),line=body.locator('.text-line').nth(2),r=await line.boundingBox();
 await p.mouse.move(r.x+r.width/2,r.y+80);assert.ok(await line.evaluate(e=>e.classList.contains('active')));
 const lens=p.locator('.lens-window .paper');assert.ok(await lens.locator('ruby').count()>0);assert.equal(await lens.getAttribute('aria-hidden'),'true');
 const before=await body.boundingBox();await p.locator('#zoom').selectOption('3');const m3=await lens.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);
 await p.locator('#zoom').selectOption('1.5');assert.ok(Math.abs(m3/2-await lens.evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a))<.001);
 await p.locator('#zoom').selectOption('2');await p.screenshot({path:require('node:os').tmpdir()+'/reader-assist-lens.png'});
 await p.locator('button[data-mode=focus]').click();assert.equal(await line.evaluate(e=>getComputedStyle(e).filter),'none');
 assert.ok((await body.locator('.text-line:not(.active)').first().evaluate(e=>getComputedStyle(e).filter)).startsWith('blur('));
 assert.deepEqual(await body.boundingBox(),before);await p.screenshot({path:require('node:os').tmpdir()+'/reader-assist-focus.png'});
 await body.focus();await p.keyboard.press('ArrowDown');assert.ok(await body.locator('.text-line').nth(3).evaluate(e=>e.classList.contains('active')));
 await p.locator('#writing').selectOption('horizontal');await p.locator('button[data-mode=lens]').click();
 await p.locator('#next').click();assert.ok(await body.locator('.text-line').nth(1).evaluate(e=>e.classList.contains('active')));
 await p.setViewportSize({width:390,height:844});await p.locator('#writing').selectOption('vertical');
 const box=await body.boundingBox(),cdp=await p.context().newCDPSession(p);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.7,y:box.y+70}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.5,y:box.y+100}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const lr=await p.locator('.lens-window').boundingBox();assert.ok(lr.x>=0&&lr.x+lr.width<=390&&lr.y+lr.height<=844);
 await p.screenshot({path:require('node:os').tmpdir()+'/reader-assist-mobile.png'});assert.deepEqual(errors,[]);
 // Canonical Viewer overlay: adjacent ruby collision and scale invariance.
 await p.goto('http://127.0.0.1:5178/viewer.html');await p.waitForFunction(()=>document.body.dataset.readingGuides==='off');
 const results=await p.evaluate(async()=>{
 const {paintViewerReadingGuides}=await import('/js/viewer-reading-guide-geometry.js');const stage=document.getElementById('viewer-stage');const results=[];
 for(const scale of [.78,.98,1.5]){
  const page=document.createElement('div');page.className='viewer-fixed-text-page';Object.assign(page.style,{width:'360px',height:'640px',transform:`scale(${scale})`,transformOrigin:'top left'});
  const create=(text,x,y,w,h,annotation=false)=>{const e=document.createElement('div');e.className='viewer-fixed-text-line'+(!annotation?' reading-line-active':'');if(!annotation)e.dataset.readingLine='vertical';Object.assign(e.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px',writingMode:'vertical-rl',fontSize:(annotation?10:18)+'px',fontFamily:'serif',lineHeight:'1'});e.textContent=text;page.append(e);return e};
  const main=create('海辺の約束を思い出していた。',110,20,18,320);const a=create('たちかわ',101,75,10,50,true);stage.append(page);
  const before=main.getBoundingClientRect().toJSON();paintViewerReadingGuides(stage,{enabled:true,mode:'active'});
  const range=document.createRange();range.selectNodeContents(a);const ruby=range.getBoundingClientRect();
  const paths=[...page.querySelectorAll('.reader-line-overlay line')];const noCollision=paths.every(e=>{const r=e.getBoundingClientRect();return r.right<ruby.left||r.left>ruby.right||r.bottom<ruby.top||r.top>ruby.bottom});
  results.push({scale,noCollision,segments:paths.length,unchanged:JSON.stringify(before)===JSON.stringify(main.getBoundingClientRect().toJSON())});page.remove();
 }return results;});
 for(const r of results){assert.ok(r.noCollision&&r.unchanged&&r.segments>=2,JSON.stringify(r));}console.log('Prototype mouse/keyboard/touch modes, ruby preservation, zoom, mobile and actual Viewer ruby exclusion',results);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
