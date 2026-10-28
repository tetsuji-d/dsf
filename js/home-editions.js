import { readOwnedEditions } from './edition-list-client.js';
import { editionListCounts, editionListFolder, editionStatusLabel } from './edition-list.js';
import { EDITION_FOLDERS } from './edition-policy.js';

const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };

/** Publication status is always read from the same edition inventory as Reads. */
export async function renderHomeEditions({ root, stats, count, uid, scope, locale, isCurrent, onOpenReads, loadReview, force = false }) {
    if (!root) return;
    const en = locale === 'en', t = (ja, english) => en ? english : ja;
    stats?.replaceChildren(); count.textContent = '…';
    root.replaceChildren(el('p', t('発行済みリードを読み込み中…', 'Loading issued Reads…'), 'home-list-message'));
    if (!uid || !navigator.onLine || scope.joinedSelection?.()) {
        count.textContent = '—';
        root.replaceChildren(el('p', !uid ? t('ログインすると発行済みリードを確認できます。', 'Sign in to view issued Reads.') : !navigator.onLine ? t('公開状態は接続後に確認できます。', 'Connect to check visibility.') : t('発行済みリードは所有者のリーズで管理します。', 'The owner manages issued Reads in Reads.'), 'home-list-message'));
        return;
    }
    try {
        const rows = await readOwnedEditions({ uid, scope, locale, isCurrent, force });
        if (!isCurrent()) return;
        count.textContent = String(rows.length);
        const counts = editionListCounts(rows);
        for (const folder of EDITION_FOLDERS) {
            const button = el('button', null, 'home-edition-stat'); button.type = 'button';
            button.append(el('span', editionStatusLabel(folder, locale)), el('strong', String(counts[folder])));
            button.onclick = () => onOpenReads(folder); stats?.append(button);
        }
        const heading = el('div', null, 'home-edition-columns');
        heading.append(el('span', t('リード / 版', 'Read / edition')), el('span', t('公開状態', 'Visibility')), el('span', t('操作', 'Actions')));
        root.replaceChildren(heading);
        if (!rows.length) root.append(el('p', t('まだ発行済みリードはありません。編集用リードをプレスで発行すると、リーズの「非公開」に入ります。', 'Issue an editable Read in Press. It will appear in the Private folder in Reads.'), 'home-list-message'));
        const list = el('div', null, 'home-edition-list'); root.append(list);
        const more = el('button', t('さらに表示', 'Show more'), 'home-action-btn'); more.type = 'button'; root.append(more);
        let shown = 0;
        function appendRows() {
            for (const row of rows.slice(shown, shown + 25)) {
                const folder = editionListFolder(row.state), article = el('article', null, 'home-edition-row');
                article.dataset.editionId = row.state.editionId; article.dataset.visibility = folder;
                const thumb = el('div', '▤', 'home-list-thumb'); thumb.setAttribute('aria-label', t('表紙', 'Cover'));
                if (row.thumbnail) { const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.onerror = () => img.remove(); img.src = row.thumbnail; thumb.append(img); }
                const info = el('div', null, 'home-edition-info');
                info.append(el('h4', row.title), el('p', [row.state.editionLabel, t('発行 ', 'Issued ') + row.date].filter(Boolean).join(' · ')));
                if (row.titleIsWorkName) info.append(el('p', t('管理名を表示中（発行時のタイトルは未記録）', 'Management name shown; issued title was not recorded.')));
                const review = el('p', t('反応を確認中…', 'Loading feedback…'), 'home-edition-feedback');
                if (loadReview) {
                    info.append(review);
                    void loadReview(row.workId).then(summary => {
                        if (!isCurrent() || !review.isConnected) return;
                        review.textContent = summary.unavailable ? t('反応：未取得', 'Feedback: unavailable') : t(`作品のレビュー ${summary.reviewCount}${summary.reviewCount === 50 ? '+' : ''} · good ${summary.goodCount}（取得したレビュー内）`, `Work reviews ${summary.reviewCount}${summary.reviewCount === 50 ? '+' : ''} · good ${summary.goodCount} (loaded reviews)`);
                    }).catch(() => { if (isCurrent()) review.textContent = t('反応：未取得', 'Feedback: unavailable'); });
                }
                const status = el('span', editionStatusLabel(folder, locale), 'home-edition-status'); status.dataset.status = folder;
                const open = el('button', t('リーズで管理', 'Manage in Reads'), 'home-action-btn'); open.type = 'button';
                open.onclick = () => onOpenReads(folder, row.state.editionId);
                article.append(thumb, info, status, open); list.append(article);
            }
            shown += 25; more.hidden = shown >= rows.length;
        }
        more.onclick = appendRows; appendRows();
    } catch {
        if (!isCurrent()) return;
        count.textContent = '—'; stats?.replaceChildren();
        const retry = el('button', t('再試行', 'Retry'), 'home-action-btn'); retry.type = 'button';
        retry.onclick = () => { if (isCurrent()) void renderHomeEditions({ root, stats, count, uid, scope, locale, isCurrent, onOpenReads, loadReview, force: true }); };
        root.replaceChildren(el('p', t('発行済みリードを取得できませんでした。公開状態は未確認です。', 'Issued Reads could not be loaded. Visibility is unconfirmed.'), 'home-list-message'), retry);
    }
}
