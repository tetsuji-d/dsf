const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275';
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
const p=await b.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(base+'/viewer?bookEdges=1');await p.waitForFunction(()=>typeof loadDsf==='function');await p.locator('#file-input').setInputFiles({name:'wheel.json',mimeType:'application/json',buffer:fs.readFileSync('outputs/book-edges-24.json')});await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);await p.evaluate(()=>jumpToPage(5));await p.waitForTimeout(900);
const wait=s=>p.waitForFunction(s=>document.querySelector('#viewer-reader-controls').dataset.bookState===s&&!document.querySelector('.viewer-pose-transition')&&!document.querySelector('body.viewer-fan-preparing'),s);
async function wheel(x,y){await p.mouse.move(640,440);await p.mouse.wheel(x,y);await p.waitForTimeout(1050);}
await p.evaluate(()=>toggleUi(false));await p.mouse.move(610,400);await p.mouse.move(670,420);assert.equal(await p.locator('#viewer-reader-controls').isVisible(),false,'hover does not reveal menus');
await wheel(0,-180);await wait('peek');
const scale=await p.locator('.edge-fan-sheet[data-active=true]').evaluateAll(ns=>ns.map(n=>{const strips=[...n.children],left=n.dataset.side==='left',near=left?strips.at(-1):strips[0],far=left?strips[0]:strips.at(-1);const size=s=>{const m=new DOMMatrix(getComputedStyle(s).transform),w=parseFloat(s.style.width),a=new DOMPoint(0,320).matrixTransform(m),b=new DOMPoint(w,320).matrixTransform(m);return Math.abs(b.x/b.w-a.x/a.w)/w};return {near:size(near),far:size(far)}}));for(const q of scale)assert.ok(q.near<q.far,JSON.stringify(q));
await p.evaluate(()=>toggleUi(true));await p.screenshot({path:'outputs/peek-perspective-fixed.png'});
const before=await p.locator('#viewer-edge-peek input').inputValue();await wheel(-130,0);assert.notEqual(await p.locator('#viewer-edge-peek input').inputValue(),before,'horizontal trackpad changes peek selection');
await wheel(0,180);await wait('reading');const position=await p.locator('#page-slider').inputValue();await wheel(-130,0);assert.notEqual(await p.locator('#page-slider').inputValue(),position,'horizontal trackpad turns reading page');
for(const state of ['peek','edge','spine']){await wheel(0,-180);await wait(state);}assert.ok((await p.locator('#viewer-book-pose .book-spine-title').textContent()).length>0,'thin booklet spine title visible');
for(const state of ['edge','peek','reading']){await wheel(0,180);await wait(state);}
await p.emulateMedia({reducedMotion:'reduce'});await wheel(0,-160);await wait('peek');await wheel(0,160);await wait('reading');
assert.deepEqual(errors,[]);console.log('Trackpad axes, reduced motion, perspective, hover and thin spine passed');await p.close();
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
