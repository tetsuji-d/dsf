import {renderFixedTextRunText} from './fixed-text-whitespace.js';
export function renderLinkedRun(element,text,mode,documentRef,links,lineIndex,runIndex) {
    const regions=(links||[]).flatMap(link=>link.textRegions.filter(r=>r.lineIndex===lineIndex&&r.runIndex===runIndex).map(r=>({...r,link}))).sort((a,b)=>a.start-b.start);
    if(!regions.length){renderFixedTextRunText(element,text,mode,documentRef);return;}
    let cursor=0;
    for(const region of regions){if(region.start<cursor)continue;
        const plain=documentRef.createElement('span');renderFixedTextRunText(plain,text.slice(cursor,region.start),mode,documentRef);element.append(plain);
        const span=documentRef.createElement('span');setLinkAttributes(span,region.link);renderFixedTextRunText(span,text.slice(region.start,region.end),mode,documentRef);element.append(span);cursor=region.end;
    }
    const tail=documentRef.createElement('span');renderFixedTextRunText(tail,text.slice(cursor),mode,documentRef);element.append(tail);
}
function setLinkAttributes(element,link){element.dataset.pageLinkId=link.id;element.dataset.targetPageId=link.targetPageId;element.dataset.pageLinkLabel=link.label;element.dataset.pageLinkNumber=String(link.number);element.tabIndex=0;element.setAttribute('role','button');element.setAttribute('aria-label',link.label?`${link.label} — p.${link.number}`:`p.${link.number}`);element.classList.add('reader-page-link');}
export function appendPageLinkRegions(root,links,documentRef){
    for(const link of links||[])for(const rect of link.rects){const button=documentRef.createElement('button');button.type='button';setLinkAttributes(button,link);button.classList.add('reader-page-link-area');Object.assign(button.style,{left:`${rect.x/3.6}%`,top:`${rect.y/6.4}%`,width:`${rect.width/3.6}%`,height:`${rect.height/6.4}%`});root.append(button);}
}
/** Two-step, touch-safe navigation. The confirmation is always the thumbnail. */
export function installReaderPageLinks({pages,renderThumbnail,navigate}) {
    const previewDuration=3000;
    const linkKey=link=>link?`${link.dataset.pageLinkId}:${link.dataset.targetPageId}`:null;
    let popup=null,active=null,gesture=null,cancelJourney=null,expiry=null,hoverKey=null,handledClick=null;
    let popupHovered=false,popupFocused=false;
    const isActive=link=>popup&&linkKey(active)===linkKey(link);
    function clearExpiry(){clearTimeout(expiry);expiry=null;}
    function scheduleExpiry(){clearExpiry();if(popup&&!popupHovered&&!popupFocused)expiry=setTimeout(close,previewDuration);}
    function close(){clearExpiry();popup?.remove();popup=null;active=null;popupHovered=false;popupFocused=false;}
    function cancel(){cancelJourney?.();cancelJourney=null;close();}
    function position(){if(!popup||!active?.isConnected){close();return;}const viewport=window.visualViewport;
        const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight;
        popup.style.width=`${Math.max(40,Math.min(168,width-24,(height-90)*9/16))}px`;
        popup.style.maxWidth=`${Math.max(40,width-24)}px`;popup.style.maxHeight=`${Math.max(40,height-24)}px`;
        const r=active.getBoundingClientRect(),p=popup.getBoundingClientRect();
        popup.style.left=`${Math.max(left+12,Math.min(r.left+(r.width-p.width)/2,left+width-p.width-12))}px`;
        popup.style.top=`${Math.max(top+12,Math.min(r.bottom+10+p.height>top+height?r.top-p.height-10:r.bottom+10,top+height-p.height-12))}px`;
    }
    function show(link){if(isActive(link))return;close();const target=pages().find(p=>p.id===link.dataset.targetPageId);if(!target)return;
        active=link;popup=document.createElement('div');popup.className='reader-link-preview';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','移動先のページ');
        const button=document.createElement('button');button.type='button';button.className='reader-link-thumbnail';button.setAttribute('aria-label',`p.${link.dataset.pageLinkNumber}へ移動`);
        const stage=document.createElement('div');stage.className='reader-link-thumbnail-stage';stage.innerHTML=renderThumbnail(target);stage.querySelectorAll('[data-page-link-id]').forEach(e=>{if(e.tagName==='BUTTON'){e.remove();return;}for(const key of ['role','tabindex','data-page-link-id','data-target-page-id','aria-label'])e.removeAttribute(key);});
        const text=document.createElement('span');text.textContent=link.dataset.pageLinkLabel?`${link.dataset.pageLinkLabel} · p.${link.dataset.pageLinkNumber}`:`p.${link.dataset.pageLinkNumber}`;
        button.append(stage,text);popup.append(button);document.body.append(popup);position();
        popup.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){popupHovered=true;clearExpiry();}});
        popup.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){popupHovered=false;scheduleExpiry();}});
        popup.addEventListener('focusin',()=>{popupFocused=true;clearExpiry();});
        popup.addEventListener('focusout',e=>{if(!popup?.contains(e.relatedTarget)){popupFocused=false;scheduleExpiry();}});
        scheduleExpiry();
        button.onclick=e=>{e.preventDefault();e.stopPropagation();const id=target.id;close();cancelJourney?.();cancelJourney=navigate(id)||null;};
    }
    const linkFor=e=>{
        if(popup?.contains(e.target))return null;
        const direct=e.target.closest?.('[data-page-link-id]');if(direct)return direct;
        // Reader has a transparent navigation layer above the painted page. Hit-test
        // the actual laid-out spans behind it so text links retain exact geometry.
        if(!e.target.closest?.('#click-layer')||!Number.isFinite(e.clientX))return null;
        return [...document.querySelectorAll('#viewer-content [data-page-link-id],#viewer-spread-content [data-page-link-id]')].find(link=>
            [...link.getClientRects()].some(r=>r.width>0&&r.height>0&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom));
    };
    // Remember the hovered logical link after expiry: small pointer movements
    // over the same text must not immediately reopen a dismissed preview.
    function hover(e){if(e.pointerType!=='mouse'||e.buttons)return;const link=linkFor(e),key=linkKey(link);if(key===hoverKey)return;hoverKey=key;if(link)show(link);}
    document.addEventListener('pointerover',hover,true);
    document.addEventListener('pointermove',hover,true);
    document.addEventListener('focusin',e=>{const link=linkFor(e);if(link&&!gesture)show(link);});
    document.addEventListener('pointerdown',e=>{const link=linkFor(e);if(link){gesture={link,wasOpen:isActive(link),x:e.clientX,y:e.clientY};e.stopPropagation();}else if(!popup?.contains(e.target))cancel();},true);
    document.addEventListener('pointerup',e=>{if(gesture){
        if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)<10&&linkKey(linkFor(e))===linkKey(gesture.link)){
            if(gesture.wasOpen)close();else show(gesture.link);
        }
        // A touch/pointer activation also emits click. Consume it once so a
        // second tap cannot close and then immediately reopen the thumbnail.
        handledClick={key:linkKey(gesture.link),until:performance.now()+1000};
        gesture=null;e.stopPropagation();
    }},true);
    document.addEventListener('pointercancel',()=>{gesture=null;});
    document.addEventListener('click',e=>{const link=linkFor(e);if(link){e.preventDefault();e.stopImmediatePropagation();
        if(handledClick?.key===linkKey(link)&&performance.now()<handledClick.until){handledClick=null;return;}
        if(isActive(link))close();else show(link);
    }},true);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancel();return;}const link=linkFor(e);if(link&&['Enter',' '].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();show(link);popup?.querySelector('button')?.focus();}else if(['ArrowLeft','ArrowRight','PageUp','PageDown'].includes(e.key))cancel();},true);
    window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    return {close,cancel};
}
