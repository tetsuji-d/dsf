import { openEditionEmbedDialog } from './edition-embed-dialog.js';
import { editionListFolder, editionListCounts } from './edition-list.js';
import { EDITION_FOLDERS, editionFolder } from './edition-policy.js';
import { EDITION_SORTS, editionShareUrl, selectEditionRows } from './edition-list-presentation.js';
import { withEditionDeadline } from './edition-load-deadline.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strings = en => en ? {
    public: 'Public', unlisted: 'Unlisted', private: 'Private', archived: 'Archive',
    archive: 'Move to Archive', restore: 'Restore to Private', discard: 'Shred permanently',
    empty: 'No editions in this folder.', preview: 'Preview', copy: 'Copy URL', refresh: 'Refresh',
    successor: 'Successor edition', none: 'No successor', apply: 'Save successor',
    loading: 'Loading editions…', error: 'The operation could not be completed. Refresh and retry.',
    publishConfirm: 'This edition and its URL will be fixed. Content changes require a new edition. Continue?',
    archiveConfirm: 'Move this edition to Archive? Readers will no longer be able to read it. The editable Read remains.',
    discardConfirm: 'Permanently shred this edition? Its delivery files will be deleted. This cannot be undone. The editable Read and other editions remain.',
    cleanup: 'File deletion is incomplete. Retry shredding to finish.', copied: 'URL copied.',
    intro: 'Each row is a separate edition. Editing the editable Read does not change an issued edition.',
    settings: 'Edition settings', label: 'Edition name (e.g. Second edition)', saveLabel: 'Save name',
    title: 'Title / URL', edition: 'Edition', visibility: 'Visibility', issued: 'Issued', actions: 'Actions', unnamed: 'Not set',
    search: 'Search titles, edition names and URLs in this folder', clear: 'Clear search', sort: 'Sort by',
    sorts: ['Issued: newest first', 'Issued: oldest first', 'Title: A–Z', 'Title: Z–A', 'Edition name: A–Z', 'Edition name: Z–A'],
    noMatch: 'No matching Reads. Change or clear your search.', urlUnknown: 'URL unconfirmed', legacy: 'Older format',
} : {
    public: '公開', unlisted: '限定公開', private: '非公開', archived: 'アーカイブ',
    archive: 'アーカイブへ移動', restore: '非公開に戻す', discard: '廃棄する（シュレッダー）',
    empty: 'このフォルダにリードはありません。', preview: 'プレビュー', copy: 'URLをコピー', refresh: '更新',
    successor: '後継の版', none: '後継版なし', apply: '後継版を保存',
    loading: '発行した版を読み込んでいます…', error: '操作を完了できませんでした。更新して再試行してください。',
    publishConfirm: 'この版の内容とURLが固定されます。本文の修正は新版として発行します。公開しますか？',
    archiveConfirm: 'アーカイブへ移動しますか？読者から閲覧できなくなります。編集用リードは残ります。',
    discardConfirm: 'この版を廃棄しますか？配信ファイルを削除します。取り消せません。編集用リードと他の版は残ります。',
    cleanup: '配信ファイルの削除が未完了です。シュレッダーを再実行してください。', copied: 'URLをコピーしました。',
    intro: '各リードは独立した版です。編集用リードを編集しても、発行済みの版は変わりません。',
    settings: '版の設定', label: '版の名称（例：第二版）', saveLabel: '版名を保存',
    title: 'タイトル / URL', edition: '版', visibility: '公開状態', issued: '発行日', actions: '操作', unnamed: '未設定',
    search: 'このフォルダ内のタイトル・版名・URLを検索', clear: '検索をクリア', sort: '並び替え',
    sorts: ['発行日：新しい順', '発行日：古い順', 'タイトル：昇順', 'タイトル：降順', '版名：昇順', '版名：降順'],
    noMatch: '一致するリードはありません。検索条件を変更するか、クリアしてください。', urlUnknown: 'URL未確認', legacy: '旧形式',
};
function failureMessage(error, en) {
    const code = error.code || error.message;
    const messages = {
        EDITION_LOAD_TIMEOUT: ['読み込みに時間がかかっています。「更新」で再試行してください。ブラウザーの再読み込みは不要です。', 'Loading is taking too long. Choose Refresh to retry without reloading the browser.'],
        EDITION_SCOPE_UNAVAILABLE: ['スペースを確認できませんでした。「更新」で再試行してください。', 'The space could not be confirmed. Choose Refresh to retry.'],
        EDITION_NETWORK_ERROR: ['通信が途切れました。接続を確認し、「更新」で再試行してください。', 'The connection was interrupted. Check your connection and choose Refresh.'],
        EDITION_AUTH_REQUIRED: ['ログインを確認できませんでした。ログインし直してリーズを開いてください。', 'Your sign-in could not be verified. Sign in again and reopen Reads.'],
        EDITION_READ_FORBIDDEN: ['この一覧を読み取る権限を確認できませんでした。ログイン中のアカウントを確認してください。', 'Access to this list was denied. Check the signed-in account.'],
        EDITION_CHANGED: ['別の操作で状態が変わりました。更新して確認してください。', 'This edition changed elsewhere. Refresh and check its status.'],
        EDITION_LEGACY_STORAGE_MIGRATION_REQUIRED: ['この旧版の配信ファイルは、安全な移行を確認してから廃棄・再公開できます。', 'This older edition needs a storage migration before shredding or republishing.'],
        EDITION_PUBLICATION_EXPIRED: ['この版の掲載期限が終了しています。', 'The listing period for this edition has ended.'],
        PUBLISHING_SPACE_REQUIRED: ['出版スペースへの所属を確認してください。', 'Assign the editable Read to a publishing space first.'],
        SHARED_AUTHORING_REQUIRED: ['共有作品は共有スペースの権限に沿って管理してください。', 'Manage this shared work through its shared space.'],
        WORKS_PUBLICATION_TITLE_REQUIRED: ['作品名が必要です。編集用リードに作品名を設定して新版を発行してください。', 'Set a work title in the editable Read and issue a new edition.'],
        EDITION_PUBLICATION_BLOCKED: ['この版は現在公開できません。アカウントと作品の状態を確認してください。', 'Publication is currently blocked. Check your account and work status.'],
    };
    return messages[code]?.[en ? 1 : 0] || strings(en).error;
}

