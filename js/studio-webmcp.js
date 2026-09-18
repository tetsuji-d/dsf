import { createEditorImageTools } from './editor-image-tools.js';
import { createEditorAuthoringTools } from './editor-authoring-tools.js';
import { editorToolErrorMessage, withEditorToolRecovery } from './editor-tool-errors.js';
import { createEditorWriteTools } from './editor-write-tools.js';
import { createEditorReadonlyTools } from './editor-readonly-tools.js';
import '../css/studio-webmcp.css';
import { initStudioGemini, geminiHandoffMarkup } from './studio-gemini.js';

/** Register only our own tools; aborting one session never removes another owner's tools. */
export function createStudioWebMCP({ readState, readComposition, getModelContext, applyEdit, createProject, applyImagePage, prepareImage, discardImage, onChange = () => {} }) {
    const service = createEditorReadonlyTools({ readState, readComposition });
    const writer = createEditorWriteTools({ readState, readonly: service, applyEdit });
    const authoring = createEditorAuthoringTools({ readState, readonly: service, applyEdit, createProject });
    const images = createEditorImageTools({ readState, readonly: service, applyImagePage, prepareImage, discardImage });
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
        service.disable(); writer.reset(); authoring.reset(); images.reset(); writable = false; activity = null; toolCount = 0;
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
            const tools = [...service.getTools(), ...images.getTools(writable), ...(writable ? [...writer.getTools(), ...authoring.getTools()] : [])];
            for (const tool of tools) {
                await api.registerTool({ ...tool, annotations: { ...tool.annotations, untrustedContentHint: true },
                    execute: async (args, options = {}) => {
                        if (active.signal.aborted || controller !== active || status !== 'on') throw Error('DSF_DISABLED');
                        if (options.signal?.aborted) throw Error('DSF_CANCELLED');
                        const result = await tool.execute(args, options);
                        if (result.error && ['WORK_CHANGED', 'NOT_IN_EDITOR', 'UNAVAILABLE', 'DISABLED'].includes(result.error.code)) disable();
                        activity = { tool: tool.name, code: result.error?.code || null,
                            created: result.created === true, changed: result.changed === true, replayed: result.replayed === true };
                        notify();
                        return withEditorToolRecovery(result.changed === true || result.created === true
                            ? { ...result, compositionCheck: 'After layout completes, read dsf_get_editor_context and dsf_get_book_composition for every content language. Page counts and positional covers may have changed. New projects require re-enabling AI permission first.' } : result);
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
    ja: { title: 'AI連携（読み取り専用）', notice: 'オンにすると、このタブの編集対象・制作ルール・ページ構成・原稿一覧・画像素材一覧・本文の抜粋を接続AIに提供します。本文の変更・保存・発行は行いません。',
        unsupported: 'このブラウザでは非対応', off: 'オフ', on: 'ツール提供中', registering: '登録中…', error: '登録失敗：再試行できます', room: 'エディターで有効にできます' },
    en: { title: 'AI tools (read-only)', notice: 'When enabled, the connected AI can read this tab’s editor context, authoring rules, page composition, image asset lists, manuscript lists and searched text excerpts. It cannot edit, save or publish.',
        unsupported: 'Unavailable in this browser', off: 'Off', on: 'Tools available', registering: 'Registering…', error: 'Registration failed: retry available', room: 'Enable in the editor' },
};

export function initStudioWebMCP({ readState, readComposition, getUILang, subscribeProjectSession, applyEdit, createProject, applyImagePage, prepareImage, discardImage, doc = document, win = window }) {
    const gemini = initStudioGemini({ readState, getUILang, doc, win });
    const text = () => labels[getUILang() === 'en' ? 'en' : 'ja'];
    const getModelContext = () => win.top === win && win.isSecureContext ? doc.modelContext : null;
    function sync() {
        gemini.sync();
        const status = connection.getStatus(), inEditor = readState().room === 'editor', copy = text();
        doc.querySelectorAll('[data-studio-ai]').forEach(root => {
            const input = root.querySelector('[data-ai-read]');
            input.checked = status === 'on' || status === 'registering';
            input.disabled = status === 'unsupported' || !inEditor;
            const write = root.querySelector('[data-ai-write]');
            write.checked = connection.isWritable();
            write.disabled = input.disabled || !['on', 'registering'].includes(status) || typeof applyEdit !== 'function';
            root.querySelector('[data-ai-write-title]').textContent = getUILang() === 'en' ? 'Allow manuscript and image page editing' : '原稿・画像ページの作成と編集を許可';
            root.querySelector('[data-ai-write-notice]').textContent = getUILang() === 'en' ? 'The AI can create a new Flow project, append original-language headings/paragraphs, edit existing text, and receive image data, convert it to WebP, and add image pages. Creating a project closes the current one after a local backup and resets AI permission. Normal autosave applies. Appends and edits support Undo.' : 'AIが新規Flowプロジェクトを作成し、原文の見出し・段落の追加、本文編集、画像データの受け取り・WebP変換と画像ページ追加を行えます。新規作成時は現在の作品をローカル退避して切り替え、AI許可を解除します。追加・編集は通常の自動保存対象で、元に戻せます。';
            root.querySelector('[data-ai-title]').textContent = connection.isWritable() ? (getUILang() === 'en' ? 'AI tools (editing)' : 'AI連携（編集可）') : copy.title;
            root.querySelector('[data-ai-notice]').textContent = connection.isWritable() ? (getUILang() === 'en' ? 'Manuscript creation and editing tools are available in this tab. Publishing is not exposed.' : 'このタブで原稿の作成・編集ツールを提供中です。発行操作は提供しません。') : copy.notice;
            root.querySelector('[data-ai-status]').textContent = status === 'unsupported' ? copy.unsupported : !inEditor ? copy.room : copy[status];
            const ja = getUILang() !== 'en', last = connection.getActivity();
            root.querySelector('[data-ai-diagnostics]').textContent = status === 'on'
                ? (ja ? `登録済み ${connection.getToolCount()}ツール · document.modelContext` : `${connection.getToolCount()} tools registered · document.modelContext`)
                : '';
            root.querySelector('[data-ai-activity]').textContent = !last ? (ja ? 'このセッションでは呼び出し未確認' : 'No calls observed in this session')
                : `${last.tool}: ${last.code ? `${last.code} — ${editorToolErrorMessage(last.code, ja ? 'ja' : 'en')}`
                    : (ja ? (last.created ? '新規作品を作成（AI許可を再設定してください）' : last.replayed ? '再送受付（再適用なし）' : last.changed ? '作品の更新を実行' : '成功（変更なし）')
                        : (last.created ? 'Project created (enable AI permission again)' : last.replayed ? 'Replayed without applying again' : last.changed ? 'Work updated' : 'Success (no change)'))}`;

        });
    }
    const connection = createStudioWebMCP({ readState, readComposition, getModelContext, applyEdit, createProject, applyImagePage, prepareImage, discardImage, onChange: sync });
    doc.addEventListener('change', event => {
        if (!event.target.matches('[data-studio-ai] input')) return;
        if (event.target.matches('[data-ai-write]')) { void connection.enable(event.target.checked); }
        else if (event.target.checked) void connection.enable(); else connection.disable();
    });
    doc.addEventListener('studio-ui-language-change', sync);
    win.addEventListener('pagehide', () => connection.disable());
    win.addEventListener('pageshow', sync);
    subscribeProjectSession(() => { connection.disable(); gemini.close(); });
    // Catch room changes even if a future caller bypasses switchRoom. Per-execution
    // checks still apply before this observer's microtask runs.
    const observer = new MutationObserver(records => {
        if (records.some(record => record.oldValue === 'editor') || readState().room !== 'editor') { connection.disable(); gemini.close(); }
        else sync();
    });
    observer.observe(doc.body, { attributes: true, attributeFilter: ['data-room'], attributeOldValue: true });
    sync();
    return { disable: () => { connection.disable(); gemini.close(); }, sync };
}

export function studioWebMCPMarkup() {
    return `<div class="auth-panel-section studio-ai-tools" data-studio-ai>
        ${geminiHandoffMarkup()}
        <label><input type="checkbox" data-ai-read disabled><span data-ai-title>AI tools</span></label>
        <small data-ai-status role="status"></small><small data-ai-diagnostics></small><p data-ai-activity role="status"></p><p data-ai-notice></p>
        <label><input type="checkbox" data-ai-write disabled><span data-ai-write-title></span></label><p data-ai-write-notice></p>
    </div>`;
}
