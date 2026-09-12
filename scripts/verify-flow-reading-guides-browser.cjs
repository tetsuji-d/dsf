const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE);
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  await page.goto('http://127.0.0.1:5178/studio?room=editor');
  const results=await page.evaluate(async()=>{
   const {renderFlowGeneratedPage}=await import('/js/flow-dom-measurer.js');
   const {createCanonicalFlowPageBox}=await import('/js/flow-pagination.js');
   const {paintFlowLineGuides}=await import('/js/flow-line-guides.js');
   const results=[];
   for(const writingMode of ['vertical-rl','horizontal-tb'])for(const scale of [.78,.98,1.5]){
    const surface=document.createElement('div');document.body.append(surface);
    Object.assign(surface.style,{position:'fixed',top:'0',left:'0',transform:`scale(${scale})`,transformOrigin:'top left',zIndex:'999999'});
    const text='灯台と海辺の約束。'.repeat(8);
    const fragment={blockType:'paragraph',blockId:'p',sectionId:'s',languageKey:'ja',text,sourceRange:{start:0,end:text.length},isBlockStart:true,isBlockEnd:true,
      annotations:[{id:'r',type:'ruby',start:0,end:2,reading:'とうだい',reviewState:'confirmed'},{id:'e',type:'emphasis',start:4,end:6,mark:'dot'}]};
    const pageBox=createCanonicalFlowPageBox();
    renderFlowGeneratedPage(surface,{pageBox,writingMode,languageKey:'ja',typography:{fontSize:16,lineHeight:1.8},page:{fragments:[fragment]}});
    const nodes=[...surface.querySelectorAll('.annotation-base')].map(e=>e.firstChild).filter(e=>e.nodeType===3);
    const rects=()=>nodes.flatMap(n=>{const r=document.createRange();r.selectNodeContents(n);return [...r.getClientRects()].map(b=>({x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}));});
    const before=rects();paintFlowLineGuides(surface,pageBox,true);
    const svg=surface.querySelector('.flow-line-guides'),ctm=svg.getScreenCTM();
    const lines=[...svg.querySelectorAll('line')].map(l=>{
      const a=new DOMPoint(l.x1.baseVal.value,l.y1.baseVal.value).matrixTransform(ctm),b=new DOMPoint(l.x2.baseVal.value,l.y2.baseVal.value).matrixTransform(ctm);return {a,b};});
    const vertical=writingMode==='vertical-rl';
    const aligned=before.every(r=>lines.some(({a,b})=>vertical
      ? Math.abs(a.x-r.right-scale)<1 && a.y<=r.y+1 && b.y>=r.bottom-1
      : Math.abs(a.y-r.bottom-scale)<1 && a.x<=r.x+1 && b.x>=r.right-1));
    const bodyOnly=lines.every(({a})=>before.some(r=>vertical?Math.abs(a.x-r.right-scale)<1:Math.abs(a.y-r.bottom-scale)<1));
    results.push({writingMode,scale,aligned,bodyOnly,noReflow:JSON.stringify(before)===JSON.stringify(rects()),lines:lines.length});
    paintFlowLineGuides(surface,pageBox,false);if(surface.querySelector('.flow-line-guides'))throw Error('Guide not removed');surface.remove();
   }
   return results;
  });
  for(const result of results){assert.ok(result.aligned,JSON.stringify(result));assert.ok(result.bodyOnly,JSON.stringify(result));assert.ok(result.noReflow,JSON.stringify(result));assert.ok(result.lines>1);}
  console.log('Vertical/horizontal ruby + emphasis: guides follow body glyphs at 78%, 98%, 150%, annotations excluded, no reflow',results);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
