/** Owner history UI. Firestore reads only; no publication/authoring operations. */
import { collection, doc, getDocFromServer, getDocsFromServer, query, orderBy, documentId, limit, startAfter } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { auth, db } from './firebase.js';
import { getOptimizedImageUrl } from './sections.js';
import { t, getUILang } from './i18n-studio.js';
import { projectReleaseHistory } from './works-release-history.js';
import { inspectReleaseHistory } from './dsf-release-history-inspection.js';
import { fetchDsfReleaseInventoryPages } from './dsf-release-inventory-client.js';
import { buildOwnerDraftViewerUrl } from './viewer-owner-preview.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = value => value ? new Date(value).toLocaleString(getUILang() === 'en' ? 'en-US' : 'ja-JP') : '—';
const fmtBytes = value => value === null ? '—' : `${value.toLocaleString()} B`;

// Keep the owner IO boundary explicit so the same UI can be exercised offline.
const ownerReads = {
    currentUser: () => auth.currentUser,
    subscribe: callback => onAuthStateChanged(auth, callback),
    read: async path => {
        const snapshot = await getDocFromServer(doc(db, ...path));
        return snapshot.exists() ? snapshot.data() : null;
    },
    page: async (path, cursor) => {
        const snapshot = await getDocsFromServer(query(collection(db, ...path),
            orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(25)));
        return { entries: snapshot.docs.map(item => ({ id: item.id, data: item.data() })),
            cursor: snapshot.docs.at(-1), hasMore: snapshot.size === 25 };
    },
    inventory: fetchDsfReleaseInventoryPages,
    inspect: inspectReleaseHistory,
    r2PublicBaseUrl: String(import.meta.env.VITE_R2_PUBLIC_URL || ''),
};

export function renderReleaseHistoryControl() {
    return `<details class="works-release-history" data-release-history><summary>${esc(t('history_title'))}</summary>
        <p>${esc(t('history_description'))}</p>
        <button type="button" data-history-refresh>${esc(t('history_refresh'))}</button>
        <button type="button" data-history-cancel hidden>${esc(t('history_cancel'))}</button>
        <div data-history-results aria-live="polite"></div>
        <button type="button" data-history-more hidden>${esc(t('history_more'))}</button></details>`;
}

