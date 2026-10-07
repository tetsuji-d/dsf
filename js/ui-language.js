// Interface preferences never read or write manuscript language keys.
export const UI_LANGUAGE_KEY = 'dsf_ui_language';
const LEGACY_KEYS = {portal:'dsf_portal_lang',studio:'dsf_studio_ui_lang',viewer:'dsf_viewer_ui_lang'};
export const UI_LANGUAGES = Object.freeze([{code:'ja',label:'日本語'},{code:'en',label:'English'}]);
const supported=value=>UI_LANGUAGES.some(item=>item.code===value);
export function resolveUiLanguage({shared,legacy,browserLanguages=[]}={}) {
    if(supported(shared))return shared;
    if(supported(legacy))return legacy;
    for(const tag of browserLanguages){const base=String(tag).toLowerCase().split('-')[0];if(supported(base))return base;}
    return 'en';
}
let sessionLanguage;
function read(key){try{return localStorage.getItem(key);}catch{return null;}}
function write(key,value){try{localStorage.setItem(key,value);}catch{/* Session preference still works. */}}
export function getPlatformLanguage(surface='portal') {
    const shared=read(UI_LANGUAGE_KEY)||sessionLanguage;
    const language=resolveUiLanguage({shared,legacy:read(LEGACY_KEYS[surface]),browserLanguages:globalThis.navigator?.languages||[globalThis.navigator?.language]});
    sessionLanguage=language;write(UI_LANGUAGE_KEY,language);
    return language;
}
export function setPlatformLanguage(language) {
    if(!supported(language))return;
    const previous=read(UI_LANGUAGE_KEY)||sessionLanguage;
    sessionLanguage=language;write(UI_LANGUAGE_KEY,language);
    // Compatibility for already-open older screens and My Page. Not project data.
    Object.values(LEGACY_KEYS).forEach(key=>write(key,language));
    if(previous!==language)window.dispatchEvent(new CustomEvent('dsf-ui-language-change',{detail:language}));
}
export function subscribePlatformLanguage(listener) {
    const local=event=>listener(event.detail);
    const external=event=>{if(event.key===UI_LANGUAGE_KEY&&supported(event.newValue)){sessionLanguage=event.newValue;listener(event.newValue);}};
    window.addEventListener('dsf-ui-language-change',local);window.addEventListener('storage',external);
    return ()=>{window.removeEventListener('dsf-ui-language-change',local);window.removeEventListener('storage',external);};
}
