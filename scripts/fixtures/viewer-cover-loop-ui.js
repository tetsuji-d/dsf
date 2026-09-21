import {createViewerPageCurl} from '/js/viewer-page-curl.js';
const $=id=>document.getElementById(id),canvas=$('canvas');
const labels=['表紙 C1','表紙の内側 C2','本文 1','本文 2','本文 3','本文 4','本文 5','本文 6','裏表紙の内側 C3','裏表紙 C4'];
const paragraphs=['海辺の図書館には、夕暮れになると一冊だけ光る本があった。誰が置いたのかは、司書にもわからない。','窓を開けると、遠くの灯台が見えた。潮風が本の間を通り抜け、読みかけのページをそっと揺らした。','その本には、まだ訪れたことのない町のことが書かれていた。けれど、不思議と懐かしい匂いがした。','少年は毎日、同じ席に座って読んだ。物語を急ぐことはなかった。ひとつの言葉を、何度も味わった。','季節が変わるころ、最後の章にたどり着いた。窓の外では、灯台の明かりが静かに海を照らしていた。','本を閉じると、波の音だけが残った。明日もまた、ここに来よう。少年は裏表紙をそっと撫でた。'];
let index=0,busy=false,curl=null,cancelTurn=null,cancelFlip=null,flip=null;
const rtl=()=>$('binding').value==='rtl',spread=()=>$('mode').value==='spread';
const pair=i=>i<=0?[0]:i>=9?[9]:[i%2?i:i-1,i%2?i+1:i];
const visible=i=>spread()?pair(i):[i];
function markup(i){
 let content='',kind='';
 if(i===0){kind='cover';content='<span class="subtitle">A SMALL STORY BY THE SEA</span><h2>潮騒の図書館</h2><span class="author">装丁・読書の試作</span>';}
 else if(i===9){kind='cover backcover';content='<span class="subtitle">BACK COVER</span><h2>本を閉じたあとにも、<br>物語は続いている。</h2><p>海辺の小さな図書館。<br>誰かが残した一冊の本。<br>静かな時間をめぐる、短い物語。</p><p>ここから逆方向へ送ると、<br>裏表紙の内側、本文の末尾へ。</p><span class="mark">DSF EDITIONS · SAMPLE</span>';}
 else if(i===1){kind='inside';content='<small>INSIDE FRONT COVER · C2</small><h2>潮騒の図書館</h2><p>波の音を聞きながら、<br>ゆっくりページを開く。</p>';}
 else if(i===8){kind='inside';content='<small>INSIDE BACK COVER · C3</small><h2>この本について</h2><p>裏表紙から本を開くと、<br>最初にここへたどり着きます。</p><p>前へ送ると本文の最終ページ。<br>後ろからも、一冊を<br>自由に眺められます。</p><p style="font-size:13px;color:#69776f">この面はC3です。カバーの袖は<br>今回の試作には含めていません。</p>';}
 else{content='<div class="vertical">'+paragraphs[i-2]+'</div>';}
 return '<article class="paper '+kind+'">'+content+'<div class="folio">'+labels[i]+'</div></article>';
}
function unit(i){if(i===0||i===9)return {type:'single',center:i+1};const [a,b]=pair(i);return {type:'spread',left:(rtl()?b:a)+1,right:(rtl()?a:b)+1,focus:(i===(rtl()?b:a))?'left':'right'};}
function pageWidth(i){const r=$('viewer-stage').getBoundingClientRect();return Math.max(1,Math.min((r.width-8)/visible(i).length,(r.height-12)*360/640));}
function render(){
 const ids=visible(index),w=pageWidth(index),ordered=ids.length===2&&rtl()?[...ids].reverse():ids;
 canvas.style.width=w*ids.length+'px';canvas.style.height=w*640/360+'px';canvas.innerHTML=ordered.map((i,n)=>'<div class="page-content" style="left:'+n*w+'px;transform:scale('+w/360+')">'+markup(i)+'</div>').join('')+(ids.length===2?'<div class="gutter"></div>':'');
 $('role').textContent=ids.map(i=>labels[i]).join(' ／ ');$('counter').textContent=ids.map(i=>i+1).join('–')+' / 10';
 $('progress').value=index;$('progress').dir=rtl()?'rtl':'ltr';$('progress').setAttribute('aria-valuetext',$('role').textContent);
 $('left').textContent=rtl()?'次へ ←':'← 前へ';$('right').textContent=rtl()?'前へ →':'→ 次へ';
 $('hint').textContent=index===0?'前へ送ると裏表紙へ':index===9?'前へ送ると本の末尾へ':'スワイプ・矢印キーでも移動';
}
function lock(value){
 busy=value;
 for(const id of ['left','right','reset'])$(id).disabled=value;
 for(const id of ['binding','mode','progress'])$(id).disabled=value||!!flip;
}
function target(delta){if(!spread())return (index+delta+10)%10;const ids=pair(index);return delta>0?(ids.at(-1)+1)%10:(ids[0]-1+10)%10;}
const wraps=delta=>(index===0&&delta<0)||(index===9&&delta>0);
const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
function drawFlip(p){
 if(!flip)return;
 flip.p=Math.max(0,Math.min(1,p));
 flip.layer.dataset.progress=flip.p.toFixed(3);
 flip.book.style.transform='rotateY('+flip.angle*flip.p+'deg) scale('+(1-.06*Math.sin(Math.PI*flip.p))+')';
}
function beginFlip(delta){
 const rect=canvas.getBoundingClientRect(),layer=document.createElement('div');
 layer.className='cover-flip-layer';layer.setAttribute('aria-hidden','true');
 Object.assign(layer.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
 const next=target(delta),scale=rect.width/360,hingeRight=(index===0)===rtl();
 layer.innerHTML='<div class="cover-flip-scale" style="transform:scale('+scale+')"><div class="cover-flip-book"><div class="cover-flip-face cover-flip-front">'+markup(index)+'</div><div class="cover-flip-face cover-flip-back">'+markup(next)+'</div><div class="cover-flip-edge edge-left '+(!hingeRight?'edge-spine':'')+'">'+(!hingeRight?'<span>潮騒の図書館</span>':'')+'</div><div class="cover-flip-edge edge-right '+(hingeRight?'edge-spine':'')+'">'+(hingeRight?'<span>潮騒の図書館</span>':'')+'</div></div></div>';
 document.body.append(layer);
 // Keep the original full-page hit area available while only the 3D book is visible.
 canvas.style.opacity='0';
 flip={next,delta,p:0,layer,book:layer.querySelector('.cover-flip-book'),angle:(rtl()?1:-1)*delta*180};
 drawFlip(0);lock(false);
}
function endFlip(commit=false){
 cancelFlip?.();
 if(!flip)return;
 if(commit)index=flip.next;
 flip.layer.remove();flip=null;canvas.style.opacity='';lock(false);render();
}
function animateFlip(to){
 const current=flip;if(!current)return Promise.resolve();
 cancelFlip?.();lock(true);
 const from=current.p,duration=reduced()?0:Math.max(160,Math.abs(to-from)*850);
 return new Promise(resolve=>{
  let frame=0,started=null;
  const finish=()=>{
   cancelFlip=null;lock(false);
   if(to===0||to===1)endFlip(to===1);
   else {$('role').textContent='背表紙';$('hint').textContent='背表紙で停止 · 同じ方向へもう一度';}
   resolve();
  };
  cancelFlip=()=>{cancelAnimationFrame(frame);cancelFlip=null;resolve();};
  const tick=time=>{
   if(started===null)started=time;
   const t=duration?Math.min(1,(time-started)/duration):1;
   drawFlip(from+(to-from)*(t*t*(3-2*t)));
   if(t===1)finish();else frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
 });
}
function moveFlip(gesture,dx){
 if(gesture.latched||!flip)return;
 const p=gesture.p+dx*(rtl()?1:-1)*flip.delta/Math.max(180,canvas.clientWidth*.8);
 // A single gesture cannot pass the spine, including its remaining wheel momentum.
 if((gesture.p<.5&&p>=.5)||(gesture.p>.5&&p<=.5)){
  drawFlip(.5);gesture.latched=true;
  $('role').textContent='背表紙';$('hint').textContent='背表紙で停止 · 同じ方向へもう一度';
 }else drawFlip(p);
}
function settleFlip(gesture){
 if(!flip)return;
 const p=flip.p;
 let to=.5;
 if(gesture.p===0)to=p>.12?.5:0;
 else if(gesture.p===1)to=p<.88?.5:1;
 else if(p<.38)to=0;
 else if(p>.62)to=1;
 return animateFlip(to);
}
async function step(delta){if(busy)return;const next=target(delta),wrap=(index===0&&delta<0)||(index===9&&delta>0);
 if(flip){await animateFlip(delta===flip.delta?1:0);return;}
 if(wrap){beginFlip(delta);await animateFlip(.5);return;}
 lock(true);let committed=false;
 curl=createViewerPageCurl({canvas,from:unit(index),to:unit(next),rtl:rtl(),forward:delta>0,spread:spread(),sameUnit:index>0&&index<9&&next>0&&next<9&&pair(index)[0]===pair(next)[0],width:360,height:640,targetWidth:pageWidth(next),render:page=>markup(page-1),commit:()=>{index=next;committed=true;render();}});
 await Promise.race([curl.finish(true),new Promise(resolve=>{cancelTurn=resolve;})]);cancelTurn=null;curl=null;lock(false);if(!committed)render();
}
$('left').onclick=()=>step(rtl()?1:-1);$('right').onclick=()=>step(rtl()?-1:1);
$('progress').oninput=()=>{index=Number($('progress').value);render();};
$('binding').onchange=render;$('mode').onchange=render;$('reset').onclick=()=>{endFlip();index=0;render();};
canvas.onkeydown=e=>{
 if(e.key==='Escape'){endFlip();return;}
 if(!['ArrowLeft','ArrowRight'].includes(e.key))return;
 e.preventDefault();step((e.key==='ArrowRight')==rtl()?-1:1);
};
let start=null,wheel=null,wheelTimer=0;
canvas.onpointerdown=e=>{
 if(busy||wheel||!e.isPrimary||e.button!==0)return;
 start={x:e.clientX,y:e.clientY,id:e.pointerId,p:flip?.p??0,horizontal:false,latched:false};
 canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove=e=>{
 if(!start||start.id!==e.pointerId)return;
 const dx=e.clientX-start.x,dy=e.clientY-start.y;
 if(!start.horizontal){
  if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.3)return;
  start.horizontal=true;
  const delta=(dx>0)==rtl()?1:-1;
  if(!flip&&wraps(delta))beginFlip(delta);
 }
 if(flip)moveFlip(start,dx);
};
canvas.onpointerup=e=>{
 if(!start||start.id!==e.pointerId)return;
 const gesture=start,dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;
 if(flip){settleFlip(gesture);return;}
 if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.3)step((dx>0)==rtl()?1:-1);
};
canvas.onpointercancel=()=>{const gesture=start;start=null;if(gesture&&flip)settleFlip(gesture);};
canvas.addEventListener('wheel',e=>{
 if(e.ctrlKey||start||Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;
 e.preventDefault();
 clearTimeout(wheelTimer);
 wheelTimer=setTimeout(()=>{const gesture=wheel;wheel=null;if(gesture&&!gesture.consumed&&flip)settleFlip(gesture);},240);
 if(busy)return;
 if(!wheel)wheel={p:flip?.p??0,dx:0,latched:false,consumed:false};
 if(wheel.consumed)return;
 wheel.dx-=e.deltaX*(e.deltaMode===1?16:e.deltaMode===2?canvas.clientWidth:1);
 if(Math.abs(wheel.dx)<8)return;
 const delta=(wheel.dx>0)==rtl()?1:-1;
 if(!flip&&wraps(delta))beginFlip(delta);
 if(flip)moveFlip(wheel,wheel.dx);
 else if(Math.abs(wheel.dx)>60){wheel.consumed=true;step(delta);}
},{passive:false});
new ResizeObserver(()=>{
 start=null;wheel=null;clearTimeout(wheelTimer);endFlip();
 if(curl){curl.cancel();cancelTurn?.();}render();
}).observe($('viewer-stage'));
render();
