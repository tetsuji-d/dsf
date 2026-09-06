import {renderFlowGeneratedPage} from '/js/flow-dom-measurer.js';
import {validateSnapshotPage,projectFlowPaginationToDsfV2} from '/js/flow-publication-projection.js';
import {segmentGraphemes} from '/js/grapheme.js';
import {prepareDsfViewerFixedTextContext,createDsfFixedTextPageElement} from '/js/viewer-fixed-text.js';
import {createFlowGroupBlock} from '/js/flow-project-model.js';
import {createFlowPublicationCompositionCaptureSession} from '/js/flow-publication-composition-capture.js';
import {FLOW_PRESS_PREFLIGHT_FIXTURE_FONT_REGISTRY as fontRegistry} from '/js/fixtures/flow-press-preflight-fixture.js';
if(!import.meta.env.DEV)throw Error('Local fixture only');
export async function captureAnnotations(options={}){
 const results=[];
 for(const writingMode of ['horizontal-tb','vertical-rl']){
  const group=createFlowGroupBlock({id:'annotation-'+writingMode,sourceLanguage:'ja',document:{schemaVersion:2,id:'doc-'+writingMode,sourceLanguage:'ja',sections:[{id:'section',title:{},blocks:[{id:'body',type:'paragraph',texts:{ja:options.text || '前漢字と圏点の本文です。'.repeat(30)},annotations:{ja:[{id:'r',type:'ruby',start:1,end:3,reading:options.reading || 'かんじ'},{id:'e',type:'emphasis',start:1,end:3,mark:'sesame'},{id:'d',type:'emphasis',start:4,end:6,mark:'dot'}]}}]}]}});
  if(options.heading)Object.assign(group.flow.document.sections[0].blocks[0],{type:'heading',level:2});
  group.flow.layout.typographyByLanguage.ja={writingMode,fontFamily:options.fontFamily || "'Noto Sans JP',sans-serif",fontSize:16,fontWeight:400,lineHeight:options.lineHeight || 1.8,letterSpacing:0,textAlign:'start',paragraphSpacing:12,headingSpacing:18,textColor:'#1f1b16',paperColor:'#f7f1df'};
  const session=await createFlowPublicationCompositionCaptureSession({ownerDocument:document,flowGroup:group,language:'ja',revision:1,fontId:'fixture-flow-press-noto-sans-jp',fontRegistry});
  try{const pagination=session.paginate();const snapshot=session.capture(pagination);
   const host=document.createElement('div');document.body.append(host);
   try{
    const content=renderFlowGeneratedPage(host,{page:pagination.pages[0],pageBox:snapshot.pageBox,writingMode,languageKey:'ja',typography:group.flow.layout.typographyByLanguage.ja});
    for(const element of content.querySelectorAll('.flow-dom-block')){
     const style=getComputedStyle(element),expected=element.tagName==='H2'?Math.max(1.35,(options.lineHeight || 1.8)-.15):(options.lineHeight || 1.8);
     if(Math.abs(parseFloat(style.lineHeight)/parseFloat(style.fontSize)-expected)>.001)throw Error('Annotation changed author line spacing');
    }
    const measure=()=>{
     const origin=host.getBoundingClientRect(),walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT),rects=[];
     while(walker.nextNode()){
      const node=walker.currentNode;if(node.parentElement.closest('[data-annotation-text]'))continue;
      for(const g of segmentGraphemes(node.data,'ja')){const range=document.createRange();range.setStart(node,g.index);range.setEnd(node,g.end);const rect=range.getBoundingClientRect();rects.push([rect.x-origin.x,rect.y-origin.y,rect.width,rect.height]);}
     }
     return rects;
    };
    const annotatedRects=measure();
    const plainPage=structuredClone(pagination.pages[0]);plainPage.fragments.forEach(f=>delete f.annotations);
    const {renderFlowFragments}=await import('/js/flow-dom-measurer.js');
    renderFlowFragments(content,{fragments:plainPage.fragments,pageBox:snapshot.pageBox,writingMode,languageKey:'ja',typography:group.flow.layout.typographyByLanguage.ja});
    const plainRects=measure();
    if(plainRects.length!==annotatedRects.length || plainRects.some((r,i)=>r.some((v,j)=>Math.abs(v-annotatedRects[i][j])>.25)))throw Error('Annotation moved parent glyph geometry: '+JSON.stringify({writingMode,first:plainRects.findIndex((r,i)=>r.some((v,j)=>Math.abs(v-annotatedRects[i][j])>.25)),plain:plainRects.slice(8,22),annotated:annotatedRects.slice(8,22)}));
   }finally{host.remove();}
   const plainGroup=structuredClone(group);
   plainGroup.flow.document.sections.forEach(s=>s.blocks.forEach(b=>delete b.annotations));
   const plainSession=await createFlowPublicationCompositionCaptureSession({ownerDocument:document,flowGroup:plainGroup,language:'ja',revision:1,fontId:'fixture-flow-press-noto-sans-jp',fontRegistry});
   try{
    const boundaries=p=>JSON.stringify(p.pages.map(page=>page.fragments.map(f=>[f.blockId,f.sourceRange])));
    if(boundaries(plainSession.paginate())!==boundaries(pagination))throw Error('Annotation changed sample page boundaries');
   }finally{plainSession.dispose();}
   results.push({group,pagination,snapshot,fontRegistry});
  }finally{session.dispose();}
 }
 return results;
}
window.captureAnnotations=captureAnnotations;
document.querySelector('#run').onclick=async()=>{try{window.annotationResults=await captureAnnotations();document.querySelector('#status').textContent=JSON.stringify(window.annotationResults.map(r=>({mode:r.snapshot.writingMode,pages:r.snapshot.pages.length,glyphs:r.snapshot.pages.flatMap(p=>p.annotations||[]).length})),null,2);}catch(e){document.querySelector('#status').textContent=e.code+': '+e.message;window.annotationError={code:e.code,context:e.context};}};

