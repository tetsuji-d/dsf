/** Two manuscript surfaces over the existing semantic editor, with one active language. */
import { t } from './i18n-studio.js';
export function createFlowManuscriptCompare({host, model, activate, canSwitch, rerender}) {
    let split=false,target='', renderOne=null,group=null,sync=true;
    const bar=document.createElement('div');bar.className='flow-manuscript-toolbar';
    const modes=document.createElement('div');modes.className='flow-compare-mode';modes.setAttribute('role','group');modes.setAttribute('aria-label',t('compare_mode'));
    const normal=document.createElement('button'),both=document.createElement('button');normal.type=both.type='button';normal.id='flow-manuscript-normal';both.id='flow-manuscript-split';
    modes.append(normal,both);
    const language=document.createElement('select');language.id='flow-manuscript-language';language.setAttribute('aria-label',t('compare_language'));
    const linked=document.createElement('button');linked.type='button';linked.id='flow-manuscript-sync';
    const sourceLabel=document.createElement('span');bar.append(modes,sourceLabel,language,linked);
    const body=document.createElement('div');body.className='flow-manuscript-panes';body.id='flow-manuscript-panes';
    normal.setAttribute('aria-controls',body.id);both.setAttribute('aria-controls',body.id);
    const left=document.createElement('div'),right=document.createElement('div');
    for(const root of [left,right]) {root.className='flow-authoring-editor';root.tabIndex=-1;root.setAttribute('role','region');body.append(root);}
    left.dataset.manuscriptSide='source';right.dataset.manuscriptSide='target';
    host.replaceChildren(bar,body);host.classList.add('flow-manuscript-host');
    const keys=()=>model().languages.filter(key=>key!==group?.flow.document.sourceLanguage);
    const active=()=>split && model().activeLang===target ? right : left;
    function labels(){
        modes.setAttribute('aria-label',t('compare_mode'));language.setAttribute('aria-label',t('compare_language'));
        sourceLabel.textContent=split ? `${t('compare_source')} · ${group?.flow.document.sourceLanguage.toUpperCase()}` : '';
        normal.textContent=t('compare_normal');both.textContent=t('compare_split');linked.textContent=t('compare_sync');
        normal.setAttribute('aria-pressed',String(!split));both.setAttribute('aria-pressed',String(split));linked.setAttribute('aria-pressed',String(sync));
        both.disabled=!keys().length;language.hidden=linked.hidden=!split;
        language.replaceChildren(...keys().map(key=>new Option(key.toUpperCase(),key)));language.value=target;
        body.dataset.split=String(split);right.hidden=!split;
        left.dataset.active=String(active()===left);right.dataset.active=String(active()===right);
    }
    function mode(value){if(split===value || !canSwitch())return;split=value;rerender();}
    normal.onclick=()=>mode(false);both.onclick=()=>mode(true);
    language.onchange=()=>{if(!canSwitch()){language.value=target;return;}target=language.value;activate(target);rerender();};
    linked.onclick=()=>{sync=!sync;labels();};
    let selected='';
    function highlight(){for(const root of [left,right])for(const el of root.querySelectorAll('[data-testid="flow-block"]'))el.classList.toggle('flow-manuscript-selected',el.dataset.flowBlockId===selected);}
    for(const root of [left,right]){
        const other=root===left?right:left;
        root.addEventListener('pointerdown',event=>{if(!canSwitch() && root!==active()){event.preventDefault();event.stopImmediatePropagation();}},true);
        root.addEventListener('focusin',event=>{
            if(!canSwitch() && root!==active()){event.stopImmediatePropagation();active().focus();return;}
            activate(root.dataset.languageKey);labels();selected=event.target.closest('[data-flow-block-id]')?.dataset.flowBlockId||'';highlight();
        },true);
        root.addEventListener('scroll',()=>{
            if(!split||!sync)return;
            if(Math.abs(root.scrollTop-(root._linkedTop??-9999))<1){root._linkedTop=null;return;}
            const positions=el=>new Map([...el.querySelectorAll('[data-testid="flow-block"]')].map(block=>[block.dataset.flowBlockId,block.getBoundingClientRect().top-el.getBoundingClientRect().top+el.scrollTop]));
            const a=positions(root),b=positions(other);
            const points=[[0,0],...[...a].filter(([id])=>b.has(id)).map(([id,y])=>[y,b.get(id)]),[root.scrollHeight,other.scrollHeight]];
            const y=root.scrollTop;
            for(let i=1;i<points.length;i++)if(y<=points[i][0]){
                const [x0,y0]=points[i-1],[x1,y1]=points[i];other.scrollTop=y0+(y1-y0)*Math.max(0,Math.min(1,(y-x0)/(x1-x0||1)));other._linkedTop=other.scrollTop;break;
            }
        },{passive:true});
    }
    return {activeRoot:active, refreshLabels:labels,
        render(next,render){group=next;renderOne=render;const source=group.flow.document.sourceLanguage;
            if(!keys().includes(target))target=model().activeLang!==source && keys().includes(model().activeLang)?model().activeLang:keys()[0];
            if(!keys().length)split=false;
            if(split&&model().activeLang!==source)target=model().activeLang;
            labels();renderOne(left,split?source:model().activeLang);if(split)renderOne(right,target);highlight();
        },
        refreshOther(root){if(!split || !canSwitch() || !renderOne)return;const other=root===left?right:left;renderOne(other,other.dataset.languageKey);highlight();},
    };
}
