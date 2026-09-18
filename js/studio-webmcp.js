import { createEditorPageTools } from './editor-page-tools.js';
import { createStudioAIPreferences, AI_PREFERENCE_KEY } from './studio-ai-preferences.js';
import { createEditorImageTools } from './editor-image-tools.js';
import { createEditorAuthoringTools } from './editor-authoring-tools.js';
import { editorToolErrorMessage, withEditorToolRecovery } from './editor-tool-errors.js';
import { createEditorWriteTools } from './editor-write-tools.js';
import { createEditorReadonlyTools } from './editor-readonly-tools.js';
import '../css/studio-webmcp.css';
import { initStudioGemini, geminiHandoffMarkup } from './studio-gemini.js';

/** Register only our own tools; aborting one session never removes another owner's tools. */
export function createStudioWebMCP({ readState, readComposition, getModelContext, selectPage, applyPageChange, applyEdit, createProject, applyImagePage, prepareImage, discardImage, onChange = () => {} }) {
    const service = createEditorReadonlyTools({ readState, readComposition });
    const writer = createEditorWriteTools({ readState, readonly: service, applyEdit });
    const authoring = createEditorAuthoringTools({ readState, readonly: service, applyEdit, createProject });
    const images = createEditorImageTools({ readState, readonly: service, applyImagePage, prepareImage, discardImage });
    const pages = createEditorPageTools({ readState, readonly: service, readComposition, selectPage, applyPageChange });
    let writable = false, activity = null, toolCount = 0;
    let controller = null, status = 'off';
    const supported = () => {
        try { return typeof getModelContext()?.registerTool === 'function'; } catch { return false; }
    };
    const getStatus = () => supported() ? status : 'unsupported';
    const notify = () => onChange(getStatus());
    function disable(next = 'off') {
        const previous = controller;
        controller = null;
        service.disable(); writer.reset(); authoring.reset(); images.reset(); pages.reset(); writable = false; activity = null; toolCount = 0;
        previous?.abort();
        status = next;
        notify();
    }
    async function enable(write = false) {
        disable();
        if (!supported()) return;
        if (service.enable().error) { disable('error'); return; }
        writable = write === true && typeof applyEdit === 'function';
        const active = new AbortController();
        controller = active;
        status = 'registering'; notify();
        try {
            const api = getModelContext();
            const tools = [...service.getTools(), ...images.getTools(writable), ...pages.getTools(writable), ...(writable ? [...writer.getTools(), ...authoring.getTools()] : [])];
            for (const tool of tools) {
                await api.registerTool({ ...tool, annotations: { ...tool.annotations, untrustedContentHint: true },
                    execute: async (args, options = {}) => {
                        if (active.signal.aborted || controller !== active || status !== 'on') throw Error('DSF_DISABLED');
                        if (options.signal?.aborted) throw Error('DSF_CANCELLED');
                        const result = await tool.execute(args, options);
                        if (controller !== active || active.signal.aborted) return withEditorToolRecovery(result);
                        if (result.error && ['WORK_CHANGED', 'NOT_IN_EDITOR', 'UNAVAILABLE', 'DISABLED'].includes(result.error.code)) disable();
                        activity = { tool: tool.name, code: result.error?.code || null,
                            created: result.created === true, changed: result.changed === true, replayed: result.replayed === true };
                        notify();
                        return withEditorToolRecovery(result.changed === true || result.created === true
                            ? { ...result, compositionCheck: 'After layout completes, read dsf_get_editor_context and dsf_get_book_composition for every content language. Page counts and positional covers may have changed. After switching projects, obtain a fresh workToken; saved access preferences are retained.' } : result);
                    },
                }, { signal: active.signal });
                if (active.signal.aborted || controller !== active) return;
            }
            toolCount = tools.length; status = 'on'; notify();
        } catch {
            if (controller === active) disable('error');
        }
    }
    return { enable, disable, getStatus, isWritable: () => writable, getToolCount: () => toolCount, getActivity: () => activity ? { ...activity } : null };
}

const labels = {
    ja: { title: 'AI連携', access: 'AIに許可する操作', read: '閲覧のみ', edit: '閲覧・編集',
        notice: 'AIが本文・素材・ページ構成を読み取り、検索や相談に使えます。作品は変更できません。',
        editNotice: 'AIが読み取りに加え、新規作品の作成、本文編集、ページの選択・並べ替え、画像ページの追加・差し替えを行えます。変更は元に戻せます。発行は含みません。',
        remembered: 'このブラウザーに保存します。作品の切り替えや再読み込み後も有効です。',
        temporary: 'ブラウザーに設定を保存できないため、このタブを開いている間だけ有効です。',
        unsupported: 'このブラウザーでは非対応', off: 'オフ', on: '利用可能', registering: '接続準備中…', error: '接続できませんでした', room: 'エディターに戻ると自動で再開します', retry: '再接続', details: '接続の詳細' },
    en: { title: 'AI connection', access: 'AI access', read: 'Read only', edit: 'Read and edit',
        notice: 'AI can read text, assets and page composition for search and advice. It cannot change your work.',
        editNotice: 'AI can also create projects, edit text, select or reorder pages, and add or replace page images. Changes support Undo. Publishing is not included.',
        remembered: 'Saved in this browser. Stays enabled across project changes and reloads.',
        temporary: 'Browser storage is unavailable. This setting lasts only while this tab is open.',
        unsupported: 'Unavailable in this browser', off: 'Off', on: 'Available', registering: 'Connecting…', error: 'Could not connect', room: 'Resumes automatically when you return to the editor', retry: 'Reconnect', details: 'Connection details' },
};

