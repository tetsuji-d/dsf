/** Keep complete spreads together, with both ends and the selected spread visible. */
export function compactPageGroups(groups,current,limit=36){
 const at=Math.max(0,groups.findIndex(g=>g.includes(current))),keep=new Set();
 const count=()=>[...keep].reduce((n,i)=>n+groups[i].length,0);
 for(const i of [0,groups.length-1,at])if(groups[i])keep.add(i);
 for(let d=1;d<groups.length;d++){
  let added=false;
  for(const i of [at-d,at+d])if(groups[i]&&!keep.has(i)&&count()+groups[i].length<=limit){keep.add(i);added=true;}
  if(!added&&count()>=limit-1)break;
 }
 const out=[];let previous=-1;
 for(const i of [...keep].sort((a,b)=>a-b)){
  if(i>previous+1){const hidden=groups.slice(previous+1,i).flat();out.push({gap:true,from:hidden[0],to:hidden.at(-1),count:hidden.length});}
  out.push({pages:groups[i]});previous=i;
 }
 return out;
}

export function initializeViewerPageSegments({host,snapshot,preview,hidePreview,navigate,onHold}){
 const root=document.createElement('div');root.className='viewer-page-segments';
 const marks=document.createElement('div');marks.className='viewer-page-segment-marks';marks.setAttribute('aria-hidden','true');
 const range=document.createElement('input');range.type='range';range.className='viewer-page-segment-input';range.min='0';range.step='1';range.setAttribute('aria-label','ページを選ぶ / Choose page');
 root.append(marks,range);host.append(root);host.classList.add('has-page-segments');
 let drag=null,key='',data=null,lastIndex=-1;
 function update(){
  data=snapshot();if(!data?.total){root.hidden=true;return;}root.hidden=false;
  const width=host.getBoundingClientRect().width;
  const nextKey=JSON.stringify([data.epoch,data.groups,data.current,Math.floor(width)]);
  if(!drag&&key!==nextKey){
   key=nextKey;marks.replaceChildren();marks.style.direction=data.rtl?'rtl':'ltr';
   for(const group of compactPageGroups(data.groups,data.current,Math.max(8,Math.min(64,Math.floor(width/9)-6)))){
    const item=document.createElement('span');
    if(group.gap){item.className='viewer-segment-gap';item.textContent='…';item.dataset.from=group.from;item.dataset.to=group.to;item.title=`${group.count}ページ省略`;}
    else{item.className='viewer-segment-spread';for(const index of group.pages){const page=document.createElement('i');page.dataset.index=index;item.append(page);}}
    marks.append(item);
   }
  }
  for(const page of marks.querySelectorAll('[data-index]')){page.dataset.current=String(Number(page.dataset.index)===data.current);page.dataset.active=String(data.active.includes(Number(page.dataset.index)));}
  range.max=String(data.total-1);range.value=String(data.current);range.setAttribute('aria-valuetext',data.label(data.current));range.style.direction=data.rtl?'rtl':'ltr';
 }
 function hit(x){
  const entries=[...marks.querySelectorAll('[data-index],.viewer-segment-gap')];if(!entries.length)return null;
  const el=entries.reduce((best,e)=>{const r=e.getBoundingClientRect(),d=Math.abs(x-(r.left+r.width/2));return !best||d<best.d?{e,d}:best;},null).e;
  if(el.dataset.index!==undefined)return {index:Number(el.dataset.index),active:true};
  const r=el.getBoundingClientRect(),p=Math.max(0,Math.min(1,(x-r.left)/r.width));
  return {index:Math.round(Number(el.dataset.from)+(Number(el.dataset.to)-Number(el.dataset.from))*(data.rtl?1-p:p)),active:false};
 }
 function show(x,commit=false){const h=hit(x);if(!h)return;const r=host.getBoundingClientRect();preview(h.index,Math.max(0,Math.min(1,(x-r.left)/r.width)));if(commit&&h.active&&lastIndex!==h.index){lastIndex=h.index;navigate(h.index);}}
 function end(cancel=false){if(!drag)return;drag=null;lastIndex=-1;onHold(false);if(cancel)hidePreview();key='';update();}
 root.addEventListener('pointerdown',e=>{if(e.button!==0)return;if(e.isPrimary===false){end(true);return;}drag={id:e.pointerId,x:e.clientX};onHold(true);root.setPointerCapture(e.pointerId);show(e.clientX);e.preventDefault();e.stopPropagation();});
 root.addEventListener('pointermove',e=>{if(drag&&drag.id!==e.pointerId)return;show(e.clientX,!!drag&&Math.abs(e.clientX-drag.x)>3);});
 root.addEventListener('pointerup',e=>{if(drag?.id!==e.pointerId)return;const h=hit(e.clientX);if(h&&h.index!==lastIndex)navigate(h.index);end();hidePreview();e.stopPropagation();});
 root.addEventListener('pointercancel',()=>end(true));root.addEventListener('lostpointercapture',()=>end(true));
 root.addEventListener('pointerleave',()=>{if(!drag)hidePreview();});root.addEventListener('click',e=>e.stopPropagation());
 range.addEventListener('input',()=>{navigate(Number(range.value));preview(Number(range.value),.5);});range.addEventListener('blur',hidePreview);
 window.addEventListener('blur',()=>end(true));window.addEventListener('resize',()=>end(true));document.addEventListener('visibilitychange',()=>{if(document.hidden)end(true);});
 new ResizeObserver(update).observe(host);update();return {update,cancel:()=>end(true)};
}
