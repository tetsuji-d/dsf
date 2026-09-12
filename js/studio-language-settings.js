import { getAllLangs, getLangProps } from './lang.js';
import { getUILang, t } from './i18n-studio.js';
import { isFlowWritingModeSupported } from './flow-typography.js';
import { deriveFlowTranslationStatus } from './flow-translation-state.js';
import '../css/studio-language-settings.css';

export function languageName(key) {
    try { return new Intl.DisplayNames([getUILang()], {type:'language'}).of(key) || key; }
    catch { return key; }
}
export function languageDirections(key) {
    const registered = getAllLangs().find(item => item.code.toLowerCase() === key.toLowerCase());
    return (registered?.directions || getLangProps(key).directions).filter(item =>
        isFlowWritingModeSupported(key, item.value === 'rtl' ? 'vertical-rl' : 'horizontal-tb'));
}
let openDialog = false;
export function chooseSourceLanguage({languages, initial, configs={}, project=false}) {
    if (openDialog) return Promise.resolve(null);
    const keys = (languages || getAllLangs().map(item=>item.code)).filter(key=>languageDirections(key).length);
    if (!keys.length) return Promise.resolve(null);
    openDialog = true;
    return new Promise(resolve=>{
        const previous=document.activeElement;
        const dialog=document.createElement('dialog'); dialog.id='source-language-dialog';dialog.className='source-language-dialog';
        dialog.setAttribute('aria-labelledby','source-language-heading');
        dialog.innerHTML='<form method="dialog"><h2 id="source-language-heading"></h2><label><span class="source-label"></span><select name="sourceLanguage" required></select></label><label><span class="direction-label"></span><select name="pageDirection" required></select></label><p></p><footer><button value="cancel" formnovalidate></button><button value="create" class="primary"></button></footer></form>';
        dialog.querySelector('h2').textContent=t(project?'language_new_project':'language_new_flow');
        dialog.querySelector('.source-label').textContent=t('language_source');
        dialog.querySelector('.direction-label').textContent=t('language_direction');
        dialog.querySelector('p').textContent=t(project?'language_project_hint':'language_flow_hint');
        dialog.querySelector('[value=cancel]').textContent=t('language_cancel');dialog.querySelector('[value=create]').textContent=t('language_create');
        const lang=dialog.querySelector('[name=sourceLanguage]'),dir=dialog.querySelector('[name=pageDirection]');
        if(!project){dir.disabled=true;dialog.querySelector('.direction-label').textContent=t('language_configured_direction');}
        lang.replaceChildren(...keys.map(key=>new Option(`${languageName(key)} · ${key.toUpperCase()}`,key)));
        lang.value=keys.includes(initial)?initial:keys[0];
        function directions(){ const values=languageDirections(lang.value);dir.replaceChildren(...values.map(item=>new Option(t(item.value==='rtl'?'language_vertical':'language_horizontal'),item.value)));dir.value=values.some(item=>item.value===configs[lang.value]?.pageDirection)?configs[lang.value].pageDirection:values[0].value; }
        lang.addEventListener('change',directions);directions();
        dialog.addEventListener('close',()=>{const result=dialog.returnValue==='create'?{languageKey:lang.value,pageDirection:dir.value}:null;dialog.remove();openDialog=false;previous?.isConnected&&previous.focus({preventScroll:true});resolve(result);},{once:true});
        document.body.append(dialog);dialog.showModal();
    });
}
export function annotateTranslationPage(element,page,group) {
    if (!group || page.kind!=='flow' || page.languageKey===group.flow.document.sourceLanguage || page.isSourceFallback) return;
    const status=deriveFlowTranslationStatus(group,page.languageKey);
    for(const block of element.querySelectorAll('[data-flow-block-id]')){
        const id=block.dataset.flowBlockId,missing=status.body.ids.missing.includes(id),stale=status.body.ids.stale.includes(id);
        block.classList.toggle('flow-compare-missing',missing);block.classList.toggle('flow-compare-stale',stale);
        block.dataset.compareMissingLabel=t('compare_missing_short');
        if(missing||stale) block.title=t(missing?'compare_missing':'compare_review');
    }
}
export function updateLanguagePresentation({state, group, onIssue, onPrepare, busy=false}) {
    const row=document.querySelector('.flow-ribbon-status');if(!row)return;
    let root=document.getElementById('editor-language-status');
    if(!root){root=document.createElement('span');root.id='editor-language-status';root.innerHTML='<span></span><button type="button"></button><button type="button" data-prepare-typography></button>';row.prepend(root);}
    root.hidden=group?.kind!=='flow';if(root.hidden)return;
    const key=state.activeLang||group.flow.document.sourceLanguage,profile=group.flow.layout.typographyByLanguage[key];
    const source=group.flow.document.sourceLanguage;
    const direction=state.languageConfigs?.[key]?.pageDirection||languageDirections(key)[0]?.value||'ltr';
    root.firstElementChild.textContent=`${t('language_source')}: ${source.toUpperCase()} · ${t('language_content')}: ${key.toUpperCase()} · ${profile?t(profile.writingMode==='vertical-rl'?'language_vertical_short':'language_horizontal_short'):t('language_profile_missing')} · ${direction==='rtl'?'←':'→'}`;
    const status=deriveFlowTranslationStatus(group,key);const missing=status.body.counts.missing,stale=status.body.counts.stale;
    const button=root.querySelector('button');button.hidden=key===source||!(missing||stale);button.textContent=t('language_issues',{missing,stale});button.title=t('language_next_issue');button.disabled=busy;button.onclick=()=>onIssue([...status.body.ids.missing,...status.body.ids.stale]);
    const prepare=root.querySelector('[data-prepare-typography]');prepare.hidden=!state.blocks.some(block=>block.kind==='flow'&&!block.flow.layout.typographyByLanguage[key]);prepare.textContent=t('language_prepare');prepare.title=t('language_prepare_hint');prepare.disabled=busy;prepare.onclick=onPrepare;
    root.title=t('language_display_hint');
}
