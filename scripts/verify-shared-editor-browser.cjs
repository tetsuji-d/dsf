const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),{createServer}=require('node:http'),{readFile}=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const {invitationsFixture}=await import('./fixtures/publishing-invitations-fixture.js'),{attachSharedEditorFixture}=await import('./fixtures/shared-editor-fixture.js');
 const f=invitationsFixture(),shared=await attachSharedEditorFixture(f),port=5212,base='http://127.0.0.1:'+port;
 for(const [uid,role]of [['reader_1','editor'],['reader_2','viewer']]){
  const id='inv_browser-'+uid.replaceAll('_','-')+'-00000001';await f.call('owner_1',{kind:'invite',id,spaceId:'space_demo',recipientUid:uid,role:'member',grants:[{role,scope:'work',targetId:'work_library'}],expiryDays:null});await f.call(uid,{kind:'accept',id});
 }
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,base);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const c of req)chunks.push(c);
   const request=new Request(url,{method:req.method,headers:req.headers,...(['POST','PUT'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const response=await (url.pathname==='/api/invitations'?f.handler:shared.handler)({request,env:{...f.env,SHARED_AUTHORING_ENABLED:'true'}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const file=url.pathname==='/'?'scripts/fixtures/publishing-invitations-ui.html':url.pathname.slice(1);
  if(!/^(js\/[a-z0-9-]+\.js|css\/publishing-invitations\.css|scripts\/fixtures\/(publishing-invitations-ui\.(html|js)|shared-editor-ui\.js))$/.test(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(path.resolve(file)));
 }catch(e){console.error(e);res.writeHead(500);res.end();}});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
  async function open(uid){const page=await browser.newPage({viewport:{width:1100,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#fixture-account').selectOption(uid);
   await page.locator('[aria-busy="true"]').waitFor({state:'detached'});await page.locator('.notification-bell').click();await page.locator('.notification-row').click();await page.getByRole('button',{name:'スペースを開く',exact:true}).click();await page.getByRole('button',{name:'原稿を開く',exact:true}).click();await page.locator('#shared-text').waitFor();return page;}
  const editor=await open('reader_1');assert.equal(await editor.locator('#shared-text').inputValue(),'港の図書館に、灯台から一通の手紙が届いた。\n司書は封を開き、静かに読み始めた。');
  await editor.locator('#shared-text').fill('検証用の共有編集です。\n灯台の明かりが見えます。');
  const png=await editor.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=640;const x=c.getContext('2d');x.fillStyle='#193854';x.fillRect(0,0,360,640);x.fillStyle='#ffd587';x.fillRect(165,100,30,340);return c.toDataURL('image/png').split(',')[1];});
  await editor.locator('#shared-image-file').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await editor.locator('#shared-images img').waitFor();await editor.waitForFunction(()=>document.querySelector('#shared-images img')?.naturalWidth===360);
  await editor.locator('#shared-save').click();await editor.getByText('保存しました。',{exact:true}).waitFor();
  const viewer=await open('reader_2');assert.equal(await viewer.locator('#shared-text').inputValue(),'検証用の共有編集です。\n灯台の明かりが見えます。');assert(await viewer.locator('#shared-text').evaluate(e=>e.readOnly));assert(await viewer.locator('#shared-save').isDisabled());assert(await viewer.locator('#shared-upload').isDisabled());await viewer.waitForFunction(()=>document.querySelector('#shared-images img')?.naturalWidth===360);
  const storedImages=[...shared.r2.objects].filter(([k])=>k.startsWith('authoring-images/'));assert.equal(storedImages.length,1);assert.equal(storedImages[0][1].httpMetadata.contentType,'image/webp');
  await viewer.setViewportSize({width:390,height:844});assert(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await viewer.screenshot({path:'outputs/shared-editor-viewer-mobile.png',fullPage:true});await editor.screenshot({path:'outputs/shared-editor-desktop.png',fullPage:true});
  f.docs.get('users/reader_1/spaceMemberships/space_demo').grants[0].role='viewer';await editor.locator('#shared-check').click();await editor.waitForFunction(()=>document.querySelector('#shared-save')?.disabled);assert.equal(await editor.locator('#shared-mode').innerText(),'閲覧のみ');
  const blob=await viewer.locator('#shared-images img').getAttribute('src');f.docs.get('users/reader_2/spaceMemberships/space_demo').status='revoked';await viewer.locator('#shared-check').click();await viewer.getByText('アクセス権限が変更されました。作品を閉じました。',{exact:true}).waitFor();assert.equal(await viewer.locator('#shared-images img').count(),0);assert(await viewer.evaluate(async url=>{try{await fetch(url);return false;}catch{return true;}},blob));
  await editor.locator('#fixture-account').selectOption('owner_1');assert.equal(await editor.locator('#shared-text').count(),0);
  assert.deepEqual(errors,[]);console.log('Shared editor browser passed: invitation to open, manuscript save, PNG to private WebP, viewer reload, permission downgrade/revocation, image URL cleanup, account switching and mobile.');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
