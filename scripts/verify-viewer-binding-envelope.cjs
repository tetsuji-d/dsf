const {chromium}=require(process.env.DSF_PLAYWRIGHT_MODULE),assert=require('node:assert/strict');
const base=process.env.DSF_VIEWER_TEST_ORIGIN||'http://127.0.0.1:5275';
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 for(const mobile of [false,true])for(const total of [24,480]){
 const p=await b.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
 await p.goto(base+'/viewer?bookEdges=1&src=/outputs/book-edges-'+total+'.json');await p.waitForFunction(()=>+document.querySelector('#page-slider').max>1);await p.waitForTimeout(350);
 await p.keyboard.press('ArrowUp');await p.locator('#viewer-edge-peek .edge-peek-leaf').waitFor();await p.locator('.viewer-pose-transition').waitFor({state:'detached'});
 for(const position of [0,Math.floor((total-4)/2),total-5]){
 await p.evaluate(()=>toggleUi(true));await p.locator('#page-slider').fill(String(mobile?position+3:Math.floor((position+1)/2)+2));await p.waitForTimeout(350);
 const result=await p.evaluate(()=>{
 const project=(e,x,y)=>{const m=new DOMMatrix(getComputedStyle(e).transform),p=new DOMPoint(x,y).matrixTransform(m);return {x:p.x/p.w,y:p.y/p.w};};
 const outline=e=>{const strips=[...e.children];return [...strips.map(s=>project(s,0,0)),project(strips.at(-1),parseFloat(strips.at(-1).style.width),0),project(strips.at(-1),parseFloat(strips.at(-1).style.width),640),...strips.reverse().map(s=>project(s,0,640))];};
 function inside(p,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[j],b=poly[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
 if(Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<1)return true;
 if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c;
 }return c;}
 const errors=[];
 const binding=document.querySelector('.edge-fan-binding'),l=+binding.dataset.left,r=+binding.dataset.right;
 const spine=[{x:l,y:26},{x:r,y:26},{x:r,y:544},{x:l,y:544}];
 for(const side of ['left','right']){
 const cover=outline(document.querySelector('.edge-fan-cover[data-side='+side+']'));
 for(const sheet of document.querySelectorAll('.edge-fan-stack[data-side='+side+']'))for(const pt of outline(sheet).slice(0,sheet.children.length+1))if(!inside(pt,cover)&&!inside(pt,spine))errors.push({side,kind:'paper',pt});
 for(const name of ['top','fore-edge']){
 const face=document.querySelector('.edge-fan-'+name+'[data-side='+side+'] path'),length=face.getTotalLength();
 for(let i=0;i<=80;i++){const pt=face.getPointAtLength(length*i/80);if((name==='top'&&!inside(pt,cover)&&!inside(pt,spine)) || (name==='fore-edge'&&(pt.x<Math.min(...cover.map(p=>p.x))-1||pt.x>Math.max(...cover.map(p=>p.x))+1)))errors.push({side,kind:name,pt:{x:pt.x,y:pt.y}});}
 }
 }
 for(const sheet of document.querySelectorAll('.edge-fan-sheet[data-source-index],.edge-fan-endpaper')){
 const pts=outline(sheet),head=pts.filter(p=>Math.abs(p.y-31)<.03),foot=pts.filter(p=>Math.abs(p.y-539)<.03);
 if(!head.length||!foot.length||[...head,...foot].some(p=>Math.abs(p.x-Number(document.querySelector("#viewer-edge-peek").dataset.hinge))>.03))errors.push({kind:'gutter gap',head,foot});
 }
 if(document.querySelector('.edge-fan-bottom'))errors.push({kind:'visible bottom face'});return errors;
 });assert.deepEqual(result,[],total+' pages at '+position+' remain inside the covers');
 if(position===0||position===Math.floor((total-4)/2)){await p.evaluate(()=>toggleUi(false));await p.waitForTimeout(200);await p.screenshot({path:'outputs/binding-envelope-'+total+'-'+position+'-'+mobile+'.png'});}
 }
 await p.close();
 }
 console.log('24/480 page start, middle and end: paper heads inside covers; meeting gutter continuous; desktop/mobile passed');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
