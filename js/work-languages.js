// Target reader languages, not a claim of translated UI or certified typesetting.
// Lookup aliases affect labels only. Saved keys and manifests are never rewritten.
export const WORK_LANGUAGE_TARGETS = Object.freeze([
    ['ja','日本語','Japanese','日本語'],['en','英語','English','English'],
    ['ko','韓国語','Korean','한국어'],['zh-Hans','中国語（簡体字）','Chinese (Simplified)','简体中文'],
    ['zh-Hant','中国語（繁体字）','Chinese (Traditional)','繁體中文'],['th','タイ語','Thai','ไทย'],
    ['vi','ベトナム語','Vietnamese','Tiếng Việt'],['id','インドネシア語','Indonesian','Bahasa Indonesia'],
    ['fil','フィリピノ語','Filipino','Filipino'],['ms','マレー語','Malay','Bahasa Melayu'],
    ['fr','フランス語','French','Français'],['de','ドイツ語','German','Deutsch'],
    ['es','スペイン語','Spanish','Español'],['it','イタリア語','Italian','Italiano'],
    ['pt','ポルトガル語','Portuguese','Português'],['ne','ネパール語','Nepali','नेपाली'],
    ['my','ミャンマー語','Burmese','မြန်မာဘာသာ'],['hi','ヒンディー語','Hindi','हिन्दी'],
    ['ru','ロシア語','Russian','Русский'],['ar','アラビア語','Arabic','العربية']
].map(([code,ja,en,native])=>Object.freeze({code,ja,en,native})));
const aliases={'zh-cn':'zh-Hans','zh-sg':'zh-Hans','zh-hans':'zh-Hans','zh-tw':'zh-Hant','zh-hk':'zh-Hant','zh-mo':'zh-Hant','zh-hant':'zh-Hant'};
export function workLanguageName(code,uiLanguage='ja',{native=false}={}) {
    const raw=String(code||'');const key=raw.toLowerCase().replaceAll('_','-');
    const regional={
        'en-us':{ja:'英語（米国）',en:'English (US)',native:'English (US)'},
        'en-gb':{ja:'英語（英国）',en:'English (UK)',native:'English (UK)'},
        'pt-br':{ja:'ポルトガル語（ブラジル）',en:'Portuguese (Brazil)',native:'Português (Brasil)'}
    }[key];
    const item=regional||WORK_LANGUAGE_TARGETS.find(item=>item.code.toLowerCase()===(aliases[key]||key).toLowerCase());
    if(item)return native?item.native:item[uiLanguage==='en'?'en':'ja'];
    // Preserve unknown, valid regional names instead of guessing a supported language.
    try{return new Intl.DisplayNames([uiLanguage==='en'?'en':'ja'],{type:'language',fallback:'code'}).of(raw)||raw;}catch{return raw;}
}
export function workLanguageOptionLabel(code,uiLanguage='ja') {
    const translated=workLanguageName(code,uiLanguage),native=workLanguageName(code,uiLanguage,{native:true});
    return translated===native?translated:`${translated} · ${native}`;
}
