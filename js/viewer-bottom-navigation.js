/** Relocate existing controls so page navigation keeps its original handlers. */
export function initializeViewerBottomNavigation({panel,onLayoutChange}) {
    const $=id=>document.getElementById(id),root=document.createElement('nav');
    root.id='viewer-bottom-navigation';root.hidden=true;
    root.innerHTML='<div class="reader-bottom-controls"><div class="reader-bottom-middle"><div class="reader-bottom-meta"><output id="reader-page-count"></output></div></div></div>';
    document.body.append(root);
    const count=document.createElement('button');count.id='viewer-mobile-page-count';count.type='button';count.hidden=true;
    count.onclick=()=>window.toggleUi();document.body.append(count);
    const mobile=matchMedia('(max-width:650px), (pointer:coarse) and (max-height:650px)');
    const slider=document.querySelector('.slider-wrapper'),left=$('viewer-nav-left'),right=$('viewer-nav-right');
    const nav=panel.querySelector('.reader-assist-nav'),status=$('reader-assist-status');
    const originals=[slider,left,right,nav,status].map(node=>({node,parent:node.parentNode,next:node.nextSibling}));
    let attached=false, fadeTimer=null, countKey='';
    const syncCount=()=>{
        const open=document.body.classList.contains('viewer-ui-visible');
        const image=!document.querySelector('#viewer-content .viewer-fixed-text-page');
        const key=count.textContent+'|'+image+'|'+open;
        count.setAttribute('aria-expanded',String(open));
        if(key===countKey)return;
        countKey=key;clearTimeout(fadeTimer);count.classList.remove('is-faded');
        if(image&&!open&&!count.hidden)fadeTimer=setTimeout(()=>count.classList.add('is-faded'),2000);
    };
    document.addEventListener('viewer-chrome-change',syncCount);
    const measure=()=>{
        const height=attached?root.getBoundingClientRect().height:0;
        if(Number(document.body.dataset.viewerBottomHeight||0)!==height){
            document.body.dataset.viewerBottomHeight=String(height);
            document.body.style.setProperty('--viewer-bottom-height',height+'px');requestAnimationFrame(onLayoutChange);
        }
    };
    new ResizeObserver(measure).observe(root,{box:'border-box'});
    return {
        update({lensMode,enabled,writing}) {
            const use=mobile.matches||lensMode;
            count.hidden=!mobile.matches;
            count.textContent=($('page-slider-label')?.textContent||'1')+' / '+($('page-slider-total')?.textContent||'1');
            count.dataset.label=count.textContent;
            count.setAttribute('aria-label',count.textContent+(document.documentElement.lang==='en'?' — Show/hide menu':' — メニュー表示／非表示'));
            count.setAttribute('aria-expanded',String(document.body.classList.contains('viewer-ui-visible')));
            if(use!==attached){
                attached=use;root.hidden=!use;document.body.classList.toggle('viewer-bottom-navigation',use);
                if(use){
                    root.prepend(slider);root.querySelector('.reader-bottom-controls').prepend(left);
                    root.querySelector('.reader-bottom-controls').append(right);
                    root.querySelector('.reader-bottom-middle').append(nav);
                    root.querySelector('.reader-bottom-meta').append(status);
                }else for(const {node,parent,next} of originals){parent.insertBefore(node,next?.parentNode===parent?next:null);}
            }
            root.dataset.writing=writing;root.dataset.lines=String(enabled);nav.hidden=use&&!enabled;status.hidden=use&&!enabled;
            root.setAttribute('aria-label',document.documentElement.lang==='en'?'Page and reading navigation':'ページと読書の操作');
            $('reader-page-count').textContent=($('page-slider-label')?.textContent||'1')+' / '+($('page-slider-total')?.textContent||'1');
            syncCount();measure();
            return use;
        },
        contains:node=>root.contains(node)
    };
}
