const assert=require('node:assert/strict');
const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.OWNER_IMAGES_URL||'http://127.0.0.1:5250';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/studio?room=editor&id=book_library&actor=owner');
 await page.waitForFunction(()=>window.fixtureStudio?.state.blocks.some(b=>b.id==='private_cover'&&b.content.background.startsWith('blob:')));
 const before=await page.evaluate(()=>window.fixtureStudio.state.blocks.find(b=>b.kind==='flow').flow.document.sections[0].blocks[0].texts.ja);
 assert.equal(await page.evaluate(async()=>{const url=window.fixtureStudio.state.blocks.find(b=>b.id==='private_cover').content.background;const img=new Image();img.src=url;await img.decode();return img.naturalWidth;}),1);
 // The real clipboard importer converts PNG to WebP and saves it through the owner path.
 await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=40;c.height=60;c.getContext('2d').fillRect(0,0,40,60);const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'clipboard.png',{type:'image/png'}));document.querySelector('#canvas-view').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
 await page.waitForFunction(()=>window.fixtureStudio.state.blocks.filter(b=>b.kind==='page').length===2);
 await page.locator('#prop-title').fill('非公開画像の保存検証');
 await page.locator('#btn-save').click();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Cloud'),null,{timeout:30000}).catch(async e=>{console.error(await page.locator('#save-status').textContent());throw e;});
 const getSource=async()=>{const r=await page.request.get(base+'/api/projects/book_library/authoring',{headers:{Authorization:'Bearer fixture-owner_1'}});assert.equal(r.status(),200);return r.json();};
 const source=await getSource();assert.equal(source.title,'非公開画像の保存検証');assert(source.blocks.filter(b=>b.kind==='page').every(b=>/^assets\/private\/[a-f0-9]{64}\.webp$/.test(b.content.background)));
 assert.equal(source.blocks.find(b=>b.kind==='flow').flow.document.sections[0].blocks[0].texts.ja,before);
 await page.reload();await page.waitForFunction(()=>window.fixtureStudio?.state.blocks.filter(b=>b.kind==='page'&&b.content.background.startsWith('blob:')).length===2);
 const types=await page.evaluate(async()=>Promise.all(window.fixtureStudio.state.blocks.filter(b=>b.kind==='page').map(async b=>(await(await fetch(b.content.background)).blob()).type)));assert.deepEqual(types,['image/webp','image/webp']);
 const status=await(await page.request.get(base+'/fixture/status')).json();assert.equal(status.publicWrites,0);assert.equal(status.personalWrites,0);
 await page.screenshot({path:'outputs/owner-private-images.png'});assert.deepEqual(errors,[]);
 console.log('Owner real Studio: private image decode, PNG clipboard paste to private WebP, cloud save/reload, manuscript preservation and zero public uploads passed.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
