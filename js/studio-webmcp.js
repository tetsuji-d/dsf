import { createEditorWriteTools } from './editor-write-tools.js';
import { createEditorReadonlyTools } from './editor-readonly-tools.js';
import '../css/studio-webmcp.css';
import { initStudioGemini, geminiHandoffMarkup } from './studio-gemini.js';

/** Register only our own tools; aborting one session never removes another owner's tools. */
export function createStudioWebMCP({ readState, getModelContext, applyEdit, onChange = () => {} }) {
    const service = createEditorReadonlyTools({ readState });
    const writer = createEditorWriteTools({ readState, readonly: service, applyEdit });
    let writable = false;
    let controller = null, status = 'off';
    const supported = () => {
        try { return typeof getModelContext()?.registerTool === 'function'; } catch { return false; }
    };
    const getStatus = () => supported() ? status : 'unsupported';
    const notify = () => onChange(getStatus());
    function disable(next = 'off') {
        const previous = controller;
        controller = null;
        service.disable(); writer.reset(); writable = false;
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
            for (const tool of [...service.getTools(), ...(writable ? writer.getTools() : [])]) {
                await api.registerTool({ ...tool, annotations: { ...tool.annotations, untrustedContentHint: true },
                    execute: async (args, options = {}) => {
                        if (active.signal.aborted || controller !== active || status !== 'on') throw Error('DSF_DISABLED');
                        if (options.signal?.aborted) throw Error('DSF_CANCELLED');
                        const result = tool.execute(args);
                        if (result.error) {
                            if (['WORK_CHANGED', 'NOT_IN_EDITOR', 'UNAVAILABLE', 'DISABLED'].includes(result.error.code)) disable();
                            if (tool.name === 'dsf_read_flow_paragraph' || tool.name === 'dsf_replace_flow_paragraph') return result;
                            throw Error(`DSF_${result.error.code}`);
                        }
                        return result;
                    },
                }, { signal: active.signal });
                if (active.signal.aborted || controller !== active) return;
            }
            status = 'on'; notify();
        } catch {
            if (controller === active) disable('error');
        }
    }
    return { enable, disable, getStatus, isWritable: () => writable };
}

const labels = {
    ja: { title: 'AI連携（読み取り専用）', notice: 'オンにすると、このタブの編集対象と検索した本文の抜粋を接続AIに提供します。本文の変更・保存・発行は行いません。',
        unsupported: 'このブラウザでは非対応', off: 'オフ', on: 'ツール提供中', registering: '登録中…', error: '登録失敗：再試行できます', room: 'エディターで有効にできます' },
    en: { title: 'AI tools (read-only)', notice: 'When enabled, the connected AI can read this tab’s editor context and searched text excerpts. It cannot edit, save or publish.',
        unsupported: 'Unavailable in this browser', off: 'Off', on: 'Tools available', registering: 'Registering…', error: 'Registration failed: retry available', room: 'Enable in the editor' },
};

export function initStudioWebMCP({ readState, getUILang, subscribeProjectSession, applyEdit, doc = document, win = window }) {
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
            root.querySelector('[data-ai-write-title]').textContent = getUILang() === 'en' ? 'Allow paragraph editing' : '段落の書き込みを許可';
            root.querySelector('[data-ai-write-notice]').textContent = getUILang() === 'en' ? 'The connected AI can read full paragraphs and change the current Flow in its displayed language. Normal autosave applies. Use Undo to revert.' : '接続AIが段落全文を読み、現在のFlow・表示言語の本文を書き換えます。通常の自動保存対象です。「元に戻す」で戻せます。';
            root.querySelector('[data-ai-title]').textContent = connection.isWritable() ? (getUILang() === 'en' ? 'AI tools (paragraph editing)' : 'AI連携（本文編集可）') : copy.title;
            root.querySelector('[data-ai-notice]').textContent = connection.isWritable() ? (getUILang() === 'en' ? 'Read and paragraph editing tools are available in this tab. Publishing is not exposed.' : 'このタブで読み取り・段落編集ツールを提供中です。発行操作は提供しません。') : copy.notice;
            root.querySelector('[data-ai-status]').textContent = status === 'unsupported' ? copy.unsupported : !inEditor ? copy.room : copy[status];
        });
    }
    const connection = createStudioWebMCP({ readState, getModelContext, applyEdit, onChange: sync });
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
        <small data-ai-status role="status"></small><p data-ai-notice></p>
        <label><input type="checkbox" data-ai-write disabled><span data-ai-write-title></span></label><p data-ai-write-notice></p>
    </div>`;
}
