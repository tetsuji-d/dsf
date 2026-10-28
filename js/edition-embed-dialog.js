import { normalizeEmbedPolicy, embedCode } from './embed-policy.js';
import '../css/edition-embed-dialog.css';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Owned by the Reads session: dispose removes it on account/room changes. */
export function openEditionEmbedDialog({row, locale, save, copy, preview, current, onClose, errorMessage}) {
    const en = locale === 'en', t = (ja, english) => en ? english : ja;
    const dialog = document.createElement('dialog');
    dialog.className = 'edition-embed-dialog';
    dialog.setAttribute('aria-labelledby','edition-embed-heading');
    let active = true, saving = false, saved = row.state.embedPolicy || {mode:'off',allowedOrigins:[]};
    const status = {public:t('公開','Public'),unlisted:t('限定公開','Unlisted'),private:t('非公開','Private'),archived:t('アーカイブ','Archive')};
    dialog.innerHTML = `<header><h2 id="edition-embed-heading">${t('埋め込み','Embed')}</h2><button type="button" data-close aria-label="${t('閉じる','Close')}" title="${t('閉じる','Close')}">×</button></header>
      <div class="edition-embed-body">
        <section class="edition-embed-identity"><h3>${esc(row.title || t('無題','Untitled'))}</h3><p>${esc(row.state.editionLabel || t('版名未設定','Edition name not set'))} · ${esc(status[row.state.status] || row.state.status)}</p></section>
        ${!['public','unlisted'].includes(row.state.status) ? `<p class="edition-embed-notice">${t('現在は埋め込み先に表示されません。公開・限定公開にすると、保存した許可設定が有効になります。','This edition is not currently visible on embedded sites. Saved permissions apply when it becomes public or unlisted.')}</p>` : ''}
        <label>${t('埋め込みの許可','Allow embedding')}<select data-embed-mode>${[['off','許可しない','Do not allow'],['any','すべてのサイト','All sites'],['allowlist','指定サイトのみ','Specified sites']].map(([v,ja,english])=>`<option value="${v}" ${saved.mode===v?'selected':''}>${t(ja,english)}</option>`).join('')}</select></label>
        <div data-origin-section><label>${t('許可するHTTPSサイト（1行に1件・20件まで）','Allowed HTTPS sites (one per line, up to 20)')}<textarea data-embed-origins rows="3" placeholder="example.jp&#10;www.example.jp">${esc(saved.allowedOrigins.join('\n'))}</textarea></label><p class="edition-embed-help">${t('wwwや別のサブドメインは個別に登録してください。サイト作成サービスでは、埋め込みに使われる中間サイトも許可が必要な場合があります。','Register www and other subdomains separately. Website builders may also require permission for an intermediate embedding site.')}</p></div>
        ${row.state.status==='unlisted'?`<p class="edition-embed-help">${t('限定公開でも、埋め込み先の訪問者は閲覧・リンク共有できます。','Visitors to the embedded site can read and share the link to this unlisted edition.')}</p>`:''}
        <p class="edition-embed-help">${t('埋め込みを制限しても、公開・限定公開の版は通常のリンクから閲覧できます。','Embedding restrictions do not restrict regular links to public or unlisted editions.')}</p>
        <div class="edition-embed-save-row"><button type="button" data-save>${t('設定を保存','Save settings')}</button><span data-save-state role="status"></span></div>
        <p class="edition-embed-help">${t('貼り付け先の幅に合わせて、1ページ／見開きを自動で切り替えます。幅や高さの入力は不要です。','Pages automatically switch between single and spread to fit the available space. No width or height entry is needed.')}</p>
        <section class="edition-embed-display"><h3>${t('初期表示','Initial view')}</h3><label>${t('表示モード','View mode')}<select data-display-view><option value="flat">${t('通常表示','Flat view')}</option><option value="book">${t('ブック表示（ページのしなり）','Book view (curved pages)')}</option></select></label><label>${t('初期表示ページ','Starting page')}<input type="number" data-display-page min="1" max="100000" step="1" value="1" inputmode="numeric"></label><p class="edition-embed-help">${t('表紙を1として指定します。Open Read.後にこのページを開きます。総ページ数を超える場合は最終ページになります。読者は埋め込み内でも表示モードを切り替えられます。','Count the cover as page 1. Open Read. opens this page; values beyond the last page open the last page. Readers can also switch the view in the embed.')}</p></section><details><summary>${t('表示の詳細設定','Display options')}</summary><label>${t('ページ表示','Page layout')}<select data-display-layout><option value="auto">${t('自動（推奨）','Automatic (recommended)')}</option><option value="single">${t('1ページ','Single page')}</option><option value="spread">${t('見開き優先','Prefer spreads')}</option></select></label><label>${t('本の小口','Page edges')}<select data-display-edges><option value="1">${t('表示する','Show')}</option><option value="0">${t('表示しない（フラット）','Hide (flat)')}</option></select></label><p class="edition-embed-help">${t('今回コピーするコードに反映します。見開き優先でも狭い枠では1ページになります。','Applies to the code you copy. Narrow frames use one page even when spreads are preferred.')}</p></details>
        <section class="edition-embed-code-section"><label>${t('埋め込みコード','Embed code')}<textarea data-embed-code readonly rows="4" spellcheck="false">${esc(embedCode(row.state.editionId,row.title,location.origin))}</textarea></label><p data-code-state class="edition-embed-help"></p><button type="button" data-copy>${t('コードをコピー','Copy code')}</button></section>
        <details class="edition-embed-example"><summary>${t('表示見本（閲覧数に含めません）','Preview (not counted as a view)')}</summary><div class="edition-embed-cover"><div class="edition-embed-thumb"><span aria-hidden="true">▤</span>${row.thumbnail?`<img src="${esc(row.thumbnail)}" alt="" loading="lazy">`:''}</div><strong>${esc(row.title || 'DSF Reader')}</strong><button type="button" data-preview>${t('Readerで本文をプレビュー','Preview content in Reader')}</button></div><p class="edition-embed-help">${t('表紙の表示見本です。ドメインの許可は実際の掲載先サイトで確認してください。','This is a cover preview. Check domain permission on the destination website.')}</p></details>
        <p data-feedback role="status" aria-live="polite"></p>
        <section data-discard hidden><p>${t('保存していない変更があります。破棄して閉じますか？','There are unsaved changes. Discard them and close?')}</p><div><button type="button" data-keep>${t('編集に戻る','Keep editing')}</button><button type="button" data-discard-close>${t('変更を破棄して閉じる','Discard and close')}</button></div></section>
      </div>`;
    const mode=dialog.querySelector('[data-embed-mode]'), origins=dialog.querySelector('[data-embed-origins]');
    const code=()=>embedCode(row.state.editionId,row.title,location.origin,{layout:dialog.querySelector('[data-display-layout]').value,bookEdges:dialog.querySelector('[data-display-edges]').value==='1',view:dialog.querySelector('[data-display-view]').value,startPage:dialog.querySelector('[data-display-page]').value});
    for(const el of dialog.querySelectorAll('[data-display-layout],[data-display-edges],[data-display-view],[data-display-page]'))el.addEventListener('input',()=>{dialog.querySelector('[data-embed-code]').value=code();update();});
    const initialValue=()=>JSON.stringify([saved.mode,saved.allowedOrigins.join('\n')]);
    const dirty=()=>JSON.stringify([mode.value,origins.value])!==initialValue();
    const live=()=>active && current();
    const feedback=message=>{if(live())dialog.querySelector('[data-feedback]').textContent=message;};
    function update() {
        dialog.querySelector('[data-origin-section]').hidden=mode.value!=='allowlist';
        dialog.querySelector('[data-save-state]').textContent=saving?t('保存しています…','Saving…'):dirty()?t('未保存','Unsaved'):t('保存済み','Saved');
        dialog.querySelector('[data-save]').disabled=saving || !dirty();
        dialog.querySelector('[data-copy]').disabled=saving || dirty() || saved.mode==='off' || !dialog.querySelector('[data-display-page]').checkValidity();
        dialog.querySelector('[data-code-state]').textContent=dirty()?t('未保存の変更があります。設定を保存してからコピーしてください。','Save your changes before copying the code.'):saved.mode==='off'?t('埋め込みを許可して設定を保存すると、コードをコピーできます。','Allow embedding and save settings to copy the code.'):t('保存済みの設定が適用されます。','Saved settings apply.');
        for(const el of [mode,origins,dialog.querySelector('[data-close]')])el.disabled=saving;
    }
    function close() {
        if(!active)return; active=false; dialog.close();dialog.remove();onClose();
    }
    function requestClose() {
        if(saving)return;
        if(!dirty()){close();return;}
        dialog.querySelector('[data-discard]').hidden=false;
        dialog.querySelector('[data-keep]').focus();
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
    dialog.addEventListener('keydown',event=>{
        if(event.key!=='Tab')return;
        const controls=[...dialog.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')].filter(el=>!el.disabled && el.tabIndex>=0 && !el.closest('[hidden]') && el.getClientRects().length);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    });
    let backdrop=false;
    dialog.addEventListener('pointerdown',event=>{const r=dialog.getBoundingClientRect();backdrop=event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom);});
    dialog.addEventListener('click',event=>{if(backdrop&&event.target===dialog)requestClose();backdrop=false;});
    dialog.querySelector('[data-close]').onclick=requestClose;
    dialog.querySelector('[data-keep]').onclick=()=>{dialog.querySelector('[data-discard]').hidden=true;mode.focus();};
    dialog.querySelector('[data-discard-close]').onclick=close;
    for(const el of [mode,origins])el.addEventListener('input',()=>{feedback('');update();});
    dialog.querySelector('[data-save]').onclick=async()=>{
        if(saving||!live())return;
        let policy;
        try{policy=normalizeEmbedPolicy({mode:mode.value,allowedOrigins:mode.value==='allowlist'?origins.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean):[]});}
        catch{feedback(t('HTTPSのサイトを20件以内で入力してください。指定サイトの一覧は空にできません。','Enter up to 20 valid HTTPS sites. The specified-sites list cannot be empty.'));origins.focus();return;}
        saving=true;update();feedback('');dialog.querySelector('[data-discard]').hidden=true;
        try{const state=await save(policy);if(!live())return;saved=state.embedPolicy || policy;mode.value=saved.mode;origins.value=saved.allowedOrigins.join('\n');feedback(t('埋め込み設定を保存しました。','Embedding settings saved.'));}
        catch(error){feedback(errorMessage(error));}
        finally{saving=false;if(live())update();}
    };
    dialog.querySelector('[data-copy]').onclick=async()=>{try{await copy(code());feedback(t('埋め込みコードをコピーしました。','Embed code copied.'));}catch{feedback(t('コピーできませんでした。コード欄から選択してコピーしてください。','Copy failed. Select and copy the code from the field.'));}};
    dialog.querySelector('[data-preview]').onclick=async()=>{try{await preview(row);}catch(error){feedback(errorMessage(error));}};
    const img=dialog.querySelector('img');if(img)img.onerror=()=>{img.hidden=true;};
    document.body.append(dialog);update();dialog.showModal();dialog.querySelector('[data-close]').focus();
    return {dispose(){active=false;dialog.close();dialog.remove();}};
}
