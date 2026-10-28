// Presentation-only position on an immutable edition. No identity or access changes.
export function editionReaderPositionUrl(editionId, {index=0,language='',view='flat'}={}) {
    if (!/^e_[a-f0-9]{64}$/.test(editionId)) throw new Error('EDITION_ID_INVALID');
    const params=new URLSearchParams({edition:editionId,page:String(Number.isSafeInteger(index)&&index>=0?Math.min(index+1,100000):1),view:view==='book'?'book':'flat'});
    if (/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(language)) params.set('lang',language);
    return `/viewer?${params}`;
}
export function readReaderPosition(search) {
    const p=new URLSearchParams(search);
    if(!/^e_[a-f0-9]{64}$/.test(p.get('edition')||'') || !p.has('page'))return null;
    if(['edition','page','lang','view'].some(key=>p.getAll(key).length>1))return null;
    const page=Number(p.get('page'));
    if(!Number.isSafeInteger(page)||page<1)return null;
    const lang=p.get('lang')||'';
    return {page:Math.min(page,100000),language:/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(lang)?lang:'',view:p.get('view')==='book'?'book':'flat'};
}
export function restoreReaderPosition(position, reader) {
    if(!position)return;
    // Select the language first: v2 can have a different page count per language.
    if(reader.languages().includes(position.language))reader.selectLanguage(position.language);
    const index=Math.max(0,Math.min(reader.total()-1,position.page-1));
    reader.selectPage(index);
    if(position.view==='book'&&reader.canReadBook())reader.openBook();
}
