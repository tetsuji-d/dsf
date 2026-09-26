const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275';
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
for(const lang of ['ja','en']){
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),cdp=await p.context().newCDPSession(p);await p.goto(base+'/viewer?bookEdges=1');await p.waitForFunction(()=>typeof loadDsf==='function');const raw=JSON.parse(fs.readFileSync('outputs/book-edges-120.json','utf8'));raw.defaultLang=lang;await p.locator('#file-input').setInputFiles({name:'directions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);await p.waitForTimeout(300);
 await p.evaluate(()=>{jumpToPage(50);toggleUi(false);});await p.waitForTimeout(300);
 async function swipe(dx,{edge=false,pause=0,cancel=false}={}){const r=await p.locator('#viewer-canvas').boundingBox(),x=edge?r.x+r.width-12:r.x+r.width/2,y=r.y+r.height*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let i=1;i<=5;i++){await p.waitForTimeout(10);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/5,y,id:1}]});}if(pause)await p.waitForTimeout(pause);await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});}
 const pos=async()=>+(await p.locator('#page-slider').inputValue());
 const first=await pos();await swipe(-280,{edge:true});await p.waitForTimeout(2100);const last=await pos();assert.ok(lang==='ja'?last<first-1:last>first+1,lang+' edge flick direction');
 const paused=await pos();await swipe(125,{pause:220});await p.waitForTimeout(900);assert.ok(Math.abs(await pos()-paused)<=1,'a pause before release removes inertia');
 await p.evaluate(()=>{document.activeElement.blur();toggleUi(true);});await p.keyboard.press('ArrowUp');await p.locator('#viewer-edge-peek .edge-peek-leaf').waitFor();await p.locator('.viewer-pose-transition').waitFor({state:'detached'});await p.locator('#viewer-edge-peek input').fill('50');await p.waitForTimeout(400);await swipe(65);await p.waitForTimeout(750);const selected=+(await p.locator('#viewer-edge-peek input').inputValue());assert.ok(lang==='ja'?selected>50:selected<50,lang+' reversed preview swipe');
 assert.ok(await p.locator('.edge-fan-strip').count()<220,'hidden block layers are not rendered as meshes');
 await p.keyboard.press('Escape');await p.close();console.log(lang,{first,last,selected});
}
console.log('RTL/LTR edge flick, release pause, reversed preview swipe and bounded mesh count passed');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
