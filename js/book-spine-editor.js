import { prepareSpaceImage } from './publishing-space-image.js';
import { normalizeBookSpineDesign, getBookSpinePresentation, renderBookSpine } from './book-spine-design.js';

const readiness = new WeakMap();
export function releaseBookSpineEditor(draft, container) {
    readiness.delete(draft);
    const save = container.closest('#project-settings-modal')?.querySelector('.ps-footer .btn-primary');
    if (save) save.disabled = false;
}
export const bookSpineSettingsReady = draft => !readiness.get(draft)?.blocked;

export function mountBookSpineEditor(container, draft, en = false, options = {}) {
    const tr = (ja, english) => en ? english : ja;
    const section = document.createElement('section'); section.className = 'ps-spine-editor';
    const heading = document.createElement('h4'); heading.textContent = tr('背表紙のデザイン', 'Spine design');
    const layout = document.createElement('div'); layout.className = 'ps-spine-layout';
    const fields = document.createElement('div'); fields.className = 'ps-spine-fields';
    const preview = document.createElement('div'); preview.className = 'ps-spine-preview';
    preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', tr('プレビュー', 'Preview'));
    const design = normalizeBookSpineDesign(draft.book?.spineDesign || {});
    if (!Object.hasOwn(design, 'publisherName') && !Object.hasOwn(design, 'publisherIcon')) design.publisherSource = 'space';
    const entry = {blocked: false}; readiness.set(draft, entry);
    const current = () => section.isConnected && readiness.get(draft) === entry && (options.isCurrent?.() ?? true);
    const inputs = {};
    let loading = false, failed = false, converting = false, requestId = 0;
    const persist = () => { draft.book.spineDesign = normalizeBookSpineDesign(design); };
    const meta = () => options.readMeta?.() || draft.meta?.[draft.activeLang] || draft.meta?.[draft.defaultLang] || {};
    const update = () => {
        persist();
        const info = meta();
        const view = getBookSpinePresentation(draft.book.spineDesign, {title: info.title || '', author: info.author || ''});
        renderBookSpine(preview, view); preview.style.flexBasis = `${view.thickness}px`;
        for (const key of ['title', 'author']) if (inputs[key]) inputs[key].placeholder = info[key] || tr('プロジェクト設定を使用', 'Use project information');
    };
    for (const [key, type, labelText] of [
        ['title', 'text', tr('題名', 'Title')], ['author', 'text', tr('著者名', 'Author')],
        ['backgroundColor', 'color', tr('背景色', 'Background')], ['textColor', 'color', tr('文字色', 'Text color')],
        ['fontSize', 'number', tr('文字サイズ', 'Text size')], ['publisherName', 'text', tr('出版社名', 'Publisher')],
    ]) {
        const label = document.createElement('label'); label.textContent = labelText;
        const input = document.createElement('input'); input.type = type; input.id = `ps-spine-${key}`; input.value = design[key] || '';
        inputs[key] = input;
        if (type === 'text') input.maxLength = key === 'title' ? 120 : 80;
        if (type === 'number') { input.min = 6; input.max = 24; input.step = 1; }
        input.oninput = () => { design[key] = type === 'number' ? Number(input.value) : input.value; update(); };
        input.onchange = () => { Object.assign(design, normalizeBookSpineDesign(design)); input.value = design[key]; update(); };
        label.append(input); fields.append(label);
    }
    const sourceLabel = document.createElement('label'); sourceLabel.className = 'ps-spine-source';
    const source = document.createElement('input'); source.type = 'checkbox'; source.id = 'ps-spine-publisher-source';
    source.checked = design.publisherSource === 'space';
    sourceLabel.append(source, document.createTextNode(tr('出版スペースの基本情報を使用', 'Use publishing space information')));
    const iconLabel = document.createElement('label'); iconLabel.textContent = tr('出版社アイコン', 'Publisher icon');
    const iconInput = document.createElement('input'); iconInput.type = 'file'; iconInput.id = 'ps-spine-publisherIcon'; iconInput.accept = 'image/png,image/jpeg,image/webp';
    const status = document.createElement('p'); status.className = 'ps-hint'; status.setAttribute('role', 'status');
    const clearIcon = document.createElement('button'); clearIcon.type = 'button'; clearIcon.className = 'btn';
    clearIcon.textContent = tr('出版社名の頭文字を使用', 'Use publisher initial');
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = tr('再読み込み', 'Retry'); retry.hidden = true;
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = tr('基本情報の参照に戻す', 'Use basic information');
    const controls = () => {
        entry.blocked = converting || (source.checked && (loading || failed));
        inputs.publisherName.disabled = source.checked;
        iconInput.disabled = clearIcon.disabled = source.checked || converting;
        source.disabled = reset.disabled = converting;
        retry.hidden = !failed || !source.checked;
        const save = container.closest('#project-settings-modal')?.querySelector('.ps-footer .btn-primary');
        if (save && current()) save.disabled = entry.blocked;
    };
    const loadPublisher = async () => {
        const id = ++requestId; loading = true; failed = false;
        status.textContent = tr('出版スペースの基本情報を読み込み中…', 'Loading publishing space information…'); controls();
        try {
            const publisher = await (options.loadPublisher?.() || {name: '', icon: ''});
            if (!current() || id !== requestId || !source.checked) return;
            design.publisherName = publisher.name || ''; design.publisherIcon = publisher.icon || '';
            inputs.publisherName.value = design.publisherName;
            status.textContent = publisher.saved ? tr('所有者が保存した出版社情報を使用します。基本情報の更新は所有者のプロジェクト設定で行えます。', 'Using publisher information saved by the owner. The owner can refresh it in project settings.') : publisher.name ? tr('参照元：', 'Source: ') + publisher.name : tr('所属する出版スペースがないため、出版社情報は表示しません。', 'No publishing space assigned; publisher information is omitted.');
            update();
        } catch {
            if (!current() || id !== requestId) return;
            failed = true; status.textContent = tr('出版社情報を取得できませんでした。再読み込みしてください。', 'Could not load publisher information. Please retry.');
        } finally { if (current() && id === requestId) { loading = false; controls(); } }
    };
    source.onchange = () => {
        ++requestId; loading = false; failed = false; status.textContent = '';
        if (source.checked) design.publisherSource = 'space'; else delete design.publisherSource;
        update(); controls(); if (source.checked) void loadPublisher();
    };
    retry.onclick = () => void loadPublisher();
    iconInput.onchange = async () => {
        const file = iconInput.files[0]; if (!file || converting || source.checked) return;
        converting = true; controls(); status.textContent = tr('アイコンを準備しています…', 'Preparing icon…');
        try {
            const image = await prepareSpaceImage(file, 'icon'); if (!current()) return;
            design.publisherIcon = image; update(); status.textContent = '';
        } catch { if (current()) status.textContent = tr('PNG・JPEG・WebP画像（20MBまで）を選択してください。', 'Choose a PNG, JPEG or WebP image (up to 20 MB).'); }
        finally { converting = false; if (current()) controls(); }
    };
    clearIcon.onclick = () => { design.publisherIcon = ''; iconInput.value = ''; update(); };
    reset.onclick = () => {
        ++requestId; design.title = ''; design.author = ''; design.publisherSource = 'space';
        inputs.title.value = inputs.author.value = ''; source.checked = true;
        update(); controls(); void loadPublisher();
    };
    const hint = document.createElement('p'); hint.className = 'ps-hint';
    hint.textContent = tr('題名・著者名は空欄でプロジェクト設定を参照します。出版社情報は、このプロジェクトが所属する出版スペースを参照します。', 'Blank title and author use project information. Publisher information comes from the space assigned to this project.');
    iconLabel.append(iconInput); fields.append(sourceLabel, iconLabel, clearIcon, status, retry, hint, reset);
    layout.append(fields, preview); section.append(heading, layout); container.append(section);
    for (const input of container.closest('#project-settings-modal')?.querySelectorAll('.ps-meta-input') || []) {
        input.addEventListener('input', () => { if (current()) update(); });
    }
    update(); controls(); if (source.checked) void loadPublisher();
}