export async function verifyAnnotationViewer(result){
 const {group,pagination,snapshot}=result;
 const entries=group.flow.document.sections.flatMap(section=>section.blocks.map(block=>({section,block,text:block.texts.ja,segments:segmentGraphemes(block.texts.ja,'ja')})));
 const context={source:{byBlockId:new Map(entries.map(e=>[e.block.id,e]))},pageBox:snapshot.pageBox,writingMode:snapshot.writingMode,language:'ja'};
 const fontRef='fixture-flow-press-noto-sans-jp';
 const projection=projectFlowPaginationToDsfV2({flowGroup:group,language:'ja',revision:1,fontId:fontRef,fontRegistry,pagination,compositionSnapshot:snapshot,pageIds:pagination.pages.map((_,i)=>'p'+i)});
 if(!projection.ok)throw Object.assign(new Error(projection.publicationBlocked.message),projection.publicationBlocked);
 const {pages,styles}=projection.manifest;
 const declaration=fontRegistry.fonts[fontRef].declaration;
 const bundle={index:{schemaVersion:2,layoutModel:'fixed-page-hybrid-1',canonicalPage:{width:360,height:640,aspectRatio:'9:16'},defaultLang:'ja',fonts:{[fontRef]:declaration},languages:{ja:{href:'content/ja.json',pageCount:pages.length,sha256:'a'.repeat(64),pageDirection:snapshot.writingMode==='vertical-rl'?'rtl':'ltr'}}},manifests:{ja:{schemaVersion:1,language:'ja',styles,pages}}};
 const viewer=await prepareDsfViewerFixedTextContext({bundle,language:'ja',certifiedFonts:{[fontRef]:declaration},fontFaceSet:document.fonts});
 for(const page of viewer.manifest.pages){const host=document.createElement('div');host.className='result';host.append(createDsfFixedTextPageElement({context:viewer,page,documentRef:document}));document.querySelector('#pages').append(host);}
 const bad=structuredClone(snapshot.pages[0]);bad.annotations.pop();let rejected=false;
 try{validateSnapshotPage(bad,pagination.pages[0],0,context);}catch{rejected=true;}
 if(!rejected)throw Error('Missing annotation accepted');
 return {pages:pages.length,glyphs:pages.flatMap(p=>p.lines).filter(l=>!l.runs[0].source).length,missingRejected:rejected};
}
window.verifyAnnotationViewer=verifyAnnotationViewer;

export async function verifyAnnotationPackage(group){
 const {prepareFlowPressPublication}=await import('/js/flow-press-publication-preparation.js');
 const {createFlowPressLocalReleasePlanning}=await import('/js/flow-press-local-release-planning.js');
 const {createFlowPressLocalReleasePackage}=await import('/js/flow-press-local-release-package.js');
 const {loadDsfLocalViewerPackage}=await import('/js/dsf-local-viewer-package.js');
 const mode=group.flow.layout.typographyByLanguage.ja.writingMode;
 const preparation=await prepareFlowPressPublication({project:{version:6,blocks:[group],languages:['ja'],defaultLang:'ja'},revision:1,ownerDocument:document});
 if(!preparation.ok)throw Error('Production preparation failed: '+JSON.stringify(preparation.languages.map(l=>l.preparationIssues)));
 const planning=await createFlowPressLocalReleasePlanning({preparation,defaultLang:'ja',languages:['ja'],pageDirections:{ja:mode==='vertical-rl'?'rtl':'ltr'},imageAssets:{ja:{}}});
 const metadata={projectId:'local-annotation-test',workId:'local-annotation-test',releaseId:'local-annotation-test',title:'注釈検証',author:'DSF Test',localizedMeta:{ja:{title:'注釈検証',author:'DSF Test'}},created:'2026-09-06T00:00:00.000Z',modified:'2026-09-06T00:00:00.000Z',generator:'DSF local verification',spread:'auto'};
 const pkg=await createFlowPressLocalReleasePackage({planning,sealedAssets:[],metadata});
 const restored=await loadDsfLocalViewerPackage({file:pkg.zipPackage.blob});
 try{
  const signature=manifest=>JSON.stringify(manifest.pages.map(p=>p.lines.map(l=>[l.x,l.y,l.width,l.height,l.styleRef,l.runs.map(r=>r.text),manifest.styles[l.styleRef].fontSize])));
  if(signature(restored.manifests.ja)!==signature(planning.assembly.bundle.manifests.ja))throw Error('Portable annotation geometry/text changed');
  return {mode,font:group.flow.layout.typographyByLanguage.ja.fontFamily,roundTrip:true,zipBytes:pkg.summary.zipByteLength,imageFiles:pkg.summary.imageFileCount};
 }finally{restored.dispose();}
}
window.verifyAnnotationPackage=verifyAnnotationPackage;
document.querySelector('#run').onclick=async()=>{
 const status=document.querySelector('#status');status.textContent='実測・Viewer・DSF再読込を検証中';document.querySelector('#pages').replaceChildren();
 try{window.annotationResults=await captureAnnotations();const results=[];
  for(const capture of window.annotationResults){results.push({...await verifyAnnotationViewer(capture),...await verifyAnnotationPackage(capture.group)});}
  status.textContent=JSON.stringify(results,null,2);
 }catch(error){status.textContent='検証停止: '+(error.code || error.message);}
};
