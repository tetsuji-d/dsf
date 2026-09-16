import { createEditorReadonlyTools } from './editor-readonly-tools.js';
import '../css/studio-webmcp.css';
import { initStudioGemini, geminiHandoffMarkup } from './studio-gemini.js';

/** Register only our own tools; aborting one session never removes another owner's tools. */
export function createStudioWebMCP({ readState, getModelContext, onChange = () => {} }) {
    const service = createEditorReadonlyTools({ readState });
    let controller = null, status = 'off';
    const supported = () => {
        try { return typeof getModelContext()?.registerTool === 'function'; } catch { return false; }
    };
    const getStatus = () => supported() ? status : 'unsupported';
    const notify = () => onChange(getStatus());
    function disable(next = 'off') {
        const previous = controller;
        controller = null;
        service.disable();
        previous?.abort();
        status = next;
        notify();
    }
    async function enable() {
        disable();
        if (!supported()) return;
        if (service.enable().error) { disable('error'); return; }
        const active = new AbortController();
        controller = active;
        status = 'registering'; notify();
        try {
            const api = getModelContext();
            for (const tool of service.getTools()) {
                await api.registerTool({ ...tool, annotations: { ...tool.annotations, untrustedContentHint: true },
                    execute: async (args, options = {}) => {
                        if (active.signal.aborted || controller !== active || status !== 'on') throw Error('DSF_DISABLED');
                        if (options.signal?.aborted) throw Error('DSF_CANCELLED');
                        const result = tool.execute(args);
                        if (result.error) {
                            if (['WORK_CHANGED', 'NOT_IN_EDITOR', 'UNAVAILABLE', 'DISABLED'].includes(result.error.code)) disable();
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
    return { enable, disable, getStatus };
}

const labels = {
    ja: { title: 'AI連携（読み取り専用）', notice: 'オンにすると、このタブの編集対象と検索した本文の抜粋を接続AIに提供します。本文の変更・保存・発行は行いません。',
        unsupported: 'このブラウザでは非対応', off: 'オフ', on: 'ツール提供中', registering: '登録中…', error: '登録失敗：再試行できます', room: 'エディターで有効にできます' },
    en: { title: 'AI tools (read-only)', notice: 'When enabled, the connected AI can read this tab’s editor context and searched text excerpts. It cannot edit, save or publish.',
        unsupported: 'Unavailable in this browser', off: 'Off', on: 'Tools available', registering: 'Registering…', error: 'Registration failed: retry available', room: 'Enable in the editor' },
};

export function initStudioWebMCP({ readState, getUILang, subscribeProjectSession, doc = document, win = window }) {
    const gemini = initStudioGemini({ readState, getUILang, doc, win });
    const text = () => labels[getUILang() === 'en' ? 'en' : 'ja'];
    const getModelContext = () => win.top === win && win.isSecureContext ? doc.modelContext : null;
    function sync() {
        gemini.sync();
        const status = connection.getStatus(), inEditor = readState().room === 'editor', copy = text();
        doc.querySelectorAll('[data-studio-ai]').forEach(root => {
            const input = root.querySelector('input');
            input.checked = status === 'on' || status === 'registering';
            input.disabled = status === 'unsupported' || !inEditor;
            root.querySelector('[data-ai-title]').textContent = copy.title;
            root.querySelector('[data-ai-notice]').textContent = copy.notice;
            root.querySelector('[data-ai-status]').textContent = status === 'unsupported' ? copy.unsupported : !inEditor ? copy.room : copy[status];
        });
    }
    const connection = createStudioWebMCP({ readState, getModelContext, onChange: sync });
    doc.addEventListener('change', event => {
        if (!event.target.matches('[data-studio-ai] input')) return;
        if (event.target.checked) void connection.enable(); else connection.disable();
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
        <label><input type="checkbox" disabled><span data-ai-title>AI tools</span></label>
        <small data-ai-status role="status"></small><p data-ai-notice></p>
    </div>`;
}