/** IO is injected so the actual controls can be exercised without cloud data. */
export function mountEditionReads(root, io) {
    let rows = [], folder = io.initialFolder || 'private', disposed = false, busy = false, generation = 0, loadFailed = false;
    let search = '', sort = 'issued-desc', embedDialog = null;
    const text = () => strings(io.locale() === 'en');
    const current = () => !disposed && io.isCurrent();
    // Keep the complete LTR URL selectable/copyable, but show its distinguishing
    // suffix when the field is narrower than the URL (including after rotation).
    let urlFrame = 0;
    const showUrlEnds = () => {
        cancelAnimationFrame(urlFrame);
        urlFrame = requestAnimationFrame(() => {
            if (!current()) return;
            root.querySelectorAll('[data-edition-url]').forEach(input => { input.scrollLeft = input.scrollWidth; });
        });
    };
    const urlResize = new ResizeObserver(showUrlEnds);
    urlResize.observe(root);
    const emit = message => { const el = root.querySelector('[data-edition-message]'); if (el) el.textContent = message; };
    function render() {
        if (!current()) return;
        const t = text(), counts = editionListCounts(rows);
        root.innerHTML = `<section class="edition-reads"><p>${esc(t.intro)}</p>
            <nav class="edition-folders" aria-label="${io.locale() === 'en' ? 'Edition folders' : 'リーズのフォルダ'}">${EDITION_FOLDERS.map(key => `<button type="button" data-edition-folder="${key}" aria-pressed="${folder === key}">${esc(t[key])} <span>${loadFailed ? '—' : counts[key]}</span></button>`).join('')}</nav>
            <div class="edition-list-tools"><div class="edition-search"><input type="search" data-edition-search aria-label="${esc(t.search)}" placeholder="${esc(t.search)}" value="${esc(search)}"><button type="button" data-edition-clear>${esc(t.clear)}</button></div>
            <label class="edition-sort">${esc(t.sort)}<select data-edition-sort>${EDITION_SORTS.map((key, i) => `<option value="${key}" ${sort === key ? 'selected' : ''}>${esc(t.sorts[i])}</option>`).join('')}</select></label>
            <button type="button" data-edition-refresh>${esc(t.refresh)}</button></div>
            <p class="edition-result-count" data-edition-count role="status" aria-live="polite"></p><p data-edition-message role="status" aria-live="polite"></p>
            <table class="edition-table" aria-label="${io.locale() === 'en' ? 'Issued Reads' : '発行済みリードの一覧'}">
                <colgroup><col class="edition-col-title"><col class="edition-col-label"><col class="edition-col-status"><col class="edition-col-date"><col class="edition-col-actions"></colgroup>
                <thead><tr>${[t.title,t.edition,t.visibility,t.issued,t.actions].map(label => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody data-edition-results></tbody>
            </table></section>`;
        root.querySelectorAll('[data-edition-folder]').forEach(button => button.addEventListener('click', () => {
            if (busy) return; folder = button.dataset.editionFolder; render(); root.querySelector(`[data-edition-folder="${folder}"]`)?.focus();
        }));
        root.querySelector('[data-edition-refresh]').addEventListener('click', () => { if (!busy) void load({ force: true }); });
        const input = root.querySelector('[data-edition-search]');
        const searchChanged = () => { if (busy) return; search = input.value; renderResults(); };
        input.addEventListener('input', event => { if (!event.isComposing) searchChanged(); });
        input.addEventListener('compositionend', searchChanged);
        root.querySelector('[data-edition-clear]').addEventListener('click', () => { if (busy) return; input.value = ''; searchChanged(); input.focus(); });
        root.querySelector('[data-edition-sort]').addEventListener('change', event => { if (busy) return; sort = event.target.value; renderResults(); });
        renderResults();
    }
    function renderSettings(row, t) {
        if (row.legacy || row.state.status === 'disposed') return '';
        const successors = rows.filter(other => !other.legacy && !other.needsEditionMigration && other.workId === row.workId && other.releaseId !== row.releaseId && ['public', 'unlisted'].includes(editionFolder(other.state)));
        return `<details class="edition-settings"><summary>${esc(t.settings)}</summary><div>
            ${row.needsEditionMigration ? `<p>${io.locale() === 'en' ? 'Enable edition management to use this publication as a successor. Its existing URL remains valid.' : '後継版として選ぶには版の管理を有効にしてください。既存URLはそのまま使えます。'}</p><button type="button" data-edition-action="migrate">${io.locale() === 'en' ? 'Enable edition management' : '版の管理を有効にする'}</button>` : ''}
            <label>${esc(t.label)}<input data-edition-label maxlength="80" value="${esc(row.state.editionLabel || '')}"></label><button type="button" data-edition-action="label">${esc(t.saveLabel)}</button>
            ${!['public', 'unlisted'].includes(folder) ? `<label>${esc(t.successor)}<select data-edition-successor><option value="">${esc(t.none)}</option>${successors.map(other => `<option value="${esc(other.releaseId)}" ${row.state.successorEditionId === other.state.editionId ? 'selected' : ''}>${esc(other.title)} · ${esc(other.state.editionLabel || other.date)}</option>`).join('')}</select></label><button type="button" data-edition-action="successor">${esc(t.apply)}</button>` : ''}
        </div></details>`;
    }
    function renderResults() {
        if (!current()) return;
        const t = text(), en = io.locale() === 'en';
        const inFolder = rows.filter(row => editionListFolder(row.state) === folder);
        const selected = selectEditionRows(inFolder, { query: search, sort, locale: io.locale() });
        root.querySelector('[data-edition-count]').textContent = loadFailed ? '—' : en ? `${t[folder]} · Showing ${selected.length} of ${inFolder.length}` : `${t[folder]} · ${inFolder.length}件中 ${selected.length}件を表示`;
        root.querySelector('[data-edition-clear]').hidden = !search;
        const results = root.querySelector('[data-edition-results]');
        results.innerHTML = selected.length ? selected.map(row => {
            const state = row.state, archived = state.status === 'archived', removed = state.status === 'disposed';
            const title = row.title || (en ? 'Untitled' : '無題'), url = editionShareUrl(row);
            const date = row.sort ? new Date(row.sort) : null;
            const issued = date ? `<time datetime="${date.toISOString()}">${esc(date.toLocaleDateString(en ? 'en-US' : 'ja-JP'))}<span>${esc(date.toLocaleTimeString(en ? 'en-US' : 'ja-JP', {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}))}</span></time>` : esc(row.date || '—');
            return `<tr class="edition-row" data-edition-id="${esc(state.editionId)}">
                <td class="edition-title-cell"><div class="edition-title-layout">
                    <div class="edition-thumb"><span class="edition-thumb-placeholder" aria-hidden="true">▤</span>${row.thumbnail ? `<img src="${esc(row.thumbnail)}" loading="lazy" alt="">` : ''}</div>
                    <div class="edition-title-copy"><h3>${esc(title)}</h3>
                        ${row.titleIsWorkName ? `<p>${en ? 'Management name; issued title not recorded' : '管理名を表示中（発行時のタイトルは未記録）'}</p>` : ''}
                        <div class="edition-url-field"><input type="text" readonly spellcheck="false" data-edition-url aria-label="${esc(en ? `URL for ${title}` : `${title}のURL`)}" title="${esc(url || t.urlUnknown)}" value="${esc(url)}" placeholder="${esc(t.urlUnknown)}"><button type="button" class="edition-copy-icon" data-edition-action="copy" aria-label="${esc(en ? `Copy URL for ${title}` : `${title}のURLをコピー`)}" title="${esc(t.copy)}" ${url ? '' : 'disabled data-unavailable'}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="1.5"/><path d="M15 5V3H3v13h2"/></svg></button>${!row.legacy && !removed ? `<button type="button" class="edition-embed-icon" data-edition-action="embed-dialog" aria-haspopup="dialog" aria-label="${esc(en ? `Embed ${title}` : `${title}の埋め込み`)}" title="${en ? 'Embed' : '埋め込み'}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18"/></svg></button>` : ''}</div>
                        ${row.legacy ? `<p>${en ? 'Edition migration is required for archive or shredding.' : 'アーカイブ・廃棄には版の移行が必要です。'}</p>` : ''}
                        ${removed ? `<p>${esc(t.cleanup)}</p>` : ''}${renderSettings(row, t)}${!row.legacy && !removed ? `<details class="edition-view-stats"><summary>${en ? 'Views' : '閲覧数'}</summary><p>${en ? 'Qualified views (old load counts excluded)' : '新基準の閲覧数（過去の読み込み回数は含みません）'}: ${state.viewCounts ? `${state.viewCounts.views} / ${en ? 'Embed' : '埋め込み'} ${state.viewCounts.embed} / Reader ${state.viewCounts.reader}` : '—'}</p><button type="button" data-edition-action="stats">${en ? 'Refresh views' : '閲覧数を更新'}</button></details>` : ''}
                    </div></div></td>
                <td class="edition-label-cell" data-column-label="${esc(t.edition)}"><span class="${state.editionLabel ? '' : 'edition-muted'}">${esc(state.editionLabel || (row.legacy ? t.legacy : t.unnamed))}</span></td>
                <td class="edition-status-cell" data-column-label="${esc(t.visibility)}">${row.legacy || archived || removed ? `<span>${esc(t[editionListFolder(state)])}</span>` : `<select data-edition-status aria-label="${esc(en ? `Visibility of ${title}` : `${title}の公開状態`)}">${['private', 'unlisted', 'public'].map(status => `<option value="${status}" ${folder === status ? 'selected' : ''}>${esc(t[status])}</option>`).join('')}</select>`}</td>
                <td class="edition-date-cell" data-column-label="${esc(t.issued)}">${issued}</td>
                <td class="edition-actions-cell" data-column-label="${esc(t.actions)}"><div>${row.legacy ? '—' : archived || removed ? `${archived ? `<button type="button" data-edition-action="restore">${esc(t.restore)}</button>` : ''}<button type="button" class="edition-shred" data-edition-action="discard">${esc(t.discard)}</button>` : `<button type="button" data-edition-action="preview">${esc(t.preview)}</button><button type="button" data-edition-action="archive">${esc(t.archive)}</button>`}</div></td>
            </tr>`;
        }).join('') : `<tr><td colspan="5" class="edition-empty">${esc(loadFailed ? t.error : search ? t.noMatch : t.empty)}</td></tr>`;
        results.querySelectorAll('.edition-thumb img').forEach(img => { const failed = () => { img.hidden = true; }; img.addEventListener('error', failed); if (img.complete && !img.naturalWidth) failed(); });
        results.querySelectorAll('[data-edition-url]').forEach(input => {
            input.addEventListener('focus', () => { input.select(); showUrlEnds(); });
            input.addEventListener('blur', showUrlEnds);
        });
        showUrlEnds();
        results.querySelectorAll('[data-edition-action], [data-edition-status]').forEach(control => control.addEventListener(control.matches('select') ? 'change' : 'click', () => void act(control)));
        if (io.initialEditionId) {
            const target = [...results.querySelectorAll('[data-edition-id]')].find(el => el.dataset.editionId === io.initialEditionId);
            if (target) { target.tabIndex = -1; target.focus({preventScroll:true}); target.scrollIntoView({block:'nearest'}); io.initialEditionId = ''; }
        }
    }
    async function act(control) {
        if (busy || !current()) return;
        const element = control.closest('[data-edition-id]'), row = rows.find(row => row.state.editionId === element.dataset.editionId);
        if (!row) return;
        const requestedAction = control.dataset.editionAction || control.value;
        const action = requestedAction === 'migrate' ? (['public','unlisted'].includes(row.state.status) ? row.state.status : 'private') : requestedAction, t = text();
        if (action === 'preview') { try { await io.preview(row); } catch { if (current()) emit(t.error); } return; }
        if (action === 'copy') {
            try { const url = editionShareUrl(row); if (!url) return; await io.copy(url); if (current()) emit(t.copied); }
            catch { if (current()) emit(t.error); } return;
        }
        if (action === 'embed-dialog' && !row.legacy) {
            embedDialog?.dispose();
            embedDialog = openEditionEmbedDialog({row, locale:io.locale(), current, copy:io.copy, preview:io.preview,
                errorMessage:error=>{const en=io.locale()==='en',message=failureMessage(error,en);return message===text().error ? (en?'Could not save. Check your connection and retry.':'保存できませんでした。接続を確認して再試行してください。') : message;},
                save:async embedPolicy=>{const state=await io.execute(row,'embed',{embedPolicy});if(current()){row.state=state;row.needsEditionMigration=false;}return state;},
                onClose:()=>{embedDialog=null;if(current())control.focus({preventScroll:true});}
            });
            return;
        }
        if (row.legacy) return;
        const confirmText = action === 'discard' ? t.discardConfirm : action === 'archive' ? t.archiveConfirm
            : ['public', 'unlisted'].includes(action) && action !== editionFolder(row.state)
                ? `${t[action]}\n\n${t.publishConfirm}` : '';
        if (confirmText && !await io.confirm(confirmText)) { render(); return; }
        if (!current()) return;
        const successorReleaseId = element.querySelector('[data-edition-successor]')?.value || null;
        const editionLabel = element.querySelector('[data-edition-label]')?.value || '';
        busy = true; emit(action === 'discard' ? (io.locale() === 'en' ? 'Deleting edition files…' : '版の配信ファイルを削除しています…') : (io.locale() === 'en' ? 'Saving…' : '保存しています…')); root.querySelectorAll('button,select,input:not([readonly])').forEach(el => { el.disabled = true; });
        try {
            let state = await io.execute(row, action, action === 'label' ? {editionLabel} : { successorReleaseId });
            for (let part = 0; action === 'discard' && state.cleanupPending && part < 50; part++) {
                if (!current()) return;
                state = await io.execute({ ...row, state }, action, {});
            }
            if (!current()) return;
            row.state = state;
            row.needsEditionMigration = false;
            if (!['successor','label','embed','stats'].includes(action)) folder = state.status === 'disposed' ? 'archived' : editionFolder(state);
            render();
            if (action === 'stats') {
                const updated = [...root.querySelectorAll('[data-edition-id]')].find(el => el.dataset.editionId === row.state.editionId);
                const stats=updated?.querySelector('.edition-view-stats');if(stats)stats.open=true;
            }
        } catch (error) {
            if (!current()) return;
            // Reload the authoritative lifecycle after an ambiguous commit/partial purge.
            try { rows = await io.load({ force: true }); } catch { /* Preserve the previous list with an explicit error. */ }
            if (!current()) return; render(); emit(failureMessage(error, io.locale() === 'en'));
        } finally { busy = false; if (current()) root.querySelectorAll('button,select,input:not([readonly])').forEach(el => { el.disabled = el.hasAttribute('data-unavailable'); }); }
    }
    async function load({ force = false } = {}) {
        embedDialog?.dispose(); embedDialog=null;
        const run = ++generation; loadFailed = false;
        root.innerHTML = `<section class="edition-reads edition-loading" aria-busy="true"><p role="status">${esc(text().loading)}</p><button type="button" data-edition-retry>${esc(text().refresh)}</button></section>`;
        root.querySelector('[data-edition-retry]').onclick = () => void load({ force: true });
        try { const loaded = await withEditionDeadline(io.load({ force }), { timeoutMs: io.loadTimeoutMs || 35_000 }); if (!current() || run !== generation) return; rows = loaded; render(); }
        catch (error) { if (!current() || run !== generation) return; rows = []; loadFailed = true; render(); emit(failureMessage(error, io.locale() === 'en')); }
    }
    void load();
    return { dispose() { embedDialog?.dispose(); embedDialog=null; disposed = true; generation++; urlResize.disconnect(); cancelAnimationFrame(urlFrame); }, refresh: load };
}
