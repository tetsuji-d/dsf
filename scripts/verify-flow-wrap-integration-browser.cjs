const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();await page.goto('http://127.0.0.1:5178/scripts/fixtures/flow-image-wrap-lab.html');console.log(await page.evaluate(async({captionMode,pausedFrames})=>{
 if(pausedFrames)window.requestAnimationFrame=()=>0;
 const {createFlowGroupBlock}=await import('/js/flow-project-model.js');const {createGraphicObject}=await import('/js/graphic-object-model.js');
 const {prepareFlowPressPublication}=await import('/js/flow-press-publication-preparation.js');
 const {composeFlowWithAnchoredObjects,validateFlowWrapPagination}=await import('/js/flow-wrap-composition.js');
 const {renderFlowGeneratedPage,resolveFlowDomTypography}=await import('/js/flow-dom-measurer.js');const {createCanonicalFlowPageBox}=await import('/js/flow-pagination.js');
 const {createEditorFlowPreview}=await import('/js/press.js');const {state}=await import('/js/state.js');const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');
 const {createFlowPressHorizonReleaseHandoff}=await import('/js/flow-press-horizon-release-handoff.js');
 const {createFlowPressLocalReleasePlanning}=await import('/js/flow-press-local-release-planning.js');const {sealDsfWebPAsset}=await import('/js/dsf-release-byte-sealing.js');const {createDsfReleaseFileInventory}=await import('/js/dsf-release-file-inventory.js');
 const {serializeProject,deserializeProject}=await import('/js/project-persistence.js');
 const check=(v,m)=>{if(!v)throw Error(m)};let cases=0,glyphs=0;
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle='#168db4';ctx.fillRect(0,0,320,480);ctx.fillStyle='#fff';ctx.fillRect(100,40,50,400);const blob=await new Promise(r=>canvas.toBlob(r,'image/webp'));const asset={id:'asset',name:'Lighthouse.webp',background:URL.createObjectURL(blob),thumbnail:URL.createObjectURL(blob),width:320,height:480,byteLength:blob.size,mimeType:'image/webp'};
 for(const language of ['ja','en-us'])for(const wrap of ['square','band'])for(const position of (captionMode?['top','bottom','left','right']:['none'])){
  const writingMode=language==='ja'?'vertical-rl':'horizontal-tb';
  const group=createFlowGroupBlock({id:'flow',sourceLanguage:language,writingMode,document:{sourceLanguage:language,sections:[{id:'s',blocks:[{id:'a',type:'paragraph',texts:{[language]:language==='ja'?'灯台と約束。'.repeat(80):'The lighthouse stood above the quiet harbor. '.repeat(40)}},{id:'b',type:'paragraph',texts:{[language]:language==='ja'?'青い海を眺めた。'.repeat(30):'A letter waited on the desk. '.repeat(20)}}]}]}});
  if(language==='ja'){group.flow.document.schemaVersion=2;group.flow.document.sections[0].blocks[0].annotations={ja:[{id:'ruby',type:'ruby',start:0,end:2,reading:'とうだい'},{id:'emphasis',type:'emphasis',start:3,end:5,mark:'sesame'}]};}
  const graphic=createGraphicObject('image','graphic',language,{assetId:asset.id});graphic.frame={x:8,y:32,width:90,height:130,rotation:0};const shape=createGraphicObject('shape','shape',language,{shape:'ellipse'});shape.frame={x:164,y:60,width:100,height:110,rotation:0};
  if(captionMode){graphic.frame={x:70,y:60,width:90,height:130,rotation:0};graphic.caption={position,texts:{[language]:language==='ja'?'灯台のある岬\n海辺を歩く人々の記録':'Lighthouse near the harbor\nA walk by the sea'},fontSize:10,gap:4,color:'#172c40',align:'center'};shape.frame={x:170,y:65,width:65,height:90,rotation:0};}
  group.flow.layout.schemaVersion=captionMode?3:2;group.flow.layout.anchoredObjects=[{id:'image',anchorBlockId:'a',graphic,wrap,gapEm:.75},{id:'shape',anchorBlockId:captionMode?'a':'b',graphic:shape,wrap,gapEm:.75}];
  const profile=group.flow.layout.typographyByLanguage[language],typography=resolveFlowDomTypography(language,profile,writingMode),pageBox=createCanonicalFlowPageBox({padding:group.flow.layout.padding});
  if(captionMode){
   const short=structuredClone(group);short.flow.document.schemaVersion=1;
   short.flow.document.sections[0].blocks.forEach(b=>{b.texts[language]=language==='ja'?'灯台から届く手紙。':'A letter from the lighthouse.';delete b.annotations;});
   short.flow.layout.anchoredObjects[1].anchorBlockId='b';
   const joined=composeFlowWithAnchoredObjects(short,{pageBox,languageKey:language,writingMode,typography});validateFlowWrapPagination(short,joined,typography);
   check(joined.pages.some(p=>p.anchoredObject?.objects?.length===2),'distinct anchors must share a page when they fit');
  }
  const opts={pageBox,languageKey:language,writingMode,typography},pagination=composeFlowWithAnchoredObjects(group,opts);validateFlowWrapPagination(group,pagination,typography);
  const backgroundCount=captionMode?1:2;check(pagination.pages.filter(p=>p.anchoredObject).length===backgroundCount,'background page count');
  if(language==='ja'&&wrap==='square'){
   const changed=structuredClone(group);changed.flow.document.sections[0].blocks.unshift({id:'prefix',type:'paragraph',texts:{ja:'前の文章が増えました。'.repeat(120)}});
   const moved=composeFlowWithAnchoredObjects(changed,opts);const before= pagination.pages.find(p=>p.anchoredObject?.id==='image'),after=moved.pages.find(p=>p.anchoredObject?.id==='image');
   check(after.index>before.index,'image does not follow paragraph');check(JSON.stringify(after.anchoredObject)===JSON.stringify(before.anchoredObject),'page-local image placement changed');
   const tampered=structuredClone(pagination);tampered.pages.find(p=>p.anchoredObject).anchoredObject.x++;
   let blocked=false;try{validateFlowWrapPagination(group,tampered,typography);}catch{blocked=true;}check(blocked,'stale graphic geometry accepted');
  }

  const host=document.createElement('div');host.style.position='fixed';host.style.left='0';host.style.top='0';document.body.append(host);
  for(const p of pagination.pages){renderFlowGeneratedPage(host,{...opts,page:p});const box=host.getBoundingClientRect();
   for(const el of host.querySelectorAll('.flow-dom-block')){const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);for(let node=walker.nextNode();node;node=walker.nextNode()){const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects()){if(!r.width||!r.height)continue;const x=r.x-box.x,y=r.y-box.y;check(x>=-1&&y>=-1&&x+r.width<=361&&y+r.height<=641,'outside page');const o=p.anchoredObject;if(o)check(!(x<o.x+o.width&&x+r.width>o.x&&y<o.y+o.height&&y+r.height>o.y),'text/annotation overlaps graphic');glyphs++;}}}
  }host.remove();
  const project={version:6,blocks:[group],projectAssets:[asset],languages:[language],defaultLang:language,languageConfigs:{},bookMode:'none',book:{mode:'none'}};
  const serialized=serializeProject(project);const hydrated=deserializeProject(serialized);check(JSON.stringify(hydrated.blocks[0].flow.layout)===JSON.stringify(group.flow.layout),'save layout roundtrip');
  const preparation=await prepareFlowPressPublication({project,languages:[language],revision:1,documentRef:document});check(preparation.ok,JSON.stringify(preparation.languages.map(l=>l.preparationIssues)));
  Object.assign(state,project,{projectId:null,localProjectId:'test-wrap',activeLang:language,activeBlockIdx:0,title:'Wrap acceptance',meta:{},sections:[],pages:[]});
  const zipBlob=await createEditorFlowPreview({project,languages:[language],check:()=>{}});const zip=await JSZip.loadAsync(zipBlob);const content=JSON.parse(await zip.file('content.json').async('string'));const manifest=JSON.parse(await zip.file(content.languages[language].href).async('string'));
  check(manifest.pages.every(p=>p.renderKind==='fixedText'),'body is fixedText');check(manifest.pages.filter(p=>p.background?.imageHref).length===backgroundCount,'both backgrounds present');
  for(const p of manifest.pages.filter(p=>p.background?.imageHref))check(!!zip.file(p.background.imageHref.replace('../','')),'background bytes missing');
  check(!JSON.stringify(manifest).includes('anchoredObjects')&&!JSON.stringify(manifest).includes('assetId'),'authoring payload leaked');
  if(language==='ja')check(manifest.pages.flatMap(p=>p.lines).flatMap(l=>l.runs).some(r=>r.text==='と'),'ruby text preserved');
  const backgroundAssets={[language]:{}},sealedAssets=[];
  for(const decision of preparation.languages[0].preflight.decisions)for(const bg of decision.projection.backgrounds || []){
   const index=decision.deliveryPageIndex+bg.pageIndex;const bytes=await zip.file(manifest.pages[index].background.imageHref.replace('../','')).async('uint8array');
   const sealed=await sealDsfWebPAsset({bytes,expectedWidth:1080,expectedHeight:1920});
   backgroundAssets[language][JSON.stringify([decision.blockId,bg.pageIndex])]=sealed.descriptor;
   sealedAssets.push({language,blockId:decision.blockId,pageIndex:index,sealed});
  }
  const input={preparation,defaultLang:language,languages:[language],pageDirections:{[language]:writingMode==='vertical-rl'?'rtl':'ltr'},imageAssets:{[language]:{}},backgroundAssets};
  const planning=await createFlowPressLocalReleasePlanning(input);check(planning.summary.imagePageCount===0,'background counted as image page');
  const handoff=await createFlowPressHorizonReleaseHandoff({planning,sealedAssets,uid:'fixture-user',workId:'fixture-work',releaseId:'fixture-release',publicBaseUrl:'https://media.example.test'});
  check(handoff.imageFiles.length===backgroundCount,'Horizon backgrounds missing');
  check(handoff.plan.candidate.dsfPageCounts[language]===manifest.pages.length,'Horizon page count changed');
  const metadata={title:'Wrap test',author:'Test',description:'',rating:'all',license:'all-rights-reserved'};
  let rejected=0;
  for(const mutate of [x=>delete x.backgroundAssets[language][Object.keys(x.backgroundAssets[language])[0]],x=>x.backgroundAssets[language].extra=Object.values(x.backgroundAssets[language])[0],x=>x.preparation.languages[0].preflight.decisions[0].projection.backgrounds[0].revision++]){
   const changed=structuredClone(input);mutate(changed);try{await createFlowPressLocalReleasePlanning(changed);}catch{rejected++;}
  }check(rejected===3,'invalid background plan accepted');
  for(const purpose of [undefined,'image']){const assembly=structuredClone(planning.assembly);assembly.files.assets[0].purpose=purpose;
   let failed=false;try{await createDsfReleaseFileInventory({assembly,sealedAssets,metadata});}catch(error){failed=error.issues?.some(i=>i.code==='RELEASE_ASSEMBLY_ASSET_PAGE_MISMATCH');}check(failed,'wrong background purpose accepted');}
  cases++;
 }
 return {cases,glyphs};
},{captionMode:process.env.DSF_TEST_CAPTIONS==='1',pausedFrames:process.env.DSF_TEST_PAUSED_FRAMES==='1'}));
page.on('dialog',async dialog=>await dialog.accept('flow-wrap-test.dsp'));
const download=page.waitForEvent('download');
await page.evaluate(async()=>await (await import('/js/export.js')).buildDSP());
const path=await (await download).path();const bytes=require('node:fs').readFileSync(path).toString('base64');
console.log(await page.evaluate(async encoded=>{
 const data=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const {parseAndLoadDSP}=await import('/js/export.js');const {state}=await import('/js/state.js');const result=await parseAndLoadDSP(new Blob([data]));
 if(JSON.stringify(result.blocks[0].flow)!==JSON.stringify(state.blocks[0].flow))throw Error('DSP changed Flow source/layout');
 const source=await (await fetch(state.projectAssets[0].background)).arrayBuffer(),restored=await (await fetch(result.projectAssets[0].background)).arrayBuffer();
 if(source.byteLength!==restored.byteLength||new Uint8Array(source).some((v,i)=>v!==new Uint8Array(restored)[i]))throw Error('DSP changed asset bytes');
 return 'DSP archive and import retain exact Flow source/layout and full WebP bytes';
},bytes));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
