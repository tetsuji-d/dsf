import { getAIHandoffSource, buildAIHandoffPrompt } from './editor-ai-handoff.js';
import '../css/studio-gemini.css';

const copy = {
    ja: {
        open: 'Geminiに相談', title: 'Geminiへの依頼を準備', close: '閉じる',
        intro: '原稿を確認 → 依頼文をコピー → ChromeのGeminiに貼り付け',
        notice: '自動接続・自動操作ではありません。DSFからGeminiへ直接送信しません。コピーした原稿は、Geminiへ貼り付けて送信するとGoogleに渡ります。',
        request: '相談内容', defaultRequest: 'この原稿を読み、読みづらい表現と改善案を3点まで教えてください。',
        review: '文章を見直す', summarize: '要約する', summaryRequest: 'この原稿の要点を短くまとめてください。',
        scope: '対象：現在のFlow原稿・表示中の本文言語', source: 'コピーに含める原稿',
        exclusions: '画像・ルビの読み・書式は含みません。未入力の翻訳を原文で補いません。',
        preview: '依頼文の全文を確認', refresh: '原稿を取り込み直す', submit: '依頼文をコピー',
        copied: 'コピーしました。Chrome右上のGeminiを開き、貼り付けて送信してください。',
        failed: 'コピーできませんでした。下の依頼文を選択して手動でコピーしてください。',
        next: 'Chrome右上の「Geminiに相談」を開き、依頼文を貼り付けて送信します。表示されない場合はGoogleの利用条件を確認してください。',
        help: 'Gemini in Chromeの使い方', notEditor: 'エディターで開いてください。', busy: '原稿を反映中です。編集を終えてから取り込み直してください。',
        noFlow: '相談したいFlow原稿を選んでから開いてください。', noText: 'この言語のFlow本文がありません。',
        stale: '原稿・言語・対象が変わりました。取り込み直して内容を確認してください。',
        partial: '長いため冒頭12,000文字相当のみを含めます。全文の要約・件数確認には使えません。', characters: '文字相当',
    },
    en: {
        open: 'Ask Gemini', title: 'Prepare a request for Gemini', close: 'Close',
        intro: 'Review manuscript → Copy request → Paste into Gemini in Chrome',
        notice: 'This is a manual handoff, not an automatic connection or editor control. DSF does not send to Gemini. Pasting and submitting sends the copied manuscript to Google.',
        request: 'Your request', defaultRequest: 'Read this manuscript and suggest up to three improvements to its readability.',
        review: 'Review writing', summarize: 'Summarize', summaryRequest: 'Briefly summarize the main points of this manuscript.',
        scope: 'Source: current Flow manuscript in the displayed text language', source: 'Manuscript included in the copy',
        exclusions: 'Images, ruby readings and formatting are excluded. Missing translations do not fall back to the source language.',
        preview: 'Review the complete request', refresh: 'Refresh manuscript', submit: 'Copy request',
        copied: 'Copied. Open Gemini at the top of Chrome, paste the request and submit.',
        failed: 'Could not copy. Select the request below and copy it manually.',
        next: 'Open Ask Gemini at the top of Chrome, paste the request and submit. If unavailable, check Google’s eligibility requirements.',
        help: 'Using Gemini in Chrome', notEditor: 'Open this in the editor.', busy: 'Manuscript changes are pending. Finish editing, then refresh.',
        noFlow: 'Select a Flow manuscript before opening this panel.', noText: 'No Flow text exists in this language.',
        stale: 'The manuscript, language or target changed. Refresh and review it again.',
        partial: 'Only the first 12,000 graphemes are included. Do not use this for full-manuscript summaries or counts.', characters: 'graphemes',
    },
};

export function geminiHandoffMarkup() {
    return '<button type="button" class="studio-gemini-open" data-gemini-open>Geminiに相談</button>';
}

