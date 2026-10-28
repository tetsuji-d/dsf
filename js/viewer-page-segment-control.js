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
 const value=document.createElement('output');value.className='viewer-page-bar-value';value.hidden=true;
 if(host.id==='embed-progress')root.append(value);
 root.append(marks,range);host.append(root);host.classList.add('has-page-segments');
 let drag=null,key='',data=null,lastIndex=-1,hoverIndex=-1,hovering=false;
 function paintHover(){for(const page of marks.querySelectorAll('[data-index],.viewer-segment-gap'))page.dataset.hover=String(hoverIndex>=0&&Number(page.dataset.index??page.dataset.from)<=hoverIndex);}
 function clearPreview(){hoverIndex=-1;paintHover();value.hidden=true;hidePreview();}
 function update(){
  data=snapshot();if(!data?.total){root.hidden=true;return;}root.hidden=false;
  const width=host.getBoundingClientRect().width;
  const nextKey=JSON.stringify([data.epoch,data.groups,data.current,Math.floor(width)]);
  if(!drag&&key!==nextKey){
   key=nextKey;marks.replaceChildren();marks.style.direction=data.rtl?'rtl':'ltr';
   for(const group of compactPageGroups(data.groups,data.current,Math.max(8,Math.min(64,Math.floor(width/9)-6)))){
    const item=document.createElement('span');
    item.style.flex=String(group.gap?group.count:group.pages.length);
    if(group.gap){item.className='viewer-segment-gap';item.dataset.from=group.from;item.dataset.to=group.to;item.title=`${group.count}ページ省略`;item.dataset.read=String(group.to<data.current);}
    else{item.className='viewer-segment-spread';for(const index of group.pages){const page=document.createElement('i');page.dataset.index=index;item.append(page);}}
    marks.append(item);
   }
  }
  for(const page of marks.querySelectorAll('[data-index]')){page.dataset.read=String(Number(page.dataset.index)<data.current);page.dataset.current=String(Number(page.dataset.index)===data.current);page.dataset.active=String(data.active.includes(Number(page.dataset.index)));}
  range.max=String(data.total-1);range.value=String(data.current);range.setAttribute('aria-valuetext',data.label(data.current));range.style.direction=data.rtl?'rtl':'ltr';
  paintHover();
 }
 function hit(x){
  const entries=[...marks.querySelectorAll('[data-index],.viewer-segment-gap')];if(!entries.length)return null;
  const el=entries.reduce((best,e)=>{const r=e.getBoundingClientRect(),d=Math.abs(x-(r.left+r.width/2));return !best||d<best.d?{e,d}:best;},null).e;
  if(el.dataset.index!==undefined)return {index:Number(el.dataset.index),active:true};
  const r=el.getBoundingClientRect(),p=Math.max(0,Math.min(1,(x-r.left)/r.width));
  return {index:Math.round(Number(el.dataset.from)+(Number(el.dataset.to)-Number(el.dataset.from))*(data.rtl?1-p:p)),active:false};
 }
 function show(x,commit=false){const h=hit(x);if(!h)return;hoverIndex=h.index;paintHover();const r=host.getBoundingClientRect();value.textContent=data.label(h.index);value.hidden=false;value.style.left=Math.max(40,Math.min(r.width-40,x-r.left))+'px';preview(h.index,Math.max(0,Math.min(1,(x-r.left)/r.width)));if(commit&&h.active&&lastIndex!==h.index){lastIndex=h.index;navigate(h.index);}}
 function end(cancel=false){if(!drag)return;drag=null;lastIndex=-1;clearPreview();onHold(hovering&&!cancel);key='';update();}
 root.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hovering=true;onHold(true);show(e.clientX);}});
 root.addEventListener('pointerdown',e=>{if(e.button!==0)return;if(e.isPrimary===false){end(true);return;}drag={id:e.pointerId,x:e.clientX};onHold(true);root.setPointerCapture(e.pointerId);show(e.clientX);e.preventDefault();e.stopPropagation();});
 root.addEventListener('pointermove',e=>{if(drag&&drag.id!==e.pointerId)return;show(e.clientX,!!drag&&Math.abs(e.clientX-drag.x)>3);});
 root.addEventListener('pointerup',e=>{if(drag?.id!==e.pointerId)return;const h=hit(e.clientX);if(h&&h.index!==lastIndex)navigate(h.index);end();hidePreview();e.stopPropagation();});
 root.addEventListener('pointercancel',()=>end(true));root.addEventListener('lostpointercapture',()=>end(true));
 root.addEventListener('pointerleave',()=>{hovering=false;if(!drag){clearPreview();onHold(false);}});root.addEventListener('click',e=>e.stopPropagation());
 range.addEventListener('input',()=>{navigate(Number(range.value));preview(Number(range.value),.5);});range.addEventListener('blur',clearPreview);
 function cancelInteraction(){const held=hovering||!!drag;hovering=false;end(true);clearPreview();if(held)onHold(false);}
 const visibility=()=>{if(document.hidden)cancelInteraction();};
 window.addEventListener('blur',cancelInteraction);window.addEventListener('resize',cancelInteraction);document.addEventListener('visibilitychange',visibility);
 const observer=new ResizeObserver(update);observer.observe(host);update();return {update,cancel:()=>end(true),destroy(){cancelInteraction();observer.disconnect();window.removeEventListener('blur',cancelInteraction);window.removeEventListener('resize',cancelInteraction);document.removeEventListener('visibilitychange',visibility);root.remove();}};
}
