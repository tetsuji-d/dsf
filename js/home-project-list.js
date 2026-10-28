import { resolveProjectName, resolveProjectDisplayTitle } from './project-display-title.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const HOME_PROJECT_SORTS = ['updated-desc', 'updated-asc', 'name-asc', 'name-desc', 'title-asc', 'title-desc'];
export function editableReadLabels(locale = 'ja') {
    return locale === 'en'
        ? { name: 'Management name', title: 'Read title', updated: 'Updated', actions: 'Actions', unset: 'Not set', sort: 'Sort by', edit: 'Edit', sorts: ['Updated: newest first', 'Updated: oldest first', 'Management name: A–Z', 'Management name: Z–A', 'Read title: A–Z', 'Read title: Z–A'] }
        : { name: '管理名', title: 'リードタイトル', updated: '更新日', actions: '操作', unset: '未設定', sort: '並び替え', edit: '編集', sorts: ['更新日：新しい順', '更新日：古い順', '管理名：昇順', '管理名：降順', 'リードタイトル：昇順', 'リードタイトル：降順'] };
}
export function editableReadValues(project, locale = 'ja') {
    const value = project.lastUpdated || project.updatedAt;
    const ms = value?.toMillis?.() ?? (Number.isFinite(value?.seconds) ? value.seconds * 1000 : typeof value === 'number' ? value : Date.parse(value));
    return { id: project.id || '', name: resolveProjectName(project), title: resolveProjectDisplayTitle(project, { locale }), updated: Number.isFinite(ms) && ms > 0 ? ms : 0 };
}
export function compareEditableReads(a, b, sort = 'updated-desc', locale = 'ja') {
    const [key, direction] = (HOME_PROJECT_SORTS.includes(sort) ? sort : 'updated-desc').split('-');
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const first = a[key], second = b[key];
    // Missing values stay last in both directions; never substitute one name for the other.
    if (!first !== !second) return first ? -1 : 1;
    const result = key === 'updated' ? Number(first) - Number(second) : collator.compare(first, second);
    return result * (direction === 'desc' ? -1 : 1) || collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
}
export function editableReadTable(rowsMarkup, locale = 'ja') {
    const t = editableReadLabels(locale);
    return `<table class="home-editable-table" aria-label="${locale === 'en' ? 'Editable Reads' : '編集用リードの一覧'}"><colgroup><col class="home-name-column"><col class="home-title-column"><col class="home-updated-column"><col class="home-actions-column"></colgroup><thead><tr>${[t.name,t.title,t.updated,t.actions].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rowsMarkup}</tbody></table>`;
}
export function editableReadRow(project, { locale = 'ja', thumbnail = '', pageCount = 0, actions = '' } = {}) {
    const v = editableReadValues(project, locale), t = editableReadLabels(locale), date = v.updated ? new Date(v.updated) : null;
    const dateText = date ? date.toLocaleDateString(locale === 'en' ? 'en-US' : 'ja-JP') : '—';
    const timeText = date ? date.toLocaleTimeString(locale === 'en' ? 'en-US' : 'ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
    return `<tr class="home-project-entry" data-project-entry="${esc(v.id)}" data-sort-name="${esc(v.name)}" data-sort-title="${esc(v.title)}" data-sort-updated="${v.updated}">
        <td><button type="button" class="home-project-card" data-home-source="cloud" data-id="${esc(v.id)}" aria-label="${esc((v.name || v.title || t.unset) + ' — ' + t.edit)}">
            <span class="home-project-thumb"><span class="home-project-thumb-fallback"><span class="material-icons" aria-hidden="true">description</span></span>${thumbnail ? `<img src="${esc(thumbnail)}" alt="" loading="lazy" decoding="async">` : ''}</span>
            <span class="home-project-info"><span class="home-project-title">${esc(v.name || t.unset)}</span><span class="home-project-meta">${locale === 'en' ? `${pageCount} pages` : `${pageCount}ページ`}</span></span>
        </button></td>
        <td data-column-label="${t.title}"><span class="home-project-work-title${v.title ? '' : ' is-unset'}">${esc(v.title || t.unset)}</span></td>
        <td data-column-label="${t.updated}" class="home-project-updated"><time${date ? ` datetime="${date.toISOString()}"` : ''}>${dateText}<small>${timeText}</small></time></td>
        <td class="home-project-actions-cell" data-column-label="${t.actions}">${actions}</td>
    </tr>`;
}