export function initStudioWebMCP({ readState, readComposition, getUILang, subscribeProjectSession, selectPage, applyPageChange, applyEdit, createProject, applyImagePage, prepareImage, discardImage, doc = document, win = window }) {
    const gemini = initStudioGemini({ readState, getUILang, doc, win });
    const text = () => labels[getUILang() === 'en' ? 'en' : 'ja'];
    const getModelContext = () => win.top === win && win.isSecureContext ? doc.modelContext : null;
    let access;
    function sync() {
        gemini.sync();
        const status = connection.getStatus(), inEditor = readState().room === 'editor', copy = text();
        const preference = access?.get() || { enabled: false, access: 'read', stored: true };
        doc.querySelectorAll('[data-studio-ai]').forEach(root => {
            const input = root.querySelector('[data-ai-read]');
            input.checked = preference.enabled;
            input.disabled = status === 'unsupported' && !preference.enabled;
            const mode = root.querySelector('[data-ai-access]');
            mode.value = preference.access;
            mode.disabled = !preference.enabled || typeof applyEdit !== 'function';
            mode.querySelector('[value="read"]').textContent = copy.read;
            mode.querySelector('[value="edit"]').textContent = copy.edit;
            mode.setAttribute('aria-label', copy.access);
            root.querySelector('[data-ai-access-title]').textContent = copy.access;
            root.querySelector('[data-ai-title]').textContent = copy.title;
            root.querySelector('[data-ai-notice]').textContent = preference.access === 'edit' ? copy.editNotice : copy.notice;
            root.querySelector('[data-ai-persistence]').textContent = preference.stored ? copy.remembered : copy.temporary;
            root.querySelector('[data-ai-status]').textContent = status === 'unsupported' ? copy.unsupported
                : !preference.enabled ? copy.off : !inEditor ? copy.room : copy[status];
            const retry = root.querySelector('[data-ai-retry]');
            retry.textContent = copy.retry;
            retry.hidden = !preference.enabled || !inEditor || !['error', 'off'].includes(status);
            root.querySelector('[data-ai-details-title]').textContent = copy.details;
            const ja = getUILang() !== 'en', last = connection.getActivity();
            root.querySelector('[data-ai-diagnostics]').textContent = status === 'on'
                ? (ja ? `登録済み ${connection.getToolCount()}ツール · document.modelContext` : `${connection.getToolCount()} tools registered · document.modelContext`) : '';
            root.querySelector('[data-ai-activity]').textContent = !last ? (ja ? 'この接続では呼び出し未確認' : 'No calls observed in this connection')
                : `${last.tool}: ${last.code ? `${last.code} — ${editorToolErrorMessage(last.code, ja ? 'ja' : 'en')}`
                    : (ja ? (last.created ? '新規作品を作成' : last.replayed ? '再送受付（再適用なし）' : last.changed ? '作品の更新を実行' : '成功（変更なし）')
                        : (last.created ? 'Project created' : last.replayed ? 'Replayed without applying again' : last.changed ? 'Work updated' : 'Success (no change)'))}`;
        });
    }
    const connection = createStudioWebMCP({ readState, readComposition, getModelContext, selectPage, applyPageChange, applyEdit, createProject, applyImagePage, prepareImage, discardImage, onChange: sync });
    let storage; try { storage = win.localStorage; } catch { /* Session-only fallback. */ }
    access = createStudioAIPreferences({ connection, readState, storage, onChange: sync });
    doc.addEventListener('change', event => {
        if (event.target.matches('[data-studio-ai] [data-ai-read]')) void access.set({ ...access.get(), enabled: event.target.checked });
        if (event.target.matches('[data-studio-ai] [data-ai-access]')) void access.set({ ...access.get(), access: event.target.value });
    });
    doc.addEventListener('click', event => { if (event.target.closest('[data-ai-retry]')) void access.retry(); });
    doc.addEventListener('studio-ui-language-change', sync);
    win.addEventListener('storage', event => { if (event.key === AI_PREFERENCE_KEY || event.key === null) void access.reload(); });
    win.addEventListener('pagehide', () => access.suspend());
    win.addEventListener('pageshow', () => { void access.resume(); });
    subscribeProjectSession(() => {
        access.pause(); gemini.close();
        // LOAD_PROJECT notifies before replacing the state. Rebind only after that synchronous change completes.
        queueMicrotask(() => { void access.refresh(); });
    });
    const observer = new MutationObserver(records => {
        if (records.some(record => record.oldValue === 'editor') || readState().room !== 'editor') { access.pause(); gemini.close(); }
        void access.refresh();
    });
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-room'], attributeOldValue: true });
    void access.refresh(); sync();
    return { disable: () => { access.pause(); gemini.close(); }, sync };
}

export function studioWebMCPMarkup() {
    return `<div class="auth-panel-section studio-ai-tools" data-studio-ai>
        ${geminiHandoffMarkup()}
        <label class="studio-ai-toggle"><span data-ai-title>AI connection</span><input type="checkbox" role="switch" data-ai-read disabled><span class="studio-ai-toggle-track" aria-hidden="true"></span></label>
        <small data-ai-status role="status"></small>
        <label class="studio-ai-access"><span data-ai-access-title>AI access</span><select data-ai-access><option value="read">Read only</option><option value="edit">Read and edit</option></select></label>
        <p data-ai-notice></p><p data-ai-persistence></p><button type="button" data-ai-retry hidden></button>
        <details><summary data-ai-details-title>Connection details</summary><small data-ai-diagnostics></small><p data-ai-activity role="status"></p></details>
    </div>`;
}