export function initStudioGemini({ readState, getUILang, doc = document, win = window }) {
    let dialog = null, source = null, workIdentity = null, returnFocus = null;
    const lang = () => getUILang() === 'en' ? 'en' : 'ja';
    const words = () => copy[lang()];
    const node = key => dialog?.querySelector(`[data-gemini-${key}]`);
    function close() {
        if (!dialog) return;
        const previous = dialog; dialog = null; source = null; workIdentity = null;
        previous.close(); previous.remove();
        if (returnFocus?.isConnected) returnFocus.focus();
    }
    function sync() {
        doc.querySelectorAll('[data-gemini-open]').forEach(button => {
            button.textContent = words().open;
            button.disabled = readState().room !== 'editor';
        });
    }
    function prompt() {
        return source && !source.error ? buildAIHandoffPrompt(source, node('request').value, lang()) : '';
    }
    function updatePrompt() {
        node('output').value = prompt();
        node('copy').disabled = !prompt();
        node('status').textContent = '';
    }
    function refresh() {
        const state = readState(); source = getAIHandoffSource(state); workIdentity = state.workIdentity;
        const t = words();
        node('source').value = source.text || '';
        node('summary').textContent = source.error ? t[source.error] : `${source.languageKey} · ${source.count.toLocaleString()} ${t.characters}`;
        node('warning').textContent = source.truncated ? t.partial : '';
        updatePrompt();
    }
    function current() {
        const state = readState();
        return state.workIdentity === workIdentity && JSON.stringify(getAIHandoffSource(state)) === JSON.stringify(source);
    }
    async function copyRequest() {
        if (!dialog || !source || source.error) return;
        if (!current()) {
            node('source').value = ''; node('output').value = ''; node('copy').disabled = true;
            node('status').textContent = words().stale; source = null; return;
        }
        const text = prompt(); if (!text) return;
        const target = dialog;
        try {
            await win.navigator.clipboard.writeText(text);
            if (dialog === target) node('status').textContent = words().copied;
        } catch {
            if (dialog !== target) return;
            node('details').open = true; node('output').focus(); node('output').select();
            node('status').textContent = words().failed;
        }
    }
    function open(trigger) {
        close(); returnFocus = trigger;
        const t = words();
        dialog = doc.createElement('dialog'); dialog.className = 'studio-gemini-dialog';
        dialog.setAttribute('aria-labelledby', 'studio-gemini-title');
        dialog.innerHTML = `<header><h2 id="studio-gemini-title">${t.title}</h2><button type="button" data-gemini-close>${t.close}</button></header>
            <p class="gemini-steps">${t.intro}</p><p>${t.notice}</p>
            <label>${t.request}<textarea data-gemini-request rows="3" maxlength="2000"></textarea></label>
            <div class="gemini-actions"><button type="button" data-gemini-review>${t.review}</button><button type="button" data-gemini-summarize>${t.summarize}</button></div>
            <p><strong>${t.scope}</strong><br><span data-gemini-summary></span></p>
            <p data-gemini-warning class="gemini-warning"></p>
            <label>${t.source}<textarea data-gemini-source readonly rows="6"></textarea></label><p>${t.exclusions}</p>
            <details data-gemini-details><summary>${t.preview}</summary><textarea data-gemini-output aria-label="${t.preview}" readonly rows="7"></textarea></details>
            <div class="gemini-actions"><button type="button" data-gemini-refresh>${t.refresh}</button><button type="button" class="gemini-primary" data-gemini-copy>${t.submit}</button></div>
            <p data-gemini-status role="status"></p><p>${t.next}</p>
            <a href="https://support.google.com/gemini/answer/16283624" target="_blank" rel="noopener noreferrer">${t.help}</a>`;
        node('request').value = t.defaultRequest;
        node('close').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        node('request').addEventListener('input', updatePrompt);
        node('review').addEventListener('click', () => { node('request').value = t.defaultRequest; updatePrompt(); });
        node('summarize').addEventListener('click', () => { node('request').value = t.summaryRequest; updatePrompt(); });
        node('refresh').addEventListener('click', refresh);
        node('copy').addEventListener('click', copyRequest);
        doc.body.append(dialog); refresh(); dialog.showModal();
    }
    doc.addEventListener('click', event => {
        const trigger = event.target.closest?.('[data-gemini-open]');
        if (trigger && !trigger.disabled) open(trigger);
    });
    doc.addEventListener('studio-ui-language-change', () => { close(); sync(); });
    win.addEventListener('pagehide', close);
    sync();
    return { sync, close };
}
