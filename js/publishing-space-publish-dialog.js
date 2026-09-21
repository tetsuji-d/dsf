// Same dialog is exercised by the isolated fixture and the real Press/Works UI.
export async function choosePublishingSpace({request, projectId, purpose, getLocale, isCurrent = () => true}) {
    const en = getLocale() === 'en';
    const copy = en ? {
        title:'Choose a publishing space', hint:'Choose where to publish this work on Horizon. You can create, save and export DSP/DSF files without a space.',
        select:'Publishing space', placeholder:'Select a space', create:'Create a new space', name:'New space name',
        proceed:'Save selection and continue', cancel:'Cancel', loading:'Checking publishing space…',
        failed:'Could not confirm the publishing space. Check your connection and retry.', retry:'Retry',
        conflict:'The selection changed in another window. Review it and try again.', expired:'The account or manuscript changed. Close this dialog and try again.',
        disabled:'Publishing spaces are not enabled in this environment yet.', missing:'Save this manuscript to the cloud first.',
    } : {
        title:'発行する出版スペースを選択', hint:'Horizonで発行する作品の所属先を選びます。制作・保存・DSP／DSF書き出しは、所属未設定でも利用できます。',
        select:'出版スペース', placeholder:'選択してください', create:'新しいスペースを開設', name:'新しいスペース名',
        proceed:'所属を保存して続ける', cancel:'キャンセル', loading:'出版スペースを確認中…',
        failed:'出版スペースを確認できませんでした。接続を確認して再試行してください。', retry:'再試行',
        conflict:'別の画面で所属が変更されました。選択内容を確認して再試行してください。', expired:'アカウントまたは原稿が切り替わりました。閉じてやり直してください。',
        disabled:'この環境では出版スペースがまだ有効になっていません。', missing:'先に原稿をクラウドへ保存してください。',
    };
    const dialog = document.createElement('dialog'); dialog.className = 'publishing-space-publish-dialog';
    const title = document.createElement('h2'); title.id = 'publishing-space-publish-title'; title.textContent = copy.title;
    dialog.setAttribute('aria-labelledby', title.id);
    const hint = document.createElement('p'); hint.textContent = copy.hint;
    const message = document.createElement('p'); message.setAttribute('role', 'status');
    const form = document.createElement('form');
    const label = document.createElement('label'); label.textContent = copy.select;
    const select = document.createElement('select'); select.setAttribute('aria-label', copy.select); select.required = true; label.append(select);
    const nameLabel = document.createElement('label'); nameLabel.textContent = copy.name;
    const name = document.createElement('input'); name.maxLength = 80; nameLabel.append(name);
    const actions = document.createElement('div'); actions.className = 'publishing-space-publish-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = copy.cancel;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = copy.retry;
    const proceed = document.createElement('button'); proceed.type = 'submit'; proceed.textContent = copy.proceed;
    actions.append(cancel, retry, proceed); form.append(label, nameLabel, actions); dialog.append(title, hint, message, form);
    let data, busy = false, closed = false, creation = null, pendingAssignment = null;
    return new Promise(resolve => {
        function finish(value) { if (closed) return; closed = true; dialog.close(); dialog.remove(); resolve(value); }
        function current() { if (closed || !isCurrent()) throw new Error('AUTH_CHANGED'); }
        function controls() {
            label.hidden = !data; nameLabel.hidden = !data || select.value !== '__new';
            name.required = !nameLabel.hidden;
            for (const el of [select, name, proceed, retry]) el.disabled = busy;
            proceed.hidden = !data; retry.hidden = !!data || busy;
            cancel.disabled = busy; // Do not abandon an in-flight membership write.
        }
        function options() {
            select.replaceChildren(new Option(copy.placeholder, ''), ...data.spaces.map(s => new Option(s.name, s.id)), new Option(copy.create, '__new'));
            select.value = data.assignments[projectId] || (data.spaces.length ? '' : '__new');
        }
        function errorText(error) {
            return error.message === 'AUTH_CHANGED' ? copy.expired : error.message === 'SPACE_CONFLICT' ? copy.conflict
                : error.message === 'SPACES_DISABLED' ? copy.disabled : error.message === 'PROJECT_NOT_FOUND' ? copy.missing : copy.failed;
        }
        async function load(autoContinue = true) {
            busy = true; message.textContent = copy.loading; controls();
            try {
                current(); data = await request({kind:'publicationContext', projectId, purpose}); current();
                if (autoContinue && (!data.publication.required || data.publication.spaceId)) return finish(true);
                options(); message.textContent = '';
            } catch (error) { data = null; message.textContent = errorText(error); }
            finally { busy = false; controls(); }
        }
        select.onchange = controls;
        cancel.onclick = () => finish(false);
        dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) finish(false); });
        retry.onclick = () => load();
        form.onsubmit = async event => {
            event.preventDefault(); if (busy || !data || !form.reportValidity()) return;
            busy = true; controls(); message.textContent = copy.loading;
            try {
                current(); let spaceId = select.value;
                if (spaceId === '__new') {
                    const trimmed = name.value.trim(); if (!trimmed) throw new Error('INVALID_NAME');
                    if (!creation || creation.name !== trimmed) creation = {kind:'create', spaceId:'space_' + crypto.randomUUID(), name:trimmed, baseRevision:data.revision};
                    data = await request(creation); current(); spaceId = creation.spaceId;
                    options(); select.value = spaceId; creation = null;
                }
                // Keep the original precondition on ambiguous network retries.
                if (!pendingAssignment || pendingAssignment.spaceId !== spaceId) pendingAssignment = {kind:'assign', projectId, spaceId,
                    expectedSpaceId:data.assignments[projectId] || null, baseRevision:data.revision};
                data = await request(pendingAssignment); current(); pendingAssignment = null;
                data = await request({kind:'publicationContext', projectId, purpose}); current();
                if (data.publication.required && !data.publication.spaceId) throw new Error('SPACE_CONFLICT');
                finish(true);
            } catch (error) {
                if (error.message === 'SPACE_CONFLICT') { creation = null; pendingAssignment = null; await load(false); }
                message.textContent = errorText(error);
            } finally { busy = false; controls(); }
        };
        document.body.append(dialog); dialog.showModal(); void load();
    });
}
