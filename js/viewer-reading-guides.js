/** Reader-local, paint-only preferences. No authoring/publication mutations. */
export function initializeViewerReadingGuides() {
    const menu=document.getElementById('viewer-reading-guide'),toggle=document.getElementById('reading-guide-enabled'),strength=document.getElementById('reading-guide-strength'),mode=document.getElementById('reading-guide-mode');
    let saved={};try{saved=JSON.parse(localStorage.getItem('dsf-reader-line-guides')||'{}')}catch{}
    if(!saved || typeof saved!=='object')saved={};
    toggle.checked=saved.enabled===true;strength.value=Number.isFinite(saved.strength)?Math.max(10,Math.min(70,saved.strength)):25;
    mode.value=saved.mode==='all'?'all':'active';
    const labels=()=>{
        const en=document.documentElement.lang==='en';
        menu.querySelector('summary').title=en?'Reading guides':'読書ガイド';menu.querySelector('summary').setAttribute('aria-label',menu.querySelector('summary').title);
        document.getElementById('reading-guide-label').textContent=en?'Show line guides':'行ガイドを表示';
        document.getElementById('reading-guide-strength-label').textContent=en?'Strength':'濃さ';
        document.getElementById('reading-guide-mode-label').textContent=en?'Show':'表示';
        mode.options[0].textContent=en?'Current line only':'読んでいる行だけ';
        mode.options[1].textContent=en?'All lines':'すべての行';
        document.getElementById('reading-guide-note').textContent=en?'Tap text to place a marker beside the line, without tinting the letters. Fixed text pages only. Swipe or use arrows to turn pages.':'本文をタップすると、文字に色を重ねず行の脇に目印を表示します。固定テキストページ用。ページ移動はスワイプか矢印で。';
    };
    const paint=()=>{document.body.dataset.readingGuides=toggle.checked?'on':'off';document.body.style.setProperty('--reading-guide-alpha',Number(strength.value)/100);strength.disabled=!toggle.checked;mode.disabled=!toggle.checked;document.body.dataset.readingGuideMode=mode.value;};
    const save=()=>{paint();try{localStorage.setItem('dsf-reader-line-guides',JSON.stringify({enabled:toggle.checked,strength:Number(strength.value),mode:mode.value}))}catch{}};
    toggle.onchange=save;strength.oninput=save;mode.onchange=save;paint();labels();
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))menu.open=false;});
    menu.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
    return {refreshLabels:labels,highlightAt(x,y){
        if(!toggle.checked)return false;
        let best=null,distance=Infinity;
        for(const line of document.querySelectorAll('#viewer-stage .viewer-fixed-text-line[data-reading-line]')){
            const r=line.getBoundingClientRect();if(!r.width||!r.height)continue;
            const page=line.closest('.viewer-fixed-text-page').getBoundingClientRect();
            if(x<page.left||x>page.right||y<page.top||y>page.bottom)continue;
            const d=Math.hypot(Math.max(r.left-x,0,x-r.right),Math.max(r.top-y,0,y-r.bottom));
            if(d<distance){best=line;distance=d;}
        }
        if(!best||distance>14)return false;
        document.querySelectorAll('.reading-line-active').forEach(e=>e.classList.remove('reading-line-active'));best.classList.add('reading-line-active');return true;
    }};
}
