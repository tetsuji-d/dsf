const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/viewer?bookEdges=1');
 await page.waitForFunction(()=>typeof window.loadDsf==='function');
 const books=await page.evaluate(()=>{
   function make(n){
     const pages=Array.from({length:n},(_,i)=>{
       const c=document.createElement('canvas');c.width=360;c.height=640;const g=c.getContext('2d');
       const cover=i===0||i===n-1,inside=i===1||i===n-2;
       g.fillStyle=cover?'#173d42':inside?'#e3e8db':'#faf7ef';g.fillRect(0,0,360,640);
       g.fillStyle=cover?'#f4eddb':'#263e3c';g.font='12px serif';
       g.fillText(cover?'DSF EDITIONS / READING STUDY':inside?'潮騒の図書館':'海辺の小さな図書館',32,48);
       if(cover){g.font='30px serif';g.fillText(i===0?'潮騒の図書館':'物語の、その先へ',32,210);g.font='14px serif';g.fillText('本の厚さと、読む場所。',34,255);g.fillText('小口の試作 / '+n+' ページ',34,530);}
       else if(!inside){g.font='15px serif';for(let l=0;l<19;l++)g.fillText(['海辺の図書館には、静かな時間が流れていた。','窓の向こうで波が光り、ページの端を風が撫でる。','読みかけの本に指を挟み、少し先を覗いてみる。','あの挿絵はどこにあっただろう。紙の束を辿る。'][l%4],32,115+l*22);}
       g.font='12px serif';g.fillText(String(i+1).padStart(3,'0')+' / '+n,32,601);
       return {id:'edge-page-'+i,content:{backgrounds:{__all:c.toDataURL('image/webp',.85)},bubbles:{}}};
     });
     return {title:'潮騒の図書館',languages:['ja','en'],defaultLang:'ja',languageConfigs:{ja:{pageDirection:'rtl'},en:{pageDirection:'ltr'}},pages,book:{mode:'full',covers:{c1:{pageIndex:0},c2:{pageIndex:1},c3:{pageIndex:n-2},c4:{pageIndex:n-1}},spineDesign:{title:'潮騒の図書館',author:'読書体験の試作',backgroundColor:'#173d42',textColor:'#f4eddb',fontSize:18}}};
   }
   return [24,120,480].map(make);
 });
 fs.mkdirSync('outputs',{recursive:true});
 for(const raw of books)fs.writeFileSync('outputs/book-edges-'+raw.pages.length+'.json',JSON.stringify(raw));
 async function load(raw,{enabled=true,mobile=false}={}){
   await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:950});
   await page.goto(base+'/viewer'+(enabled?'?bookEdges=1':''));
   await page.waitForFunction(()=>typeof window.loadDsf==='function');
   await page.locator('#file-input').setInputFiles({name:'edges.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
   await page.waitForFunction(()=>Number(document.querySelector('#page-slider').max)>1);
   await page.waitForTimeout(250);
 }
 const edge=()=>page.locator('#viewer-canvas > .viewer-book-edges').evaluate(el=>({t:+el.dataset.thickness,l:+el.dataset.left,r:+el.dataset.right}));
 const position=()=>page.locator('#page-slider').inputValue();
 const settle=async()=>{await page.locator('.viewer-page-curl').waitFor({state:'detached'});await page.waitForTimeout(60);};
 const sizes=[];
 for(const raw of books){await load(raw);sizes.push((await edge()).t);}
 assert.ok(sizes[0]<sizes[1]&&sizes[1]<sizes[2]);
 console.log('24/120/480-page books produce increasing thickness:',sizes);
 for(const rtl of [true,false]){
   const raw=structuredClone(books[1]);raw.defaultLang=rtl?'ja':'en';await load(raw);
   const start=await edge();assert.equal(start[rtl?'r':'l'],0);
   await page.evaluate(()=>window.jumpToPage(3));await settle();
   const early=await edge(),rect1=await page.locator('#viewer-canvas').boundingBox();
   await page.evaluate(()=>window.jumpToPage(30));await settle();
   const middle=await edge(),rect2=await page.locator('#viewer-canvas').boundingBox();
   assert.equal(rect1.width,rect2.width);assert.equal(rect1.x,rect2.x);
   assert.ok(rtl?middle.r>early.r:middle.l>early.l);
   const prev=await position();await page.evaluate(rtl=>window[rtl?'viewerNavLeft':'viewerNavRight'](),rtl);
   await page.locator('.viewer-page-curl').waitFor();assert.equal(await position(),prev);
   assert.equal(await page.locator('.viewer-page-curl .book-page-edge').count(),2);
   await settle();assert.notEqual(await position(),prev);
   await page.screenshot({path:'outputs/book-edges-'+(rtl?'rtl':'ltr')+'-spread.png'});
   await page.evaluate(()=>window.jumpToPage(1));await settle();
   await page.evaluate(rtl=>window[rtl?'viewerNavRight':'viewerNavLeft'](),rtl);
   await page.waitForFunction(()=>document.querySelector('.viewer-cover-turn')?.dataset.progress==='0.500');
   assert.equal(await position(),'1');
   const spineWidth=await page.locator('.vct-spine').evaluate(el=>parseFloat(getComputedStyle(el).width));
   assert.ok(Math.abs(spineWidth-start.t)<.02);
   await page.screenshot({path:'outputs/book-edges-'+(rtl?'rtl':'ltr')+'-spine.png'});
   await page.keyboard.press('Escape');await page.locator('.viewer-cover-turn').waitFor({state:'detached'});
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
   await page.evaluate(()=>window.jumpToPage(3));await settle();
   const cdp=await page.context().newCDPSession(page);
   async function drag(ratio,accept){
     const r=await page.locator('#viewer-canvas').boundingBox(),x=rtl?r.x+8:r.x+r.width-8,y=r.y+r.height*.5,sign=rtl?1:-1;
     const before=await position();
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+sign*r.width*ratio,y}]});
     await page.locator('.viewer-page-curl').waitFor();
     assert.equal(await position(),before);
     const m=await page.locator('.vpc-world').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a);
     assert.ok(m<1&&m>=.899,'single-page turn must still recede');
     if(accept)await page.screenshot({path:'outputs/book-edges-'+(rtl?'rtl':'ltr')+'-touch-curl.png'});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
     assert.equal((await position())!==before,accept);
     await page.waitForTimeout(950);
   }
   await drag(.10,false);await drag(.70,true);
   await page.screenshot({path:'outputs/book-edges-'+(rtl?'rtl':'ltr')+'-single.png'});
   await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(rtl=>window[rtl?'viewerNavRight':'viewerNavLeft'](),rtl);
   assert.equal(await page.locator('.viewer-page-curl').count(),0);
   await page.emulateMedia({reducedMotion:'no-preference'});
   const same=await position();await page.setViewportSize({width:844,height:390});await page.waitForTimeout(250);
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.equal(await position(),same);
   console.log(rtl?'RTL':'LTR','spread, stable frame, dynamic spine, touch curl shrink/commit/cancel, rotation, reduced motion passed');
 }
 await load(books[1],{enabled:false});assert.equal(await page.locator('#viewer-canvas > .viewer-book-edges').count(),0);
 await page.evaluate(()=>window.viewerNavRight());await page.waitForFunction(()=>document.querySelector('.viewer-cover-turn')?.dataset.progress==='0.500');
 assert.equal(await page.locator('.vct-spine').evaluate(el=>parseFloat(getComputedStyle(el).width)),32);
 const none=structuredClone(books[0]);none.book={mode:'none'};none.bookMode='none';await load(none);
 assert.equal(await page.locator('#viewer-canvas > .viewer-book-edges').count(),0);
 assert.deepEqual(errors,[]);console.log('Opt-out, coverless book, and browser errors passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
