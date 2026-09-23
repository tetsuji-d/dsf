const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const app=fs.readFileSync('js/app.js','utf8');
const renderer=app.slice(app.indexOf('let homeDashboardRenderRevision = 0;'),app.indexOf('// ── Studio 認証 UI',app.indexOf('let homeDashboardRenderRevision = 0;')));
const helper=fs.readFileSync('js/home-load.js','utf8').replaceAll('export ','').replace('ms = 12000','ms = 160');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main><div id="home-cloud-scope"></div><div id="home-dashboard-stats"></div><div id="home-work-count"></div><div id="home-work-grid"></div><div id="home-cloud-count"></div><div id="home-cloud-grid"></div><div id="home-local-count"></div><div id="home-local-grid"></div></main>');
 await page.addStyleTag({content:fs.readFileSync('css/studio.css','utf8')});
 await page.addScriptTag({content:helper+`
 const state={uid:'owner'},getUILang=()=> 'ja',t=k=>({home_loading:'読み込み中…',home_cloud_error:'読み込めませんでした'}[k]||k);
 const syncSpaceMembersSettings=()=>{},bindProjectActions=()=>{};
 const getHomeWorkspace=()=>({render(){}}),space={load(){},render(){},filter:p=>p,destination:()=>'',label:()=>'',selection:()=>null,bind(){}},getPublishingSpaceUI=()=>space;
 let mode='pending',calls=0,resolveOld;
 const fetchCloudProjects=()=>{calls++;return mode==='pending'?new Promise(r=>resolveOld=r):Promise.resolve([{id:mode,title:mode}]);};
 const listLocalRecentProjects=()=>new Promise(()=>{});
 const renderHomeLocalProjects=()=>{},renderHomeStatCard=()=>'',renderHomeDashboardStats=()=>'',isPublishedHomeWork=()=>false;
 const renderHomeCard=p=>'<article class="home-project-card" data-id="'+p.id+'">'+p.title+'</article>';
 const bindHomeWorkActions=()=>{},syncStudioShell=()=>{};
 `+renderer.replace('listLocalRecentProjects(), 5000','listLocalRecentProjects(), 80')+`
 window.run=renderHomeDashboard;window.setMode=m=>mode=m;window.count=()=>calls;window.resolveOld=()=>resolveOld([{id:'stale',title:'stale'}]);`});
 await page.evaluate(()=>{void run();});
 await page.locator('#home-cloud-grid .home-folder-loading').waitFor();
 assert.equal(await page.locator('#home-cloud-grid i').first().evaluate(e=>getComputedStyle(e).animationName),'home-folder-paper');
 await page.locator('#home-cloud-grid [data-home-retry]').waitFor();
 await page.evaluate(()=>setMode('recovered'));
 await page.locator('#home-cloud-grid [data-home-retry]').click();
 await page.getByText('recovered',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>count()),2);
 await page.evaluate(()=>{resolveOld();});
 assert.equal(await page.locator('#home-cloud-grid .home-project-card').innerText(),'recovered');
 await page.evaluate(()=>run());assert.equal(await page.evaluate(()=>count()),2);
 await page.evaluate(()=>{setMode('fresh');void run({forceRefresh:true});});
 await page.getByText('fresh',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>count()),3);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'outputs/home-loading-recovery.png'});
 console.log('Dashboard browser passed: animated pending state, bounded error, click retry, local stall isolation, late response rejection, reuse and forced refresh.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
