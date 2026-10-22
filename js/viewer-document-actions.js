/** Search only authored text; images and handwriting are never silently treated as OCR text. */
export function readerPageText(page, writingText='') {
    const fixed=page?.deliveryV2;
    const lines=(fixed?.lines||[]).map(line=>(line.runs||[]).map(run=>run.text||'').join('')).join('\n');
    return [lines,writingText].filter(Boolean).join('\n');
}
export function searchReaderPages(pages,query){
    const normalize=s=>String(s).normalize('NFKC').toLocaleLowerCase().replace(/[\r\n]/g,'');
    const needle=normalize(query).trim();if(!needle)return [];
    return pages.flatMap((page,index)=>{const text=normalize(page.text),at=text.indexOf(needle);return at<0?[]:[{index,label:page.label,snippet:text.slice(Math.max(0,at-35),at+needle.length+75)}];});
}
const paths={save:'<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',share:'<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4M9 14l6 4"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};
const icon=name=>`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
export function installReaderActions({getFile,canWrite,saveWriting,getPages,goTo}){
    const t=(ja,en)=>document.documentElement.lang==='en'?en:ja;
    const trigger=document.createElement('button');trigger.id='viewer-save-menu';trigger.type='button';trigger.className='btn-icon header-btn';trigger.innerHTML=icon('save');trigger.setAttribute('aria-haspopup','dialog');
    document.querySelector('#viewer-header .ui-controls').prepend(trigger);
    const refresh=()=>{trigger.setAttribute('aria-label',t('DSFの保存・共有','Save / share DSF'));trigger.title=trigger.getAttribute('aria-label');};refresh();
    new MutationObserver(refresh).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    function dialog(title){const d=document.createElement('dialog');d.className='reader-action-dialog';const h=document.createElement('h2');h.textContent=title;d.setAttribute('aria-label',title);d.append(h);const close=document.createElement('button');close.type='button';close.className='reader-action-close';close.textContent=t('閉じる','Close');close.onclick=()=>d.close();d.append(close);d.addEventListener('keydown',e=>e.stopPropagation());d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);return d;}
    trigger.onclick=()=>{const d=dialog(t('DSFの保存・共有','Save / share DSF'));const file=getFile();
        const add=(label,symbol,fn)=>{const b=document.createElement('button');b.type='button';b.className='reader-file-action';b.innerHTML=icon(symbol);const text=document.createElement('span');text.textContent=label;b.append(text);b.onclick=fn;d.append(b);return b;};
        add(t('書き込みを保存・書き出し','Save / export Writing'),'save',()=>{d.close();void saveWriting();}).disabled=!canWrite();
        add(t('共有用DSFを作成','Create a shared DSF'),'share',()=>{d.close();void saveWriting(true);}).disabled=!canWrite();
        const original=add(t('開いたDSFを保存','Save the opened DSF'),'download',()=>{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name||'read.dsfr';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});original.disabled=!file;
        const note=document.createElement('p');note.textContent=t('書き込みを含める場合は「書き込みを保存・書き出し」を選んでください。共有用DSFは編集をロックしたコピーです。','Use Save / export Writing to include edits. A shared DSF is an editing-locked copy.');d.append(note);d.showModal();};
    document.addEventListener('reader-search-open',()=>{const d=dialog(t('全文検索','Search all pages')),input=document.createElement('input'),note=document.createElement('p'),status=document.createElement('p'),list=document.createElement('div');input.type='search';input.placeholder=t('検索する文字','Search text');input.setAttribute('aria-label',input.placeholder);status.setAttribute('role','status');note.textContent=t('表示中の言語の全ページと入力した書き込み文字を検索します。画像内の文字・手書き線は対象外です。','Search all pages in the current language, including typed Writing. Image text and handwriting are excluded.');list.className='reader-search-results';d.append(input,note,status,list);const pages=getPages();
        const run=()=>{list.replaceChildren();const hits=searchReaderPages(pages,input.value);status.textContent=input.value.trim()?t(`${hits.length}ページに見つかりました`,`${hits.length} matching pages`):t('検索する文字を入力してください','Enter search text');for(const hit of hits.slice(0,100)){const b=document.createElement('button');b.type='button';b.textContent=`${hit.label||hit.index+1} · ${hit.snippet}`;b.onclick=()=>{d.close();goTo(hit.index);};list.append(b);}if(hits.length>100)status.textContent+=t('（先頭100件を表示）',' (first 100 shown)');};input.addEventListener('input',run);run();d.showModal();input.focus();});
}
