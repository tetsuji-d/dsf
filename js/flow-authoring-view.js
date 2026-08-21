/** DOM renderer for the continuous semantic Flow authoring surface. */

import { getFlowBlockText } from './flow-document.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function blockLabel(type) {
    if (type === 'heading') return '見出し';
    if (type === 'paragraph') return '段落';
    return '改ページ';
}

function renderBlock(groupId, section, block, index, languageKey) {
    const common = `data-testid="flow-block" data-flow-group-id="${escapeHtml(groupId)}" data-flow-section-id="${escapeHtml(section.id)}" data-flow-block-id="${escapeHtml(block.id)}" data-flow-block-type="${escapeHtml(block.type)}"`;
    const moveButtons = `
        <button type="button" data-flow-action="move" data-flow-delta="-1" ${index === 0 ? 'disabled' : ''} aria-label="${blockLabel(block.type)}を上へ移動">↑</button>
        <button type="button" data-flow-action="move" data-flow-delta="1" ${index === section.blocks.length - 1 ? 'disabled' : ''} aria-label="${blockLabel(block.type)}を下へ移動">↓</button>`;
    const removeButton = `<button type="button" data-flow-action="remove" class="flow-authoring-danger" aria-label="${blockLabel(block.type)}を削除">削除</button>`;

    if (block.type === 'pageBreak') {
        return `
            <div class="flow-authoring-block flow-authoring-page-break" ${common} data-flow-page-break="true">
                <div class="flow-authoring-page-break-line" role="separator" aria-label="ここで改ページ"><span>ここで改ページ</span></div>
                <div class="flow-authoring-block-actions">${moveButtons}${removeButton}</div>
            </div>`;
    }

    const text = getFlowBlockText(block, languageKey);
    const headingControls = block.type === 'heading'
        ? `<label class="flow-authoring-level">レベル
                <select data-flow-field="heading-level" aria-label="見出しレベル">
                    ${[1, 2, 3, 4, 5, 6].map((level) => `<option value="${level}" ${block.level === level ? 'selected' : ''}>H${level}</option>`).join('')}
               </select>
           </label>`
        : '';
    const input = block.type === 'heading'
        ? `<textarea rows="1" data-testid="flow-heading-input" data-flow-field="block-text" class="flow-authoring-input flow-authoring-heading-input" aria-label="見出し本文" placeholder="見出しを入力">${escapeHtml(text)}</textarea>`
        : `<textarea rows="1" data-testid="flow-paragraph-input" data-flow-field="block-text" class="flow-authoring-input flow-authoring-paragraph-input" aria-label="段落本文" placeholder="本文を入力">${escapeHtml(text)}</textarea>`;

    return `
        <div class="flow-authoring-block flow-authoring-${escapeHtml(block.type)}" ${common}>
            <div class="flow-authoring-block-toolbar">
                <span>${blockLabel(block.type)}</span>
                ${headingControls}
                <div class="flow-authoring-block-actions">
                    ${moveButtons}
                    <button type="button" data-flow-action="insert" data-flow-block-type="pageBreak" aria-label="このブロックの後ろで改ページ">後ろで改ページ</button>
                    ${removeButton}
                </div>
            </div>
            ${input}
        </div>`;
}

function renderSection(groupId, section, languageKey, sectionIndex) {
    const title = typeof section.title?.[languageKey] === 'string' ? section.title[languageKey] : '';
    return `
        <section class="flow-authoring-section" data-testid="flow-section" data-flow-section-id="${escapeHtml(section.id)}">
            <div class="flow-authoring-section-heading">
                <span class="flow-authoring-section-number">Section ${sectionIndex + 1}</span>
                <label>アウトライン名
                    <input type="text" data-flow-field="section-title"
                        data-flow-group-id="${escapeHtml(groupId)}"
                        data-flow-section-id="${escapeHtml(section.id)}"
                        value="${escapeHtml(title)}"
                        placeholder="章・節の名前（本文には自動表示されません）">
                </label>
            </div>
            <div class="flow-authoring-blocks">
                ${(section.blocks || []).map((block, index) => renderBlock(groupId, section, block, index, languageKey)).join('')}
            </div>
            <div class="flow-authoring-insert-row" data-flow-section-id="${escapeHtml(section.id)}">
                <span>末尾へ追加</span>
                <button type="button" data-flow-action="insert" data-flow-block-type="heading">＋ 見出し</button>
                <button type="button" data-flow-action="insert" data-flow-block-type="paragraph">＋ 段落</button>
                <button type="button" data-flow-action="insert" data-flow-block-type="pageBreak" data-testid="flow-insert-page-break">＋ 改ページ</button>
            </div>
        </section>`;
}

function autosizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 34)}px`;
}

export function autosizeFlowAuthoringTextareas(root) {
    root?.querySelectorAll?.('.flow-authoring-input').forEach(autosizeTextarea);
}

export function updateFlowAuthoringViewStatus(root, options = {}) {
    if (!root) return;
    const state = String(options.state || 'idle');
    const pageCount = Math.max(0, Number(options.pageCount) || 0);
    const sourceRevision = Math.max(0, Number(options.sourceRevision) || 0);
    const renderedRevision = Math.max(0, Number(options.renderedRevision) || 0);
    root.dataset.reflowState = state;
    root.dataset.pageCount = String(pageCount);
    root.dataset.sourceRevision = String(sourceRevision);
    root.dataset.renderedRevision = String(renderedRevision);
    root.dataset.changeMode = String(options.changeSet?.mode || '');
    root.dataset.prefixPageCount = String(options.changeSet?.prefixPageCount || 0);
    root.dataset.measuredPageCount = String(options.changeSet?.measuredPageCount || 0);
    root.setAttribute('aria-busy', state === 'working' ? 'true' : 'false');
    const status = root.querySelector('[data-flow-authoring-status]');
    if (!status) return;
    if (state === 'working') {
        status.textContent = `ページ更新中…（現在 ${pageCount || '—'}ページ）`;
        return;
    }
    if (state === 'error') {
        status.textContent = options.message || 'ページ生成に失敗しました。原稿は保持されています。';
        return;
    }
    const changeSet = options.changeSet;
    const incremental = changeSet?.mode === 'incremental'
        ? ` / 増分 ${changeSet.measuredPageCount}ページ再計算`
        : '';
    status.textContent = `${pageCount}ページ${incremental}`;
}

export function renderFlowAuthoringView(root, options = {}) {
    if (!root) return;
    const group = options.group;
    const languageKey = String(options.languageKey || group?.flow?.document?.sourceLanguage || 'ja');
    const sections = group?.flow?.document?.sections || [];
    root.innerHTML = `
        <header class="flow-authoring-header">
            <div>
                <span class="flow-authoring-eyebrow">FLOW SOURCE</span>
                <h2>連続原稿</h2>
                <p>ページではなく、見出し・段落・改ページを編集します。</p>
            </div>
            <div class="flow-authoring-summary">
                <span>原稿言語 <strong>${escapeHtml(languageKey.toUpperCase())}</strong></span>
                <span data-testid="flow-generated-page-count" data-flow-authoring-status aria-live="polite">${Math.max(0, Number(options.pageCount) || 0)}ページ</span>
            </div>
        </header>
        <nav class="flow-authoring-outline" aria-label="Flow原稿のセクション">
            ${sections.map((section, index) => {
                const title = section.title?.[languageKey] || `Section ${index + 1}`;
                return `<button type="button" data-flow-action="jump-section" data-flow-section-id="${escapeHtml(section.id)}">${escapeHtml(title || `Section ${index + 1}`)}</button>`;
            }).join('')}
        </nav>
        <div class="flow-authoring-paper">
            ${sections.map((section, index) => renderSection(group.id, section, languageKey, index)).join('')}
        </div>`;
    root.dataset.testid = 'flow-authoring';
    root.dataset.flowGroupId = String(group?.id || '');
    root.dataset.languageKey = languageKey;
    autosizeFlowAuthoringTextareas(root);

    root.oninput = (event) => {
        if (event.target?.classList?.contains('flow-authoring-input')) autosizeTextarea(event.target);
        options.onInput?.(event);
    };
    root.onchange = (event) => options.onChange?.(event);
    root.onclick = (event) => options.onAction?.(event);
    root.onfocusin = (event) => options.onFocus?.(event);
    root.onfocusout = (event) => options.onBlur?.(event);
    root.oncompositionstart = (event) => options.onCompositionStart?.(event);
    root.oncompositionend = (event) => options.onCompositionEnd?.(event);
}
