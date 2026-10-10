import { createPageLinkDraft, PAGE_REFERENCE_FORMATS, validatePageLinkSelection } from './page-link-draft.js';
import { getUILang } from './i18n-studio.js';
import '../css/studio-page-links.css';

/** Studio selection adapters backed by the private project navigation model. */
export function installStudioPageLinks({ root, capture, readTarget, resolvePage, pages, identity, modelFactory }) {
    let session = '', draft;
    const label = (ja, en) => getUILang() === 'en' ? en : ja;
    const errors = {
        SELECT_TARGET: ['ページ上の文字または画像を選択してください。', 'Select text or an image on the page.'],
        SELECT_TEXT_RANGE: ['対象の文字範囲を選択してください。', 'Select a text range.'],
        TARGET_CHANGED: ['対象が変更されています。閉じて選び直してください。', 'The source changed. Close and select it again.'],
        CAPTION_REQUIRED: ['画像リンクには表示中のキャプションが必要です。画像設定で追加してください。', 'Image links require a visible caption. Add one in image settings.'],
        ANCHOR_NAME_INVALID: ['アンカー名を1〜100文字で入力してください。', 'Enter an anchor name (1–100 characters).'],
        DESTINATION_UNRESOLVED: ['移動先を解決できません。本文ページの番号または有効なアンカーを選んでください。', 'Choose an available body page or anchor.'],
        PAGE_LINK_OVERLAP: ['設定済みのリンクと重なります。先に既存リンクを解除してください。', 'Remove the overlapping link first.'],
        PAGE_LINK_UNRESOLVED: ['リンク先または番号を確認してください。', 'Check the destination and reference.'],
        PAGE_NUMBER_INVALID: ['有効な本文ページ番号を入力してください。', 'Enter a valid body page number.'],
    };
    const message = error => label(...(errors[error.message] || errors.DESTINATION_UNRESOLVED));
    function getDraft() {
        const key = identity();
        if (key !== session || !draft) { session = key; draft = modelFactory ? modelFactory() : createPageLinkDraft({ readTarget, resolvePage, pages }); }
        return draft;
    }
    function open(mode) {
        const target = capture();
        const model = getDraft(), originalSession = session;
        const dialog = document.createElement('dialog');
        dialog.className = 'flow-annotation-dialog page-link-dialog';
        dialog.setAttribute('aria-labelledby', 'page-link-dialog-title');
        dialog.innerHTML = `<form method="dialog">
            <header><h2 id="page-link-dialog-title"></h2><button value="cancel" aria-label="${label('閉じる', 'Close')}">×</button></header>
            <p class="annotation-help" data-review></p>
            <label data-text-label>${label('対象の文字（ドラッグ・Shift＋矢印で範囲選択）', 'Select text (drag or Shift + arrows)')}<textarea readonly data-text rows="4"></textarea></label>
            <p data-image hidden></p><output data-selection></output>
            <label data-name-label>${label('アンカー名', 'Anchor name')}<input data-name maxlength="100"></label>
            <label data-kind-label>${label('リンク先', 'Destination')}<select data-kind><option value="anchor">${label('登録したアンカー', 'Registered anchor')}</option><option value="page">${label('絶対ページ番号', 'Absolute page number')}</option></select></label>
            <label data-anchor-label>${label('アンカー', 'Anchor')}<select data-anchor></select></label>
            <label data-page-label hidden>${label('本文ページ番号', 'Body page number')}<input data-page type="number" min="1" step="1"><small>${label('表紙を除いた既存のページ番号。挿入後も指定番号を維持します。', 'Uses body numbering, excluding covers; remains the same after insertion.')}</small></label>
            <label data-format-label>${label('ページ番号の表記', 'Page number style')}<select data-format></select></label>
            <div class="page-link-preview" data-preview hidden><span data-base></span> <span data-reference></span></div>
            <p data-error role="alert"></p><p data-result role="status"></p>
            <details><summary>登録済みアンカー</summary><div data-list></div></details><details><summary>設定済みリンク</summary><div data-links></div></details>
            <footer><button value="cancel">${label('閉じる', 'Close')}</button><button type="button" class="primary" data-apply></button></footer>
        </form>`;
        const q = selector => dialog.querySelector(selector), text = q('[data-text]');
        q('h2').textContent = mode === 'anchor' ? label('移動先アンカー', 'Destination anchor') : label('ページへのリンク', 'Link to page');
        q('[data-review]').textContent = label('文字リンクには参照番号、画像リンクにはキャプション内の参照番号を挿入します。番号は移動先に追従します。', 'Text and image captions include a page reference that follows the destination.');
        q('[data-apply]').textContent = mode === 'anchor' ? label('アンカーを登録', 'Register anchor') : label('リンクと番号を挿入', 'Insert link and number');
        const isText = target?.kind === 'text';
        q('[data-text-label]').hidden = !isText; q('[data-image]').hidden = !target || isText;
        q('[data-image]').textContent = target ? label('画像：', 'Image: ') + (target.caption || target.name || target.objectId) : '';
        text.value = isText ? target.text : '';
        if (isText) text.setSelectionRange(target.start ?? 0, target.end ?? 0);
        q('[data-name]').value = isText ? target.text.slice(target.start, target.end).slice(0, 100) : target?.name || '';
        q('[data-name-label]').hidden = mode !== 'anchor';
        for (const s of ['kind', 'anchor', 'format']) q(`[data-${s}-label]`).hidden = mode === 'anchor';
        for (const [value, name] of PAGE_REFERENCE_FORMATS) q('[data-format]').add(new Option(value === 'kanji' ? label(name, 'Vertical kanji digits') : name, value));
        q('[data-format]').value = 'paren';
        q('[data-page]').value = String(pages().find(p => p.number)?.number || 1);
        const destination = () => q('[data-kind]').value === 'anchor' ? { kind: 'anchor', anchorId: q('[data-anchor]').value } : { kind: 'page', pageNumber: Number(q('[data-page]').value) };
        function list() {
            const select = q('[data-anchor]'), current = select.value;
            select.replaceChildren(new Option(label('アンカーを選択', 'Choose anchor'), ''));
            q('[data-list]').replaceChildren();
            for (const a of model.anchors().filter(a => a.target.language === target?.language)) {
                const title = `${a.name} — ${a.page?.number ? `p.${a.page.number}` : label('未解決', 'Unresolved')}`;
                const option = new Option(title, a.id); option.disabled = !a.page?.number; select.add(option);
                const row = document.createElement('p'); row.textContent = title; q('[data-list]').append(row);
                if(model.removeAnchor){const remove=document.createElement('button');remove.type='button';remove.textContent=label('解除','Remove');remove.onclick=()=>{model.removeAnchor(a.id);dialog.close();};row.append(' ',remove);}
            }
            select.value = current;
            q('[data-links]').replaceChildren();
            for(const link of model.links()){
                const row=document.createElement('p');row.textContent=(link.source.kind==='image'?label('画像','Image'):link.source.text.slice(link.source.start,link.source.end))+' '+link.reference.text+(link.unresolved||link.source.unresolved?' — '+label('未解決','Unresolved'):'');
                const remove=document.createElement('button');remove.type='button';remove.textContent=label('リンクを解除','Remove link');remove.onclick=()=>{model.remove(link.id);dialog.close();};row.append(' ',remove);q('[data-links]').append(row);
            }
        }
        function update() {
            q('[data-error]').textContent = ''; q('[data-preview]').hidden = true;
            q('[data-anchor-label]').hidden = mode === 'anchor' || q('[data-kind]').value !== 'anchor';
            q('[data-page-label]').hidden = mode === 'anchor' || q('[data-kind]').value !== 'page';
            q('[data-selection]').textContent = isText ? label('選択：', 'Selection: ') + target.text.slice(target.start, target.end) : '';
            try {
                if (identity() !== originalSession) throw Error('TARGET_CHANGED');
                if (!target) throw Error('SELECT_TARGET');
                validatePageLinkSelection(target);
                if (mode === 'link') {
                    const preview = model.preview(target, destination(), q('[data-format]').value);
                    q('[data-preview]').hidden = false; q('[data-base]').textContent = preview.text;
                    q('[data-reference]').textContent = preview.reference;
                    q('[data-reference]').classList.toggle('page-link-kanji', q('[data-format]').value === 'kanji');
                }
                q('[data-apply]').disabled = false;
            } catch (error) { q('[data-error]').textContent = message(error); q('[data-apply]').disabled = true; }
        }
        const range = () => { if (isText) { target.start = text.selectionStart; target.end = text.selectionEnd; update(); } };
        for (const event of ['select', 'keyup', 'pointerup']) text.addEventListener(event, range);
        for (const input of dialog.querySelectorAll('input, select')) input.addEventListener('input', update);
        q('[data-apply]').onclick = () => {
            try {
                if (identity() !== originalSession) throw Error('TARGET_CHANGED');
                if (mode === 'anchor') model.register(target, q('[data-name]').value);
                else model.setLink(target, destination(), q('[data-format]').value);
                q('[data-result]').textContent = label('設定しました。', 'Applied.');
                if(mode==='link'){dialog.close();return;}
                list(); update();
            } catch (error) { q('[data-error]').textContent = message(error); }
        };
        dialog.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) e.stopPropagation(); });
        const previous = document.activeElement;
        dialog.addEventListener('close', () => { dialog.remove(); previous?.focus({ preventScroll: true }); }, { once: true });
        document.body.append(dialog); list(); update(); dialog.showModal();
        if (isText) { text.focus(); text.setSelectionRange(target.start ?? 0, target.end ?? 0); }
    }
    const group = document.createElement('div'); group.className = 'flow-ribbon-group page-link-ribbon';
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label('ページリンク', 'Page links'));
    for (const [mode, icon, ja, en] of [['anchor', 'bookmark_add', '移動先アンカー', 'Destination anchor'], ['link', 'link', 'ページへのリンク', 'Link to page']]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'studio-ribbon-icon studio-ribbon-labeled';
        b.dataset.pageLinkCommand = mode; b.title = b.ariaLabel = label(ja, en);
        const symbol = document.createElement('span'); symbol.className = 'material-icons'; symbol.ariaHidden = 'true'; symbol.textContent = icon;
        const caption = document.createElement('span'); caption.className = 'ribbon-action-label'; caption.textContent = label(ja, en);
        b.append(symbol, caption); b.onmousedown = e => e.preventDefault(); b.onclick = () => open(mode); group.append(b);
    }
    root.append(group);
}
