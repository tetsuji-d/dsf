import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { customToken, scope, operator, root, workId } from './operate-private-authoring-staging.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE || 'playwright');
async function main(){
 assert.equal(process.env.DSF_RUN_STAGING_AUTHORING_TEST,'1','Explicit staging test opt-in required');
 const browser=await chromium.launch({channel:'chrome',headless:true});let op;const errors=[],dialogs=[],requests=[];
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(45000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
  page.on('response',response=>{const p=new URL(response.url()).pathname;if(p.startsWith('/api/projects/')||p==='/upload')requests.push({path:p,status:response.status()});});
  await page.goto(`https://staging.dsf-studio.pages.dev/studio?id=${scope.projectId}&room=editor`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.loadAndOpenProject==='function');
  await page.evaluate(async token=>{const app=await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');const auth=await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');await auth.signInWithCustomToken(auth.getAuth(app.getApp()),token);},await customToken());
  await page.waitForFunction(()=>document.querySelector('#project-title')?.textContent.includes('Unit F'));
  console.log(JSON.stringify({loaded:true,title:await page.locator('#project-title').textContent(),bodyEditorVisible:await page.locator('#prop-body-text').isVisible(),errors,dialogs}));
  await page.locator('button[onclick="openProjectSettings()"]').click();
  await page.locator('#ps-book-mode').selectOption('none');
  await page.locator('button[onclick="saveProjectSettings()"]').click();
  await page.locator('#project-settings-modal').waitFor({state:'hidden'});
  const originalText=await page.locator('#prop-body-text').inputValue();
  const savedText=originalText.includes('Unit F 実画面保存確認')?originalText:originalText+'\nUnit F 実画面保存確認';
  await page.locator('#prop-body-text').fill(savedText);
  await page.locator('#project-title').fill('Unit F 接続検証（実保存確認）');await page.locator('#project-title').press('Enter');
  await page.locator('#btn-save').click();await page.waitForFunction(()=>document.querySelector('#save-status')?.dataset.saveStatus==='saved'&&document.querySelector('#save-status')?.dataset.saveTarget==='Cloud');
  op=await operator();const saved=(await op.db.doc(root).get()).data();assert.equal(saved.authoringBackend,'r2-private');
  console.log(JSON.stringify({studioSaved:true,projectName:saved.projectName,saveStatus:await page.locator('#save-status').textContent()}));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#project-title')?.textContent.includes('Unit F'));
  await page.locator('#prop-body-text').waitFor();
  assert.equal(await page.locator('#prop-body-text').inputValue(),savedText);
  console.log(JSON.stringify({studioReloadPreservedText:true}));
  await page.locator('.room-tab[data-room="press"]').click();
  await page.locator('#press-publish-cloud-btn').click();
  await page.waitForFunction(()=>document.body.dataset.room==='works',{},{timeout:120000});
  const select=page.locator(`.works-dsf-select[data-pid="${scope.projectId}"]`);await select.waitFor();
  await select.selectOption('public');await page.waitForFunction(pid=>document.querySelector(`.works-dsf-select[data-pid="${pid}"]`)?.dataset.prev==='public',scope.projectId);
  const publicRow=(await op.db.doc(`public_projects/${workId}`).get()).data();assert(publicRow);assert(!JSON.stringify(publicRow).includes('UNIT_F_PRIVATE_DO_NOT_PUBLISH'));
  await page.locator(`.works-dsf-select[data-pid="${scope.projectId}"]`).selectOption('private');
  await page.waitForFunction(pid=>document.querySelector(`.works-dsf-select[data-pid="${pid}"]`)?.dataset.prev==='private',scope.projectId);
  assert(!(await op.db.doc(`public_projects/${workId}`).get()).exists);
  console.log(JSON.stringify({pressDraftSaved:true,published:true,returnedPrivate:true,pageErrors:errors,dialogs,requests}));
  assert.deepEqual(errors,[]);
 }catch(e){console.error(JSON.stringify({failure:e.message,errors,dialogs,requests}));throw Error('Studio verification failed');}
 finally{await op?.close();await browser.close();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