function renderEntry(input, view, index) {
    const languages = view.languages.map(language => {
        const kinds = view.kindsByLanguage?.[language];
        return `<li>${esc(language)}: ${esc(view.pageCounts?.[language] ?? '—')} ${esc(t('history_pages'))}
            · fixedText ${kinds?.fixedText ?? (view.schemaVersion === 1 ? 0 : '—')} / WebP ${kinds?.webp ?? '—'}</li>`;
    }).join('');
    const preview = view.canPreview ? `<a href="${esc(buildOwnerDraftViewerUrl(location.origin, input.projectId, input.releaseId))}" target="_blank" rel="noopener noreferrer">${esc(t('history_preview'))}</a>` : '';
    return `<article class="works-history-entry">
        <div class="works-history-thumb">${view.thumbnail ? `<img src="${esc(getOptimizedImageUrl(view.thumbnail))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '—'}</div>
        <div><strong>${esc(view.releaseId)}</strong>
        <p>${esc(fmtDate(view.publishedAt))} · DSF ${esc(view.schemaVersion ?? '—')}
            ${view.isLatest ? ` · ${esc(t('history_latest'))}` : ''}
            ${view.isCurrentPublic ? ` · ${esc(t('history_current_public'))}` : view.referencedByPublic ? ` · ${esc(t('history_public_reference'))}` : ''}</p>
        <ul>${languages}</ul><p>${esc(t('history_bytes'))}: ${esc(fmtBytes(view.totalBytes))}</p>
        <p>${esc(t('history_hash'))}: <code>${esc(view.hash || t('history_hash_absent'))}</code></p>
        <p>${esc(t('history_integrity'))}: ${esc(t(`history_integrity_${view.integrity}`))}
            ${view.checkedAt ? ` (${esc(fmtDate(view.checkedAt))})` : ''}</p>
        <p><b>${esc(t(`history_eligibility_${view.eligibility}`))}</b></p>
        <ul>${view.reasons.map(reason => `<li>${esc(t(`history_reason_${reason}`))}</li>`).join('')}</ul>
        <p>${esc(t(view.schemaVersion === 1 ? 'history_v1_scope' : 'history_v2_scope'))}</p>
        <div class="works-history-actions">${preview}
        ${view.canInspect ? `<button type="button" data-history-inspect="${index}">${esc(t('history_inspect'))}</button>` : ''}</div></div></article>`;
}

export function bindReleaseHistoryPanels(listEl, ownerUid, reads = ownerReads) {
    const disposers = [];
    for (const panel of listEl.querySelectorAll('[data-release-history]')) {
        const row = panel.closest('[data-pid]');
        const projectId = row.dataset.pid;
        const workId = row.dataset.workId;
        const results = panel.querySelector('[data-history-results]');
        const more = panel.querySelector('[data-history-more]');
        const cancel = panel.querySelector('[data-history-cancel]');
        let entries = [], cursor = null, context = null, loaded = false, hasMore = false;
        let controller = null, generation = 0, disposed = false;
        const valid = n => !disposed && panel.isConnected && reads.currentUser()?.uid === ownerUid && generation === n;
        const abort = () => { generation++; controller?.abort(); controller = null; };
        const busy = value => {
            panel.setAttribute('aria-busy', String(value));
            panel.querySelectorAll('button:not([data-history-cancel])').forEach(button => { button.disabled = value; });
            cancel.hidden = !value;
        };
        const render = () => {
            results.innerHTML = entries.length ? entries.map((entry, index) => {
                const input = { ...context, releaseId: entry.id, release: entry.data, inspection: entry.inspection, now: Date.now() };
                return renderEntry(input, projectReleaseHistory(input), index);
            }).join('') : `<p>${esc(t('history_empty'))}</p>`;
            more.hidden = !hasMore;
        };
        const readContext = async () => {
            if (![ownerUid, workId].every(id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id || ''))) throw new Error('Invalid owner identity');
            const paths = [['users', ownerUid, 'projects', projectId], ['users', ownerUid, 'works', workId], ['public_projects', workId], ['users', ownerUid]];
            const [project, work, publicIndex, account] = await Promise.all(paths.map((path, index) =>
                index === 0 && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId || '') ? null : reads.read(path)));
            const r2PublicBaseUrl = reads.r2PublicBaseUrl;
            let allowedContentOrigins = [];
            try { const url = new URL(r2PublicBaseUrl); if (url.protocol === 'https:') allowedContentOrigins = [url.origin]; } catch { /* no configured origin */ }
            return { uid: ownerUid, projectId, workId, project, work, publicIndex, account, r2PublicBaseUrl, allowedContentOrigins };
        };
        const load = async (reset = false) => {
            abort(); const n = generation;
            busy(true);
            try {
                const nextContext = await readContext();
                if (!valid(n)) return;
                const snapshot = await reads.page(['users', ownerUid, 'works', workId, 'releases'], reset ? null : cursor);
                if (!valid(n)) return;
                context = nextContext;
                entries = [...(reset ? [] : entries.map(entry => ({ ...entry, inspection: null }))), ...snapshot.entries];
                cursor = snapshot.cursor || (reset ? null : cursor);
                hasMore = snapshot.hasMore;
                entries.sort((a, b) => (projectReleaseHistory({ ...context, release: b.data, releaseId: b.id, now: Date.now() }).publishedAt || 0)
                    - (projectReleaseHistory({ ...context, release: a.data, releaseId: a.id, now: Date.now() }).publishedAt || 0) || a.id.localeCompare(b.id));
                loaded = true; render();
            } catch { if (valid(n)) { entries = []; loaded = false; results.textContent = t('history_reason_unavailable'); } }
            finally { if (valid(n)) busy(false); }
        };
        const onToggle = () => { if (panel.open && !loaded) void load(true); if (!panel.open) { abort(); busy(false); } };
        const onClick = async event => {
            const button = event.target.closest('button');
            if (!button || button.disabled) return;
            if (button.hasAttribute('data-history-refresh')) return void load(true);
            if (button.hasAttribute('data-history-more')) return void load();
            if (button.hasAttribute('data-history-cancel')) { abort(); busy(false); return; }
            if (!button.hasAttribute('data-history-inspect')) return;
            const entry = entries[Number(button.dataset.historyInspect)];
            if (!entry) return;
            abort(); const n = generation; controller = new AbortController(); busy(true);
            try {
                const fresh = await readContext();
                const data = await reads.read(['users', ownerUid, 'works', workId, 'releases', entry.id]);
                if (!valid(n)) return;
                entry.data = data || {};
                context = fresh;
                const input = { ...context, release: entry.data, releaseId: entry.id, now: Date.now() };
                if (projectReleaseHistory(input).canInspect) {
                    const token = await reads.currentUser().getIdToken(false);
                    if (!valid(n)) return;
                    const inventoryPages = await reads.inventory({ token, signal: controller.signal });
                    if (!valid(n)) return;
                    entry.inspection = await reads.inspect({ ...input, inventoryPages, signal: controller.signal });
                }
                if (valid(n)) render();
            } catch { if (valid(n)) { entry.inspection = null; render(); results.append(document.createTextNode(t('history_reason_unavailable'))); } }
            finally { if (valid(n)) busy(false); }
        };
        panel.addEventListener('toggle', onToggle);
        panel.addEventListener('click', onClick);
        disposers.push(() => { disposed = true; abort(); entries = []; context = null; results.replaceChildren(); panel.removeEventListener('toggle', onToggle); panel.removeEventListener('click', onClick); });
    }
    const dispose = () => { while (disposers.length) disposers.pop()(); };
    const unsubscribe = reads.subscribe(user => { if (user?.uid !== ownerUid) dispose(); });
    return () => { unsubscribe(); dispose(); };
}
