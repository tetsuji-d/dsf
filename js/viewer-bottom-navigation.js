/** Relocate existing controls so page navigation keeps its original handlers. */
export function initializeViewerBottomNavigation({panel,onLayoutChange}) {
    const $=id=>document.getElementById(id),root=document.createElement('nav');
    root.id='viewer-bottom-navigation';root.hidden=true;
    root.innerHTML='<div class="reader-bottom-controls"><div class="reader-bottom-middle"><div class="reader-bottom-meta"><output id="reader-page-count"></output></div></div></div>';
    document.body.append(root);
    const mobile=matchMedia('(max-width:650px), (pointer:coarse) and (max-height:650px)');
    const slider=document.querySelector('.slider-wrapper'),left=$('viewer-nav-left'),right=$('viewer-nav-right');
    const nav=panel.querySelector('.reader-assist-nav'),status=$('reader-assist-status');
    const originals=[slider,left,right,nav,status].map(node=>({node,parent:node.parentNode,next:node.nextSibling}));
    let attached=false;
    const measure=()=>{
        const height=attached?root.getBoundingClientRect().height:0;
        if(Number(document.body.dataset.viewerBottomHeight||0)!==height){
            document.body.dataset.viewerBottomHeight=String(height);
            document.body.style.setProperty('--viewer-bottom-height',height+'px');onLayoutChange();
        }
    };
    new ResizeObserver(measure).observe(root);
    return {
        update({lensMode,enabled,writing}) {
            const use=mobile.matches||lensMode;
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
            measure();
            return use;
        },
        contains:node=>root.contains(node)
    };
}
