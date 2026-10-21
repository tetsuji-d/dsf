import {getLangProps} from './lang.js';

// Lookup only: preserve the original language key in saved text.
export function basicLayoutLanguageKey(language) {
    const key=String(language||'en').toLowerCase().replaceAll('_','-');
    if(/^zh-(tw|hk|mo|hant)(-|$)/.test(key))return 'zh-tw';
    if(key==='zh'||key.startsWith('zh-'))return 'zh-cn';
    return key.split('-')[0];
}
export function basicLayoutWritingModes(language) {
    return getLangProps(basicLayoutLanguageKey(language)).writingModes;
}
export function languageTextDirection(language) {
    const key=String(language||'').toLowerCase();
    if(/-latn(?:-|$)/.test(key))return 'ltr';
    return /^(ar|he|iw|fa|ur|ps|dv|yi)(-|$)/.test(key)||/-(arab|hebr)(-|$)/.test(key)?'rtl':'ltr';
}
export function resolveBasicLayoutContext(project,blockIndex=project.activeBlockIdx) {
    const language=project.activeLang||project.defaultLang||'ja';
    const config=project.languageConfigs?.[language]||{},block=project.blocks?.[blockIndex];
    const props=getLangProps(basicLayoutLanguageKey(language)),modes=basicLayoutWritingModes(language);
    const textDirection=languageTextDirection(language);
    const pageDirection=['rtl','ltr'].includes(config.pageDirection)?config.pageDirection:
        textDirection==='rtl'?'rtl':props.directions[0]?.value||'ltr';
    let writingMode=config.writingMode;
    if(!modes.includes(writingMode))writingMode=modes.includes('vertical-rl')&&pageDirection==='rtl'?'vertical-rl':'horizontal-tb';
    let source='project',mixed=false;
    if(block?.kind==='flow'){
        const flowMode=block.flow?.layout?.typographyByLanguage?.[language]?.writingMode
            ||(block.flow?.document?.sourceLanguage===language?block.flow?.layout?.writingMode:null);
        if(modes.includes(flowMode)){writingMode=flowMode;source='manuscript';}
    }else if(block?.kind==='page'){
        const objectModes=[...new Set((block.content?.graphicObjects||[])
            .filter(o=>o.kind==='text'&&o.visible!==false&&o.texts?.[language]?.trim()&&!/^[\d\s０-９]+$/u.test(o.texts[language]))
            .map(o=>o.style?.writingMode).filter(mode=>modes.includes(mode)))];
        if(objectModes.length===1){writingMode=objectModes[0];source='page';}
        mixed=objectModes.length>1;
    }
    return {language,writingMode,pageDirection,textDirection,source,mixed};
}
